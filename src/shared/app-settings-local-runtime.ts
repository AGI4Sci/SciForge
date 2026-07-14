import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_LOCAL_RUNTIME_DATA_DIR,
  DEFAULT_LOCAL_RUNTIME_MODEL,
  DEFAULT_LOCAL_RUNTIME_PORT,
  DEFAULT_SANDBOX_MODE,
  type AppSettingsV1,
  type LocalRuntimeContextCompactionSettingsV1,
  type LocalRuntimeHistoryHygieneSettingsV1,
  type LocalRuntimeMcpSearchSettingsV1,
  type LocalRuntimeTuningSettingsV1,
  type LocalRuntimeTuningSettingsPatchV1,
  type RuntimeGuardSettingsPatchV1,
  type RuntimeGuardSettingsV1,
  type LocalRuntimeSettingsPatchV1,
  type LocalRuntimeSettingsV1,
  type AgentRuntimeSettingsEnvelopePatchV1,
  type AgentRuntimeSettingsEnvelopeV1,
  type LocalRuntimeStorageSettingsV1,
  type LocalRuntimeTokenEconomySettingsPatchV1,
  type LocalRuntimeTokenEconomySettingsV1
} from './app-settings-types'
import {
  resolveLocalRuntimeSettings
} from './app-settings-provider'
import {
  defaultCodexRuntimeSettings,
  mergeCodexRuntimeSettings
} from './app-settings-codex'
import {
  defaultClaudeRuntimeSettings,
  mergeClaudeRuntimeSettings
} from './app-settings-claude'

/**
 * Local runtime settings. Mirrors the bundled runtime CLI
 * options. It is the only active local-agent settings object the GUI stores.
 */
export function defaultLocalRuntimeSettings(
  port = DEFAULT_LOCAL_RUNTIME_PORT
): LocalRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    providerId: '',
    runtimeToken: '',
    dataDir: DEFAULT_LOCAL_RUNTIME_DATA_DIR,
    model: DEFAULT_LOCAL_RUNTIME_MODEL,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    tokenEconomyMode: false,
    tokenEconomy: defaultLocalRuntimeTokenEconomySettings(),
    insecure: false,
    mcpSearch: defaultLocalRuntimeMcpSearchSettings(),
    storage: defaultLocalRuntimeStorageSettings(),
    contextCompaction: defaultLocalRuntimeContextCompactionSettings(),
    runtimeTuning: defaultLocalRuntimeTuningSettings()
  }
}

export function defaultLocalRuntimeMcpSearchSettings(): LocalRuntimeMcpSearchSettingsV1 {
  return {
    defaultsRevision: 1,
    enabled: true,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultLocalRuntimeTokenEconomySettings(): LocalRuntimeTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultLocalRuntimeHistoryHygieneSettings()
  }
}

export function defaultLocalRuntimeHistoryHygieneSettings(): LocalRuntimeHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultLocalRuntimeStorageSettings(): LocalRuntimeStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export function defaultLocalRuntimeContextCompactionSettings(): LocalRuntimeContextCompactionSettingsV1 {
  return {
    defaultSoftThreshold: 16_000,
    defaultHardThreshold: 24_000,
    summaryMode: 'heuristic',
    summaryTimeoutMs: 15_000,
    summaryMaxTokens: 1_200,
    summaryInputMaxBytes: 96 * 1024
  }
}

export function defaultLocalRuntimeTuningSettings(): LocalRuntimeTuningSettingsV1 {
  return {
    toolArgumentRepair: {
      maxStringBytes: 512 * 1024
    },
    toolBudget: {
      enabled: true,
      profiles: {
        explanation: { softLimit: 2, hardLimit: 5, maxAutomaticPhases: 1, totalLimit: 5 },
        review: { softLimit: 8, hardLimit: 16, maxAutomaticPhases: 1, totalLimit: 16 },
        implementation: { softLimit: 16, hardLimit: 32, maxAutomaticPhases: 1, totalLimit: 32 },
        long: { softLimit: 16, hardLimit: 16, maxAutomaticPhases: 3, totalLimit: 48 }
      }
    },
    parallelism: {
      localReadOnly: 8,
      networkMcp: 4
    }
  }
}

export function defaultRuntimeGuardSettings(): RuntimeGuardSettingsV1 {
  return {
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    }
  }
}

