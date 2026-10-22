import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { UpdateActions } from '../dist/actions.js'
import { GUARDED_PARAMETERS, SAFE_PARAMETERS } from '../dist/api.js'
import {
	CONTROL_CHANNELS,
	CONTROL_SETTINGS,
	controlParameter,
	driftedControlIds,
	unlistedControlParameters,
} from '../dist/controls.js'

/**
 * What these tests are for.
 *
 * Every choice action on this receiver is built from one row of
 * `CONTROL_SETTINGS` by one shared function. Pressing a few of them on real
 * hardware shows that the function works; it does not show that each row names
 * the parameter it means to. That is what is checked here, for all of them at
 * once, without a device and without Companion.
 *
 * They run against `dist/`, so `yarn build` has to have happened. That is on
 * purpose: it is the built module Companion loads, and a test that passes
 * against sources the build does not produce would be worth little.
 */

/** A stand-in for the module instance, recording what the actions ask for. */
function stubInstance(config = {}) {
	const writes = []
	const logs = []
	let definitions = {}

	return {
		config: { host: '10.0.0.1', port: 80, pollInterval: 2, readOnly: false, allowGuardedActions: false, ...config },
		writes,
		logs,
		get definitions() {
			return definitions
		},
		log: (level, message) => logs.push({ level, message }),
		setActionDefinitions: (defs) => {
			definitions = defs
		},
		writeParameter: async (name, value, verify) => {
			writes.push({ name, value, verify })
		},
		writeAndConfirm: async (name, value) => {
			writes.push({ name, value, confirmed: true })
			return true
		},
	}
}

function definitionsFor(config) {
	const self = stubInstance(config)
	UpdateActions(self)
	return { self, defs: self.definitions }
}

describe('the control table and the write allowlist agree', () => {
	it('every row names a parameter the allowlist permits, in the right set', () => {
		assert.deepEqual(unlistedControlParameters(SAFE_PARAMETERS, GUARDED_PARAMETERS), [])
	})

	it('no row has drifted from the ids buttons were saved with', () => {
		assert.deepEqual(driftedControlIds(), [])
	})

	it('ids, parameters and variables are each free of duplicates', () => {
		for (const field of ['id', 'actionId', 'parameter']) {
			const seen = CONTROL_SETTINGS.map((s) => s[field])
			assert.equal(new Set(seen).size, seen.length, `duplicate ${field}`)
		}
		const variables = CONTROL_SETTINGS.map((s) => s.variable).filter(Boolean)
		assert.equal(new Set(variables).size, variables.length, 'duplicate variable')
	})

	it('no row offers a value the receiver would see as empty', () => {
		for (const setting of CONTROL_SETTINGS) {
			assert.ok(setting.values.length > 0, `${setting.id} has no values`)
			for (const value of setting.values) {
				assert.equal(value, value.trim(), `${setting.id}: ${JSON.stringify(value)} has stray whitespace`)
				assert.notEqual(value, '', `${setting.id} offers an empty value`)
			}
		}
	})
})

/**
 * What each action writes, written out by hand.
 *
 * The point of this list is that it is *not* derived from `CONTROL_SETTINGS`.
 * The test below drives the actions and compares against the same table they
 * are built from, which proves the wiring but would happily agree with a row
 * that names the wrong parameter. These literals are what the receiver was
 * actually seen to accept on the bench (docs/HARDWARE_TESTS.md), so a typo in
 * the table shows up here as a mismatch rather than as a quiet agreement.
 */
