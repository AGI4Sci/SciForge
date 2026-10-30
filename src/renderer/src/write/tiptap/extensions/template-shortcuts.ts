import { Extension } from '@tiptap/core'
import { buildWriteTemplateShortcutExpansion } from '../../template-shortcuts'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset,
  projectedOffsetForPos
} from '../markdown-projection'

export type WriteRichTemplateShortcutsOptions = {
  isReadOnly: () => boolean
}

export const WriteRichTemplateShortcuts = Extension.create<WriteRichTemplateShortcutsOptions>({
  name: 'writeRichTemplateShortcuts',
  priority: 5_000,

  addOptions() {
    return {
      isReadOnly: () => false
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (this.options.isReadOnly()) return false
        const state = editor.state
        if (!state.selection.empty) return false

        const doc = state.doc
        const projection = buildWriteRichMarkdownProjection(doc)
        const cursor = projectedOffsetForPos(doc, projection, state.selection.head)
        if (cursor === null) return false

        const expansion = buildWriteTemplateShortcutExpansion({ text: projection.text, cursor })
        if (!expansion) return false

        const from = posForProjectedOffset(doc, projection, expansion.from)
        const to = posForProjectedOffset(doc, projection, expansion.to)
        if (from === null || to === null || to < from) return false

        const tr = state.tr.insertText(expansion.insert, from, to)
        editor.view.dispatch(tr.scrollIntoView())
        return true
      }
    }
  }
})