export function normalizeRuntimeGuardSettings(
  input: Partial<RuntimeGuardSettingsV1> | undefined
): RuntimeGuardSettingsV1 {
  const defaults = defaultRuntimeGuardSettings()
  const toolStormInput = input?.toolStorm
  const threshold = Math.max(
    2,
    boundedPositiveInt(toolStormInput?.threshold, defaults.toolStorm.threshold, 128)
  )
  return {
    toolStorm: {
      enabled: toolStormInput?.enabled !== false,
      windowSize: boundedPositiveInt(toolStormInput?.windowSize, defaults.toolStorm.windowSize, 256),
      threshold
    }
  }
}

export function mergeRuntimeGuardSettings(
  current: RuntimeGuardSettingsV1 | undefined,
  patch: RuntimeGuardSettingsPatchV1 | undefined
): RuntimeGuardSettingsV1 {
  const normalizedCurrent = normalizeRuntimeGuardSettings(current)
  return normalizeRuntimeGuardSettings({
    toolStorm: {
      ...normalizedCurrent.toolStorm,
      ...(patch?.toolStorm ?? {})
    }
  })
}

export function getLocalRuntimeSettings(
  settings: AppSettingsV1
): LocalRuntimeSettingsV1 {
  const raw = (settings as { agents?: { sciforge?: LocalRuntimeSettingsPatchV1 } }).agents?.sciforge
  return mergeLocalRuntimeSettings(defaultLocalRuntimeSettings(), raw)
}

export function agentRuntimeSettingsEnvelope(
  sciforge: LocalRuntimeSettingsV1
): AgentRuntimeSettingsEnvelopeV1 {
  return { sciforge }
}

export function localRuntimeSettingsPatch(
  sciforge: LocalRuntimeSettingsPatchV1 | undefined
): AgentRuntimeSettingsEnvelopePatchV1 {
  return sciforge ? { sciforge } : {}
}

export function mergeLocalRuntimeSettings(
  current: LocalRuntimeSettingsV1,
  patch: LocalRuntimeSettingsPatchV1 | undefined
): LocalRuntimeSettingsV1 {
  const runtimePatch = supportedLocalRuntimePatch(patch)
  const currentMcpSearch = normalizeLocalRuntimeMcpSearchSettings(current.mcpSearch)
  const migrateLegacyMcpSearchDefaults = shouldMigrateLegacyLocalRuntimeMcpSearchDefaults(
    runtimePatch?.mcpSearch
  )
  const nextMcpSearch = normalizeLocalRuntimeMcpSearchSettings({
    ...currentMcpSearch,
    ...(runtimePatch?.mcpSearch ?? {}),
    ...(migrateLegacyMcpSearchDefaults ? { enabled: true, defaultsRevision: 1 } : {})
  })
  const currentTokenEconomy = normalizeLocalRuntimeTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeLocalRuntimeTokenEconomySettings({
    ...currentTokenEconomy,
    ...(runtimePatch?.tokenEconomy ?? {}),
    historyHygiene: {
      ...currentTokenEconomy.historyHygiene,
      ...(runtimePatch?.tokenEconomy?.historyHygiene ?? {})
    }
  }, currentTokenEconomy.enabled)
  const tokenEconomyEnabled = typeof runtimePatch?.tokenEconomy?.enabled === 'boolean'
    ? runtimePatch.tokenEconomy.enabled
    : typeof runtimePatch?.tokenEconomyMode === 'boolean'
      ? runtimePatch.tokenEconomyMode
      : patchedTokenEconomy.enabled
  const nextTokenEconomy = {
    ...patchedTokenEconomy,
    enabled: tokenEconomyEnabled
  }
  const currentStorage = normalizeLocalRuntimeStorageSettings(current.storage)
  const nextStorage = normalizeLocalRuntimeStorageSettings({
    ...currentStorage,
    ...(runtimePatch?.storage ?? {})
  })
  const currentContextCompaction = normalizeLocalRuntimeContextCompactionSettings(current.contextCompaction)
  const nextContextCompaction = normalizeLocalRuntimeContextCompactionSettings({
    ...currentContextCompaction,
    ...(runtimePatch?.contextCompaction ?? {})
  })
  const currentRuntimeTuning = normalizeLocalRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeLocalRuntimeTuningSettings({
    ...currentRuntimeTuning,
    ...(runtimePatch?.runtimeTuning
      ? {
          toolArgumentRepair: {
            ...currentRuntimeTuning.toolArgumentRepair,
            ...(runtimePatch.runtimeTuning.toolArgumentRepair ?? {})
          },
          toolBudget: {
            ...currentRuntimeTuning.toolBudget,
            ...(runtimePatch.runtimeTuning.toolBudget ?? {}),
            profiles: {
              explanation: {
                ...currentRuntimeTuning.toolBudget.profiles.explanation,
                ...(runtimePatch.runtimeTuning.toolBudget?.profiles?.explanation ?? {})
              },
              review: {
                ...currentRuntimeTuning.toolBudget.profiles.review,
                ...(runtimePatch.runtimeTuning.toolBudget?.profiles?.review ?? {})
              },
              implementation: {
                ...currentRuntimeTuning.toolBudget.profiles.implementation,
                ...(runtimePatch.runtimeTuning.toolBudget?.profiles?.implementation ?? {})
              },
              long: {
                ...currentRuntimeTuning.toolBudget.profiles.long,
                ...(runtimePatch.runtimeTuning.toolBudget?.profiles?.long ?? {})
              }
            }
          },
          parallelism: {
            ...currentRuntimeTuning.parallelism,
            ...(runtimePatch.runtimeTuning.parallelism ?? {})
          }
        }
      : {})
  })
  const sandboxMode = runtimePatch?.sandboxMode ?? current.sandboxMode
  return {
    ...current,
    ...(runtimePatch ?? {}),
    approvalPolicy: sandboxMode === 'danger-full-access'
      ? 'auto'
      : runtimePatch?.approvalPolicy ?? current.approvalPolicy,
    sandboxMode,
    dataDir: normalizeLocalRuntimeDataDir(runtimePatch?.dataDir ?? current.dataDir),
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    mcpSearch: nextMcpSearch,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning
  }
}

