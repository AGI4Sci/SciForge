export type ImageGenerationWorkflowPromptOptions = {
  visualDocumentId?: string
  threadId?: string
  workspaceRoot?: string
}

function imageGenerationWorkflowSharedArgs(
  options: ImageGenerationWorkflowPromptOptions
): Record<string, string | boolean> {
  const sharedArgs: Record<string, string | boolean> = {}
  const workspaceRoot = options.workspaceRoot?.trim()
  const visualDocumentId = options.visualDocumentId?.trim()
  const threadId = options.threadId?.trim()
  if (workspaceRoot) sharedArgs.workspaceRoot = workspaceRoot
  if (visualDocumentId) sharedArgs.visualDocumentId = visualDocumentId
  if (threadId) sharedArgs.threadId = threadId
  return sharedArgs
}

export function buildImageGenerationWorkflowPrompt(
  text: string,
  options: ImageGenerationWorkflowPromptOptions = {}
): string {
  const task = text.trim() || 'Create an image.'
  const sharedArgs = imageGenerationWorkflowSharedArgs(options)

  return [
    '[SciForge artifact request]',
    '',
    'Requested artifact kind: image.',
    'The runtime scientific-visual policy owns route selection; this composer marker does not select a renderer.',
    '',
    'User request:',
    task,
    ...(Object.keys(sharedArgs).length > 0
      ? ['', `Artifact context: ${JSON.stringify(sharedArgs)}.`]
      : [])
  ].join('\n')
}
