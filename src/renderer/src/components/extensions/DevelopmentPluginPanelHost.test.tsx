// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainExtensionRendererContribution } from '@shared/domain-extensions'
import { DevelopmentPluginPanelHost } from './DevelopmentPluginPanelHost'

const translate = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))

const contribution: DomainExtensionRendererContribution = {
  pluginId: '@example/ui', contributionId: 'panel', kind: 'panel', title: 'Panel',
  generation: 1, version: '0.1.0', stateVersion: 1,
  entryUrl: 'sciforge-plugin://ui/%40example%2Fui/1/dist/ui.html'
}

describe('development plugin panel handshake', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function render(
    descriptor = contribution,
    props: Partial<Omit<ComponentProps<typeof DevelopmentPluginPanelHost>, 'contribution'>> = {}
  ): Promise<HTMLIFrameElement> {
    await act(async () => root.render(createElement(DevelopmentPluginPanelHost, {
      contribution: { ...descriptor, entryUrl: 'about:blank' }, active: true, ...props
    })))
    return container.querySelector('iframe')!
  }

  async function ready(frame: HTMLIFrameElement): Promise<void> {
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'ready' } })))
  }

  it('accepts a late load handshake once, preserves it across polling and keeps the opaque sandbox', async () => {
    const frame = await render()
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => frame.dispatchEvent(new Event('load')))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'host.init' }), '*')
    await ready(frame)
    const initialized = send.mock.calls.length
    await ready(frame)
    expect(send).toHaveBeenCalledTimes(initialized)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(await render({ ...contribution })).toBe(frame)
    expect(send).toHaveBeenCalledTimes(initialized)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('keeps a ready frame visible across equivalent contributions and uses the latest host callbacks', async () => {
    const oldClose = vi.fn()
    const oldSendMessage = vi.fn(async () => ({ ok: true as const }))
    const frame = await render({ ...contribution, capabilityIds: ['visual-review.open'] }, {
      workspaceRoot: '/ws', sessionId: 'session-1', onClose: oldClose,
      services: { sendMessage: oldSendMessage },
      activation: { contributionId: 'panel', revision: 1, payload: { documentId: 'doc-1' } }
    })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await ready(frame)
    send.mockClear()
    const onClose = vi.fn()
    const sendMessage = vi.fn(async () => ({ ok: true as const }))
    expect(await render({ ...contribution, capabilityIds: ['visual-review.open'] }, {
      workspaceRoot: '/ws', sessionId: 'session-1', onClose, services: { sendMessage },
      activation: { contributionId: 'panel', revision: 1, payload: { documentId: 'doc-1' } }
    })).toBe(frame)
    expect(send).not.toHaveBeenCalled()
    expect(frame.classList.contains('opacity-0')).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(20_000))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'collapse' } }))
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'composer.sendMessage', requestId: 'latest', input: { text: 'new callback' } }
      }))
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith({ text: 'new callback', sessionId: 'session-1' })
    expect(oldClose).not.toHaveBeenCalled()
    expect(oldSendMessage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalledWith({ type: 'dispose' }, '*')
  })

  it('refreshes workspace, session and activation bindings without disposing or hiding the frame', async () => {
    const invoke = vi.fn(async () => ({ output: { ok: true } }))
    vi.stubGlobal('sciforge', { capabilities: { invoke } })
    const descriptor = { ...contribution, capabilityIds: ['visual-review.open'] }
    const frame = await render(descriptor, { workspaceRoot: '/old', sessionId: 'old-session' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await ready(frame)
    send.mockClear()
    const activation = { contributionId: 'panel', revision: 2, payload: { documentId: 'doc-2' } }
    expect(await render(descriptor, { workspaceRoot: '/new', sessionId: 'new-session', activation })).toBe(frame)
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'host.init', workspaceRoot: '/new', sessionId: 'new-session', activation
    }), '*')
    expect(frame.classList.contains('opacity-0')).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    await ready(frame)
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'new-binding', actionId: 'visual-review.open', input: {} }
    })))
    expect(invoke).toHaveBeenCalledWith({
      workspaceId: '/new', request: { actionId: 'visual-review.open', input: {}, invocationId: 'new-binding' }
    })
    expect(send).not.toHaveBeenCalledWith({ type: 'dispose' }, '*')
    send.mockClear()
    await render(descriptor, { workspaceRoot: '/new', sessionId: 'new-session', activation: { ...activation, revision: 3 } })
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'host.init', activation: expect.objectContaining({ revision: 3 })
    }), '*')
  })

  it('drops an old workspace result and enforces refreshed grants on the same ready frame', async () => {
    let resolveCapability!: (result: { output: unknown }) => void
    const invoke = vi.fn(() => new Promise<{ output: unknown }>((resolve) => { resolveCapability = resolve }))
    vi.stubGlobal('sciforge', { capabilities: { invoke } })
    const frame = await render({ ...contribution, capabilityIds: ['visual-review.open'] }, { workspaceRoot: '/old' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await ready(frame)
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'pending', actionId: 'visual-review.open', input: {} }
    })))
    expect(invoke).toHaveBeenCalledOnce()
    expect(await render({ ...contribution, capabilityIds: [] }, { workspaceRoot: '/new' })).toBe(frame)
    send.mockClear()
    await act(async () => resolveCapability({ output: { from: '/old' } }))
    expect(send).not.toHaveBeenCalled()
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'revoked', actionId: 'visual-review.open', input: {} }
    })))
    expect(invoke).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'capability.result', requestId: 'revoked', ok: false,
      error: expect.objectContaining({ code: 'CAPABILITY_NOT_ALLOWED' })
    }, '*')
    expect(frame.classList.contains('opacity-0')).toBe(false)
  })

  it('disposes the frame bridge on actual unmount', async () => {
    const frame = await render()
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await ready(frame)
    send.mockClear()
    await act(async () => root.render(null))
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'dispose' }, '*')
  })

  it('disposes a replaced frame and requires its own ready handshake', async () => {
    const frame = await render()
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await ready(frame)
    send.mockClear()
    const replacement = await render({ ...contribution, generation: 2 })
    expect(replacement).not.toBe(frame)
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'dispose' }, '*')
    expect(replacement.classList.contains('opacity-0')).toBe(true)
    await ready(frame)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await ready(replacement)
    expect(replacement.classList.contains('opacity-0')).toBe(false)
  })

  it('reports a timeout, recreates the frame on retry and rejects stale-frame messages', async () => {
    const frame = await render()
    await act(async () => vi.advanceTimersByTime(10_000))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('pluginPanelLoadFailed')
    await act(async () => container.querySelector('button')!.click())
    const retried = container.querySelector('iframe')!
    expect(retried).not.toBe(frame)
    await ready(frame)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await ready(retried)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('drops pending inventory results and stale requests after a generation switch', async () => {
    let resolveInventory!: (value: unknown[]) => void
    const list = vi.fn(() => new Promise<unknown[]>((resolve) => { resolveInventory = resolve }))
    vi.stubGlobal('sciforge', { extensions: { list } })
    const oldFrame = await render()
    const oldSend = vi.spyOn(oldFrame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: oldFrame.contentWindow, data: { type: 'inventory.list', requestId: 'old-request' }
    })))
    expect(list).toHaveBeenCalledTimes(1)
    const current = { ...contribution, generation: 2, version: '0.2.0' }
    const newFrame = await render(current)
    expect(newFrame).not.toBe(oldFrame)
    const newSend = vi.spyOn(newFrame.contentWindow!, 'postMessage')
    await act(async () => resolveInventory([{ packageName: '@example/late' }]))
    expect(oldSend.mock.calls.some((call: unknown[]) => (call[0] as { type?: unknown }).type === 'inventory.result')).toBe(false)
    expect(newSend.mock.calls.some((call: unknown[]) => (call[0] as { type?: unknown }).type === 'inventory.result')).toBe(false)
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: oldFrame.contentWindow, data: { type: 'inventory.list', requestId: 'stale-request' }
    })))
    expect(list).toHaveBeenCalledTimes(1)
    list.mockImplementationOnce(async () => [])
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: newFrame.contentWindow, data: { type: 'inventory.list', requestId: 'new-request' }
    })))
    expect(list).toHaveBeenLastCalledWith({
      pluginId: current.pluginId, contributionId: current.contributionId,
      generation: current.generation, version: current.version
    })
    expect(newSend).toHaveBeenCalledWith({ type: 'inventory.result', requestId: 'new-request', ok: true, inventory: [] }, '*')
  })

  it('serves inventory requests only from the active frame through the existing preload API', async () => {
    const list = vi.fn(async (_input?: unknown) => [{ packageName: '@example/neutral' }])
    vi.stubGlobal('sciforge', { extensions: { list } })
    const frame = await render()
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    const request = { type: 'inventory.list', requestId: 'inventory-1' }
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow, data: request
    })))
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith({
      pluginId: contribution.pluginId, contributionId: contribution.contributionId,
      generation: contribution.generation, version: contribution.version
    }))
    expect(send).toHaveBeenCalledWith({
      type: 'inventory.result', requestId: 'inventory-1', ok: true,
      inventory: [{ packageName: '@example/neutral' }]
    }, '*')
  })

  it('forwards a granted capability id to the renderer bridge and returns the output', async () => {
    const invoke = vi.fn(async () => ({
      actionId: 'visual-review.open', output: { ok: true, documentId: 'doc-1' },
      changed: true, replayed: false, completedAt: '2026-11-01T00:00:00.000Z'
    }))
    vi.stubGlobal('sciforge', { capabilities: { invoke }, extensions: { list: vi.fn() } })
    const frame = await render({ ...contribution, capabilityIds: ['visual-review.open'] }, { workspaceRoot: '/ws' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'call-1', actionId: 'visual-review.open', input: { documentId: 'doc-1' } }
    })))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith({
      workspaceId: '/ws', request: { actionId: 'visual-review.open', input: { documentId: 'doc-1' }, invocationId: 'call-1' }
    }))
    expect(send).toHaveBeenCalledWith({
      type: 'capability.result', requestId: 'call-1', ok: true, output: { ok: true, documentId: 'doc-1' }
    }, '*')
  })

  it('returns a deferred capability result across callback, activation and presentation rerenders', async () => {
    let resolveInvoke!: (value: { output: unknown }) => void
    const invoke = vi.fn(() => new Promise<{ output: unknown }>((resolve) => { resolveInvoke = resolve }))
    vi.stubGlobal('sciforge', { capabilities: { invoke } })
    const descriptor = { ...contribution, capabilityIds: ['test.read'] }
    const frame = await render(descriptor, { workspaceRoot: '/ws', services: {} })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'pending-read', actionId: 'test.read', input: {} }
    })))
    expect(invoke).toHaveBeenCalledOnce()
    expect(await render({ ...descriptor, stateVersion: 2, capabilityIds: ['test.read', 'test.read'] }, {
      workspaceRoot: '/ws', services: { sendMessage: async () => ({ ok: true }) },
      activation: { contributionId: 'panel', revision: 2, payload: { documentId: 'next' } }
    })).toBe(frame)
    await act(async () => resolveInvoke({ output: { ok: true } }))
    expect(send).toHaveBeenCalledWith({
      type: 'capability.result', requestId: 'pending-read', ok: true, output: { ok: true }
    }, '*')
  })

  it.each(['generation', 'workspace', 'session', 'runtime', 'allowlist'] as const)(
    'drops a deferred capability result after a %s authority change', async (change) => {
      let resolveInvoke!: (value: { output: unknown }) => void
      const invoke = vi.fn(() => new Promise<{ output: unknown }>((resolve) => { resolveInvoke = resolve }))
      vi.stubGlobal('sciforge', { capabilities: { invoke } })
      const descriptor = { ...contribution, capabilityIds: ['test.read'] }
      const frame = await render(descriptor, { workspaceRoot: '/ws' })
      const send = vi.spyOn(frame.contentWindow!, 'postMessage')
      await act(async () => window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'capability.invoke', requestId: 'stale-read', actionId: 'test.read', input: {} }
      })))
      const nextFrame = await render({ ...descriptor,
        ...(change === 'generation' ? { generation: 2 } : {}),
        ...(change === 'allowlist' ? { capabilityIds: [] } : {})
      }, {
        workspaceRoot: change === 'workspace' ? '/other' : '/ws',
        ...(change === 'session' ? { sessionId: 'other-session' } : {}),
        ...(change === 'runtime' ? { runtimeId: 'other-runtime' } : {})
      })
      const nextSend = nextFrame === frame ? send : vi.spyOn(nextFrame.contentWindow!, 'postMessage')
      await act(async () => resolveInvoke({ output: { private: true } }))
      for (const spy of [send, nextSend]) {
        expect(spy.mock.calls.some(([message]) => message.type === 'capability.result')).toBe(false)
      }
      if (change === 'allowlist') {
        await act(async () => window.dispatchEvent(new MessageEvent('message', {
          source: nextFrame.contentWindow,
          data: { type: 'capability.invoke', requestId: 'revoked-read', actionId: 'test.read', input: {} }
        })))
        expect(invoke).toHaveBeenCalledOnce()
        expect(nextSend).toHaveBeenCalledWith(expect.objectContaining({
          type: 'capability.result', requestId: 'revoked-read', ok: false,
          error: expect.objectContaining({ code: 'CAPABILITY_NOT_ALLOWED' })
        }), '*')
      }
    }
  )

  it('denies a capability outside the approved contract without calling the bridge', async () => {
    const invoke = vi.fn(async () => ({ actionId: 'x', output: {}, changed: true, replayed: false, completedAt: '2026-11-01T00:00:00.000Z' }))
    vi.stubGlobal('sciforge', { capabilities: { invoke }, extensions: { list: vi.fn() } })
    const frame = await render({ ...contribution, capabilityIds: ['visual-review.open'] }, { workspaceRoot: '/ws' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'call-2', actionId: 'artifact-versions.commit', input: {} }
    })))
    expect(invoke).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      type: 'capability.result', requestId: 'call-2', ok: false,
      error: expect.objectContaining({ code: 'CAPABILITY_NOT_ALLOWED' })
    }, '*')
  })

  it('fails closed when the frame has no workspace and no allowlist', async () => {
    const invoke = vi.fn()
    vi.stubGlobal('sciforge', { capabilities: { invoke }, extensions: { list: vi.fn() } })
    const frame = await render()
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'capability.invoke', requestId: 'call-3', actionId: 'visual-review.open', input: {} }
    })))
    expect(invoke).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      type: 'capability.result', requestId: 'call-3', ok: false,
      error: expect.objectContaining({ code: 'CAPABILITY_NOT_ALLOWED' })
    }, '*')
  })

  it('proxies the workspace file picker through the preload API', async () => {
    const pickFile = vi.fn(async () => ({ canceled: false, path: '/ws/ref.png' }))
    vi.stubGlobal('sciforge', { pickFile, extensions: { list: vi.fn() }, capabilities: { invoke: vi.fn() } })
    const frame = await render({ ...contribution, capabilityIds: [] }, { workspaceRoot: '/ws' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'workspace.pickFile', requestId: 'pick-1', input: { title: 'pick', defaultPath: '/ws' } }
    })))
    await vi.waitFor(() => expect(pickFile).toHaveBeenCalledWith({ title: 'pick', defaultPath: '/ws' }))
    expect(send).toHaveBeenCalledWith({
      type: 'workspace.pickFile.result', requestId: 'pick-1', ok: true, result: { canceled: false, path: '/ws/ref.png' }
    }, '*')
  })

  it('injects a composer message through the host service and reports the result', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('sciforge', { extensions: { list: vi.fn() }, capabilities: { invoke: vi.fn() } })
    const frame = await render({ ...contribution, capabilityIds: [] }, { workspaceRoot: '/ws', services: { sendMessage } })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'composer.sendMessage', requestId: 'msg-1', input: { text: 'hello', displayText: 'hi' } }
    })))
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: 'hello', displayText: 'hi' }))
    expect(send).toHaveBeenCalledWith({ type: 'composer.result', requestId: 'msg-1', ok: true }, '*')
  })

  it('refuses composer injection when the host did not provide the service', async () => {
    vi.stubGlobal('sciforge', { extensions: { list: vi.fn() }, capabilities: { invoke: vi.fn() } })
    const frame = await render({ ...contribution, capabilityIds: [] }, { workspaceRoot: '/ws' })
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'composer.sendMessage', requestId: 'msg-2', input: { text: 'nope' } }
    })))
    expect(send).toHaveBeenCalledWith({
      type: 'composer.result', requestId: 'msg-2', ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('not available') })
    }, '*')
  })

  it('requires a native human confirmation before forwarding an invocation-bound approval', async () => {
    const invoke = vi.fn(async () => ({ output: { accepted: true } }))
    vi.stubGlobal('sciforge', { capabilities: { invoke } })
    const frame = await render({ ...contribution, capabilityIds: ['visual-review.accept-candidate'] }, { workspaceRoot: '/ws' })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const request = { type: 'capability.invoke', requestId: 'accept-1', actionId: 'visual-review.accept-candidate', input: { documentId: 'doc' }, approval: { mode: 'confirmation' } }
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: request })))
    expect(confirm).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { ...request, requestId: 'accept-2' } })))
    expect(invoke).toHaveBeenCalledWith({ workspaceId: '/ws', request: { actionId: request.actionId, input: request.input, invocationId: 'accept-2' }, approval: { mode: 'confirmation' } })
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { ...request, requestId: 'forged', approval: { mode: 'confirmation', grant: true } } })))
    expect(invoke).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('updates trusted context on the same iframe without sending dispose', async () => {
    const frame = await render({ ...contribution, capabilityIds: ['test.read'] }, { workspaceRoot: '/first', sessionId: 'first-thread', runtimeId: 'codex' })
    await ready(frame)
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    const next = await render({ ...contribution, capabilityIds: ['test.read'] }, { workspaceRoot: '/second', sessionId: 'second-thread', runtimeId: 'dsh' })
    expect(next).toBe(frame)
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(10_000))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(send.mock.calls.some(([message]) => message.type === 'dispose')).toBe(false)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'host.init', workspaceRoot: '/second', sessionId: 'second-thread', runtimeId: 'dsh', capabilityIds: ['test.read'], locale: 'en' }), '*')
  })
})
