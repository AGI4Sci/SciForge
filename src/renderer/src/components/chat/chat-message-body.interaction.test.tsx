// @vitest-environment happy-dom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { DomainRendererChatMessageRenderContext } from '@sciforge/domain-sdk/renderer'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'
import { ChatMessageContributionRegistry } from '../../domain-modules/chat-message-slot'
import { ChatMessageBody } from '../../domain-modules/chat-message-body'
import { useChatStore } from '../../store/chat-store'
import { MessageBubble } from './message-timeline-bubbles'
import { MessageTimeline } from './MessageTimeline'
import i18n from '../../i18n'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanup: Array<() => void> = []
afterEach(async () => {
  await act(async () => { for (const dispose of cleanup.splice(0).reverse()) dispose() })
})
async function mount(view: ReactElement): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanup.push(() => { root.unmount(); container.remove() })
  await act(async () => { root.render(view) })
  return { container, root }
}

it('replaces only the message body while copy/edit keep the original input and attachment controls', async () => {
  await i18n.changeLanguage('en')
  useChatStore.setState({ busy: false })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.body', ownerId: 'fixture', order: -10_000,
    contribution: { render: () => <p data-testid="contributed-body">Readable card</p> }
  }).dispose)
  const original = 'Original raw instruction\n{"protocol":true}'
  const { container } = await mount(<MessageBubble block={{
    kind: 'user', id: 'user-original', text: original,
    meta: { source: 'fixture.injected-input', attachmentIds: ['attachment-1'], attachments: [{ id: 'attachment-1', name: 'figure.png', path: '/workspace/figure.png', mimeType: 'image/png', previewUrl: 'data:image/png;base64,aGVsbG8=' }] }
  }} />)
  expect(container.querySelector('[data-testid="contributed-body"]')).not.toBeNull()
  expect(container.textContent).not.toContain('Original raw instruction')
  expect(container.textContent).not.toContain('fixture.injected-input')
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('figure.png')
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')!.click() })
  expect(writeText).toHaveBeenCalledWith(original)
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Edit question"]')!.click() })
  expect(container.querySelector('textarea')?.value).toBe(original)
})

it('keeps the default source tag when no body contribution handles the message', async () => {
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.declined', ownerId: 'fixture', order: -10_000,
    contribution: { render: () => null }
  }).dispose)
  const { container } = await mount(<MessageBubble block={{
    kind: 'user', id: 'default-source', text: 'Unchanged request',
    meta: { source: 'fixture.unhandled-input' }
  }} />)
  expect(container.textContent).toContain('Unchanged request')
  expect(container.querySelector('[title="fixture.unhandled-input"]')).not.toBeNull()
})

it.each(['resolve', 'render'] as const)('restores the default source tag when a body contribution fails during %s', async (phase) => {
  function Broken(): ReactElement { throw new Error('component failure') }
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.failed-source', ownerId: 'fixture', order: -10_000,
    contribution: { render: () => {
      if (phase === 'resolve') throw new Error('contribution failure')
      return <Broken />
    } }
  }).dispose)
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  cleanup.push(() => error.mockRestore())
  const { container } = await mount(<MessageBubble block={{
    kind: 'user', id: `failed-source-${phase}`, text: 'Recoverable request',
    meta: { source: 'fixture.failed-input' }
  }} />)
  expect(container.textContent).toContain('Recoverable request')
  expect(container.querySelector('[title="fixture.failed-input"]')).not.toBeNull()
})

