import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { ALARM_STYLE, OK_STYLE, READOUT_STYLE, WARNING_STYLE } from './feedbacks.js'
import { CHANNEL_IDS } from './types.js'

type Presets = CompanionPresetDefinitions<ModuleSchema>
type Sections = CompanionPresetSection<ModuleSchema>[]

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

const TEMPERATURE_SENSORS = [
	{ id: 'unit', caption: 'TEMP UNIT', variable: 'unit_temperature' },
	{ id: 'demod', caption: 'TEMP DEMOD', variable: 'demod_fpga_temperature' },
	{ id: 'decoder', caption: 'TEMP DEC', variable: 'decoder_fpga_temperature' },
] as const

export function UpdatePresets(self: ModuleInstance): void {
	const presets: Presets = {}

	for (const n of CHANNEL_IDS) {
		// Lock: healthy is green, so the base style carries the alarm colour and
		// the feedback paints over it once the channel actually locks.
		presets[`channel_${n}_lock`] = monitorPreset({
			name: `Channel ${n} — RF lock`,
			keywords: ['rf', 'lock', 'channel', `${n}`],
			style: { ...ALARM_STYLE, text: readout(`RF${n}`, `channel${n}_lock`), size: '14' },
			feedbacks: [{ feedbackId: 'channel_locked', options: { channel: n }, style: OK_STYLE }],
		})

		presets[`channel_${n}_power`] = monitorPreset({
			name: `Channel ${n} — input power`,
			keywords: ['rf', 'power', 'level', 'dbm', 'channel', `${n}`],
			style: { ...READOUT_STYLE, text: readout(`RF${n} PWR`, `channel${n}_power`), size: '14' },
			feedbacks: [
				{
					feedbackId: 'power_threshold',
					options: { channel: String(n), direction: 'below', threshold: -60 },
					style: ALARM_STYLE,
				},
			],
		})

		presets[`channel_${n}_mer`] = monitorPreset({
			name: `Channel ${n} — MER`,
			keywords: ['mer', 'quality', 'snr', 'channel', `${n}`],
			style: { ...READOUT_STYLE, text: readout(`RF${n} MER`, `channel${n}_mer`), size: '14' },
			feedbacks: [
				{
					feedbackId: 'mer_threshold',
					options: { channel: String(n), direction: 'below', threshold: 20 },
					style: ALARM_STYLE,
				},
			],
		})
	}

	presets['video_lock'] = monitorPreset({
		name: 'Video decoder lock',
		keywords: ['video', 'lock', 'decoder'],
		style: { ...ALARM_STYLE, text: readout('VIDEO', 'video_locked'), size: '14' },
		feedbacks: [{ feedbackId: 'video_locked', options: {}, style: OK_STYLE }],
	})

	presets['video_format'] = monitorPreset({
		name: 'Detected video format',
		keywords: ['video', 'format', 'standard', 'resolution'],
		style: { ...READOUT_STYLE, text: readout('FORMAT', 'video_format'), size: '14' },
		feedbacks: [],
	})

	presets['audio_lock'] = monitorPreset({
		name: 'Audio 1 + 2 lock',
		keywords: ['audio', 'lock'],
		style: {
			...READOUT_STYLE,
			text: `AUDIO\n$(${SELF}:audio1_locked)\n$(${SELF}:audio2_locked)`,
			size: '7',
		},
		feedbacks: [],
	})

	presets['alarm_status'] = monitorPreset({
		name: 'Alarm status',
		keywords: ['alarm', 'fault', 'status'],
		// Clear is the normal case, so start green and let the feedback raise it.
		style: { ...OK_STYLE, text: readout('ALARMS', 'alarm_summary'), size: '7' },
		feedbacks: [{ feedbackId: 'alarm_active', options: {}, style: ALARM_STYLE }],
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
		feedbacks: [],
	})

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
