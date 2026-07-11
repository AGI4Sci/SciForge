import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisibleContextSnapshot } from '@shared/visible-context'
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

  it('publishes immediately when main requests an on-demand refresh', () => {
    const publish = vi.fn(async (snapshot: VisibleContextSnapshot) => snapshot)
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
      schemaVersion: 2,
      revision: 1,
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 }
    }))
  })

  it('auto-publishes password and explicitly sensitive controls as generic redactions', () => {
    const publish = vi.fn(async (snapshot: VisibleContextSnapshot) => snapshot)
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
