// @vitest-environment happy-dom

/**
 * Adversarial verification of the image-preview stability fixes.
 *
 * These tests deliberately do NOT restate the authors' unit tests. They drive the real
 * `WorkspacePreviewPanelShell` + `WorkspacePreviewPluginOutlet` + built-in registry in
 * happy-dom and inject the faults the fixes claim to survive: churning callback and
 * observation identities, reads that settle out of order, reloads that fail, assets that
 * exceed the inline byte budget, transports that arrive late, and target switches.
 *
 * Every assertion is written so a failure prints the observed snapshot (node identity,
 * src, state label, fallback text, read counts) instead of a bare boolean.
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityResourceBinding, SciForgeApi, WorkspacePreviewReadRangeResult } from '@shared/sciforge-api'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewContentKey,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewByteRange,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession
} from '@shared/workspace-preview'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

// The built-in registry pulls every viewer in at module scope. The PDF and DOCX viewers
// import pdfjs-dist, which is irrelevant here and expensive to initialize in happy-dom.
vi.mock('../components/write/WritePdfViewer', () => ({ WritePdfViewer: () => null }))
vi.mock('../components/write/WriteDocxViewer', () => ({ WriteDocxViewer: () => null }))

import {
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHost,
  type WorkspacePreviewBridgeAdapter,
  type WorkspacePreviewHost
} from './host'
import type { RendererWorkspacePreviewRegistry } from './registry'
import { createRendererWorkspacePreviewRegistry } from './registry'
import { createBuiltInWorkspacePreviewPluginRegistrations } from './built-in-plugin-contributions'
import { WorkspacePreviewPluginOutlet } from './WorkspacePreviewPluginOutlet'
import {
  WorkspacePreviewPanelShell,
  type WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import {
  IMAGE_WORKSPACE_VIEWER_MAX_BYTES,
  ImageWorkspaceViewer,
  createImageWorkspaceViewerDataUrl,
  type ImageWorkspaceViewerProps
} from './ImageWorkspaceViewer'
import {
  MarkdownWorkspaceViewer,
  type MarkdownWorkspaceViewerProps
} from './MarkdownWorkspaceViewer'
import type { WriteMarkdownWorkspaceImageLoader } from '../components/write/write-markdown-image-cache'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const WORKSPACE_ROOT = '/workspace/preview-stability'
const SESSION_ID = 'session-preview-stability'
const IMAGE_NAME = 'cell.png'
const IMAGE_PATH = `${WORKSPACE_ROOT}/images/${IMAGE_NAME}`
const OTHER_NAME = 'other.png'
const OTHER_PATH = `${WORKSPACE_ROOT}/images/${OTHER_NAME}`

const builtInPreviewRegistry: RendererWorkspacePreviewRegistry =
  createRendererWorkspacePreviewRegistry({
    registrations: createBuiltInWorkspacePreviewPluginRegistrations()
  })

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  for (const mounted of mountedRoots.splice(0)) {
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

function mountContainer(): { container: HTMLDivElement; root: Root } {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  return { container, root }
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function bytesFor(token: string): Uint8Array {
  return new TextEncoder().encode(token.padEnd(64, '.'))
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function imageObservation(overrides: {
  path?: string
  mtimeMs?: number
  size?: number
} = {}): WorkspaceObservation {
  const path = overrides.path ?? IMAGE_PATH
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path,
      workspaceRoot: WORKSPACE_ROOT,
      mimeType: 'image/png',
      size: overrides.size ?? 64,
      mtimeMs: overrides.mtimeMs ?? 1000
    },
    view: {
      pluginId: 'image',
      modality: 'image',
      mode: 'preview',
      title: path.split('/').at(-1) ?? IMAGE_NAME
    },
    actions: []
  }
}

function imageAsset(overrides: {
  assetId?: string
  name?: string
  size?: number
  recommendedChunkBytes?: number
} = {}): WorkspacePreviewAssetTransportDescriptor {
  const size = overrides.size ?? 64
  const name = overrides.name ?? IMAGE_NAME
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: SESSION_ID,
    assetId: overrides.assetId ?? 'asset-cell',
    pluginId: 'image',
    modality: 'image',
    file: {
      name,
      relativePath: `images/${name}`,
      mimeType: 'image/png',
      size
    },
    primary: 'byte-range',
    eagerRead: { allowed: true, reason: 'Asset fits within the eager read budget.' },
    range: {
      available: true,
      maxChunkBytes: 1024,
      recommendedChunkBytes: overrides.recommendedChunkBytes ?? Math.min(size, 1024),
      size
    },
    strategies: [{ kind: 'byte-range', status: 'available', reason: 'Byte ranges are available.' }]
  }
}

function previewCapability(semanticRevision = 'revision-1'): CapabilityResourceBinding {
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

type ReadInstruction =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'fail'; message: string }
  | { kind: 'deferred' }

type PreviewHarness = {
  registry: RendererWorkspacePreviewRegistry
  host: WorkspacePreviewHost
  readCalls: Array<{ sessionId: string; range: WorkspacePreviewByteRange }>
  readCallCount: () => number
  pendingReadCount: () => number
  invokeActionCalls: Array<{ sessionId: string; actionId: string }>
  setObservation: (next: WorkspaceObservation) => void
  getObservation: () => WorkspaceObservation
  setAsset: (next: WorkspacePreviewAssetTransportDescriptor) => void
  resolveDeferredRead: (index: number, bytes: Uint8Array) => void
  failDeferredRead: (index: number, message: string) => void
  deferNextOpen: () => void
  resolveOpen: () => void
  failNextOpen: (message: string) => void
}

/**
 * Real `WorkspacePreviewHost` over a fake bridge. Every `observe`/`describeAsset` call
 * returns a freshly deserialized object, exactly like the IPC bridge does, so host state
 * patches always carry new object identities.
 */
