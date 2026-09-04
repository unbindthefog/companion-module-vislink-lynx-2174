import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { ALARM_BITS, CHANNEL_IDS, type RawParameters } from './types.js'

type ChannelVariables = { [K in (typeof CHANNEL_IDS)[number] as `channel${K}_lock`]: string } & {
	[K in (typeof CHANNEL_IDS)[number] as `channel${K}_power`]: string
} & { [K in (typeof CHANNEL_IDS)[number] as `channel${K}_mer`]: string }

export type VariablesSchema = ChannelVariables & {
	// Connection / diagnostics
	last_error: string

	// Unit
	unit_web_id: string
	unit_serial: string
	unit_sw_version: string
	unit_build: string
	unit_run_hours: string
	unit_temperature: string
	demod_fpga_temperature: string
	decoder_fpga_temperature: string
	camera_battery_voltage: string

	// RF / demodulator
	rx_mode: string
	rf_frequency: string
	rf_bandwidth: string
	rf_modulation: string
	rf_fec: string
	rf_guard_interval: string
	pre_ber: string
	post_ber: string
	asi_input_lock: string
	ip_input_lock: string

	// Decoder
	video_locked: string
	video_format: string
	audio1_locked: string
	audio2_locked: string

	// Camera control
	ccu_status: string

	// Alarms — decoded from the DB_L2174_ALARMS bitfield
	alarm_active: string
	alarm_summary: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		last_error: { name: 'Last error message (empty when OK)' },

		unit_web_id: { name: 'Web ID (user-assigned unit name)' },
		unit_serial: { name: 'Unit serial number' },
		unit_sw_version: { name: 'Unit software version' },
		unit_build: { name: 'Unit build version' },
		unit_run_hours: { name: 'Run hours' },
		unit_temperature: { name: 'Unit — PCB temperature (°C)' },
		demod_fpga_temperature: { name: 'Demodulator — FPGA temperature (°C)' },
		decoder_fpga_temperature: { name: 'Decoder — FPGA temperature (°C)' },
		camera_battery_voltage: { name: 'Camera supply voltage (V)' },

		rx_mode: { name: 'Receive mode (DVB-T / LMST)' },
		rf_frequency: { name: 'RF frequency (GHz)' },
		rf_bandwidth: { name: 'RF bandwidth' },
		rf_modulation: { name: 'Modulation (QPSK / 16QAM / 64QAM)' },
		rf_fec: { name: 'Forward error correction rate' },
		rf_guard_interval: { name: 'Guard interval' },
		pre_ber: { name: 'Pre-FEC bit error rate' },
		post_ber: { name: 'Post-FEC bit error rate' },
		asi_input_lock: { name: 'ASI input lock (Locked / No Lock)' },
		ip_input_lock: { name: 'IP input lock (Locked / No Lock)' },

		video_locked: { name: 'Video lock (Locked / No Lock)' },
		video_format: { name: 'Detected video format' },
		audio1_locked: { name: 'Audio 1 lock (Locked / No Lock)' },
		audio2_locked: { name: 'Audio 2 lock (Locked / No Lock)' },

		ccu_status: { name: 'Camera control unit status' },

		alarm_active: { name: 'Any alarm active (yes/no)' },
		alarm_summary: { name: 'Active alarms, comma-separated (empty when clear)' },
	} as CompanionVariableDefinitions<VariablesSchema>

	for (const n of CHANNEL_IDS) {
		definitions[`channel${n}_lock`] = { name: `Channel ${n} — RF lock (Locked / No Lock)` }
		definitions[`channel${n}_power`] = { name: `Channel ${n} — input power level (dBm)` }
		definitions[`channel${n}_mer`] = { name: `Channel ${n} — MER (dB)` }
	}

	self.setVariableDefinitions(definitions)
}

/** Pass a raw value through, or an empty string when the device omitted it. */
function str(value: string | undefined): string {
	return value ?? ''
}

/**
 * Decode `DB_L2174_ALARMS` into the names of every currently active alarm.
 * The device pads the field with extra trailing digits on some firmware
 * builds, so bits are read by position rather than assuming a fixed length.
 */
export function decodeAlarms(raw: string | undefined): { active: boolean; names: string[] } {
	if (!raw) return { active: false, names: [] }
	const names: string[] = []
	for (let i = 0; i < ALARM_BITS.length && i < raw.length; i++) {
		if (raw[i] === '1') names.push(ALARM_BITS[i])
	}
	return { active: names.length > 0, names }
}

/**
 * Map the flat `data.xml` parameter dump onto Companion variable values.
 *
 * Kept free of any module/instance state so it can be exercised directly
 * against a recorded or mocked `data.xml`.
 */
export function buildVariableValues(params: RawParameters): Partial<VariablesSchema> {
	const alarms = decodeAlarms(params.DB_L2174_ALARMS)

	const values: Partial<VariablesSchema> = {
		unit_web_id: str(params.DB_L2174_WEB_TEXT),
		unit_serial: str(params.DB_L2174_SERIAL_NUM),
		unit_sw_version: str(params.DB_L2174_SW_VERSION),
		unit_build: str(params.DB_L2174_BUILD_VERSION),
		unit_run_hours: str(params.DB_L2174_RUN_HOURS).replace(/^0+(?=\d)/, ''),
		unit_temperature: str(params.DB_ETRAX_PCB_TEMP),
		demod_fpga_temperature: str(params.DB_DEMOD_FPGA_TEMP),
		decoder_fpga_temperature: str(params.DB_DECOD_FPGA_TEMP),
		camera_battery_voltage: str(params.DB_L2174_CAM_BATT_VOLT),

		rx_mode: str(params.DB_DEMOD_RX_MODE),
		rf_frequency: str(params.DB_L2174_FREQ1),
		rf_bandwidth: str(params.DB_L2174_CHAN_BW),
		rf_modulation: str(params.DB_DEMOD_MOD_TYPE),
		rf_fec: str(params.DB_DEMOD_FEC_RATE),
		rf_guard_interval: str(params.DB_DEMOD_GUARD_INT),
		pre_ber: str(params.DB_DEMOD_PRE_BER),
		post_ber: str(params.DB_DEMOD_POST_BER),
		asi_input_lock: str(params.DB_DEMOD_ASI_1_LOCK),
		ip_input_lock: str(params.DB_DEMOD_IP1_LOCK),

		video_locked: str(params.DB_DECOD_VIDEO_LOCKED),
		video_format: str(params.DB_DECOD_LINE_STD),
		audio1_locked: str(params.DB_DECOD_AUDIO_A_LOCKED),
		audio2_locked: str(params.DB_DECOD_AUDIO_B_LOCKED),

		ccu_status: str(params.DB_CCU_STATUS),

		alarm_active: alarms.active ? 'yes' : 'no',
		alarm_summary: alarms.names.join(', '),
	}

	for (const n of CHANNEL_IDS) {
		values[`channel${n}_lock`] = str(params[`DB_DEMOD_COARSE_LOCK_${n}`])
		values[`channel${n}_power`] = str(params[`DB_DEMOD_PWR_LEVEL_${n}`])
		values[`channel${n}_mer`] = str(params[`DB_DEMOD_MER_${n}`])
	}

	return values
}

/** All device-derived variables blanked, for when the receiver is unreachable. */
export function blankVariableValues(): Partial<VariablesSchema> {
	return buildVariableValues({})
}
