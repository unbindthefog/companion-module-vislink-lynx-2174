import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { ALARM_STYLE, DESTRUCTIVE_STYLE, OK_STYLE, READOUT_STYLE, UNKNOWN_STYLE, WARNING_STYLE } from './feedbacks.js'
import { CHANNEL_IDS, type SettingId } from './types.js'
import { guardedActionsEnabled, writesAllowed } from './config.js'
import {
	CONTROL_CHANNELS,
	CONTROL_SECTIONS,
	CONTROL_SETTINGS,
	type ControlSection,
	type ControlSetting,
	controlSettingId,
} from './controls.js'

type Presets = CompanionPresetDefinitions<ModuleSchema>
type Sections = CompanionPresetSection<ModuleSchema>[]
type PresetFeedback = NonNullable<Presets[string]>['feedbacks'][number]

/**
 * Placeholder prefix for this connection's own variables. Companion rewrites
 * whatever prefix a preset uses to the label the user gave the connection, so
 * this only has to be readable — it never reaches a button as-is.
 */
const SELF = 'lynx2174'

/** Two lines: a fixed caption, then the live reading underneath. */
function readout(caption: string, variable: string, suffix = ''): string {
	return `${caption}\n$(${SELF}:${variable})${suffix}`
}

/** A monitoring button: no actions, just a style and some feedbacks. */
function monitorPreset(preset: Omit<NonNullable<Presets[string]>, 'type' | 'steps'>): NonNullable<Presets[string]> {
	return { type: 'simple', steps: [{ down: [], up: [] }], ...preset }
}

type PresetAction = NonNullable<Presets[string]>['steps'][number]['down'][number]

/**
 * The action a control button carries.
 *
 * The cast is the seam between the table's plain strings and the schema's
 * literal action and option ids. It is checked where it can be: `actions.ts`
 * registers every row of the same table under that same `actionId` and reads
 * that same `optionId`, so the pair cannot disagree without the action
 * disappearing too.
 */
function controlPresetAction(setting: ControlSetting, channel: number | undefined, value: string): PresetAction {
	const options = setting.perChannel
		? { channel: String(channel), [setting.optionId]: value }
		: { [setting.optionId]: value }
	return { actionId: setting.actionId, options } as unknown as PresetAction
}

/**
 * A preset id built from a device value, e.g. 'LMST(S)' -> 'lmst_s'.
 *
 * The values double as display text, and an id taken from them straight would
 * carry spaces and brackets and would quietly change if a label ever did.
 */
function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')
}

/**
 * A control button: it sets one value, and shows whether that value is already
 * the one in force.
 *
 * Black while the receiver is on something else, green once it matches — so the
 * button reads as a state, not just as a thing it would do. The grey cover goes
 * last, because "we are not in contact" must not look like "not selected".
 */
function controlPreset(args: {
	name: string
	keywords: string[]
	caption: string
	value: string
	setting: SettingId | undefined
	action: PresetAction
}): NonNullable<Presets[string]> {
	return {
		type: 'simple',
		name: args.name,
		keywords: args.keywords,
		// 'Demodulator' and 'Diversity' do not fit a button at 14pt; 'LMST(S)' and
		// 'Ext ASI' do, which is where the cut-off sits. A clipped value is worse
		// than a small one — the value is the whole point of the button.
		style: { ...READOUT_STYLE, text: `${args.caption}\n${args.value}`, size: args.value.length > 7 ? '7' : '14' },
		feedbacks: [
			...(args.setting
				? [
						{
							feedbackId: 'setting_is' as const,
							options: { setting: args.setting, value: args.value },
							style: OK_STYLE,
							headline: 'Selected — green',
						},
					]
				: []),
			unknownCover('unit'),
		],
		steps: [{ down: [args.action], up: [] }],
	}
}

/**
 * Input power zones, in dBm. Unlike MER this is a window: the front end
 * overloads near 0 dBm, so a level that is too high loses lock just like one
 * that is too low. Preset defaults only — every button keeps its own editable
 * thresholds. The low end (-70 warning, -80 alarm) is a settled choice, a few
 * dB above the ~-83 dBm practical cliff for 16QAM 2/3. The high end is still an
 * assumption: nobody in this class publishes a compression point. The workings,
 * with sources, are in docs/RF_LEVELS.md.
 */
const POWER_ZONES = { highAlarm: -1, highWarning: -6, lowWarning: -70, lowAlarm: -80 }

