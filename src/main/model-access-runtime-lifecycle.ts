import { resolveModelAccessRuntimePolicy, type AppSettingsV1 } from '../shared/app-settings'

export async function stopDisallowedAgentRuntimes(
  settings: AppSettingsV1,
  runtimes: {
    stopClaude: () => Promise<void>
    stopCodex: () => Promise<void>
  }
): Promise<void> {
  const policy = resolveModelAccessRuntimePolicy(settings)
  await Promise.all([
    policy.claude ? undefined : runtimes.stopClaude(),
    policy.codex ? undefined : runtimes.stopCodex()
  ])
}
