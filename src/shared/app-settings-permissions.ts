import type { ApprovalPolicy, SandboxMode } from './app-settings-types'

/** Product-level permission choices shared by agent runtime settings. */
export const AGENT_PERMISSION_LEVELS = [
  'request-approval',
  'assisted-approval',
  'full-access'
] as const
export type AgentPermissionLevel = typeof AGENT_PERMISSION_LEVELS[number]

export function permissionLevelFromRuntime(
  approvalPolicy: ApprovalPolicy,
  sandboxMode: SandboxMode
): AgentPermissionLevel {
  if (sandboxMode === 'danger-full-access') return 'full-access'
  return approvalPolicy === 'untrusted' || approvalPolicy === 'auto' || approvalPolicy === 'never'
    ? 'assisted-approval'
    : 'request-approval'
}

export function runtimePatchForPermissionLevel(
  level: AgentPermissionLevel,
  fullAccessApprovalPolicy: 'never' | 'auto' = 'never'
): { approvalPolicy: ApprovalPolicy; sandboxMode: SandboxMode } {
  if (level === 'full-access') {
    return {
      approvalPolicy: fullAccessApprovalPolicy,
      sandboxMode: 'danger-full-access'
    }
  }
  return {
    approvalPolicy: level === 'assisted-approval' ? 'untrusted' : 'on-request',
    sandboxMode: 'workspace-write'
  }
}
