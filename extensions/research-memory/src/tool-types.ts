export type ToolHostContext = {
  threadId: string
  turnId: string
  workspace: string
  project?: string
  filePathPolicy?: {
    allowPaths?: readonly string[]
    allowPatterns?: readonly string[]
    denyPatterns?: readonly string[]
  }
  abortSignal: AbortSignal
}
