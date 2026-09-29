/**
 * usage-stats service instance — activate-time singleton; components pick it
 * up through this module (ported pattern from the decoupling-line organ).
 */

import type { UsageStatsService } from './service'

let activeService: UsageStatsService | null = null

export function setUsageStatsService(service: UsageStatsService | null): void {
  activeService = service
}

export function getUsageStatsService(): UsageStatsService | null {
  return activeService
}
