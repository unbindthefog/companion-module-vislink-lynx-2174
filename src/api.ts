import http from 'node:http'
import type { RawParameters } from './types.js'

export type ApiLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ApiLogger = (level: ApiLogLevel, message: string) => void

export type LynxApiOptions = {
	host: string
	port: number
	timeoutMs: number
	/** Whether this connection may write at all. False turns the client into a reader. */
	allowWrites: boolean
	/** Whether the interrupting writes in GUARDED_PARAMETERS are permitted. */
	allowGuardedWrites: boolean
}

/**
 * Who is it that does not know?
 *
 * A receiver that does not answer is a confirmed fault — something is wrong
 * with the receiver. But when the failure is our own end having no way there
 * (no route, no interface, no free local port), the receiver's state is simply
 * unknown to us, and reporting that as a fault sends people looking in the
 * wrong place. The distinction is already present in the error code; it just
 * needs to survive the trip to the feedbacks.
 *
 * Carried but not yet acted on: `readingIsUnknown` currently greys both cases
 * alike. The groundwork is here for the day that distinction earns its own
 * colour.
 */
export type ContactFailure = 'no-path-from-here' | 'receiver-not-answering'

export function classifyFailure(code: string | undefined): ContactFailure {
	switch (code) {
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
		case 'EADDRNOTAVAIL':
		case 'EADDRINUSE':
		case 'ENOTFOUND':
			// Our machine cannot even pose the question.
			return 'no-path-from-here'
		default:
			// ETIMEDOUT, ECONNREFUSED, ECONNRESET, EHOSTDOWN: the question was
			// asked and the receiver did not answer properly.
			return 'receiver-not-answering'
	}
}

/**
 * Translate low level socket errors into something a user can act on.
 */
function friendlyError(err: NodeJS.ErrnoException, host: string, path: string): string {
	switch (err.code) {
		case 'ENOTFOUND':
			return `Host not found (${host})`
		case 'ECONNREFUSED':
			// Not only a wrong port: a receiver that is restarting refuses for
			// about a second and a half before its web server is up again.
			return `Nothing is listening on ${host} — the receiver may be restarting, or the port may be wrong`
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return `Host unreachable (${host}) — check network/VLAN`
		case 'EADDRINUSE':
			// Seen for real: with the receiver unreachable overnight, retries piled
			// up until the machine ran out of ephemeral ports. The backoff in
			// main.ts is what stops that happening; this just names it clearly.
			return `No local port free for ${host} — too many connection attempts are still open on this machine`
		case 'EADDRNOTAVAIL':
			return `No route to ${host} from this machine — check which network interface is active`
		case 'ETIMEDOUT':
		case 'ESOCKETTIMEDOUT':
			return `Timed out reaching ${host}${path ? ` for ${path}` : ''}`
		case 'ECONNRESET':
			return `Connection reset by ${host}`
		default:
			return `${err.message}${path ? ` (${path})` : ''}`
	}
}

/**
 * Pull every `<name>`/`<value>` pair out of the receiver's `data.xml`.
 *
 * The file is deliberately not run through a real XML parser: every value is
 * wrapped in `<![CDATA[...]]>` and the document has no nesting, so a small
 * regex is both sufficient and avoids adding a dependency for a device that
 * otherwise needs none.
 */
export function parseParameters(xml: string): RawParameters {
	const result: RawParameters = {}
	const re = /<parameter>\s*<name>(.*?)<\/name>\s*<value>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/value>/g
	let match: RegExpExecArray | null
	while ((match = re.exec(xml))) {
		const name = match[1].trim()
		const value = (match[2] ?? match[3] ?? '').trim()
		result[name] = value
	}
	return result
}

/**
 * Minimal read-only client for the L2174's `data.xml`.
 *
 * Requests are serialized through a single-socket keep-alive agent so a slow
 * response can never cause overlapping polls to pile up on the receiver — the
 * same approach as the Sapphire RXD4 module, even though this device has no
 * TLS and no REST API to speak of.
 */
