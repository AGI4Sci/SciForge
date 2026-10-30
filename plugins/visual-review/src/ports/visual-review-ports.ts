/**
 * Host service extension requirement, NOT a DSH built-in service or RPC
 * implementation.
 *
 * The protocol shape is intentionally aligned with plugins/evidence-dag/src/
 * ports.ts delivered by #53 (HOST-PORTS). The #53 alignment review folded
 * visual-review into the same common host-bridge line; when the host
 * generalizes that bridge delivery, this file is expected to converge into
 * the shared protocol, at which point only the constants below should need
 * to change (the request/ports types stay identical on purpose).
 *
 * Scope note: visual-review does not own runtime/thread identities, so the
 * adapter omits `scope` from its requests. The host bridge MUST bind
 * runtime/thread/workspace from the authenticated invocation connection —
 * never from tool input — exactly like the static path's
 * host.capabilities.invoke(..., { workspaceId }) (see HOST-PORTS.md: the
 * Host must not trust input identity, workspaceRoot, or callId).
 */
export const PORTS_SERVICE = 'visualReviewPorts' as const
export const PORTS_VERSION = 'sciforge-visual-review-ports.v1' as const
export type Scope = Readonly<{ runtimeId: string; threadId: string; workspaceRoot: string }>
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Identity = Readonly<{ pluginId: string; version: string; profileId: string }>
export type Caller = Readonly<{ callId: string; agentId?: string; sessionId?: string }>
export type PortRequest = Readonly<{
  protocol: typeof PORTS_VERSION
  requestId: string
  identity: Identity
  caller?: Caller
  operation: 'artifacts.commit' | 'artifacts.read' | 'artifacts.listEvents'
  scope?: Scope
  input: Json
}>
/** Functions stay local to the adapter. Only PortRequest/cancel ID/JSON/errors may cross IPC.
 * The Host MUST bind identity to the connection and authorize caller + scope before effects.
 * Rejections preserve structured error codes. cancel resolves only at actual quiescence.
 */
export type VisualReviewPorts = Readonly<{
  identity: Identity
  storageRoot: string // Host-granted dedicated profile/package directory, never tool input.
  request(request: PortRequest): Promise<Json>
  cancel(requestId: string): Promise<{ cancelled: boolean; quiescent: boolean }>
}>
