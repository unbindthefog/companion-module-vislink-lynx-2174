import type ModuleInstance from './main.js'
import { CHANNEL_IDS, SETTING_SOURCES, type SettingId } from './types.js'

/** Which side of the threshold counts as an alarm. Shared by every threshold feedback. */
type ThresholdDirection = 'below' | 'above'

const DIRECTION_CHOICES: { id: ThresholdDirection; label: string }[] = [
	{ id: 'below', label: 'Below' },
	{ id: 'above', label: 'Above' },
]

/** True when `value` is on the alarm side of `threshold`, given `direction`. */
function crossesThreshold(value: number | undefined, threshold: number, direction: ThresholdDirection): boolean {
	// No reading means no alarm: an unlocked receiver already has its own
	// feedback, and firing both would double-report one fault.
	if (typeof value !== 'number') return false
	return direction === 'above' ? value > threshold : value < threshold
}

export type FeedbacksSchema = {
	channel_locked: {
		type: 'boolean'
		options: { channel: number }
	}
	video_locked: {
		type: 'boolean'
		options: Record<string, never>
	}
	alarm_active: {
		type: 'boolean'
		options: Record<string, never>
	}
	power_threshold: {
		type: 'boolean'
		options: { channel: string; direction: ThresholdDirection; threshold: number }
	}
	mer_threshold: {
		type: 'boolean'
		options: { channel: string; direction: ThresholdDirection; threshold: number }
	}
	temperature_threshold: {
		type: 'boolean'
		options: { source: string; direction: ThresholdDirection; threshold: number }
	}
	voltage_threshold: {
		type: 'boolean'
		options: { direction: ThresholdDirection; threshold: number }
	}
	reading_unknown: {
		type: 'boolean'
		options: { source: string }
	}
	setting_is: {
		type: 'boolean'
		options: { setting: SettingId; value: string }
	}
}

/** Every feedback id, so a poll can re-evaluate the lot without listing them twice. */
export const ALL_FEEDBACKS = [
	'channel_locked',
	'video_locked',
	'alarm_active',
	'power_threshold',
	'mer_threshold',
	'temperature_threshold',
	'voltage_threshold',
	'reading_unknown',
	'setting_is',
] as const satisfies ReadonlyArray<keyof FeedbacksSchema>

/**
 * The house styles for "something is wrong" / "all good" / "watch this".
 * Exported so presets dress their buttons in the same colours the feedbacks
 * apply, rather than each file inventing its own greens and reds.
 */
export const ALARM_STYLE = { bgcolor: 0xcc0000, color: 0xffffff }
export const OK_STYLE = { bgcolor: 0x00c000, color: 0x000000 }
export const WARNING_STYLE = { bgcolor: 0xff8000, color: 0x000000 }
export const READOUT_STYLE = { bgcolor: 0x000000, color: 0xffffff }
/**
 * A button that cannot be taken back: store over a preset slot, reboot.
 *
 * The same red as an alarm, on purpose — both say "stop and look" — but its own
 * constant, because the two mean different things and may want to part ways.
 * On a readout red is a measurement; here it is a warning about the press.
 */
export const DESTRUCTIVE_STYLE = { bgcolor: 0xcc0000, color: 0xffffff }
/** Not "fine" and not "broken": we do not know. Grey, never red. */
export const UNKNOWN_STYLE = { bgcolor: 0x555555, color: 0xcccccc }

/**
 * Should this reading be shown as unknown rather than judged?
 *
 * `state.contact` is one of:
 *   'no-reading-yet'          nothing polled successfully yet
 *   'ok'                      the last poll succeeded
 *   'no-path-from-here'       our machine has no route (ENETUNREACH, ENOTFOUND, …)
 *   'receiver-not-answering'  the receiver was asked and did not answer properly
 *
 * `source` is `'unit'` or a channel number as a string. For a channel, the lock
 * state is in `state.channelLock[Number(source)]` (`'Locked'` / `'No Lock'`),
 * and the readings in `state.channelPower` / `state.channelMer`.
 *
 * Returning `false` everywhere leaves today's behaviour untouched.
 */
function readingIsUnknown(state: ModuleInstance['state'], _source: string): boolean {
	// Deliberately the simple version: any state other than a good last poll
	// covers the button, so a reading we do not have never reads as one that is
	// fine. Whether a locked-but-idle channel should also count as unknown is
	// left open until it actually gets in the way — `_source` is already carried
	// through for that day.
	return state.contact !== 'ok'
}

/**
 * Does the receiver currently hold `value` for `setting`?
 *
 * `state.settings[setting]` is whatever the last poll read back — the device's
 * own spelling, e.g. 'LMST(S)', '10MHz', 'On', '001' — or `undefined` when the
 * receiver did not report it. `value` is what someone typed into the button, or
 * what a preset put there.
 *
 * Two cases are settled and not up for discussion below: nothing read back and
 * nothing configured both mean "no match", because an empty reading matching an
 * empty field would paint a button green on the strength of knowing nothing.
 *
 * TODO(human): decide how forgiving the comparison itself should be.
 */
