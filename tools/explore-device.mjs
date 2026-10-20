/**
 * First-contact exploration of a Vislink Lynx L2174 — strictly read-only.
 *
 * Fetches everything the receiver's web interface reveals about itself, stores
 * the raw responses as fixtures, and reports what the module does not yet map.
 * Recorded reality beats memory: without this, every later question about the
 * device needs the device.
 *
 *   node tools/explore-device.mjs 10.81.5.131 --out fixtures/k7
 *
 * Safety. The receiver's write path is `GET /common/iframe.php?param=…&value=…`
 * — a plain GET carrying a query string, with no HTTP method to warn anyone off.
 * A mistyped argument could therefore turn a read into a write against a
 * receiver that is on air. Three rules make that impossible rather than
 * unlikely: only paths on the allowlist below are fetched, anything with a
 * query string is refused, and anything ending in `.php` is refused. Redirects
 * are not followed, so the device cannot walk us off the list either.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseParameters } from '../dist/api.js'
import { buildVariableValues } from '../dist/variables.js'

const GUI_PAGES = [
	'routing',
	'input',
	'services',
	'asi',
	'diverse',
	'asi_ip',
	'ccu',
	'alarms',
	'diagnostics',
	'preset',
	'versions',
	'licenses',
	'demodlicenses',
	'decodlicenses',
]

/** Everything worth having, and nothing that can change device state. */
const SAFE_PATHS = [
	'/',
	'/data.xml',
	'/settings.xml',
	'/custom.js',
	'/common/webgui.js',
	'/common/touch.js',
	'/common/cookie.js',
	'/common/new.css',
	'/common/unit.css',
	'/common/touch.css',
	...GUI_PAGES.map((page) => `/common/${page}.html`),
]

function assertSafe(path) {
	if (path.includes('?')) throw new Error(`refusing "${path}": a query string is how this device is written to`)
	if (path.endsWith('.php')) throw new Error(`refusing "${path}": PHP endpoints are the write path`)
	if (!SAFE_PATHS.includes(path)) throw new Error(`refusing "${path}": not on the read-only allowlist`)
}

/* ------------------------------------------------------------------ */
/* Sensitivity policy — the one decision this script does not make     */
/* ------------------------------------------------------------------ */

/**
 * Which `data.xml` / `settings.xml` parameters must not be committed.
 *
 * Raw captures are always written and are gitignored. The *redacted* copy is
 * what lands in a public repository, so what counts as sensitive is a judgement
 * call rather than a technical one — and the script fails closed: return
 * nothing and no redacted fixtures are written at all.
 *
 * Return an array of matchers. Each may be a string (matched against the
 * parameter name, case-insensitive substring) or a RegExp tested against the
 * name. Example: `['_KEY', /^DB_DISPLAY_.*_LICENCE$/]`
 *
 * Candidates this receiver exposes, from docs/LYNX_L2174_API.md:
 *   DB_DISPLAY_DEMOD_LICENCE / DB_DISPLAY_DECOD_LICENCE  full licence codes
 *   DB_L2174_AES_KEY01TO64 … _KEY193TO256                AES-256 key material
 *   DB_L2174_BISS_1_KEY / _BISS_E_KEY / _EBS_KEY         descrambling keys
 *   DB_ETRAX_SOURCE_ID / DB_DEMOD_SOURCE_ID / DB_DECOD_SOURCE_ID
 *                                                        licence-bound unit IDs
 *   DB_IP_ADDRESS, DB_DECOD_*_ADDR, DB_*_MAC_ADDRESS     network topology
 *   DB_L2174_SERIAL_NUM                                  unit serial
 */
function sensitiveMatchers() {
	// TODO(human): return the matchers for this repository's redaction policy.
}