function createPreviewHarness(input: {
  registry: RendererWorkspacePreviewRegistry
  observation: WorkspaceObservation
  asset: WorkspacePreviewAssetTransportDescriptor
  readScript?: ReadInstruction[]
  defaultBytes?: Uint8Array
  markdownImageDataUrl?: string
}): PreviewHarness {
  const pluginId = input.observation.view.pluginId
  const descriptor = input.registry.get(pluginId)
  if (!descriptor) throw new Error(`The built-in ${pluginId} preview plugin is not registered.`)

  let observation = input.observation
  let asset = input.asset
  let capability = previewCapability()
  const readScript = [...(input.readScript ?? [])]
  let scriptIndex = 0
  const readCalls: PreviewHarness['readCalls'] = []
  const invokeActionCalls: PreviewHarness['invokeActionCalls'] = []
  const deferredReads: Array<{
    sessionId: string
    range: WorkspacePreviewByteRange
    resolve: (result: WorkspacePreviewReadRangeResult) => void
  }> = []
  let openDeferred: { promise: Promise<void>; resolve: () => void } | null = null
  let openFailureMessage: string | null = null

  const session = (): WorkspacePreviewSession => ({
    id: SESSION_ID,
    pluginId,
    workspaceRoot: WORKSPACE_ROOT,
    path: observation.file.path,
    modality: observation.view.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z'
  })
  const file = (): WorkspacePreviewFileState => ({
    workspaceRoot: WORKSPACE_ROOT,
    path: observation.file.path,
    relativePath: observation.file.path.replace(`${WORKSPACE_ROOT}/`, ''),
    mimeType: observation.file.mimeType ?? 'image/png',
    size: observation.file.size ?? 64,
    mtimeMs: observation.file.mtimeMs ?? 1000
  })

  const readRangeResult = (
    sessionId: string,
    range: WorkspacePreviewByteRange,
    bytes: Uint8Array
  ): WorkspacePreviewReadRangeResult => {
    const chunk = bytes.subarray(range.offset, range.offset + range.length)
    return {
      ok: true,
      sessionId,
      assetId: asset.assetId,
      offset: range.offset,
      length: range.length,
      size: range.length,
      dataBase64: base64Of(chunk),
      mimeType: 'image/png'
    }
  }

  const bridge = {
    open: async () => {
      if (openDeferred) await openDeferred.promise
      if (openFailureMessage) {
        const message = openFailureMessage
        openFailureMessage = null
        return { ok: false as const, message }
      }
      return {
        ok: true as const,
        session: session(),
        manifest: descriptor.manifest,
        route: 'matched' as const,
        file: file(),
        capability
      }
    },
    observe: async () => ({ ok: true as const, observation: cloneValue(observation) }),
    describeAsset: async () => ({ ok: true as const, descriptor: cloneValue(asset) }),
    applyEdit: async (_sessionId: string, operation: WorkspacePreviewEditOperation) => ({
      ok: true as const,
      session: session(),
      operationKind: operation.kind,
      appliedAt: '2026-07-08T00:00:01.000Z',
      audit: {
        pluginId: descriptor.manifest.id,
        path: operation.path,
        operationKind: operation.kind,
        effect: 'session-update' as const
      },
      capability
    }),
    releaseSession: async () => true,
    invokeAction: async (sessionId: string, action: { actionId: string }) => {
      invokeActionCalls.push({ sessionId, actionId: action.actionId })
      return {
        ok: true as const,
        sessionId,
        pluginId,
        actionId: action.actionId,
        invokedAt: '2026-07-08T00:00:01.000Z',
        result: { dataUrl: input.markdownImageDataUrl ?? '' },
        audit: {
          pluginId,
          path: observation.file.path,
          actionId: action.actionId,
          effect: 'host-action' as const
        }
      }
    },
    readRange: (sessionId: string, range: WorkspacePreviewByteRange) => {
      readCalls.push({ sessionId, range })
      const instruction = readScript[scriptIndex]
      scriptIndex += 1
      if (instruction?.kind === 'fail') {
        return Promise.resolve<WorkspacePreviewReadRangeResult>({ ok: false, message: instruction.message })
      }
      if (instruction?.kind === 'deferred') {
        return new Promise<WorkspacePreviewReadRangeResult>((resolve) => {
          deferredReads.push({ sessionId, range, resolve })
        })
      }
      const bytes = instruction?.kind === 'bytes' ? instruction.bytes : input.defaultBytes ?? bytesFor('cell')
      return Promise.resolve(readRangeResult(sessionId, range, bytes))
    }
  } as unknown as WorkspacePreviewBridgeAdapter

  const host = createWorkspacePreviewHost({
    registry: input.registry,
    bridge,
    resourceContentUrl: (
      access: Parameters<SciForgeApi['capabilities']['resourceContentUrl']>[0]
    ) => `sciforge-resource://${access.resource.semanticRevision}`
  })

  return {
    registry: input.registry,
    host,
    readCalls,
    readCallCount: () => readCalls.length,
    pendingReadCount: () => deferredReads.length,
    invokeActionCalls,
    setObservation: (next) => {
      observation = next
    },
    getObservation: () => observation,
    setAsset: (next) => {
      asset = next
    },
    resolveDeferredRead: (index, bytes) => {
      const deferred = deferredReads[index]
      if (!deferred) throw new Error(`No deferred read at index ${index}.`)
      deferred.resolve(readRangeResult(deferred.sessionId, deferred.range, bytes))
    },
    failDeferredRead: (index, message) => {
      const deferred = deferredReads[index]
      if (!deferred) throw new Error(`No deferred read at index ${index}.`)
      deferred.resolve({ ok: false, message })
    },
    deferNextOpen: () => {
      let resolveOpen: () => void = () => undefined
      const promise = new Promise<void>((resolve) => {
        resolveOpen = resolve
      })
      openDeferred = { promise, resolve: resolveOpen }
    },
    resolveOpen: () => {
      const deferred = openDeferred
      openDeferred = null
      deferred?.resolve()
    },
    failNextOpen: (message) => {
      openFailureMessage = message
    }
  }
}

type CommitEntry = {
  previewState: string | null
  imgCount: number
  fallbackSummary: boolean
  loadingSummary: boolean
  previousBytesVisible: boolean
}

/**
 * Commit-level ledger. MutationObserver callbacks run after React has committed, so every
 * entry describes a DOM state that actually reached the document rather than a snapshot the
 * test happened to sample. `forbiddenSrc` is checked on every entry so a stale frame cannot
 * hide between two samples.
 */
function startCommitLedger(container: HTMLElement, forbiddenSrc?: string): {
  entries: CommitEntry[]
  stop: () => void
} {
  const entries: CommitEntry[] = []
  const record = (): void => {
    entries.push({
      previewState: container
        .querySelector('[data-workspace-preview-image-viewer]')
        ?.getAttribute('data-image-preview-state') ?? null,
      imgCount: container.querySelectorAll('[data-image-preview-img]').length,
      fallbackSummary: container.querySelector('[data-image-fallback-summary]') !== null,
      loadingSummary: container.querySelector('[data-image-loading-summary]') !== null,
      previousBytesVisible: forbiddenSrc ? container.innerHTML.includes(forbiddenSrc) : false
    })
  }
  const observer = new MutationObserver(record)
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-image-preview-state']
  })
  return {
    entries,
    stop: () => {
      observer.disconnect()
      record()
    }
  }
}

