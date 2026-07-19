import {
  DEFAULT_MODEL_ROUTER_BASE_URL,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  type AppSettingsV1,
  type ModelAccessSettingsPatchV1,
  type ModelAccessSettingsV1,
  type ModelRouterMemberSettingsPatchV1,
  type ModelRouterMemberSettingsV1,
  type ModelRouterSettingsPatchV1,
  type ModelRouterSettingsV1
} from './app-settings-types'
import {
  isLocalModelRouterBaseUrl,
  normalizeLocalModelRouterBaseUrl,
  normalizeModelRouterBaseUrl
} from './model-router-url'

export function normalizeModelAccessSettings(
  input: ModelAccessSettingsPatchV1 | undefined
): ModelAccessSettingsV1 | undefined {
  if (input?.mode !== 'api' && input?.mode !== 'coding-plan') return undefined
  return {
    mode: input.mode,
    planAdapterId: optionalString(input?.planAdapterId)
  }
}

export function getModelAccessSettings(settings: AppSettingsV1): ModelAccessSettingsV1 | undefined {
  return normalizeModelAccessSettings(
    (settings as { modelAccess?: ModelAccessSettingsPatchV1 }).modelAccess
  )
}

export function mergeModelAccessSettings(
  current: ModelAccessSettingsV1 | undefined,
  patch: ModelAccessSettingsPatchV1 | undefined
): ModelAccessSettingsV1 | undefined {
  return normalizeModelAccessSettings({
    ...current,
    ...patch
  })
}

export function defaultModelRouterSettings(): ModelRouterSettingsV1 {
  return {
    enabled: true,
    baseUrl: DEFAULT_MODEL_ROUTER_BASE_URL,
    autoStart: true,
    publicModelAlias: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
    runtimeApiKey: '',
    profiles: {
      default: {
        textReasoner: defaultModelRouterMember(),
        imageGenerator: defaultModelRouterMember(),
        translators: {
          vision: defaultModelRouterMember(),
          scientific: defaultModelRouterMember()
        }
      }
    }
  }
}

export function normalizeModelRouterSettings(
  input: ModelRouterSettingsPatchV1 | undefined
): ModelRouterSettingsV1 {
  const defaults = defaultModelRouterSettings()
  const defaultProfile = defaults.profiles.default
  const rawDefaultProfile = input?.profiles?.default
  return {
    enabled: input?.enabled !== false,
    baseUrl: normalizeLocalModelRouterBaseUrl(optionalString(input?.baseUrl), defaults.baseUrl),
    autoStart: input?.autoStart !== false,
    publicModelAlias: normalizeModelRouterPublicModelAlias(input?.publicModelAlias, defaults.publicModelAlias),
    runtimeApiKey: optionalString(input?.runtimeApiKey),
    profiles: {
      default: {
        textReasoner: normalizeModelRouterMember(
          rawDefaultProfile?.textReasoner,
          defaultProfile.textReasoner
        ),
        imageGenerator: normalizeModelRouterMember(
          rawDefaultProfile?.imageGenerator,
          defaultProfile.imageGenerator
        ),
        translators: {
          vision: normalizeModelRouterMember(
            rawDefaultProfile?.translators?.vision,
            defaultProfile.translators.vision
          ),
          scientific: normalizeModelRouterMember(
            rawDefaultProfile?.translators?.scientific,
            defaultProfile.translators.scientific
          )
        }
      }
    }
  }
}

export function mergeModelRouterSettings(
  current: ModelRouterSettingsV1 | undefined,
  patch: ModelRouterSettingsPatchV1 | undefined
): ModelRouterSettingsV1 {
  const safeCurrent = normalizeModelRouterSettings(current)
  return normalizeModelRouterSettings({
    ...safeCurrent,
    ...(patch ?? {}),
    profiles: {
      default: {
        textReasoner: {
          ...safeCurrent.profiles.default.textReasoner,
          ...(patch?.profiles?.default?.textReasoner ?? {})
        },
        imageGenerator: {
          ...safeCurrent.profiles.default.imageGenerator,
          ...(patch?.profiles?.default?.imageGenerator ?? {})
        },
        translators: {
          vision: {
            ...safeCurrent.profiles.default.translators.vision,
            ...(patch?.profiles?.default?.translators?.vision ?? {})
          },
          scientific: {
            ...safeCurrent.profiles.default.translators.scientific,
            ...(patch?.profiles?.default?.translators?.scientific ?? {})
          }
        }
      }
    }
  })
}

export function getModelRouterSettings(settings: AppSettingsV1): ModelRouterSettingsV1 {
  return normalizeModelRouterSettings(
    (settings as { modelRouter?: ModelRouterSettingsPatchV1 }).modelRouter
  )
}

export function modelRouterSettingsPatch(
  modelRouter: ModelRouterSettingsPatchV1 | undefined
): { modelRouter?: ModelRouterSettingsPatchV1 } {
  return modelRouter ? { modelRouter } : {}
}

export function resolveRuntimeModelRouterSettings(settings: AppSettingsV1): {
  baseUrl: string
  apiKey: string
  model: string
} {
  const rawBaseUrl = typeof (settings as { modelRouter?: { baseUrl?: unknown } }).modelRouter?.baseUrl === 'string'
    ? (settings as { modelRouter?: { baseUrl?: string } }).modelRouter?.baseUrl?.trim() ?? ''
    : ''
  if (rawBaseUrl) {
    const normalizedRaw = normalizeModelRouterBaseUrl(rawBaseUrl)
    if (!isLocalModelRouterBaseUrl(normalizedRaw)) {
      throw new Error('Model Router base URL must be local http://127.0.0.1, http://localhost, or http://[::1].')
    }
  }
  const modelRouter = getModelRouterSettings(settings)
  return {
    baseUrl: modelRouter.baseUrl,
    apiKey: modelRouter.runtimeApiKey.trim(),
    model: modelRouter.publicModelAlias
  }
}

export function isModelRouterTextReasonerConfigured(
  modelRouter: ModelRouterSettingsV1
): boolean {
  const textReasoner = modelRouter.profiles.default.textReasoner
  return Boolean(
    textReasoner.baseUrl.trim() &&
    textReasoner.apiKey.trim() &&
    textReasoner.model.trim()
  )
}

export function listModelRouterModelIds(settings: AppSettingsV1): string[] {
  const router = getModelRouterSettings(settings)
  const publicAlias = router.publicModelAlias.trim()
  return publicAlias ? [publicAlias] : []
}

function defaultModelRouterMember(model = ''): ModelRouterMemberSettingsV1 {
  return {
    baseUrl: '',
    apiKey: '',
    model
  }
}

function normalizeModelRouterMember(
  input: ModelRouterMemberSettingsPatchV1 | undefined,
  defaults: ModelRouterMemberSettingsV1
): ModelRouterMemberSettingsV1 {
  return {
    baseUrl: optionalString(input?.baseUrl) || defaults.baseUrl,
    apiKey: optionalString(input?.apiKey),
    model: optionalString(input?.model) || defaults.model
  }
}

function normalizeModelRouterPublicModelAlias(value: unknown, fallback: string): string {
  return nonEmptyString(value, fallback)
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
