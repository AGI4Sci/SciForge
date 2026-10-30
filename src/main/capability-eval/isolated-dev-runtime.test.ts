import { describe, expect, it, vi } from 'vitest'
import {
  decorateIsolatedRuntime,
  type IsolatedDevBrowserBridgeRuntime
} from './isolated-dev-runtime'
import type { DevBrowserBridgeRuntime } from './dev-bridge-runtime'

describe('isolated development runtime decoration', () => {
  it('preserves prototype methods and replaces only close', async () => {
    const startThread = vi.fn(async () => ({
      id: 'thread-1',
      runtimeId: 'codex' as const,
      title: 'test',
      updatedAt: '2026-09-16T00:00:00.000Z'
    }))
    const originalClose = vi.fn(async () => undefined)
    const runtime = Object.create({ startThread }) as DevBrowserBridgeRuntime
    Object.defineProperty(runtime, 'close', { configurable: true, value: originalClose, writable: true })
    const isolatedClose = vi.fn(async () => undefined)

    const decorated: IsolatedDevBrowserBridgeRuntime = decorateIsolatedRuntime(runtime, {
      isolatedUserDataDirectory: '/tmp/eval-user-data',
      isolatedInstanceId: 'instance-1',
      close: isolatedClose
    })

    expect(decorated.startThread).toBe(startThread)
    await decorated.startThread({ runtimeId: 'codex', title: 'test' })
    expect(startThread).toHaveBeenCalledOnce()
    expect(decorated.isolatedUserDataDirectory).toBe('/tmp/eval-user-data')
    expect(decorated.isolatedInstanceId).toBe('instance-1')
    await decorated.close()
    expect(isolatedClose).toHaveBeenCalledOnce()
    expect(originalClose).not.toHaveBeenCalled()
  })
})
