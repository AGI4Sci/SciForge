/** Minimal authorized session DTO. Identity and ownership are checked by Host. */
export type ChangeInspectorSessionDetail = Readonly<{
  sessionId: string
  runtimeId: string
  workspaceRoot: string
  watermark: string
  artifacts: readonly unknown[]
  turns?: readonly Readonly<{ id: string; artifacts: readonly unknown[] }>[]
}>

export type ChangeInspectorAgentThreadsPort = Readonly<{
  read: (input: Readonly<{ runtimeId?: string; threadId?: string }>) => Promise<ChangeInspectorSessionDetail>
}>
