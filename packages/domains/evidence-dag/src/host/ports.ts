/** Host service extension requirement, NOT a DSH built-in service or RPC implementation. */
export const PORTS_SERVICE = 'evidenceDagPorts' as const
export const PORTS_VERSION = 'sciforge-evidence-ports.v1' as const
export type Scope = Readonly<{ runtimeId: string; threadId: string; workspaceRoot: string }>
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Identity = Readonly<{ pluginId: string; version: string; profileId: string }>
export type Caller = Readonly<{ callId: string; agentId?: string; sessionId?: string }>
export type PortRequest = Readonly<{
  protocol: typeof PORTS_VERSION
  requestId: string
  identity: Identity
  caller?: Caller
  operation: 'committed.status' | 'threads.read' | 'threads.list' | 'artifacts.commit' | 'artifacts.read' | 'artifacts.listEvents' |
    'sidecar.extract' | 'sidecar.commitSnapshot' | 'sidecar.readSnapshot' | 'sidecar.snapshotProducts' | 'sidecar.close'
  scope?: Scope
  input: Json
}>
/** Functions stay local to the adapter. Only PortRequest/cancel ID/JSON/errors may cross IPC.
 * The Host MUST bind identity to the connection and authorize caller + scope before effects.
 * Rejections preserve structured error codes. cancel resolves only at actual quiescence.
 */
export type EvidencePorts = Readonly<{
  identity: Identity
  storageRoot: string // Host-granted dedicated profile/package directory, never tool input.
  request(request: PortRequest): Promise<Json>
  cancel(requestId: string): Promise<{ cancelled: boolean; quiescent: boolean }>
}>
export type ThreadProjection = Scope & Readonly<{
  watermark: string
  trace: readonly Readonly<Record<string, unknown>>[] // already visibility-filtered artifact projection only
}>
