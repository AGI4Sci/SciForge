import {
  DEFAULT_CLAUDE_CONFIG_DIR,
  type AppSettingsV1,
  type ApprovalPolicy,
  type ClaudeRuntimeSettingsPatchV1,
  type ClaudeRuntimeSettingsV1,
  type AgentRuntimeSettingsEnvelopePatchV1,
  type SandboxMode
} from './app-settings-types'

const DEFAULT_CLAUDE_COMMAND = 'claude'
const DEFAULT_CLAUDE_APPROVAL_POLICY: ApprovalPolicy = 'on-request'
const DEFAULT_CLAUDE_SANDBOX_MODE: SandboxMode = 'workspace-write'
const CLAUDE_APPROVAL_POLICIES = new Set<ApprovalPolicy>([
  'on-request',
  'untrusted',
  'never',
  'auto'
])
const CLAUDE_SANDBOX_MODES = new Set<SandboxMode>([
  'read-only',
  'workspace-write',
  'danger-full-access'
])

export function defaultClaudeRuntimeSettings(): ClaudeRuntimeSettingsV1 {
  return {
    command: DEFAULT_CLAUDE_COMMAND,
    configDir: DEFAULT_CLAUDE_CONFIG_DIR,
    model: '',
    approvalPolicy: DEFAULT_CLAUDE_APPROVAL_POLICY,
    sandboxMode: DEFAULT_CLAUDE_SANDBOX_MODE,
    extraArgs: []
  }
}

export function getClaudeRuntimeSettings(settings: AppSettingsV1): ClaudeRuntimeSettingsV1 {
  return mergeClaudeRuntimeSettings(
    defaultClaudeRuntimeSettings(),
    (settings as { agents?: { claude?: ClaudeRuntimeSettingsPatchV1 } }).agents?.claude
  )
}

export function claudeSettingsPatch(
  claude: ClaudeRuntimeSettingsPatchV1 | undefined
): AgentRuntimeSettingsEnvelopePatchV1 {
  return claude ? { claude } : {}
}

export function mergeClaudeRuntimeSettings(
  current: ClaudeRuntimeSettingsV1,
  patch: ClaudeRuntimeSettingsPatchV1 | undefined
): ClaudeRuntimeSettingsV1 {
  return normalizeClaudeRuntimeSettings({
    ...current,
    ...(patch ?? {}),
    extraArgs: Array.isArray(patch?.extraArgs) ? patch.extraArgs : current.extraArgs
  })
}

export function withClaudeRuntimeSettings(
  settings: AppSettingsV1,
  claude: ClaudeRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      claude
    }
  }
}

export function applyClaudeRuntimePatch(
  settings: AppSettingsV1,
  patch: ClaudeRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withClaudeRuntimeSettings(
    settings,
    mergeClaudeRuntimeSettings(getClaudeRuntimeSettings(settings), patch)
  )
}

function normalizeClaudeRuntimeSettings(
  input: Partial<ClaudeRuntimeSettingsV1> | undefined
): ClaudeRuntimeSettingsV1 {
  const defaults = defaultClaudeRuntimeSettings()
  const sandboxMode = normalizeSandboxMode(input?.sandboxMode, defaults.sandboxMode)
  return {
    command: nonEmptyString(input?.command, defaults.command),
    configDir: nonEmptyString(input?.configDir, defaults.configDir),
    model: optionalString(input?.model),
    approvalPolicy: sandboxMode === 'danger-full-access'
      ? 'auto'
      : normalizeApprovalPolicy(input?.approvalPolicy, defaults.approvalPolicy),
    sandboxMode,
    extraArgs: normalizeExtraArgs(input?.extraArgs)
  }
}

function normalizeApprovalPolicy(value: unknown, fallback: ApprovalPolicy): ApprovalPolicy {
  return CLAUDE_APPROVAL_POLICIES.has(value as ApprovalPolicy) ? value as ApprovalPolicy : fallback
}

function normalizeSandboxMode(value: unknown, fallback: SandboxMode): SandboxMode {
  return CLAUDE_SANDBOX_MODES.has(value as SandboxMode) ? value as SandboxMode : fallback
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
