import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { withPinnedWorkspaceLocator } from '../../remote-workspace/placement'
import { useWriteWorkspaceStore } from '../write-workspace-store'

export type WritePasteImageOptions = {
  getWorkspaceRoot: () => string
  getFilePath: () => string
  getImageDirectory: () => string
  isReadOnly: () => boolean
  onSaved: () => void
  onError: (message: string) => void
}

function clipboardHasImage(event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

export const WritePasteImage = Extension.create<WritePasteImageOptions>({
  name: 'writePasteImage',

  addOptions() {
    return {
      getWorkspaceRoot: () => '',
      getFilePath: () => '',
      getImageDirectory: () => '',
      isReadOnly: () => false,
      onSaved: () => undefined,
      onError: () => undefined
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('writePasteImage'),
        props: {
          handlePaste: (_view, event) => {
            if (options.isReadOnly()) return false
            if (!clipboardHasImage(event)) return false
            const workspaceRoot = options.getWorkspaceRoot().trim()
            const filePath = options.getFilePath().trim()
            if (!workspaceRoot || !filePath) {
              options.onError('Open a workspace file before pasting an image.')
              return true
            }
            if (typeof window.sciforge?.saveWorkspaceClipboardImage !== 'function') return false

            event.preventDefault()
            const imageDirectory = options.getImageDirectory().trim()
            let input
            try {
              input = withPinnedWorkspaceLocator(
                {
                  workspaceRoot,
                  currentFilePath: filePath,
                  ...(imageDirectory ? { imageDirectory } : {})
                },
                useWriteWorkspaceStore.getState().pinnedWorkspaceLocator
              )
            } catch (error) {
              options.onError(error instanceof Error ? error.message : String(error))
              return true
            }
            void window.sciforge
              .saveWorkspaceClipboardImage(input)
              .then((result) => {
                if (!result.ok) {
                  options.onError(result.message)
                  return
                }
                editor
                  .chain()
                  .focus()
                  .setImage({ src: result.markdownPath, alt: 'Pasted image' })
                  .run()
                options.onSaved()
              })
              .catch((error) => {
                options.onError(error instanceof Error ? error.message : String(error))
              })
            return true
          }
        }
      })
    ]
  }
})
