import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyComputerUseRuntimeStatus,
  recordComputerUseDiagnostic,
  readComputerUseRuntimeStatus
} from './computer-use-status'

describe('computer-use runtime status', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns an empty runtime status when the status file is missing', async () => {
    const status = await readComputerUseRuntimeStatus('/tmp/missing-computer-use-status.json')

    expect(status).toEqual(emptyComputerUseRuntimeStatus())
  })

  it('aggregates fresh server leases and rejections while ignoring stale status', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-23T00:10:00.000Z'))
    const root = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-status-'))
    const statusPath = join(root, 'status.json')
    await writeFile(statusPath, JSON.stringify({
      version: 1,
      servers: {
        fresh: {
          serverId: 'fresh',
          pid: 101,
          updatedAt: '2026-06-23T00:09:30.000Z',
          backend: 'global-native',
          available: true,
          platform: 'darwin',
          inputIsolation: 'agent-isolated',
          affectsUserInput: false,
          requiresHostFocus: false,
          usesHostClipboard: false,
          activeLeases: [
            {
              leaseId: 'lease-1',
              computerUseSessionId: 'session-1',
              agentId: 'agent-1',
              threadId: 'thread-1',
              targetId: 'main-desktop',
              backend: 'global-native',
              acquiredAt: '2026-06-23T00:08:00.000Z',
              updatedAt: '2026-06-23T00:09:00.000Z'
            }
          ],
          recentRejections: [
            {
              code: 'target_in_use',
              message: 'main-desktop is already leased',
              targetId: 'main-desktop'
            }
          ]
        },
        stale: {
          serverId: 'stale',
          pid: 102,
          updatedAt: '2026-06-22T23:00:00.000Z',
          backend: 'global-native',
          available: false,
          platform: 'darwin',
          activeLeases: [
            {
              leaseId: 'stale-lease',
              computerUseSessionId: 'stale-session',
              agentId: 'agent-2',
              threadId: 'thread-2',
              targetId: 'old-desktop',
              backend: 'global-native',
              acquiredAt: '2026-06-22T23:00:00.000Z',
              updatedAt: '2026-06-22T23:00:00.000Z'
            }
          ],
          recentRejections: []
        }
      }
    }), 'utf8')

    const status = await readComputerUseRuntimeStatus(statusPath)

    expect(status.updatedAt).toBe('2026-06-23T00:09:30.000Z')
    expect(status.servers).toHaveLength(1)
    expect(status.backend).toMatchObject({
      backend: 'global-native',
      available: true,
      platform: 'darwin',
      inputIsolation: 'agent-isolated',
      affectsUserInput: false,
      requiresHostFocus: false,
      usesHostClipboard: false
    })
    expect(status.activeLeases.map((lease) => lease.leaseId)).toEqual(['lease-1'])
    expect(status.recentRejections).toEqual([
      {
        code: 'target_in_use',
        message: 'main-desktop is already leased',
        targetId: 'main-desktop'
      }
    ])
  })

  it('does not follow a symlinked app-data status target when recording diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-status-'))
    const outside = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-status-outside-'))
    const outsideFile = join(outside, 'status.json')
    const statusPath = join(root, 'status.json')
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, statusPath)

    await expect(recordComputerUseDiagnostic(statusPath, {
      backend: 'global-native',
      available: true,
      platform: 'darwin',
      activeLeases: [],
      recentRejections: []
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('does not cross a symlinked computer-use app-data directory', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-user-data-'))
    const outside = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-status-outside-'))
    await symlink(outside, join(userData, 'computer-use'))

    await expect(recordComputerUseDiagnostic(join(userData, 'computer-use', 'status.json'), {
      backend: 'global-native',
      available: true,
      platform: 'darwin',
      activeLeases: [],
      recentRejections: []
    })).rejects.toThrow(/must not cross a symlink/)
    await expect(readFile(join(outside, 'status.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