function isSensitive(name, matchers) {
	return matchers.some((m) => (m instanceof RegExp ? m.test(name) : name.toLowerCase().includes(m.toLowerCase())))
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchOne(base, path, timeoutMs) {
	assertSafe(path)
	const started = Date.now()
	const res = await fetch(new URL(path, base), {
		redirect: 'manual', // never let the device walk us off the allowlist
		signal: AbortSignal.timeout(timeoutMs),
		headers: { 'User-Agent': 'companion-module-vislink-lynx-2174/explore (read-only)' },
	})
	const body = await res.text()
	return {
		path,
		status: res.status,
		ms: Date.now() - started,
		headers: Object.fromEntries(res.headers.entries()),
		body,
	}
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which parameters the module actually consumes.
 *
 * Rather than parsing src/variables.ts and hoping the parse stays honest, hand
 * the real mapping a Proxy and let it tell us what it touched. Whatever it
 * never reads is, by definition, not mapped.
 */
function mappedParameters(params) {
	const touched = new Set()
	const spy = new Proxy(
		{ ...params },
		{
			get(target, prop) {
				if (typeof prop === 'string') touched.add(prop)
				return target[prop]
			},
		},
	)
	try {
		buildVariableValues(spy)
	} catch (e) {
		console.warn(`  ! buildVariableValues threw while probing: ${e.message}`)
	}
	return touched
}

function parseSettingsNames(xml) {
	return new Set([...xml.matchAll(/<name>(.*?)<\/name>/gs)].map((m) => m[1].trim()))
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
	// Pull flag pairs out first, so `--out x 10.0.0.1` cannot mistake the flag's
	// value for the host.
	const argv = process.argv.slice(2)
	const args = []
	const flags = new Map()
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) flags.set(argv[i].slice(2), argv[++i])
		else args.push(argv[i])
	}
	const host = args[0]
	if (!host) {
		throw new Error('usage: node tools/explore-device.mjs <host> [--port 80] [--out fixtures/<name>] [--delay 250]')
	}
	const opt = (name, fallback) => flags.get(name) ?? fallback
	const num = (name, fallback) => {
		const v = Number(opt(name, fallback))
		return Number.isFinite(v) ? v : fallback
	}
	const port = num('port', 80)
	const delayMs = num('delay', 250)
	const timeoutMs = num('timeout', 10000)
	const root = join(dirname(fileURLToPath(import.meta.url)), '..')
	// resolve, not join: an absolute --out must land where it says, not inside
	// the repo — these captures carry real IPs and licence codes.
	const outDir = resolve(root, opt('out', `fixtures/${host.replace(/[^\w.-]/g, '_')}`))
	const base = `http://${host}:${port}`

	console.log(`Exploring ${base}`)
	console.log(`  ${SAFE_PATHS.length} paths, ${delayMs} ms apart, read-only\n`)

	await mkdir(join(outDir, 'raw'), { recursive: true })

	const results = []
	for (const path of SAFE_PATHS) {
		try {
			const res = await fetchOne(base, path, timeoutMs)
			results.push(res)
			const name = (path === '/' ? 'index.html' : path.replace(/^\//, '').replace(/\//g, '_')) || 'index'
			await writeFile(join(outDir, 'raw', name), res.body)
			console.log(
				`  ${String(res.status).padEnd(3)} ${path.padEnd(32)} ${String(res.body.length).padStart(7)} B  ${res.ms} ms`,
			)
		} catch (e) {
			results.push({ path, error: e.message })
			console.log(`  ERR ${path.padEnd(32)} ${e.message}`)
		}
		await new Promise((r) => setTimeout(r, delayMs))
	}

	await writeFile(
		join(outDir, 'raw', '_responses.json'),
		JSON.stringify(
			results.map(({ body, ...rest }) => ({ ...rest, bytes: body?.length ?? 0 })),
			null,
			'\t',
		) + '\n',
	)

	// --- what did we learn? ---
	const data = results.find((r) => r.path === '/data.xml')?.body ?? ''
	const settings = results.find((r) => r.path === '/settings.xml')?.body ?? ''
	const params = data ? parseParameters(data) : {}
	const names = Object.keys(params)
	const settingsNames = settings ? parseSettingsNames(settings) : new Set()
	// mapped can name parameters this unit does not report (another firmware,
	// another licence), so count against what actually came back.
	const mapped = names.length ? mappedParameters(params) : new Set()
	const unmapped = names.filter((n) => !mapped.has(n)).sort()
	const writableOnGui = new Set()
	for (const r of results) {
		if (!r.path?.endsWith('.html') || !r.body) continue
		for (const m of r.body.matchAll(
			/send_form(?:_combo|_slider|_nudge|_on_off)?\(this,\s*'[^']*',\s*'([A-Z0-9_]+)'/g,
		)) {
			writableOnGui.add(m[1])
		}
	}

	const summary = [
		`# Device exploration — ${host}`,
		'',
		`Captured ${new Date().toISOString()} by \`tools/explore-device.mjs\` (read-only).`,
		'',
		'## Identity',
		'',
		...[
			'DB_L2174_WEB_TEXT',
			'DB_L2174_SERIAL_NUM',
			'DB_L2174_BUILD_VERSION',
			'DB_L2174_SW_VERSION',
			'DB_L2174_KERN_VERSION',
			'DB_DEMOD_RX_MODE',
			'DB_L2174_FREQ1',
		].map((k) => `- \`${k}\`: ${params[k] ?? '—'}`),
		'',
		'## Counts',
		'',
		`- \`data.xml\`: ${names.length} parameters`,
		`- \`settings.xml\`: ${settingsNames.size} definitions`,
		`- in data.xml but undefined in settings.xml: ${names.filter((n) => !settingsNames.has(n)).length}`,
		`- defined but not currently reported: ${[...settingsNames].filter((n) => !(n in params)).length}`,
		`- consumed by this module: ${names.filter((n) => mapped.has(n)).length}`,
		`- **not mapped by this module: ${unmapped.length}**`,
		`- writable via the GUI's own forms: ${writableOnGui.size}`,
		'',
		'## Not mapped by the module',
		'',
		'These the receiver reports and the module ignores — the shortlist for anything worth adding.',
		'',
		...unmapped.map((n) => `- \`${n}\` = ${JSON.stringify(params[n] ?? '')}`),
		'',
		'## Writable from the device web interface',
		'',
		"Reconstructed from the pages' own `send_form(...)` calls. **Not exercised by this script.**",
		'',
		...[...writableOnGui].sort().map((n) => `- \`${n}\``),
		'',
	].join('\n')
	await writeFile(join(outDir, 'raw', 'SUMMARY.md'), summary)

	console.log(`\nRaw capture + SUMMARY.md written to ${outDir}/raw/ (gitignored)`)
	console.log(`  ${names.length} parameters, ${unmapped.length} of them not mapped by the module`)

	// --- redacted copy, the part that may be committed ---
	const matchers = sensitiveMatchers()
	if (!Array.isArray(matchers) || matchers.length === 0) {
		console.log('\nNo redaction policy set (see sensitiveMatchers in this file).')
		console.log('Skipping the committable copy rather than guessing what is safe to publish.')
		return
	}

	const redacted = Object.fromEntries(
		Object.entries(params).map(([k, v]) => [k, isSensitive(k, matchers) ? '<redacted>' : v]),
	)
	await writeFile(join(outDir, 'parameters.json'), JSON.stringify(redacted, null, '\t') + '\n')
	const hidden = Object.values(redacted).filter((v) => v === '<redacted>').length
	console.log(`\nRedacted fixture written to ${outDir}/parameters.json (${hidden} values hidden)`)
}

main().catch((e) => {
	console.error(e.message)
	process.exitCode = 1
})
