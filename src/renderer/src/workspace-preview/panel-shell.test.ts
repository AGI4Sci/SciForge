// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type {
  CapabilityResourceBinding,
  SciForgeApi,
  WorkspacePreviewObserveResult,
  WorkspacePreviewOpenInput,
  WorkspacePreviewOpenResult
} from '@shared/sciforge-api'
import {
  DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewExtensionIdSchema,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession
} from '@shared/workspace-preview'
import {
  createWorkspacePreviewHost,
  createWorkspacePreviewHostState,
  type WorkspacePreviewBridgeAdapter,
  type WorkspacePreviewHost
} from './host'
import {
  createRendererWorkspacePreviewRegistry as createRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'
import {
  WorkspacePreviewPanelShell,
  type WorkspacePreviewPanelShellContext,
  workspacePreviewOpenInputForPanelTarget,
  workspacePreviewPanelTargetKey
} from './WorkspacePreviewPanelShell'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function createRendererWorkspacePreviewRegistry(): RendererWorkspacePreviewRegistry {
  return createRegistry({
    registrations: DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => ({
      ownerId: 'test',
      contribution: { manifest, render: () => createElement('div') }
    }))
  })
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
  file: WorkspacePreviewFileState
): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: descriptor.manifest.id,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality: descriptor.manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    mtimeMs: file.mtimeMs
  }
}

const PREVIEW_SHELL_WORKSPACE_ROOT = '/workspace/lab'
const PREVIEW_SHELL_PATH = 'images/sample.png'
const PREVIEW_SHELL_OTHER_PATH = 'images/other.png'

function previewShellFileName(path: string): string {
  return path.split('/').pop() ?? path
}

function createAssetDescriptor(input: {
  sessionId: string
  assetId: string
  path: string
  pluginId: string
  modality: WorkspacePreviewSession['modality']
}): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: input.sessionId,
    assetId: input.assetId,
    pluginId: input.pluginId,
    modality: input.modality,
    file: {
      name: previewShellFileName(input.path),
      relativePath: input.path,
      mimeType: 'image/png',
      size: 64
    },
    primary: 'byte-range',
    eagerRead: { allowed: true, reason: 'Asset fits within the eager read budget.' },
    range: { available: true, maxChunkBytes: 1024, recommendedChunkBytes: 64, size: 64 },
    strategies: [{ kind: 'byte-range', status: 'available', reason: 'Byte ranges are available.' }]
  }
}

function createPreviewShellCapability(
  semanticRevision: string
): CapabilityResourceBinding {
  return {
    resource: {
      token: `cap_${'a'.repeat(26)}`,
      semanticRevision,
      expiresAt: '2026-07-08T01:00:00.000Z'
    },
    resourceRef: `res_${'b'.repeat(26)}`,
    operations: []
  }
}

function createPreviewShellFile(path: string): WorkspacePreviewFileState {
  return {
    workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
    path: `${PREVIEW_SHELL_WORKSPACE_ROOT}/${path}`,
    relativePath: path,
    mimeType: 'image/png',
    size: 64,
    mtimeMs: 1783468800000
  }
}

function createPreviewShellSession(input: {
  id: string
  pluginId: string
  modality: WorkspacePreviewSession['modality']
  path: string
}): WorkspacePreviewSession {
  return {
    id: input.id,
    pluginId: input.pluginId,
    workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
    path: `${PREVIEW_SHELL_WORKSPACE_ROOT}/${input.path}`,
    modality: input.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z'
  }
}

function createPreviewShellObservation(input: {
  path: string
  pluginId: string
  modality: WorkspacePreviewSession['modality']
}): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: `${PREVIEW_SHELL_WORKSPACE_ROOT}/${input.path}`,
      workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
      mimeType: 'image/png',
      size: 64
    },
    view: {
      pluginId: input.pluginId,
      modality: input.modality,
      mode: 'preview',
      title: previewShellFileName(input.path)
    },
    actions: []
  }
}

