import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostOperation,
  type WorkspaceHostPayload,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import type { ControlledProcessService } from '../processes/controlled-process-service'
import type { WorkspaceHostSessionPort } from '../workspace-host/session-manager'
import { VersionControlPlacementFacade } from './version-control-placement-facade'
import { WorkspacePlacementRouter } from './workspace-placement-router'
import type { VersionControlWorkspaceService } from './version-control-workspace-service'

const locator = Object.freeze({
  contractVersion: 1 as const,
  hostSessionId: 'remote-session-1',
  path: '/cluster/project'
})

function remoteSession(): WorkspaceHostSession {
  const operations = [
    WORKSPACE_HOST_OPERATIONS.fileStat,
    WORKSPACE_HOST_OPERATIONS.fileRead,
    WORKSPACE_HOST_OPERATIONS.versionControlStatus,
    WORKSPACE_HOST_OPERATIONS.versionControlDiff
  ]
  return {
    protocolVersion: 1,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-1',
    sessionId: locator.hostSessionId,
    lifecycleMode: 'persistent-daemon',
    locator,
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: operations.map((operation) => ({
      operation,
      version: '1.0.0',
      maxRequestBytes: WORKSPACE_HOST_LIMITS.maxPayloadBytes,
      maxResponseBytes: WORKSPACE_HOST_LIMITS.maxPayloadBytes
    })),
    contributions: [],
    eventSequence: 0,
    replay: { earliestSequence: 0, latestSequence: 0 },
    egress: { mode: 'none', status: 'disabled' }
  }
}

function createHarness() {
  const request = vi.fn(async (
    operation: WorkspaceHostOperation,
    payload: WorkspaceHostPayload
  ): Promise<WorkspaceHostPayload> => {
    if (operation === WORKSPACE_HOST_OPERATIONS.fileStat) {
      expect(payload).toEqual({ path: 'notes.md' })
      return {
        entry: {
          name: 'notes.md',
          path: 'notes.md',
          kind: 'file',
          size: 5,
          mtimeMs: 100,
          revision: 'file-revision-1'
        }
      }
    }
    if (operation === WORKSPACE_HOST_OPERATIONS.fileRead) {
      expect(payload).toEqual({ path: 'notes.md', maxBytes: 1_500_000 })
      return {
        contentBase64: Buffer.from('hello').toString('base64'),
        bytesRead: 5,
        truncated: false,
        revision: 'file-revision-1'
      }
    }
    if (operation === WORKSPACE_HOST_OPERATIONS.versionControlStatus) {
      return {
        revision: 'git-revision-1',
        clean: false,
        changes: [{ path: 'notes.md', status: 'modified' }],
        truncated: false
      }
    }
    if (operation === WORKSPACE_HOST_OPERATIONS.versionControlDiff) {
      return { text: '-old\\n+new\\n', truncated: false }
    }
    throw new Error(`Unexpected operation: ${operation}`)
  })
  const port = {
    getSession: remoteSession,
    getConnectionSnapshot: vi.fn(),
    request,
    subscribe: () => () => undefined,
    subscribeConnection: () => () => undefined
  } as unknown as WorkspaceHostSessionPort
  const workspacePlacement = new WorkspacePlacementRouter({
    sessionManager: { portFor: () => port },
    localControlledProcesses: {} as ControlledProcessService
  })
  const localReadFile = vi.fn()
  const local = {
    open: vi.fn(),
    requireSession: vi.fn(),
    status: vi.fn(),
    createSnapshot: vi.fn(),
    createReference: vi.fn(),
    listSnapshots: vi.fn(),
    diff: vi.fn(),
    readFile: localReadFile,
    restore: vi.fn()
  } as unknown as VersionControlWorkspaceService
  const facade = new VersionControlPlacementFacade({
    local,
    workspacePlacement
  })
  return { facade, local, localReadFile, request, workspacePlacement }
}

describe('VersionControlPlacementFacade', () => {
  it('keeps remote file reads and version-control reads on their distinct contracts', async () => {
    const { facade, local, request, workspacePlacement } = createHarness()

    await expect(workspacePlacement.readFile({
      workspaceRoot: locator.path,
      workspaceLocator: locator,
      path: `${locator.path}/notes.md`
    })).resolves.toMatchObject({
      ok: true,
      kind: 'text',
      path: `${locator.path}/notes.md`,
      content: 'hello',
      revision: 'file-revision-1'
    })

    const session = await facade.open('window:1', 'ui', locator.path, locator)
    await expect(facade.status(session)).resolves.toMatchObject({
      revision: 'git-revision-1',
      changes: [{ path: 'notes.md', status: 'modified' }]
    })
    await expect(facade.diff(session, {
      from: 'HEAD',
      paths: [`${locator.path}/notes.md`],
      maxCharacters: 10_000
    })).resolves.toEqual({ text: '-old\\n+new\\n', truncated: false })

    expect(local.open).not.toHaveBeenCalled()
    expect(request.mock.calls.map(([operation]) => operation)).toEqual([
      WORKSPACE_HOST_OPERATIONS.fileStat,
      WORKSPACE_HOST_OPERATIONS.fileRead,
      WORKSPACE_HOST_OPERATIONS.versionControlStatus,
      WORKSPACE_HOST_OPERATIONS.versionControlDiff
    ])
  })

  it('fails closed for remote revision-file reads without calling the local Git service', async () => {
    const { facade, localReadFile } = createHarness()
    const session = await facade.open('window:1', 'ui', locator.path, locator)

    await expect(facade.readFile(session, {
      revision: 'HEAD',
      path: 'notes.md',
      maxCharacters: 10_000
    })).rejects.toThrow(/not supported by the Workspace Host contract/u)
    expect(localReadFile).not.toHaveBeenCalled()
  })
})
