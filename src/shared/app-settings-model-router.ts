import {
  DEFAULT_MODEL_ROUTER_TEXT_ENDPOINT_FORMAT,
  DEFAULT_MODEL_ROUTER_BASE_URL,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsPatchV1,
  type ModelRouterMemberProviderSettingsV1,
  type ModelRouterScientificTranslatorSettingsPatchV1,
  type ModelRouterScientificTranslatorSettingsV1,
  type ModelRouterSettingsPatchV1,
  type ModelRouterSettingsV1,
  type ModelRouterTextEndpointFormat,
  type ModelRouterTextReasonerSettingsPatchV1,
  type ModelRouterTextReasonerSettingsV1
} from './app-settings-types'
import {
  isLocalModelRouterBaseUrl,
  normalizeLocalModelRouterBaseUrl,
  normalizeModelRouterBaseUrl
} from './model-router-url'

export const DEFAULT_MODEL_ROUTER_IMAGE_GENERATOR_MODEL = 'gpt-image-2'

export function defaultModelRouterSettings(): ModelRouterSettingsV1 {
  return {
    enabled: true,
    baseUrl: DEFAULT_MODEL_ROUTER_BASE_URL,
    autoStart: true,
    publicModelAlias: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
    runtimeApiKey: '',
    profiles: {
      default: {
        textReasoner: defaultModelRouterTextReasoner(),
        imageGenerator: defaultModelRouterMemberProvider(
          'openai-compatible',
          DEFAULT_MODEL_ROUTER_IMAGE_GENERATOR_MODEL
        ),
        translators: {
          vision: defaultModelRouterMemberProvider('qwen-compatible'),
          scientific: defaultModelRouterScientificTranslator()
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
        textReasoner: normalizeModelRouterTextReasoner(
          rawDefaultProfile?.textReasoner,
          defaultProfile.textReasoner
        ),
        imageGenerator: normalizeModelRouterImageGenerator(
          rawDefaultProfile?.imageGenerator,
          defaultProfile.imageGenerator
        ),
        translators: {
          vision: normalizeModelRouterMemberProvider(
            rawDefaultProfile?.translators?.vision,
            defaultProfile.translators.vision
          ),
          scientific: normalizeModelRouterScientificTranslator(
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

function defaultModelRouterMemberProvider(
  provider: string,
  model = ''
): ModelRouterMemberProviderSettingsV1 {
  return {
    provider,
    baseUrl: '',
    apiKey: '',
    model
  }
}

function defaultModelRouterTextReasoner(): ModelRouterTextReasonerSettingsV1 {
  return {
    ...defaultModelRouterMemberProvider('openai-compatible'),
    endpointFormat: DEFAULT_MODEL_ROUTER_TEXT_ENDPOINT_FORMAT
  }
}

function normalizeModelRouterTextReasoner(
  input: ModelRouterTextReasonerSettingsPatchV1 | undefined,
  defaults: ModelRouterTextReasonerSettingsV1
): ModelRouterTextReasonerSettingsV1 {
  return {
    ...normalizeModelRouterMemberProvider(input, defaults),
    endpointFormat: normalizeModelRouterTextEndpointFormat(input?.endpointFormat)
  }
}

export function normalizeModelRouterTextEndpointFormat(value: unknown): ModelRouterTextEndpointFormat {
  return value === 'responses' ? 'responses' : DEFAULT_MODEL_ROUTER_TEXT_ENDPOINT_FORMAT
}

function normalizeModelRouterImageGenerator(
  input: ModelRouterMemberProviderSettingsPatchV1 | undefined,
  defaults: ModelRouterMemberProviderSettingsV1
): ModelRouterMemberProviderSettingsV1 {
  const normalized = normalizeModelRouterMemberProvider(input, defaults)
  return {
    ...normalized,
    // Keep existing explicit provider-model overrides compatible, while making
    // gpt-image-2 the canonical model for new and partially migrated settings.
    model: nonEmptyString(input?.model, defaults.model)
  }
}

function defaultModelRouterScientificTranslator(): ModelRouterScientificTranslatorSettingsV1 {
  return {
    baseUrl: '',
    apiKey: '',
    model: ''
  }
}

function normalizeModelRouterMemberProvider(
  input: ModelRouterMemberProviderSettingsPatchV1 | undefined,
  defaults: ModelRouterMemberProviderSettingsV1
): ModelRouterMemberProviderSettingsV1 {
  const maxSupplementRounds = optionalNonNegativeInteger(input?.maxSupplementRounds)
  return {
    provider: nonEmptyString(input?.provider, defaults.provider),
    baseUrl: optionalString(input?.baseUrl),
    apiKey: optionalString(input?.apiKey),
    model: optionalString(input?.model),
    ...(maxSupplementRounds === undefined ? {} : { maxSupplementRounds })
  }
}

function normalizeModelRouterScientificTranslator(
  input: ModelRouterScientificTranslatorSettingsPatchV1 | undefined,
  defaults: ModelRouterScientificTranslatorSettingsV1
): ModelRouterScientificTranslatorSettingsV1 {
  const timeoutMs = optionalPositiveInteger(input?.timeoutMs)
  return {
    baseUrl: optionalString(input?.baseUrl) || defaults.baseUrl,
    apiKey: optionalString(input?.apiKey),
    model: optionalString(input?.model) || defaults.model,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
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

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}
