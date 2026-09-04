import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval: number
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
	]
}
