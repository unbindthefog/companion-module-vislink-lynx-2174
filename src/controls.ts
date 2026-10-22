/**
 * Every setting on this receiver that is a choice between fixed values.
 *
 * One table, four consumers: `actions.ts` registers an action per row,
 * `variables.ts` publishes the reading, `feedbacks.ts` offers the row in the
 * "setting is" dropdown, and `presets.ts` builds one button per value. Before
 * this existed each of those kept its own copy of the value lists, and they
 * drifted.
 *
 * What is deliberately *not* derived from here is the allowlist in `api.ts`.
 * That is the boundary deciding what this module may write at all, and it stays
 * a hand-written literal: a table whose job is to describe buttons must not be
 * able to widen it. The two are checked against each other by
 * `unlistedControlParameters()` below, which runs at startup — a row with no
 * entry in the allowlist is a mistake, and the right place to find out is the
 * log, not a button press mid-show.
 *
 * Values come from the device's own `settings.xml`, read on the bench unit
 * (10.81.5.149, "Rx Relais", V1039), and they are the full sets rather than a
 * snapshot of what was selectable at the time.
 *
 * `enabled="no"` turned out to mean less than it looks. It marks what the web
 * interface offers right now, not what the receiver refuses: in LMST(S) the
 * bandwidth list showed only 6/7/8 MHz, and the receiver accepted 10 MHz
 * anyway — it just took 17 seconds to say so. The one thing it does refuse is
 * a value that is not a value at all; `Banane` for a two-option parameter was
 * dropped silently, which is what the read-back check is there to catch.
 */

import type { ActionsSchema } from './actions.js'

/** Which preset section a control belongs to, and what that section is called. */
export const CONTROL_SECTIONS = {
	rf: { name: 'Control — RF', description: 'What the receiver listens to and on which channels.' },
	routing: { name: 'Control — Routing', description: 'Where each output takes its transport stream from.' },
	video: { name: 'Control — Video', description: 'How the decoder presents what it receives.' },
	unit: { name: 'Control — Unit', description: 'The receiver itself: status pin, presets, reboot.' },
} as const

export type ControlSection = keyof typeof CONTROL_SECTIONS

export type ControlSetting = {
	/**
	 * Short id. Used for the preset ids, the variable, and the feedback dropdown.
	 *
	 * Saved buttons hold this, so it is a public surface: rename one and every
	 * button carrying that feedback quietly stops matching. Same for `actionId`
	 * and `optionId`.
	 */
	id: string
	/** The action that writes it. Existing ids are kept as they are — buttons hold them. */
	actionId: string
	/** The key the action's own option uses. Newer actions all use `value`. */
	optionId: string
	/** The `data.xml` / `iframe.php` parameter, or its pattern for a per-channel one. */
	parameter: string
	/** The module variable mirroring it. Empty when the receiver does not report it. */
	variable: string
	/** Label for the action and for the preset group. */
	label: string
	/** First line on the button. `{n}` is replaced by the channel number. */
	caption: string
	/** Everything the receiver accepts, not only what is selectable right now. */
	values: readonly string[]
	section: ControlSection
	keywords: readonly string[]
	/** One action with a channel picker, and `_1`…`_4` appended to the parameter. */
	perChannel?: boolean
	/** Only offered while the connection's interrupting-actions switch is on. */
	guarded?: boolean
	/**
	 * The receiver's `DB_L2174_SET_ALL` flag widens this one past the channel
	 * the button names. Carried on the row rather than matched by id in the
	 * action builder, so a rename cannot drop the warning in silence.
	 */
	widenedBySetAll?: boolean
	/** Shown under the action's name in Companion. */
	description?: string
	/** Overrides the generated "Set <label>" action name. */
	actionName?: string
}

