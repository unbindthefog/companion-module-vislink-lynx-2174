import type ModuleInstance from './main.js'
import { guardedActionsEnabled } from './config.js'
import { CONTROL_CHANNELS, CONTROL_SETTINGS, type ControlSetting, controlParameter } from './controls.js'

/**
 * What this module will change on the receiver.
 *
 * The device exposes 88 writable parameters through its own web forms — every
 * `send_form`/`send_form_combo` call across its 41 pages — and every one of
 * them is a plain `GET` with no authentication. That makes the question "which
 * of these belong in a Companion button" a safety question rather than a
 * convenience one: a button is pressed by someone mid-show who is looking at a
 * camera, not at a confirmation dialog.
 *
 * Most of what is here is built from `CONTROL_SETTINGS`, the one table that
 * also drives the variables, the "setting is" feedback and the presets. The
 * exceptions below are the ones that are not a choice between fixed values:
 * frequency is a number, the web ID is free text, and preset recall/store and
 * reboot are momentary triggers rather than settings.
 *
 * The interrupting ones — preset recall, preset store, reboot, and the four
 * downconverter supplies — are registered as `undefined` unless the
 * connection's switch is on, so they are absent from the list rather than
 * present and ignored. Restoring defaults, licence entry and key material are
 * refused in `api.ts` whatever the switch says: a reboot comes back, a wiped
 * configuration does not.
 */

type ChoiceOptions = { options: { value: string } }
type ChannelChoiceOptions = { options: { channel: string; value: string } }

export type ActionsSchema = {
	// Hand-written: not a choice between fixed values.
	set_frequency: { options: { frequency: number } }
	set_web_id: { options: { text: string } }
	recall_preset: { options: { preset: number } }
	store_preset: { options: { preset: number } }
	reboot_receiver: { options: Record<string, never> }

	// From CONTROL_SETTINGS. Listed out rather than derived so the ids stay
	// greppable and the option shapes stay checked; `controls.ts` is the source
	// of the values, this is the source of the types.
	set_rx_mode: { options: { mode: string } }
	set_bandwidth: { options: { bandwidth: string } }
	set_decoder_source: { options: { source: string } }
	set_demod_diversity: { options: { state: string } }
	set_guard_interval: ChoiceOptions
	set_spectral_polarity: ChoiceOptions
	set_channel_enable: ChannelChoiceOptions
	set_lnb_power: ChannelChoiceOptions
	set_asi_output_source: ChoiceOptions
	set_ip_output_source: ChoiceOptions
	set_asi_diversity: ChoiceOptions
	set_diversity_delay: ChoiceOptions
	set_video_input_mode: ChoiceOptions
	set_genlock: ChoiceOptions
	set_freeze_on_loss: ChoiceOptions
	set_video_output_1: ChoiceOptions
	set_video_output_2: ChoiceOptions
	set_overlay_type: ChoiceOptions
	set_overlay_background: ChoiceOptions
	set_overlay_colour: ChoiceOptions
	set_status_pin_mode: ChoiceOptions
	set_status_pin_state: ChoiceOptions
	set_status_pin_alarm_level: ChoiceOptions
}

type Write = (name: string, value: string, verify?: boolean) => Promise<boolean>

/**
 * 'Receive mode' -> 'receive mode', but 'ASI output source' is left alone.
 *
 * The labels double as the preset group headings, where they are capitalised;
 * in an action name they sit mid-sentence after "Set". Lowercasing the lot
 * turned ASI and IP into asi and ip.
 */
function lowerFirst(label: string): string {
	const [first] = label.split(' ')
	if (first && first === first.toUpperCase()) return label
	return label.charAt(0).toLowerCase() + label.slice(1)
}

/**
 * One action for one row of `CONTROL_SETTINGS`.
 *
 * Both the dropdown and the check in the callback read the same `values`, so a
 * value the receiver does not accept cannot reach `iframe.php` — which answers
 * 200 to anything and would otherwise swallow a typo silently.
 */
function controlAction(setting: ControlSetting, write: Write, warn: (message: string) => void) {
	const channelOption = {
		type: 'dropdown' as const,
		id: 'channel',
		label: 'Channel',
		default: '1',
		choices: CONTROL_CHANNELS.map((n) => ({ id: String(n), label: `Channel ${n}` })),
	}
	const valueOption = {
		type: 'dropdown' as const,
		id: setting.optionId,
		label: setting.label,
		default: setting.values[0],
		choices: setting.values.map((v) => ({ id: v, label: v })),
	}

	return {
		name: setting.actionName ?? `Set ${lowerFirst(setting.label)}`,
		description: setting.description,
		options: setting.perChannel ? [channelOption, valueOption] : [valueOption],
		callback: async (action: { options: Record<string, unknown> }) => {
			// The dropdown only ever yields a string, but an imported config or the
			// HTTP API can put anything here, and the membership check below is what
			// actually decides — so coerce the primitive cases and let the rest fail
			// that check rather than reaching the receiver as "[object Object]".
			const raw = action.options[setting.optionId]
			const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
			if (!setting.values.includes(value)) {
				warn(`Ignoring ${setting.label} ${JSON.stringify(value)}: the receiver does not offer that value`)
				return
			}

			let channel: number | undefined
			if (setting.perChannel) {
				channel = Number(action.options.channel)
				if (!CONTROL_CHANNELS.some((n) => n === channel)) {
					warn(`Ignoring channel ${JSON.stringify(action.options.channel)}: the receiver has channels 1-4`)
					return
				}
			}

			// Nothing to read back for a parameter the receiver does not publish,
			// so asking for verification would warn on every success.
			await write(controlParameter(setting, channel), value, Boolean(setting.variable))
		},
	}
}