function supportedLocalRuntimePatch(
  patch: LocalRuntimeSettingsPatchV1 | undefined
): LocalRuntimeSettingsPatchV1 | undefined {
  if (!patch) return undefined
  const source = patch as Record<string, unknown>
  const next: LocalRuntimeSettingsPatchV1 = {}
  if (typeof source.binaryPath === 'string') next.binaryPath = source.binaryPath
  if (typeof source.port === 'number') next.port = source.port
  if (typeof source.autoStart === 'boolean') next.autoStart = source.autoStart
  if (typeof source.providerId === 'string') next.providerId = source.providerId
  if (typeof source.runtimeToken === 'string') next.runtimeToken = source.runtimeToken
  if (typeof source.dataDir === 'string') next.dataDir = source.dataDir
  if (typeof source.model === 'string') next.model = source.model
  if (typeof source.approvalPolicy === 'string') {
    next.approvalPolicy = source.approvalPolicy as LocalRuntimeSettingsPatchV1['approvalPolicy']
  }
  if (typeof source.sandboxMode === 'string') {
    next.sandboxMode = source.sandboxMode as LocalRuntimeSettingsPatchV1['sandboxMode']
  }
  if (typeof source.tokenEconomyMode === 'boolean') next.tokenEconomyMode = source.tokenEconomyMode
  if (isPlainObject(source.tokenEconomy)) {
    next.tokenEconomy = source.tokenEconomy as LocalRuntimeTokenEconomySettingsPatchV1
  }
  if (typeof source.insecure === 'boolean') next.insecure = source.insecure
  if (isPlainObject(source.mcpSearch)) {
    next.mcpSearch = source.mcpSearch as LocalRuntimeSettingsPatchV1['mcpSearch']
  }
  if (isPlainObject(source.storage)) {
    next.storage = source.storage as LocalRuntimeSettingsPatchV1['storage']
  }
  if (isPlainObject(source.contextCompaction)) {
    next.contextCompaction = source.contextCompaction as LocalRuntimeSettingsPatchV1['contextCompaction']
  }
  if (isPlainObject(source.runtimeTuning)) {
    next.runtimeTuning = source.runtimeTuning as LocalRuntimeTuningSettingsPatchV1
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLocalRuntimeTokenEconomySettings(
  input: Partial<LocalRuntimeTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): LocalRuntimeTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeLocalRuntimeHistoryHygieneSettings(input?.historyHygiene)
  }
}