function settingMatches(state: ModuleInstance['state'], setting: SettingId, value: string): boolean {
	const reading = state.settings[setting]
	if (reading === undefined || value === '') return false

	return reading === value
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		channel_locked: {
			name: 'RF channel is locked',
			type: 'boolean',
			description: 'Green while the chosen channel reports RF lock. Use inverted for an alarm button.',
			defaultStyle: OK_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Channel',
					default: 1,
					choices: CHANNEL_IDS.map((n) => ({ id: n, label: `Channel ${n}` })),
				},
			],
			callback: (feedback) => self.state.channelLock[feedback.options.channel] === 'Locked',
		},

		video_locked: {
			name: 'Video decoder is locked',
			type: 'boolean',
			description: 'Green while the decoder reports video lock.',
			defaultStyle: OK_STYLE,
			options: [],
			callback: () => self.state.videoLocked === 'Locked',
		},

		alarm_active: {
			name: 'Any alarm is active',
			type: 'boolean',
			description: 'Red while DB_L2174_ALARMS reports at least one active alarm bit.',
			defaultStyle: ALARM_STYLE,
			options: [],
			callback: () => self.state.alarmActive,
		},

		power_threshold: {
			name: 'Channel power crosses threshold',
			type: 'boolean',
			description:
				'Turns red when the chosen channel’s input power crosses the threshold, in whichever direction counts as bad. "Best channel" tracks the strongest input, which is what diversity reception actually delivers.',
			defaultStyle: ALARM_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Channel',
					default: 'best',
					choices: [
						{ id: 'best', label: 'Best channel' },
						...CHANNEL_IDS.map((n) => ({ id: String(n), label: `Channel ${n}` })),
					],
				},
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Alarm when power is',
					default: 'below',
					choices: DIRECTION_CHOICES,
				},
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (dBm)',
					default: -60,
					min: -150,
					max: 10,
				},
			],
			callback: (feedback) => {
				const { channel, direction, threshold } = feedback.options
				const power = channel === 'best' ? self.state.bestPower : self.state.channelPower[Number(channel)]
				return crossesThreshold(power, threshold, direction)
			},
		},

		mer_threshold: {
			name: 'Channel MER crosses threshold',
			type: 'boolean',
			description:
				'Turns red when the chosen channel’s modulation error ratio crosses the threshold, in whichever direction counts as bad. "Best channel" tracks the cleanest input.',
			defaultStyle: ALARM_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Channel',
					default: 'best',
					choices: [
						{ id: 'best', label: 'Best channel' },
						...CHANNEL_IDS.map((n) => ({ id: String(n), label: `Channel ${n}` })),
					],
				},
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Alarm when MER is',
					default: 'below',
					choices: DIRECTION_CHOICES,
				},
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (dB)',
					default: 20,
					min: -10,
					max: 40,
				},
			],
			callback: (feedback) => {
				const { channel, direction, threshold } = feedback.options
				const mer = channel === 'best' ? self.state.bestMer : self.state.channelMer[Number(channel)]
				return crossesThreshold(mer, threshold, direction)
			},
		},

		temperature_threshold: {
			name: 'Temperature crosses threshold',
			type: 'boolean',
			description: 'Turns red when the chosen sensor crosses the threshold, in whichever direction counts as bad.',
			defaultStyle: ALARM_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'source',
					label: 'Sensor',
					default: 'unit',
					choices: [
						{ id: 'unit', label: 'Unit (PCB)' },
						{ id: 'demod', label: 'Demodulator FPGA' },
						{ id: 'decoder', label: 'Decoder FPGA' },
					],
				},
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Alarm when temperature is',
					default: 'above',
					choices: DIRECTION_CHOICES,
				},
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (°C)',
					default: 80,
					min: 0,
					max: 120,
				},
			],
			callback: (feedback) => {
				const { source, direction, threshold } = feedback.options
				const value =
					source === 'demod'
						? self.state.demodTemperature
						: source === 'decoder'
							? self.state.decoderTemperature
							: self.state.unitTemperature
				return crossesThreshold(value, threshold, direction)
			},
		},

		voltage_threshold: {
			name: 'Camera battery voltage crosses threshold',
			type: 'boolean',
			description:
				'Turns red when the camera battery voltage crosses the threshold, in whichever direction counts as bad. Stack two of these on one button — a warning threshold first, then a lower alarm threshold — for a traffic-light readout; the lower one is listed last so it wins once both apply.',
			defaultStyle: ALARM_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Alarm when voltage is',
					default: 'below',
					choices: DIRECTION_CHOICES,
				},
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (V)',
					default: 11.8,
					min: 0,
					max: 25.5,
					step: 0.1,
				},
			],
			callback: (feedback) => {
				const { direction, threshold } = feedback.options
				return crossesThreshold(self.state.cameraBatteryVoltage, threshold, direction)
			},
		},

		reading_unknown: {
			name: 'Reading is unknown (grey)',
			type: 'boolean',
			description:
				'Grey while this reading cannot be judged — no contact with the receiver yet, or no route to it from this machine. Stack it last on a monitoring button so it covers whatever the thresholds below it decided; a value we do not have is not a value that is fine, and it is not a fault either. The choice below is carried for a future that tells channels apart; today every setting behaves the same.',
			defaultStyle: UNKNOWN_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'source',
					label: 'Reading',
					default: 'unit',
					choices: [
						{ id: 'unit', label: 'Unit-wide (temperatures, voltage, alarms)' },
						...CHANNEL_IDS.map((n) => ({ id: String(n), label: `Channel ${n}` })),
					],
				},
			],
			callback: (feedback) => readingIsUnknown(self.state, feedback.options.source),
		},

		setting_is: {
			name: 'Setting is at a given value',
			type: 'boolean',
			description:
				'Green while the receiver already holds this value. Put it on the button that sets it, so the button shows what is selected instead of only what it would do.',
			defaultStyle: OK_STYLE,
			options: [
				{
					type: 'dropdown',
					id: 'setting',
					label: 'Setting',
					default: 'mode',
					choices: SETTING_SOURCES.map((source) => ({ id: source.id, label: source.label })),
				},
				{
					type: 'textinput',
					id: 'value',
					label: 'Value, spelled as the receiver reports it — "10MHz", "LMST(S)", "On", and preset slots as "001"',
					default: '',
				},
			],
			callback: (feedback) => settingMatches(self.state, feedback.options.setting, feedback.options.value),
		},
	})
}
