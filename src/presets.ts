import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { ALARM_STYLE, OK_STYLE, READOUT_STYLE, UNKNOWN_STYLE, WARNING_STYLE } from './feedbacks.js'
import { CHANNEL_IDS, type SettingId } from './types.js'
import { BANDWIDTHS, DECODER_SOURCES, ON_OFF, RX_MODES } from './actions.js'
import { guardedActionsEnabled } from './config.js'

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
	setting: SettingId
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
			{
				feedbackId: 'setting_is',
				options: { setting: args.setting, value: args.value },
				style: OK_STYLE,
				headline: 'Selected — green',
			},
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
	// One button per value, built from the same lists the actions validate
	// against. Each carries the matching `setting_is` feedback, so a wall of
	// these reads at a glance as "this is the one we are on".

	for (const mode of RX_MODES) {
		presets[`set_mode_${slug(mode)}`] = controlPreset({
			name: `Receive mode — ${mode}`,
			keywords: ['mode', 'dvbt', 'lmst', 'receive'],
			caption: 'MODE',
			value: mode,
			setting: 'mode',
			action: { actionId: 'set_rx_mode', options: { mode } },
		})
	}

	for (const bandwidth of BANDWIDTHS) {
		presets[`set_bandwidth_${slug(bandwidth)}`] = controlPreset({
			name: `Channel bandwidth — ${bandwidth}`,
			keywords: ['bandwidth', 'channel', 'mhz'],
			caption: 'BW',
			value: bandwidth,
			setting: 'bandwidth',
			action: { actionId: 'set_bandwidth', options: { bandwidth } },
		})
	}

	for (const source of DECODER_SOURCES) {
		presets[`set_source_${slug(source)}`] = controlPreset({
			name: `Decoder source — ${source}`,
			keywords: ['decoder', 'source', 'input', 'asi', 'routing'],
			caption: 'SRC',
			value: source,
			setting: 'source',
			action: { actionId: 'set_decoder_source', options: { source } },
		})
	}

	for (const state of ON_OFF) {
		presets[`set_diversity_${slug(state)}`] = controlPreset({
			name: `Demodulator diversity — ${state}`,
			keywords: ['diversity', 'demodulator'],
			caption: 'DIV',
			value: state,
			setting: 'diversity',
			action: { actionId: 'set_demod_diversity', options: { state } },
		})
	}

	// Frequency is a number, not a choice, so there is no sensible button per
	// value — this is a starting point to edit. It shows the frequency it would
	// tune to above the one the receiver is actually on, which is the closest
	// thing to a match indicator a free-form field can have.
	presets['set_frequency'] = {
		type: 'simple',
		name: 'Retune — set receive frequency',
		keywords: ['frequency', 'tune', 'ghz', 'retune'],
		style: { ...READOUT_STYLE, text: `TUNE 2.325\n$(${SELF}:rf_frequency)`, size: '7' },
		feedbacks: [unknownCover('unit')],
		steps: [{ down: [{ actionId: 'set_frequency', options: { frequency: 2.325 } }], up: [] }],
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
	const presetSlots = guardedActionsEnabled(self) ? Array.from({ length: 16 }, (_, i) => i + 1) : []
	for (const slot of presetSlots) {
		presets[`recall_preset_${slot}`] = {
			type: 'simple',
			name: `Recall preset ${slot} (interrupts)`,
			keywords: ['preset', 'recall', 'memory', `${slot}`],
			style: { ...READOUT_STYLE, text: `PRESET\n${slot}`, size: '14' },
			feedbacks: [unknownCover('unit')],
			steps: [{ down: [{ actionId: 'recall_preset', options: { preset: slot } }], up: [] }],
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
			definitions: ['video_lock', 'video_format', 'audio_lock'],
		},
		{
			id: 'control',
			name: 'Control',
			description:
				'Buttons that change the receiver. The ones that pick a value turn green while the receiver already holds it, so a row of them shows what is selected. Recall stays black: the receiver only reports which slot is selected, not which one is still in force. Recall appears at all only while the connection offers the interrupting actions.',
			definitions: [
				{ id: 'set_mode', type: 'simple', name: 'Receive mode', presets: RX_MODES.map((m) => `set_mode_${slug(m)}`) },
				{
					id: 'set_bandwidth',
					type: 'simple',
					name: 'Channel bandwidth',
					presets: BANDWIDTHS.map((b) => `set_bandwidth_${slug(b)}`),
				},
				{
					id: 'set_source',
					type: 'simple',
					name: 'Decoder source',
					presets: DECODER_SOURCES.map((d) => `set_source_${slug(d)}`),
				},
				{
					id: 'set_diversity',
					type: 'simple',
					name: 'Demodulator diversity',
					presets: ON_OFF.map((o) => `set_diversity_${slug(o)}`),
				},
				// A section's definitions have to be all groups or all plain names, so
				// the single retune button travels as a group of one.
				{ id: 'set_frequency', type: 'simple' as const, name: 'Retune', presets: ['set_frequency'] },
				...(presetSlots.length
					? [
							{
								id: 'recall_preset',
								type: 'simple' as const,
								name: 'Recall preset',
								presets: presetSlots.map((n) => `recall_preset_${n}`),
							},
						]
					: []),
			],
		},
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