/** Collapses the ledger to the facts the tests assert, so diffs stay readable. */
function summarizeLedger(entries: readonly CommitEntry[]): {
  statesSeen: string[]
  everShowedPreviousBytes: boolean
  everShowedFallbackMarker: boolean
  everShowedTerminalFallback: boolean
  everShowedLoadingMarker: boolean
  everLostTheFrame: boolean
} {
  return {
    statesSeen: [...new Set(entries.map((entry) => entry.previewState ?? 'none'))],
    everShowedPreviousBytes: entries.some((entry) => entry.previousBytesVisible),
    // The marker is also reused by the in-flight read state (title "Loading image"), so a
    // terminal fallback is the stronger signal that the viewer gave up on this content key.
    everShowedFallbackMarker: entries.some((entry) => entry.fallbackSummary),
    everShowedTerminalFallback: entries.some(
      (entry) => entry.fallbackSummary && entry.previewState === 'fallback'
    ),
    everShowedLoadingMarker: entries.some((entry) => entry.loadingSummary),
    everLostTheFrame: entries.some((entry) => entry.imgCount === 0)
  }
}

type PreviewSnapshot = {
  img: HTMLImageElement | null
  imgSrc: string | null
  previewState: string | null
  assetStatus: string | null
  fallbackText: string | null
}

function previewSnapshot(container: HTMLElement): PreviewSnapshot {
  return {
    img: container.querySelector<HTMLImageElement>('[data-image-preview-img]'),
    imgSrc: container.querySelector('[data-image-preview-img]')?.getAttribute('src') ?? null,
    previewState: container
      .querySelector('[data-workspace-preview-image-viewer]')
      ?.getAttribute('data-image-preview-state') ?? null,
    assetStatus: container
      .querySelector('[data-workspace-preview-panel-shell]')
      ?.getAttribute('data-asset-status') ?? null,
    fallbackText: container.querySelector('[data-image-fallback-summary]')?.textContent ?? null
  }
}

/** Shell + outlet mount that can be re-rendered with brand-new prop identities. */
function mountPreviewPanel(input: {
  container: HTMLElement
  root: Root
  host: WorkspacePreviewHost
  targetPath?: string
}): {
  renderShell: (overrides?: {
    targetPath?: string
    targetLine?: number
    onOpenFile?: (target: WorkspaceFileTarget) => void
    className?: string
  }) => Promise<void>
  contexts: WorkspacePreviewPanelShellContext[]
  renderCount: () => number
} {
  const contexts: WorkspacePreviewPanelShellContext[] = []
  let renderCount = 0

  return {
    contexts,
    renderCount: () => renderCount,
    renderShell: async (overrides = {}) => {
      await act(async () => {
        input.root.render(createElement(
          WorkspacePreviewPanelShell,
          {
            target: {
              path: overrides.targetPath ?? input.targetPath ?? IMAGE_PATH,
              workspaceRoot: WORKSPACE_ROOT,
              ...(overrides.targetLine != null ? { line: overrides.targetLine } : {})
            },
            workspaceRoot: WORKSPACE_ROOT,
            registry: builtInPreviewRegistry,
            host: input.host,
            onOpenFile: overrides.onOpenFile ?? (() => undefined),
            className: overrides.className ?? 'h-full',
            children: (context: WorkspacePreviewPanelShellContext): ReactNode => {
              renderCount += 1
              contexts.push(context)
              return createElement(WorkspacePreviewPluginOutlet, {
                context,
                routeReason: 'registered-plugin',
                rendererRegistry: builtInPreviewRegistry
              })
            }
          }
        ))
      })
      await flushAsyncWork()
    }
  }
}

/**
 * Churn helper: a brand-new `onOpenFile`/`className` pair plus, unless disabled, a fresh
 * deep-equal observation and asset through the host. This is what an ancestor re-render
 * storm plus the 1 Hz development-contribution poll used to produce.
 */
async function churnPanel(input: {
  panel: ReturnType<typeof mountPreviewPanel>
  harness: PreviewHarness
  step: number
  patchHost: boolean
}): Promise<void> {
  if (input.patchHost) {
    const observation = input.harness.getObservation()
    await act(async () => {
      await input.harness.host.observe(SESSION_ID)
      await input.harness.host.describeAsset(SESSION_ID)
      await Promise.resolve()
    })
    // The bridge returns a fresh copy, so the host state must not keep the old object.
    expect(input.harness.getObservation()).toBe(observation)
    expect(input.panel.contexts.at(-1)?.state.observation).not.toBe(observation)
  }
  await input.panel.renderShell({
    onOpenFile: vi.fn(),
    className: `re-render-${input.step}`
  })
}

describe('image preview stability through the real panel shell', () => {
  it('keeps one <img> node, one byte-identical src, and one transport read across 6 forced re-renders', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      defaultBytes: bytesFor('cell')
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })

    const settled = previewSnapshot(container)
    const expectedSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    expect({
      step: 'initial settle',
      src: settled.imgSrc,
      previewState: settled.previewState,
      assetStatus: settled.assetStatus,
      fallbackText: settled.fallbackText,
      reads: harness.readCallCount()
    }).toEqual({
      step: 'initial settle',
      src: expectedSrc,
      previewState: 'ready',
      assetStatus: 'ready',
      fallbackText: null,
      reads: 1
    })
    const node = settled.img
    expect(node).not.toBeNull()
    expect(node?.getAttribute('data-image-bytes-read')).toBe('64')
    expect(panel.contexts.at(-1)?.transport.descriptor?.assetId).toBe('asset-cell')

    // Six forced re-renders: three pure ancestor churn, three host patches that replace the
    // observation (and asset) objects while the content identity stays the same.
    for (let step = 1; step <= 6; step += 1) {
      await churnPanel({ panel, harness, step, patchHost: step % 2 === 0 })
      const snapshot = previewSnapshot(container)
      expect({
        step,
        sameNode: snapshot.img === node,
        src: snapshot.imgSrc,
        previewState: snapshot.previewState,
        assetStatus: snapshot.assetStatus,
        fallbackText: snapshot.fallbackText,
        reads: harness.readCallCount()
      }).toEqual({
        step,
        sameNode: true,
        src: expectedSrc,
        previewState: 'ready',
        assetStatus: 'ready',
        fallbackText: null,
        reads: 1
      })
    }

    expect(panel.renderCount()).toBeGreaterThanOrEqual(6)
    expect(harness.readCalls).toHaveLength(1)
    expect(harness.readCalls[0]?.range).toEqual({ offset: 0, length: 64 })
  })
})

