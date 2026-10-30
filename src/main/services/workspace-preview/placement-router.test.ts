import { describe, expect, it, vi } from 'vitest'

import {
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  type WorkspaceHostPayload,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import {
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION
} from '../../../shared/workspace-preview'
import type { WorkspaceHostSessionPort } from '../../workspace-host/session-manager'
import { WorkspacePreviewHost } from './host'
import { WorkspacePreviewPlacementRouter } from './placement-router'

const locator = {
  contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
  hostSessionId: 'workspace-host-session',
  path: '/cluster/workspace'
} as const

function hostSession(previewAvailable = true): WorkspaceHostSession {
  return {
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-1',
    sessionId: locator.hostSessionId,
    lifecycleMode: 'persistent-daemon',
    locator,
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: previewAvailable
      ? [{
          operation: WORKSPACE_HOST_OPERATIONS.previewInvoke,
          version: '1.0.0',
          maxRequestBytes: 1_000_000,
          maxResponseBytes: 1_000_000
        }]
      : [],
    contributions: [],
    eventSequence: 0,
    replay: { earliestSequence: 0, latestSequence: 0 },
    egress: { mode: 'none', status: 'disabled' }
  }
}

function createRemotePort(previewAvailable = true) {
  const request = vi.fn(async (
    _operation: string,
    payload: { pluginId: string; method: string; input: Record<string, unknown> }
  ): Promise<WorkspaceHostPayload> => {
    const session = {
      id: 'preview-remote',
      pluginId: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
      workspaceRoot: locator.path,
      path: `${locator.path}/notes/readme.md`,
      modality: 'document',
      mode: 'preview',
      openedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
      mtimeMs: 100,
      file: {
        workspaceRoot: locator.path,
        path: `${locator.path}/notes/readme.md`,
        relativePath: 'notes/readme.md',
        mimeType: 'text/markdown',
        size: 12,
        mtimeMs: 100
      }
    } as const
    const artifact = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      sessionId: session.id,
      assetId: `asset:${session.id}`,
      artifactId: 'artifact-1',
      kind: 'cache-artifact',
      pluginId: session.pluginId,
      mimeType: 'application/json',
      byteLength: 2,
      range: {
        available: true,
        size: 2,
        maxChunkBytes: 2,
        recommendedChunkBytes: 2
      },
      source: {
        assetId: `asset:${session.id}`,
        size: 12,
        mtimeMs: 100
      },
      cache: {
        scope: 'session',
        source: 'observation',
        createdAt: '2026-07-30T00:00:00.000Z',
        invalidation: 'source-size-mtime'
      }
    } as const

    switch (payload.method) {
      case 'open':
        return {
          ok: true,
          session,
          manifest: new WorkspacePreviewHost().listPlugins().find(
            (candidate) => candidate.id === MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID
          )!,
          route: 'matched',
          file: session.file,
          sourceRevision: 'revision-1'
        }
      case 'observe':
        return {
          ok: true,
          observation: {
            schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
            file: {
              path: session.path,
              workspaceRoot: session.workspaceRoot,
              mimeType: 'text/markdown',
              size: 12,
              mtimeMs: 100
            },
            view: {
              pluginId: session.pluginId,
              modality: session.modality,
              mode: session.mode,
              title: 'readme.md'
            },
            visibleText: '# remote',
            actions: ['observe']
          }
        }
      case 'describeAsset':
        return {
          ok: true,
          sourceRevision: 'revision-1',
          descriptor: {
            schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
            sessionId: session.id,
            assetId: `asset:${session.id}`,
            pluginId: session.pluginId,
            modality: session.modality,
            file: {
              name: 'readme.md',
              relativePath: 'notes/readme.md',
              mimeType: 'text/markdown',
              size: 12,
              mtimeMs: 100
            },
            primary: 'byte-range',
            eagerRead: {
              allowed: false,
              reason: 'Remote assets use bounded range reads.'
            },
            range: {
              available: true,
              maxChunkBytes: 1024,
              recommendedChunkBytes: 512,
              size: 12
            },
            strategies: [{
              kind: 'byte-range',
              status: 'available',
              reason: 'Remote source supports bounded range reads.',
              maxChunkBytes: 1024
            }]
          }
        }
      case 'readRange':
        return {
          ok: true,
          sessionId: session.id,
          assetId: `asset:${session.id}`,
          offset: 0,
          length: 4,
          size: 12,
          dataBase64: 'IyByZQ==',
          mimeType: 'text/markdown'
        }
      case 'prepareArtifact':
        return { ok: true, sessionId: session.id, artifact }
      case 'readArtifactRange':
        return {
          ok: true,
          sessionId: session.id,
          assetId: artifact.assetId,
          artifactId: artifact.artifactId,
          offset: 0,
          length: 2,
          size: 2,
          mimeType: artifact.mimeType,
          dataBase64: 'e30='
        }
      case 'applyEdit':
        return {
          result: {
            ok: true,
            session: {
              ...session,
              updatedAt: '2026-07-30T00:00:01.000Z',
              selection: {
                kind: 'text',
                ranges: [{
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 1
                }]
              }
            },
            operationKind: 'workspace.setSelection',
            appliedAt: '2026-07-30T00:00:01.000Z',
            audit: {
              pluginId: session.pluginId,
              path: session.path,
              operationKind: 'workspace.setSelection',
              effect: 'session-update'
            }
          },
          sourceRevision: 'revision-2'
        }
      case 'exportPreview':
        return {
          ok: true,
          sessionId: session.id,
          path: `${locator.path}/export/readme.md`,
          target: {
            kind: 'workspace-file',
            format: 'md',
            path: 'export/readme.md'
          },
          exportedAt: '2026-07-30T00:00:02.000Z',
          audit: {
            pluginId: session.pluginId,
            sourcePath: session.path,
            targetKind: 'workspace-file',
            format: 'md',
            effect: 'source-copy'
          }
        }
      case 'invokeAction':
        return {
          ok: true,
          sessionId: session.id,
          pluginId: session.pluginId,
          actionId: 'markdown.refresh',
          invokedAt: '2026-07-30T00:00:03.000Z',
          result: { refreshed: true },
          audit: {
            pluginId: session.pluginId,
            path: session.path,
            actionId: 'markdown.refresh',
            effect: 'worker-action'
          }
        }
      case 'release':
        return { released: true }
      default:
        throw new Error(`Unexpected method ${payload.method}`)
    }
  })
  const port = {
    getSession: () => hostSession(previewAvailable),
    getConnectionSnapshot: vi.fn(),
    request,
    subscribe: vi.fn(() => () => undefined),
    subscribeConnection: vi.fn(() => () => undefined)
  } as unknown as WorkspaceHostSessionPort
  return { port, request }
}

