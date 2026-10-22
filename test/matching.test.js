import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CONTROL_SETTINGS } from '../dist/controls.js'

/**
 * The property `settingMatches()` leans on.
 *
 * It compares a button's configured value against the receiver's reading while
 * ignoring whitespace and case, and treating numbers as numbers. That is only
 * safe as long as no setting offers two values that collide under those rules —
 * otherwise a button could go green for a value the receiver is not on.
 *
 * It is a property of the value lists, not of the comparison, so it is checked
 * here: a future value that breaks it fails this test instead of quietly
 * lighting the wrong button.
 */
describe('no setting offers two values that a forgiving comparison would confuse', () => {
	for (const setting of CONTROL_SETTINGS) {
		it(`${setting.id}: ${setting.values.length} values stay distinct`, () => {
			const folded = setting.values.map((v) => v.trim().toLowerCase())
			assert.equal(new Set(folded).size, folded.length, 'two values differ only in case or spacing')

			for (const a of setting.values) {
				for (const b of setting.values) {
					if (a === b) continue
					const [x, y] = [Number(a), Number(b)]
					assert.ok(
						!(Number.isFinite(x) && Number.isFinite(y) && x === y),
						`${JSON.stringify(a)} and ${JSON.stringify(b)} are the same number`,
					)
				}
			}
		})
	}

	it('the preset slot, the reason the numeric rule exists, cannot collide either', () => {
		// `preset` is in the feedback's dropdown but has no value list of its own
		// — it is a reading, not a setting this module writes. The slots are
		// 001…016, so this stands in for the list the other sources have.
		const slots = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(3, '0'))
		assert.equal(new Set(slots.map(Number)).size, slots.length, 'two slots are the same number')
	})

	it('a value that is only whitespace would break the comparison, so none exists', () => {
		for (const setting of CONTROL_SETTINGS) {
			for (const value of setting.values) {
				assert.ok(value.trim().length > 0, `${setting.id} offers a blank value`)
			}
		}
	})
})
