import type { EditorState, Transaction } from '@tiptap/pm/state'
import { parseWriteMarkdown } from './markdown-manager'

export function replaceRangeWithMarkdown(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  from: number,
  to: number,
  markdown: string,
  configureTr?: (tr: Transaction) => void
): boolean {
  let parsed
  try {
    parsed = parseWriteMarkdown(markdown)
  } catch {
    return false
  }

  const content = Array.isArray(parsed.content) ? parsed.content : []
  if (dispatch) {
    const schema = state.schema
    const tr = state.tr
    try {
      if (content.length === 1 && content[0].type === 'paragraph') {
        const inline = (content[0].content ?? []).map((node) => schema.nodeFromJSON(node))
        tr.replaceWith(from, to, inline)
      } else if (content.length > 0) {
        tr.replaceWith(from, to, content.map((node) => schema.nodeFromJSON(node)))
      } else {
        tr.delete(from, to)
      }
    } catch {
      return false
    }
    configureTr?.(tr)
    dispatch(tr.scrollIntoView())
  }
  return true
}
