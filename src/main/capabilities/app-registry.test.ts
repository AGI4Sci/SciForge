import { describe, expect, it, vi } from 'vitest'
import { capabilityResourceHandleSchema } from '../../shared/capability-broker'
import { CapabilityBroker } from './broker'
import {
  APP_CAPABILITY_IDS,
  BIOLOGY_ROOM_RESOURCE_KIND,
  WORKSPACE_PREVIEW_RESOURCE_KIND,
  createAppCapabilityRegistry,
  type AppCapabilityDependencies
} from './app-registry'
import { defineCapabilityProviderContractSuite } from './provider-contract-suite'

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  expect(Array.isArray(value)).toBe(false)
  return value as Record<string, unknown>
}

function createDependencies() {
  const pluginManifest = {
    contractVersion: 1,
    id: 'markdown',
    displayName: 'Markdown',
    version: '1',
    modality: 'document',
    lifecycle: 'main',
    priority: 1,
    match: { extensions: ['.md'] },
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['md']
    }
  }
  let session = {
    id: 'preview-1',
    pluginId: 'markdown',
    workspaceRoot: '/workspace',
    path: '/workspace/paper.md',
    modality: 'document',
    mode: 'preview',
    openedAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    file: {
      workspaceRoot: '/workspace',
      path: '/workspace/paper.md',
      relativePath: 'paper.md',
      size: 10,
      mtimeMs: 1
    }
  }
  const open = vi.fn(async () => ({
    ok: true as const,
    session,
    manifest: pluginManifest,
    route: 'matched' as const,
    file: session.file
  }))
  const observe = vi.fn(async () => ({
    ok: true as const,
    observation: {
      schemaVersion: 1 as const,
      file: { path: session.path, workspaceRoot: session.workspaceRoot },
      view: {
        pluginId: session.pluginId,
        modality: session.modality,
        mode: session.mode,
        title: 'paper.md'
      },
      visibleText: 'draft',
      actions: ['applyEdit', 'annotation.upsert']
    }
  }))
  const applyEdit = vi.fn(async (_sessionId: string, operation: { kind: string }) => {
    session = { ...session, updatedAt: '2026-07-16T00:00:01.000Z' }
    return {
      ok: true as const,
      session,
      operationKind: operation.kind,
      appliedAt: session.updatedAt,
      audit: {
        pluginId: session.pluginId,
        path: session.path,
        operationKind: operation.kind,
        effect: 'file-write' as const
      }
    }
  })
  const dependencies = {
    workspacePreviewHost: {
      listPlugins: () => [pluginManifest],
      getSession: (sessionId: string) => sessionId === session.id ? session : null,
      open,
      observe,
      describeAsset: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      readRange: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      prepareArtifact: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      readArtifactRange: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      applyEdit,
      exportPreview: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      invokeAction: vi.fn(async () => ({ ok: false as const, message: 'not needed' })),
      releaseSession: vi.fn(() => true)
    },
    biologyRoomService: {
      create: vi.fn(),
      openOrCreate: vi.fn(),
      load: vi.fn(),
      list: vi.fn(async () => []),
      observe: vi.fn(async () => ({
        schemaVersion: 1,
        roomId: 'room-1',
        title: 'Room',
        revision: 1,
        viewerStates: {},
        assets: [],
        annotations: [],
        visibleTrackIds: [],
        truncated: { assets: false, annotations: false, contigs: false },
        updatedAt: '2026-07-16T00:00:00.000Z'
      })),
      apply: vi.fn(),
      refresh: vi.fn(),
      history: vi.fn()
    }
  } as unknown as AppCapabilityDependencies
  return { dependencies, open, observe, applyEdit }
}

