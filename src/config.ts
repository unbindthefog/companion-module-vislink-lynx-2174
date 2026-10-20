import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval: number
	allowGuardedActions: boolean
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Vislink Lynx L2174',
			value:
				'Reads status from the receiver’s built-in data.xml and exposes it as variables and feedbacks. It also writes a fixed list of 35 parameters for its actions — reception, routing, video output and the status pin. Everything outside that list is refused, whatever it is asked to do: key material, licence entry, restoring defaults and the network configuration are never written.',
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
			id: 'guarded-info',
			width: 12,
			label: 'Actions that interrupt, or put voltage on an input',
			value:
				'Four things stay out of the action list until you switch them on here. Recalling a preset reconfigures the receiver in one step and storing one overwrites the slot for good; a reboot takes it off air for about a minute. The fourth is different in kind: switching downconverter power puts DC on that antenna input, and whatever is on the far end of the coax gets it. All four are useful from a distance and all four are the wrong thing to hit by accident.',
		},
		{
			type: 'checkbox',
			id: 'allowGuardedActions',
			label: 'Offer preset recall and store, reboot, and downconverter power',
			width: 12,
			default: false,
		},
	]
}

/**
 * Are the interrupting actions on offer for this connection?
 *
 * Asked by `actions.ts` (which ones to define) and by `presets.ts` (which ones
 * to hand out), and those two must never disagree — a preset for an action that
 * does not exist reaches the button as "unknown action". `config` is undefined
 * before the first `configUpdated`, and absent means off.
 */
export function guardedActionsEnabled(self: { config?: ModuleConfig }): boolean {
	return self.config?.allowGuardedActions === true
}
