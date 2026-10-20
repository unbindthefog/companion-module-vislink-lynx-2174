import type ModuleInstance from './main.js'

/**
 * What this module will change on the receiver.
 *
 * The device exposes 39 writable parameters through its own web forms, and
 * every one of them is a plain `GET` with no authentication. That makes the
 * question "which of these belong in a Companion button" a safety question
 * rather than a convenience one: a button is pressed by someone mid-show who
 * is looking at a camera, not at a confirmation dialog.
 *
 * Six actions change how the receiver listens and are always available. Three
 * more interrupt reception — preset recall, preset store and reboot — and are
 * registered as `undefined` unless the connection's "interrupting actions"
 * switch is on, so they are absent from the list rather than present and
 * ignored. Restoring defaults, licence entry and key material are refused in
 * `api.ts` whatever the switch says: a reboot comes back, a wiped configuration
 * does not.
 */

/** Options the receiver accepts, from docs/LYNX_L2174_API.md §3.2. */
const BANDWIDTHS = ['3MHz', '4MHz', '5MHz', '6MHz', '7MHz', '8MHz', '10MHz', '12MHz']
const RX_MODES = ['DVBT', 'LMST(S)', 'LMST(D)']
const ON_OFF = ['Off', 'On']
const DECODER_SOURCES = ['Ext ASI', 'Demodulator', 'Diversity', 'IP']

export type ActionsSchema = {
	set_frequency: { options: { frequency: number } }
	set_bandwidth: { options: { bandwidth: string } }
	set_rx_mode: { options: { mode: string } }
	set_decoder_source: { options: { source: string } }
	set_demod_diversity: { options: { state: string } }
	set_web_id: { options: { text: string } }
	recall_preset: { options: { preset: number } }
	store_preset: { options: { preset: number } }
	reboot_receiver: { options: Record<string, never> }
}

// Generic over the id so it stays a literal: the SDK ties each option's id to
// the key in ActionsSchema, which is what catches a field the schema never
// declared — widen it to `string` and that safety net is gone.
function dropdown<K extends string>(id: K, label: string, choices: string[], fallback: string) {
	return {
		type: 'dropdown' as const,
		id,
		label,
		default: fallback,
		choices: choices.map((c) => ({ id: c, label: c })),
	}
}