describe('app capability registry', () => {
  it('registers executable Workspace Preview and Biology Room actions from one composition root', () => {
    const { dependencies } = createDependencies()
    const ids = createAppCapabilityRegistry(dependencies).list().map((descriptor) => descriptor.id)

    const optionalWithoutProviders = new Set<string>([
      APP_CAPABILITY_IDS.surfaceCurrent,
      APP_CAPABILITY_IDS.surfaceInspect,
      APP_CAPABILITY_IDS.artifactInspect
    ])
    expect(ids).toEqual(expect.arrayContaining(
      Object.values(APP_CAPABILITY_IDS).filter((id) => !optionalWithoutProviders.has(id))
    ))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('registers surface and artifact inspection as broker-native reads', async () => {
    const { dependencies } = createDependencies()
    const inspectSurface = vi.fn(async () => ({
      artifact: {
        artifactRef: `artifact_${'a'.repeat(26)}`,
        mimeType: 'image/png' as const,
        capturedAt: '2026-07-16T00:00:00.000Z',
        width: 800,
        height: 600
      },
      evidence: { provider: 'model-router', attestation: `sha256:${'b'.repeat(64)}` }
    }))
    const inspectArtifacts = vi.fn(async () => ({
      artifacts: [{
        id: 'render',
        artifactRef: `artifact_${'c'.repeat(26)}`,
        mimeType: 'image/png' as const,
        size: 128,
        sha256: 'd'.repeat(64)
      }],
      evidence: { provider: 'model-router', attestation: `sha256:${'e'.repeat(64)}` }
    }))
    const broker = new CapabilityBroker(createAppCapabilityRegistry({
      ...dependencies,
      visibleContextService: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'electron:1',
          workspaceId: '/workspace',
          semanticRevision: 'surface-semantic-1',
          layoutRevision: '12',
          state: { targets: [{ targetRef: `target_${'f'.repeat(26)}`, kind: 'window' }], resources: [] }
        })),
        inspectSurface
      },
      inspectArtifacts
    }))
    const caller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }

    const opened = await broker.invoke(caller, { actionId: APP_CAPABILITY_IDS.surfaceCurrent, input: {} })
    const surface = capabilityResourceHandleSchema.parse(record(opened.output).surface)
    const observed = await broker.observe(caller, { resource: surface })
    expect(observed.operations.map((operation) => operation.id)).toContain(APP_CAPABILITY_IDS.surfaceInspect)
    await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.surfaceInspect,
      resource: surface,
      input: { task: 'Inspect the current PDF.' }
    })
    await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.artifactInspect,
      input: { task: 'Inspect the render.', artifacts: [{ id: 'render', path: 'render.png' }] }
    })

    expect(inspectSurface).toHaveBeenCalledWith('electron:1', { task: 'Inspect the current PDF.' })
    expect(inspectArtifacts).toHaveBeenCalledWith('/workspace', {
      task: 'Inspect the render.',
      artifacts: [{ id: 'render', path: 'render.png' }]
    })
  })

  it('uses the same Workspace Preview provider for UI and agent callers', async () => {
    const { dependencies, open } = createDependencies()
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))
    const input = { path: '/workspace/paper.md', workspaceRoot: '/workspace' }

    const uiResult = await broker.invoke({ audience: 'ui', callerId: 'window-1', workspaceId: '/workspace' }, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input
    })
    const agentResult = await broker.invoke({ audience: 'agent', callerId: 'thread-1', workspaceId: '/workspace' }, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input
    })

    expect(open).toHaveBeenCalledTimes(2)
    expect(capabilityResourceHandleSchema.parse(record(uiResult.output).resource)).toBeTruthy()
    expect(capabilityResourceHandleSchema.parse(record(agentResult.output).resource)).toBeTruthy()
  })

  it('explicitly shares Workspace Preview resource handles across trusted audiences in one workspace', async () => {
    const { dependencies } = createDependencies()
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))
    const opened = await broker.invoke(
      { audience: 'ui', callerId: 'window-1', workspaceId: '/workspace' },
      {
        actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
        input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
      }
    )
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)

    const observed = await broker.observe(
      { audience: 'agent', callerId: 'thread-1', workspaceId: '/workspace' },
      { resource: handle }
    )
    expect(observed.resourceKind).toBe(WORKSPACE_PREVIEW_RESOURCE_KIND)
  })

  it('streams resource content by invoking the registered describe and range capabilities', async () => {
    const { dependencies } = createDependencies()
    dependencies.workspacePreviewHost.describeAsset = vi.fn(async () => ({
      ok: true as const,
      descriptor: {
        schemaVersion: 1 as const,
        sessionId: 'preview-1',
        assetId: 'asset-1',
        pluginId: 'markdown',
        modality: 'document' as const,
        file: {
          workspaceRoot: '/workspace',
          path: '/workspace/paper.md',
          relativePath: 'paper.md',
          name: 'paper.md',
          size: 4,
          mtimeMs: 1,
          mimeType: 'text/markdown'
        },
        range: {
          available: true as const,
          size: 4,
          maxChunkBytes: 4,
          recommendedChunkBytes: 4
        },
        primary: 'byte-range' as const,
        eagerRead: { allowed: true, reason: 'test fixture' },
        strategies: [{
          kind: 'byte-range' as const,
          status: 'available' as const,
          reason: 'test fixture',
          maxChunkBytes: 4
        }]
      }
    }))
    dependencies.workspacePreviewHost.readRange = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'preview-1',
      assetId: 'asset-1',
      offset: 0,
      length: 4,
      size: 4,
      dataBase64: Buffer.from('test').toString('base64'),
      mimeType: 'text/markdown'
    }))
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))
    const caller = { audience: 'ui' as const, callerId: 'window-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)

    await expect(broker.describeResourceContent(caller, handle)).resolves.toMatchObject({
      size: 4,
      mimeType: 'text/markdown',
      fileName: 'paper.md'
    })
    await expect(broker.readResourceContentRange(caller, handle, { offset: 0, length: 4 }))
      .resolves.toMatchObject({ dataBase64: Buffer.from('test').toString('base64') })
    expect(dependencies.workspacePreviewHost.describeAsset).toHaveBeenCalledWith('preview-1')
    expect(dependencies.workspacePreviewHost.readRange).toHaveBeenCalledWith('preview-1', { offset: 0, length: 4 })
  })

  it('returns executable operations and publishes a change event after a preview mutation', async () => {
    const { dependencies, applyEdit } = createDependencies()
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))
    const caller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)
    const observed = await broker.observe(caller, { resource: handle })

    expect(observed.operations.map((operation) => operation.id)).toEqual(expect.arrayContaining([
      APP_CAPABILITY_IDS.workspacePreviewApplyEdit
    ]))
    expect(observed.operations.map((operation) => operation.id))
      .not.toContain(APP_CAPABILITY_IDS.workspacePreviewInvokeAction)
    const result = await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
      invocationId: 'edit-1',
      resource: observed.resource,
      expectedRevision: observed.semanticRevision,
      input: {
        operation: {
          kind: 'text.replaceRange',
          path: '/workspace/paper.md',
          range: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 }
          },
          text: 'Revised'
        }
      }
    })

    expect(applyEdit).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ changed: true, beforeRevision: observed.semanticRevision })
    expect(broker.listEvents(caller)).toHaveLength(1)
  })

  it('filters UI-only preview operations and exposes canonical annotation operations to agents', async () => {
    const { dependencies, observe } = createDependencies()
    const manifest = dependencies.workspacePreviewHost.listPlugins()[0]!
    manifest.capabilities.annotations = true
    observe.mockResolvedValue({
      ok: true as const,
      observation: {
        schemaVersion: 1 as const,
        file: { path: '/workspace/paper.pdf', workspaceRoot: '/workspace' },
        view: {
          pluginId: 'markdown',
          modality: 'document' as const,
          mode: 'preview' as const,
          title: 'paper.pdf'
        },
        documentAnnotations: {
          threadCount: 1,
          annotationCount: 2,
          openThreadCount: 1,
          truncated: false,
          threads: [{
            id: 'thread-1',
            kind: 'comment',
            status: 'open' as const,
            annotationCount: 2,
            summary: 'open | page 3 | Current canonical comment'
          }]
        },
        actions: ['html.previewUrl']
      }
    } as never)
    const registry = createAppCapabilityRegistry(dependencies)
    const broker = new CapabilityBroker(registry)
    const ui = { audience: 'ui' as const, callerId: 'window-1', workspaceId: '/workspace' }
    const agent = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(ui, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)

    const agentOperations = (await broker.observe(agent, { resource: handle })).operations.map(({ id }) => id)
    expect(agentOperations).toEqual(expect.arrayContaining([
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsList,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsDelete
    ]))
    expect(agentOperations).not.toEqual(expect.arrayContaining([
      APP_CAPABILITY_IDS.workspacePreviewInvokeAction,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsImport,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewImprove
    ]))

    const uiOperations = (await broker.observe(ui, { resource: handle })).operations.map(({ id }) => id)
    expect(uiOperations).toEqual(expect.arrayContaining([
      APP_CAPABILITY_IDS.workspacePreviewInvokeAction,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsImport,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewImprove
    ]))
    expect(registry.get(APP_CAPABILITY_IDS.workspacePreviewInvokeAction)?.descriptor.audiences).toEqual(['ui'])
    expect(registry.get(APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate)?.descriptor).toMatchObject({
      audiences: ['ui'],
      effect: 'workspace-write',
      approval: 'confirmation'
    })
  })

  it('rejects annotation variants through the generic apply-edit broker operation', async () => {
    const { dependencies, applyEdit } = createDependencies()
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))
    const caller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)
    const observed = await broker.observe(caller, { resource: handle })

    await expect(broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
      invocationId: 'annotation-bypass-1',
      resource: observed.resource,
      expectedRevision: observed.semanticRevision,
      input: {
        operation: {
          kind: 'annotation.thread.delete',
          path: '/workspace/paper.md',
          threadId: 'thread-1',
          pruneOrphanAnchors: true
        }
      }
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it('creates Biology Rooms through the registered provider and returns an opaque handle', async () => {
    const { dependencies } = createDependencies()
    const manifest = {
      schemaVersion: 1 as const,
      roomId: 'room-created',
      title: 'Created room',
      revision: 1,
      assets: [],
      viewerStates: {},
      annotations: [],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z'
    }
    dependencies.biologyRoomService.create = vi.fn(async () => manifest)
    const broker = new CapabilityBroker(createAppCapabilityRegistry(dependencies))

    const result = await broker.invoke(
      { audience: 'ui', callerId: 'window-1', workspaceId: '/workspace' },
      {
        actionId: APP_CAPABILITY_IDS.biologyRoomCreate,
        invocationId: 'create-room-1',
        input: { title: 'Created room' }
      }
    )

    expect(dependencies.biologyRoomService.create).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      title: 'Created room',
      assets: []
    })
    expect(record(result.output).manifest).toEqual(manifest)
    expect(capabilityResourceHandleSchema.parse(record(result.output).resource)).toBeTruthy()
  })
})

