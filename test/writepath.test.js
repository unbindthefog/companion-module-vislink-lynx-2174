import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, it } from 'node:test'

import ModuleInstance, { RELEASE_GAP_MS } from '../dist/main.js'

/**
 * The write path, driven through the real module against a real socket.
 *
 * This is the part of the module that two reviews called its riskiest and
 * least covered code: the one-in-flight-per-parameter rule, the value held
 * back behind it, the verify timer and the catch-up after an outage. Every
 * other test file stubs `writeParameter` away, which is exactly the method
 * whose behaviour matters here.
 *
 * So these build the actual instance — Companion's own base class, with a
 * stand-in for the host — and point it at a throwaway receiver on 127.0.0.1.
 * The stub records what it was asked for and decides what `data.xml` says
 * next, which is the only way to act out "the receiver has not caught up yet"
 * and "the receiver is gone" without one.
 */

/** A stand-in for the host Companion normally provides. */
function hostContext() {
	const hostLines = []
	// Everything the base class forwards is a no-op here; the assertions are
	// about what reached the receiver, not about Companion. `log` has to be a
	// function because the base class calls it, so it is kept apart from the
	// array it writes into — a first version stored the array under `log` and
	// the function branch below was dead.
	return new Proxy(
		{ id: 'test', label: 'test', _isInstanceContext: true, hostLines },
		{
			get(target, key) {
				if (key === 'log') return (level, message) => hostLines.push({ level, message })
				if (key in target) return target[key]
				return () => {}
			},
		},
	)
}

/** A receiver that answers data.xml from a map you can change mid-test. */
function stubReceiver(initial = {}) {
	const params = { ...initial }
	const writes = []
	let offline = false

	const server = http.createServer((req, res) => {
		if (offline) {
			req.destroy()
			return
		}
		const url = new URL(req.url, 'http://localhost')
		if (url.pathname === '/common/iframe.php') {
			const name = url.searchParams.get('param')
			const value = url.searchParams.get('value')
			writes.push({ name, value, at: Date.now() })
			// Deliberately *not* applied to `params`: the receiver answering 200
			// is not the same as the receiver having taken the value, and the
			// read-back machinery exists for precisely that gap. A test says
			// explicitly when the value lands, with `accept()`.
			res.writeHead(200).end('ok')
			return
		}
		const body = Object.entries(params)
			.map(([k, v]) => `<parameter><name>${k}</name><value><![CDATA[${v}]]></value></parameter>`)
			.join('')
		res.writeHead(200, { 'Content-Type': 'text/xml' }).end(`<data>${body}</data>`)
	})

	return {
		writes,
		params,
		/** Let the receiver report a value, the way a real one would once it settles. */
		accept(name, value) {
			params[name] = value
		},
		setOffline(value) {
			offline = value
		},
		listen() {
			return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
		},
		close() {
			server.closeAllConnections?.()
			return new Promise((resolve) => server.close(resolve))
		},
	}
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait until something becomes true, or give up.
 *
 * Used where the moment is decided by the poll backoff rather than by a fixed
 * delay: after a few failed polls the next attempt can be fifteen seconds
 * away, and a fixed `tick()` there either flutters or has to be absurdly long.
 */
async function waitFor(condition, timeoutMs, what) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (condition()) return
		await tick(250)
	}
	assert.fail(`timed out waiting for ${what}`)
}

/** Three parameters the write allowlist permits, used where the names do not matter. */
const THREE = ['DB_L2174_WEB_TEXT', 'DB_DECOD_OVERLAY_TYPE', 'DB_DECOD_OVERLAY_BACKGROUND']

/**
 * Run a test against a fresh instance and receiver, and take both down again.
 *
 * In a `finally`, because a failed assertion otherwise leaves a polling
 * instance and an open server behind: the test is reported, and then the
 * process never exits. A suite that hangs on failure is worse than one that
 * fails, because nobody reads the reason.
 */
async function withReceiver(initial, body, config = {}) {
	const receiver = stubReceiver(initial)
	let self
	try {
		const port = await receiver.listen()
		self = await connected(receiver, port, config)
		await body(self, receiver)
	} finally {
		// Everything after `listen()` is inside the try, including the setup:
		// a throw in `init()` would otherwise leave the server listening and
		// the process alive, which is the hang this helper exists to prevent.
		try {
			await self?.destroy()
		} finally {
			await receiver.close()
		}
	}
}

async function connected(receiver, port, config = {}) {
	const self = new ModuleInstance(hostContext())
	// Captured on the instance rather than through the host: `log()` is what
	// the module itself calls, and several of the decisions under test are
	// only observable as a line in the log.
	self.lines = []
	self.log = (level, message) => self.lines.push({ level, message })
	await self.init({ host: '127.0.0.1', port, pollInterval: 1, readOnly: false, allowGuardedActions: true, ...config })
	// Let the first poll land so the instance is in its normal running state.
	await tick(150)
	return self
}

const said = (self, text) => self.lines.find((l) => l.message.includes(text))