describe('image preview fault injection through the real panel shell', () => {
  it('(a) drops a read that resolves after the viewer moved on to a newer content key', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('first') },
        { kind: 'deferred' },
        { kind: 'bytes', bytes: bytesFor('newest') }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const firstSrc = createImageWorkspaceViewerDataUrl(bytesFor('first'), 'image/png')
    const node = previewSnapshot(container).img
    expect({ src: previewSnapshot(container).imgSrc, reads: harness.readCallCount() })
      .toEqual({ src: firstSrc, reads: 1 })

    // Same path, new revision through the observation patch only: key changes, reload starts.
    harness.setObservation(imageObservation({ mtimeMs: 2000 }))
    await act(async () => {
      await harness.host.observe(SESSION_ID)
    })
    await flushAsyncWork()
    expect({
      state: 'refreshing window',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      reads: harness.readCallCount()
    }).toEqual({
      state: 'refreshing window',
      sameNode: true,
      src: firstSrc,
      previewState: 'refreshing',
      fallbackText: null,
      reads: 2
    })

    // A third revision appears while the second read is still in flight and settles first.
    harness.setObservation(imageObservation({ mtimeMs: 3000 }))
    await act(async () => {
      await harness.host.observe(SESSION_ID)
    })
    await flushAsyncWork()
    const newestSrc = createImageWorkspaceViewerDataUrl(bytesFor('newest'), 'image/png')
    expect({
      state: 'newest settled',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      reads: harness.readCallCount()
    }).toEqual({
      state: 'newest settled',
      sameNode: true,
      src: newestSrc,
      previewState: 'ready',
      reads: 3
    })

    // Now the superseded read finally resolves. It must not overwrite the newer frame.
    expect(harness.pendingReadCount()).toBe(1)
    await act(async () => {
      harness.resolveDeferredRead(0, bytesFor('stale'))
      await Promise.resolve()
    })
    await flushAsyncWork()

    const staleSrc = createImageWorkspaceViewerDataUrl(bytesFor('stale'), 'image/png')
    expect({
      state: 'stale read resolved',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      staleBytesPresent: container.innerHTML.includes(staleSrc),
      reads: harness.readCallCount()
    }).toEqual({
      state: 'stale read resolved',
      sameNode: true,
      src: newestSrc,
      previewState: 'ready',
      fallbackText: null,
      staleBytesPresent: false,
      reads: 3
    })
  })

  it('(b) does not start a second in-flight read for the same key while the first read is pending', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [{ kind: 'deferred' }]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    expect({
      state: 'first read pending',
      reads: harness.readCallCount(),
      pending: harness.pendingReadCount(),
      img: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState
    }).toEqual({
      state: 'first read pending',
      reads: 1,
      pending: 1,
      img: null,
      previewState: 'loading'
    })

    for (let step = 1; step <= 5; step += 1) {
      await churnPanel({ panel, harness, step, patchHost: step % 2 === 0 })
      expect({
        step,
        reads: harness.readCallCount(),
        pending: harness.pendingReadCount(),
        previewState: previewSnapshot(container).previewState
      }).toEqual({ step, reads: 1, pending: 1, previewState: 'loading' })
    }

    await act(async () => {
      harness.resolveDeferredRead(0, bytesFor('cell'))
      await Promise.resolve()
    })
    await flushAsyncWork()

    expect({
      state: 'first read settled',
      reads: harness.readCallCount(),
      pending: harness.pendingReadCount(),
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText
    }).toEqual({
      state: 'first read settled',
      reads: 1,
      pending: 1,
      src: createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png'),
      previewState: 'ready',
      fallbackText: null
    })
  })

  it('(c) shows the new file and never the previous file bytes after a target switch', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('cell') },
        { kind: 'bytes', bytes: bytesFor('other') }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const cellSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    expect(previewSnapshot(container).imgSrc).toBe(cellSrc)

    harness.setObservation(imageObservation({ path: OTHER_PATH }))
    harness.setAsset(imageAsset({ assetId: 'asset-other', name: OTHER_NAME }))
    await panel.renderShell({
      targetPath: OTHER_PATH,
      onOpenFile: vi.fn(),
      className: 'switched'
    })

    const otherSrc = createImageWorkspaceViewerDataUrl(bytesFor('other'), 'image/png')
    expect({
      state: 'after target switch',
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      assetStatus: previewSnapshot(container).assetStatus,
      fallbackText: previewSnapshot(container).fallbackText,
      previousBytesPresent: container.innerHTML.includes(cellSrc),
      reads: harness.readCallCount()
    }).toEqual({
      state: 'after target switch',
      src: otherSrc,
      previewState: 'ready',
      assetStatus: 'ready',
      fallbackText: null,
      previousBytesPresent: false,
      reads: 2
    })
  })

  it('(c-strict) does not keep rendering the previous file while the new target is opening', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('cell') },
        { kind: 'bytes', bytes: bytesFor('other') }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const cellSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    expect(previewSnapshot(container).imgSrc).toBe(cellSrc)

    // Commit-level ledger: the previous file's bytes must not reach the document on ANY
    // commit between the target change and the new file settling.
    const ledger = startCommitLedger(container, cellSrc)

    // The bridge open is in flight: the shell has already dropped the previous document's
    // observation/asset and reports assetStatus 'loading'.
    harness.deferNextOpen()
    harness.setObservation(imageObservation({ path: OTHER_PATH }))
    harness.setAsset(imageAsset({ assetId: 'asset-other', name: OTHER_NAME }))
    await panel.renderShell({
      targetPath: OTHER_PATH,
      onOpenFile: vi.fn(),
      className: 'switched-pending'
    })

    const pending = previewSnapshot(container)
    expect({
      state: 'new target still opening',
      previousBytesVisible: container.innerHTML.includes(cellSrc),
      imgSrc: pending.imgSrc,
      previewState: pending.previewState,
      assetStatus: pending.assetStatus,
      fallbackSummary: container.querySelector('[data-image-fallback-summary]') !== null,
      loadingSummary: container.querySelector('[data-image-loading-summary]') !== null
    }).toEqual({
      state: 'new target still opening',
      previousBytesVisible: false,
      imgSrc: null,
      previewState: 'loading',
      assetStatus: 'loading',
      fallbackSummary: false,
      loadingSummary: true
    })

    await act(async () => {
      harness.resolveOpen()
      await Promise.resolve()
    })
    await flushAsyncWork()
    ledger.stop()

    const otherSrc = createImageWorkspaceViewerDataUrl(bytesFor('other'), 'image/png')
    expect({
      state: 'new target settled',
      src: previewSnapshot(container).imgSrc,
      previousBytesPresent: container.innerHTML.includes(cellSrc),
      previewState: previewSnapshot(container).previewState,
      ledger: summarizeLedger(ledger.entries)
    }).toEqual({
      state: 'new target settled',
      src: otherSrc,
      previousBytesPresent: false,
      previewState: 'ready',
      ledger: {
        statesSeen: ['loading', 'ready'],
        everShowedPreviousBytes: false,
        // The new document has no frame yet, so the in-flight byte read renders its
        // "Loading image" summary through the legacy fallback marker. It is never terminal.
        everShowedFallbackMarker: true,
        everShowedTerminalFallback: false,
        everShowedLoadingMarker: true,
        everLostTheFrame: true
      }
    })
  })

  it('(d) does not retry the read after a terminal failure and keeps showing the failure message', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [{ kind: 'fail', message: 'Asset read failed.' }],
      defaultBytes: bytesFor('cell')
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const failed = previewSnapshot(container)
    expect({
      state: 'failed read settled',
      reads: harness.readCallCount(),
      img: failed.imgSrc,
      previewState: failed.previewState,
      fallbackText: failed.fallbackText
    }).toEqual({
      state: 'failed read settled',
      reads: 1,
      img: null,
      previewState: 'fallback',
      fallbackText: 'Image bytes unavailableAsset read failed.'
    })

    for (let step = 1; step <= 5; step += 1) {
      await churnPanel({ panel, harness, step, patchHost: step % 2 === 0 })
      const snapshot = previewSnapshot(container)
      expect({
        step,
        reads: harness.readCallCount(),
        img: snapshot.imgSrc,
        previewState: snapshot.previewState,
        fallbackText: snapshot.fallbackText
      }).toEqual({
        step,
        reads: 1,
        img: null,
        previewState: 'fallback',
        fallbackText: 'Image bytes unavailableAsset read failed.'
      })
    }
  })

  it('(d-limit) shows the byte-limit message for an oversized asset without reading it', async () => {
    const oversized = IMAGE_WORKSPACE_VIEWER_MAX_BYTES + 1
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation({ size: oversized }),
      asset: imageAsset({
        assetId: 'asset-huge',
        size: oversized,
        recommendedChunkBytes: 1024
      }),
      defaultBytes: bytesFor('cell')
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const limited = previewSnapshot(container)
    expect({
      state: 'oversized asset settled',
      reads: harness.readCallCount(),
      img: limited.imgSrc,
      previewState: limited.previewState,
      fallbackText: limited.fallbackText,
      mentionsLimit: limited.fallbackText?.includes('inline image preview is limited to') ?? false
    }).toEqual({
      state: 'oversized asset settled',
      reads: 0,
      img: null,
      previewState: 'fallback',
      fallbackText: 'Image bytes unavailableThis image is 50.0 MB; inline image preview is limited to 50.0 MB.',
      mentionsLimit: true
    })

    for (let step = 1; step <= 5; step += 1) {
      await churnPanel({ panel, harness, step, patchHost: step % 2 === 0 })
      const snapshot = previewSnapshot(container)
      expect({
        step,
        reads: harness.readCallCount(),
        img: snapshot.imgSrc,
        previewState: snapshot.previewState,
        fallbackText: snapshot.fallbackText
      }).toEqual({
        step,
        reads: 0,
        img: null,
        previewState: 'fallback',
        fallbackText: 'Image bytes unavailableThis image is 50.0 MB; inline image preview is limited to 50.0 MB.'
      })
    }
  })

  it('(f) clears the previous revision pixels and renders the real message when a same-path reload fails', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('first') },
        { kind: 'deferred' }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const firstSrc = createImageWorkspaceViewerDataUrl(bytesFor('first'), 'image/png')
    const node = previewSnapshot(container).img
    expect({ src: previewSnapshot(container).imgSrc, reads: harness.readCallCount() })
      .toEqual({ src: firstSrc, reads: 1 })

    harness.setObservation(imageObservation({ mtimeMs: 2000 }))
    await act(async () => {
      await harness.host.observe(SESSION_ID)
    })
    await flushAsyncWork()

    // While the same-path reload is in flight the old frame stays mounted on purpose.
    expect({
      state: 'reload in flight',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      reads: harness.readCallCount()
    }).toEqual({
      state: 'reload in flight',
      sameNode: true,
      src: firstSrc,
      previewState: 'refreshing',
      fallbackText: null,
      reads: 2
    })

    await act(async () => {
      harness.failDeferredRead(0, 'Asset read failed.')
      await Promise.resolve()
    })
    await flushAsyncWork()

    const failed = previewSnapshot(container)
    expect({
      state: 'reload failed',
      img: failed.imgSrc,
      previewState: failed.previewState,
      previousRevisionPixelsPresent: container.innerHTML.includes(firstSrc),
      fallbackText: failed.fallbackText
    }).toEqual({
      state: 'reload failed',
      img: null,
      previewState: 'fallback',
      previousRevisionPixelsPresent: false,
      fallbackText: 'Image bytes unavailableAsset read failed.'
    })
  })
})

