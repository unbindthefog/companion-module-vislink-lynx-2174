import type ModuleInstance from './main.js'
import { CHANNEL_IDS } from './types.js'

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
] as const satisfies ReadonlyArray<keyof FeedbacksSchema>

/** Red on a dark button — the house style for "something is wrong". */
const ALARM_STYLE = { bgcolor: 0xcc0000, color: 0xffffff }
const OK_STYLE = { bgcolor: 0x00c000, color: 0x000000 }

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
	})
}
