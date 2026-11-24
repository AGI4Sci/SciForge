// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

import { MarkdownWorkspaceViewer } from './MarkdownWorkspaceViewer'

/**
 * The right-sidebar pane is resizable down to 300px. A layout that follows the
 * window instead of the pane keeps the document at its desktop page width and
 * clips it, so these assertions pin the panel-relative contract:
 *
 * - the document page is fluid (`width: 100%` + `max-width`), never a fixed
 *   pixel page, and it never uses a `vw` gutter or a `transform`/`zoom` fit;
 * - the viewer chrome wraps inside the pane instead of running past its edge;
 * - at the compact container step the labelled copy actions become icon-only,
 *   which keeps their tooltip/accessible name and the status strip text.
 *
 * Layout measurement is not available in this environment, so the geometry is
 * asserted on the rendered class contract and on the stylesheet that backs it.
 */
const NARROW_PANEL_WIDTH_PX = 320
const STYLESHEET_PATH = 'src/renderer/src/styles/write-editor.css'

async function readRepositoryFile(relativePath: string): Promise<string> {
  const nodeFs = 'node:fs/promises'
  const { readFile } = await import(/* @vite-ignore */ nodeFs)
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ''
  return readFile(`${cwd}/${relativePath}`, 'utf8')
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return open < 0 || close < 0 ? '' : css.slice(open + 1, close)
}

function atRuleBlock(css: string, header: string): string {
  const start = css.indexOf(header)
  if (start < 0) return ''
  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    const character = css[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, index + 1)
    }
  }
  return ''
}

function createMarkdownObservation(): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/notes.md',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/markdown',
      size: 20
    },
    view: {
      pluginId: 'markdown',
      modality: 'document',
      mode: 'preview',
      title: 'notes.md'
    },
    visibleText: '# Alpha\n\n- beta\n',
    text: {
      lineCount: 3,
      characterCount: 16,
      truncated: false
    },
    actions: ['observe', 'workspace.setSelection']
  }
}

