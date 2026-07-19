import {
  getLocalRuntimeSettings,
  resolveModelAccessRuntimePolicy,
  type AppSettingsV1
} from '../shared/app-settings'

export type ManagedLocalRuntimeAction = 'none' | 'stop' | 'restart'

export function managedLocalRuntimeAction(
  settings: AppSettingsV1,
  input: {
    running: boolean
    configurationChanged: boolean
    hasApiKey: boolean
  }
): ManagedLocalRuntimeAction {
  if (!input.running) return 'none'
  const policy = resolveModelAccessRuntimePolicy(settings)
  const runtime = getLocalRuntimeSettings(settings)
  if (!policy.sciforge || !runtime.autoStart || !input.hasApiKey) return 'stop'
  return input.configurationChanged ? 'restart' : 'none'
}

export async function stopDisallowedAgentRuntimes(
  settings: AppSettingsV1,
  runtimes: {
    stopSciforge: () => Promise<void>
    stopClaude: () => Promise<void>
    stopCodex: () => Promise<void>
  }
): Promise<void> {
  const policy = resolveModelAccessRuntimePolicy(settings)
  await Promise.all([
    policy.sciforge ? undefined : runtimes.stopSciforge(),
    policy.claude ? undefined : runtimes.stopClaude(),
    policy.codex ? undefined : runtimes.stopCodex()
  ])
}