export function UpdateActions(self: ModuleInstance): void {
	/**
	 * Every action funnels through here, so logging stays in one place.
	 *
	 * Returns whether it worked. That matters for the two-step preset actions: a
	 * catch that only logs makes a failure invisible to the caller, and a chain
	 * that carries on regardless would trigger the slot the receiver happens to
	 * have selected — overwriting the wrong preset, in the case of store.
	 */
	const write = async (name: string, value: string, verify = true): Promise<boolean> => {
		try {
			await self.writeParameter(name, value, verify)
			return true
		} catch (e) {
			self.log('error', `Could not set ${name}: ${e instanceof Error ? e.message : String(e)}`)
			return false
		}
	}

	const guarded = self.config?.allowGuardedActions === true

	self.setActionDefinitions({
		set_frequency: {
			name: 'Set receive frequency',
			description: 'Retunes the demodulator. The link drops until the transmitter matches.',
			options: [
				{
					type: 'number',
					id: 'frequency',
					label: 'Frequency (GHz)',
					default: 2.325,
					min: 0.0068,
					max: 10,
					step: 0.001,
					clampValues: true,
				},
			],
			callback: async (action) => {
				// The SDK documents min/max as hints only — an imported config, the
				// HTTP API or a cleared field can all deliver something else. And
				// `.toFixed()` on a non-number would throw outside write()'s catch.
				const ghz = Number(action.options.frequency)
				if (!Number.isFinite(ghz)) {
					self.log('warn', `Ignoring frequency ${JSON.stringify(action.options.frequency)}: not a number`)
					return
				}
				// Six decimals is what the receiver's own web form sends.
				await write('DB_L2174_FREQ1', Math.min(10, Math.max(0.0068, ghz)).toFixed(6))
			},
		},

		set_bandwidth: {
			name: 'Set channel bandwidth',
			options: [dropdown('bandwidth', 'Bandwidth', BANDWIDTHS, '10MHz')],
			callback: async (action) => void (await write('DB_L2174_CHAN_BW', action.options.bandwidth)),
		},

		set_rx_mode: {
			name: 'Set receive mode',
			description: 'DVB-T or the Vislink LMS-T modes. Changing this re-acquires the signal.',
			options: [dropdown('mode', 'Mode', RX_MODES, 'LMST(S)')],
			callback: async (action) => void (await write('DB_L2174_RX_MODE', action.options.mode)),
		},

		set_decoder_source: {
			name: 'Set decoder source',
			description: 'Which input the decoder takes its transport stream from.',
			options: [dropdown('source', 'Source', DECODER_SOURCES, 'Demodulator')],
			callback: async (action) => void (await write('DB_DEMOD_ASI1_OUTPUT_MUX', action.options.source)),
		},

		set_demod_diversity: {
			name: 'Set demodulator diversity',
			options: [dropdown('state', 'Diversity', ON_OFF, 'On')],
			callback: async (action) => void (await write('DB_L2174_DEMOD_DIVERSITY', action.options.state)),
		},

		set_web_id: {
			name: 'Set web ID (display name)',
			description: 'The name shown in the receiver’s own web interface. Harmless, and handy for testing.',
			options: [{ type: 'textinput', id: 'text', label: 'Web ID (must not be empty)', default: '' }],
			callback: async (action) => {
				// An empty value clears the name the receiver shows on every page of
				// its own interface, and the old one is nowhere to be recovered from.
				const text = String(action.options.text ?? '').trim()
				if (!text) {
					self.log('warn', 'Ignoring empty web ID: that would clear the name the receiver displays')
					return
				}
				await write('DB_L2174_WEB_TEXT', text)
			},
		},

		// Present but undefined while the switch is off — Companion then leaves
		// them out of the action list entirely, so they cannot be hit by accident
		// on a receiver that is on air. api.ts refuses them regardless, in case the
		// switch flips between the press and the request.
		recall_preset: guarded
			? {
					name: 'Recall preset (interrupts)',
					description:
						'Loads a stored configuration — frequency, bandwidth, mode and routing all change at once, and the link drops while the receiver re-acquires.',
					options: [presetNumber()],
					callback: async (action) => {
						const slot = presetSlot(self, action.options.preset)
						if (slot === undefined) return
						// Two steps, the order the receiver's own interface uses: select
						// the slot, then trigger the recall.
						if (!(await write('DB_L2174_PRESET_NUM', slot))) return
						// 'Yes' is a momentary trigger: the receiver acts and drops the
						// parameter back to 'No', so there is nothing to read back.
						await write('DB_L2174_PRESET_RECALL', 'Yes', false)
					},
				}
			: undefined,

		store_preset: guarded
			? {
					name: 'Store preset (overwrites)',
					description:
						'Overwrites the chosen slot with the receiver\u2019s current settings. The previous contents are gone.',
					options: [presetNumber()],
					callback: async (action) => {
						const slot = presetSlot(self, action.options.preset)
						if (slot === undefined) return
						if (!(await write('DB_L2174_PRESET_NUM', slot))) return
						await write('DB_L2174_PRESET_STORE', 'Yes', false)
					},
				}
			: undefined,

		reboot_receiver: guarded
			? {
					name: 'Reboot receiver (off air ~1 min)',
					description: 'Restarts the receiver. It stops decoding until it is back.',
					options: [],
					callback: async () => void (await write('DB_L2174_REBOOT', 'Yes', false)),
				}
			: undefined,
	})
}

/** Preset slots the receiver offers, per settings.xml: 1-16. */
function presetNumber() {
	return {
		type: 'number' as const,
		id: 'preset' as const,
		label: 'Preset',
		default: 1,
		min: 1,
		max: 16,
		step: 1,
		clampValues: true,
	}
}

function presetSlot(self: ModuleInstance, raw: unknown): string | undefined {
	const n = Math.round(Number(raw))
	if (!Number.isFinite(n) || n < 1 || n > 16) {
		self.log('warn', `Ignoring preset ${JSON.stringify(raw)}: the receiver has slots 1-16`)
		return undefined
	}
	return String(n).padStart(3, '0')
}
