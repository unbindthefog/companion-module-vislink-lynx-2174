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
import { LynxApi, classifyFailure, type ContactFailure } from './api.js'
import { CHANNEL_IDS, SETTING_SOURCES, type SettingId } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

/** Longest we ever wait between polls while the receiver is unreachable. */
const BACKOFF_MAX_MS = 30_000

/**
 * How long to wait before the next poll.
 *
 * A healthy connection polls at the configured interval. Once polls start
 * failing the gap doubles each time, capped, so a receiver that is rebooting or
 * already struggling is not knocked on every two seconds indefinitely. The
 * first retry still comes at the normal interval, so a single dropped packet
 * costs nothing in recovery time.
 */
export function pollDelayMs(baseMs: number, consecutiveFailures: number): number {
	if (consecutiveFailures <= 0) return baseMs
	// The cap never pulls the gap below what the user configured: someone who
	// asked for a poll every 60 s does not want failures speeding that up.
	const cap = Math.max(BACKOFF_MAX_MS, baseMs)
	return Math.min(baseMs * 2 ** (consecutiveFailures - 1), cap)
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig

	/** Cached device state that feedbacks read from. */
	state = {
		/**
		 * Whether we currently know anything at all, and if not, whose fault the
		 * not-knowing is. A receiver that does not answer is a fault; our own end
		 * having no route there is merely ignorance. The distinction is recorded
		 * here but not yet acted on — `readingIsUnknown` greys both alike for now.
		 */
		contact: 'no-reading-yet' as 'no-reading-yet' | 'ok' | ContactFailure,
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
		/**
		 * What the receiver currently has selected, for the control buttons to
		 * match themselves against. Keyed the way `SETTING_SOURCES` names them.
		 */
		settings: {} as Partial<Record<SettingId, string>>,
	}

	#api: LynxApi | null = null
	#pollTimer: NodeJS.Timeout | undefined
	#isPolling = false
	/** Configured interval; the actual gap grows from here while polls fail. */
	#pollIntervalMs = 2000
	#consecutiveFailures = 0
	#lastError = ''
	/** The write we are still waiting to see reflected in data.xml. */
	#pendingWrite: { name: string; value: string } | undefined
	#writeWatchdog: NodeJS.Timeout | undefined
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
		clearTimeout(this.#writeWatchdog)
		this.#pendingWrite = undefined
		this.#api?.destroy()
		this.#api = null
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		// The guarded actions appear and disappear with the switch, so the list has
		// to be rebuilt rather than only reconnected.
		this.updateActions()
		// And the presets that hand them out, so the two lists never disagree about
		// which actions exist. Buttons that already carry a removed action are a
		// separate matter — those go quiet until the switch comes back on.
		this.updatePresets()
		this.#connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	/**
	 * Write one parameter on behalf of an action, then refresh.
	 *
	 * The receiver rewrites data.xml on its own one-second timer, so a poll
	 * straight after the write would still read the old value. Waiting for that
	 * tick and then polling means the button reflects what it just did, instead
	 * of lagging until the next scheduled poll.
	 */
	async writeParameter(name: string, value: string, verify = true): Promise<void> {
		const api = this.#api
		if (!api) throw new Error('Not connected to a receiver')

		this.log('info', `Setting ${name} = ${value}`)
		await api.setParameter(name, value)
		// Momentary triggers ('Yes' on preset recall, store and reboot) drop back
		// to 'No' the moment the receiver acts on them, so reading them back would
		// warn on every success — the opposite of what the check is for.
		this.#pendingWrite = verify ? { name, value } : undefined

		// Measured on the bench: the receiver takes between 0.3 s and 3 s to
		// apply a write and publish it in data.xml, depending on the parameter —
		// changing the channel bandwidth is the slow one. Poll twice rather than
		// guess a single delay: the early one keeps the button feeling immediate,
		// the later one catches whatever had not settled yet.
		setTimeout(() => void this.#poll(), 1200)
		setTimeout(() => void this.#poll(), 3500)

		// iframe.php answers 200 even when it discards the value, so the only
		// honest confirmation is reading it back. Say so when it did not take,
		// rather than leaving someone to press the button a second time.
		setTimeout(() => {
			const pending = this.#pendingWrite
			if (!pending) return
			this.#pendingWrite = undefined
			this.log(
				'warn',
				`${pending.name} still does not read ${JSON.stringify(pending.value)} — the receiver may have rejected it`,
			)
		}, 4500)
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
			// Without this the previous client survives: the buttons would keep the
			// last good poll's colours for ever, and — worse — an action would still
			// write to the address that was just removed from the form.
			this.#api?.destroy()
			this.#api = null
			clearTimeout(this.#writeWatchdog)
			this.#pendingWrite = undefined
			this.state.contact = 'no-reading-yet'
			this.#clearState()
			this.setVariableValues(blankVariableValues())
			this.checkFeedbacks(...ALL_FEEDBACKS)
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
			allowGuardedWrites: this.config.allowGuardedActions === true,
		}

		if (this.#api) {
			this.#api.updateOptions(options)
		} else {
			this.#api = new LynxApi(options, (level, message) => this.log(level, message))
		}

		this.#hasLoggedSuccess = false
		this.state.contact = 'no-reading-yet'
		this.#pollIntervalMs = pollInterval
		this.#consecutiveFailures = 0
		this.updateStatus(InstanceStatus.Connecting)

		// Each poll schedules the next one when it finishes, so a slow response
		// delays the following request instead of stacking up behind it.
		void this.#poll()
	}

	#scheduleNextPoll(): void {
		this.#stopPolling()
		// A poll already in flight when the instance is destroyed still runs its
		// finally block; without this it would leave a timer behind.
		if (!this.#api) return
		this.#pollTimer = setTimeout(
			() => {
				void this.#poll()
			},
			pollDelayMs(this.#pollIntervalMs, this.#consecutiveFailures),
		)
	}

	#stopPolling(): void {
		if (this.#pollTimer) {
			clearTimeout(this.#pollTimer)
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

			const pending = this.#pendingWrite
			if (pending && params[pending.name] === pending.value) this.#pendingWrite = undefined

			this.#consecutiveFailures = 0
			this.state.contact = 'ok'
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
			const failure = classifyFailure((e as NodeJS.ErrnoException)?.code)
			this.#hasLoggedSuccess = false
			// The lost connection is already reported; a write that went unconfirmed
			// because of it does not need a second line saying the same thing.
			this.#pendingWrite = undefined

			// Blank the readings rather than leaving stale values on screen —
			// a frozen power reading is worse than an obviously empty one.
			this.#clearState()
			this.state.contact = failure
			this.setVariableValues(blankVariableValues())
			this.checkFeedbacks(...ALL_FEEDBACKS)

			this.#consecutiveFailures++
			const retryInMs = pollDelayMs(this.#pollIntervalMs, this.#consecutiveFailures)

			// The log line dedupes on the message, so keep the countdown out of
			// it and show it in the status instead, where it can change freely.
			this.#setError(message)
			this.updateStatus(InstanceStatus.ConnectionFailure, `${message} — retrying in ${Math.round(retryInMs / 1000)}s`)
			if (retryInMs > this.#pollIntervalMs) {
				this.log('debug', `Backing off after ${this.#consecutiveFailures} failed polls: next try in ${retryInMs} ms`)
			}
		} finally {
			this.#isPolling = false
			this.#scheduleNextPoll()
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

		for (const [id, source] of Object.entries(SETTING_SOURCES)) {
			// A parameter the receiver did not report arrives as '' from
			// `buildVariableValues`. Keep that as "we do not know" rather than as a
			// value, so a control button cannot read as selected on the strength of
			// two empty strings matching.
			this.state.settings[id as SettingId] = values[source.variable] || undefined
		}
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
		this.state.settings = {}
	}

	/** Record an error, logging only when it changes so polling can't spam the log. */
	#setError(message: string): void {
		if (message === this.#lastError) return
		this.#lastError = message
		if (message) this.log('error', message)
		this.setVariableValues({ last_error: message })
	}
}
