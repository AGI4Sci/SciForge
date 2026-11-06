// @vitest-environment happy-dom
import { act, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createEvidenceDagGlobalOverlayContribution } from '@sciforge/domain-evidence-dag/renderer'
import type { DomainRendererHost, DomainVisibleContextSelectionInspection } from '@sciforge/domain-sdk/host'
import {
  inspectRegisteredVisibleContextTextSelection,
  registerVisibleContextComponent,
  registerVisibleContextVisualTarget
} from './visible-context'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the research canvas registered during an earlier sibling annotation effect with an equivalent scope', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.dataset.recordKind === 'phase' ? new DOMRect(20, 30, 300, 40) : new DOMRect(0, 0, 900, 700)
  })
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 40, 100, 16))
  const registeredTargetRef = vi.fn(async () => ({ ok: true, targetRef: 'opaque-host-reference-fixture' }))
  vi.stubGlobal('sciforge', { visibleContext: {
    registeredTargetRef, publish: vi.fn(async () => undefined), onRefreshRequested: () => () => undefined
  } })
  const scope = { runtimeId: 'codex', threadId: 'record-parent', workspaceRoot: '/research' }
  const phase = { id: 'phase-1', parentId: 'root', kind: 'phase', title: '机制验证', summary: '检查独立对照',
    origin: 'model', status: 'completed', createdAt: '2026-11-03', updatedAt: '2026-11-03' }
  let registrations = 0, unregistrations = 0
  const host = {
    capabilityInvoker: { invoke: async (contract: { actionId: string }, input: { nodeId: string }) => contract.actionId === 'evidence-dag.record.review' ? { items: [], latestSequence: 0, total: 0, pending: 0, blocked: 0, worker: 'idle' } : ({
      revision: 1, node: input.nodeId === 'root' ? null : phase, ancestors: [], children: input.nodeId === 'root' ? [phase] : [],
      totalChildren: input.nodeId === 'root' ? 1 : 0, latestRecordPath: ['phase-1'], messages: [], paused: false, model: '', pending: 0, failures: [],
      coverage: 'visible-session-snapshots', lastScanAt: null
    }) },
    visibleContext: {
      registerComponent: (component: Parameters<typeof registerVisibleContextComponent>[0]) => {
        registrations++
        const dispose = registerVisibleContextComponent(component)
        return () => { unregistrations++; dispose() }
      },
      registerVisualTarget: registerVisibleContextVisualTarget
    }
  } as unknown as DomainRendererHost
  const overlay = createEvidenceDagGlobalOverlayContribution(host)
  let inspection: DomainVisibleContextSelectionInspection | null | undefined
  function AnnotationProbe({ active }: { active: boolean }) {
    useEffect(() => {
      if (active) void inspectRegisteredVisibleContextTextSelection().then(value => { inspection = value })
    }, [active])
    return null
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const render = (annotationOpen: boolean) => <>
    <AnnotationProbe active={annotationOpen} />
    <Suspense fallback={null}>{overlay.render({ active: true, className: '', session: { id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot },
      activation: { revision: 1, payload: { recordScope: { ...scope } } }, onClose: () => undefined })}</Suspense>
  </>
  try {
    await act(async () => root.render(render(false)))
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve() })
      expect(container.querySelector('[data-record-id="phase-1"] .select-text')).not.toBeNull()
    }, { timeout: 10000 })
    const text = container.querySelector('[data-record-id="phase-1"] .select-text')!
    const range = document.createRange(); range.selectNodeContents(text)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    const before = await inspectRegisteredVisibleContextTextSelection()
    expect(before?.text).toBe('机制验证')
    expect(before?.target.metadata?.resourceId).toBe('phase-1')
    const baseline = { registrations, unregistrations }
    await act(async () => root.render(render(true)))
    expect(inspection?.text).toBe('机制验证')
    expect(inspection?.target.metadata).toMatchObject({ resourceId: 'phase-1', ...scope })
    expect({ registrations, unregistrations }).toEqual(baseline)
    expect(registeredTargetRef).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    container.remove(); window.getSelection()!.removeAllRanges()
  }
})


it('never registers old compact rows under a new scope while its owner read is pending', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const targets: { resourceId?: unknown; workspaceRoot?: unknown; runtimeId?: unknown; threadId?: unknown }[] = []
  const workspaceA = '/scope-a', workspaceB = '/scope-b'
  const nodes = Array.from({ length: 25 }, (_, i) => ({ id: `A-${i}`, parentId: 'root', kind: 'phase', title: `Material A ${i}`, summary: '', origin: 'system', status: 'complete', createdAt: '2026-11-05', updatedAt: '2026-11-05' }))
  let newScopeRequests = 0
  const host = {
    capabilityInvoker: { invoke: async (contract: { actionId: string }, _input: unknown, options: { workspaceId: string }) => {
      if (contract.actionId === 'evidence-dag.record.review') return { items: [], latestSequence: 0, total: 0, pending: 0, blocked: 0, worker: 'idle' }
      if (options.workspaceId === workspaceB) { newScopeRequests++; return new Promise(() => {}) }
      return { revision: 1, node: null, ancestors: [], children: nodes, totalChildren: nodes.length,
        latestRecordPath: [], messages: [], paused: true, model: '', pending: 0, failures: [], coverage: 'visible-session-snapshots', lastScanAt: null }
    } },
    visibleContext: {
      registerComponent: () => () => {},
      registerVisualTarget: (registration: { target: { metadata?: typeof targets[number] } }) => {
        targets.push({ ...registration.target.metadata }); return () => {}
      }
    }
  } as unknown as DomainRendererHost
  const overlay = createEvidenceDagGlobalOverlayContribution(host)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const render = (workspaceRoot: string) => <Suspense fallback={null}>{overlay.render({ active: true, className: '',
    session: { id: workspaceRoot, runtimeId: 'codex', workspaceRoot },
    activation: { revision: 1, payload: { recordScope: { runtimeId: 'codex', threadId: workspaceRoot, workspaceRoot } } }, onClose: () => {} })}</Suspense>
  try {
    await act(async () => root.render(render(workspaceA)))
    await vi.waitFor(() => expect(container.querySelectorAll('.record-compact-row')).toHaveLength(20))
    expect(targets.filter(target => String(target.resourceId).startsWith('A-'))).toHaveLength(20)
    targets.length = 0
    await act(async () => root.render(render(workspaceB)))
    expect(newScopeRequests).toBeGreaterThan(0)
    expect(targets.filter(target => String(target.resourceId).startsWith('A-'))).toHaveLength(0)
    expect(container.querySelector('[data-record-id^="A-"]')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})
