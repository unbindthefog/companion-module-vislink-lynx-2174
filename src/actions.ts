import type ModuleInstance from './main.js'
import { guardedActionsEnabled, writesAllowed } from './config.js'
import {
	CONTROL_CHANNELS,
	CONTROL_SETTINGS,
	type ControlSetting,
	SET_ALL_SETTING,
	controlParameter,
} from './controls.js'

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
	set_all_channels: ChoiceOptions
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
function controlAction(
	setting: ControlSetting,
	write: Write,
	warn: (message: string) => void,
	settings: () => Record<string, string | undefined>,
	unconfirmed: (parameter: string) => boolean,
) {
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

			// Said at the moment it happens, not only in a description nobody
			// re-reads: with the receiver's "apply to all" flag on — its shipped
			// state — this reaches every enabled channel, so the press does more
			// than the channel picker above it suggests.
			// Unknown counts as on: the flag is unknown before the first poll,
			// after contact was lost, and — the case that matters — while a
			// press that changed it is still waiting to be read back. Someone
			// who sets "apply to all" to Yes and then presses downconverter
			// power within the poll interval would otherwise get no warning at
			// the one moment it is most deserved. Warning too often costs a
			// line in the log; staying quiet costs voltage on a coax nobody
			// meant to touch.
			// No row means the table lost it; warn as if the flag were on, which
			// is the same direction every other unknown is treated in here.
			const flagPending = SET_ALL_SETTING === undefined || unconfirmed(SET_ALL_SETTING.parameter)
			if (setting.widenedBySetAll && (flagPending || settings().set_all_channels !== 'No')) {
				const known = !flagPending && settings().set_all_channels === 'Yes'
				const reached = CONTROL_CHANNELS.filter((n) => settings()[`channel_enable_${n}`] !== 'Off')
				warn(
					known
						? `Downconverter power follows the receiver's "apply to all": this reaches channel ${reached.join(', ')}`
						: `Downconverter power may follow the receiver's "apply to all" — not read back yet, and the receiver ships with it on, so assume this reaches channel ${reached.join(', ')}`,
				)
			}

			// A row without a variable has nothing to read back. The two whose
			// reading comes and goes with the pin mode do have one — `#poll()`
			// knows to drop their check when they are out of view.
			await write(controlParameter(setting, channel), value, Boolean(setting.variable))
		},
	}
}