/**
 * The only parameters this module will ever write.
 *
 * A denylist was the first instinct and the wrong shape. The receiver defines
 * 290 parameters, accepts writes to any of them without authentication, and its
 * own guard (`check_for_invalid_setting_attempt`) is inherited from a different
 * Vislink product and does nothing here. A list of forbidden names therefore
 * permits everything nobody thought of — and something had indeed not been
 * thought of: `DB_DECOD_COMMAND` offers a `Reboot` option, reaching exactly what
 * blocking `DB_L2174_REBOOT` was meant to prevent. `DB_IP_ADDRESS` is worse than
 * a reboot; a reboot comes back.
 *
 * Inverted, the failure mode inverts with it: a parameter nobody listed is
 * refused instead of obeyed. Adding one is then a deliberate act.
 *
 * Names are matched trimmed and upper-cased, so a stray space cannot slip past.
 *
 * What is absent is absent on purpose: restoring defaults wipes the
 * configuration, licence and key entry can break the licensing, and
 * `DB_IP_ADDRESS` takes the receiver off the network in a way only someone
 * standing in front of it can undo. None of those belong on a button, so they
 * are simply not listed — which under an allowlist is all it takes.
 */
export const SAFE_PARAMETERS: ReadonlySet<string> = new Set([
	// RF
	'DB_L2174_FREQ1',
	'DB_L2174_CHAN_BW',
	'DB_L2174_RX_MODE',
	'DB_DEMOD_GUARD_INT',
	'DB_DEMOD_SPEC_POL',
	'DB_DEMOD_ENABLE_1',
	'DB_DEMOD_ENABLE_2',
	'DB_DEMOD_ENABLE_3',
	'DB_DEMOD_ENABLE_4',
	// Not a hardware risk itself, but it decides how far the others reach.
	'DB_L2174_SET_ALL',

	// Routing
	'DB_DEMOD_ASI1_OUTPUT_MUX',
	'DB_DEMOD_ASI2_OUTPUT_MUX',
	'DB_DEMOD_IP1_OUTPUT_MUX',
	'DB_L2174_DEMOD_DIVERSITY',
	'DB_L2174_ASI_DIVERSITY',
	'DB_DEMOD_DIV_DELAY',

	// Video
	'DB_L2174_VIDEO_INPUT_MODE',
	'DB_DECOD_GEN_LOCK',
	'DB_DECOD_FREEZE_ON_LOSS',
	'DB_DECOD_VIDEO_A_TYPE',
	'DB_DECOD_VIDEO_B_TYPE',
	'DB_DECOD_OVERLAY_TYPE',
	'DB_DECOD_OVERLAY_BACKGROUND',
	'DB_DECOD_OVERLAY_ENABLE',

	// Unit
	'DB_STATUS_PIN_MODE',
	'DB_STATUS_PIN_STATE',
	'DB_STATUS_PIN_ALARM_LEVEL',
	'DB_L2174_WEB_TEXT',
])

/**
 * Parameters the receiver publishes only sometimes.
 *
 * `data.xml` does not carry a fixed set. The status pin's current level and the
 * level it takes when alarmed swap places with `DB_STATUS_PIN_MODE`: whichever
 * is in effect is readable, the other is simply not there. Both are written
 * successfully in either mode — it is the reading that comes and goes.
 *
 * Listed here because "absent" then means "cannot be checked", not "rejected".
 * Deliberately a short, named list rather than a rule about absence in general:
 * a truncated or empty response would otherwise quietly cancel every pending
 * check at once.
 */
export const CONDITIONAL_PARAMETERS: ReadonlySet<string> = new Set(['DB_STATUS_PIN_STATE', 'DB_STATUS_PIN_ALARM_LEVEL'])

/**
 * Writes that interrupt the receiver, available only while the connection's
 * "guarded actions" switch is on.
 *
 * Recalling a preset reconfigures the whole receiver at once and a reboot takes
 * it away for about twenty seconds — both are legitimate remote-hands
 * operations and both
 * are the wrong thing to hit by accident mid-show. The switch is off by default,
 * and while it is off these actions are not offered at all rather than offered
 * and ignored.
 */
