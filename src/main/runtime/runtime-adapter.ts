import type { AgentRuntimeId, AppSettingsV1 } from '../../shared/app-settings'

export type ManagedRuntimeAdapter = {
  id: AgentRuntimeId
  ensureRunning(settings: AppSettingsV1): Promise<void>
  stopAndWait(): Promise<void>
  isChildRunning(): boolean
}
