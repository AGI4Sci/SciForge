import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisibleContextPublishInput } from '@shared/visible-context'
import {
  ensureVisibleContextRefreshListener,
  measureVisibleContextBounds,
  publishVisibleContextNow,
  registerVisibleContextComponent,
  registerVisibleContextSensitiveElements
} from './visible-context'

afterEach(() => vi.unstubAllGlobals())

describe('visible context visual targets', () => {
  it('measures an element without serializing a DOM selector', () => {
    const element = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 40,
        width: 800,
        height: 600
      })
    } as unknown as Element

    expect(measureVisibleContextBounds(element)).toEqual({
      x: 100,
      y: 40,
      width: 800,
      height: 600
    })
    expect(measureVisibleContextBounds(element, {
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.2
    })).toEqual({
      x: 300,
      y: 100,
      width: 400,
      height: 120
    })
  })

  it('continues renderer revisions from session storage after a reload', async () => {
    vi.resetModules()
    const storage = new Map([['sciforge.visible-context.revision', '41']])
    const publish = vi.fn(async (snapshot: VisibleContextPublishInput) => ({
      ...snapshot,
      windowId: 'electron:1'
    }))
    vi.stubGlobal('window', {
      sciforge: { visibleContext: { publish } },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      clearTimeout: vi.fn(),
      setTimeout: vi.fn()
    })
    const reloaded = await import('./visible-context')

    reloaded.publishVisibleContextNow()

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ revision: 42 }))
    expect(storage.get('sciforge.visible-context.revision')).toBe('42')
  })

  it('publishes immediately when main requests an on-demand refresh', () => {
    const publish = vi.fn(async (snapshot: VisibleContextPublishInput) => ({ ...snapshot, windowId: 'electron:1' }))
    let refresh: (() => void) | undefined
    vi.stubGlobal('window', {
      sciforge: {
        visibleContext: {
          publish,
          onRefreshRequested: (handler: () => void) => {
            refresh = handler
            return () => undefined
          }
        }
      },
      clearTimeout: vi.fn(),
      setTimeout: vi.fn()
    })

    ensureVisibleContextRefreshListener()
    refresh?.()

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 3,
      revision: 1,
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 }
    }))
  })

  it('auto-publishes password and explicitly sensitive controls as generic redactions', () => {
    const publish = vi.fn(async (snapshot: VisibleContextPublishInput) => ({ ...snapshot, windowId: 'electron:1' }))
    const password = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 })
    } as unknown as Element
    const explicitlySensitive = {
      getBoundingClientRect: () => ({ left: 40, top: 60, width: 80, height: 20 })
    } as unknown as Element
    const querySelectorAll = vi.fn((_selector: string) => [password, explicitlySensitive])
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('MutationObserver', class {
      observe = observe
      disconnect = disconnect
    })
    vi.stubGlobal('window', {
      sciforge: { visibleContext: { publish } },
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    const unregisterComponent = registerVisibleContextComponent({
      id: 'app.window',
      region: 'window',
      component: 'sciforge-window',
      visible: true,
      updatedAt: new Date().toISOString(),
      summary: 'SciForge window'
    })
    const unregisterSensitive = registerVisibleContextSensitiveElements({
      componentId: 'app.window',
      root: { querySelectorAll } as unknown as ParentNode & Node
    })

    publishVisibleContextNow()

    const published = publish.mock.calls.at(-1)?.[0]
    const targets = published?.components.find((component) => component.id === 'app.window')?.visualTargets
    expect(querySelectorAll).toHaveBeenCalledWith(
      'input[type="password"],[data-visual-context-sensitive]'
    )
    expect(querySelectorAll.mock.calls[0]?.[0]).not.toContain('textarea')
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'region', redact: true, bounds: { x: 10, y: 20, width: 100, height: 30 } }),
      expect.objectContaining({ kind: 'region', redact: true, bounds: { x: 40, y: 60, width: 80, height: 20 } })
    ]))
    expect(observe).toHaveBeenCalled()

    unregisterSensitive()
    unregisterComponent()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('visible context publishing', () => {
  it('filters invalid components before they cross the IPC boundary', async () => {
    vi.resetModules()
    const publish = vi.fn(async (snapshot: VisibleContextPublishInput) => ({
      ...snapshot,
      windowId: 'electron:1'
    }))
    vi.stubGlobal('window', {
      sciforge: { visibleContext: { publish } },
      sessionStorage: { getItem: vi.fn(), setItem: vi.fn() },
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => 1)
    })
    const visibleContext = await import('./visible-context')
    const valid = visibleContext.registerVisibleContextComponent({
      id: 'valid.component',
      region: 'main',
      component: 'test',
      visible: true,
      updatedAt: new Date().toISOString(),
      summary: 'Valid component',
      state: {
        longText: 'y'.repeat(10_000),
        manyItems: Array.from({ length: 100 }, (_, index) => index)
      }
    })
    const invalid = visibleContext.registerVisibleContextComponent({
      id: 'invalid.component',
      region: 'main',
      component: 'test',
      title: 'x'.repeat(257),
      visible: true,
      updatedAt: new Date().toISOString(),
      summary: 'Invalid component'
    })

    visibleContext.publishVisibleContextNow()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]?.[0].components.map((component) => component.id)).toEqual([
      'valid.component'
    ])
    const publishedState = publish.mock.calls[0]?.[0].components[0]?.state as {
      longText: string
      manyItems: number[]
    }
    expect(publishedState.longText).toHaveLength(4096)
    expect(publishedState.manyItems).toHaveLength(64)
    invalid()
    valid()
  })

  it('keeps one IPC publish in flight and coalesces queued snapshots to the latest revision', async () => {
    vi.resetModules()
    let resolveFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const publish = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ windowId: 'electron:1' })
    vi.stubGlobal('window', {
      sciforge: { visibleContext: { publish } },
      sessionStorage: { getItem: vi.fn(), setItem: vi.fn() },
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => 1)
    })
    const visibleContext = await import('./visible-context')
    const unregister = visibleContext.registerVisibleContextComponent({
      id: 'stable.component',
      region: 'main',
      component: 'test',
      visible: true,
      updatedAt: new Date().toISOString(),
      summary: 'Stable component'
    })

    visibleContext.publishVisibleContextNow()
    visibleContext.publishVisibleContextNow()
    visibleContext.publishVisibleContextNow()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ revision: 1 }))

    resolveFirst?.()
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ revision: 3 }))
    unregister()
  })
})