export function UpdateActions(self: ModuleInstance): void {
	/**
	 * Every action funnels through here, so logging stays in one place.
	 *
	 * Returns whether it worked. That matters for the two-step preset actions: a
	 * catch that only logs makes a failure invisible to the caller, and a chain
	 * that carries on regardless would trigger the slot the receiver happens to
	 * have selected — overwriting the wrong preset, in the case of store.
	 */
	const write = async (name: string, value: string, verify = true): Promise<boolean> => {
		try {
			await self.writeParameter(name, value, verify)
			return true
		} catch (e) {
			self.log('error', `Could not set ${name}: ${e instanceof Error ? e.message : String(e)}`)
			return false
		}
	}

	const guarded = guardedActionsEnabled(self)
	const warn = (message: string) => self.log('warn', message)

	// Built in two parts: the rows of CONTROL_SETTINGS, then the handful that are
	// not a choice between fixed values. The cast is where the table's `string`
	// ids meet the schema's literal ones — `unlistedControlParameters()` checks
	// at startup that every row is one the allowlist permits, which is the part
	// that actually matters.
	const definitions: Record<string, unknown> = {}

	for (const setting of CONTROL_SETTINGS) {
		definitions[setting.actionId] = setting.guarded && !guarded ? undefined : controlAction(setting, write, warn)
	}

	// Typed separately from the loop above so the SDK still ties each option id
	// to its entry in ActionsSchema — that check is what catches a field the
	// schema never declared.
	const handwritten: Partial<Parameters<typeof self.setActionDefinitions>[0]> = {
		set_frequency: {
			name: 'Set receive frequency',
			description: 'Retunes the demodulator. The link drops until the transmitter matches.',
			options: [
				{
					type: 'number',
					id: 'frequency',
					label: 'Frequency (GHz)',
					default: 2.325,
					min: 0.0068,
					max: 10,
					step: 0.001,
					clampValues: true,
				},
			],
			callback: async (action) => {
				// The SDK documents min/max as hints only — an imported config, the
				// HTTP API or a cleared field can all deliver something else. And
				// `.toFixed()` on a non-number would throw outside write()'s catch.
				const ghz = Number(action.options.frequency)
				if (!Number.isFinite(ghz)) {
					self.log('warn', `Ignoring frequency ${JSON.stringify(action.options.frequency)}: not a number`)
					return
				}
				// Six decimals is what the receiver's own web form sends.
				await write('DB_L2174_FREQ1', Math.min(10, Math.max(0.0068, ghz)).toFixed(6))
			},
		},

		set_web_id: {
			name: 'Set web ID (display name)',
			description: 'The name shown in the receiver’s own web interface. Harmless, and handy for testing.',
			options: [{ type: 'textinput', id: 'text', label: 'Web ID (must not be empty)', default: '' }],
			callback: async (action) => {
				// An empty value clears the name the receiver shows on every page of
				// its own interface, and the old one is nowhere to be recovered from.
				const text = String(action.options.text ?? '').trim()
				if (!text) {
					self.log('warn', 'Ignoring empty web ID: that would clear the name the receiver displays')
					return
				}
				await write('DB_L2174_WEB_TEXT', text)
			},
		},

		// Present but undefined while the switch is off — Companion then leaves
		// them out of the action list entirely, so they cannot be hit by accident
		// on a receiver that is on air. api.ts refuses them regardless, in case the
		// switch flips between the press and the request.
		recall_preset: guarded
			? {
					name: 'Recall preset (interrupts)',
					description:
						'Loads a stored configuration — frequency, bandwidth, mode and routing all change at once, and the link drops while the receiver re-acquires.',
					options: [presetNumber()],
					callback: async (action) => {
						const slot = presetSlot(self, action.options.preset)
						if (slot === undefined) return
						// Two steps, the order the receiver's own interface uses: select
						// the slot, then trigger the recall.
						if (!(await write('DB_L2174_PRESET_NUM', slot))) return
						// 'Yes' is a momentary trigger: the receiver acts and drops the
						// parameter back to 'No', so there is nothing to read back.
						await write('DB_L2174_PRESET_RECALL', 'Yes', false)
					},
				}
			: undefined,

		store_preset: guarded
			? {
					name: 'Store preset (overwrites)',
					description:
						'Overwrites the chosen slot with the receiver\u2019s current settings. The previous contents are gone.',
					options: [presetNumber()],
					callback: async (action) => {
						const slot = presetSlot(self, action.options.preset)
						if (slot === undefined) return
						if (!(await write('DB_L2174_PRESET_NUM', slot))) return
						await write('DB_L2174_PRESET_STORE', 'Yes', false)
					},
				}
			: undefined,

		reboot_receiver: guarded
			? {
					name: 'Reboot receiver (off air ~1 min)',
					description: 'Restarts the receiver. It stops decoding until it is back.',
					options: [],
					callback: async () => void (await write('DB_L2174_REBOOT', 'Yes', false)),
				}
			: undefined,
	}

	Object.assign(definitions, handwritten)
	self.setActionDefinitions(definitions as Parameters<typeof self.setActionDefinitions>[0])
}

/** Preset slots the receiver offers, per settings.xml: 1-16. */
function presetNumber() {
	return {
		type: 'number' as const,
		id: 'preset' as const,
		label: 'Preset',
		default: 1,
		min: 1,
		max: 16,
		step: 1,
		clampValues: true,
	}
}

function presetSlot(self: ModuleInstance, raw: unknown): string | undefined {
	const n = Math.round(Number(raw))
	if (!Number.isFinite(n) || n < 1 || n > 16) {
		self.log('warn', `Ignoring preset ${JSON.stringify(raw)}: the receiver has slots 1-16`)
		return undefined
	}
	return String(n).padStart(3, '0')
}
