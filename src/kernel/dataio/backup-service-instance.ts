/**
 * backup service instance — boot-time singleton; the settings section picks
 * it up through this module (usage-stats service-instance pattern). The
 * composition root binds the raw engine at startup; tests inject their own.
 */

import type { BackupService } from './backup-service'

let activeService: BackupService | null = null

export function setBackupServiceInstance(service: BackupService | null): void {
  activeService = service
}

export function getBackupServiceInstance(): BackupService | null {
  return activeService
}