export const CONTROL_SETTINGS: readonly ControlSetting[] = [
	// ---- RF ------------------------------------------------------------
	{
		id: 'mode',
		actionId: 'set_rx_mode',
		optionId: 'mode',
		parameter: 'DB_L2174_RX_MODE',
		// Deliberately the unit's own setting and not the demodulator's readout:
		// the two spell the same mode differently ('DVBT' against 'DVB-T'), and a
		// button must match what it itself writes.
		variable: 'rx_mode',
		label: 'Receive mode',
		caption: 'MODE',
		values: ['DVBT', 'LMST(S)', 'LMST(D)'],
		section: 'rf',
		keywords: ['mode', 'dvbt', 'lmst', 'receive'],
		description: 'DVB-T or the Vislink LMS-T modes. Changing this re-acquires the signal.',
	},
	{
		id: 'bandwidth',
		actionId: 'set_bandwidth',
		optionId: 'bandwidth',
		parameter: 'DB_L2174_CHAN_BW',
		variable: 'rf_bandwidth',
		label: 'Channel bandwidth',
		caption: 'BW',
		values: ['2MHz', '3MHz', '4MHz', '5MHz', '6MHz', '7MHz', '8MHz', '10MHz', '12MHz', 'Auto'],
		section: 'rf',
		keywords: ['bandwidth', 'channel', 'mhz'],
		description: 'Auto lets a DVB-T signal declare its own bandwidth; the LMS-T modes need it set.',
	},
	{
		id: 'guard_interval',
		actionId: 'set_guard_interval',
		optionId: 'value',
		parameter: 'DB_DEMOD_GUARD_INT',
		variable: 'rf_guard_interval',
		label: 'Guard interval',
		caption: 'GUARD',
		values: ['1/32', '1/16', '1/8', '1/4', 'Auto'],
		section: 'rf',
		keywords: ['guard', 'interval', 'ofdm'],
		description: 'Auto lets the receiver read it from the TPS; fixing it shortens acquisition.',
	},
	{
		id: 'polarity',
		actionId: 'set_spectral_polarity',
		optionId: 'value',
		parameter: 'DB_DEMOD_SPEC_POL',
		variable: 'spectral_polarity',
		label: 'Spectral polarity',
		caption: 'POL',
		values: ['Normal', 'Inverted', 'Auto'],
		section: 'rf',
		keywords: ['polarity', 'spectrum', 'inverted'],
	},
	{
		id: 'channel_enable',
		actionId: 'set_channel_enable',
		optionId: 'value',
		parameter: 'DB_DEMOD_ENABLE_',
		variable: 'channel{n}_enabled',
		label: 'Channel enable',
		caption: 'RF{n}',
		values: ['Off', 'On'],
		section: 'rf',
		keywords: ['channel', 'enable', 'diversity', 'antenna'],
		perChannel: true,
		description: 'Takes one diversity input in or out of the combination.',
	},
	{
		id: 'lnb_power',
		actionId: 'set_lnb_power',
		optionId: 'value',
		parameter: 'DB_L2174_LNB_PWR_',
		variable: 'channel{n}_lnb_power',
		label: 'Downconverter power',
		caption: 'LNB{n}',
		values: ['Off', 'On'],
		section: 'rf',
		keywords: ['lnb', 'downconverter', 'power', 'dc', 'antenna'],
		perChannel: true,
		guarded: true,
		widenedBySetAll: true,
		actionName: 'Set downconverter power (feeds DC up the coax)',
		description:
			'Puts DC on an antenna input to feed a downconverter, and whatever is on the far end of that coax gets it — which is why this sits behind the switch. While "Apply channel settings to all" is Yes, as this receiver shipped, it reaches every enabled channel and not only the one chosen here.',
	},

	{
		id: 'set_all_channels',
		actionId: 'set_all_channels',
		optionId: 'value',
		parameter: 'DB_L2174_SET_ALL',
		variable: 'set_all_channels',
		label: 'Apply channel settings to all',
		caption: 'SETALL',
		values: ['No', 'Yes'],
		section: 'rf',
		keywords: ['all', 'channels', 'downconverter', 'together'],
		actionName: 'Apply channel settings to all',
		description:
			'While this is Yes, setting a downconverter value on one channel sets it on every *enabled* channel — including the supply voltage. The bench unit shipped with it on.',
	},

	// ---- Routing -------------------------------------------------------
	{
		// 'source', not 'decoder_source': buttons saved before the other routing
		// controls existed hold this id in their `setting_is` feedback.
		id: 'source',
		actionId: 'set_decoder_source',
		optionId: 'source',
		parameter: 'DB_DEMOD_ASI1_OUTPUT_MUX',
		variable: 'decoder_source',
		label: 'Decoder source',
		caption: 'SRC',
		values: ['Ext ASI', 'Demodulator', 'Diversity', 'IP'],
		section: 'routing',
		keywords: ['decoder', 'source', 'input', 'asi', 'routing'],
		description: 'Which input the decoder takes its transport stream from.',
	},
	{
		id: 'asi_output_source',
		actionId: 'set_asi_output_source',
		optionId: 'value',
		parameter: 'DB_DEMOD_ASI2_OUTPUT_MUX',
		variable: 'asi_output_source',
		label: 'ASI output source',
		caption: 'ASI',
		values: ['Ext ASI', 'Demodulator', 'Diversity', 'IP'],
		section: 'routing',
		keywords: ['asi', 'output', 'routing'],
	},
	{
		id: 'ip_output_source',
		actionId: 'set_ip_output_source',
		optionId: 'value',
		parameter: 'DB_DEMOD_IP1_OUTPUT_MUX',
		variable: 'ip_output_source',
		label: 'IP output source',
		caption: 'IPOUT',
		values: ['Ext ASI', 'Demodulator', 'Diversity', 'Off'],
		section: 'routing',
		keywords: ['ip', 'output', 'routing', 'stream'],
	},
	{
		id: 'diversity',
		actionId: 'set_demod_diversity',
		optionId: 'state',
		parameter: 'DB_L2174_DEMOD_DIVERSITY',
		variable: 'demod_diversity',
		label: 'Demodulator diversity',
		caption: 'DIV',
		values: ['Off', 'On'],
		section: 'routing',
		keywords: ['diversity', 'demodulator'],
	},
	{
		id: 'asi_diversity',
		actionId: 'set_asi_diversity',
		optionId: 'value',
		parameter: 'DB_L2174_ASI_DIVERSITY',
		variable: 'asi_diversity',
		label: 'ASI diversity input',
		caption: 'ASIDIV',
		values: ['Off', 'On'],
		section: 'routing',
		keywords: ['diversity', 'asi'],
		description: 'Whether the external ASI input joins the diversity combination.',
	},
	{
		id: 'diversity_delay',
		actionId: 'set_diversity_delay',
		optionId: 'value',
		parameter: 'DB_DEMOD_DIV_DELAY',
		variable: 'diversity_delay',
		label: 'Diversity delay',
		caption: 'DELAY',
		values: ['Off', 'Auto'],
		section: 'routing',
		keywords: ['diversity', 'delay', 'alignment'],
		description: 'Auto lines up inputs that arrive at different times, e.g. over different path lengths.',
	},

	// ---- Video ---------------------------------------------------------
	{
		id: 'video_input_mode',
		actionId: 'set_video_input_mode',
		optionId: 'value',
		parameter: 'DB_L2174_VIDEO_INPUT_MODE',
		variable: 'video_input_mode',
		label: 'Video input mode',
		caption: 'VIN',
		values: ['SD MPEG2 LD', 'HD MPEG2 LD', 'H264', 'MPEG2'],
		section: 'video',
		keywords: ['video', 'codec', 'mpeg2', 'h264', 'input'],
		description: 'Which codec the decoder expects. The wrong one gives no picture, not a bad one.',
	},
	{
		id: 'genlock',
		actionId: 'set_genlock',
		optionId: 'value',
		parameter: 'DB_DECOD_GEN_LOCK',
		variable: 'genlock',
		label: 'Frame lock (genlock)',
		caption: 'GENLK',
		values: ['Off', 'SD', 'HD'],
		section: 'video',
		keywords: ['genlock', 'frame', 'lock', 'reference', 'sync'],
		description: 'Locks the output to the house reference. `genlock_error` says whether it took.',
	},
	{
		id: 'freeze_on_loss',
		actionId: 'set_freeze_on_loss',
		optionId: 'value',
		parameter: 'DB_DECOD_FREEZE_ON_LOSS',
		variable: 'freeze_on_loss',
		label: 'On signal loss',
		caption: 'LOSS',
		values: ['Freeze', 'Blue'],
		section: 'video',
		keywords: ['freeze', 'loss', 'blue', 'dropout'],
		description: 'What the output shows when the link drops: the last frame, or blue.',
	},
	{
		id: 'video_output_1',
		actionId: 'set_video_output_1',
		optionId: 'value',
		parameter: 'DB_DECOD_VIDEO_A_TYPE',
		variable: 'video_output_1',
		label: 'Video output 1 format',
		caption: 'OUT1',
		// Same four as output 2. `settings.xml` marks the composite pair
		// `enabled="no"` here, and the first reading of that was "this unit is
		// not fitted for it" — but the receiver accepts the write and reports
		// `Composite` back (bench, 22.10.2026), so `enabled` is what the web
		// interface offers, not what the device refuses. Whether a picture
		// actually leaves the connector is open; see docs/HARDWARE_TESTS.md.
		values: ['SDI', 'SDI+Overlay', 'Composite', 'Comp+Overlay'],
		section: 'video',
		keywords: ['output', 'sdi', 'overlay'],
	},
	{
		id: 'video_output_2',
		actionId: 'set_video_output_2',
		optionId: 'value',
		parameter: 'DB_DECOD_VIDEO_B_TYPE',
		variable: 'video_output_2',
		label: 'Video output 2 format',
		caption: 'OUT2',
		values: ['SDI', 'SDI+Overlay', 'Composite', 'Comp+Overlay'],
		section: 'video',
		keywords: ['output', 'sdi', 'composite', 'overlay'],
	},

	{
		id: 'overlay_type',
		actionId: 'set_overlay_type',
		optionId: 'value',
		parameter: 'DB_DECOD_OVERLAY_TYPE',
		variable: 'overlay_type',
		label: 'Overlay type',
		caption: 'OVL',
		// 'Spectra' and 'Status' are listed but disabled on this unit, and unlike
		// the bandwidths that is not a consequence of the current mode — they are
		// overlay modes it does not have. A button that can never take is worse
		// than no button.
		values: ['Basic', 'Service'],
		section: 'video',
		keywords: ['overlay', 'burn-in', 'osd'],
		description: 'Only visible on an output set to "+Overlay".',
	},
	{
		id: 'overlay_background',
		actionId: 'set_overlay_background',
		optionId: 'value',
		parameter: 'DB_DECOD_OVERLAY_BACKGROUND',
		variable: 'overlay_background',
		label: 'Overlay background',
		caption: 'OVLBG',
		values: ['Off', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'],
		section: 'video',
		keywords: ['overlay', 'background', 'opacity'],
		description: 'How solid the strip behind the overlay text is, in percent, or Off for none.',
	},
	{
		id: 'overlay_colour',
		actionId: 'set_overlay_colour',
		optionId: 'value',
		// Named ENABLE in the receiver's database, but it is the text colour —
		// the GUI labels it "Overlay Colour" and it has no off position.
		parameter: 'DB_DECOD_OVERLAY_ENABLE',
		variable: 'overlay_colour',
		label: 'Overlay colour',
		caption: 'OVLCOL',
		values: ['White', 'Green'],
		section: 'video',
		keywords: ['overlay', 'colour', 'color', 'white', 'green'],
	},

	// ---- Unit ----------------------------------------------------------
	{
		id: 'status_pin_mode',
		actionId: 'set_status_pin_mode',
		optionId: 'value',
		parameter: 'DB_STATUS_PIN_MODE',
		variable: 'status_pin_mode',
		label: 'Status pin mode',
		caption: 'PIN',
		values: ['Alarm', 'Manual'],
		section: 'unit',
		keywords: ['status', 'pin', 'gpio', 'tally', 'alarm'],
		description: 'Whether the status pin follows the alarm state or is driven by hand.',
	},
	{
		id: 'status_pin_state',
		actionId: 'set_status_pin_state',
		optionId: 'value',
		// Published only while the pin mode is Manual — the receiver swaps this
		// and `DB_STATUS_PIN_ALARM_LEVEL` in and out of data.xml depending on the
		// mode, so each is readable exactly when it is the one in effect. The
		// write is accepted either way; it is the reading that comes and goes.
		parameter: 'DB_STATUS_PIN_STATE',
		variable: 'status_pin_state',
		label: 'Status pin state (manual mode)',
		caption: 'PINSET',
		values: ['High', 'Low'],
		section: 'unit',
		keywords: ['status', 'pin', 'gpio', 'tally', 'high', 'low'],
		description:
			'Drives the pin directly. Only has an effect — and is only readable back — while the pin mode is Manual.',
	},
	{
		id: 'status_pin_alarm_level',
		actionId: 'set_status_pin_alarm_level',
		optionId: 'value',
		parameter: 'DB_STATUS_PIN_ALARM_LEVEL',
		variable: 'status_pin_alarm_level',
		label: 'Status pin level when alarmed',
		caption: 'PINALM',
		values: ['High', 'Low'],
		section: 'unit',
		keywords: ['status', 'pin', 'gpio', 'alarm', 'polarity'],
		description: 'Readable only while the pin mode is Alarm; the write is taken in either mode.',
	},
]

/** The four RF/diversity channels, for the per-channel rows above. */
export const CONTROL_CHANNELS = [1, 2, 3, 4] as const

/** `DB_DEMOD_ENABLE_` + 3 → `DB_DEMOD_ENABLE_3`; plain parameters pass through. */
export function controlParameter(setting: ControlSetting, channel?: number): string {
	return setting.perChannel ? `${setting.parameter}${channel}` : setting.parameter
}

/** `channel{n}_enabled` + 3 → `channel3_enabled`. Empty stays empty. */
export function controlVariable(setting: ControlSetting, channel?: number): string {
	if (!setting.variable) return ''
	return setting.perChannel ? setting.variable.replace('{n}', String(channel)) : setting.variable
}

/** The id a feedback or preset uses: `lnb_power_3`, or just `bandwidth`. */
export function controlSettingId(setting: ControlSetting, channel?: number): string {
	return setting.perChannel ? `${setting.id}_${channel}` : setting.id
}

/** Every parameter this table would write, per-channel rows expanded. */
export function controlParameters(): string[] {
	return CONTROL_SETTINGS.flatMap((setting) =>
		setting.perChannel ? CONTROL_CHANNELS.map((n) => controlParameter(setting, n)) : [setting.parameter],
	)
}

/**
 * Where this table and the allowlist disagree. Should always be empty.
 *
 * Checked at startup rather than trusted, because the two are maintained by
 * hand on purpose. Three ways to disagree, all of them quiet:
 *
 *   - a parameter in neither set — the action looks fine until someone presses
 *     it, and then `api.ts` refuses it;
 *   - a `guarded` row whose parameter sits in SAFE — the switch would then be
 *     the only thing in its way, and the switch is a UI, not a boundary;
 *   - an unguarded row whose parameter sits in GUARDED — offered freely,
 *     refused on the press whenever the switch happens to be off.
 */
export function unlistedControlParameters(allowed: ReadonlySet<string>, guarded: ReadonlySet<string>): string[] {
	const problems: string[] = []

	for (const setting of CONTROL_SETTINGS) {
		const channels = setting.perChannel ? CONTROL_CHANNELS : [undefined]
		for (const n of channels) {
			const parameter = controlParameter(setting, n)
			const expected = setting.guarded ? guarded : allowed
			const other = setting.guarded ? allowed : guarded

			if (expected.has(parameter)) {
				// Being in the right set is not enough. `api.ts` tests SAFE first and
				// skips the guarded branch entirely on a hit, so a parameter in both
				// sets is a parameter with no guard — and two hand-kept lists make
				// that an easy slip to make and an invisible one to have made.
				if (setting.guarded && other.has(parameter)) {
					problems.push(`${parameter} (guarded, but also always writable — the switch would not hold it back)`)
				}
				continue
			}

			problems.push(
				other.has(parameter)
					? `${parameter} (listed as ${setting.guarded ? 'always writable' : 'guarded'}, but the table says the opposite)`
					: `${parameter} (not in the allowlist at all)`,
			)
		}
	}

	return problems
}

/**
 * The three ids each generated row published to buttons, written out by hand.
 *
 * `actions.ts` casts away the SDK's type binding for the generated actions, so
 * nothing would otherwise catch an id that drifted from the one saved buttons
 * hold. The keys are typed against the schema, so a mistyped action id is a
 * compile error; `main.ts` checks the values against the table at startup, so a
 * renamed option or setting is a line in the log rather than a button that
 * quietly stops working.
 *
 * Changing an entry here is not a fix — it is a decision to break the buttons
 * that already carry the old id, and it wants an upgrade script.
 */
export const PUBLISHED_IDS: Partial<Record<keyof ActionsSchema, { option: string; setting: string }>> = {
	set_rx_mode: { option: 'mode', setting: 'mode' },
	set_bandwidth: { option: 'bandwidth', setting: 'bandwidth' },
	set_decoder_source: { option: 'source', setting: 'source' },
	set_demod_diversity: { option: 'state', setting: 'diversity' },
	set_guard_interval: { option: 'value', setting: 'guard_interval' },
	set_spectral_polarity: { option: 'value', setting: 'polarity' },
	set_channel_enable: { option: 'value', setting: 'channel_enable' },
	set_lnb_power: { option: 'value', setting: 'lnb_power' },
	set_asi_output_source: { option: 'value', setting: 'asi_output_source' },
	set_ip_output_source: { option: 'value', setting: 'ip_output_source' },
	set_asi_diversity: { option: 'value', setting: 'asi_diversity' },
	set_diversity_delay: { option: 'value', setting: 'diversity_delay' },
	set_video_input_mode: { option: 'value', setting: 'video_input_mode' },
	set_genlock: { option: 'value', setting: 'genlock' },
	set_freeze_on_loss: { option: 'value', setting: 'freeze_on_loss' },
	set_video_output_1: { option: 'value', setting: 'video_output_1' },
	set_video_output_2: { option: 'value', setting: 'video_output_2' },
	set_overlay_type: { option: 'value', setting: 'overlay_type' },
	set_overlay_background: { option: 'value', setting: 'overlay_background' },
	set_overlay_colour: { option: 'value', setting: 'overlay_colour' },
	set_all_channels: { option: 'value', setting: 'set_all_channels' },
	set_status_pin_mode: { option: 'value', setting: 'status_pin_mode' },
	set_status_pin_state: { option: 'value', setting: 'status_pin_state' },
	set_status_pin_alarm_level: { option: 'value', setting: 'status_pin_alarm_level' },
}

/** Rows whose ids have drifted from what buttons were saved with. */
export function driftedControlIds(): string[] {
	const problems: string[] = []

	for (const setting of CONTROL_SETTINGS) {
		const published = PUBLISHED_IDS[setting.actionId as keyof ActionsSchema]
		if (published === undefined) {
			problems.push(
				`${setting.actionId} (not in PUBLISHED_IDS — add it there, or it is a rename that needs an upgrade script)`,
			)
			continue
		}
		if (published.option !== setting.optionId) {
			problems.push(`${setting.actionId} (option is now "${setting.optionId}", buttons hold "${published.option}")`)
		}
		if (published.setting !== setting.id) {
			problems.push(`${setting.actionId} (setting is now "${setting.id}", buttons hold "${published.setting}")`)
		}
	}

	for (const actionId of Object.keys(PUBLISHED_IDS)) {
		if (!CONTROL_SETTINGS.some((setting) => setting.actionId === actionId)) {
			problems.push(`${actionId} (no longer in the table; saved buttons still carry it)`)
		}
	}

	return problems
}

/**
 * What the "setting is" feedback can compare against: one entry per control
 * that the receiver actually reports back, per-channel rows expanded.
 *
 * A row with no `variable` is left out on purpose: there is nothing to match
 * against, and a dropdown entry that can never go green is worse than none at
 * all. Today every row has one — the trigger-style settings are not in this
 * table to begin with.
 */
/**
 * Readable settings that no action sets, but a hand-built feedback may still
 * want to match on. The recall buttons deliberately carry no green of their
 * own — the receiver only reports which slot is *selected* — but the reading
 * exists, so anyone who wants that comparison can still have it.
 */
const MATCH_ONLY_SOURCES = [{ id: 'preset', label: 'Selected preset slot', variable: 'preset_slot' }]

export const SETTING_SOURCES: readonly { id: string; label: string; variable: string }[] = [
	...MATCH_ONLY_SOURCES,
	...CONTROL_SETTINGS.flatMap((setting) => {
		if (!setting.variable) return []
		if (!setting.perChannel) return [{ id: setting.id, label: setting.label, variable: setting.variable }]
		return CONTROL_CHANNELS.map((n) => ({
			id: controlSettingId(setting, n),
			label: `${setting.label} — channel ${n}`,
			variable: controlVariable(setting, n),
		}))
	}),
]

/** Ids are built from the table at runtime, so this cannot be a union of literals. */
export type SettingId = string
