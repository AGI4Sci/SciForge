import { Image } from '@tiptap/extension-image'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath
} from '@shared/write-markdown-resource'
import { withPinnedWorkspaceLocator } from '../../remote-workspace/placement'
import { useWriteWorkspaceStore } from '../write-workspace-store'

export type WriteLocalImageOptions = {
  className?: string
  getFilePath?: () => string
  getWorkspaceRoot?: () => string
}

/**
 * Image node for rich markdown editing. It keeps the raw markdown `src`
 * attribute intact for serialization while rendering a plain img element in
 * the editor.
 */
export const WriteLocalImage = Image.extend<WriteLocalImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      allowBase64: true,
      className: 'write-rich-image',
      getFilePath: () => '',
      getWorkspaceRoot: () => ''
    }
  },

  addNodeView() {
    if (typeof document === 'undefined') return null

    return ({ node }) => {
      const dom = document.createElement('img')
      dom.className = this.options.className || 'write-rich-image'
      dom.draggable = true

      const applyAttrs = (attrs: typeof node.attrs): void => {
        const src = typeof attrs.src === 'string' ? attrs.src : ''
        const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
        const title = typeof attrs.title === 'string' ? attrs.title : ''
        const filePath = this.options.getFilePath?.() || null
        const localPath = resolveWriteMarkdownResourcePath(src, filePath)
        const resolved = resolveWriteMarkdownResource(src, filePath)
        dom.classList.remove('write-rich-image-error')
        if (!localPath && resolved) dom.src = resolved
        else dom.removeAttribute('src')
        dom.alt = alt
        if (title) dom.title = title
        else dom.removeAttribute('title')
        dom.dataset.rawSrc = src
        if (!localPath) return
        const workspaceRoot = this.options.getWorkspaceRoot?.().trim()
        if (!workspaceRoot || typeof window.sciforge?.readWorkspaceImage !== 'function') {
          dom.classList.add('write-rich-image-error')
          dom.title = 'Image could not be loaded'
          return
        }
        let input
        try {
          input = withPinnedWorkspaceLocator(
            { path: localPath, workspaceRoot },
            useWriteWorkspaceStore.getState().pinnedWorkspaceLocator
          )
        } catch (error) {
          dom.classList.add('write-rich-image-error')
          dom.title = error instanceof Error ? error.message : String(error)
          return
        }
        void window.sciforge.readWorkspaceImage(input)
          .then((result) => {
            if (dom.dataset.rawSrc !== src) return
            if (result.ok) {
              dom.src = result.dataUrl
              dom.classList.remove('write-rich-image-error')
              dom.removeAttribute('title')
              return
            }
            dom.classList.add('write-rich-image-error')
            dom.title = result.message
          })
          .catch((error) => {
            if (dom.dataset.rawSrc !== src) return
            dom.classList.add('write-rich-image-error')
            dom.title = error instanceof Error ? error.message : String(error)
          })
      }

      applyAttrs(node.attrs)

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          applyAttrs(updated.attrs)
          return true
        }
      }
    }
  }
})
