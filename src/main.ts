import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, guardedActionsEnabled, writesAllowed, type ModuleConfig } from './config.js'
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
import {
	CONDITIONAL_PARAMETERS,
	GUARDED_PARAMETERS,
	LynxApi,
	SAFE_PARAMETERS,
	classifyFailure,
	type ContactFailure,
} from './api.js'
import { CHANNEL_IDS, SETTING_SOURCES } from './types.js'
import { driftedControlIds, unlistedControlParameters } from './controls.js'

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

/**
 * How long to wait before saying a write did not take.
 *
 * Measured on the bench unit, 22.10.2026: an ordinary parameter reads back in
 * about 1.5 s, but a receive-mode change takes up to **20 s** and a bandwidth
 * change following one takes 17 — the receiver re-acquires before it publishes
 * the new value. The mode is not even symmetric: into LMST(S) it lands in
 * 1.2 s, back to DVB-T it takes between 6 and 20 — there is no per-parameter
 * figure to be had, only a generous upper bound. The settling times in docs §6 were measured within one mode
 * and are the short case, not the worst one.
 *
 * Generous on purpose. The warning is a diagnostic, not the feedback that
 * matters: a button that did not take stays un-green from the next poll
 * onwards, which is immediate and visible. A warning that comes late costs
 * little; one that accuses the receiver of rejecting a write it accepted sends
 * someone looking for a fault that is not there.
 *
 * A floor, not the whole answer — the confirmation can only arrive on a poll,
 * so `#verifyWindowMs()` stretches it for connections polling slowly.
 */
const VERIFY_WINDOW_MS = 25000

/**
 * How long `writeAndConfirm` waits for a read-back before giving up.
 *
 * Shorter than the window above because its one caller selects a preset slot,
 * which is a selection and not a reconfiguration — measured at about 1 s. Kept
 * at eight for headroom: too long here means a button that feels stuck, and
 * too short means an action that refuses to do anything.
 */