function normalizeLocalRuntimeHistoryHygieneSettings(
  input: Partial<LocalRuntimeHistoryHygieneSettingsV1> | undefined
): LocalRuntimeHistoryHygieneSettingsV1 {
  const defaults = defaultLocalRuntimeHistoryHygieneSettings()
  return {
    maxToolResultLines: boundedPositiveInt(input?.maxToolResultLines, defaults.maxToolResultLines, 100_000),
    maxToolResultBytes: boundedPositiveInt(input?.maxToolResultBytes, defaults.maxToolResultBytes, 8 * 1024 * 1024),
    maxToolResultTokens: boundedPositiveInt(input?.maxToolResultTokens, defaults.maxToolResultTokens, 256_000),
    maxToolArgumentStringBytes: boundedPositiveInt(
      input?.maxToolArgumentStringBytes,
      defaults.maxToolArgumentStringBytes,
      8 * 1024 * 1024
    ),
    maxToolArgumentStringTokens: boundedPositiveInt(
      input?.maxToolArgumentStringTokens,
      defaults.maxToolArgumentStringTokens,
      64_000
    ),
    maxArrayItems: boundedPositiveInt(input?.maxArrayItems, defaults.maxArrayItems, 10_000)
  }
}

function normalizeLocalRuntimeMcpSearchSettings(
  input: Partial<LocalRuntimeMcpSearchSettingsV1> | undefined
): LocalRuntimeMcpSearchSettingsV1 {
  const defaults = defaultLocalRuntimeMcpSearchSettings()
  const topKMax = positiveInt(input?.topKMax, defaults.topKMax)
  const topKDefault = Math.min(positiveInt(input?.topKDefault, defaults.topKDefault), topKMax)
  return {
    defaultsRevision: positiveInt(input?.defaultsRevision, defaults.defaultsRevision ?? 1),
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled,
    mode: input?.mode === 'direct' || input?.mode === 'search' || input?.mode === 'auto'
      ? input.mode
      : defaults.mode,
    autoThresholdToolCount: positiveInt(input?.autoThresholdToolCount, defaults.autoThresholdToolCount),
    topKDefault,
    topKMax,
    minScore: nonNegativeNumber(input?.minScore, defaults.minScore)
  }
}

/**
 * The previous GUI wrote its entire disabled MCP-search default object to disk.
 * Only that exact legacy shape is migrated. Customized disabled settings are
 * preserved, and the defaults revision prevents a later explicit opt-out from
 * being re-enabled on the next launch.
 */
