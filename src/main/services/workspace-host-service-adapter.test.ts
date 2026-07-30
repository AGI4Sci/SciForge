import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostClient,
  type WorkspaceHostOperation,
  type WorkspaceHostPayload,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import { WorkspaceHostServiceAdapter } from './workspace-host-service-adapter'

const locator = Object.freeze({
  contractVersion: 1 as const,
  hostSessionId: 'workspace-session-1',
  path: '/cluster/project'
})

function session(
  operations: readonly WorkspaceHostOperation[] = Object.values(WORKSPACE_HOST_OPERATIONS),
  sessionId: string = locator.hostSessionId
): WorkspaceHostSession {
  return {
    protocolVersion: 1,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-1',
    sessionId,
    lifecycleMode: 'persistent-daemon',
    locator: {
      ...locator,
      hostSessionId: sessionId
    },
    platform: {
      os: 'linux',
      architecture: 'x64'
    },
    capabilities: operations.map((operation) => ({
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
    WorkspaceHostPayload | Promise<WorkspaceHostPayload>,
  currentSession: WorkspaceHostSession = session()
): WorkspaceHostClient {
  return {
    getSession: () => currentSession,
    request: request as WorkspaceHostClient['request'],
    subscribe: () => () => undefined,
    acknowledge: async () => undefined,
    reconnect: async () => currentSession,
    close: async () => undefined
  }
}

describe('WorkspaceHostServiceAdapter', () => {
  it('routes file, search, and version-control operations through the bound client', async () => {
    const request = vi.fn(async (
      operation: WorkspaceHostOperation,
      _payload: WorkspaceHostPayload,
      _options?: unknown
    ): Promise<WorkspaceHostPayload> => {
      switch (operation) {
        case WORKSPACE_HOST_OPERATIONS.directoryList:
          return {
            entries: [{
              name: 'paper.md',
              path: '/cluster/project/paper.md',
              kind: 'file',
              size: 12,
              mtimeMs: 100,
              revision: 'rev-file'
            }]
          }
        case WORKSPACE_HOST_OPERATIONS.fileStat:
          return {
            entry: {
              name: 'project',
              path: '/cluster/project',
              kind: 'directory',
              size: 0,
              mtimeMs: 100
            }
          }
        case WORKSPACE_HOST_OPERATIONS.fileRead:
        case WORKSPACE_HOST_OPERATIONS.fileReadRange:
          return {
            contentBase64: Buffer.from('hello').toString('base64'),
            bytesRead: 5,
            truncated: false,
            revision: 'rev-read'
          }
        case WORKSPACE_HOST_OPERATIONS.fileWrite:
          return {
            revision: 'rev-write',
            size: 5,
            mtimeMs: 200
          }
        case WORKSPACE_HOST_OPERATIONS.textSearch:
          return {
            matches: [{
              path: '/cluster/project/paper.md',
              line: 2,
              column: 4,
              preview: 'hello'
            }],
            truncated: false
          }
        case WORKSPACE_HOST_OPERATIONS.versionControlStatus:
          return {
            revision: 'rev-git',
            clean: false,
            changes: [{ path: 'paper.md', status: 'modified' }],
            truncated: false
          }
        case WORKSPACE_HOST_OPERATIONS.versionControlDiff:
          return {
            text: '-old\\n+new\\n',
            truncated: false
          }
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    })
    const adapter = new WorkspaceHostServiceAdapter({
      locator,
      client: client(request)
    })

    await expect(adapter.listDirectory()).resolves.toMatchObject({
      entries: [{ name: 'paper.md', revision: 'rev-file' }]
    })
    await expect(adapter.stat()).resolves.toMatchObject({
      entry: { path: locator.path, kind: 'directory' }
    })
    await expect(adapter.readFile({
      path: '/cluster/project/paper.md',
      maxBytes: 1_000
    })).resolves.toMatchObject({ bytesRead: 5, revision: 'rev-read' })
    await expect(adapter.readFileRange({
      path: '/cluster/project/paper.md',
      offset: 5,
      length: 5
    })).resolves.toMatchObject({ bytesRead: 5, revision: 'rev-read' })
    await expect(adapter.writeFile({
      path: '/cluster/project/paper.md',
      contentBase64: Buffer.from('hello').toString('base64'),
      expectedRevision: 'rev-read'
    })).resolves.toEqual({
      revision: 'rev-write',
      size: 5,
      mtimeMs: 200
    })
    await expect(adapter.searchText({ query: 'hello' })).resolves.toMatchObject({
      matches: [{ line: 2, column: 4 }]
    })
    await expect(adapter.versionControlStatus()).resolves.toMatchObject({
      revision: 'rev-git',
      changes: [{ path: 'paper.md', status: 'modified' }]
    })
    await expect(adapter.versionControlDiff({
      from: 'HEAD',
      maxCharacters: 10_000
    })).resolves.toEqual({
      text: '-old\\n+new\\n',
      truncated: false
    })

    expect(request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.directoryList,
      { path: '.', limit: 1_000 },
      undefined
    )
    expect(request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.textSearch,
      {
        query: 'hello',
        path: '.',
        caseSensitive: false,
        maxResults: 1_000
      },
      undefined
    )
    const writeCall = request.mock.calls.find(
      ([operation]) => operation === WORKSPACE_HOST_OPERATIONS.fileWrite
    )
    expect(writeCall?.[2]).toEqual({ expectedRevision: 'rev-read' })
  })

  it('rejects malformed operation responses instead of trusting the transport', async () => {
    const adapter = new WorkspaceHostServiceAdapter({
      locator,
      client: client(async () => ({
        entries: [],
        unexpected: true
      }))
    })

    await expect(adapter.listDirectory()).rejects.toThrow(/unrecognized key/i)
  })

  it('rejects an unavailable operation before issuing a request', async () => {
    const request = vi.fn()
    const adapter = new WorkspaceHostServiceAdapter({
      locator,
      client: client(request, session([WORKSPACE_HOST_OPERATIONS.fileStat]))
    })

    await expect(adapter.searchText({ query: 'needle' }))
      .rejects.toThrow(/operation is unavailable/u)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a locator bound to another client session', () => {
    expect(() => new WorkspaceHostServiceAdapter({
      locator,
      client: client(vi.fn(), session(undefined, 'another-session'))
    })).toThrow(/does not belong/u)
  })
})
