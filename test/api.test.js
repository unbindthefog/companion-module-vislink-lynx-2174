import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import { LynxApi } from '../dist/api.js'

/**
 * These tests talk HTTP.
 *
 * Everywhere else the API client is stubbed out, which leaves the one seam
 * that matters untested: the moment a request actually leaves. That seam is
 * where the write guards live, and it is where the delta review found a check
 * that compared a value against itself and could never disagree. A stub cannot
 * catch that — only something that observes which server received what.
 *
 * So each test here runs one or two throwaway servers on 127.0.0.1 and asks
 * what they were asked for. No device is involved, and none may be: two of the
 * three receivers this module is used with are on air.
 */
function stubReceiver() {
	const got = []
	let hold = null

	const server = http.createServer(async (req, res) => {
		got.push(req.url)
		if (hold) await hold
		res.writeHead(200, { 'Content-Type': 'text/xml' })
		res.end('<data><parameter><name>DB_L2174_WEB_TEXT</name><value>ok</value></parameter></data>')
	})

	return {
		got,
		/** Make the next answers wait, so a request can be caught mid-queue. */
		block() {
			let release
			hold = new Promise((resolve) => (release = resolve))
			return () => {
				hold = null
				release()
			}
		},
		listen() {
			return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
		},
		close() {
			// Force the sockets shut. A keep-alive connection left open by a
			// client that was destroyed mid-request would otherwise hold
			// `server.close()` open for ever, and the suite would hang rather
			// than fail.
			server.closeAllConnections?.()
			return new Promise((resolve) => server.close(resolve))
		},
	}
}

function options(port, overrides = {}) {
	return {
		host: '127.0.0.1',
		port,
		timeoutMs: 2000,
		allowWrites: true,
		allowGuardedWrites: false,
		...overrides,
	}
}

const quiet = () => {}

describe('the write guards, at the moment a request leaves', () => {
	let a, b, portA, portB

	before(async () => {
		a = stubReceiver()
		b = stubReceiver()
		portA = await a.listen()
		portB = await b.listen()
	})

	after(async () => {
		await a.close()
		await b.close()
	})

	it('writes an allowlisted parameter, as a GET with the value in the query', async () => {
		const api = new LynxApi(options(portA), quiet)
		await api.setParameter('DB_L2174_WEB_TEXT', 'hello there')
		api.destroy()

		assert.equal(a.got.at(-1), '/common/iframe.php?param=DB_L2174_WEB_TEXT&value=hello%20there')
	})

	it('refuses a parameter that is on neither list', async () => {
		const api = new LynxApi(options(portA), quiet)
		const before = a.got.length
		await assert.rejects(
			() => api.setParameter('DB_RESTORE_DEFAULTS', 'Yes'),
			/not one of the parameters this module may change/,
		)
		api.destroy()

		assert.equal(a.got.length, before, 'a refused write must not reach the receiver at all')
	})

	it('refuses a guarded parameter while the switch is off, and allows it when on', async () => {
		const locked = new LynxApi(options(portA), quiet)
		await assert.rejects(() => locked.setParameter('DB_L2174_LNB_PWR_1', 'On'), /guarded actions/)
		locked.destroy()

		const unlocked = new LynxApi(options(portA, { allowGuardedWrites: true }), quiet)
		await unlocked.setParameter('DB_L2174_LNB_PWR_1', 'On')
		unlocked.destroy()

		assert.match(a.got.at(-1), /DB_L2174_LNB_PWR_1/)
	})

	it('refuses every write while the connection is read only', async () => {
		const api = new LynxApi(options(portA, { allowWrites: false, allowGuardedWrites: true }), quiet)
		const before = a.got.length
		await assert.rejects(() => api.setParameter('DB_L2174_WEB_TEXT', 'x'), /set to read only/)
		api.destroy()

		assert.equal(a.got.length, before)
	})

	it('refuses a write that was queued before read only was switched on', async () => {
		// The case a call-time check alone would miss: the press happened while
		// writing was allowed, and the switch moved while it sat in the queue.
		const api = new LynxApi(options(portA), quiet)
		const release = a.block()
		const poll = api.getParameters()
		const write = api.setParameter('DB_L2174_WEB_TEXT', 'late')

		api.updateOptions(options(portA, { allowWrites: false }))
		release()

		await poll
		const before = a.got.length
		await assert.rejects(() => write, /set to read only/)
		assert.equal(a.got.length, before, 'nothing further may have gone out')
		api.destroy()
	})

	it('does not deliver a queued write to a receiver the connection was moved to', async () => {
		// The delta review's finding, reproduced: a write waits behind a slow
		// poll, the address changes, and the value lands on whatever is at the
		// new address — which in the field is a receiver on air.
		const api = new LynxApi(options(portA), quiet)
		const release = a.block()
		const poll = api.getParameters()
		const write = api.setParameter('DB_L2174_RX_MODE', 'DVBT')

		// Let the poll reach the socket before moving the address. Without this
		// the poll is still sitting in the agent's own queue, and resetting the
		// agent re-sends it to the new address — a read, so harmless, but it
		// would be measuring the wrong thing here.
		await new Promise((resolve) => setTimeout(resolve, 50))
		api.updateOptions(options(portB))
		release()

		await poll.catch(() => undefined)
		await assert.rejects(() => write, /pointed at a different receiver/)
		assert.deepEqual(
			b.got.filter((url) => url.includes('iframe.php')),
			[],
			'the new receiver must not have been written to',
		)
		api.destroy()
	})

	it('does not deliver a queued write after the connection has been closed', async () => {
		// Destroying the agent is not enough on its own: Node falls back to its
		// global agent when a request is given none, so the write goes out to a
		// connection that no longer exists. Taking the connection down has to
		// drop the write, the same way moving it does.
		const api = new LynxApi(options(portA), quiet)
		const release = a.block()
		const poll = api.getParameters()
		const write = api.setParameter('DB_L2174_RX_MODE', 'DVBT')
		await new Promise((resolve) => setTimeout(resolve, 50))

		const before = [...a.got]
		api.destroy()
		release()

		await poll.catch(() => undefined)
		await assert.rejects(() => write, /this connection has been closed/)
		assert.deepEqual(a.got, before, 'nothing may go out after the connection is closed')
	})

	it('reports an answer that carries no parameters rather than treating it as empty', async () => {
		const empty = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/xml' })
			res.end('<data></data>')
		})
		const port = await new Promise((resolve) => empty.listen(0, '127.0.0.1', () => resolve(empty.address().port)))

		const api = new LynxApi(options(port), quiet)
		await assert.rejects(() => api.getParameters(), /contained no parameters/)
		api.destroy()
		empty.closeAllConnections?.()
		await new Promise((resolve) => empty.close(resolve))
	})
})
