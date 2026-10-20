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

/**
 * The settings a control button can compare itself against.
 *
 * A button that sets a value should also show whether the receiver is already
 * holding it — otherwise the only way to tell what is selected is to open the
 * receiver's own web page. Each entry names the module variable that already
 * mirrors the setting, rather than the `data.xml` parameter underneath it, so
 * the mapping from device to module stays in one place (`variables.ts`).
 *
 * One wrinkle that costs nothing here: the receiver publishes the receive mode
 * twice, as `DB_L2174_RX_MODE` (what the action writes) and `DB_DEMOD_RX_MODE`
 * (what `rx_mode` reads). On the bench unit the two always agreed.
 */
export const SETTING_SOURCES = {
	mode: { label: 'Receive mode', variable: 'rx_mode' },
	bandwidth: { label: 'Channel bandwidth', variable: 'rf_bandwidth' },
	source: { label: 'Decoder source', variable: 'decoder_source' },
	diversity: { label: 'Demodulator diversity', variable: 'demod_diversity' },
	preset: { label: 'Selected preset slot', variable: 'preset_slot' },
} as const

export type SettingId = keyof typeof SETTING_SOURCES
