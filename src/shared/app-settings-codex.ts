import {
  DEFAULT_CODEX_DATA_DIR,
  type AgentRuntimeId,
  type AppSettingsV1,
  type ApprovalPolicy,
  type CodexReasoningEffort,
  type CodexRuntimeSettingsPatchV1,
  type CodexRuntimeSettingsV1,
  type AgentRuntimeSettingsEnvelopePatchV1,
  type SandboxMode
} from './app-settings-types'

const DEFAULT_CODEX_COMMAND = 'codex'
// A newly installed agent starts with the product's default permission level:
// full access. Explicitly persisted settings are still merged below and win.
const DEFAULT_CODEX_APPROVAL_POLICY: ApprovalPolicy = 'never'
const DEFAULT_CODEX_SANDBOX_MODE: SandboxMode = 'danger-full-access'
const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = ''
const CODEX_APPROVAL_POLICIES = new Set<ApprovalPolicy>([
  'on-request',
  'untrusted',
  'never'
])
const CODEX_SANDBOX_MODES = new Set<SandboxMode>([
  'read-only',
  'workspace-write',
  'danger-full-access'
])
export function defaultCodexRuntimeSettings(): CodexRuntimeSettingsV1 {
  return {
    command: DEFAULT_CODEX_COMMAND,
    autoStart: true,
    codexHome: DEFAULT_CODEX_DATA_DIR,
    profile: '',
    model: '',
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    serviceTier: '',
    modelProvider: '',
    approvalPolicy: DEFAULT_CODEX_APPROVAL_POLICY,
    sandboxMode: DEFAULT_CODEX_SANDBOX_MODE,
    extraArgs: []
  }
}

export function normalizeAgentRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'dsh') return value
  if (value === 'claude') return value
  if (value === 'codex') return value
  if (value === 'pi') return value
  // Unknown values (including removed legacy runtime ids) use the product default.
  return 'codex'
}

export function getActiveAgentRuntime(settings: AppSettingsV1): AgentRuntimeId {
  return normalizeAgentRuntimeId(settings.activeAgentRuntime)
}

export function getCodexRuntimeSettings(settings: AppSettingsV1): CodexRuntimeSettingsV1 {
  return mergeCodexRuntimeSettings(
    defaultCodexRuntimeSettings(),
    (settings as { agents?: { codex?: CodexRuntimeSettingsPatchV1 } }).agents?.codex
  )
}

export function codexSettingsPatch(
  codex: CodexRuntimeSettingsPatchV1 | undefined
): AgentRuntimeSettingsEnvelopePatchV1 {
  return codex ? { codex } : {}
}

export function mergeCodexRuntimeSettings(
  current: CodexRuntimeSettingsV1,
  patch: CodexRuntimeSettingsPatchV1 | undefined
): CodexRuntimeSettingsV1 {
  return normalizeCodexRuntimeSettings({
    ...current,
    ...(patch ?? {}),
    extraArgs: Array.isArray(patch?.extraArgs) ? patch.extraArgs : current.extraArgs
  })
}

export function withCodexRuntimeSettings(
  settings: AppSettingsV1,
  codex: CodexRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      codex
    }
  }
}

export function applyCodexRuntimePatch(
  settings: AppSettingsV1,
  patch: CodexRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withCodexRuntimeSettings(
    settings,
    mergeCodexRuntimeSettings(getCodexRuntimeSettings(settings), patch)
  )
}

function normalizeCodexRuntimeSettings(
  input: Partial<CodexRuntimeSettingsV1> | undefined
): CodexRuntimeSettingsV1 {
  const defaults = defaultCodexRuntimeSettings()
  const command = nonEmptyString(input?.command, defaults.command)
  const sandboxMode = normalizeSandboxMode(input?.sandboxMode, defaults.sandboxMode)
  return {
    command,
    autoStart: input?.autoStart !== false,
    codexHome: nonEmptyString(input?.codexHome, defaults.codexHome),
    profile: optionalString(input?.profile),
    model: optionalString(input?.model),
    reasoningEffort: normalizeReasoningEffort(input?.reasoningEffort),
    serviceTier: optionalString(input?.serviceTier),
    modelProvider: optionalString(input?.modelProvider),
    approvalPolicy: sandboxMode === 'danger-full-access'
      ? 'never'
      : normalizeApprovalPolicy(input?.approvalPolicy, defaults.approvalPolicy),
    sandboxMode,
    extraArgs: normalizeExtraArgs(input?.extraArgs)
  }
}

function normalizeApprovalPolicy(value: unknown, fallback: ApprovalPolicy): ApprovalPolicy {
  return CODEX_APPROVAL_POLICIES.has(value as ApprovalPolicy) ? value as ApprovalPolicy : fallback
}

function normalizeSandboxMode(value: unknown, fallback: SandboxMode): SandboxMode {
  return CODEX_SANDBOX_MODES.has(value as SandboxMode) ? value as SandboxMode : fallback
}

function normalizeReasoningEffort(value: unknown): CodexReasoningEffort {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_CODEX_REASONING_EFFORT
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeExtraArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)
}