describe('MarkdownWorkspaceViewer narrow panel layout', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    container = document.createElement('div')
    container.style.width = `${NARROW_PANEL_WIDTH_PX}px`
    container.style.maxWidth = `${NARROW_PANEL_WIDTH_PX}px`
    container.style.overflow = 'hidden'
    document.body.append(container)
  })

  afterEach(() => {
    root?.unmount()
    root = null
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  function mountViewer(): void {
    root = createRoot(container as HTMLDivElement)
    act(() => {
      root?.render(createElement(MarkdownWorkspaceViewer, {
        observation: createMarkdownObservation(),
        initialMode: 'preview',
        onCopyForWechat: async () => ({
          copiedAt: '2026-07-30T10:00:00.000Z',
          outputBytes: 128,
          counts: {
            formulas: 0,
            inlineFormulas: 0,
            displayFormulas: 0,
            codeBlocks: 0,
            embeddedImages: 0,
            remoteImages: 0
          },
          warnings: [],
          effect: 'clipboard-write' as const
        }),
        onCopyForZhihu: async () => ({
          copiedAt: '2026-07-30T10:00:00.000Z',
          outputBytes: 128,
          counts: {
            formulas: 0,
            inlineFormulas: 0,
            displayFormulas: 0,
            codeBlocks: 0,
            embeddedImages: 0,
            remoteImages: 0
          },
          warnings: [],
          effect: 'clipboard-write' as const
        })
      }))
    })
  }

  function query<T extends Element>(selector: string): T {
    const node = container?.querySelector<T>(selector)
    expect(node).not.toBeNull()
    return node as T
  }

  it('renders the document page as a fluid, panel-sized container', () => {
    mountViewer()

    const scroller = query<HTMLElement>('[data-markdown-preview-pane]')
    const documentRoot = query<HTMLElement>('[data-markdown-annotation-text-root]')
    const page = query<HTMLElement>('.write-markdown-preview')

    // The document body is a size query container of its own, so the typography
    // ladder can follow the pane width.
    expect(documentRoot.className).toContain('workspace-preview-markdown-document')
    expect(documentRoot.contains(page)).toBe(true)

    // No fixed page width and no inline sizing: the page is fluid.
    expect(page.getAttribute('style')).toBeNull()
    expect(page.className).not.toMatch(/\bw-\[/)
    expect(page.className).not.toMatch(/\bmin-w-\[/)
    expect(page.className).not.toContain('flex-none')
    expect(page.className).not.toContain('shrink-0')

    // The scroller must not reserve a pixel gutter for the floating panel
    // buttons on the rows that sit below them.
    expect(scroller.className).not.toContain('pr-20')
    expect(query<HTMLElement>('[data-markdown-search-toolbar]').className).not.toContain('pr-20')
  })

  it('keeps the toolbar, search row, and status strip inside the panel', () => {
    mountViewer()

    const chrome = query<HTMLElement>('[data-markdown-viewer-chrome]')
    const header = query<HTMLElement>('[data-markdown-viewer-header]')
    const actions = query<HTMLElement>('.workspace-preview-markdown-chrome__actions')

    // Both the header and its action row may wrap; nothing is pinned with
    // `flex-nowrap` or a fixed width.
    expect(header.className).toContain('flex-wrap')
    expect(header.className).not.toContain('flex-nowrap')
    expect(actions.className).toContain('flex-wrap')
    expect(actions.className).toContain('min-w-0')
    expect(chrome.contains(header)).toBe(true)

    // The icon-only fallback of the compact step keeps an accessible name and
    // keeps the label in the DOM for wide panels.
    const wechat = query<HTMLElement>('[data-markdown-copy-for-wechat]')
    expect(wechat.getAttribute('aria-label')).toBeTruthy()
    expect(wechat.getAttribute('title')).toBeTruthy()
    expect(wechat.querySelector('[data-markdown-copy-label]')).not.toBeNull()

    // The search row and the status strip are rows of the same viewer, so they
    // are laid out inside the panel rather than over it.
    const searchRow = query<HTMLElement>('[data-markdown-search-toolbar]')
    expect(searchRow.closest('[data-workspace-preview-markdown-viewer]')).not.toBeNull()
    expect(chrome.contains(searchRow)).toBe(false)
    expect(chrome.parentElement?.getAttribute('data-workspace-preview-markdown-viewer')).not.toBeNull()
  })

  it('sizes the page and the chrome from the panel in the stylesheet', async () => {
    const css = await readRepositoryFile(STYLESHEET_PATH)
    const page = ruleBody(css, '.write-markdown-preview {')

    expect(page).toContain('width: 100%')
    expect(page).toContain('max-width: 860px')
    expect(page).toContain('min-width: 0')
    // The old fixed page and window-relative gutters must be gone.
    expect(page).not.toMatch(/min\(\s*100%\s*,\s*860px\s*\)/)
    expect(page).not.toMatch(/\d+(?:\.\d+)?vw/)
    // Fitting never scales the document: it reflows.
    expect(page).not.toContain('transform')
    expect(page).not.toContain('zoom')

    const chromeQuery = atRuleBlock(css, '@container markdown-viewer-chrome (max-width: 640px)')
    expect(chromeQuery).not.toBe('')
    expect(chromeQuery).toContain('[data-markdown-copy-label]')
    expect(chromeQuery).toContain('display: none')
    expect(chromeQuery).toContain('.workspace-preview-markdown-chrome__actions')

    const documentQuery = atRuleBlock(css, '@container markdown-viewer-document (max-width: 640px)')
    expect(documentQuery).not.toBe('')
    expect(documentQuery).toMatch(/font-size: var\(--ds-text-(?:md|lg)\)/)
    expect(documentQuery).not.toMatch(/font-size:\s*\d+px/)
    expect(documentQuery).not.toContain('transform')

    const tightDocumentQuery = atRuleBlock(css, '@container markdown-viewer-document (max-width: 420px)')
    expect(tightDocumentQuery).not.toBe('')
    expect(tightDocumentQuery).toMatch(/font-size: var\(--ds-text-(?:md|lg)\)/)
    expect(tightDocumentQuery).not.toMatch(/font-size:\s*\d+px/)

    // The size query containers are declared for the two viewer regions.
    expect(ruleBody(css, '.workspace-preview-markdown-chrome {')).toContain(
      'container-type: inline-size'
    )
    expect(ruleBody(css, '.workspace-preview-markdown-document {')).toContain(
      'container-type: inline-size'
    )
  })
})
