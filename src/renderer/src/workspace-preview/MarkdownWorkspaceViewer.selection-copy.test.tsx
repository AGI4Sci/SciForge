// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import type { MarkdownWechatCopyResult } from '@shared/markdown-wechat'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

import {
  MarkdownWorkspaceViewer,
  expandRangeToCopyBoundaries,
  markdownSelectionCopyPayloadFromRange,
  resolveMarkdownSelectionCopyPayload,
  type MarkdownWorkspaceViewerCopyForFeishuHandler,
  type MarkdownWorkspaceViewerCopyForWechatHandler,
  type MarkdownWorkspaceViewerCopyForZhihuHandler
} from './MarkdownWorkspaceViewer'

function createMarkdownObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
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
    actions: ['observe', 'workspace.setSelection'],
    ...overrides
  }
}

function markdownCopyResult(): MarkdownWechatCopyResult {
  return {
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
    effect: 'clipboard-write'
  }
}

describe('MarkdownWorkspaceViewer selection copy helpers', () => {
  it('serializes a range into an HTML payload', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>hello <strong>bold</strong> world</p>'
    document.body.append(host)
    const range = document.createRange()
    range.selectNodeContents(host.firstElementChild as Element)

    const payload = markdownSelectionCopyPayloadFromRange(range)

    expect(payload).toEqual({ html: 'hello <strong>bold</strong> world' })
    host.remove()
  })

  it('returns null for a collapsed range', () => {
    const host = document.createElement('div')
    host.textContent = 'text'
    document.body.append(host)
    const range = document.createRange()
    range.setStart(host.firstChild as Node, 0)
    range.collapse(true)

    expect(markdownSelectionCopyPayloadFromRange(range)).toBeNull()
    host.remove()
  })

  it('expands a selection that starts inside a code block to the whole block', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<p>before</p>',
      '<div class="ds-code-block" data-language="python">',
      '<div class="ds-code-block-header"><span>python</span><button type="button">Copy</button></div>',
      '<div class="ds-code-block-body"><pre class="shiki"><code><span class="line">print(1)</span></code></pre></div>',
      '</div>',
      '<p>after</p>'
    ].join('')
    document.body.append(root)
    const codeText = root.querySelector('.line')?.firstChild as Node
    const after = root.querySelectorAll('p')[1].firstChild as Node
    const range = document.createRange()
    range.setStart(codeText, 2)
    range.setEnd(after, 3)

    const expanded = expandRangeToCopyBoundaries(range, root)

    expect(expanded.startContainer).toBe(root)
    expect(expanded.startOffset).toBe(1)
    const container = document.createElement('div')
    container.append(expanded.cloneContents())
    expect(container.innerHTML).toContain('ds-code-block')
    expect(container.innerHTML).toContain('print(1)')
    expect(container.innerHTML).not.toContain('before')
    expect(container.innerHTML).toContain('aft')
    root.remove()
  })

  it('expands both boundaries of a range ending inside a table', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>intro</p><table><tbody><tr><td>cell one</td><td>cell two</td></tr></tbody></table><p>tail</p>'
    document.body.append(root)
    const start = root.querySelector('p')?.firstChild as Node
    const cellText = root.querySelectorAll('td')[1].firstChild as Node
    const range = document.createRange()
    range.setStart(start, 1)
    range.setEnd(cellText, 2)

    const expanded = expandRangeToCopyBoundaries(range, root)

    const container = document.createElement('div')
    container.append(expanded.cloneContents())
    expect(container.innerHTML).toContain('<table>')
    expect(container.innerHTML).toContain('cell one')
    expect(container.innerHTML).toContain('cell two')
    expect(container.innerHTML).toContain('ntro')
    expect(container.innerHTML).not.toContain('tail')
    root.remove()
  })

  it('resolves null for collapsed selections and selections outside the preview root', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>inside</p>'
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.append(root, outside)
    const range = document.createRange()
    range.selectNodeContents(outside.firstChild as Node)
    const collapsed = document.createRange()
    collapsed.setStart(root.querySelector('p')?.firstChild as Node, 0)
    collapsed.collapse(true)

    expect(resolveMarkdownSelectionCopyPayload(root, {
      isCollapsed: true,
      rangeCount: 1,
      getRangeAt: () => collapsed
    })).toBeNull()
    expect(resolveMarkdownSelectionCopyPayload(root, {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range
    })).toBeNull()
    root.remove()
    outside.remove()
  })
})