it('passes each assistant only its own exact turn input and keeps tools in the process section', async () => {
  const seen: DomainRendererChatMessageRenderContext[] = []
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.context', ownerId: 'fixture', order: -10_000,
    contribution: { render: (context) => { seen.push(context); return <p>{context.message.id}</p> } }
  }).dispose)
  useChatStore.setState({ activeAgentRuntime: 'codex', activeThreadId: 'thread-exact', busy: false, threads: [{
    id: 'thread-exact', runtimeId: 'codex', title: 'Fixture', updatedAt: '2026-10-21T00:00:00Z', latestTurnId: 'turn-2', latestTurnStatus: 'completed', model: 'fixture', mode: 'code'
  }] })
  await mount(<MessageTimeline
    blocks={[
      { kind: 'user', id: 'input-1', turnId: 'turn-1', text: 'first', meta: { source: 'fixture.first' } },
      { kind: 'assistant', id: 'output-1', text: 'first result' },
      { kind: 'user', id: 'input-2', turnId: 'turn-2', text: 'second', meta: { source: 'fixture.second' } },
      { kind: 'tool', id: 'tool-2', status: 'success', summary: 'read data', detail: 'process detail' },
      { kind: 'assistant', id: 'output-2', text: 'second result' }
    ]}
    live="" liveReasoning="" activeThreadId="thread-exact" runtimeConnection="ready"
    onRetryConnection={() => undefined} onOpenSettings={() => undefined}
  />)
  const first = seen.find(({ message }) => message.id === 'output-1')!
  const second = seen.find(({ message }) => message.id === 'output-2')!
  expect(first.relatedInput?.id).toBe('input-1')
  expect(first.relatedInput?.metadata?.source).toBe('fixture.first')
  expect(first.turnId).toBe('turn-1')
  expect(second.relatedInput?.id).toBe('input-2')
  expect(second.relatedInput?.metadata?.source).toBe('fixture.second')
  expect(second.turnId).toBe('turn-2')
  expect(second.runtimeId).toBe('codex')
  expect(second.threadId).toBe('thread-exact')
  expect(seen.some(({ message }) => message.id === 'tool-2')).toBe(false)
})

it('omits Runtime identity when only the selected Runtime is known', async () => {
  const seen: DomainRendererChatMessageRenderContext[] = []
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.identity', ownerId: 'fixture', order: -10_000,
    contribution: { render: (context) => { seen.push(context); return null } }
  }).dispose)
  useChatStore.setState({ activeAgentRuntime: 'codex', activeThreadId: 'legacy-thread', busy: false, threads: [{
    id: 'legacy-thread', title: 'Legacy', updatedAt: '2026-10-21T00:00:00Z', model: 'fixture', mode: 'code'
  }] })
  await mount(<MessageTimeline
    blocks={[
      { kind: 'user', id: 'legacy-input', turnId: 'legacy-turn', text: 'request' },
      { kind: 'assistant', id: 'legacy-output', text: 'answer' }
    ]}
    live="" liveReasoning="" activeThreadId="legacy-thread" runtimeConnection="ready"
    onRetryConnection={() => undefined} onOpenSettings={() => undefined}
  />)
  expect(seen.find(({ message }) => message.id === 'legacy-output')?.runtimeId).toBeUndefined()
  expect(seen.find(({ message }) => message.id === 'legacy-output')?.turnId).toBe('legacy-turn')
})

it('retains the default body when a contributed React component fails to render', async () => {
  const registry = new ChatMessageContributionRegistry()
  function Broken(): ReactElement { throw new Error('component failure') }
  registry.register({ id: 'fixture.broken', ownerId: 'fixture', contribution: { render: () => <Broken /> } })
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  cleanup.push(() => error.mockRestore())
  const { container } = await mount(<ChatMessageBody registry={registry} context={{
    contractVersion: '1.0.0', message: { id: 'output-1', role: 'assistant', rawText: 'Original answer' }, streaming: false
  }}><p>Original answer</p></ChatMessageBody>)
  expect(container.textContent).toBe('Original answer')
})

it('does not claim the selected runtime is a transcript binding when the thread has no runtime identity', async () => {
  const seen: DomainRendererChatMessageRenderContext[] = []
  cleanup.push(installedRendererContributions.chatMessages.register({
    id: 'fixture.unbound-context', ownerId: 'fixture', order: -10_000,
    contribution: { render: (context) => { seen.push(context); return null } }
  }).dispose)
  useChatStore.setState({ activeAgentRuntime: 'codex', activeThreadId: 'thread-unbound', busy: false, threads: [{
    id: 'thread-unbound', title: 'Unknown runtime', updatedAt: '2026-10-21T00:00:00Z', model: 'fixture', mode: 'code'
  }] })
  await mount(<MessageTimeline blocks={[
    { kind: 'user', id: 'input-unbound', turnId: 'turn-unbound', text: 'input' },
    { kind: 'assistant', id: 'output-unbound', text: 'result' }
  ]} live="" liveReasoning="" activeThreadId="thread-unbound" runtimeConnection="ready"
  onRetryConnection={() => undefined} onOpenSettings={() => undefined} />)
  const output = seen.find(({ message }) => message.id === 'output-unbound')!
  expect(output).toBeDefined()
  expect(output.threadId).toBe('thread-unbound')
  expect(output.turnId).toBe('turn-unbound')
  expect(output.runtimeId).toBeUndefined()
})
