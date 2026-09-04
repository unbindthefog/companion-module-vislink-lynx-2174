/**
 * The receiver has no structured API: `data.xml` is a flat list of
 * `<name>`/`<value>` pairs, and every value — numbers and bitfields included —
 * arrives as a string. This module reads that file directly rather than
 * modelling it as JSON.
 *
 * See `docs/LYNX_L2174_API.md` for how this was reverse-engineered from a live
 * device (read-only) and the full parameter list.
 */
export type RawParameters = Record<string, string>

/**
 * Bit layout of `DB_L2174_ALARMS`, left to right, as defined by the device's
 * own `settings.xml`. A `1` means the condition is active.
 */
export const ALARM_BITS = [
	'Clock fault',
	'High Temperature',
	'Demod High Temp',
	'Decoder High Temp',
	'Demod Self Test Fault',
	'Decoder Comms Fault',
	'Synth not Locked',
	'LPF not Tuned',
	'ADC Clock not Locked',
	'ASI Clock not Locked',
	'LNB Fault',
	'Invalid Frequency',
	'Demod Freq Error',
	'RF not Locked',
	'TPS not Locked',
	'FEC not Locked',
	'ASI not Locked',
	'Video not Locked',
	'Audio 1 not Locked',
	'Audio 2 not Locked',
	'Frame not Locked',
	'IP Link Error',
	'IP not Locked',
	'Test fault',
	'Dummy',
	'Fan1 fault',
	'Fan2 fault',
	'Lic format mismatch',
	'Lic ID checksum error',
	'Lic unit mismatch',
	'Lic type mismatch',
] as const

/** The four RF/diversity input channels the L2174 demodulator provides. */
export const CHANNEL_IDS = [1, 2, 3, 4] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]
