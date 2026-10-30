import type { DshModelRouter } from './model-router.js'
import type { Wire } from './transport.js'
export interface DshRuntimeOptions {
  /** Trusted main-process-selected closure root. Renderer/env values are never accepted. */
  artifactRoot?: string
  /** Absolute trusted launcher; no shell expansion or dependency auto-install.
   * Optional only when resolveDeploymentTarget supplies the per-attempt target. */
  executable?: string
  executableArgs?: readonly string[]
  /** Dedicated Host-owned state, never a user's ordinary DSH profile. */
  stateDirectory: string
  modelRouter?: DshModelRouter
  /** Resolve fresh Host-authorized neutral settings before every connection use. */
  getModelRouter?: (context: DshContext) => Promise<DshModelRouter>
  /** Explicit approved provider/env values. Ambient process.env is never spread. */
  providerEnv?: Readonly<Record<string, string>>
  /** Host must audit/pin the composed deployment before any ACP process is started.
   * A missing verifier fails closed. It must reject unapproved digests/plugin names.
   * This callback is deployment authority, NOT a model/tool approval callback. */
  verifyDeployment?: (deployment: DshDeployment) => Promise<void>
  /** Trusted composition checks artifact bytes BEFORE --version/--dump-config execute.
   * Optional only for controlled protocol fixtures and embedders with prior custody. */
  verifyExecutable?: () => Promise<void>
  /** Host-resolved approved deployment target, evaluated before every connect/probe.
   * When absent, the static executable/verify* fields above are the target.
   * `refresh` asks the Host to bypass any discovery cache it keeps, so an
   * explicit probe always reports the current disk state. */
  resolveDeploymentTarget?: (input?: { command?: string; settings?: unknown; refresh?: boolean }) => Promise<DshDeploymentTarget>
  /** Static fallback for embedders that do not resolve a per-attempt target; the
   * target's own `commandExecution` wins. Absent/false keeps the audited closure. */
  commandExecution?: boolean
  /** When set, the deployed --version output must match exactly. Leave unset for
   * discovered user installs; the packaged artifact always pins its release version. */
  expectedVersion?: string
  /** Default ACP provider/model applied by the Host safety patch when no Host
   * model-router route is active. undefined = the release-audited default;
   * null = keep the install's own default route (used for discovered installs,
   * whose registry may not contain the audited provider/model). */
  defaultAcpRoute?: { provider: string; model: string } | null
  /** 'static' (default) applies the release-audited patch — the packaged pin
   * identity. 'derived' builds the patch from the install's own unpatched
   * dump, so entries added or removed by a different release never break or
   * weaken a discovered install; the composed result is checked against the
   * version-agnostic invariants instead of a fixed entry list alone. */
  safetyPatch?: 'static' | 'derived'
  /** Obtain only the already-authorized Host MCP entry for this exact immutable turn identity.
   * ACP mounts MCP at session creation/resume, not per prompt. Return a stable Host
   * session transport whose dispatch binds a fresh immutable lease each turn;
   * revoke that lease on this signal even when nobody consumes runtime events.
   * A changed live-session MCP configuration fails closed (no invented update API). */
  getAuthorizedMcpServers?: (identity: DshIdentity & { workspace: string; allowedTools?: readonly string[]; permissionLevel?: string; governanceProfile?: string; signal: AbortSignal }) => Promise<readonly DshMcpServer[]>
  resolveWorkspace?: (context: DshContext, input: { workspace?: string | null; workspaceLocator?: unknown }) => Promise<string>
  /** Lifecycle requests and Host callbacks; defaults to 15 seconds. */
  requestTimeoutMs?: number
  /** Finite total prompt budget, independent of lifecycle requests. Defaults to 15 seconds. */
  promptTimeoutMs?: number
  /** Cancel acknowledgement/quiescence budget; defaults to the lifecycle budget. */
  cancelTimeoutMs?: number
  approvalTimeoutMs?: number
}
/** One approved launch target for a single connect/probe attempt. The Host owns
 * discovery; this package owns what makes a target trustworthy. */