export const GUARDED_PARAMETERS: ReadonlySet<string> = new Set([
	// Puts DC on an antenna input. Whatever is on the far end of that coax gets
	// it, so this is a hardware risk rather than only an interruption — the one
	// thing behind this switch that is not about going off air.
	'DB_L2174_LNB_PWR_1',
	'DB_L2174_LNB_PWR_2',
	'DB_L2174_LNB_PWR_3',
	'DB_L2174_LNB_PWR_4',

	'DB_L2174_PRESET_NUM',
	'DB_L2174_PRESET_RECALL',
	'DB_L2174_PRESET_STORE',
	'DB_L2174_REBOOT',
])

export class LynxApi {
	#options: LynxApiOptions
	#log: ApiLogger
	#agent: http.Agent | null = null
	#queue: Promise<unknown> = Promise.resolve()
	#pending = 0

	constructor(options: LynxApiOptions, log: ApiLogger) {
		this.#options = options
		this.#log = log
		this.resetAgent()
	}

	/** Number of in-flight requests, used to avoid queueing up polls. */
	get pending(): number {
		return this.#pending
	}

	updateOptions(options: LynxApiOptions): void {
		this.#options = options
		this.resetAgent()
	}

	resetAgent(): void {
		this.destroy()
		this.#agent = new http.Agent({
			keepAlive: true,
			keepAliveMsecs: 1000,
			maxSockets: 1,
		})
	}

	destroy(): void {
		this.#agent?.destroy()
		this.#agent = null
	}

	/** GET `/data.xml` and return it parsed into a flat name → value map. */
	/**
	 * Set one parameter.
	 *
	 * The receiver's write path is a GET with a query string — the same shape as
	 * a read, which is precisely why the refusal above sits here rather than
	 * being left to callers to remember.
	 */
	async setParameter(name: string, value: string): Promise<void> {
		const key = name.trim().toUpperCase()
		const path = `/common/iframe.php?param=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`

		// Refused here, and then again when the request actually leaves — see
		// `#refuseWrite`. Checking only at this point would let a press that is
		// already sitting in the queue go out after the connection has been set
		// to read only, or after it has been pointed at a different receiver.
		const refusal = this.#refuseWrite(key)
		if (refusal) throw new Error(`Refusing to write ${name}: ${refusal}`)

		await this.#get(path, () => {
			const late = this.#refuseWrite(key)
			if (late) throw new Error(`Refusing to write ${name}: ${late}`)
			// The receiver this write was meant for. Between the press and the
			// request leaving, the connection can have been pointed somewhere
			// else, and the value would land on a receiver nobody aimed at.
			return `${this.#options.host}:${this.#options.port}`
		})
	}

	/**
	 * Why this parameter may not be written, or `undefined` if it may.
	 *
	 * Three guards, outermost first. Read-only is a statement about the receiver
	 * rather than about the parameter, so it comes before the allowlist: with it
	 * on there is no parameter this connection may change.
	 */
	#refuseWrite(key: string): string | undefined {
		if (!this.#options.allowWrites) return 'this connection is set to read only'
		if (SAFE_PARAMETERS.has(key)) return undefined
		if (!GUARDED_PARAMETERS.has(key)) return 'not one of the parameters this module may change'
		if (!this.#options.allowGuardedWrites) return 'enable "guarded actions" in the connection config first'
		return undefined
	}

	async getParameters(): Promise<RawParameters> {
		const body = await this.#get('/data.xml')
		const params = parseParameters(body)
		// An answer that parses to nothing is not an empty receiver, it is not
		// data.xml — a truncated body, a captive portal, something else on that
		// address. Treated as a failed read rather than as a successful poll that
		// happens to know nothing, which would blank every variable and call the
		// contact good at the same time.
		if (Object.keys(params).length === 0) {
			throw new Error('The answer to /data.xml contained no parameters')
		}
		return params
	}

	/**
	 * Queue a request. `beforeSend` runs once this request is the one going out.
	 *
	 * That is the only moment at which "may this happen, and to whom" can be
	 * answered honestly: the queue is serial and a slow receiver can hold a
	 * request behind a poll for as long as the socket timeout, which is ample
	 * time for someone to change the connection's mind. It returns the target
	 * it checked against, so `#run` cannot read a newer one.
	 */
	async #get(path: string, beforeSend?: () => string): Promise<string> {
		const run = async () => this.#run(path, beforeSend?.())
		const request = this.#queue.then(run, run)

		// Keep the queue alive even if a caller lets the rejection propagate.
		this.#queue = request.catch(() => undefined)

		return request
	}

	async #run(path: string, checkedTarget?: string): Promise<string> {
		const { host, port, timeoutMs } = this.#options

		if (!host) throw new Error('No receiver address configured')
		// Belt and braces: `beforeSend` has just read these, so a mismatch would
		// mean they changed inside this tick, which they cannot. Cheap enough to
		// keep as the thing that makes the guarantee local to the send.
		if (checkedTarget !== undefined && checkedTarget !== `${host}:${port}`) {
			throw new Error('Refusing to write: the connection was pointed at a different receiver')
		}

		this.#pending++
		try {
			return await new Promise<string>((resolveRaw, rejectRaw) => {
				// `req.setTimeout` below is a *socket* timeout: it only starts once the
				// agent hands this request a socket. With maxSockets: 1 a request can
				// instead sit in the agent's queue — which is exactly what happened in
				// testing when the agent was reset mid-flight, leaving a poll that never
				// settled and a poll loop that silently stopped for good. This watchdog
				// does not care whether a socket was ever assigned.
				// Held in an object because the settle helpers below close over it
				// before the timer itself can be created — the timer needs `req`.
				const watchdog: { timer?: NodeJS.Timeout } = {}
				const resolve = (value: string) => {
					clearTimeout(watchdog.timer)
					resolveRaw(value)
				}
				const reject = (error: Error) => {
					clearTimeout(watchdog.timer)
					rejectRaw(error)
				}

				const req = http.request(
					{
						host,
						port,
						path,
						method: 'GET',
						agent: this.#agent ?? undefined,
						headers: {
							Accept: 'text/xml',
							'User-Agent': 'Bitfocus-Companion/vislink-lynx-2174',
						},
					},
					(res) => {
						let data = ''
						res.setEncoding('utf8')
						res.on('data', (chunk) => (data += chunk))
						res.on('error', reject)
						res.on('end', () => {
							const status = res.statusCode ?? 0
							if (status >= 200 && status < 300) {
								resolve(data)
							} else {
								reject(new Error(`HTTP ${status} for ${path}`))
							}
						})
					},
				)

				req.setTimeout(timeoutMs, () => {
					req.destroy(new Error(`Request timed out after ${timeoutMs} ms (${path})`))
				})
				req.on('error', reject)

				watchdog.timer = setTimeout(() => {
					req.destroy(new Error(`Request gave up after ${timeoutMs} ms without a socket (${path})`))
					// If the request never got a socket, destroying it emits nothing, so
					// settle here rather than trusting the error event to arrive.
					reject(new Error(`Request timed out after ${timeoutMs} ms (${path})`))
				}, timeoutMs)
				watchdog.timer.unref?.()

				req.end()
			})
		} catch (err) {
			const error: NodeJS.ErrnoException = err instanceof Error ? err : new Error(String(err))
			const message = friendlyError(error, host, path)

			// A reset socket usually means the keep-alive connection went stale.
			const code = error.code
			if (code === 'ECONNRESET' || code === 'EPIPE') {
				this.#log('debug', `Resetting HTTP agent after ${code}`)
				this.resetAgent()
			}

			error.message = message
			throw error
		} finally {
			this.#pending--
		}
	}
}
