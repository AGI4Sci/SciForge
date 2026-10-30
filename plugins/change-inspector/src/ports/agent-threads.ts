/**
 * The single environment seam of Change Inspector: reading one agent
 * session's detail for change projection. It mirrors the host's
 * `DomainMainAgentThreadsHost.read` narrowed to the fields this module
 * consumes (`DomainAgentThreadDetail` additionally carries transcript
 * messages and thread metadata the projection never reads).
 */
export type ChangeInspectorSessionDetail = Readonly<{
  workspaceRoot?: string
  watermark: string
  artifacts: readonly unknown[]
  turns?: readonly Readonly<{
    id: string
    artifacts: readonly unknown[]
  }>[]
}>

export type ChangeInspectorAgentThreadsPort = Readonly<{
  list?: (input: Readonly<{ includeArchived: false }>) => Promise<readonly Readonly<{ id: string; runtimeId: string }>[]>
  read: (input: Readonly<{
    runtimeId: string
    threadId: string
  }>) => Promise<ChangeInspectorSessionDetail>
}>
