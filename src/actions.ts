import type ModuleInstance from './main.js'

/**
 * No actions yet — this module is deliberately read-only.
 *
 * The write path (`GET /common/iframe.php?param=<name>&value=<value>`) has
 * been reverse-engineered from the web UI's JavaScript but never exercised
 * against a receiver — see docs/LYNX_L2174_API.md §6 and ROADMAP.md. It must
 * not be implemented against production hardware.
 */
export type ActionsSchema = Record<string, never>

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({})
}
