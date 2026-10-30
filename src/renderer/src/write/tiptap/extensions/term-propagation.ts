import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../term-propagation'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset,
  projectedOffsetForPos
} from '../markdown-projection'

export const writeRichTermPropagationMeta = 'writeRichTermPropagation'
export const writeRichExternalSyncMeta = 'writeRichExternalSync'

const termPropagationKey = new PluginKey('writeRichTermPropagation')

type SeedStep = {
  from: number
  insertedSize: number
  deletedText: string
  insertedText: string
}

function collectSeedStep(transactions: readonly Transaction[]): SeedStep | null {
  const steps: SeedStep[] = []
  for (const transaction of transactions) {
    if (transaction.getMeta(writeRichTermPropagationMeta)) return null
    if (transaction.getMeta(writeRichExternalSyncMeta)) return null
    for (let index = 0; index < transaction.steps.length; index += 1) {
      const step = transaction.steps[index]
      if (!(step instanceof ReplaceStep)) continue
      const docBefore = transaction.docs[index]
      if (!docBefore) continue
      steps.push({
        from: step.from,
        insertedSize: step.slice.size,
        deletedText: docBefore.textBetween(step.from, step.to, '\n', () => ''),
        insertedText: step.slice.content.textBetween(0, step.slice.content.size, '\n', '')
      })
      if (steps.length > 1) return null
    }
  }
  if (steps.length !== 1) return null
  const [seed] = steps
  if (!seed.deletedText || !seed.insertedText) return null
  return seed
}

export function createWriteRichTermPropagationPlugin(): Plugin {
  return new Plugin({
    key: termPropagationKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null
      const seedStep = collectSeedStep(transactions)
      if (!seedStep) return null

      const doc = newState.doc
      const projection = buildWriteRichMarkdownProjection(doc)
      const insertEnd = Math.min(seedStep.from + seedStep.insertedSize, doc.content.size)
      const projectedFrom = projectedOffsetForPos(doc, projection, seedStep.from)
      const projectedTo = projectedOffsetForPos(doc, projection, insertEnd)
      if (projectedFrom === null || projectedTo === null) return null

      const seed: WriteTermReplacementSeed = {
        from: projectedFrom,
        to: projectedTo,
        deletedText: seedStep.deletedText,
        insertedText: seedStep.insertedText
      }
      const content = projection.text
      const rawChanges = [
        ...buildWriteTermPropagationChanges(content, seed),
        ...buildWriteCanonicalTermPropagationChanges(content, seed)
      ]
      if (rawChanges.length === 0) return null

      const seen = new Set<string>()
      const mapped: Array<{ from: number; to: number; insert: string }> = []
      for (const change of rawChanges) {
        const dedupeKey = `${change.from}:${change.to}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        const from = posForProjectedOffset(doc, projection, change.from)
        const to = posForProjectedOffset(doc, projection, change.to)
        if (from === null || to === null || to < from) continue
        if (doc.textBetween(from, to, '\n', () => '') !== content.slice(change.from, change.to)) {
          continue
        }
        mapped.push({ from, to, insert: change.insert })
      }
      if (mapped.length === 0) return null

      mapped.sort((a, b) => b.from - a.from)
      const tr = newState.tr
      for (const change of mapped) tr.insertText(change.insert, change.from, change.to)
      tr.setMeta(writeRichTermPropagationMeta, true)
      tr.setMeta('addToHistory', true)
      return tr
    }
  })
}

export const WriteRichTermPropagation = Extension.create({
  name: 'writeRichTermPropagation',

  addProseMirrorPlugins() {
    return [createWriteRichTermPropagationPlugin()]
  }
})
