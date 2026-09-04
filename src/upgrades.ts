import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

/*
 * Remember that once an upgrade script has been added it cannot be removed!
 */
export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = []
