import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { parseWriteMarkdown } from './markdown-manager'

export const writeRichExternalSyncMeta = 'sciforge.write.rich.external-sync'

export type BlockSyncReplacement = {
  from: number
  to: number
  nodes: PMNode[]
}

export function computeBlockSyncReplacement(
  currentDoc: PMNode,
  nextDoc: PMNode
): BlockSyncReplacement | null {
  if (currentDoc.eq(nextDoc)) return null

  let prefix = 0
  const maxPrefix = Math.min(currentDoc.childCount, nextDoc.childCount)
  while (prefix < maxPrefix && currentDoc.child(prefix).eq(nextDoc.child(prefix))) {
    prefix += 1
  }

  let currentEnd = currentDoc.childCount
  let nextEnd = nextDoc.childCount
  while (
    currentEnd > prefix &&
    nextEnd > prefix &&
    currentDoc.child(currentEnd - 1).eq(nextDoc.child(nextEnd - 1))
  ) {
    currentEnd -= 1
    nextEnd -= 1
  }

  let from = 0
  for (let index = 0; index < prefix; index += 1) {
    from += currentDoc.child(index).nodeSize
  }

  let to = currentDoc.content.size
  for (let index = currentEnd; index < currentDoc.childCount; index += 1) {
    to -= currentDoc.child(index).nodeSize
  }

  const nodes: PMNode[] = []
  for (let index = prefix; index < nextEnd; index += 1) {
    nodes.push(nextDoc.child(index))
  }

  return { from, to, nodes }
}

export function applyExternalMarkdownToEditor(editor: Editor, markdown: string): boolean {
  let nextDoc: PMNode
  try {
    nextDoc = editor.schema.nodeFromJSON(parseWriteMarkdown(markdown))
  } catch {
    return false
  }

  const replacement = computeBlockSyncReplacement(editor.state.doc, nextDoc)
  if (!replacement) return true

  const tr = editor.state.tr
  if (replacement.nodes.length > 0) {
    tr.replaceWith(replacement.from, replacement.to, replacement.nodes)
  } else {
    tr.delete(replacement.from, replacement.to)
  }
  tr.setMeta(writeRichExternalSyncMeta, true)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
  return true
}
