import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import {
	UpdateVariableDefinitions,
	buildVariableValues,
	blankVariableValues,
	type VariablesSchema,
} from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, ALL_FEEDBACKS, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { LynxApi } from './api.js'
import { CHANNEL_IDS } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig

	/** Cached device state that feedbacks read from. */
	state = {
		channelLock: {} as Record<number, string | undefined>,
		channelPower: {} as Record<number, number | undefined>,
		bestPower: undefined as number | undefined,
		channelMer: {} as Record<number, number | undefined>,
		bestMer: undefined as number | undefined,
		videoLocked: '',
		alarmActive: false,
		unitTemperature: undefined as number | undefined,
		demodTemperature: undefined as number | undefined,
		decoderTemperature: undefined as number | undefined,
		cameraBatteryVoltage: undefined as number | undefined,
	}

	#api: LynxApi | null = null
	#pollTimer: NodeJS.Timeout | undefined
	#isPolling = false
	#lastError = ''
	#hasLoggedSuccess = false

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#connect()
	}

	async destroy(): Promise<void> {
		this.#stopPolling()
		this.#api?.destroy()
		this.#api = null
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.#connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/* ------------------------------------------------------------------ */
	/* Connection lifecycle                                                */
	/* ------------------------------------------------------------------ */

	#connect(): void {
		this.#stopPolling()

		const host = this.config.host?.trim()
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No receiver address configured')
			return
		}

		const pollInterval = Math.max(1, this.config.pollInterval || 2) * 1000
		const options = {
			host,
			port: this.config.port || 80,
			// Give a slow receiver room to answer, but never stall longer than a
			// few poll cycles or the connection status goes stale.
			timeoutMs: Math.min(Math.max(2000, pollInterval * 2), 10000),
		}

		if (this.#api) {
			this.#api.updateOptions(options)
		} else {
			this.#api = new LynxApi(options, (level, message) => this.log(level, message))
		}

		this.#hasLoggedSuccess = false
		this.updateStatus(InstanceStatus.Connecting)

		void this.#poll()
		this.#startPolling(pollInterval)
	}

	#startPolling(intervalMs: number): void {
		this.#stopPolling()
		this.#pollTimer = setInterval(() => {
			// Never let polls overlap or queue up behind a slow response.
			if (this.#isPolling) return
			if (this.#api && this.#api.pending > 0) return
			void this.#poll()
		}, intervalMs)
	}

	#stopPolling(): void {
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer)
			this.#pollTimer = undefined
		}
	}

	/* ------------------------------------------------------------------ */
	/* Polling                                                             */
	/* ------------------------------------------------------------------ */

	async #poll(): Promise<void> {
		const api = this.#api
		if (!api || this.#isPolling) return

		this.#isPolling = true
		try {
			const params = await api.getParameters()
			const values = buildVariableValues(params)

			this.#updateState(values)
			this.setVariableValues(values)
			this.checkFeedbacks(...ALL_FEEDBACKS)

			this.#setError('')
			this.updateStatus(InstanceStatus.Ok)

			if (!this.#hasLoggedSuccess) {
				const webId = params.DB_L2174_WEB_TEXT || 'unnamed'
				const build = params.DB_L2174_BUILD_VERSION ?? 'unknown build'
				this.log('info', `Connected to Lynx L2174 "${webId}" (${build})`)
				this.#hasLoggedSuccess = true
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			this.#hasLoggedSuccess = false

			// Blank the readings rather than leaving stale values on screen —
			// a frozen power reading is worse than an obviously empty one.
			this.#clearState()
			this.setVariableValues(blankVariableValues())
			this.checkFeedbacks(...ALL_FEEDBACKS)

			this.#setError(message)
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
		} finally {
			this.#isPolling = false
		}
	}

	/**
	 * Mirror the values feedbacks need into typed state. Parsing back from the
	 * formatted variable strings keeps one source of truth for the mapping.
	 */
	#updateState(values: Partial<VariablesSchema>): void {
		const toNumber = (value: string | undefined): number | undefined => {
			if (!value) return undefined
			const parsed = Number.parseFloat(value)
			return Number.isFinite(parsed) ? parsed : undefined
		}

		this.state.videoLocked = values.video_locked ?? ''
		this.state.alarmActive = values.alarm_active === 'yes'
		this.state.unitTemperature = toNumber(values.unit_temperature)
		this.state.demodTemperature = toNumber(values.demod_fpga_temperature)
		this.state.decoderTemperature = toNumber(values.decoder_fpga_temperature)
		this.state.cameraBatteryVoltage = toNumber(values.camera_battery_voltage)

		const powers: number[] = []
		const mers: number[] = []
		for (const n of CHANNEL_IDS) {
			this.state.channelLock[n] = values[`channel${n}_lock`]
			const power = toNumber(values[`channel${n}_power`])
			this.state.channelPower[n] = power
			if (power !== undefined) powers.push(power)

			const mer = toNumber(values[`channel${n}_mer`])
			this.state.channelMer[n] = mer
			if (mer !== undefined) mers.push(mer)
		}
		this.state.bestPower = powers.length ? Math.max(...powers) : undefined
		this.state.bestMer = mers.length ? Math.max(...mers) : undefined
	}

	#clearState(): void {
		this.state.channelLock = {}
		this.state.channelPower = {}
		this.state.bestPower = undefined
		this.state.channelMer = {}
		this.state.bestMer = undefined
		this.state.videoLocked = ''
		this.state.alarmActive = false
		this.state.unitTemperature = undefined
		this.state.demodTemperature = undefined
		this.state.decoderTemperature = undefined
		this.state.cameraBatteryVoltage = undefined
	}

	/** Record an error, logging only when it changes so polling can't spam the log. */
	#setError(message: string): void {
		if (message === this.#lastError) return
		this.#lastError = message
		if (message) this.log('error', message)
		this.setVariableValues({ last_error: message })
	}
}
