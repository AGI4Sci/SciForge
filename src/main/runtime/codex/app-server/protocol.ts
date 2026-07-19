import type { Readable, Writable } from 'node:stream'

export type CodexAppServerRequestId = number | string

export type CodexAppServerApprovalPolicy =
  | 'never'
  | 'on-request'
  | 'on-failure'
  | 'untrusted'

export type CodexAppServerThreadSandboxPolicy =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type CodexAppServerTurnSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess?: boolean }
  | {
    type: 'workspaceWrite'
    writableRoots?: string[]
    networkAccess?: boolean
    excludeTmpdirEnvVar?: boolean
    excludeSlashTmp?: boolean
  }

export type CodexAppServerInputItem = {
  type: string
  [key: string]: unknown
}

export type CodexAppServerClientInfo = {
  name: string
  title?: string | null
  version: string
}

export type SpawnCodexAppServerProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    detached?: boolean
    windowsHide?: boolean
  },
) => CodexAppServerProcess

export interface CodexAppServerProcess {
  pid?: number
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type CodexAppServerJsonRpcRequest = {
  id: CodexAppServerRequestId
  method: string
  params?: unknown
}

export type CodexAppServerJsonRpcNotification = {
  method: string
  params?: unknown
}

export type CodexAppServerJsonRpcResponse = {
  id: CodexAppServerRequestId
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

export type CodexAppServerServerRequestHandler = (
  request: CodexAppServerJsonRpcRequest,
) => unknown | Promise<unknown>

export type CodexAppServerInitializeParams = {
  clientInfo?: CodexAppServerClientInfo
  capabilities?: Record<string, unknown>
  [key: string]: unknown
}

export type CodexAppServerThreadStartParams = {
  cwd: string
  model?: string
  modelProvider?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandbox?: CodexAppServerThreadSandboxPolicy
  ephemeral?: boolean
  serviceName?: string
  developerInstructions?: string
  [key: string]: unknown
}

export type CodexAppServerThreadResumeParams = {
  threadId: string
  cwd?: string
  model?: string
  modelProvider?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandbox?: CodexAppServerThreadSandboxPolicy
  [key: string]: unknown
}

export type CodexAppServerThreadListParams = {
  limit?: number
  cursor?: string
  [key: string]: unknown
}

export type CodexAppServerThreadReadParams = {
  threadId: string
  [key: string]: unknown
}

export type CodexAppServerThreadRenameParams = {
  threadId: string
  title: string
  [key: string]: unknown
}

export type CodexAppServerThreadDeleteParams = {
  threadId: string
  [key: string]: unknown
}

export type CodexAppServerTurnStartParams = {
  threadId: string
  input?: CodexAppServerInputItem[]
  responsesapiClientMetadata?: Record<string, string> | null
  cwd?: string
  model?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandboxPolicy?: CodexAppServerTurnSandboxPolicy
  [key: string]: unknown
}

export type CodexAppServerTurnInterruptParams = {
  threadId: string
  turnId: string
  [key: string]: unknown
}

export type CodexAppServerTurnSteerParams = {
  threadId: string
  expectedTurnId: string
  input: CodexAppServerInputItem[]
  [key: string]: unknown
}

export type CodexAppServerPlanType =
  | 'free'
  | 'go'
  | 'plus'
  | 'pro'
  | 'prolite'
  | 'team'
  | 'self_serve_business_usage_based'
  | 'business'
  | 'enterprise_cbp_usage_based'
  | 'enterprise'
  | 'edu'
  | 'unknown'

export type CodexAppServerAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string; planType: CodexAppServerPlanType }
  | { type: 'amazonBedrock' }

export type CodexAppServerGetAccountParams = {
  refreshToken?: boolean
}

export type CodexAppServerGetAccountResponse = {
  account: CodexAppServerAccount | null
  requiresOpenaiAuth: boolean
}

export type CodexAppServerLoginAccountParams =
  | { type: 'chatgpt'; codexStreamlinedLogin?: boolean }
  | { type: 'chatgptDeviceCode' }

export type CodexAppServerLoginAccountResponse =
  | { type: 'chatgpt'; loginId: string; authUrl: string }
  | {
    type: 'chatgptDeviceCode'
    loginId: string
    verificationUrl: string
    userCode: string
  }

export type CodexAppServerAccountLoginCompletedNotification = {
  loginId: string | null
  success: boolean
  error: string | null
}

export type CodexAppServerAccountUpdatedNotification = {
  authMode: string | null
  planType: CodexAppServerPlanType | null
}

export type CodexAppServerRateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export type CodexAppServerRateLimitSnapshot = {
  limitId: string | null
  limitName: string | null
  primary: CodexAppServerRateLimitWindow | null
  secondary: CodexAppServerRateLimitWindow | null
  credits: {
    hasCredits: boolean
    unlimited: boolean
    balance: string | null
  } | null
  individualLimit: Record<string, unknown> | null
  planType: CodexAppServerPlanType | null
  rateLimitReachedType: string | null
}

export type CodexAppServerGetAccountRateLimitsResponse = {
  rateLimits: CodexAppServerRateLimitSnapshot
  rateLimitsByLimitId: Record<string, CodexAppServerRateLimitSnapshot> | null
  rateLimitResetCredits: { availableCount: number | string | bigint } | null
}

export type CodexAppServerAccountRateLimitsUpdatedNotification = {
  rateLimits: CodexAppServerRateLimitSnapshot
}