export interface DshDeploymentTarget {
  executable: string
  artifactRoot?: string
  executableArgs?: readonly string[]
  verifyExecutable?: () => Promise<void>
  verifyDeployment: (deployment: DshDeployment) => Promise<void>
  /** Exact --version requirement for this target; absent means any parseable version. */
  expectedVersion?: string
  /** See DshRuntimeOptions.defaultAcpRoute; overrides the option for this target. */
  defaultAcpRoute?: { provider: string; model: string } | null
  /** See DshRuntimeOptions.safetyPatch; overrides the option for this target. */
  safetyPatch?: 'static' | 'derived'
  /** Host-owned, per-attempt enablement of the reviewed shell tools (tool-bash /
   * tool-pwsh). Absent or false keeps the audited closure; true must also be the
   * mode the Host's own deployment verifier approves. */
  commandExecution?: boolean
  /** Discovery provenance, reported through the neutral probe contract. */
  source?: 'user-configured' | 'process-path' | 'login-shell-path' | 'common-install-location' | 'application-bundle' | 'packaged-application'
}
export interface DshDeployment { version: string; configDigest: string; composedConfig: string; executable: string }
export interface DshMcpServer { type: 'http'; name: string; url: string; headers: readonly { name: string; value: string }[] }
export type DshPrincipal = Readonly<{ authority: string; subject: string; assurance: 'local-selection' | 'cloud-authenticated'; deviceId: string; identityVersion: number }>
export type DshPrincipalContext = Readonly<{ identityVersion: number; principal: DshPrincipal | null }>
export interface DshIdentity { runtimeId: 'dsh'; threadId: string; turnId: string; principal?: DshPrincipal; principalContext?: DshPrincipalContext }
export interface DshContext { settings?: unknown; principal?: DshPrincipal; principalContext?: DshPrincipalContext; onTurnAccepted?: (handle: DshTurnHandle) => Promise<void> }
export interface DshThreadInput { runtimeId: string; workspace?: string | null; workspaceLocator?: unknown }
export interface DshTurnInput {
  runtimeId: string; threadId?: string | null; text?: string; workspace?: string | null
  principal?: Readonly<Record<string, unknown>>; principalContext?: Readonly<Record<string, unknown>>
  input?: readonly unknown[]; attachments?: readonly unknown[]; attachmentIds?: readonly string[]; fileReferences?: readonly unknown[]; outputSchema?: unknown; model?: string; mode?: string; reasoningEffort?: string; serviceTier?: string; allowedTools?: readonly string[]; permissionLevel?: string; governanceProfile?: string; signal?: AbortSignal
}
export interface DshTurnHandle { runtimeId: 'dsh'; threadId: string; turnId: string }
export interface DshThread { id: string; runtimeId: 'dsh'; title: string; updatedAt: string; workspace?: string; state?: 'running' | 'idle' | 'failed' | 'unknown' }
export interface DshToolItem { id: string; turnId: string; kind: 'tool'; toolKind: 'tool_call'; status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted'; summary?: string; detail?: string; meta?: Record<string, unknown> }
export type DshEvent = DshIdentity & { seq: number; createdAt: string } & (
  | { kind: 'item_snapshot'; item: DshToolItem }
  | { kind: 'assistant_delta'; text: string; itemId: string }
  | { kind: 'reasoning_delta'; text: string; itemId: string; visibility: 'full_runtime_text'; source: 'model' }
  | { kind: 'turn_lifecycle'; state: 'running' | 'completed' | 'interrupted' | 'failed'; message?: string }
  | { kind: 'approval_requested'; approvalId: string; summary: string; meta?: Record<string, unknown> }
  | { kind: 'approval_resolved'; approvalId: string; decision: 'allowed' | 'denied' | 'error'; message?: string }
)
export type DshApprovalResponse = {
  runtimeId: string; threadId?: string | null;  approvalId: string
  decision: 'allowed' | 'denied'
}
export type DshWireMessage = Wire