/**
 * MER zones for the per-channel traffic light: above `warning` the link has
 * margin, below `alarm` it is close to dropping out — 16 dB sits just above the
 * 15.3 dB that 16QAM 2/3 needs under Rayleigh conditions, i.e. a moving camera
 * (see docs/RF_LEVELS.md). Preset defaults only — every button keeps its own
 * editable threshold.
 */
const MER_ZONES = { warning: 22, alarm: 16 }

const TEMPERATURE_SENSORS = [
	{ id: 'unit', caption: 'TEMP UNIT', variable: 'unit_temperature' },
	{ id: 'demod', caption: 'TEMP DEMOD', variable: 'demod_fpga_temperature' },
	{ id: 'decoder', caption: 'TEMP DEC', variable: 'decoder_fpga_temperature' },
] as const

/**
 * The grey cover every monitoring button ends with.
 *
 * Last in the list, so it wins over whatever the thresholds below decided: a
 * reading we do not have must not read as a reading that is fine, and must not
 * read as a fault either. `source` is 'unit' for anything the receiver reports
 * about itself, or a channel number where "nothing to measure" also counts as
 * not knowing.
 */
function unknownCover(source: string): PresetFeedback {
	return { feedbackId: 'reading_unknown', options: { source }, style: UNKNOWN_STYLE, headline: 'Unknown — grey' }
}

