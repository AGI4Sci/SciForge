import type { EditorOpenResult } from '@shared/editor'
import { readPreferredEditorId } from './editor-preferences'

export type WorkspacePathTarget = {
  path: string
  line?: number
  column?: number
}

type WorkspacePathOpenOptions = {
  editorId?: string
}

export async function openWorkspacePathInEditor(
  target: WorkspacePathTarget,
  workspaceRoot?: string,
  options: WorkspacePathOpenOptions = {}
): Promise<EditorOpenResult> {
  if (typeof window === 'undefined' || typeof window.sciforge?.openEditorPath !== 'function') {
    return { ok: false, message: 'Editor bridge is unavailable.' }
  }

  try {
    return await window.sciforge.openEditorPath({
      path: target.path,
      line: target.line,
      column: target.column,
      workspaceRoot,
      editorId: options.editorId ?? readPreferredEditorId()
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const openWorkspacePath = openWorkspacePathInEditor
