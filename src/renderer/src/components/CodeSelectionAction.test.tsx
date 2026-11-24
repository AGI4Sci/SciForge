// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CodeSelectionAction } from './CodeSelectionAction'
import { TextWorkspaceViewer } from '../workspace-preview/TextWorkspaceViewer'
import { DiffView } from './DiffView'
import { codeSelectionSnapshotSchema } from '@sciforge/domain-sdk/renderer'
import type { DomainWorkbenchOpenResourceInput } from '@sciforge/domain-sdk/host'

const openResource = vi.fn((_input: DomainWorkbenchOpenResourceInput) => true)
vi.mock('../domain-modules/domain-renderer-navigation', () => ({ domainRendererNavigationHost: { workbench: { canOpenResource: () => true, openResource: (input: DomainWorkbenchOpenResourceInput) => openResource(input) } } }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: () => ({ activeThreadId: 'active', threads: [
  { id: 'active', runtimeId: 'r', workspace: '/active' }, { id: 'owner', runtimeId: 'r2', workspace: '/owner' }
] }) } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('source textarea selection reaches installed resource route with exact current draft and owning workspace', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  // Active workspace matches source; snapshot reads actual textarea, not cached observation.
  await act(async () => root.render(createElement(TextWorkspaceViewer, { observation: {
    schemaVersion: 1, file: { path: '/active/code.ts', workspaceRoot: '/active' },
    view: { pluginId: 'text', modality: 'text', mode: 'preview', title: 'code.ts' },
    visibleText: 'first\nsecond', actions: []
  } })))
  const editor = container.querySelector('textarea')!
  editor.setSelectionRange(6, 12)
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  await vi.waitFor(() => expect(openResource).toHaveBeenCalled())
  const selection = codeSelectionSnapshotSchema.parse(openResource.mock.calls.at(-1)![0].resource.context)
  expect(selection.quote).toBe('second')
  expect(selection.codeAnchor).toMatchObject({ filePath: 'code.ts', line: 2 })
  await act(async () => root.unmount()); container.remove(); openResource.mockClear()
})

it('explicit secondary-session producer never borrows active session identity', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  await act(async () => root.render(createElement(CodeSelectionAction, { filePath: 'a.ts', workspaceRoot: '/owner', sessionId: 'owner',
    read: () => ({ text: 'exact', start: 0, end: 5, bounds: new DOMRect(1, 2, 30, 20) }) })))
  await act(async () => container.querySelector('button')!.click())
  await vi.waitFor(() => expect(openResource).toHaveBeenCalled())
  expect(openResource.mock.calls.at(-1)![0]).toMatchObject({ sessionId: 'owner', resource: { context: { scope: { workspaceRoot: '/owner', runtimeId: 'r2', threadId: 'owner' } } } })
  await act(async () => root.unmount()); container.remove(); openResource.mockClear()
})

it('diff producer attaches separate selectable old/new cells and rejects multi-file attribution', async () => {
  const container = document.createElement('div'); const root = createRoot(container)
  const patch = '--- a/a.ts\n+++ b/a.ts\n@@ -3 +7 @@\n-old\n+new'
  await act(async () => root.render(createElement(DiffView, { patch })))
  expect([...container.querySelectorAll('[data-code-row]')].map(node => node.textContent)).toEqual(['old', 'new'])
  expect(container.textContent).toContain('讨论所选代码')
  await act(async () => root.render(createElement(DiffView, { patch: patch + '\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y' })))
  expect(container.textContent).not.toContain('讨论所选代码')
  await act(async () => root.unmount())
})