const EXPECTED_PARAMETERS = {
	set_rx_mode: 'DB_L2174_RX_MODE',
	set_bandwidth: 'DB_L2174_CHAN_BW',
	set_guard_interval: 'DB_DEMOD_GUARD_INT',
	set_spectral_polarity: 'DB_DEMOD_SPEC_POL',
	set_channel_enable: 'DB_DEMOD_ENABLE_',
	set_lnb_power: 'DB_L2174_LNB_PWR_',
	set_decoder_source: 'DB_DEMOD_ASI1_OUTPUT_MUX',
	set_asi_output_source: 'DB_DEMOD_ASI2_OUTPUT_MUX',
	set_ip_output_source: 'DB_DEMOD_IP1_OUTPUT_MUX',
	set_demod_diversity: 'DB_L2174_DEMOD_DIVERSITY',
	set_asi_diversity: 'DB_L2174_ASI_DIVERSITY',
	set_diversity_delay: 'DB_DEMOD_DIV_DELAY',
	set_video_input_mode: 'DB_L2174_VIDEO_INPUT_MODE',
	set_genlock: 'DB_DECOD_GEN_LOCK',
	set_freeze_on_loss: 'DB_DECOD_FREEZE_ON_LOSS',
	set_video_output_1: 'DB_DECOD_VIDEO_A_TYPE',
	set_video_output_2: 'DB_DECOD_VIDEO_B_TYPE',
	set_overlay_type: 'DB_DECOD_OVERLAY_TYPE',
	set_overlay_background: 'DB_DECOD_OVERLAY_BACKGROUND',
	// Named ENABLE in the receiver's database, but it is the text colour.
	set_overlay_colour: 'DB_DECOD_OVERLAY_ENABLE',
	set_status_pin_mode: 'DB_STATUS_PIN_MODE',
	set_status_pin_state: 'DB_STATUS_PIN_STATE',
	set_status_pin_alarm_level: 'DB_STATUS_PIN_ALARM_LEVEL',
}

describe('the table names the parameters the receiver answered to', () => {
	it('covers every row, and no row has drifted from what was verified', () => {
		const fromTable = Object.fromEntries(CONTROL_SETTINGS.map((s) => [s.actionId, s.parameter]))
		assert.deepEqual(fromTable, EXPECTED_PARAMETERS)
	})

	it('a per-channel row reaches the channel it was given', () => {
		// Spelled out rather than built, for the same reason as the list above.
		const enable = CONTROL_SETTINGS.find((s) => s.actionId === 'set_channel_enable')
		assert.equal(controlParameter(enable, 3), 'DB_DEMOD_ENABLE_3')
		const lnb = CONTROL_SETTINGS.find((s) => s.actionId === 'set_lnb_power')
		assert.equal(controlParameter(lnb, 4), 'DB_L2174_LNB_PWR_4')
	})
})

describe('each action writes the parameter its row names', () => {
	const { defs } = definitionsFor({ allowGuardedActions: true })

	for (const setting of CONTROL_SETTINGS) {
		it(`${setting.actionId} — every value, the right parameter`, async () => {
			const definition = defs[setting.actionId]
			assert.ok(definition, `${setting.actionId} is not defined`)

			const channels = setting.perChannel ? CONTROL_CHANNELS : [undefined]
			for (const channel of channels) {
				for (const value of setting.values) {
					const self = stubInstance({ allowGuardedActions: true })
					UpdateActions(self)
					const options = setting.perChannel
						? { channel: String(channel), [setting.optionId]: value }
						: { [setting.optionId]: value }

					await self.definitions[setting.actionId].callback({ options })

					assert.deepEqual(
						self.writes,
						[{ name: controlParameter(setting, channel), value, verify: Boolean(setting.variable) }],
						`${setting.actionId} with ${JSON.stringify(options)}`,
					)
				}
			}
		})
	}

	it('refuses a value the receiver does not offer, and says so', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_guard_interval.callback({ options: { value: '1/3' } })

		assert.deepEqual(self.writes, [], 'nothing should have been written')
		assert.match(self.logs.at(-1).message, /does not offer that value/)
	})

	it('refuses a channel the receiver does not have', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_channel_enable.callback({ options: { channel: '5', value: 'On' } })

		assert.deepEqual(self.writes, [])
		assert.match(self.logs.at(-1).message, /channels 1-4/)
	})
})

