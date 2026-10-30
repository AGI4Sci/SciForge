import type { Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { createWriteRecentEdit, type WriteRecentEdit } from '../recent-edits'
import {
  buildWriteRichMarkdownProjection,
  projectedOffsetForPos
} from './markdown-projection'

const RECENT_EDIT_CONTEXT_CHARS = 160

export function recentEditsFromRichTransaction(
  transaction: Transaction,
  filePath: string
): WriteRecentEdit[] {
  const path = filePath.trim()
  if (!path || !transaction.docChanged) return []

  const edits: WriteRecentEdit[] = []
  const timestamp = Date.now()

  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) continue
    const oldDoc = transaction.docs[index]
    const newDoc = transaction.docs[index + 1] ?? transaction.doc
    if (!oldDoc) continue

    const from = step.from
    const to = step.to
    const oldProjection = buildWriteRichMarkdownProjection(oldDoc)
    const projectedFrom = projectedOffsetForPos(oldDoc, oldProjection, from)
    const projectedTo = projectedOffsetForPos(oldDoc, oldProjection, to)
    if (projectedFrom === null || projectedTo === null) continue

    const deletedText = oldDoc.textBetween(from, to, '\n', () => '')
    const insertedText = step.slice.content.textBetween(0, step.slice.content.size, '\n', '')
    const newProjection = buildWriteRichMarkdownProjection(newDoc)
    const insertEnd = Math.min(from + step.slice.size, newDoc.content.size)
    const projectedInsertEnd = projectedOffsetForPos(newDoc, newProjection, insertEnd)

    const edit = createWriteRecentEdit({
      source: 'user',
      timestamp,
      filePath: path,
      from: projectedFrom,
      to: projectedTo,
      deletedText,
      insertedText,
      beforeContext: oldProjection.text.slice(
        Math.max(0, projectedFrom - RECENT_EDIT_CONTEXT_CHARS),
        projectedFrom
      ),
      afterContext:
        projectedInsertEnd === null
          ? ''
          : newProjection.text.slice(
              projectedInsertEnd,
              Math.min(newProjection.text.length, projectedInsertEnd + RECENT_EDIT_CONTEXT_CHARS)
            )
    })
    if (edit) edits.push(edit)
  }

  return edits
}