export function shouldMigrateLegacyLocalRuntimeMcpSearchDefaults(
  input: Partial<LocalRuntimeMcpSearchSettingsV1> | undefined
): boolean {
  if (!input || input.defaultsRevision !== undefined) return false
  return input.enabled === false &&
    input.mode === 'auto' &&
    input.autoThresholdToolCount === 24 &&
    input.topKDefault === 5 &&
    input.topKMax === 10 &&
    input.minScore === 0.15
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function boundedPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

function normalizeLocalRuntimeStorageSettings(
  input: Partial<LocalRuntimeStorageSettingsV1> | undefined
): LocalRuntimeStorageSettingsV1 {
  const defaults = defaultLocalRuntimeStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

function normalizeLocalRuntimeContextCompactionSettings(
  input: Partial<LocalRuntimeContextCompactionSettingsV1> | undefined
): LocalRuntimeContextCompactionSettingsV1 {
  const defaults = defaultLocalRuntimeContextCompactionSettings()
  const defaultSoftThreshold = boundedPositiveInt(input?.defaultSoftThreshold, defaults.defaultSoftThreshold)
  const requestedHardThreshold = boundedPositiveInt(input?.defaultHardThreshold, defaults.defaultHardThreshold)
  return {
    defaultSoftThreshold,
    defaultHardThreshold: Math.max(defaultSoftThreshold, requestedHardThreshold),
    summaryMode: input?.summaryMode === 'model' || input?.summaryMode === 'heuristic'
      ? input.summaryMode
      : defaults.summaryMode,
    summaryTimeoutMs: boundedPositiveInt(input?.summaryTimeoutMs, defaults.summaryTimeoutMs, 120_000),
    summaryMaxTokens: boundedPositiveInt(input?.summaryMaxTokens, defaults.summaryMaxTokens, 16_000),
    summaryInputMaxBytes: boundedPositiveInt(input?.summaryInputMaxBytes, defaults.summaryInputMaxBytes, 8 * 1024 * 1024)
  }
}

function normalizeLocalRuntimeTuningSettings(
  input: Partial<LocalRuntimeTuningSettingsV1> | undefined
): LocalRuntimeTuningSettingsV1 {
  const defaults = defaultLocalRuntimeTuningSettings()
  const normalizeBudgetProfile = (
    inputProfile: Partial<LocalRuntimeTuningSettingsV1['toolBudget']['profiles']['explanation']> | undefined,
    defaultProfile: LocalRuntimeTuningSettingsV1['toolBudget']['profiles']['explanation']
  ): LocalRuntimeTuningSettingsV1['toolBudget']['profiles']['explanation'] => {
    const hardLimit = boundedPositiveInt(inputProfile?.hardLimit, defaultProfile.hardLimit, 10_000)
    const softLimit = Math.min(
      boundedPositiveInt(inputProfile?.softLimit, defaultProfile.softLimit, 10_000),
      hardLimit
    )
    return {
      softLimit,
      hardLimit,
      maxAutomaticPhases: boundedPositiveInt(
        inputProfile?.maxAutomaticPhases,
        defaultProfile.maxAutomaticPhases,
        32
      ),
      totalLimit: Math.max(
        hardLimit,
        boundedPositiveInt(inputProfile?.totalLimit, defaultProfile.totalLimit, 100_000)
      )
    }
  }
  return {
    toolArgumentRepair: {
      maxStringBytes: boundedPositiveInt(
        input?.toolArgumentRepair?.maxStringBytes,
        defaults.toolArgumentRepair.maxStringBytes,
        16 * 1024 * 1024
      )
    },
    toolBudget: {
      enabled: input?.toolBudget?.enabled !== false,
      profiles: {
        explanation: normalizeBudgetProfile(
          input?.toolBudget?.profiles?.explanation,
          defaults.toolBudget.profiles.explanation
        ),
        review: normalizeBudgetProfile(
          input?.toolBudget?.profiles?.review,
          defaults.toolBudget.profiles.review
        ),
        implementation: normalizeBudgetProfile(
          input?.toolBudget?.profiles?.implementation,
          defaults.toolBudget.profiles.implementation
        ),
        long: normalizeBudgetProfile(
          input?.toolBudget?.profiles?.long,
          defaults.toolBudget.profiles.long
        )
      }
    },
    parallelism: {
      localReadOnly: boundedPositiveInt(
        input?.parallelism?.localReadOnly,
        defaults.parallelism.localReadOnly,
        64
      ),
      networkMcp: boundedPositiveInt(
        input?.parallelism?.networkMcp,
        defaults.parallelism.networkMcp,
        64
      )
    }
  }
}

export function withLocalRuntimeSettings(
  settings: AppSettingsV1,
  sciforge: LocalRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      sciforge
    }
  }
}

export function applyLocalRuntimePatch(
  settings: AppSettingsV1,
  patch: LocalRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withLocalRuntimeSettings(
    settings,
    mergeLocalRuntimeSettings(getLocalRuntimeSettings(settings), patch)
  )
}

export function isLocalRuntimeInsecure(runtime: Pick<LocalRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure || !runtime.runtimeToken.trim()
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveLocalRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: AgentRuntimeSettingsEnvelopeV1,
  patch: AgentRuntimeSettingsEnvelopePatchV1 | undefined
): AgentRuntimeSettingsEnvelopeV1 {
  return {
    ...agentRuntimeSettingsEnvelope(mergeLocalRuntimeSettings(defaults.sciforge, patch?.sciforge)),
    codex: mergeCodexRuntimeSettings(
      defaults.codex ?? defaultCodexRuntimeSettings(),
      patch?.codex
    ),
    claude: mergeClaudeRuntimeSettings(
      defaults.claude ?? defaultClaudeRuntimeSettings(),
      patch?.claude
    )
  }
}

function normalizeLocalRuntimeDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_LOCAL_RUNTIME_DATA_DIR
  const trimmed = value.trim()
  return trimmed || DEFAULT_LOCAL_RUNTIME_DATA_DIR
}
