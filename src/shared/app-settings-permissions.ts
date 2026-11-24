import type { ApprovalPolicy, SandboxMode } from './app-settings-types'

/** Filesystem authority choices; approval policy is a separate setting. */
export const AGENT_PERMISSION_LEVELS = [
  'read-only',
  'workspace-write',
  'danger-full-access',
  'external-sandbox',
  // Existing queued turns keep their original approval semantics when read.
  'request-approval',
  'assisted-approval',
  'full-access'
] as const
export type AgentPermissionLevel = typeof AGENT_PERMISSION_LEVELS[number]
export type AgentSandboxPermissionLevel = 'read-only' | 'workspace-write' | 'danger-full-access'

export function isFullAccessPermission(level: AgentPermissionLevel | undefined): boolean {
  return level === 'danger-full-access' || level === 'full-access'
}

export function permissionLevelFromRuntime(
  _approvalPolicy: ApprovalPolicy,
  sandboxMode: SandboxMode
): SandboxMode {
  return sandboxMode
}

export function runtimePatchForPermissionLevel(
  level: AgentPermissionLevel,
  fullAccessApprovalPolicy: 'never' | 'auto' = 'never'
): { approvalPolicy?: ApprovalPolicy; sandboxMode: SandboxMode } {
  if (isFullAccessPermission(level)) {
    return { approvalPolicy: fullAccessApprovalPolicy, sandboxMode: 'danger-full-access' }
  }
  if (level === 'request-approval' || level === 'assisted-approval') {
    return { approvalPolicy: level === 'assisted-approval' ? 'untrusted' : 'on-request', sandboxMode: 'workspace-write' }
  }
  return { sandboxMode: level as SandboxMode }
}
