import { describe, expect, it, vi } from 'vitest'
import {
  BIOLOGY_ROOM_CAPABILITY_IDS
} from '@sciforge/domain-biology-room/contract'
import { capabilityResourceHandleSchema } from '../../shared/capability-broker'
import {
  CONTROLLED_PROCESS_CREATE_ACTION_ID,
  CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
  CONTROLLED_PROCESS_READ_ACTION_ID,
  CONTROLLED_PROCESS_RESIZE_ACTION_ID,
  CONTROLLED_PROCESS_WRITE_ACTION_ID
} from '@sciforge/domain-sdk/controlled-process'
import { CapabilityBroker } from './broker'
import {
  APP_CAPABILITY_IDS,
  WORKSPACE_PREVIEW_RESOURCE_KIND,
  type AppCapabilityDependencies
} from './app-registry'
import { defineCapabilityProviderContractSuite } from './provider-contract-suite'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog,
  isAppCapabilityContributionFactory
} from '../modules'
import { createNonSecretPackageStorageForTest } from '../modules/domain-package-storage.test-helper'

function createRegistry(dependencies: AppCapabilityDependencies) {
  const catalog = createApplicationDomainCatalog({
    getUserDataDir: () => '/tmp/sciforge-test',
    packageStorageFor: createNonSecretPackageStorageForTest(),
    capabilityInvokerFor: () => ({
      invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') }
    })
  })
  return createApplicationCapabilityRegistry(catalog, dependencies)
}

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
    controlledProcessService: {
      create: vi.fn(async () => ({ resourceId: 'process-1', cursor: '0' })),
      has: vi.fn((ownerId: string, resourceId: string) =>
        ownerId === 'window-1' && resourceId === 'process-1'
      ),
      read: vi.fn(async (input: { ownerId: string }) => {
        if (input.ownerId !== 'window-1') {
          throw new Error('Controlled process session is unavailable to this caller.')
        }
        return {
          cursor: '5',
          chunks: [{ stream: 'stdout' as const, data: 'hello' }],
          truncated: false
        }
      }),
      write: vi.fn(() => 4),
      resize: vi.fn(),
      dispose: vi.fn(() => true)
    },
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
    }
  } as unknown as AppCapabilityDependencies
  return { dependencies, open, observe, applyEdit }
}

