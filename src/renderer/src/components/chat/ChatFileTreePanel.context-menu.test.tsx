// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enCommon from '../../locales/en/common.json'
import zhCommon from '../../locales/zh/common.json'

const listWorkspaceReferences = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => ({ listWorkspaceReferences })
}))

import { ChatFileTreePanel } from './ChatFileTreePanel'

const workspaceReference = {
  workspaceRoot: '/workspace/project',
  relativePath: 'papers/example.pdf',
  name: 'example.pdf',
  kind: 'pdf' as const,
  mimeType: 'application/pdf'
}

describe('ChatFileTreePanel file context menu', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    listWorkspaceReferences.mockReset()
    listWorkspaceReferences.mockResolvedValue({
      ok: true,
      references: [workspaceReference]
    })
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it('routes explicit new-pane and ordinary file previews through separate callbacks', async () => {
    const onPreviewFile = vi.fn()
    const onPreviewFileInNewPane = vi.fn()
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(ChatFileTreePanel, {
        workspaceRoot: '/workspace/project',
        onPreviewFile,
        onPreviewFileInNewPane,
        onAddReference: vi.fn(),
        onCollapse: vi.fn()
      }))
    })

    const row = container?.querySelector<HTMLElement>('[data-file-tree-path="papers/example.pdf"]')
    expect(row).not.toBeNull()

    await act(async () => {
      row?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20
      }))
    })

    const newPaneAction = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []
    ).find((button) => button.textContent?.includes('fileTreePreviewInNewRightSidebar'))
    expect(newPaneAction?.tagName).toBe('BUTTON')

    await act(async () => newPaneAction?.click())
    expect(onPreviewFileInNewPane).toHaveBeenCalledWith(workspaceReference)
    expect(onPreviewFile).not.toHaveBeenCalled()

    const ordinaryPreviewButton = row?.querySelector<HTMLButtonElement>('button')
    await act(async () => ordinaryPreviewButton?.click())
    expect(onPreviewFile).toHaveBeenCalledWith(workspaceReference)
    expect(onPreviewFileInNewPane).toHaveBeenCalledTimes(1)
  })

  it('omits the new-pane action when the optional host callback is unavailable', async () => {
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(ChatFileTreePanel, {
        workspaceRoot: '/workspace/project',
        onPreviewFile: vi.fn(),
        onAddReference: vi.fn(),
        onCollapse: vi.fn()
      }))
    })

    const row = container?.querySelector<HTMLElement>('[data-file-tree-path="papers/example.pdf"]')
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20
      }))
    })

    expect(container?.textContent).not.toContain('fileTreePreviewInNewRightSidebar')
  })

  it('provides matching English and Chinese action labels', () => {
    expect(enCommon.fileTreePreviewInNewRightSidebar).toBe('Open in new right sidebar')
    expect(zhCommon.fileTreePreviewInNewRightSidebar).toBe('在新右侧栏中打开')
  })
})
