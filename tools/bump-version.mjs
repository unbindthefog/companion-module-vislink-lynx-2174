/**
 * Bump the patch version before packaging.
 *
 * Companion keys installed modules by version, so re-packaging without a bump
 * produces a tarball it will not cleanly re-import — the old files stay in
 * place. Running this as part of `yarn package` means every tarball on disk is
 * a distinct, importable version.
 *
 * package.json and companion/manifest.json both carry the version and must
 * agree, so they are written together.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['package.json', 'companion/manifest.json'].map((name) => join(root, name))

const [pkgPath] = files
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
if (!match) {
	throw new Error(`Cannot bump non-semver version "${current}" in package.json`)
}

const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`

for (const file of files) {
	const raw = readFileSync(file, 'utf8')
	const data = JSON.parse(raw)
	data.version = next
	// Preserve the trailing newline these files are formatted with.
	writeFileSync(file, `${JSON.stringify(data, null, '\t')}\n`)
}

console.log(`Version ${current} -> ${next}`)