describe('app capability registry', () => {
  it('attributes capability definitions to domain modules without changing registration order', () => {
    const { dependencies } = createDependencies()
    const dependenciesWithOptionalProviders = {
      ...dependencies,
      visibleContextService: {
        currentSurface: vi.fn()
      }
    } as unknown as AppCapabilityDependencies
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => '/tmp/sciforge-test',
      packageStorageFor: createNonSecretPackageStorageForTest(),
      capabilityInvokerFor: () => ({
        invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') }
      })
    })
    const contributions = catalog.listContributions(
      MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      isAppCapabilityContributionFactory
    ).map(({ value: factory }) => ({
      moduleId: factory.moduleId,
      capabilityIds: factory.createDefinitions(dependenciesWithOptionalProviders)
        .map((definition) => definition.descriptor.id)
    }))

    expect(contributions).toEqual(expect.arrayContaining([
      {
        moduleId: 'sciforge.controlled-process',
        capabilityIds: [
          CONTROLLED_PROCESS_CREATE_ACTION_ID,
          CONTROLLED_PROCESS_READ_ACTION_ID,
          CONTROLLED_PROCESS_WRITE_ACTION_ID,
          CONTROLLED_PROCESS_RESIZE_ACTION_ID,
          CONTROLLED_PROCESS_DISPOSE_ACTION_ID
        ]
      },
      {
        moduleId: 'sciforge.surface',
        capabilityIds: [APP_CAPABILITY_IDS.surfaceCurrent]
      },
      {
        moduleId: 'sciforge.workspace-preview',
        capabilityIds: [
          APP_CAPABILITY_IDS.workspacePreviewList,
          APP_CAPABILITY_IDS.workspacePreviewOpen,
          APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
          APP_CAPABILITY_IDS.workspacePreviewReadRange,
          APP_CAPABILITY_IDS.workspacePreviewPrepareArtifact,
          APP_CAPABILITY_IDS.workspacePreviewReadArtifactRange,
          APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsList,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsDelete,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsImport,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate,
          APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewImprove,
          APP_CAPABILITY_IDS.workspacePreviewExport,
          APP_CAPABILITY_IDS.workspacePreviewInvokeAction,
          APP_CAPABILITY_IDS.workspacePreviewRelease
        ]
      },
      {
        moduleId: 'sciforge.biology-room',
        capabilityIds: [
          BIOLOGY_ROOM_CAPABILITY_IDS.list,
          BIOLOGY_ROOM_CAPABILITY_IDS.create,
          BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate,
          BIOLOGY_ROOM_CAPABILITY_IDS.load,
          BIOLOGY_ROOM_CAPABILITY_IDS.open,
          BIOLOGY_ROOM_CAPABILITY_IDS.apply,
          BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
          BIOLOGY_ROOM_CAPABILITY_IDS.history
        ]
      }
    ]))
  })

  it('registers executable core and installed-domain actions from one composition root', () => {
    const { dependencies } = createDependencies()
    const ids = createRegistry(dependencies).list().map((descriptor) => descriptor.id)

    const optionalWithoutProviders = new Set<string>([APP_CAPABILITY_IDS.surfaceCurrent])
    expect(ids).toEqual(expect.arrayContaining(
      [
        ...Object.values(APP_CAPABILITY_IDS).filter((id) => !optionalWithoutProviders.has(id)),
        CONTROLLED_PROCESS_CREATE_ACTION_ID,
        CONTROLLED_PROCESS_READ_ACTION_ID,
        CONTROLLED_PROCESS_WRITE_ACTION_ID,
        CONTROLLED_PROCESS_RESIZE_ACTION_ID,
        CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
        ...Object.values(BIOLOGY_ROOM_CAPABILITY_IDS)
      ]
    ))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('owns controlled process handles by UI caller and streams without resource revisions', async () => {
    const { dependencies } = createDependencies()
    const broker = new CapabilityBroker(createRegistry(dependencies))
    const caller = {
      audience: 'ui' as const,
      callerId: 'window-1',
      workspaceId: '/workspace'
    }
    const opened = await broker.invoke(caller, {
      actionId: CONTROLLED_PROCESS_CREATE_ACTION_ID,
      invocationId: 'process-create-1',
      input: {
        profile: 'system-shell',
        terminal: { columns: 100, rows: 30 }
      }
    })
    const resource = capabilityResourceHandleSchema.parse(record(opened.output).resource)
    const observed = await broker.observe(caller, { resource })

    expect(dependencies.controlledProcessService.create).toHaveBeenCalledWith({
      ownerId: 'window-1',
      workspaceRoot: '/workspace',
      columns: 100,
      rows: 30
    })
    expect(observed.operations.map(({ id }) => id)).toEqual([
      CONTROLLED_PROCESS_READ_ACTION_ID,
      CONTROLLED_PROCESS_WRITE_ACTION_ID,
      CONTROLLED_PROCESS_RESIZE_ACTION_ID,
      CONTROLLED_PROCESS_DISPOSE_ACTION_ID
    ])
    const read = await broker.invoke(caller, {
      actionId: CONTROLLED_PROCESS_READ_ACTION_ID,
      resource: observed.resource,
      input: { cursor: '0', maxCharacters: 100, waitMilliseconds: 10 }
    })
    expect(read.output).toEqual({
      cursor: '5',
      chunks: [{ stream: 'stdout', data: 'hello' }],
      truncated: false
    })
    expect(read.changed).toBe(false)
    expect(dependencies.controlledProcessService.read).toHaveBeenCalledWith({
      ownerId: 'window-1',
      resourceId: 'process-1',
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 10
    })
    expect(broker.discover({
      audience: 'agent',
      callerId: 'thread-1',
      workspaceId: '/workspace'
    }).map(({ id }) => id)).not.toContain(CONTROLLED_PROCESS_CREATE_ACTION_ID)
  })

  it('reuses one current-surface registration while observing each agent caller dynamically', async () => {
    const { dependencies } = createDependencies()
    const currentSurface = vi.fn(async (_callerId?: string) => ({
      resourceId: 'electron:1',
      workspaceId: '/workspace',
      semanticRevision: 'surface-semantic-1',
      layoutRevision: '12',
      state: {
        layoutFreshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
        targets: [{ targetRef: `target_${'f'.repeat(26)}`, kind: 'window' as const }],
        resources: []
      }
    }))
    const broker = new CapabilityBroker(createRegistry({
      ...dependencies,
      visibleContextService: { currentSurface }
    }))
    const firstCaller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const secondCaller = { ...firstCaller, callerId: 'thread-2' }

    const firstOpened = await broker.invoke(firstCaller, {
      actionId: APP_CAPABILITY_IDS.surfaceCurrent,
      input: {}
    })
    const secondOpened = await broker.invoke(secondCaller, {
      actionId: APP_CAPABILITY_IDS.surfaceCurrent,
      input: {}
    })
    expect(record(firstOpened.output).current).toMatchObject({
      layoutFreshness: { stale: false },
      resources: []
    })
    const firstSurface = capabilityResourceHandleSchema.parse(record(firstOpened.output).surface)
    const secondSurface = capabilityResourceHandleSchema.parse(record(secondOpened.output).surface)
    await expect(broker.observe(firstCaller, { resource: firstSurface }))
      .resolves.toMatchObject({ operations: [] })
    await expect(broker.observe(secondCaller, { resource: secondSurface }))
      .resolves.toMatchObject({ operations: [] })
    expect(currentSurface.mock.calls.map(([callerId]) => callerId)).toEqual([
      'thread-1',
      'thread-2',
      'thread-1',
      'thread-2'
    ])
  })

  it('bounds current-surface registrations and reclaims capacity after handle expiry', async () => {
    vi.useFakeTimers()
    try {
      let resourceSequence = 0
      const { dependencies } = createDependencies()
      const broker = new CapabilityBroker(createRegistry({
        ...dependencies,
        visibleContextService: {
          currentSurface: vi.fn(async () => ({
            resourceId: `electron:${resourceSequence++}`,
            workspaceId: '/workspace',
            semanticRevision: 'surface-semantic-1',
            layoutRevision: '12',
            state: {
              layoutFreshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
              targets: [{ targetRef: `target_${'f'.repeat(26)}`, kind: 'window' as const }],
              resources: []
            }
          }))
        }
      }), { handleTtlMs: 5 })
      const caller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }

      for (let index = 0; index < 512; index += 1) {
        await broker.invoke(caller, { actionId: APP_CAPABILITY_IDS.surfaceCurrent, input: {} })
      }
      await expect(broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.surfaceCurrent,
        input: {}
      })).rejects.toMatchObject({ code: 'handler_failed' })

      await vi.advanceTimersByTimeAsync(6)
      await expect(broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.surfaceCurrent,
        input: {}
      })).resolves.toMatchObject({ replayed: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps Workspace Preview discoverable when a visual-file query includes surplus format words', () => {
    const { dependencies } = createDependencies()
    const registry = createRegistry(dependencies)
    const matches = registry.discover({
      audience: 'agent',
      callerId: 'thread-1',
      workspaceId: '/workspace'
    }, {
      text: 'open workspace file image png view',
      limit: 5
    })

    expect(matches.map(({ id }) => id)).toContain(APP_CAPABILITY_IDS.workspacePreviewOpen)
  })

  it('uses the same Workspace Preview provider for UI and agent callers', async () => {
    const { dependencies, open } = createDependencies()
    const broker = new CapabilityBroker(createRegistry(dependencies))
    const input = {
      path: '/workspace/paper.md',
      workspaceRoot: '/workspace',
      workspaceLocator: {
        contractVersion: 1 as const,
        hostSessionId: 'workspace-host-session-1',
        path: '/workspace'
      }
    }

    const uiResult = await broker.invoke({ audience: 'ui', callerId: 'window-1', workspaceId: '/workspace' }, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input
    })
    const agentResult = await broker.invoke({ audience: 'agent', callerId: 'thread-1', workspaceId: '/workspace' }, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input
    })

    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenNthCalledWith(1, input)
    expect(open).toHaveBeenNthCalledWith(2, input)
    expect(capabilityResourceHandleSchema.parse(record(uiResult.output).resource)).toBeTruthy()
    expect(capabilityResourceHandleSchema.parse(record(agentResult.output).resource)).toBeTruthy()
  })

  it('rejects Workspace Preview capacity before allocating another provider session', async () => {
    const { dependencies, open } = createDependencies()
    let identityVersion = 1
    const broker = new CapabilityBroker(createRegistry(dependencies), {
      resolveCurrentPrincipalContext: () => ({ identityVersion, principal: null })
    })
    const previewCaller = { audience: 'ui' as const, callerId: 'window-1', workspaceId: '/workspace' }
    const request = {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    }

    for (identityVersion = 1; identityVersion <= 512; identityVersion += 1) {
      await broker.invoke(previewCaller, request)
    }
    identityVersion = 513
    await expect(broker.invoke(previewCaller, request))
      .rejects.toMatchObject({ code: 'handler_failed' })
    expect(open).toHaveBeenCalledTimes(512)
  })

  it('explicitly shares Workspace Preview resource handles across trusted audiences in one workspace', async () => {
    const { dependencies } = createDependencies()
    const broker = new CapabilityBroker(createRegistry(dependencies))
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

  it('keeps a question-time Workspace Preview session alive after the UI releases it', async () => {
    const { dependencies } = createDependencies()
    const broker = new CapabilityBroker(createRegistry(dependencies))
    const uiCaller = { audience: 'ui' as const, callerId: 'window-1', workspaceId: '/workspace' }
    const agentCaller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(uiCaller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)
    const observed = await broker.observe(agentCaller, { resource: handle })
    const releaseTaskBinding = broker.retainResourceRefs(agentCaller, [observed.resourceRef])

    await broker.invoke(uiCaller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewRelease,
      invocationId: 'release-preview-from-ui',
      resource: handle,
      input: {}
    })

    expect(dependencies.workspacePreviewHost.releaseSession).not.toHaveBeenCalled()
    expect(broker.describeResourceRef(agentCaller, observed.resourceRef)).toMatchObject({
      resourceKind: WORKSPACE_PREVIEW_RESOURCE_KIND,
      resourceRef: observed.resourceRef
    })

    await releaseTaskBinding()
    expect(dependencies.workspacePreviewHost.releaseSession).toHaveBeenCalledWith('preview-1')
    expect(() => broker.describeResourceRef(agentCaller, observed.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    await expect(broker.invoke(uiCaller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })).resolves.toMatchObject({ replayed: false })
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
    const broker = new CapabilityBroker(createRegistry(dependencies))
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
    const broker = new CapabilityBroker(createRegistry(dependencies))
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

  it('routes namespaced domain edits through the same generic broker operation', async () => {
    const { dependencies, applyEdit } = createDependencies()
    const broker = new CapabilityBroker(createRegistry(dependencies))
    const caller = { audience: 'agent' as const, callerId: 'thread-1', workspaceId: '/workspace' }
    const opened = await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
      input: { path: '/workspace/paper.md', workspaceRoot: '/workspace' }
    })
    const handle = capabilityResourceHandleSchema.parse(record(opened.output).resource)
    const observed = await broker.observe(caller, { resource: handle })
    const operation = {
      kind: 'domain.applyEdit' as const,
      path: '/workspace/paper.md',
      operationType: 'materials.replace-site',
      data: { site: 4, element: 'Si' }
    }

    await broker.invoke(caller, {
      actionId: APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
      invocationId: 'domain-edit-1',
      resource: observed.resource,
      expectedRevision: observed.semanticRevision,
      input: { operation }
    })

    expect(applyEdit).toHaveBeenCalledWith('preview-1', operation)
  })

  it('keeps canonical annotation operations discoverable when annotation observation is temporarily unavailable', async () => {
    const { dependencies, observe } = createDependencies()
    const manifest = dependencies.workspacePreviewHost.listPlugins()[0]!
    manifest.capabilities.annotations = true
    observe.mockResolvedValue({
      ok: true as const,
      observation: {
        schemaVersion: 1 as const,
        file: { path: '/workspace/paper.md', workspaceRoot: '/workspace' },
        view: {
          pluginId: 'markdown',
          modality: 'document' as const,
          mode: 'preview' as const,
          title: 'paper.md'
        },
        actions: ['html.previewUrl']
      }
    } as never)
    const registry = createRegistry(dependencies)
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
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsList,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
      APP_CAPABILITY_IDS.workspacePreviewAnnotationsDelete
    ]))
    expect(uiOperations).not.toEqual(expect.arrayContaining([
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
    const broker = new CapabilityBroker(createRegistry(dependencies))
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

})

const contractCallers = {
  ui: { audience: 'ui' as const, callerId: 'contract-ui', workspaceId: '/workspace' },
  agent: { audience: 'agent' as const, callerId: 'contract-agent', workspaceId: '/workspace' },
  system: { audience: 'system' as const, callerId: 'contract-system', workspaceId: '/workspace' }
}

defineCapabilityProviderContractSuite('Workspace Preview', () => {
  const { dependencies, applyEdit } = createDependencies()
  const registry = createRegistry(dependencies)
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