describe('the actions that are not a choice between fixed values', () => {
	it('frequency goes out with the six decimals the receiver uses', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_frequency.callback({ options: { frequency: 2.325 } })

		// `verify: true` is `write()`'s default — the frequency is read back like
		// any ordinary setting.
		assert.deepEqual(self.writes, [{ name: 'DB_L2174_FREQ1', value: '2.325000', verify: true }])
	})

	it('frequency outside the receiver’s range is clamped, not refused', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_frequency.callback({ options: { frequency: 99 } })

		assert.equal(self.writes.at(0).value, '10.000000')
	})

	it('a frequency that is not a number writes nothing', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_frequency.callback({ options: { frequency: 'zwei' } })

		assert.deepEqual(self.writes, [])
		assert.match(self.logs.at(-1).message, /not a number/)
	})

	it('an empty web ID is refused, because the old one cannot be recovered', async () => {
		const self = stubInstance()
		UpdateActions(self)
		await self.definitions.set_web_id.callback({ options: { text: '   ' } })

		assert.deepEqual(self.writes, [])
		assert.match(self.logs.at(-1).message, /empty web ID/)
	})
})

describe('the two-step preset actions', () => {
	it('confirm the slot before triggering, and pad it to three digits', async () => {
		const self = stubInstance({ allowGuardedActions: true })
		UpdateActions(self)
		await self.definitions.recall_preset.callback({ options: { preset: 7 } })

		assert.deepEqual(self.writes, [
			{ name: 'DB_L2174_PRESET_NUM', value: '007', confirmed: true },
			{ name: 'DB_L2174_PRESET_RECALL', value: 'Yes', verify: false },
		])
	})

	it('do not trigger when the slot was not confirmed', async () => {
		const self = stubInstance({ allowGuardedActions: true })
		self.writeAndConfirm = async (name, value) => {
			self.writes.push({ name, value, confirmed: false })
			return false
		}
		UpdateActions(self)
		await self.definitions.store_preset.callback({ options: { preset: 3 } })

		assert.deepEqual(
			self.writes.map((w) => w.name),
			['DB_L2174_PRESET_NUM'],
			'store must not fire on an unconfirmed slot',
		)
	})

	it('refuse a slot the receiver does not have', async () => {
		const self = stubInstance({ allowGuardedActions: true })
		UpdateActions(self)
		await self.definitions.recall_preset.callback({ options: { preset: 17 } })

		assert.deepEqual(self.writes, [])
	})
})

describe('the two switches decide what exists', () => {
	const guardedIds = ['recall_preset', 'store_preset', 'reboot_receiver', 'set_lnb_power']

	it('guarded actions are absent while the switch is off', () => {
		const { defs } = definitionsFor({ allowGuardedActions: false })
		for (const id of guardedIds) assert.equal(defs[id], undefined, `${id} should not be offered`)
		assert.ok(defs.set_rx_mode, 'the ordinary actions should still be there')
	})

	it('guarded actions appear while it is on', () => {
		const { defs } = definitionsFor({ allowGuardedActions: true })
		for (const id of guardedIds) assert.ok(defs[id], `${id} should be offered`)
	})

	it('read only leaves no action at all, and names every id it removes', () => {
		// Compared against the list the same build produces with writes allowed:
		// the SDK removes an action by being handed `undefined` for its id, so an
		// id that is simply missing here would stay on offer.
		const offered = Object.keys(definitionsFor({ allowGuardedActions: true }).defs)
		const { defs } = definitionsFor({ readOnly: true, allowGuardedActions: true })

		assert.deepEqual(new Set(Object.keys(defs)), new Set(offered), 'every id has to be named to be removed')
		for (const id of Object.keys(defs)) assert.equal(defs[id], undefined, `${id} should be removed under read only`)
	})
})
