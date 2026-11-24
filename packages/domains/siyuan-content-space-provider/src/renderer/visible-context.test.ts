import { expect, it, vi } from 'vitest'
import type { DomainRendererHost, DomainVisibleContextComponent } from '@sciforge/domain-sdk/host'
import { registerSiYuanVisibleContext } from './visible-context.js'

const observation = { resource: {}, resourceRef: 'ref-one', resourceKind: 'siyuan-document', semanticRevision: '1', observedAt: '2026-11-10T00:00:00Z',
  state: { id: '20261109120000-documen', notebook: '20261109120000-noteboo', title: 'Note', path: '/Note', updated: '1' } }
function fixture() {
  let refresh!: (signal: AbortSignal) => Promise<void>
  const components = new Set<DomainVisibleContextComponent>()
  const publish = vi.fn((component: DomainVisibleContextComponent) => { components.add(component); return () => { components.delete(component) } })
  const unregisterRefresh = vi.fn()
  const invoke = vi.fn(async (): Promise<{ document: { resource: object } | null }> => ({ document: { resource: {} } }))
  const observe = vi.fn(async () => observation)
  const host = { capabilityInvoker: { invoke, observe }, visibleContext: {
    registerComponent: publish,
    registerRefresh: (callback: typeof refresh) => { refresh = callback; return unregisterRefresh }
  } } as unknown as DomainRendererHost
  return { host, components, publish, invoke, observe, unregisterRefresh, refresh: (signal: AbortSignal) => refresh(signal) }
}
const input = { sessionId: 'chat-one', nativeSessionId: '["user:a","runtime","chat-one"]', spaceId: 'prj_one', workspaceId: '/workspace/one' }

it('publishes only an observed resource using the exact native session and chat workspace', async () => {
  const f = fixture(), dispose = registerSiYuanVisibleContext(f.host, input)
  await vi.waitFor(() => expect(f.components.size).toBe(1))
  expect(f.invoke).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'siyuan.editor.document' }), { sessionId: input.nativeSessionId, spaceId: input.spaceId }, expect.objectContaining({ workspaceId: input.workspaceId, signal: expect.any(AbortSignal) }))
  expect(f.observe).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'siyuan-document' }), {}, expect.objectContaining({ workspaceId: input.workspaceId }))
  expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ resources: [expect.objectContaining({ capability: { resourceRef: 'ref-one' } })] }), { sessionId: input.sessionId })
  dispose()
  expect(f.components.size).toBe(0)
  expect(f.unregisterRefresh).toHaveBeenCalledOnce()
})

it('clears the old resource immediately and cannot republish a late timed-out observation', async () => {
  const f = fixture(), dispose = registerSiYuanVisibleContext(f.host, input)
  await vi.waitFor(() => expect(f.components.size).toBe(1))
  let finish!: (value: typeof observation) => void
  f.observe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController(), pending = f.refresh(controller.signal)
  expect(f.components.size).toBe(0)
  await vi.waitFor(() => expect(f.observe).toHaveBeenCalledTimes(2))
  controller.abort()
  finish(observation)
  await pending
  expect(f.components.size).toBe(0)
  dispose()
})

it('does not publish across a disposed chat and represents ambiguous current documents without a resource', async () => {
  const f = fixture()
  let finish!: (value: { document: { resource: object } }) => void
  f.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const dispose = registerSiYuanVisibleContext(f.host, input)
  dispose()
  finish({ document: { resource: {} } })
  await Promise.resolve()
  expect(f.observe).not.toHaveBeenCalled()
  expect(f.components.size).toBe(0)
  f.invoke.mockResolvedValueOnce({ document: null })
  const nextDispose = registerSiYuanVisibleContext(f.host, { ...input, sessionId: 'chat-two' })
  await vi.waitFor(() => expect(f.components.size).toBe(1))
  expect([...f.components][0]).toMatchObject({ resources: [], state: { status: 'no-current-document' } })
  nextDispose()
})
