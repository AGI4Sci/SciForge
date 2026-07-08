import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewExportTarget,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import {
  createRendererWorkspacePreviewRegistry,
  LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'
import {
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHost,
  type WorkspacePreviewBridgeAdapter,
  type WorkspacePreviewLastEditSummary
} from './host'

function createMockBridge(overrides: Partial<WorkspacePreviewBridgeAdapter> = {}): WorkspacePreviewBridgeAdapter {
  return {
    listPlugins: vi.fn<WorkspacePreviewBridgeAdapter['listPlugins']>(async () => []),
    open: vi.fn<WorkspacePreviewBridgeAdapter['open']>(async () => ({
      ok: false,
      message: 'open not mocked'
    })),
    observe: vi.fn<WorkspacePreviewBridgeAdapter['observe']>(async () => ({
      ok: false,
      message: 'observe not mocked'
    })),
    describeAsset: vi.fn<WorkspacePreviewBridgeAdapter['describeAsset']>(async () => ({
      ok: false,
      message: 'describeAsset not mocked'
    })),
    readRange: vi.fn<WorkspacePreviewBridgeAdapter['readRange']>(async () => ({
      ok: false,
      message: 'readRange not mocked'
    })),
    applyEdit: vi.fn<WorkspacePreviewBridgeAdapter['applyEdit']>(async () => ({
      ok: false,
      message: 'applyEdit not mocked'
    })),
    export: vi.fn<WorkspacePreviewBridgeAdapter['export']>(async () => ({
      ok: false,
      message: 'export not mocked'
    })),
    invokeAction: vi.fn<WorkspacePreviewBridgeAdapter['invokeAction']>(async () => ({
      ok: false,
      message: 'invokeAction not mocked'
    })),
    watch: vi.fn<WorkspacePreviewBridgeAdapter['watch']>(async () => ({
      ok: false,
      message: 'watch not mocked'
    })),
    unwatch: vi.fn<WorkspacePreviewBridgeAdapter['unwatch']>(async () => false),
    onChanged: vi.fn<WorkspacePreviewBridgeAdapter['onChanged']>(() => () => undefined),
    ...overrides
  }
}

function requireDescriptor(
  registry: RendererWorkspacePreviewRegistry,
  path: string
): RendererWorkspacePreviewPluginDescriptor {
  const descriptor = registry.resolve({ path })
  if (!descriptor) throw new Error(`Expected descriptor for ${path}`)
  return descriptor
}

function createSession(
  descriptor: RendererWorkspacePreviewPluginDescriptor,
  overrides: Partial<WorkspacePreviewSession> = {}
): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: descriptor.manifest.id,
    workspaceRoot: '/tmp/work',
    path: 'protein.pdb',
    modality: descriptor.manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    ...overrides
  }
}

function createFileState(overrides: Partial<WorkspacePreviewFileState> = {}): WorkspacePreviewFileState {
  return {
    workspaceRoot: '/tmp/work',
    path: 'protein.pdb',
    relativePath: 'protein.pdb',
    mimeType: 'chemical/x-pdb',
    size: 42,
    mtimeMs: 12,
    ...overrides
  }
}