describe('round-2 adversarial cases: refresh, re-anchor, and mid-read target switches', () => {
  it('(h) a same-path refresh whose bytes changed keeps the old frame during the read, then swaps in place', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('first') },
        { kind: 'deferred' }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const firstSrc = createImageWorkspaceViewerDataUrl(bytesFor('first'), 'image/png')
    const node = previewSnapshot(container).img
    expect({ src: previewSnapshot(container).imgSrc, reads: harness.readCallCount() })
      .toEqual({ src: firstSrc, reads: 1 })

    const ledger = startCommitLedger(container)
    // The file changed on disk: the next observe reports a new mtime, so the refresh must
    // re-read bytes while keeping the previous revision's frame on screen.
    harness.setObservation(imageObservation({ mtimeMs: 2000 }))
    await act(async () => {
      panel.contexts.at(-1)?.refresh()
    })
    await flushAsyncWork()

    expect({
      state: 'changed bytes still loading',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      reads: harness.readCallCount(),
      pendingReads: harness.pendingReadCount()
    }).toEqual({
      state: 'changed bytes still loading',
      sameNode: true,
      src: firstSrc,
      previewState: 'refreshing',
      fallbackText: null,
      reads: 2,
      pendingReads: 1
    })

    const secondSrc = createImageWorkspaceViewerDataUrl(bytesFor('second'), 'image/png')
    await act(async () => {
      harness.resolveDeferredRead(0, bytesFor('second'))
      await Promise.resolve()
    })
    await flushAsyncWork()
    ledger.stop()

    expect({
      state: 'changed bytes settled',
      sameNode: previewSnapshot(container).img === node,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      secondBytesVisible: container.innerHTML.includes(secondSrc),
      ledger: summarizeLedger(ledger.entries),
      reads: harness.readCallCount()
    }).toEqual({
      state: 'changed bytes settled',
      sameNode: true,
      src: secondSrc,
      previewState: 'ready',
      fallbackText: null,
      secondBytesVisible: true,
      ledger: {
        statesSeen: ['refreshing', 'ready'],
        everShowedPreviousBytes: false,
        everShowedFallbackMarker: false,
        everShowedTerminalFallback: false,
        everShowedLoadingMarker: false,
        everLostTheFrame: false
      },
      reads: 2
    })
  })

  it('(i) a line-only target change on the same file must not reset the view or re-read bytes', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      defaultBytes: bytesFor('cell')
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const cellSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    const node = previewSnapshot(container).img
    expect(previewSnapshot(container).imgSrc).toBe(cellSrc)

    const ledger = startCommitLedger(container)
    // Same path, different line: document identity is unchanged, so the frame must survive.
    await panel.renderShell({
      targetLine: 42,
      onOpenFile: vi.fn(),
      className: 'line-change'
    })
    await flushAsyncWork()
    ledger.stop()

    expect({
      state: 'line-only change',
      sameNode: previewSnapshot(container).img === node,
      capturedNodeConnected: node?.isConnected ?? null,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      assetStatus: previewSnapshot(container).assetStatus,
      ledger: summarizeLedger(ledger.entries),
      reads: harness.readCallCount()
    }).toEqual({
      state: 'line-only change',
      sameNode: true,
      capturedNodeConnected: true,
      src: cellSrc,
      previewState: 'ready',
      fallbackText: null,
      assetStatus: 'ready',
      ledger: {
        statesSeen: ['refreshing', 'ready'],
        everShowedPreviousBytes: false,
        everShowedFallbackMarker: false,
        everShowedTerminalFallback: false,
        everShowedLoadingMarker: false,
        everLostTheFrame: false
      },
      reads: 1
    })
  })

  it('(j) switching target while the previous document read is in flight never shows the stale bytes', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'deferred' },
        { kind: 'bytes', bytes: bytesFor('other') }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    expect({
      state: 'first document read pending',
      reads: harness.readCallCount(),
      pending: harness.pendingReadCount(),
      img: previewSnapshot(container).imgSrc
    }).toEqual({ state: 'first document read pending', reads: 1, pending: 1, img: null })

    const pendingSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    harness.deferNextOpen()
    harness.setObservation(imageObservation({ path: OTHER_PATH }))
    harness.setAsset(imageAsset({ assetId: 'asset-other', name: OTHER_NAME }))
    await panel.renderShell({
      targetPath: OTHER_PATH,
      onOpenFile: vi.fn(),
      className: 'switched-while-reading'
    })

    expect({
      state: 'switch pending',
      img: previewSnapshot(container).imgSrc,
      previousBytesVisible: container.innerHTML.includes(pendingSrc),
      previewState: previewSnapshot(container).previewState
    }).toEqual({
      state: 'switch pending',
      img: null,
      previousBytesVisible: false,
      previewState: 'loading'
    })

    // The superseded document's bytes arrive after the switch. They must be dropped.
    await act(async () => {
      harness.resolveDeferredRead(0, bytesFor('cell'))
      await Promise.resolve()
    })
    await flushAsyncWork()

    expect({
      state: 'stale read resolved after switch',
      img: previewSnapshot(container).imgSrc,
      previousBytesVisible: container.innerHTML.includes(pendingSrc),
      previewState: previewSnapshot(container).previewState
    }).toEqual({
      state: 'stale read resolved after switch',
      img: null,
      previousBytesVisible: false,
      previewState: 'loading'
    })

    await act(async () => {
      harness.resolveOpen()
      await Promise.resolve()
    })
    await flushAsyncWork()

    const otherSrc = createImageWorkspaceViewerDataUrl(bytesFor('other'), 'image/png')
    expect({
      state: 'new document settled',
      src: previewSnapshot(container).imgSrc,
      previousBytesVisible: container.innerHTML.includes(pendingSrc),
      previewState: previewSnapshot(container).previewState,
      reads: harness.readCallCount()
    }).toEqual({
      state: 'new document settled',
      src: otherSrc,
      previousBytesVisible: false,
      previewState: 'ready',
      reads: 2
    })
  })

  it('(k) a same-path refresh whose new revision fails to read drops the old pixels and shows the message', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('first') },
        { kind: 'fail', message: 'Asset read failed.' }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const firstSrc = createImageWorkspaceViewerDataUrl(bytesFor('first'), 'image/png')
    const node = previewSnapshot(container).img
    expect(previewSnapshot(container).imgSrc).toBe(firstSrc)

    const ledger = startCommitLedger(container)
    harness.setObservation(imageObservation({ mtimeMs: 2000 }))
    await act(async () => {
      panel.contexts.at(-1)?.refresh()
    })
    await flushAsyncWork()
    ledger.stop()

    const failed = previewSnapshot(container)
    expect({
      state: 'refresh read failed',
      img: failed.imgSrc,
      previewState: failed.previewState,
      fallbackText: failed.fallbackText,
      previousRevisionPixelsPresent: container.innerHTML.includes(firstSrc),
      capturedNodeConnected: node?.isConnected ?? null,
      ledger: summarizeLedger(ledger.entries),
      reads: harness.readCallCount()
    }).toEqual({
      state: 'refresh read failed',
      img: null,
      previewState: 'fallback',
      fallbackText: 'Image bytes unavailableAsset read failed.',
      previousRevisionPixelsPresent: false,
      capturedNodeConnected: false,
      ledger: {
        statesSeen: ['refreshing', 'fallback'],
        everShowedPreviousBytes: false,
        everShowedFallbackMarker: true,
        everShowedTerminalFallback: true,
        everShowedLoadingMarker: false,
        everLostTheFrame: true
      },
      reads: 2
    })
  })

  it('(l) a failed open for a different document never leaks the previous frame and recovers on retry', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      readScript: [
        { kind: 'bytes', bytes: bytesFor('cell') },
        { kind: 'bytes', bytes: bytesFor('other') }
      ]
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const cellSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    expect(previewSnapshot(container).imgSrc).toBe(cellSrc)

    harness.failNextOpen('The requested document could not be opened.')
    harness.setObservation(imageObservation({ path: OTHER_PATH }))
    harness.setAsset(imageAsset({ assetId: 'asset-other', name: OTHER_NAME }))
    await panel.renderShell({
      targetPath: OTHER_PATH,
      onOpenFile: vi.fn(),
      className: 'failed-switch'
    })

    const failedOpen = previewSnapshot(container)
    expect({
      state: 'switch open failed',
      img: failedOpen.imgSrc,
      previousBytesVisible: container.innerHTML.includes(cellSrc),
      assetStatus: failedOpen.assetStatus,
      previewState: failedOpen.previewState,
      chromeErrorText: container.textContent?.includes('The requested document could not be opened.') ?? false
    }).toEqual({
      state: 'switch open failed',
      img: null,
      previousBytesVisible: false,
      assetStatus: 'error',
      previewState: 'fallback',
      chromeErrorText: true
    })

    // Retry the same target through the refresh path: the reset filter must not keep
    // suppressing the new document's publications forever.
    await act(async () => {
      panel.contexts.at(-1)?.refresh()
    })
    await flushAsyncWork()

    const otherSrc = createImageWorkspaceViewerDataUrl(bytesFor('other'), 'image/png')
    expect({
      state: 'retry settled',
      src: previewSnapshot(container).imgSrc,
      previousBytesVisible: container.innerHTML.includes(cellSrc),
      assetStatus: previewSnapshot(container).assetStatus,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText,
      reads: harness.readCallCount()
    }).toEqual({
      state: 'retry settled',
      src: otherSrc,
      previousBytesVisible: false,
      assetStatus: 'ready',
      previewState: 'ready',
      fallbackText: null,
      reads: 2
    })
  })
})

