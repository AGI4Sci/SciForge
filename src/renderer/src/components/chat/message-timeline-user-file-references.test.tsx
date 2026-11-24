// @vitest-environment happy-dom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import type { RuntimeDisclosureMetadata } from '../../agent/types'
import { WORKSPACE_FILE_PREVIEW_EVENT } from '../../lib/workspace-file-preview'
import type { WorkspaceFilePreviewDetail } from '../../lib/workspace-file-preview'
import i18n from '../../i18n'
import { MessageBubble, userMessageFileReferences } from './message-timeline-bubbles'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanup: Array<() => void> = []

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useChatStore.setState({ busy: false })
})

afterEach(async () => {
  await act(async () => {
    for (const dispose of cleanup.splice(0).reverse()) dispose()
  })
  vi.restoreAllMocks()
})

async function mount(view: ReactElement): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanup.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () => {
    root.render(view)
  })
  return { container, root }
}

const TABLE_REFERENCE = {
  path: '.sciforge/uploads/thr-demo/20261021T010203-deadbeef-table.csv',
  relativePath: '.sciforge/uploads/thr-demo/20261021T010203-deadbeef-table.csv',
  name: 'table.csv',
  kind: 'text',
  size: 2048
}

const PAPER_REFERENCE = {
  path: 'papers/article.pdf',
  relativePath: 'papers/article.pdf',
  name: 'article.pdf',
  kind: 'pdf',
  size: 1024
}

it('renders the files a user message sent as compact name and size chips', async () => {
  const { container } = await mount(
    <MessageBubble
      block={{
        kind: 'user',
        id: 'user-files',
        text: 'Summarize these files',
        meta: { source: 'desktop', fileReferences: [TABLE_REFERENCE, PAPER_REFERENCE] }
      }}
    />
  )

  const chips = container.querySelectorAll('[data-user-file-reference]')
  expect(chips).toHaveLength(2)
  expect(chips[0]?.textContent).toContain('table.csv')
  expect(chips[0]?.textContent).toContain('2.0 KB')
  expect(chips[1]?.textContent).toContain('article.pdf')
  expect(chips[1]?.textContent).toContain('1.0 KB')
  // The imported attachment prefix is stripped for display.
  expect(container.textContent).not.toContain('.sciforge/uploads/')
  expect(container.querySelector('[data-user-file-references]')?.getAttribute('aria-label'))
    .toBe('Sent files (2)')
})

it('renders an unchanged bubble when the message carried no file references', async () => {
  const { container } = await mount(
    <MessageBubble
      block={{ kind: 'user', id: 'user-plain', text: 'Plain question', meta: { source: 'desktop' } }}
    />
  )

  expect(container.textContent).toContain('Plain question')
  expect(container.querySelector('[data-user-file-references]')).toBeNull()
  expect(container.querySelectorAll('[data-user-file-reference]')).toHaveLength(0)
})

it('previews the workspace file when a sent file chip is clicked', async () => {
  const previews: WorkspaceFilePreviewDetail[] = []
  const onPreview = (event: Event): void => {
    previews.push((event as CustomEvent<WorkspaceFilePreviewDetail>).detail)
  }
  window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  cleanup.push(() => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview))

  const { container } = await mount(
    <MessageBubble
      threadId="thr-demo"
      block={{
        kind: 'user',
        id: 'user-preview',
        text: 'Read the paper',
        meta: { source: 'desktop', fileReferences: [PAPER_REFERENCE] }
      }}
    />
  )

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-user-file-reference]')?.click()
  })

  expect(previews).toEqual([
    expect.objectContaining({
      path: 'papers/article.pdf',
      kind: 'file',
      sessionId: 'thr-demo'
    })
  ])
})

it('shows sent images and sent file references on the same user message', async () => {
  const { container } = await mount(
    <MessageBubble
      block={{
        kind: 'user',
        id: 'user-mixed',
        text: 'Use the figure and the table',
        meta: {
          source: 'desktop',
          attachments: [{
            id: 'attachment-1',
            name: 'figure.png',
            path: '/workspace/figure.png',
            mimeType: 'image/png',
            previewUrl: 'data:image/png;base64,aGVsbG8='
          }],
          fileReferences: [TABLE_REFERENCE]
        }
      }}
    />
  )

  expect(container.querySelectorAll('img')).toHaveLength(1)
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('figure.png')
  const chips = container.querySelectorAll('[data-user-file-reference]')
  expect(chips).toHaveLength(1)
  expect(chips[0]?.textContent).toContain('table.csv')
})

it('reads persisted file references tolerantly and ignores malformed entries', () => {
  expect(userMessageFileReferences(undefined)).toEqual([])
  expect(userMessageFileReferences({ source: 'desktop' })).toEqual([])
  const untrusted = {
    fileReferences: [
      { relativePath: 'data/samples.csv', name: 'samples.csv', kind: 'text', size: 12 },
      { name: 'missing-path.csv' },
      { path: 'paper.pdf', relativePath: 'paper.pdf', size: -1, kind: 42 }
    ]
  } as unknown as RuntimeDisclosureMetadata
  expect(userMessageFileReferences(untrusted)).toEqual([
    { path: 'data/samples.csv', relativePath: 'data/samples.csv', name: 'samples.csv', kind: 'text', size: 12 },
    { path: 'paper.pdf', relativePath: 'paper.pdf' }
  ])
})