const contractCallers = {
  ui: { audience: 'ui' as const, callerId: 'contract-ui', workspaceId: '/workspace' },
  agent: { audience: 'agent' as const, callerId: 'contract-agent', workspaceId: '/workspace' },
  system: { audience: 'system' as const, callerId: 'contract-system', workspaceId: '/workspace' }
}

defineCapabilityProviderContractSuite('Workspace Preview', () => {
  const { dependencies, applyEdit } = createDependencies()
  const registry = createAppCapabilityRegistry(dependencies)
  return {
    registry,
    broker: new CapabilityBroker(registry),
    actionId: APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
    validInput: {
      operation: {
        kind: 'text.replaceRange',
        path: '/workspace/paper.md',
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 1 }
        },
        text: 'Revised'
      }
    },
    invalidInput: { operation: { kind: 'unknown' } },
    callers: contractCallers,
    executionCount: () => applyEdit.mock.calls.length,
    createResource: () => ({
      resourceId: 'preview-1',
      resourceKind: WORKSPACE_PREVIEW_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: '2026-07-16T00:00:00.000Z',
      observe: async () => ({
        state: { ready: true },
        semanticRevision: '2026-07-16T00:00:00.000Z',
        operationIds: [APP_CAPABILITY_IDS.workspacePreviewApplyEdit]
      })
    })
  }
})

defineCapabilityProviderContractSuite('Biology Room', () => {
  const { dependencies } = createDependencies()
  let executions = 0
  dependencies.biologyRoomService.apply = async (input) => {
    executions += 1
    return {
      dryRun: false,
      changed: true,
      previousRevision: input.baseRevision,
      revision: input.baseRevision + 1,
      manifest: {
        schemaVersion: 1,
        roomId: input.roomId,
        title: 'Room',
        revision: input.baseRevision + 1,
        assets: [],
        viewerStates: {},
        annotations: [],
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:01.000Z'
      },
      warnings: []
    }
  }
  const registry = createAppCapabilityRegistry(dependencies)
  return {
    registry,
    broker: new CapabilityBroker(registry),
    actionId: APP_CAPABILITY_IDS.biologyRoomApply,
    validInput: {
      operations: [{ type: 'setActiveAsset', assetId: 'asset-1' }]
    },
    invalidInput: { operations: [] },
    callers: contractCallers,
    executionCount: () => executions,
    createResource: () => ({
      resourceId: 'room-1',
      resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: '1',
      observe: async () => ({
        state: { ready: true },
        semanticRevision: '1',
        operationIds: [APP_CAPABILITY_IDS.biologyRoomApply]
      })
    })
  }
})