function createPreviewShellHostHarness(input: {
  registry: RendererWorkspacePreviewRegistry
  capability: CapabilityResourceBinding
}) {
  const resourceContentUrl = vi.fn<SciForgeApi['capabilities']['resourceContentUrl']>(
    (access) => `sciforge-resource://${access.resource.semanticRevision}`
  )
  let capability = input.capability
  let openCount = 0
  let displayedPath = PREVIEW_SHELL_PATH
  let observeOverride: WorkspacePreviewObserveResult | null = null
  let assetOverride: WorkspacePreviewAssetTransportDescriptor | null = null
  let deferredOpen: ((path: string) => WorkspacePreviewOpenResult) | null = null
  let releaseDeferredOpen: (() => void) | null = null

  const currentDescriptor = (): RendererWorkspacePreviewPluginDescriptor =>
    requireDescriptor(input.registry, displayedPath)

  const buildOpenResult = (path: string): WorkspacePreviewOpenResult => {
    const descriptor = requireDescriptor(input.registry, path)
    openCount += 1
    displayedPath = path
    return {
      ok: true,
      session: createPreviewShellSession({
        id: `session-${openCount}`,
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        path
      }),
      manifest: descriptor.manifest,
      route: 'matched',
      file: createPreviewShellFile(path),
      capability
    }
  }

  const bridge = {
    open: async (openInput: WorkspacePreviewOpenInput): Promise<WorkspacePreviewOpenResult> => {
      if (deferredOpen) {
        const build = deferredOpen
        deferredOpen = null
        return await new Promise<WorkspacePreviewOpenResult>((resolve) => {
          releaseDeferredOpen = () => resolve(build(openInput.path))
        })
      }
      return buildOpenResult(openInput.path)
    },
    observe: async (): Promise<WorkspacePreviewObserveResult> => {
      if (observeOverride) {
        const result = observeOverride
        observeOverride = null
        return result
      }
      const descriptor = currentDescriptor()
      return {
        ok: true,
        observation: createPreviewShellObservation({
          path: displayedPath,
          pluginId: descriptor.manifest.id,
          modality: descriptor.manifest.modality
        })
      }
    },
    describeAsset: async (sessionId: string) => {
      const descriptor = currentDescriptor()
      const override = assetOverride
      assetOverride = null
      return {
        ok: true as const,
        descriptor: override ?? createAssetDescriptor({
          sessionId,
          assetId: `${previewShellFileName(displayedPath)}#${openCount}`,
          path: displayedPath,
          pluginId: descriptor.manifest.id,
          modality: descriptor.manifest.modality
        })
      }
    },
    applyEdit: async (_sessionId: string, operation: WorkspacePreviewEditOperation) => {
      const descriptor = currentDescriptor()
      return {
        ok: true as const,
        session: createPreviewShellSession({
          id: `session-${openCount}`,
          pluginId: descriptor.manifest.id,
          modality: descriptor.manifest.modality,
          path: displayedPath
        }),
        operationKind: operation.kind,
        appliedAt: '2026-07-08T00:00:01.000Z',
        audit: {
          pluginId: descriptor.manifest.id,
          path: operation.path,
          operationKind: operation.kind,
          effect: 'session-update' as const
        },
        capability
      }
    },
    releaseSession: async () => true
  } as unknown as WorkspacePreviewBridgeAdapter
  const host = createWorkspacePreviewHost({
    registry: input.registry,
    bridge,
    resourceContentUrl
  })

  return {
    host,
    resourceContentUrl,
    rotateCapability: (next: CapabilityResourceBinding): void => {
      capability = next
    },
    setObservation: (observation: WorkspaceObservation): void => {
      observeOverride = { ok: true, observation }
    },
    failObserve: (message: string): void => {
      observeOverride = { ok: false, message }
    },
    setAsset: (asset: WorkspacePreviewAssetTransportDescriptor): void => {
      assetOverride = asset
    },
    deferNextOpen: (): (() => void) => {
      deferredOpen = (path) => buildOpenResult(path)
      return () => {
        const release = releaseDeferredOpen
        releaseDeferredOpen = null
        release?.()
      }
    }
  }
}