export function UpdateActions(self: ModuleInstance): void {
	/**
	 * Every action funnels through here, so logging stays in one place.
	 *
	 * Returns whether the request went out without an error. Note what that is
	 * not: `iframe.php` answers 200 to anything, so this says the receiver was
	 * reached, not that it kept the value. Where that difference matters — the
	 * two-step preset actions — use `selectPresetSlot()` below instead.
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
		definitions[setting.actionId] =
			setting.guarded && !guarded
				? undefined
				: controlAction(
						setting,
						write,
						warn,
						() => self.state.settings,
						(parameter) => self.isUnconfirmed(parameter),
					)
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
						// Two steps, the order the receiver's own interface uses: select
						// the slot, then trigger the recall. The trigger acts on whatever
						// slot is selected, so the first step has to be confirmed — and
						// the pair has to stay together, hence `withPresetSlot`.
						await withPresetSlot(self, action.options.preset, async () => {
							// 'Yes' is a momentary trigger: the receiver acts and drops the
							// parameter back to 'No', so there is nothing to read back.
							await write('DB_L2174_PRESET_RECALL', 'Yes', false)
						})
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
						await withPresetSlot(self, action.options.preset, async () => {
							await write('DB_L2174_PRESET_STORE', 'Yes', false)
						})
					},
				}
			: undefined,

		reboot_receiver: guarded
			? {
					name: 'Reboot receiver (interrupts)',
					description:
						'Restarts the receiver. Measured on the bench: it answers again after about 20 seconds, and reports the configuration it had. How long until it decodes a signal again was not measured — there was none to decode.',
					options: [],
					callback: async () => void (await write('DB_L2174_REBOOT', 'Yes', false)),
				}
			: undefined,
	}

	Object.assign(definitions, handwritten)

	// Read-only empties the list rather than leaving actions that refuse: an
	// action nobody can place is the honest form of "this connection does not
	// write", while one that sits in the list and fails on the press is not.
	//
	// Blanked here rather than skipped above, so that what disappears is exactly
	// what would otherwise have appeared. The SDK removes an action by being
	// handed `undefined` for its id, not by the id being absent, and a second
	// list of ids to keep in step would be one more thing to forget.
	if (!writesAllowed(self)) {
		for (const actionId of Object.keys(definitions)) definitions[actionId] = undefined
	}

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

/**
 * One preset action at a time, per connection.
 *
 * `DB_L2174_PRESET_NUM` is a single device-wide selection, and both preset
 * actions read it, act on it, and leave it where they found it. Two actions
 * overlapping would let the second one move the selection out from under the
 * first — and "store" then overwrites a slot nobody chose, for good. The
 * module's ordinary write queue does not cover this: it serialises per
 * parameter, while the thing that must not interleave here is the *pair*.
 */
const presetBusy = new WeakMap<ModuleInstance, boolean>()

/**
 * Select the slot, run the trigger, and keep other preset actions out meanwhile.
 *
 * A second press while one is running is refused, not queued. Queueing would
 * mean a press landing on the receiver seconds after it was made, by which
 * time the slot it names may no longer be the one anyone is looking at — and
 * for store that is a slot overwritten for good. Refusing costs one press; the
 * operator presses again when the first is through. Said out loud rather than
 * dropped quietly: an action that does nothing and reports nothing is
 * indistinguishable from one that failed.
 */
async function withPresetSlot(self: ModuleInstance, raw: unknown, trigger: () => Promise<void>): Promise<void> {
	if (presetBusy.get(self)) {
		self.log(
			'warn',
			`Ignoring preset ${JSON.stringify(raw)}: another preset action is still running — press again once it is through`,
		)
		return
	}

	presetBusy.set(self, true)
	try {
		if (!(await selectPresetSlot(self, raw))) return
		await trigger()
	} finally {
		presetBusy.set(self, false)
	}
}

/**
 * Select a preset slot and wait until the receiver says it is selected.
 *
 * The second half of both preset actions triggers whatever slot is currently
 * chosen. A write that merely left the building is not enough to know which one
 * that is: the receiver answers 200 and may still be on the old slot, and in
 * the case of store the next step would then overwrite it for good.
 */
async function selectPresetSlot(self: ModuleInstance, raw: unknown): Promise<boolean> {
	const slot = presetSlot(self, raw)
	if (slot === undefined) return false

	try {
		// Compared as a number, not as text. The receiver reported the selected
		// slot zero-padded to three digits on the bench ('001'), and that is what
		// is written — but the whole chain now hangs on the read-back matching,
		// and a receiver that answered '1' would leave both preset actions
		// permanently silent. A number is a number whichever way it is spelled.
		const sameSlot = (reading: string | undefined) =>
			reading !== undefined && reading.trim() !== '' && Number(reading) === Number(slot)
		if (await self.writeAndConfirm('DB_L2174_PRESET_NUM', slot, sameSlot)) return true
	} catch (e) {
		self.log('error', `Could not select preset ${slot}: ${e instanceof Error ? e.message : String(e)}`)
		return false
	}

	// Deliberately not "the receiver selected something else": we do not know
	// that. What we know is that it did not confirm, which a slow re-acquisition
	// can cause just as well as a refusal.
	self.log('warn', `Could not confirm preset slot ${slot} — not triggering anything`)
	return false
}

function presetSlot(self: ModuleInstance, raw: unknown): string | undefined {
	const n = Math.round(Number(raw))
	if (!Number.isFinite(n) || n < 1 || n > 16) {
		self.log('warn', `Ignoring preset ${JSON.stringify(raw)}: the receiver has slots 1-16`)
		return undefined
	}
	return String(n).padStart(3, '0')
}
