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
				'Reads status from the receiver’s built-in data.xml. This module is read-only — it polls status and exposes it as variables and feedbacks, and never writes to the device.',
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
			label: 'Interrupting actions',
			value:
				'Recalling a preset reconfigures the receiver in one step; a reboot takes it off air for about a minute. Both are useful from a distance and both are the wrong thing to hit by accident, so they stay out of the action list until you switch them on here.',
		},
		{
			type: 'checkbox',
			id: 'allowGuardedActions',
			label: 'Offer preset recall, preset store and reboot',
			width: 12,
			default: false,
		},
	]
}