describe('MarkdownWorkspaceViewer selection context menu', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    root?.unmount()
    root = null
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  function mountViewer(overrides: {
    onCopyForWechat?: MarkdownWorkspaceViewerCopyForWechatHandler
    onCopyForFeishu?: MarkdownWorkspaceViewerCopyForFeishuHandler
    onCopyForZhihu?: MarkdownWorkspaceViewerCopyForZhihuHandler
  } = {}): void {
    const element = createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      onCopyForWechat: overrides.onCopyForWechat,
      onCopyForFeishu: overrides.onCopyForFeishu,
      onCopyForZhihu: overrides.onCopyForZhihu
    })
    root = createRoot(container as HTMLDivElement)
    act(() => {
      root?.render(element)
    })
  }

  function previewRoot(): HTMLElement {
    const node = container?.querySelector('[data-markdown-annotation-text-root]')
    expect(node).not.toBeNull()
    return node as HTMLElement
  }

  it('copies only the selected fragment when a menu item is chosen', async () => {
    const onCopyForWechat = vi.fn(async () => markdownCopyResult())
    mountViewer({ onCopyForWechat })

    const rootNode = previewRoot()
    const heading = rootNode.querySelector('h1')?.firstChild as Node
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    const pane = container?.querySelector('[data-markdown-preview-pane]') as HTMLElement
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 240,
      clientY: 180
    })

    act(() => {
      pane.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(selection.addRange).toHaveBeenCalled()
    const menu = container?.querySelector('[data-markdown-selection-copy-menu]')
    expect(menu).not.toBeNull()

    const wechatItem = menu?.querySelector('[data-markdown-selection-copy-wechat]') as HTMLButtonElement
    expect(wechatItem).not.toBeNull()
    expect(menu?.querySelector('[data-markdown-selection-copy-feishu]')).toBeNull()
    await act(async () => {
      wechatItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onCopyForWechat).toHaveBeenCalledWith({ html: expect.stringContaining('Alpha') })
    expect(container?.querySelector('[data-markdown-selection-copy-menu]')).toBeNull()
  })

  it('offers Zhihu copy in the menu and copies the selection with it', async () => {
    const onCopyForWechat = vi.fn(async () => markdownCopyResult())
    const onCopyForFeishu = vi.fn(async () => markdownCopyResult())
    const onCopyForZhihu = vi.fn(async () => markdownCopyResult())
    mountViewer({ onCopyForWechat, onCopyForFeishu, onCopyForZhihu })

    const rootNode = previewRoot()
    const heading = rootNode.querySelector('h1')?.firstChild as Node
    const range = document.createRange()
    range.selectNodeContents(heading)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    } as unknown as Selection)
    const pane = container?.querySelector('[data-markdown-preview-pane]') as HTMLElement

    act(() => {
      pane.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 96
      }))
    })

    const menu = container?.querySelector('[data-markdown-selection-copy-menu]')
    expect(menu).not.toBeNull()
    expect(menu?.querySelector('[data-markdown-selection-copy-wechat]')).not.toBeNull()
    expect(menu?.querySelector('[data-markdown-selection-copy-feishu]')).not.toBeNull()
    const zhihuItem = menu?.querySelector('[data-markdown-selection-copy-zhihu]') as HTMLButtonElement
    expect(zhihuItem).not.toBeNull()

    await act(async () => {
      zhihuItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onCopyForZhihu).toHaveBeenCalledWith({ html: expect.stringContaining('Alpha') })
    expect(onCopyForWechat).not.toHaveBeenCalled()
    expect(onCopyForFeishu).not.toHaveBeenCalled()
    expect(container?.querySelector('[data-markdown-selection-copy-menu]')).toBeNull()
  })

  it('does not open the menu without a selection inside the preview', () => {
    mountViewer({
      onCopyForWechat: async () => markdownCopyResult()
    })
    const pane = container?.querySelector('[data-markdown-preview-pane]') as HTMLElement
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      getRangeAt: () => {
        throw new Error('no range')
      },
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    } as unknown as Selection)

    act(() => {
      pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })

    expect(container?.querySelector('[data-markdown-selection-copy-menu]')).toBeNull()
  })
})