describe('image viewer recovery and boundary cases', () => {
  it('(g) refreshes the same image through context.refresh without tearing down or mislabelling the frame', async () => {
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: imageObservation(),
      asset: imageAsset(),
      defaultBytes: bytesFor('cell')
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({ container, root, host: harness.host })

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })
    const cellSrc = createImageWorkspaceViewerDataUrl(bytesFor('cell'), 'image/png')
    const node = previewSnapshot(container).img
    expect({ src: previewSnapshot(container).imgSrc, reads: harness.readCallCount() })
      .toEqual({ src: cellSrc, reads: 1 })

    let detachedFrames = 0
    const domTimeline: string[] = []
    let observerRecords = 0
    const observer = new MutationObserver((records) => {
      observerRecords += records.length
      domTimeline.push(
        `${container.querySelectorAll('[data-image-preview-img]').length} img | ` +
        `${(container.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 48)}`
      )
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (
            removed instanceof HTMLElement &&
            (removed.matches('[data-image-preview-img]') ||
              removed.querySelector('[data-image-preview-img]'))
          ) {
            detachedFrames += 1
          }
        }
      }
    })
    observer.observe(container, { childList: true, subtree: true })
    const ledger = startCommitLedger(container)
    const hostTimeline: string[] = []
    const unsubscribe = harness.host.subscribe((state) => {
      hostTimeline.push(
        `${state.observation ? 'observation' : 'no-observation'}/${state.asset ? 'asset' : 'no-asset'}`
      )
    })

    // `context.refresh` is exactly what the right-sidebar refresh button calls. Holding the
    // bridge open models the IPC round trip during which the same document is re-opened.
    harness.deferNextOpen()
    await act(async () => {
      panel.contexts.at(-1)?.refresh()
    })
    await flushAsyncWork()

    const refreshing = previewSnapshot(container)
    await act(async () => {
      harness.resolveOpen()
      await Promise.resolve()
    })
    await flushAsyncWork()
    observer.disconnect()
    ledger.stop()
    unsubscribe()

    const settled = previewSnapshot(container)
    console.info(
      '[verifier] context.refresh() host-state timeline:',
      JSON.stringify(hostTimeline),
      'dom timeline:',
      JSON.stringify(domTimeline),
      'observer records:',
      observerRecords,
      'captured node still connected:',
      node?.isConnected ?? null
    )
    expect({
      refreshing: {
        sameNode: refreshing.img === node,
        src: refreshing.imgSrc,
        previewState: refreshing.previewState,
        fallbackText: refreshing.fallbackText
      },
      settled: {
        sameNode: settled.img === node,
        src: settled.imgSrc,
        previewState: settled.previewState,
        fallbackText: settled.fallbackText
      },
      detachedFrames,
      imageNodesInContainer: container.querySelectorAll('[data-image-preview-img]').length,
      capturedNodeConnected: node?.isConnected ?? null,
      hostTimeline,
      ledger: summarizeLedger(ledger.entries),
      reads: harness.readCallCount()
    }).toEqual({
      refreshing: {
        sameNode: true,
        src: cellSrc,
        previewState: 'refreshing',
        fallbackText: null
      },
      settled: {
        sameNode: true,
        src: cellSrc,
        previewState: 'ready',
        fallbackText: null
      },
      detachedFrames: 0,
      imageNodesInContainer: 1,
      capturedNodeConnected: true,
      // No host publication ever drops the observation/asset for a same-document refresh.
      hostTimeline: ['observation/asset', 'observation/asset', 'observation/asset'],
      ledger: {
        statesSeen: ['refreshing', 'ready'],
        everShowedPreviousBytes: false,
        everShowedFallbackMarker: false,
        everShowedTerminalFallback: false,
        everShowedLoadingMarker: false,
        everLostTheFrame: false
      },
      reads: 1
    })
  })

  it('(e) recovers when a usable transport arrives with an unchanged content key', async () => {
    const observation = imageObservation({ path: `${WORKSPACE_ROOT}/images/recover.png`, size: 64 })
    // assetId stays empty, so the content key is byte-for-byte identical before and after
    // the transport arrives: only `canLoadImage` flips.
    const lateAsset = imageAsset({ assetId: '', name: 'recover.png' })
    expect(workspacePreviewContentKey({ observation, asset: null }))
      .toBe(workspacePreviewContentKey({ observation, asset: lateAsset }))

    const { container, root } = mountContainer()
    const readRange = vi.fn(async (_range: WorkspacePreviewByteRange): Promise<WorkspacePreviewReadRangeResult> => ({
      ok: true,
      sessionId: SESSION_ID,
      assetId: '',
      offset: 0,
      length: 64,
      size: 64,
      dataBase64: base64Of(bytesFor('recovered')),
      mimeType: 'image/png'
    }))
    const transport = createWorkspacePreviewAssetTransportClient({
      descriptor: lateAsset,
      readRange
    })

    const render = async (props: ImageWorkspaceViewerProps): Promise<void> => {
      await act(async () => {
        root.render(createElement(ImageWorkspaceViewer, props))
      })
      await flushAsyncWork()
    }

    await render({ observation, asset: null, transport: null })
    expect({
      state: 'before transport',
      reads: readRange.mock.calls.length,
      img: previewSnapshot(container).imgSrc,
      fallbackText: previewSnapshot(container).fallbackText
    }).toEqual({
      state: 'before transport',
      reads: 0,
      img: null,
      fallbackText: 'Image bytes unavailableNo workspace preview asset descriptor is available for this image.'
    })

    await render({ observation, asset: lateAsset, transport })

    expect({
      state: 'after transport',
      reads: readRange.mock.calls.length,
      src: previewSnapshot(container).imgSrc,
      previewState: previewSnapshot(container).previewState,
      fallbackText: previewSnapshot(container).fallbackText
    }).toEqual({
      state: 'after transport',
      reads: 1,
      src: createImageWorkspaceViewerDataUrl(bytesFor('recovered'), 'image/png'),
      previewState: 'ready',
      fallbackText: null
    })
  })
})