describe('one write per parameter at a time', () => {
	it('holds the second press back, then sends it once the first is confirmed', async () => {
		await withReceiver({ DB_L2174_WEB_TEXT: 'start' }, async (self, receiver) => {
			await self.writeParameter('DB_L2174_WEB_TEXT', 'first', true)
			await self.writeParameter('DB_L2174_WEB_TEXT', 'second', true)

			assert.deepEqual(
				receiver.writes.map((w) => w.value),
				['first'],
				'the second press must wait rather than land back to back',
			)

			// The receiver catches up with the first value; the next poll sees it.
			receiver.accept('DB_L2174_WEB_TEXT', 'first')
			await tick(1500)

			assert.deepEqual(
				receiver.writes.map((w) => w.value),
				['first', 'second'],
				'and it goes out once the slot is free',
			)
		})
	})

	it('keeps only the most recent press, and says what it dropped', async () => {
		await withReceiver({ DB_L2174_WEB_TEXT: 'start' }, async (self, receiver) => {
			await self.writeParameter('DB_L2174_WEB_TEXT', 'one', true)
			await self.writeParameter('DB_L2174_WEB_TEXT', 'two', true)
			await self.writeParameter('DB_L2174_WEB_TEXT', 'three', true)

			receiver.accept('DB_L2174_WEB_TEXT', 'one')
			await tick(1500)

			assert.deepEqual(
				receiver.writes.map((w) => w.value),
				['one', 'three'],
				'the middle press is dropped, not queued behind',
			)
			assert.ok(said(self, 'Dropping DB_L2174_WEB_TEXT = two'), 'a dropped press has to be said out loud')
		})
	})
})

describe('the catch-up after an outage', () => {
	it('lets held values out one at a time instead of all in one tick', async () => {
		// The case the bench measured: a sustained run of writes is the one
		// thing this receiver drops, and the queue flush was the only place the
		// module produced one.
		// Real parameter names: the allowlist refuses anything else, as a
		// previous version of this test found out.
		await withReceiver(Object.fromEntries(THREE.map((n) => [n, 'start'])), async (self, receiver) => {
			// Three parameters in flight, then the receiver goes away before any of
			// them is confirmed. Each press lands a value waiting behind it.
			for (const name of THREE) await self.writeParameter(name, 'first', true)
			for (const name of THREE) await self.writeParameter(name, 'second', true)
			assert.equal(receiver.writes.length, 3, 'only the first of each pair has gone out')

			receiver.setOffline(true)
			await tick(1500)
			receiver.setOffline(false)

			// Contact returns. Without the spacing all three would leave together.
			await tick(2500)
			const afterReturn = receiver.writes.filter((w) => w.value === 'second')
			assert.equal(afterReturn.length, 1, 'exactly one held value goes out when contact returns')
			assert.ok(
				said(self, 'letting 3 held values out'),
				'and the log says a catch-up is under way, so a slow button is explained',
			)
		})
	})

	it('stops when contact goes again, and keeps what has not gone out', async () => {
		// A failed poll deliberately does not empty the queue — one dropped
		// answer is ordinary. So the release chain has to stop by itself:
		// every further step would take a value out of the queue, fail to
		// send it, and leave nothing to put it back.
		await withReceiver(Object.fromEntries(THREE.map((n) => [n, 'start'])), async (self, receiver) => {
			for (const name of THREE) await self.writeParameter(name, 'first', true)
			for (const name of THREE) await self.writeParameter(name, 'second', true)

			receiver.setOffline(true)
			await tick(1500)
			receiver.setOffline(false)
			await tick(2500)
			assert.equal(receiver.writes.filter((w) => w.value === 'second').length, 1, 'the chain has started')

			// Away again, mid-chain, and long enough that the next step would
			// have fired had the chain kept running.
			receiver.setOffline(true)
			await tick(RELEASE_GAP_MS + 2000)
			const sent = receiver.writes.filter((w) => w.value === 'second').length
			receiver.setOffline(false)

			// Contact returns; the two values that never went out are still
			// there to be sent, rather than having been dropped one by one.
			// How soon depends on the poll backoff, so wait for the fact.
			await waitFor(
				() => receiver.writes.filter((w) => w.value === 'second').length > sent,
				25000,
				'what was still waiting to go out once contact is back',
			)
			assert.equal(
				self.lines.filter((l) => l.message.startsWith('Could not set')).length,
				0,
				'and nothing was thrown away while the receiver was gone',
			)
		})
	})

	it('sends nothing more once the connection is taken down', async () => {
		await withReceiver(Object.fromEntries(THREE.slice(0, 2).map((n) => [n, 'start'])), async (self, receiver) => {
			for (const name of THREE.slice(0, 2)) await self.writeParameter(name, 'first', true)
			for (const name of THREE.slice(0, 2)) await self.writeParameter(name, 'second', true)

			receiver.setOffline(true)
			await tick(1500)
			receiver.setOffline(false)
			await tick(2500)

			const before = receiver.writes.length
			await self.destroy()
			// Longer than the gap, so a chain that kept running would have had
			// its next turn. Derived from the constant rather than guessed.
			//
			// Note what this shows and what it does not: nothing leaves after
			// the connection is closed, which `api.ts` guarantees on its own.
			// It does *not* pin `#stopRelease()` — removing that call leaves
			// this green, because the chain's writes would be refused anyway.
			// What `#stopRelease()` actually prevents is a dead chain blocking
			// the next catch-up after the connection is pointed somewhere
			// else, and that is still uncovered.
			await tick(RELEASE_GAP_MS + 1500)
			assert.equal(receiver.writes.length, before, 'nothing may go out after the connection is closed')
		})
	})
})