describe('WorkspacePreviewHost', () => {
  it('lists descriptors and resolves renderer, life-science, and fallback plugins', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const host = createWorkspacePreviewHost({ registry, bridge: createMockBridge() })

    expect(host.listDescriptors().map((descriptor) => descriptor.manifest.id)).toEqual(
      expect.arrayContaining([
        MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
        LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID,
        'molecular'
      ])
    )
    expect(host.resolvePath({ path: 'README.md' })?.manifest.id).toBe(MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(host.resolvePath({ path: 'protein.pdb' })?.manifest.id).toBe('molecular')
    expect(host.resolvePath({ path: 'opaque.unknown', includeFallback: true })?.manifest.id).toBe(
      LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID
    )
  })

  it('opens through the workspace preview bridge and observes the current session', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'protein.pdb')
    const session = createSession(descriptor)
    const file = createFileState()
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: 'protein.pdb',
        workspaceRoot: '/tmp/work',
        mimeType: 'chemical/x-pdb',
        size: 42
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview' as const,
        title: 'protein.pdb'
      },
      molecular: {
        chains: ['A']
      },
      actions: ['workspace.setSelection']
    }
    const bridge = createMockBridge({
      open: vi.fn<WorkspacePreviewBridgeAdapter['open']>(async () => ({
        ok: true,
        session,
        manifest: descriptor.manifest,
        route: 'matched',
        file
      })),
      observe: vi.fn<WorkspacePreviewBridgeAdapter['observe']>(async () => ({
        ok: true,
        observation
      }))
    })
    const host = createWorkspacePreviewHost({ registry, bridge })

    const openResult = await host.open({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    expect(openResult.ok).toBe(true)
    expect(bridge.open).toHaveBeenCalledWith({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    expect(host.getState().session).toBe(session)
    expect(host.getState().descriptor?.manifest.id).toBe('molecular')
    expect(host.getState().file).toBe(file)
    expect(host.getState().error).toBeNull()

    const observeResult = await host.observe()
    expect(observeResult.ok).toBe(true)
    expect(bridge.observe).toHaveBeenCalledWith('session-1')
    expect(host.getState().observation).toBe(observation)
    expect(host.getState().error).toBeNull()
  })

  it('forwards generic selection, edit, export, range, watch, and unwatch calls', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'protein.pdb')
    const session = createSession(descriptor)
    const selection: WorkspaceStructuredSelection = {
      kind: 'molecular',
      chains: ['A']
    }
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: 'protein.pdb',
        workspaceRoot: '/tmp/work',
        mimeType: 'chemical/x-pdb',
        size: 42
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'protein.pdb'
      },
      molecular: {
        chains: ['A']
      },
      actions: ['workspace.setSelection']
    }
    const diffSummary: WorkspacePreviewLastEditSummary = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      kind: 'bounded',
      summary: 'Selection edit applied.',
      operationKind: 'molecular.setSelection',
      target: {
        path: 'protein.pdb'
      },
      counts: {
        filesChanged: 0
      },
      undo: {
        available: false,
        hint: 'Undo is not available for this preview edit.'
      },
      previews: [
        {
          label: 'Selection',
          before: 'No selection',
          after: 'Chain A'
        }
      ],
      bounded: {
        maxPreviewItems: 20,
        maxPreviewChars: 4000,
        truncated: false
      }
    }
    const applyEdit = vi.fn<WorkspacePreviewBridgeAdapter['applyEdit']>(async (_sessionId, operation) => {
      const nextSession = 'selection' in operation
        ? { ...session, selection: operation.selection, updatedAt: '2026-07-08T00:00:01.000Z' }
        : session
      const result = {
        ok: true,
        session: nextSession,
        operationKind: operation.kind,
        appliedAt: '2026-07-08T00:00:01.000Z',
        audit: {
          pluginId: descriptor.manifest.id,
          path: operation.path,
          operationKind: operation.kind,
          effect: 'session-update'
        },
        diffSummary
      } satisfies Extract<Awaited<ReturnType<WorkspacePreviewBridgeAdapter['applyEdit']>>, { ok: true }> & {
        diffSummary: WorkspacePreviewLastEditSummary
      }
      return result
    })
    const bridge = createMockBridge({
      open: vi.fn<WorkspacePreviewBridgeAdapter['open']>(async (input) => {
        const isSecondSession = input.path === 'protein-2.pdb'
        return {
          ok: true,
          session: createSession(descriptor, {
            id: isSecondSession ? 'session-2' : session.id,
            path: input.path
          }),
          manifest: descriptor.manifest,
          route: 'matched',
          file: createFileState({
            path: input.path,
            relativePath: input.path
          })
        }
      }),
      observe: vi.fn<WorkspacePreviewBridgeAdapter['observe']>(async () => ({
        ok: true,
        observation
      })),
      applyEdit,
      export: vi.fn<WorkspacePreviewBridgeAdapter['export']>(async (sessionId, target) => ({
        ok: true,
        sessionId,
        path: target.path ?? 'download',
        target,
        exportedAt: '2026-07-08T00:00:02.000Z',
        audit: {
          pluginId: descriptor.manifest.id,
          sourcePath: 'protein.pdb',
          targetKind: target.kind,
          format: target.format,
          effect: 'source-copy'
        }
      })),
      readRange: vi.fn<WorkspacePreviewBridgeAdapter['readRange']>(async (sessionId, range) => ({
        ok: true,
        sessionId,
        path: 'protein.pdb',
        offset: range.offset,
        length: range.length,
        size: 42,
        dataBase64: 'QUJDRA==',
        mimeType: 'chemical/x-pdb'
      })),
      invokeAction: vi.fn<WorkspacePreviewBridgeAdapter['invokeAction']>(async (sessionId, action) => ({
        ok: true,
        sessionId,
        pluginId: 'molecular',
        actionId: action.actionId,
        invokedAt: '2026-07-08T00:00:04.000Z',
        result: {
          ok: true
        },
        audit: {
          pluginId: 'molecular',
          path: 'protein.pdb',
          actionId: action.actionId,
          effect: 'worker-action'
        }
      })),
      describeAsset: vi.fn<WorkspacePreviewBridgeAdapter['describeAsset']>(async (sessionId) => ({
        ok: true,
        descriptor: {
          schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
          sessionId,
          pluginId: 'molecular',
          modality: 'molecular',
          file: {
            workspaceRoot: '/tmp/work',
            path: '/tmp/work/protein.pdb',
            relativePath: 'protein.pdb',
            mimeType: 'chemical/x-pdb',
            size: 42
          },
          primary: 'byte-range',
          eagerRead: {
            allowed: false,
            reason: 'lazy scientific asset transport'
          },
          range: {
            available: true,
            maxChunkBytes: 4 * 1024 * 1024,
            recommendedChunkBytes: 1024 * 1024,
            size: 42
          },
          strategies: [
            {
              kind: 'byte-range',
              status: 'available',
              reason: 'bounded reads',
              maxChunkBytes: 4 * 1024 * 1024
            }
          ]
        }
      })),
      watch: vi.fn<WorkspacePreviewBridgeAdapter['watch']>(async (payload) => ({
        ok: true,
        watchId: 'watch-1',
        path: payload.path,
        content: 'ATOM',
        mimeType: 'chemical/x-pdb',
        size: 4,
        truncated: false,
        startedAt: '2026-07-08T00:00:03.000Z'
      })),
      unwatch: vi.fn<WorkspacePreviewBridgeAdapter['unwatch']>(async () => true)
    })
    const host = createWorkspacePreviewHost({ registry, bridge })
    await host.open({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    await host.observe()

    await host.setSelection(selection)
    expect(applyEdit).toHaveBeenNthCalledWith(1, 'session-1', {
      kind: 'workspace.setSelection',
      path: 'protein.pdb',
      selection
    })
    expect(host.getState().observation?.selection).toEqual(selection)

    const operation: WorkspacePreviewEditOperation = {
      kind: 'molecular.setSelection',
      path: 'protein.pdb',
      selection
    }
    await host.applyEdit(operation)
    expect(applyEdit).toHaveBeenNthCalledWith(2, 'session-1', operation)
    expect(host.getState().observation?.selection).toEqual(selection)
    expect(host.getState().lastEditSummary).toBe(diffSummary)

    const exportTarget: WorkspacePreviewExportTarget = {
      kind: 'workspace-file',
      format: 'pdb',
      path: 'exports/protein-copy.pdb'
    }
    await host.export(exportTarget)
    expect(bridge.export).toHaveBeenCalledWith('session-1', exportTarget)

    await host.readRange({ offset: 0, length: 4 })
    expect(bridge.readRange).toHaveBeenCalledWith('session-1', { offset: 0, length: 4 })

    await host.invokeAction({
      actionId: 'molecular.select',
      input: { chains: ['A'] }
    })
    expect(bridge.invokeAction).toHaveBeenCalledWith('session-1', {
      actionId: 'molecular.select',
      input: { chains: ['A'] }
    })

    await host.describeAsset()
    expect(bridge.describeAsset).toHaveBeenCalledWith('session-1')
    expect(host.getState().asset).toMatchObject({
      sessionId: 'session-1',
      primary: 'byte-range',
      eagerRead: {
        allowed: false
      },
      range: {
        available: true,
        size: 42
      }
    })

    vi.mocked(bridge.describeAsset).mockResolvedValueOnce({
      ok: false,
      message: 'asset descriptor unavailable'
    })
    await host.describeAsset()
    expect(host.getState().asset).toBeNull()
    expect(host.getState().error).toBe('asset descriptor unavailable')

    await host.watch({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    expect(bridge.watch).toHaveBeenCalledWith({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })

    await host.unwatch('watch-1')
    expect(bridge.unwatch).toHaveBeenCalledWith('watch-1')
    expect(host.getState().error).toBeNull()

    await host.open({ path: 'protein-2.pdb', workspaceRoot: '/tmp/work' })
    expect(host.getState().session?.id).toBe('session-2')
    expect(host.getState().asset).toBeNull()
    expect(host.getState().lastEditSummary).toBeNull()
  })

  it('creates a range-only asset transport client from descriptors without enabling deferred strategies', async () => {
    const readRange = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-asset',
      path: '/tmp/work/protein.pdb',
      offset: 0,
      length: 4,
      size: 4,
      dataBase64: 'QUJDRA==',
      mimeType: 'chemical/x-pdb'
    }))
    const client = createWorkspacePreviewAssetTransportClient({
      descriptor: {
        schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
        sessionId: 'session-asset',
        pluginId: 'molecular',
        modality: 'molecular',
        file: {
          workspaceRoot: '/tmp/work',
          path: '/tmp/work/protein.pdb',
          relativePath: 'protein.pdb',
          mimeType: 'chemical/x-pdb',
          size: 4
        },
        primary: 'byte-range',
        eagerRead: {
          allowed: false,
          reason: 'large scientific asset'
        },
        range: {
          available: true,
          maxChunkBytes: 4 * 1024 * 1024,
          recommendedChunkBytes: 1024 * 1024,
          size: 4
        },
        strategies: [
          {
            kind: 'byte-range',
            status: 'available',
            reason: 'bounded reads',
            maxChunkBytes: 4 * 1024 * 1024
          },
          {
            kind: 'tile',
            status: 'requires-plugin',
            reason: 'format-specific decoder'
          }
        ]
      },
      readRange
    })

    expect(client.strategyStatus('byte-range')).toMatchObject({
      status: 'available'
    })
    expect(client.strategyStatus('tile')).toMatchObject({
      status: 'requires-plugin'
    })
    expect(client.strategyStatus('cache-artifact')).toBeNull()

    await expect(client.readTextIfWithin(8)).resolves.toEqual({
      ok: true,
      text: 'ABCD',
      bytesRead: 4,
      truncated: false
    })
    expect(readRange).toHaveBeenCalledWith({ offset: 0, length: 4 })
    await expect(client.readTextIfWithin(2)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('exceeds the 2 byte text read limit')
    })
  })

  it('does not fall back or call the bridge for deferred non-life-science formats', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const bridge = createMockBridge()
    const host = createWorkspacePreviewHost({ registry, bridge })

    expect(host.resolvePath({ path: 'mesh.vtk', includeFallback: true })).toBeNull()

    const result = await host.open({ path: 'mesh.vtk', workspaceRoot: '/tmp/work' })
    expect(result).toEqual({
      ok: false,
      message: 'No workspace preview plugin resolved for mesh.vtk.'
    })
    expect(bridge.open).not.toHaveBeenCalled()
    expect(host.getState().error).toContain('mesh.vtk')
  })
})
