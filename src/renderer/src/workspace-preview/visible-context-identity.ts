const WORKSPACE_PREVIEW_VISIBLE_CONTEXT_COMPONENT_ID = 'right-sidebar.file-preview'

export function workspacePreviewVisibleContextComponentId(input: Readonly<{
  sessionId?: string
  surfaceId: string
}>): string {
  return `${WORKSPACE_PREVIEW_VISIBLE_CONTEXT_COMPONENT_ID}:session:${encodeURIComponent(input.sessionId ?? '')}:surface:${encodeURIComponent(input.surfaceId)}`
}
