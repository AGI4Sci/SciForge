import {
  resolveRuntimeModelRouterSettings as resolvePersistedRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../shared/app-settings'

export const MODEL_ROUTER_RUNTIME_API_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'

/** Resolves the process-scoped Router credential without persisting it in app settings. */
export function resolveRuntimeModelRouterSettings(
  settings: AppSettingsV1,
  env: NodeJS.ProcessEnv = process.env
): ReturnType<typeof resolvePersistedRuntimeModelRouterSettings> {
  const persisted = resolvePersistedRuntimeModelRouterSettings(settings)
  const runtimeApiKey = env[MODEL_ROUTER_RUNTIME_API_KEY_ENV]?.trim()
  return runtimeApiKey
    ? { ...persisted, apiKey: runtimeApiKey }
    : persisted
}