describe('Markdown workspace image stability', () => {
  let markdownRootSequence = 0

  function markdownFixtures(): {
    workspaceRoot: string
    filePath: string
    observation: WorkspaceObservation
  } {
    markdownRootSequence += 1
    const workspaceRoot = `${WORKSPACE_ROOT}/markdown-${markdownRootSequence}`
    const filePath = `${workspaceRoot}/notes.md`
    const body = '# Notes\n\n![Cell](figures/cell.png)\n'
    return {
      workspaceRoot,
      filePath,
      observation: {
        schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
        file: {
          path: filePath,
          workspaceRoot,
          mimeType: 'text/markdown',
          size: body.length,
          mtimeMs: 1000
        },
        view: {
          pluginId: 'markdown',
          modality: 'document',
          mode: 'preview',
          title: 'notes.md'
        },
        visibleText: body,
        text: { lineCount: 3, characterCount: body.length, truncated: false },
        actions: ['markdown.readImage', 'text.replaceRange']
      }
    }
  }

  it('keeps the Markdown <img> node, src, and loader call count across 5 re-renders with new identities', async () => {
    const fixtures = markdownFixtures()
    const dataUrl = createImageWorkspaceViewerDataUrl(bytesFor('markdown-cell'), 'image/png')
    const loader = vi.fn(async (_input: { path: string; workspaceRoot: string }) => ({
      ok: true as const,
      dataUrl
    }))
    const { container, root } = mountContainer()

    const render = async (overrides: Partial<MarkdownWorkspaceViewerProps> = {}): Promise<void> => {
      await act(async () => {
        root.render(createElement(MarkdownWorkspaceViewer, {
          observation: cloneValue(fixtures.observation),
          documentContentKey: 'notes.md@1000',
          // Fresh identities on every render, exactly like an ancestor re-render storm.
          loadWorkspaceImage: ((input) => loader(input)) as WriteMarkdownWorkspaceImageLoader,
          onOpenWorkspaceLink: (input) => input,
          onApplyEdit: async () => undefined,
          annotationOverlays: [],
          ...overrides
        }))
      })
      await flushAsyncWork()
    }

    await render()
    const node = container.querySelector('img')
    expect({
      state: 'initial',
      imgPresent: node !== null,
      src: node?.getAttribute('src') ?? null,
      loaderCalls: loader.mock.calls.length
    }).toEqual({ state: 'initial', imgPresent: true, src: dataUrl, loaderCalls: 1 })

    for (let step = 1; step <= 5; step += 1) {
      await render()
      const image = container.querySelector('img')
      expect({
        step,
        sameNode: image === node,
        src: image?.getAttribute('src') ?? null,
        blanked: image?.hasAttribute('src') !== true,
        loaderCalls: loader.mock.calls.length
      }).toEqual({
        step,
        sameNode: true,
        src: dataUrl,
        blanked: false,
        loaderCalls: 1
      })
    }
  })

  it('keeps the workspace image stable through the real markdown plugin, loader, and host action', async () => {
    const fixtures = markdownFixtures()
    const dataUrl = createImageWorkspaceViewerDataUrl(bytesFor('shell-markdown'), 'image/png')
    const harness = createPreviewHarness({
      registry: builtInPreviewRegistry,
      observation: fixtures.observation,
      asset: imageAsset(),
      markdownImageDataUrl: dataUrl
    })
    const { container, root } = mountContainer()
    const panel = mountPreviewPanel({
      container,
      root,
      host: harness.host,
      targetPath: fixtures.filePath
    })
    const markdownImageCalls = (): number =>
      harness.invokeActionCalls.filter((call) => call.actionId === 'markdown.readImage').length
    const renderedImage = (): HTMLImageElement | null =>
      container.querySelector<HTMLImageElement>('[data-markdown-annotation-text-root] img')

    await panel.renderShell({ onOpenFile: vi.fn(), className: 'initial' })

    const node = renderedImage()
    expect({
      state: 'real markdown plugin',
      viewerPresent: container.querySelector('[data-workspace-preview-markdown-viewer]') !== null,
      imgPresent: node !== null,
      src: node?.getAttribute('src') ?? null,
      loaderCalls: markdownImageCalls()
    }).toEqual({
      state: 'real markdown plugin',
      viewerPresent: true,
      imgPresent: true,
      src: dataUrl,
      loaderCalls: 1
    })

    for (let step = 1; step <= 5; step += 1) {
      await churnPanel({ panel, harness, step, patchHost: step % 2 === 0 })
      const image = renderedImage()
      expect({
        step,
        sameNode: image === node,
        src: image?.getAttribute('src') ?? null,
        loaderCalls: markdownImageCalls(),
        fallbackSpan: container.querySelector('.write-markdown-preview span')?.textContent ?? null
      }).toEqual({
        step,
        sameNode: true,
        src: dataUrl,
        loaderCalls: 1,
        fallbackSpan: null
      })
    }
  })

  it('does not remount, refetch, or blank the image when only the loader identity changes', async () => {
    const fixtures = markdownFixtures()
    const firstDataUrl = createImageWorkspaceViewerDataUrl(bytesFor('markdown-first'), 'image/png')
    const secondDataUrl = createImageWorkspaceViewerDataUrl(bytesFor('markdown-second'), 'image/png')
    const firstLoader = vi.fn(async () => ({ ok: true as const, dataUrl: firstDataUrl }))
    const secondLoader = vi.fn(async () => ({ ok: true as const, dataUrl: secondDataUrl }))
    const { container, root } = mountContainer()

    const render = async (input: {
      loader: WriteMarkdownWorkspaceImageLoader
      observation?: WorkspaceObservation
    }): Promise<void> => {
      await act(async () => {
        root.render(createElement(MarkdownWorkspaceViewer, {
          observation: input.observation ?? cloneValue(fixtures.observation),
          documentContentKey: 'notes.md@1000',
          loadWorkspaceImage: input.loader,
          annotationOverlays: []
        }))
      })
      await flushAsyncWork()
    }

    await render({ loader: firstLoader })
    const node = container.querySelector('img')
    expect({ src: node?.getAttribute('src') ?? null, calls: firstLoader.mock.calls.length })
      .toEqual({ src: firstDataUrl, calls: 1 })

    // Only the loader identity changes. The document, path, and workspace root are identical.
    await render({ loader: secondLoader })
    const afterIdentityChange = container.querySelector('img')
    expect({
      state: 'loader identity changed',
      sameNode: afterIdentityChange === node,
      src: afterIdentityChange?.getAttribute('src') ?? null,
      firstLoaderCalls: firstLoader.mock.calls.length,
      secondLoaderCalls: secondLoader.mock.calls.length
    }).toEqual({
      state: 'loader identity changed',
      sameNode: true,
      src: firstDataUrl,
      firstLoaderCalls: 1,
      secondLoaderCalls: 0
    })

    // A genuinely different resource must still use the loader of the current render.
    const movedObservation = cloneValue(fixtures.observation)
    movedObservation.visibleText = '# Notes\n\n![Other](figures/other.png)\n'
    await render({ loader: secondLoader, observation: movedObservation })
    expect({
      state: 'different resource',
      src: container.querySelector('img')?.getAttribute('src') ?? null,
      firstLoaderCalls: firstLoader.mock.calls.length,
      secondLoaderCalls: secondLoader.mock.calls.length
    }).toEqual({
      state: 'different resource',
      src: secondDataUrl,
      firstLoaderCalls: 1,
      secondLoaderCalls: 1
    })
  })
})