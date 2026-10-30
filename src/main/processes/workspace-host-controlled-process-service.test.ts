import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostClient,
  type WorkspaceHostOperation,
  type WorkspaceHostPayload,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import { WorkspaceHostControlledProcessService } from './workspace-host-controlled-process-service'

const locator = Object.freeze({
  contractVersion: 1 as const,
  hostSessionId: 'workspace-session-1',
  path: '/cluster/project'
})

function session(): WorkspaceHostSession {
  return {
    protocolVersion: 1,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-1',
    sessionId: locator.hostSessionId,
    lifecycleMode: 'connection-session',
    locator,
    platform: {
      os: 'linux',
      architecture: 'x64'
    },
    capabilities: [
      WORKSPACE_HOST_OPERATIONS.processCreate,
      WORKSPACE_HOST_OPERATIONS.processRead,
      WORKSPACE_HOST_OPERATIONS.processWrite,
      WORKSPACE_HOST_OPERATIONS.processResize,
      WORKSPACE_HOST_OPERATIONS.processDispose
    ].map((operation) => ({
      operation,
      version: '1.0.0',
      maxRequestBytes: WORKSPACE_HOST_LIMITS.maxPayloadBytes,
      maxResponseBytes: WORKSPACE_HOST_LIMITS.maxPayloadBytes
    })),
    contributions: [],
    eventSequence: 0,
    replay: {
      earliestSequence: 0,
      latestSequence: 0
    },
    egress: {
      mode: 'none',
      status: 'disabled'
    }
  }
}

function client(
  request: (operation: WorkspaceHostOperation, payload: WorkspaceHostPayload) =>
    WorkspaceHostPayload | Promise<WorkspaceHostPayload>
): WorkspaceHostClient {
  const currentSession = session()
  return {
    getSession: () => currentSession,
    request: request as WorkspaceHostClient['request'],
    subscribe: () => () => undefined,
    acknowledge: async () => undefined,
    reconnect: async () => currentSession,
    close: async () => undefined
  }
}

describe('WorkspaceHostControlledProcessService', () => {
  it('routes an owner-scoped terminal lease through process operations', async () => {
    const request = vi.fn(async (operation: WorkspaceHostOperation): Promise<WorkspaceHostPayload> => {
      switch (operation) {
        case WORKSPACE_HOST_OPERATIONS.processCreate:
          return { processId: 'process-1', cursor: '0' }
        case WORKSPACE_HOST_OPERATIONS.processRead:
          return {
            cursor: '6',
            chunks: [
              { stream: 'stdout', data: 'out' },
              { stream: 'stderr', data: 'err' }
            ],
            truncated: false
          }
        case WORKSPACE_HOST_OPERATIONS.processWrite:
          return { acceptedCharacters: 4 }
        case WORKSPACE_HOST_OPERATIONS.processResize:
          return {
            supported: false,
            behavior: 'sigwinch-notification'
          }
        case WORKSPACE_HOST_OPERATIONS.processDispose:
          return { ok: true }
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    })
    const service = new WorkspaceHostControlledProcessService({
      locator,
      client: client(request)
    })

    await expect(service.create({
      ownerId: 'window-1',
      workspaceRoot: locator.path
    })).resolves.toEqual({
      resourceId: 'process-1',
      cursor: '0'
    })
    expect(service.has('window-1', 'process-1')).toBe(true)
    await expect(service.read({
      ownerId: 'window-1',
      resourceId: 'process-1',
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 20
    })).resolves.toEqual({
      cursor: '6',
      chunks: [
        { stream: 'stdout', data: 'out' },
        { stream: 'stdout', data: 'err' }
      ],
      truncated: false
    })
    await expect(service.write('window-1', 'process-1', 'data')).resolves.toBe(4)
    await expect(service.resize('window-1', 'process-1', 120, 40)).resolves.toBeUndefined()
    await expect(service.dispose('window-1', 'process-1')).resolves.toBe(true)
    expect(service.has('window-1', 'process-1')).toBe(false)

    expect(request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.processCreate,
      {
        profile: 'system-shell',
        cwd: '.',
        terminal: {
          columns: 80,
          rows: 24
        }
      },
      undefined
    )
    expect(request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.processResize,
      {
        processId: 'process-1',
        columns: 120,
        rows: 40
      },
      undefined
    )
  })

  it('enforces owner isolation before sending process requests', async () => {
    const request = vi.fn(async (): Promise<WorkspaceHostPayload> => ({
      processId: 'process-1',
      cursor: '0'
    }))
    const service = new WorkspaceHostControlledProcessService({
      locator,
      client: client(request)
    })
    await service.create({
      ownerId: 'window-1',
      workspaceRoot: locator.path
    })
    request.mockClear()

    await expect(service.write('window-2', 'process-1', 'data'))
      .rejects.toThrow(/unavailable to this caller/u)
    await expect(service.dispose('window-2', 'process-1')).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a process request for a different workspace before transport', async () => {
    const request = vi.fn()
    const service = new WorkspaceHostControlledProcessService({
      locator,
      client: client(request)
    })

    await expect(service.create({
      ownerId: 'window-1',
      workspaceRoot: '/cluster/another-project'
    })).rejects.toThrow(/does not match the selected Workspace Host locator/u)
    expect(request).not.toHaveBeenCalled()
  })

  it('strictly parses process responses and does not retain a malformed lease', async () => {
    const service = new WorkspaceHostControlledProcessService({
      locator,
      client: client(async () => ({
        processId: 'process-1',
        cursor: '0',
        executable: '/bin/bash'
      }))
    })

    await expect(service.create({
      ownerId: 'window-1',
      workspaceRoot: locator.path
    })).rejects.toThrow(/unrecognized key/i)
    expect(service.has('window-1', 'process-1')).toBe(false)
  })
})
