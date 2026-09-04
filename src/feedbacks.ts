import type ModuleInstance from './main.js'
import { CHANNEL_IDS } from './types.js'

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
	power_below: {
		type: 'boolean'
		options: { channel: string; threshold: number }
	}
	temperature_above: {
		type: 'boolean'
		options: { source: string; threshold: number }
	}
}

/** Every feedback id, so a poll can re-evaluate the lot without listing them twice. */
export const ALL_FEEDBACKS = [
	'channel_locked',
	'video_locked',
	'alarm_active',
	'power_below',
	'temperature_above',
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

		power_below: {
			name: 'Channel power below threshold',
			type: 'boolean',
			description:
				'Turns red when the chosen channel’s input power drops below the threshold. "Best channel" tracks the strongest input, which is what diversity reception actually delivers.',
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
					type: 'number',
					id: 'threshold',
					label: 'Alarm below (dBm)',
					default: -60,
					min: -150,
					max: 10,
				},
			],
			callback: (feedback) => {
				const { channel, threshold } = feedback.options
				const power = channel === 'best' ? self.state.bestPower : self.state.channelPower[Number(channel)]
				// No reading means no alarm: an unlocked receiver already has its
				// own feedback, and firing both would double-report one fault.
				return typeof power === 'number' && power < threshold
			},
		},

		temperature_above: {
			name: 'Temperature above threshold',
			type: 'boolean',
			description: 'Turns red above the threshold on the chosen sensor.',
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
					type: 'number',
					id: 'threshold',
					label: 'Alarm above (°C)',
					default: 80,
					min: 0,
					max: 120,
				},
			],
			callback: (feedback) => {
				const { source, threshold } = feedback.options
				const value =
					source === 'demod'
						? self.state.demodTemperature
						: source === 'decoder'
							? self.state.decoderTemperature
							: self.state.unitTemperature
				return typeof value === 'number' && value > threshold
			},
		},
	})
}