export function UpdatePresets(self: ModuleInstance): void {
	const presets: Presets = {}

	for (const n of CHANNEL_IDS) {
		// Lock: healthy is green, so the base style carries the alarm colour and
		// the feedback paints over it once the channel actually locks.
		presets[`channel_${n}_lock`] = monitorPreset({
			name: `Channel ${n} — RF lock`,
			keywords: ['rf', 'lock', 'channel', `${n}`],
			style: { ...ALARM_STYLE, text: readout(`RF${n}`, `channel${n}_lock`), size: '14' },
			feedbacks: [{ feedbackId: 'channel_locked', options: { channel: n }, style: OK_STYLE }, unknownCover(String(n))],
		})

		// Input power fails at both ends: too little signal and the demodulator
		// starves, too much and the front end compresses, which kills lock just
		// as thoroughly. So this traffic light is a window rather than a floor —
		// four feedbacks, loosest first, because the last match wins.
		presets[`channel_${n}_power`] = monitorPreset({
			name: `Channel ${n} — input power (traffic light)`,
			keywords: ['rf', 'power', 'level', 'dbm', 'overload', 'channel', `${n}`],
			style: { ...OK_STYLE, text: readout(`RF${n} PWR`, `channel${n}_power`), size: '14' },
			feedbacks: [
				{
					feedbackId: 'power_threshold',
					options: { channel: String(n), direction: 'below', threshold: POWER_ZONES.lowWarning },
					style: WARNING_STYLE,
					headline: 'Getting weak',
				},
				{
					feedbackId: 'power_threshold',
					options: { channel: String(n), direction: 'below', threshold: POWER_ZONES.lowAlarm },
					style: ALARM_STYLE,
					headline: 'Too little signal',
				},
				{
					feedbackId: 'power_threshold',
					options: { channel: String(n), direction: 'above', threshold: POWER_ZONES.highWarning },
					style: WARNING_STYLE,
					headline: 'Getting hot',
				},
				{
					feedbackId: 'power_threshold',
					options: { channel: String(n), direction: 'above', threshold: POWER_ZONES.highAlarm },
					style: ALARM_STYLE,
					headline: 'Overloading the input',
				},
				unknownCover(String(n)),
			],
		})

		// Traffic light, same shape as the camera battery: healthy is green, and
		// the two thresholds paint over it as the link degrades. Warning first,
		// alarm second, so the lower threshold wins once both apply.
		presets[`channel_${n}_mer`] = monitorPreset({
			name: `Channel ${n} — MER (traffic light)`,
			keywords: ['mer', 'quality', 'snr', 'channel', `${n}`],
			style: { ...OK_STYLE, text: readout(`RF${n} MER`, `channel${n}_mer`), size: '14' },
			feedbacks: [
				{
					feedbackId: 'mer_threshold',
					options: { channel: String(n), direction: 'below', threshold: MER_ZONES.warning },
					style: WARNING_STYLE,
					headline: 'Marginal',
				},
				{
					feedbackId: 'mer_threshold',
					options: { channel: String(n), direction: 'below', threshold: MER_ZONES.alarm },
					style: ALARM_STYLE,
					headline: 'About to drop out',
				},
				unknownCover(String(n)),
			],
		})
	}

	presets['video_lock'] = monitorPreset({
		name: 'Video decoder lock',
		keywords: ['video', 'lock', 'decoder'],
		style: { ...ALARM_STYLE, text: readout('VIDEO', 'video_locked'), size: '14' },
		feedbacks: [{ feedbackId: 'video_locked', options: {}, style: OK_STYLE }, unknownCover('unit')],
	})

	presets['video_format'] = monitorPreset({
		name: 'Detected video format',
		keywords: ['video', 'format', 'standard', 'resolution'],
		style: { ...READOUT_STYLE, text: readout('FORMAT', 'video_format'), size: '14' },
		feedbacks: [unknownCover('unit')],
	})

	// Starts green because frame lock being fine is the normal case, and the
	// receiver says OK while genlock is switched off as well. The second line
	// shows which mode it is in, so "OK" and "not asked for" are told apart by
	// reading rather than by guessing.
	presets['genlock'] = monitorPreset({
		name: 'Frame lock (genlock)',
		keywords: ['genlock', 'frame', 'lock', 'reference', 'sync'],
		style: { ...OK_STYLE, text: `GENLOCK\n$(${SELF}:genlock)`, size: '14' },
		feedbacks: [
			{ feedbackId: 'genlock_failed', options: {}, style: ALARM_STYLE, headline: 'Reference lost' },
			// Grey while frame lock is switched off. The receiver reports OK in
			// that state, and green there would claim health about something
			// nobody asked for — the same mistake as a green reading with no
			// contact behind it.
			//
			// Deliberately *after* the red one, so grey wins: a reference
			// error on a switched-off genlock is nothing to alarm about. The
			// red branch itself is confirmed — on 2026-10-26 the bench unit
			// went to `Fail` the moment genlock was set to `SD` with nothing
			// on the reference input. What stays unproven is the converse:
			// that it never reports `Fail` while `Off`. It read `OK`
			// throughout that day, which supports the order without settling
			// it, so this is still the line to revisit if one ever shows up.
			{
				feedbackId: 'setting_is',
				options: { setting: 'genlock', value: 'Off' },
				style: UNKNOWN_STYLE,
				headline: 'Not in use',
			},
			unknownCover('unit'),
		],
	})

	presets['audio_lock'] = monitorPreset({
		name: 'Audio 1 + 2 lock',
		keywords: ['audio', 'lock'],
		style: {
			...READOUT_STYLE,
			text: `AUDIO\n$(${SELF}:audio1_locked)\n$(${SELF}:audio2_locked)`,
			size: '7',
		},
		feedbacks: [unknownCover('unit')],
	})

	presets['alarm_status'] = monitorPreset({
		name: 'Alarm status',
		keywords: ['alarm', 'fault', 'status'],
		// Clear is the normal case, so start green and let the feedback raise it.
		style: { ...OK_STYLE, text: readout('ALARMS', 'alarm_summary'), size: '7' },
		feedbacks: [{ feedbackId: 'alarm_active', options: {}, style: ALARM_STYLE }, unknownCover('unit')],
	})

	// The traffic light from HELP.md: warning first, alarm second, so the lower
	// threshold wins once both apply.
	presets['camera_battery'] = monitorPreset({
		name: 'Camera battery voltage (traffic light)',
		keywords: ['battery', 'voltage', 'camera', 'volt'],
		style: { ...OK_STYLE, text: readout('VOLT', 'camera_battery_voltage', ' V'), size: '14' },
		feedbacks: [
			{
				feedbackId: 'voltage_threshold',
				options: { direction: 'below', threshold: 12.5 },
				style: WARNING_STYLE,
				headline: 'Getting low',
			},
			{
				feedbackId: 'voltage_threshold',
				options: { direction: 'below', threshold: 11.8 },
				style: ALARM_STYLE,
				headline: 'Change the battery',
			},
			unknownCover('unit'),
		],
	})

	for (const sensor of TEMPERATURE_SENSORS) {
		presets[`temperature_${sensor.id}`] = monitorPreset({
			name: `Temperature — ${sensor.id}`,
			keywords: ['temperature', 'temp', 'heat', sensor.id],
			style: { ...READOUT_STYLE, text: readout(sensor.caption, sensor.variable, '°'), size: '14' },
			feedbacks: [
				{
					feedbackId: 'temperature_threshold',
					options: { source: sensor.id, direction: 'above', threshold: 80 },
					style: ALARM_STYLE,
				},
				unknownCover('unit'),
			],
		})
	}

	presets['unit_info'] = monitorPreset({
		name: 'Unit identity',
		keywords: ['unit', 'id', 'name', 'mode', 'frequency'],
		style: {
			...READOUT_STYLE,
			text: `$(${SELF}:unit_web_id)\n$(${SELF}:rf_frequency)\n$(${SELF}:rx_mode)`,
			size: '7',
		},
		feedbacks: [unknownCover('unit')],
	})

	// ---- Control -------------------------------------------------------
	// One button per value, straight from CONTROL_SETTINGS — the same table the
	// actions are built from, so a value can never appear on a button that the
	// action would then refuse. Each carries the matching `setting_is` feedback,
	// so a row of them reads at a glance as "this is the one we are on".
	//
	// Grouped per setting, and the groups collect into one section per area of
	// the receiver. Collapsed in Companion's list that is a handful of rows; left
	// in one flat section it was a wall.
	const groups: Record<ControlSection, { id: string; type: 'simple'; name: string; presets: string[] }[]> = {
		rf: [],
		routing: [],
		video: [],
		unit: [],
	}

	/**
	 * One group per setting — including the per-channel ones, whose four channels
	 * share a single group rather than getting one each.
	 *
	 * Eight buttons under "Channel enable" is one glance; the same eight split
	 * across four headings pushed the rest of the section off the screen and said
	 * nothing the buttons do not already say. They carry the channel in their own
	 * caption (RF1…RF4, LNB1…LNB4), so nothing is lost by dropping the headings.
	 */
	const addControl = (setting: ControlSetting) => {
		const channels: (number | undefined)[] = setting.perChannel ? [...CONTROL_CHANNELS] : [undefined]
		const ids: string[] = []

		for (const channel of channels) {
			const id = controlSettingId(setting, channel)
			const caption = setting.caption.replace('{n}', String(channel))
			const label = channel === undefined ? setting.label : `${setting.label} — channel ${channel}`

			for (const value of setting.values) {
				const presetId = `set_${id}_${slug(value)}`
				ids.push(presetId)
				presets[presetId] = controlPreset({
					name: `${label} — ${value}`,
					keywords: [...setting.keywords],
					caption,
					value,
					// Nothing to match against when the receiver does not report it, so
					// the button carries no green at all rather than a green that lies.
					setting: setting.variable ? id : undefined,
					action: controlPresetAction(setting, channel, value),
				})
			}
		}

		groups[setting.section].push({ id: `set_${setting.id}`, type: 'simple', name: setting.label, presets: ids })
	}

	// Every control preset carries an action, and under read-only there are no
	// actions — so the monitoring sections stay and the Control ones do not
	// appear at all, rather than handing out buttons that land as "unknown
	// action".
	const writes = writesAllowed(self)
	const guardedOn = guardedActionsEnabled(self)
	for (const setting of writes ? CONTROL_SETTINGS : []) {
		// A preset whose action the switch has removed would reach the button as
		// "unknown action", so it is not offered either.
		if (setting.guarded && !guardedOn) continue
		addControl(setting)
	}

	// Frequency is a number, not a choice, so there is no sensible button per
	// value — this is a starting point to edit. It shows the frequency it would
	// tune to above the one the receiver is actually on, which is the closest
	// thing to a match indicator a free-form field can have.
	//
	// Not in the table, so it needs its own read-only check. Companion says so
	// out loud when one is missed: "preset definitions reference unknown action
	// definitions".
	if (writes) {
		presets['set_frequency'] = {
			type: 'simple',
			name: 'Retune — set receive frequency',
			keywords: ['frequency', 'tune', 'ghz', 'retune'],
			style: { ...READOUT_STYLE, text: `TUNE 2.325\n$(${SELF}:rf_frequency)`, size: '7' },
			feedbacks: [unknownCover('unit')],
			steps: [{ down: [{ actionId: 'set_frequency', options: { frequency: 2.325 } }], up: [] }],
		}
	}

	// Preset recall only appears while the connection offers the interrupting
	// actions. Companion would otherwise hand out a preset whose action does not
	// exist, and it lands on the button as "unknown action".
	//
	// Unlike the buttons above these carry no `setting_is` feedback, and that is
	// deliberate. The only thing to match against is `DB_L2174_PRESET_NUM`, which
	// says which slot is *selected*, not which one is in force: retune by hand
	// after a recall and the slot number does not change. Green here would mean
	// something different from green on every other control button, and a colour
	// that means two things is worse than no colour.
	const presetSlots = guardedOn ? Array.from({ length: 16 }, (_, i) => i + 1) : []
	for (const slot of presetSlots) {
		presets[`recall_preset_${slot}`] = {
			type: 'simple',
			name: `Recall preset ${slot} (interrupts)`,
			keywords: ['preset', 'recall', 'memory', `${slot}`],
			style: { ...READOUT_STYLE, text: `PRESET\n${slot}`, size: '14' },
			// No grey cover, for the same reason as store below: there is no
			// reading on this button to be uncertain about.
			feedbacks: [],
			steps: [{ down: [{ actionId: 'recall_preset', options: { preset: slot } }], up: [] }],
		}

		// Store sits next to recall in the list and does the opposite: recall can
		// be pressed again, store overwrites the slot and the old contents are
		// gone. Two rows of sixteen buttons that differ only in a word is a
		// mix-up nobody can undo, so these carry the destructive red — the
		// difference is visible before the press, not spelled out after it.
		presets[`store_preset_${slot}`] = {
			type: 'simple',
			name: `Store preset ${slot} (overwrites)`,
			keywords: ['preset', 'store', 'save', 'overwrite', `${slot}`],
			style: { ...DESTRUCTIVE_STYLE, text: `STORE\n${slot}`, size: '14' },
			// No grey cover here, unlike every other button. Grey means "we do not
			// know this reading" — but there is no reading on a store button, and
			// between Companion starting and the first good poll the cover would
			// turn STORE and RECALL the same colour while a press still reaches
			// the receiver. The red is what keeps two rows of sixteen apart.
			feedbacks: [],
			steps: [{ down: [{ actionId: 'store_preset', options: { preset: slot } }], up: [] }],
		}
	}

	// One button, not sixteen: there is nothing to pick. Same red as store, for
	// the same reason — twenty seconds away, and longer before it decodes again, is not something to discover afterwards.
	if (presetSlots.length) {
		presets['reboot_receiver'] = {
			type: 'simple',
			name: 'Reboot receiver (interrupts)',
			keywords: ['reboot', 'restart', 'power'],
			style: { ...DESTRUCTIVE_STYLE, text: 'REBOOT', size: '14' },
			// Red stays red, for the same reason as store above.
			feedbacks: [],
			steps: [{ down: [{ actionId: 'reboot_receiver', options: {} }], up: [] }],
		}
	}

	const sections: Sections = [
		{
			id: 'signal',
			name: 'Signal',
			description:
				'Per-channel reception state. Lock buttons are green once the channel locks; the readouts turn red when they cross their threshold.',
			definitions: [
				{
					id: 'channel_lock',
					type: 'simple',
					name: 'RF lock',
					presets: CHANNEL_IDS.map((n) => `channel_${n}_lock`),
				},
				{
					id: 'channel_power',
					type: 'simple',
					name: 'Input power',
					presets: CHANNEL_IDS.map((n) => `channel_${n}_power`),
				},
				{
					id: 'channel_mer',
					type: 'simple',
					name: 'MER',
					presets: CHANNEL_IDS.map((n) => `channel_${n}_mer`),
				},
			],
		},
		{
			id: 'decoder',
			name: 'Decoder',
			definitions: ['video_lock', 'video_format', 'genlock', 'audio_lock'],
		},
		// Under read-only there are no control buttons at all, so the four Control
		// sections go with them — four empty headings say nothing the switch has
		// not already said.
		...(writes ? (Object.keys(CONTROL_SECTIONS) as ControlSection[]) : []).map((key) => ({
			id: `control_${key}`,
			name: CONTROL_SECTIONS[key].name,
			description: CONTROL_SECTIONS[key].description,
			definitions: [
				...groups[key],
				// Retune and the preset buttons are not choices between fixed values,
				// so they are not in the table — they join their section here.
				...(key === 'rf'
					? [{ id: 'set_frequency', type: 'simple' as const, name: 'Retune', presets: ['set_frequency'] }]
					: []),
				...(key === 'unit' && presetSlots.length
					? [
							{
								id: 'recall_preset',
								type: 'simple' as const,
								name: 'Recall preset',
								presets: presetSlots.map((n) => `recall_preset_${n}`),
							},
							{
								id: 'store_preset',
								type: 'simple' as const,
								name: 'Store preset (overwrites)',
								presets: presetSlots.map((n) => `store_preset_${n}`),
							},
							{ id: 'reboot_receiver', type: 'simple' as const, name: 'Reboot', presets: ['reboot_receiver'] },
						]
					: []),
			],
		})),
		{
			id: 'unit',
			name: 'Unit',
			description: 'Health and identity of the receiver itself.',
			definitions: [
				'alarm_status',
				'camera_battery',
				...TEMPERATURE_SENSORS.map((sensor) => `temperature_${sensor.id}`),
				'unit_info',
			],
		},
	]

	self.setPresetDefinitions(sections, presets)
}
