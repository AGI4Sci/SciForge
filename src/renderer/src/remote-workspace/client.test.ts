import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserRemoteWorkspaceClient } from './client'
import type { RemoteWorkspaceViewSnapshot } from './types'

const emptySnapshot: RemoteWorkspaceViewSnapshot = {
  workspaces: [],
  updatedAt: '2026-07-30T00:00:00.000Z'
}

describe('BrowserRemoteWorkspaceClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports an unavailable bridge and returns local-only state', async () => {
    vi.stubGlobal('window', { sciforge: {} })
    const client = new BrowserRemoteWorkspaceClient()

    expect(client.supported).toBe(false)
    await expect(client.list()).resolves.toEqual([])
    await expect(client.get()).resolves.toEqual({
      workspaces: [],
      updatedAt: new Date(0).toISOString()
    })
  })

  it('delegates opaque commands to the nested remote workspace bridge', async () => {
    const select = vi.fn(async () => emptySnapshot)
    const reconnect = vi.fn(async () => emptySnapshot)
    const list = vi.fn(async () => [])
    const get = vi.fn(async () => emptySnapshot)
    const onSnapshotChanged = vi.fn(() => () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        remoteWorkspace: {
          list,
          get,
          select,
          reconnect,
          onSnapshotChanged
        }
      }
    })
    const client = new BrowserRemoteWorkspaceClient()

    expect(client.supported).toBe(true)
    await client.select({ sessionId: 'opaque-session' })
    await client.reconnect({ sessionId: 'opaque-session' })

    expect(select).toHaveBeenCalledWith({ sessionId: 'opaque-session' })
    expect(reconnect).toHaveBeenCalledWith({ sessionId: 'opaque-session' })
  })
})