describe('WorkspacePreviewPlacementRouter', () => {
  it('binds a remote preview session to one Workspace Host port for every bounded operation', async () => {
    const local = new WorkspacePreviewHost()
    const localOpen = vi.spyOn(local, 'open')
    const remote = createRemotePort()
    const router = new WorkspacePreviewPlacementRouter({
      local,
      resolveWorkspaceHostSessionPort: () => remote.port
    })

    const opened = await router.open({
      workspaceLocator: locator,
      workspaceRoot: locator.path,
      path: `${locator.path}/notes/readme.md`,
      mimeType: 'text/markdown'
    })
    if (!opened.ok) throw new Error(opened.message)

    await expect(router.observe(opened.session.id)).resolves.toMatchObject({ ok: true })
    await expect(router.describeAsset(opened.session.id)).resolves.toMatchObject({ ok: true })
    await expect(router.readRange(opened.session.id, { offset: 0, length: 4 }))
      .resolves.toMatchObject({ ok: true, dataBase64: 'IyByZQ==' })
    await expect(router.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'observation'
    })).resolves.toMatchObject({ ok: true })
    await expect(router.readArtifactRange(opened.session.id, {
      artifactId: 'artifact-1',
      range: { offset: 0, length: 2 }
    })).resolves.toMatchObject({ ok: true, dataBase64: 'e30=' })
    await expect(router.applyEdit(opened.session.id, {
      kind: 'workspace.setSelection',
      path: `${locator.path}/notes/readme.md`,
      selection: {
        kind: 'text',
        ranges: [{
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1
        }]
      }
    })).resolves.toMatchObject({ ok: true })
    await expect(router.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'md',
      path: 'export/readme.md'
    })).resolves.toMatchObject({ ok: true })
    await expect(router.invokeAction(opened.session.id, {
      actionId: 'markdown.refresh',
      input: {}
    })).resolves.toMatchObject({ ok: true })
    await expect(router.releaseSession(opened.session.id)).resolves.toBe(true)

    expect(localOpen).not.toHaveBeenCalled()
    const invocations = remote.request.mock.calls.map(([, payload]) => payload)
    expect(invocations.map((payload) => payload.method)).toEqual([
      'open',
      'observe',
      'describeAsset',
      'readRange',
      'prepareArtifact',
      'readArtifactRange',
      'applyEdit',
      'exportPreview',
      'invokeAction',
      'release'
    ])
    expect(invocations.every((payload) =>
      payload.pluginId === MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID
    )).toBe(true)
    expect(invocations[0]?.input).toMatchObject({ relativePath: 'notes/readme.md' })
    expect(invocations[6]?.input).toMatchObject({ expectedRevision: 'revision-1' })
    expect(invocations[7]?.input).toMatchObject({ expectedRevision: 'revision-2' })
    expect(remote.request.mock.calls.every(
      ([operation]) => operation === WORKSPACE_HOST_OPERATIONS.previewInvoke
    )).toBe(true)
  })

  it('fails closed when a selected remote host lacks preview capability', async () => {
    const local = new WorkspacePreviewHost()
    const localOpen = vi.spyOn(local, 'open')
    const remote = createRemotePort(false)
    const router = new WorkspacePreviewPlacementRouter({
      local,
      resolveWorkspaceHostSessionPort: () => remote.port
    })

    await expect(router.open({
      workspaceLocator: locator,
      workspaceRoot: locator.path,
      path: `${locator.path}/notes/readme.md`
    })).resolves.toEqual({
      ok: false,
      message: 'The selected Workspace Host does not provide scientific preview operations.'
    })
    expect(localOpen).not.toHaveBeenCalled()
    expect(remote.request).not.toHaveBeenCalled()
  })

  it('never retries a failed remote operation through the local provider registry', async () => {
    const local = new WorkspacePreviewHost()
    const localObserve = vi.spyOn(local, 'observe')
    const remote = createRemotePort()
    const router = new WorkspacePreviewPlacementRouter({
      local,
      resolveWorkspaceHostSessionPort: () => remote.port
    })
    const opened = await router.open({
      workspaceLocator: locator,
      workspaceRoot: locator.path,
      path: `${locator.path}/notes/readme.md`
    })
    if (!opened.ok) throw new Error(opened.message)

    remote.request.mockRejectedValueOnce(new Error('remote provider disconnected'))
    await expect(router.observe(opened.session.id)).rejects.toThrow(
      'remote provider disconnected'
    )
    expect(localObserve).not.toHaveBeenCalled()
  })

  it('keeps local previews on the existing canonical host', async () => {
    const local = new WorkspacePreviewHost()
    const localOpen = vi.spyOn(local, 'open').mockResolvedValue({
      ok: false,
      message: 'local result'
    })
    const resolver = vi.fn()
    const router = new WorkspacePreviewPlacementRouter({
      local,
      resolveWorkspaceHostSessionPort: resolver
    })
    const input = {
      workspaceRoot: '/local/workspace',
      path: '/local/workspace/readme.md'
    }

    await expect(router.open(input)).resolves.toEqual({
      ok: false,
      message: 'local result'
    })
    expect(localOpen).toHaveBeenCalledWith(input)
    expect(resolver).not.toHaveBeenCalled()
  })
})
