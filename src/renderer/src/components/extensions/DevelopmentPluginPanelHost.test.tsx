// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainExtensionRendererContribution } from '@shared/domain-extensions'
import { DevelopmentPluginPanelHost } from './DevelopmentPluginPanelHost'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

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

  async function render(descriptor = contribution): Promise<HTMLIFrameElement> {
    await act(async () => root.render(createElement(DevelopmentPluginPanelHost, {
      contribution: { ...descriptor, entryUrl: 'about:blank' }, active: true
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
})
