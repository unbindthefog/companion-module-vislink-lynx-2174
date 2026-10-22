import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pollDelayMs } from '../dist/main.js'

/**
 * The gap between polls while the receiver is not answering.
 *
 * Worth its own tests because the shape is easy to get subtly wrong, and the
 * two mistakes it can make are both expensive: too eager and the module
 * hammers a device that is already in trouble — an earlier version exhausted
 * this machine's ephemeral ports overnight — while too lazy means a receiver
 * that came back stays marked dead for minutes.
 */
describe('the gap between polls grows while the receiver stays silent', () => {
	it('is the configured interval while nothing is wrong', () => {
		assert.equal(pollDelayMs(2000, 0), 2000)
		assert.equal(pollDelayMs(60_000, 0), 60_000)
	})

	it('doubles from the configured interval, then levels off at 30 s', () => {
		const gaps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => pollDelayMs(2000, n))
		assert.deepEqual(gaps, [2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000, 30_000])
	})

	it('never polls a failing receiver faster than a healthy one', () => {
		// The cap is 30 s, so a 60 s interval would be *shortened* by a naive
		// `Math.min`. Someone who asked for a minute between polls did not ask
		// for failures to speed that up.
		for (const failures of [1, 2, 5, 20]) {
			assert.ok(pollDelayMs(60_000, failures) >= 60_000, `${failures} failures must not drop below the interval`)
		}
	})

	it('cannot be talked into a zero or negative gap', () => {
		for (const failures of [-1, 0, 1, 100, 1000]) {
			assert.ok(pollDelayMs(2000, failures) >= 2000, `failures=${failures}`)
		}
	})
})