const CONFIRM_TIMEOUT_MS = 8000

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
		settings: {} as Record<string, string | undefined>,
	}

	#api: LynxApi | null = null
	#pollTimer: NodeJS.Timeout | undefined
	#isPolling = false
	/** Configured interval; the actual gap grows from here while polls fail. */
	#pollIntervalMs = 2000
	#consecutiveFailures = 0
	#lastError = ''
	/**
	 * Writes we are still waiting to see reflected in data.xml, by parameter.
	 *
	 * A map rather than one slot: with a wall of control buttons, two presses
	 * inside the settling window are ordinary, and a single slot meant the
	 * second write silently cancelled the first one's check — including when the
	 * second was a momentary trigger that asks for no check at all.
	 */
	#pendingWrites = new Map<string, { value: string; timer: NodeJS.Timeout }>()
	/**
	 * A value waiting for the previous write to the same parameter to settle.
	 *
	 * At most one per parameter — a third press replaces the second, because
	 * what someone wants is the value they pressed last, not every value they
	 * passed through on the way.
	 */
	#queuedWrites = new Map<string, { value: string; verify: boolean }>()
	/**
	 * Parameters whose write request is out but not yet answered.
	 *
	 * Claimed before the request leaves rather than after it returns: the socket
	 * timeout runs to ten seconds, and two presses inside one round trip would
	 * otherwise both find nothing pending and go out together — the very
	 * sequence the receiver cannot digest.
	 */
	#inFlight = new Set<string>()
	/** Host and port the current client was built for, to spot a real retarget. */
	#connectedTo = ''
	#hasLoggedSuccess = false

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		// The control table and the allowlist are kept by hand on purpose — one
		// describes buttons, the other decides what may be written, and the second
		// must not be derivable from the first. Checked rather than trusted: a row
		// the allowlist does not permit yields an action that looks fine and fails
		// on the press, and the log is a better place to learn that than a show.
		const unlisted = unlistedControlParameters(SAFE_PARAMETERS, GUARDED_PARAMETERS)
		if (unlisted.length) {
			this.log('error', `Control settings the write allowlist does not back: ${unlisted.join(', ')}`)
		}

		// Same idea one level up: the action and option ids are what saved buttons
		// hold, and `actions.ts` casts away the type that would otherwise catch a
		// rename. A drifted id leaves a button that looks right and does nothing.
		const drifted = driftedControlIds()
		if (drifted.length) {
			this.log('error', `Control actions renamed without an upgrade script: ${drifted.join(', ')}`)
		}

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#connect()
	}

	async destroy(): Promise<void> {
		this.#stopPolling()
		this.#forgetPendingWrites(true)
		this.#api?.destroy()
		this.#api = null
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		// The action list depends on two switches — read-only and the interrupting
		// actions — so it has to be rebuilt rather than only reconnected.
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
	 * of lagging until the next scheduled poll. For the two slow parameters —
	 * receive mode, and bandwidth right after a mode change — even that is not
	 * enough, which is what the third catch-up poll below is for.
	 */
	async writeParameter(name: string, value: string, verify = true): Promise<void> {
		const api = this.#api
		if (!api) throw new Error('Not connected to a receiver')

		// One write per parameter at a time. Measured on the bench: writing four
		// values to `DB_L2174_VIDEO_INPUT_MODE` in quick succession left the
		// receiver on none of them, and spacing them five seconds apart left it
		// on the *first* — it reconfigures the decoder on each one and does not
		// queue them reliably. So a second press waits for the first to be seen,
		// and the last one wins, which is what pressing a button twice means.
		//
		// Self-limiting rather than a fixed delay: an ordinary parameter reads
		// back in about 1.5 s and the wait is over, while receive mode holds the
		// slot for its full twenty. Momentary triggers ask for no read-back, so
		// they never hold anything up.
		// Only verified writes take part. A momentary trigger asks for no
		// read-back, so it never holds a slot and must never wait for one —
		// `writeAndConfirm` runs its own confirmation and would otherwise poll
		// for a value this method had quietly queued instead of sending.
		if (verify && (this.#inFlight.has(name) || this.#pendingWrites.has(name))) {
			this.#queuedWrites.set(name, { value, verify })
			this.log('debug', `${name} is still settling; ${value} will follow`)
			return
		}

		// Which receiver this write is going to. The request below can be in
		// flight for up to the socket timeout, and the connection can be pointed
		// somewhere else in the meantime — in which case there is nothing left to
		// read this value back from, and the pending check must not be created.
		const target = this.#connectedTo
		// Logged after the fact, not before: `setParameter` refuses anything
		// outside the allowlist, and a line saying "Setting X = Y" above that
		// refusal would claim an effect that never happened.
		if (verify) this.#inFlight.add(name)
		try {
			await api.setParameter(name, value)
		} finally {
			this.#inFlight.delete(name)
			// A throw leaves nothing pending, so whatever was queued behind this
			// write would wait for a release that never comes.
			if (!this.#pendingWrites.has(name)) this.#flushQueued(name)
		}
		this.log('info', `Setting ${name} = ${value}`)
		if (this.#connectedTo !== target) {
			this.log('warn', `${name} was set on a receiver this connection no longer points at; not checking it`)
			return
		}

		// Momentary triggers ('Yes' on preset recall, store and reboot) drop back
		// to 'No' the moment the receiver acts on them, so reading them back would
		// warn on every success — the opposite of what the check is for. Only this
		// parameter's own check is dropped; others stay pending.
		this.#forgetPendingWrite(name)
		if (verify) {
			// iframe.php answers 200 even when it discards the value, so the only
			// honest confirmation is reading it back. Say so when it did not take,
			// rather than leaving someone to press the button a second time.
			this.#armVerifyTimer(name, value, true)
		}

		// Measured on the bench: most parameters read back in about 1.5 s, but a
		// receive-mode change takes up to 20 s and a bandwidth change following
		// one about 17 — the receiver re-acquires first. Three catch-up polls
		// rather than one guessed delay: the first two keep an ordinary button
		// feeling immediate, the third is there for the slow pair, so they do not
		// have to wait for the next scheduled poll to turn green.
		setTimeout(() => void this.#poll(), 1200)
		setTimeout(() => void this.#poll(), 3500)
		setTimeout(() => void this.#poll(), 21000)
	}

	/**
	 * Arm the "did that take?" warning for one parameter.
	 *
	 * The settling times measured on the bench run to 3 s, and a poll can be in
	 * flight for longer than that again. Firing the warning while the answer is
	 * still on its way would accuse the receiver of rejecting a write it
	 * accepted — and the warning cannot be taken back once logged. So when a
	 * poll is running, give it one more round before saying anything.
	 */
	#armVerifyTimer(name: string, value: string, mayRetry: boolean): void {
		const timer = setTimeout(() => {
			if (mayRetry && this.#isPolling) {
				// Replaces the entry rather than removing it, so the slot stays
				// claimed and nothing queued behind it is released early.
				this.#armVerifyTimer(name, value, false)
				return
			}
			this.log('warn', `${name} still does not read ${JSON.stringify(value)} — the receiver may have rejected it`)
			// Through the one door, so a value waiting behind this one is sent
			// rather than left in the queue — where a later press would find it
			// and overwrite itself with it.
			this.#forgetPendingWrite(name)
		}, this.#verifyWindowMs())
		timer.unref?.()
		this.#pendingWrites.set(name, { value, timer })
	}

	/**
	 * How long to wait before warning, for this connection's poll interval.
	 *
	 * The read-back can only arrive on a poll. At the default two seconds the
	 * fixed window is far longer than it needs to be, but a connection set to
	 * poll every 60 s would otherwise be warned at 25 s — before the poll that
	 * would have confirmed the write had even run.
	 */
	#verifyWindowMs(): number {
		return Math.max(VERIFY_WINDOW_MS, this.#pollIntervalMs * 2 + 5000)
	}

	/**
	 * Write a value and wait until the receiver reports it back.
	 *
	 * For the two-step actions, where the second step acts on whatever the first
	 * one selected. `iframe.php` answers 200 even when it discards the value, so
	 * "the request went through" is not an answer to "is the right slot
	 * selected" — and storing into the wrong slot cannot be undone.
	 */
	async writeAndConfirm(
		name: string,
		value: string,
		matches: (reading: string | undefined) => boolean = (reading) => reading === value,
		timeoutMs = CONFIRM_TIMEOUT_MS,
	): Promise<boolean> {
		// No verify timer: the loop below is the better check, and arming both
		// would warn twice about one rejected write — the second time long after
		// the caller has already said what happened.
		await this.writeParameter(name, value, false)

		const api = this.#api
		if (!api) return false
		const target = this.#connectedTo
		const deadline = Date.now() + timeoutMs

		// The receiver republishes data.xml on its own one-second timer, so there
		// is nothing to gain from asking faster than that.
		while (Date.now() < deadline) {
			// Capped at the deadline so a slow read cannot stretch the wait well
			// past it — the receiver's own republish interval is one second, so
			// there is nothing to gain from asking faster.
			await new Promise((resolve) => setTimeout(resolve, Math.min(900, Math.max(0, deadline - Date.now()))))
			if (this.#connectedTo !== target) return false
			try {
				const params = await api.getParameters()
				// Checked again on this side of the await: a read can be in flight
				// while the connection is pointed elsewhere, and an answer from the
				// old receiver must not confirm a write for the new one.
				if (this.#connectedTo !== target) return false
				if (matches(params[name])) return true
			} catch {
				// A failed read here is not an answer either way; the loop simply
				// runs out of time and the caller stops.
			}
		}

		return false
	}

	/** Stop waiting on one parameter, without touching the others. */
	#forgetPendingWrite(name: string): void {
		const pending = this.#pendingWrites.get(name)
		if (!pending) return
		clearTimeout(pending.timer)
		this.#pendingWrites.delete(name)

		// Whatever was pressed while this one was settling goes out now.
		this.#flushQueued(name)
	}

	/** Send the value that was waiting for this parameter, if there is one. */
	#flushQueued(name: string): void {
		const queued = this.#queuedWrites.get(name)
		if (!queued) return
		this.#queuedWrites.delete(name)
		void this.writeParameter(name, queued.value, queued.verify).catch((e) =>
			this.log('error', `Could not set ${name}: ${e instanceof Error ? e.message : String(e)}`),
		)
	}

	/** Stop waiting on everything — the receiver is gone or the address changed. */
	#forgetPendingWrites(dropQueued = false): void {
		for (const pending of this.#pendingWrites.values()) clearTimeout(pending.timer)
		this.#pendingWrites.clear()

		if (!dropQueued) return
		// Only when the connection has been pointed somewhere else, or taken
		// down: these values were meant for a receiver this connection is no
		// longer talking to. A single failed poll is not that — the backoff
		// treats one dropped answer as ordinary, and so should a press that is
		// waiting its turn.
		for (const [name, queued] of this.#queuedWrites) {
			this.log('debug', `Dropping queued ${name} = ${queued.value}: the connection moved`)
		}
		this.#queuedWrites.clear()
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
		// A write still waiting on the old address would otherwise be confirmed,
		// or denied, by a different box. Tied to the address actually changing:
		// `#connect()` also runs when only the poll interval or the guarded switch
		// moved, and dropping the checks there would lose the one warning that
		// explains why a button did not take.
		const target = `${host ?? ''}:${this.config.port || 80}`
		if (target !== this.#connectedTo) this.#forgetPendingWrites(true)
		this.#connectedTo = target

		if (!host) {
			// Without this the previous client survives: the buttons would keep the
			// last good poll's colours for ever, and — worse — an action would still
			// write to the address that was just removed from the form.
			this.#api?.destroy()
			this.#api = null
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
			allowWrites: writesAllowed(this),
			allowGuardedWrites: guardedActionsEnabled(this),
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

			for (const [name, pending] of this.#pendingWrites) {
				if (params[name] === pending.value) {
					this.#forgetPendingWrite(name)
				} else if (params[name] === undefined && CONDITIONAL_PARAMETERS.has(name)) {
					// Absent is not the same as rejected — for these two. They swap
					// places in data.xml with the pin mode, and a write to the one
					// currently out of view is taken all the same, so there is nothing
					// to check it against. Narrowed to the named pair on purpose: any
					// parameter can be missing from a short answer, and treating that
					// as "never mind" would cancel every pending check at once.
					this.log('debug', `${name} is not in data.xml in this mode, so the write cannot be confirmed`)
					this.#forgetPendingWrite(name)
				}
			}

			// Anything still waiting with nothing pending in front of it — a write
			// that failed while the receiver was away, or a queue that outlived a
			// dropped answer. This is the point at which we know contact is back.
			for (const name of [...this.#queuedWrites.keys()]) {
				if (!this.#pendingWrites.has(name) && !this.#inFlight.has(name)) this.#flushQueued(name)
			}

			this.#consecutiveFailures = 0
			this.state.contact = 'ok'
			this.#setError('')
			// Named in the status rather than left to be discovered: a control
			// button under read-only looks exactly as it did and simply does
			// nothing, and the connection list is where someone looks first.
			this.updateStatus(InstanceStatus.Ok, writesAllowed(this) ? null : 'Read only')

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
			this.#forgetPendingWrites()

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

		for (const source of SETTING_SOURCES) {
			// A parameter the receiver did not report arrives as '' from
			// `buildVariableValues`. Keep that as "we do not know" rather than as a
			// value, so a control button cannot read as selected on the strength of
			// two empty strings matching.
			this.state.settings[source.id] = values[source.variable as keyof VariablesSchema] || undefined
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