function PreviewShellProbe(input: {
  context: WorkspacePreviewPanelShellContext
  onContext: (context: WorkspacePreviewPanelShellContext) => void
}): ReactElement {
  input.onContext(input.context)
  return createElement('div', { 'data-test-shell-body': 'true' })
}

function previewShellTextEditOperation(): WorkspacePreviewEditOperation {
  return {
    kind: 'text.replaceRange',
    path: `${PREVIEW_SHELL_WORKSPACE_ROOT}/notes.md`,
    range: {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 5 }
    },
    text: 'updated'
  }
}

async function settlePreviewShell(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('WorkspacePreviewPanelShell', () => {
  it('derives stable target keys and host open inputs from legacy file targets', () => {
    const target = {
      path: 'data/samples.csv',
      workspaceRoot: ' /workspace/lab ',
      line: 2,
      column: 4
    }

    expect(workspacePreviewPanelTargetKey(target, '/fallback')).toBe(
      '/workspace/lab\u0000data/samples.csv\u00002\u00004'
    )
    expect(workspacePreviewOpenInputForPanelTarget(target, '/fallback')).toEqual({
      path: 'data/samples.csv',
      workspaceRoot: '/workspace/lab',
      line: 2,
      column: 4
    })
  })

  it('preserves a scientific object selection when opening the full workspace', () => {
    const target = {
      path: 'structures/protein.pdb',
      workspaceRoot: '/workspace/lab',
      selection: {
        kind: 'domain' as const,
        selectionType: workspacePreviewExtensionIdSchema.parse('fixture.preview.selection'),
        data: { selectedIds: ['item-1', 'item-2'] }
      }
    }

    expect(workspacePreviewOpenInputForPanelTarget(target, '/fallback')).toMatchObject({
      path: 'structures/protein.pdb',
      workspaceRoot: '/workspace/lab',
      selection: target.selection
    })
    expect(workspacePreviewPanelTargetKey(target, '/fallback')).toContain('"kind":"domain"')
  })

  it('includes the selected Workspace Host locator in the open input and target identity', () => {
    const target = {
      path: 'structures/protein.pdb',
      workspaceRoot: '/cluster/workspace'
    }
    const workspaceLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'workspace-host-session-1',
      path: '/cluster/workspace'
    }

    expect(workspacePreviewOpenInputForPanelTarget(
      target,
      '/fallback',
      workspaceLocator
    )).toEqual({
      ...target,
      workspaceLocator
    })
    expect(workspacePreviewPanelTargetKey(
      target,
      '/fallback',
      workspaceLocator
    )).toContain('workspace-host-session-1')
  })

  it('preserves a document anchor and integrity expectation in the host open input', () => {
    const target = {
      path: 'reports/evidence.pdf',
      workspaceRoot: '/workspace/lab',
      anchor: {
        kind: 'document' as const,
        page: 4,
        rects: [{ page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
      },
      integrity: {
        algorithm: 'sha256' as const,
        expectedDigest: `sha256:${'a'.repeat(64)}`
      }
    }

    expect(workspacePreviewOpenInputForPanelTarget(target, '/fallback')).toEqual(target)
    expect(workspacePreviewPanelTargetKey(target, '/fallback')).toContain('"kind":"document"')
    expect(workspacePreviewPanelTargetKey(target, '/fallback')).toContain('expectedDigest')
  })

  it('renders unsupported state through shared chrome before the body opens', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const html = renderToStaticMarkup(createElement(
      WorkspacePreviewPanelShell,
      {
        target: { path: 'mesh.vtk', workspaceRoot: '/workspace/lab' },
        workspaceRoot: '/workspace/lab',
        registry
      },
      createElement('div', { 'data-legacy-preview-body': 'true' }, 'Legacy body')
    ))

    expect(html).toContain('data-workspace-preview-chrome')
    expect(html).toContain('data-status="error"')
    expect(html).toContain('Unsupported preview')
    expect(html).toContain('data-legacy-preview-body="true"')
  })

  it('wraps preview body slots without top metadata while keeping inspector hidden by default', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const file: WorkspacePreviewFileState = {
      workspaceRoot: '/workspace/lab',
      path: '/workspace/lab/data/samples.csv',
      relativePath: 'data/samples.csv',
      mimeType: 'text/csv',
      size: 128,
      mtimeMs: 1783468800000
    }
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file,
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'samples.csv'
      },
      tables: [{ id: 'table-1', name: 'samples', rowCount: 3, columnCount: 2 }],
      actions: ['workspace.setSelection', 'tabular.updateCell']
    }
    const state = createWorkspacePreviewHostState({
      session: createSession(descriptor, file),
      descriptor,
      file,
      observation
    })

    const html = renderToStaticMarkup(createElement(
      WorkspacePreviewPanelShell,
      {
        target: { path: 'data/samples.csv', workspaceRoot: '/workspace/lab' },
        workspaceRoot: '/workspace/lab',
        registry,
        initialState: state,
        children: ({ assetStatus }: WorkspacePreviewPanelShellContext) =>
          createElement('div', { 'data-shell-status': assetStatus }, 'Preview body')
      }
    ))

    expect(html).toContain('data-status="ready"')
    expect(html).not.toContain('Workspace preview breadcrumb')
    expect(html).not.toContain('data-action-id="workspace.setSelection"')
    expect(html).not.toContain('data-action-id="tabular.updateCell"')
    expect(html).toContain('data-inspector-open="false"')
    expect(html).not.toContain('Workspace preview inspector')
    expect(html).not.toContain('3 rows x 2 columns')
    expect(html).toContain('data-shell-status="idle"')
  })

  it('keeps the shell context, transport, and openFile stable across ancestor re-renders', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const harness = createPreviewShellHostHarness({
      registry,
      capability: createPreviewShellCapability('revision-1')
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const rendered: WorkspacePreviewPanelShellContext[] = []
    const renderShell = async (
      onOpenFile?: (target: WorkspaceFileTarget) => void
    ): Promise<void> => {
      await act(async () => {
        root.render(createElement(
          WorkspacePreviewPanelShell,
          {
            target: { path: PREVIEW_SHELL_PATH, workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT },
            workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
            registry,
            host: harness.host,
            onOpenFile,
            children: (context: WorkspacePreviewPanelShellContext) =>
              createElement(PreviewShellProbe, {
                context,
                onContext: (next) => rendered.push(next)
              })
          }
        ))
      })
      await settlePreviewShell()
    }

    try {
      const firstOpenFile = vi.fn()
      await renderShell(firstOpenFile)
      const settled = rendered[rendered.length - 1]
      expect(settled.assetStatus).toBe('ready')
      expect(settled.transport.descriptor).not.toBeNull()
      expect(settled.openFile).toEqual(expect.any(Function))

      const secondOpenFile = vi.fn()
      await renderShell(secondOpenFile)
      const reRendered = rendered[rendered.length - 1]

      expect(reRendered).toBe(settled)
      expect(reRendered.state).toBe(settled.state)
      expect(reRendered.transport).toBe(settled.transport)
      expect(reRendered.openFile).toBe(settled.openFile)

      const target: WorkspaceFileTarget = {
        path: 'reports/notes.md',
        workspaceRoot: '/workspace/lab'
      }
      settled.openFile?.(target)
      expect(secondOpenFile).toHaveBeenCalledWith(target)
      expect(firstOpenFile).not.toHaveBeenCalled()

      await renderShell()
      const withoutOpenFile = rendered[rendered.length - 1]
      expect(withoutOpenFile.transport).toBe(settled.transport)
      expect(withoutOpenFile.openFile).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('reuses the asset transport across unrelated host patches and rebuilds it for changed grants and assets', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const harness = createPreviewShellHostHarness({
      registry,
      capability: createPreviewShellCapability('revision-1')
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const rendered: WorkspacePreviewPanelShellContext[] = []

    try {
      await act(async () => {
        root.render(createElement(
          WorkspacePreviewPanelShell,
          {
            target: { path: PREVIEW_SHELL_PATH, workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT },
            workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
            registry,
            host: harness.host,
            children: (context: WorkspacePreviewPanelShellContext) =>
              createElement(PreviewShellProbe, {
                context,
                onContext: (next) => rendered.push(next)
              })
          }
        ))
      })
      await settlePreviewShell()

      const ready = rendered[rendered.length - 1]
      expect(ready.assetStatus).toBe('ready')
      expect(ready.transport.descriptor?.assetId).toBe('sample.png#1')
      expect(ready.transport.sourceUrl).toBe('sciforge-resource://revision-1')

      harness.failObserve('Transient bridge warning.')
      await act(async () => {
        await ready.host.observe()
      })
      const patched = rendered[rendered.length - 1]
      expect(patched).not.toBe(ready)
      expect(patched.state.error).toBe('Transient bridge warning.')
      expect(patched.transport).toBe(ready.transport)

      const rotatedCapability = createPreviewShellCapability('revision-2')
      harness.rotateCapability(rotatedCapability)
      await act(async () => {
        await ready.host.applyEdit(previewShellTextEditOperation())
      })
      const rotated = rendered[rendered.length - 1]
      expect(rotated.state.capability).toEqual(rotatedCapability)
      expect(rotated.transport).not.toBe(ready.transport)
      expect(rotated.transport.descriptor).toBe(ready.transport.descriptor)
      expect(rotated.transport.sourceUrl).toBe('sciforge-resource://revision-2')
      expect(harness.resourceContentUrl).toHaveBeenLastCalledWith({
        workspaceId: PREVIEW_SHELL_WORKSPACE_ROOT,
        resource: rotatedCapability.resource
      })

      const imageDescriptor = requireDescriptor(registry, PREVIEW_SHELL_PATH)
      const nextAsset = createAssetDescriptor({
        sessionId: 'session-1',
        assetId: 'sample.png#refreshed',
        path: PREVIEW_SHELL_PATH,
        pluginId: imageDescriptor.manifest.id,
        modality: imageDescriptor.manifest.modality
      })
      harness.setAsset(nextAsset)
      await act(async () => {
        await ready.host.describeAsset()
      })
      const rebuilt = rendered[rendered.length - 1]
      expect(rebuilt.transport).not.toBe(rotated.transport)
      expect(rebuilt.transport.descriptor).toBe(nextAsset)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps the displayed document alive across a same-document refresh', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const harness = createPreviewShellHostHarness({
      registry,
      capability: createPreviewShellCapability('revision-1')
    })
    const imageDescriptor = requireDescriptor(registry, PREVIEW_SHELL_PATH)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const rendered: WorkspacePreviewPanelShellContext[] = []

    try {
      await act(async () => {
        root.render(createElement(
          WorkspacePreviewPanelShell,
          {
            target: { path: PREVIEW_SHELL_PATH, workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT },
            workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
            registry,
            host: harness.host,
            children: (context: WorkspacePreviewPanelShellContext) =>
              createElement(PreviewShellProbe, {
                context,
                onContext: (next) => rendered.push(next)
              })
          }
        ))
      })
      await settlePreviewShell()

      const ready = rendered[rendered.length - 1]
      expect(ready.assetStatus).toBe('ready')
      expect(ready.state.session?.id).toBe('session-1')
      expect(ready.state.observation).not.toBeNull()
      expect(ready.state.asset).not.toBeNull()

      const refreshedObservation = createPreviewShellObservation({
        path: PREVIEW_SHELL_PATH,
        pluginId: imageDescriptor.manifest.id,
        modality: imageDescriptor.manifest.modality
      })
      harness.setObservation(refreshedObservation)
      const releaseOpen = harness.deferNextOpen()
      const refreshStart = rendered.length
      await act(async () => {
        ready.refresh()
      })
      await settlePreviewShell()

      const duringRefresh = rendered[rendered.length - 1]
      expect(duringRefresh.assetStatus).toBe('loading')
      expect(duringRefresh.state.observation).toBe(ready.state.observation)
      expect(duringRefresh.state.asset).toBe(ready.state.asset)

      await act(async () => {
        releaseOpen()
      })
      await settlePreviewShell()

      const refreshed = rendered[rendered.length - 1]
      expect(refreshed.assetStatus).toBe('ready')
      expect(refreshed.state.session?.id).toBe('session-2')
      expect(refreshed.state.observation).toBe(refreshedObservation)
      expect(refreshed.state.asset?.assetId).toBe('sample.png#2')

      for (const context of rendered.slice(refreshStart)) {
        expect(context.state.observation).not.toBeNull()
        expect(context.state.asset).not.toBeNull()
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('drops the displayed document before a different target opens', async () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const harness = createPreviewShellHostHarness({
      registry,
      capability: createPreviewShellCapability('revision-1')
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const rendered: WorkspacePreviewPanelShellContext[] = []
    const renderShell = async (path: string): Promise<void> => {
      await act(async () => {
        root.render(createElement(
          WorkspacePreviewPanelShell,
          {
            target: { path, workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT },
            workspaceRoot: PREVIEW_SHELL_WORKSPACE_ROOT,
            registry,
            host: harness.host,
            children: (context: WorkspacePreviewPanelShellContext) =>
              createElement(PreviewShellProbe, {
                context,
                onContext: (next) => rendered.push(next)
              })
          }
        ))
      })
      await settlePreviewShell()
    }

    try {
      await renderShell(PREVIEW_SHELL_PATH)
      const ready = rendered[rendered.length - 1]
      expect(ready.assetStatus).toBe('ready')
      const previousObservation = ready.state.observation
      const previousAsset = ready.state.asset
      expect(previousObservation).not.toBeNull()
      expect(previousAsset).not.toBeNull()

      const releaseOpen = harness.deferNextOpen()
      const switchStart = rendered.length
      await renderShell(PREVIEW_SHELL_OTHER_PATH)

      const switched = rendered[rendered.length - 1]
      expect(switched.assetStatus).toBe('loading')
      expect(switched.state.observation).toBeNull()
      expect(switched.state.asset).toBeNull()
      expect(switched.state.file).toBeNull()
      expect(switched.state.session?.id).toBe('session-1')

      for (const context of rendered.slice(switchStart)) {
        expect(context.state.observation).not.toBe(previousObservation)
        expect(context.state.asset).not.toBe(previousAsset)
      }

      await act(async () => {
        releaseOpen()
      })
      await settlePreviewShell()

      const opened = rendered[rendered.length - 1]
      expect(opened.assetStatus).toBe('ready')
      expect(opened.state.session?.id).toBe('session-2')
      expect(opened.state.file?.relativePath).toBe(PREVIEW_SHELL_OTHER_PATH)
      expect(opened.state.asset?.file.relativePath).toBe(PREVIEW_SHELL_OTHER_PATH)
      expect(opened.state.observation).not.toBe(previousObservation)
      expect(opened.state.asset).not.toBe(previousAsset)

      for (const context of rendered.slice(switchStart)) {
        expect(context.state.observation).not.toBe(previousObservation)
        expect(context.state.asset).not.toBe(previousAsset)
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
