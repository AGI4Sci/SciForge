import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG,
  LocalRuntimeCapabilitiesConfig,
  ModelInputModality,
  ModelMessagePartSupport
} from '../contracts/capabilities.js'

export const LOCAL_RUNTIME_CONFIG_FILENAME = 'config.json'
export const DEFAULT_LOCAL_RUNTIME_MODEL = 'sciforge-router'

const PositiveInt = z.number().int().positive()
const PositiveRatio = z.number().positive().max(1)

export const ModelContextCompactionProfileConfigSchema = z
  .object({
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softThreshold !== undefined &&
      profile.hardThreshold !== undefined &&
      profile.hardThreshold < profile.softThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelContextProfileConfigSchema = z
  .object({
    aliases: z.array(z.string().min(1)).optional(),
    contextWindowTokens: PositiveInt.optional(),
    contextCompaction: ModelContextCompactionProfileConfigSchema.optional(),
    inputModalities: z.array(ModelInputModality).optional(),
    outputModalities: z.array(ModelInputModality).optional(),
    supportsToolCalling: z.boolean().optional(),
    messageParts: z.array(ModelMessagePartSupport).optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasRatio =
      profile.contextCompaction?.softRatio !== undefined ||
      profile.contextCompaction?.hardRatio !== undefined
    if (hasRatio && profile.contextWindowTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'softRatio and hardRatio require contextWindowTokens'
      })
    }
    const softThreshold = profile.contextCompaction?.softThreshold
    const hardThreshold = profile.contextCompaction?.hardThreshold
    if (softThreshold !== undefined && hardThreshold !== undefined && hardThreshold < softThreshold) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelConfigSchema = z
  .object({
    profiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()

export const ContextCompactionConfigSchema = z
  .object({
    defaultSoftThreshold: PositiveInt.optional(),
    defaultHardThreshold: PositiveInt.optional(),
    summaryMode: z.enum(['heuristic', 'model']).optional(),
    summaryTimeoutMs: PositiveInt.optional(),
    summaryMaxTokens: PositiveInt.optional(),
    summaryInputMaxBytes: PositiveInt.optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.defaultSoftThreshold !== undefined &&
      config.defaultHardThreshold !== undefined &&
      config.defaultHardThreshold < config.defaultSoftThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultHardThreshold must be greater than or equal to defaultSoftThreshold'
      })
    }
  })

const ToolBudgetProfileConfigSchema = z
  .object({
    softLimit: PositiveInt.optional(),
    hardLimit: PositiveInt.optional(),
    maxAutomaticPhases: PositiveInt.optional(),
    totalLimit: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softLimit !== undefined &&
      profile.hardLimit !== undefined &&
      profile.softLimit > profile.hardLimit
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'softLimit must be less than or equal to hardLimit'
      })
    }
    if (
      profile.hardLimit !== undefined &&
      profile.totalLimit !== undefined &&
      profile.hardLimit > profile.totalLimit
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'totalLimit must be greater than or equal to hardLimit'
      })
    }
  })

