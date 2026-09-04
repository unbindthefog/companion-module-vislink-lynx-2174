import type ModuleInstance from './main.js'

/**
 * No presets yet. Once the variable set has settled against a lab receiver,
 * a per-channel RF-lock button and an alarm-summary readout are the obvious
 * first candidates.
 */
export function UpdatePresets(self: ModuleInstance): void {
	self.setPresetDefinitions([], {})
}
