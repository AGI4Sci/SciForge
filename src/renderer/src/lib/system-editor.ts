import type { EditorOpenResult, OpenEditorPathOptions } from '@shared/editor'

export type SystemEditorPathOpener = (
  options: OpenEditorPathOptions
) => Promise<EditorOpenResult>

export type SystemEditorReturnEventTarget = {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
}

export async function openPathInSystemEditor(input: {
  openPath: SystemEditorPathOpener
  path: string
  workspaceRoot?: string
}): Promise<void> {
  const result = await input.openPath({
    path: input.path,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    editorId: 'system'
  })
  if (!result.ok) throw new Error(result.message)
}

export function watchForSystemEditorReturn(input: {
  windowTarget: SystemEditorReturnEventTarget
  documentTarget?: SystemEditorReturnEventTarget
  isDocumentHidden?: () => boolean
  onReturn: () => void
}): () => void {
  let away = input.isDocumentHidden?.() ?? false
  let disposed = false

  const markAway = (): void => {
    away = true
  }
  const refreshAfterReturn = (): void => {
    if (disposed || !away) return
    away = false
    input.onReturn()
  }
  const handleVisibilityChange = (): void => {
    if (input.isDocumentHidden?.()) {
      markAway()
      return
    }
    refreshAfterReturn()
  }

  input.windowTarget.addEventListener('blur', markAway)
  input.windowTarget.addEventListener('focus', refreshAfterReturn)
  input.documentTarget?.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    if (disposed) return
    disposed = true
    input.windowTarget.removeEventListener('blur', markAway)
    input.windowTarget.removeEventListener('focus', refreshAfterReturn)
    input.documentTarget?.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
