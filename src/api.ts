import http from 'node:http'
import type { RawParameters } from './types.js'

export type ApiLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ApiLogger = (level: ApiLogLevel, message: string) => void

export type LynxApiOptions = {
	host: string
	port: number
	timeoutMs: number
}

/**
 * Translate low level socket errors into something a user can act on.
 */
function friendlyError(err: NodeJS.ErrnoException, host: string, path: string): string {
	switch (err.code) {
		case 'ENOTFOUND':
			return `Host not found (${host})`
		case 'ECONNREFUSED':
			return `Connection refused by ${host} — is the port correct?`
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
	async getParameters(): Promise<RawParameters> {
		const body = await this.#get('/data.xml')
		return parseParameters(body)
	}

	async #get(path: string): Promise<string> {
		const request = this.#queue.then(
			async () => this.#run(path),
			async () => this.#run(path),
		)

		// Keep the queue alive even if a caller lets the rejection propagate.
		this.#queue = request.catch(() => undefined)

		return request
	}

	async #run(path: string): Promise<string> {
		const { host, port, timeoutMs } = this.#options

		if (!host) throw new Error('No receiver address configured')

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
