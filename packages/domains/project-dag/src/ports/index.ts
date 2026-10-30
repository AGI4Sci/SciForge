import type { EvidenceDagCommittedSnapshot } from '@sciforge/domain-evidence-dag/contract'

/** Identity metadata only: never a thread object, history, trace or Host Context. */
export type ProjectDagSessionIdentity = Readonly<{
  engineId: string; runtimeId: string; threadId: string; workspaceRoot: string
}>
export interface ProjectDagPorts {
  readSession(identity: Readonly<{ runtimeId: string; threadId: string }>): Promise<Readonly<{
    runtimeId: string; id: string; workspaceRoot?: string
  }>>
  readCommittedSnapshot(identity: ProjectDagSessionIdentity): Promise<EvidenceDagCommittedSnapshot>
  /** Canonical Project service commands; host authorizes target workspace before dispatch.
   * Cancellation before dispatch prevents mutation; after admission awaits quiescence,
   * then reports abort. A durable receipt is never rolled back by a caller timeout.
   */
  request(route: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown>
  serviceUrl: string
}