export const RuntimeTuningConfigSchema = z
  .object({
    modelStreamIdleTimeoutMs: PositiveInt.optional(),
    maxTurnModelSteps: PositiveInt.optional(),
    maxToolCallsPerTurn: PositiveInt.optional(),
    toolStorm: z
      .object({
        enabled: z.boolean().optional(),
        windowSize: PositiveInt.optional(),
        threshold: z.number().int().min(2).optional(),
        maxRecoverySteps: PositiveInt.optional(),
        nonProgressThreshold: PositiveInt.optional(),
        maxStepsAfterRecovery: PositiveInt.optional(),
        maxToolCallsPerTurn: PositiveInt.optional()
      })
      .strict()
      .optional(),
    stuckDetection: z
      .object({
        enabled: z.boolean().optional(),
        maxItems: PositiveInt.optional(),
        repeatedActionObservationThreshold: z.number().int().min(2).optional(),
        repeatedActionErrorThreshold: z.number().int().min(2).optional(),
        alternatingThreshold: z.number().int().min(4).optional(),
        redundantReadThreshold: PositiveInt.optional()
      })
      .strict()
      .optional(),
    toolArgumentRepair: z
      .object({
        maxStringBytes: PositiveInt.optional()
      })
      .strict()
      .optional(),
    toolBudget: z
      .object({
        enabled: z.boolean().optional(),
        profiles: z
          .object({
            explanation: ToolBudgetProfileConfigSchema.optional(),
            review: ToolBudgetProfileConfigSchema.optional(),
            implementation: ToolBudgetProfileConfigSchema.optional(),
            long: ToolBudgetProfileConfigSchema.optional()
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    parallelism: z
      .object({
        localReadOnly: PositiveInt.optional(),
        networkMcp: PositiveInt.optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const RequestHistoryHygieneConfigSchema = z
  .object({
    maxToolResultLines: PositiveInt.optional(),
    maxToolResultBytes: PositiveInt.optional(),
    maxToolResultTokens: PositiveInt.optional(),
    maxToolArgumentStringBytes: PositiveInt.optional(),
    maxToolArgumentStringTokens: PositiveInt.optional(),
    maxArrayItems: PositiveInt.optional()
  })
  .strict()

export const TokenEconomyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: RequestHistoryHygieneConfigSchema.optional()
  })
  .strict()

export const StorageConfigSchema = z
  .object({
    backend: z.enum(['hybrid', 'file']).default('hybrid'),
    sqlitePath: z.string().min(1).optional()
  })
  .strict()

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: 'hybrid'
}

export const LocalRuntimeServeConfigSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    dataDir: z.string().min(1).optional(),
    runtimeToken: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().min(1).optional(),
    approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY).optional(),
    sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE).optional(),
    tokenEconomyMode: z.boolean().optional(),
    tokenEconomy: TokenEconomyConfigSchema.optional(),
    insecure: z.boolean().optional(),
    storage: StorageConfigSchema.optional()
  })
  .strict()

export const LocalRuntimeConfigSchema = z
  .object({
    serve: LocalRuntimeServeConfigSchema.optional(),
    models: ModelConfigSchema.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    capabilities: LocalRuntimeCapabilitiesConfig.default(DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG)
  })
  .strict()

export type LocalRuntimeConfig = z.infer<typeof LocalRuntimeConfigSchema>
export type LocalRuntimeServeConfig = z.infer<typeof LocalRuntimeServeConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ContextCompactionConfig = z.infer<typeof ContextCompactionConfigSchema>
export type RuntimeTuningConfig = z.infer<typeof RuntimeTuningConfigSchema>
export type TokenEconomyConfig = z.infer<typeof TokenEconomyConfigSchema>
export type StorageConfig = z.infer<typeof StorageConfigSchema>

export type LoadedLocalRuntimeConfig = {
  path: string
  config: LocalRuntimeConfig
}

export function readLocalRuntimeConfigFile(path: string): LoadedLocalRuntimeConfig {
  const resolvedPath = expandHomePath(path)
  const text = readFileSync(resolvedPath, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse SciForge Runtime config JSON at ${resolvedPath}: ${message}`)
  }
  const parsed = LocalRuntimeConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid SciForge Runtime config at ${resolvedPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  return { path: resolvedPath, config: parsed.data }
}

export function readOptionalLocalRuntimeConfigFile(path: string | undefined): LoadedLocalRuntimeConfig | null {
  if (!path) return null
  const resolvedPath = expandHomePath(path)
  if (!existsSync(resolvedPath)) return null
  return readLocalRuntimeConfigFile(resolvedPath)
}

export function localRuntimeConfigPathForDataDir(dataDir: string | undefined): string | undefined {
  const trimmed = dataDir?.trim()
  if (!trimmed) return undefined
  return join(expandHomePath(trimmed), LOCAL_RUNTIME_CONFIG_FILENAME)
}

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}
