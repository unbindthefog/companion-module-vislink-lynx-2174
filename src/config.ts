import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval: number
	readOnly: boolean
	allowGuardedActions: boolean
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Vislink Lynx L2174',
			value: 'Reads status from the receiver’s built-in data.xml and exposes it as variables and feedbacks.',
		},
		{
			type: 'static-text',
			id: 'info-writes',
			width: 12,
			label: '',
			value:
				'It also writes a fixed list of 36 parameters for its actions — reception, routing, video output and the status pin. Everything outside that list is refused, whatever it is asked to do: key material, licence entry, restoring defaults and the network configuration are never written.',
			// Two fields down the dialog promises the opposite; this half of the
			// description has no business being on screen at the same time.
			isVisibleExpression: '!$(options:readOnly)',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Receiver address (IP or hostname)',
			width: 8,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 80,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (seconds)',
			width: 4,
			min: 1,
			max: 60,
			default: 2,
			tooltip:
				'How often status is fetched. The receiver’s own web interface polls every 1 second and sends "Cache-Control: max-age=1", so polling faster than that has no benefit.',
		},
		{
			type: 'static-text',
			id: 'read-only-info',
			width: 12,
			label: 'Read only',
			value:
				'On by default, and a new connection starts as a monitor: variables and feedbacks keep working, and the receiver is never written to. There are no actions at all while it is on, so there is nothing to place on a button by mistake — and the refusal also sits in the client itself, so a button that already carries an action cannot reach the receiver either. Clear it deliberately, for a receiver you mean to control; leave it for one that is on air.',
		},
		{
			type: 'checkbox',
			id: 'readOnly',
			label: 'Read only — never write to this receiver',
			width: 12,
			// Default on. Whoever adds a connection is pointing it at a receiver
			// before they have decided anything else about it, and the first poll
			// may well land on one that is on air. The cost of the wrong default
			// is not symmetric: starting locked costs a tick in a dialog, while
			// starting open costs a write nobody intended.
			default: true,
			disableAutoExpression: true,
		},
		{
			type: 'static-text',
			id: 'guarded-info',
			width: 12,
			label: 'Actions that interrupt, or put voltage on an input',
			value:
				'Four things stay out of the action list until you switch them on here. Recalling a preset reconfigures the receiver in one step and storing one overwrites the slot for good; a reboot takes the receiver away for about twenty seconds, and longer before it decodes again. The fourth is different in kind: switching downconverter power puts DC on an antenna input, and whatever is on the far end of that coax gets it. Unless "Apply channel settings to all" has been turned off (there is an action for it), that is every enabled channel at once, not just the one the button names. All four are useful from a distance and all four are the wrong thing to hit by accident.',
			// Nothing to decide while the connection writes nothing at all.
			isVisibleExpression: '!$(options:readOnly)',
		},
		{
			type: 'checkbox',
			id: 'allowGuardedActions',
			label: 'Offer preset recall and store, reboot, and downconverter power',
			width: 12,
			default: false,
			isVisibleExpression: '!$(options:readOnly)',
		},
	]
}

/**
 * Is this connection allowed to write to the receiver at all?
 *
 * The switch it reads is the outermost of the module's three guards, and each
 * one covers a different failure. This one is a decision about the receiver:
 * some of them are on air, and for those the honest setting is that no action
 * exists. `api.ts` refuses the write as well, because a connection can be
 * switched to read-only while a button somewhere still carries an action.
 *
 * `config` is undefined before the first `configUpdated`, and an absent
 * `readOnly` means writes are allowed. That is *not* the field's default —
 * the default is `true`, and Companion writes it into the stored config the
 * first time a connection starts. Absent therefore means one thing only: a
 * connection saved before this switch existed. Those were writing before and
 * keep writing; changing the default must not reach back and silence them.
 */
export function writesAllowed(self: { config?: ModuleConfig }): boolean {
	// Any truthy value locks, not only an exact `true`. An imported or
	// hand-edited `.companionconfig` can carry `1` or `"yes"`, which the dialog
	// renders as a ticked box, and a safety switch has to fail towards the lock
	// for anything it does not recognise.
	//
	// `undefined` is the one exception, and deliberate: it cannot come from a
	// new connection — Companion saves the default on first start — only from
	// one older than the switch. Tightening this to `=== false` would lock
	// those silently, which is the opposite of what the default change is for.
	return !self.config?.readOnly
}

/**
 * Are the interrupting actions on offer for this connection?
 *
 * Asked by `actions.ts` (which ones to define) and by `presets.ts` (which ones
 * to hand out), and those two must never disagree — a preset for an action that
 * does not exist reaches the button as "unknown action". `config` is undefined
 * before the first `configUpdated`, and absent means off.
 *
 * Read-only wins: with no writes at all there is nothing for this to allow,
 * and the switch is hidden from the dialog while that is the case.
 */
export function guardedActionsEnabled(self: { config?: ModuleConfig }): boolean {
	return writesAllowed(self) && self.config?.allowGuardedActions === true
}
