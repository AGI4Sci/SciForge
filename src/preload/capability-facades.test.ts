import { describe, expect, it, vi } from 'vitest'
import type {
  CapabilityDescriptor,
  CapabilityInvocationResult,
  CapabilityResourceHandle
} from '../shared/capability-broker'
import {
  PRELOAD_CAPABILITY_IDS,
  createCapabilityFacades
} from './capability-facades'

const operation: CapabilityDescriptor = {
  contractVersion: 1,
  id: 'test.resource-read',
  version: '1',
  title: 'Read resource',
  description: 'Reads a test resource.',
  audiences: ['ui'],
  scope: 'resource',
  resourceKinds: ['test.resource'],
  effect: 'read',
  approval: 'none',
  concurrency: { revision: 'none', idempotency: 'none' },
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  tags: []
}

function readyCapabilityBroker() {
  return {
    contractVersion: 1,
    status: 'ready' as const,
    registryFingerprint: 'a'.repeat(64),
    availableCapabilityIds: Object.values(PRELOAD_CAPABILITY_IDS),
    missingCapabilityIds: [],
    message: 'Capability broker is ready.'
  }
}

describe('capability facades', () => {
  it('fails visibly on an incomplete broker and retries readiness instead of caching failure', async () => {
    let readinessChecks = 0
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'capability:readiness') {
        readinessChecks += 1
        return readinessChecks === 1
          ? {
              ...readyCapabilityBroker(),
              status: 'incomplete' as const,
              missingCapabilityIds: [PRELOAD_CAPABILITY_IDS.workspacePreviewList],
              message: 'Workspace Preview capability is not registered.'
            }
          : readyCapabilityBroker()
      }
      return invocation(invocationAction(payload), [])
    })
    const facades = createCapabilityFacades({ invoke })

    await expect(facades.workspacePreview.listPlugins()).rejects.toThrow(/not registered/)
    await expect(facades.workspacePreview.listPlugins()).resolves.toEqual([])
    expect(readinessChecks).toBe(2)
  })

  it('keeps Workspace Preview on capability IPC, refreshes handles, and preserves UI result shapes', async () => {
    const first = handle('preview-1')
    const observed = handle('preview-2')
    const edited = handle('preview-3')
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'capability:readiness') return readyCapabilityBroker()
      if (channel === 'file:watch-workspace') return { watchId: 'watch-1' }
      if (channel === 'file:unwatch-workspace') return true
      if (channel === 'capability:observe') {
        return observation(observed, {
          session: { id: 'session-1' },
          observation: { schemaVersion: 1, sessionId: 'session-1', actions: [] }
        })
      }
      const actionId = invocationAction(payload)
      if (actionId === PRELOAD_CAPABILITY_IDS.workspacePreviewOpen) {
        return invocation(actionId, {
          ok: true,
          session: { id: 'session-1', workspaceRoot: '/workspace' },
          manifest: { id: 'pdf' },
          route: 'matched',
          file: { path: 'paper.pdf' },
          resource: first
        })
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.workspacePreviewApplyEdit) {
        return invocation(actionId, { ok: true, operationKind: 'text.replaceRange' }, edited)
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.workspacePreviewAnnotationsResolve) {
        return invocation(actionId, { ok: true, operationKind: 'annotation.thread.update' }, edited)
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.workspacePreviewExport) {
        return invocation(actionId, { ok: true, path: '/tmp/export.pdf' })
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.workspacePreviewRelease) return invocation(actionId, true)
      return invocation(actionId, { ok: true })
    })
    let nextInvocation = 0
    const facades = createCapabilityFacades({
      invoke,
      createInvocationId: () => `invocation-${++nextInvocation}`
    })

    const opened = await facades.workspacePreview.open({
      workspaceRoot: '/workspace',
      path: 'paper.pdf'
    })
    expect(opened).toMatchObject({
      ok: true,
      session: { id: 'session-1' },
      capability: { resource: first, operations: [] }
    })
    expect(opened).not.toHaveProperty('resource')

    await expect(facades.workspacePreview.observe('session-1')).resolves.toMatchObject({
      ok: true,
      observation: { sessionId: 'session-1' },
      capability: { resource: observed, operations: [operation] }
    })
    await expect(facades.workspacePreview.applyEdit('session-1', {
      kind: 'text.replaceRange',
      path: 'paper.pdf',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 }
      },
      text: 'Revised'
    })).resolves.toMatchObject({
      ok: true,
      capability: { resource: edited, operations: [operation] }
    })
    await expect(facades.workspacePreview.resolveAnnotation('session-1', {
      threadId: 'thread-1',
      resolved: true
    })).resolves.toMatchObject({
      ok: true,
      capability: { resource: edited, operations: [operation] }
    })
    await expect(facades.workspacePreview.invokeAction('session-1', {
      actionId: 'save',
      input: {}
    })).resolves.toMatchObject({
      ok: true,
      capability: { resource: edited, operations: [operation] }
    })
    await facades.workspacePreview.export('session-1', { kind: 'download', format: 'pdf' })
    await expect(facades.workspacePreview.watch({
      workspaceRoot: '/workspace',
      path: 'paper.pdf'
    })).resolves.toEqual({ watchId: 'watch-1' })
    await expect(facades.workspacePreview.unwatch('watch-1')).resolves.toBe(true)

    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.workspacePreviewApplyEdit)).toMatchObject({
      workspaceId: '/workspace',
      request: {
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewApplyEdit,
        invocationId: 'invocation-1',
        expectedRevision: observed.semanticRevision,
        resource: observed
      }
    })
    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.workspacePreviewAnnotationsResolve)).toMatchObject({
      workspaceId: '/workspace',
      request: {
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
        invocationId: 'invocation-2',
        expectedRevision: edited.semanticRevision,
        resource: edited,
        input: { threadId: 'thread-1', resolved: true }
      }
    })
    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.workspacePreviewExport)).toMatchObject({
      approval: { mode: 'confirmation' },
      request: {
        invocationId: 'invocation-4',
        resource: edited
      }
    })
    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.workspacePreviewInvokeAction)).toMatchObject({
      request: {
        invocationId: 'invocation-3',
        expectedRevision: edited.semanticRevision,
        resource: edited
      }
    })
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('workspacePreview:open')
    expect(invoke).toHaveBeenCalledWith('file:watch-workspace', {
      workspaceRoot: '/workspace',
      path: 'paper.pdf'
    })

    await expect(facades.workspacePreview.releaseSession('session-1')).resolves.toBe(true)
    await expect(facades.workspacePreview.describeAsset('session-1')).rejects.toThrow(/no capability resource handle/)
  })

  it('uses official Biology Room acquisition, attaches registry bindings, and revisions mutations from handles', async () => {
    const created = handle('room-created')
    const observed = handle('room-observed')
    const applied = handle('room-applied')
    const refreshed = handle('room-refreshed')
    const manifest = { schemaVersion: 1, roomId: 'room-1', title: 'Room 1', revision: 1 }
    let observationCount = 0
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'capability:readiness') return readyCapabilityBroker()
      if (channel === 'capability:observe') {
        observationCount += 1
        return observation(observationCount === 1 ? observed : refreshed, {
          schemaVersion: 1,
          roomId: 'room-1',
          title: 'Room 1',
          revision: observationCount + 1
        })
      }
      const actionId = invocationAction(payload)
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomCreate) {
        return invocation(actionId, { manifest, resource: created })
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomApply) {
        return invocation(actionId, {
          dryRun: false,
          changed: true,
          previousRevision: 2,
          revision: 3,
          manifest: { ...manifest, revision: 3 },
          warnings: []
        }, applied)
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomRefresh) {
        return invocation(actionId, {
          dryRun: false,
          changed: true,
          previousRevision: 3,
          revision: 4,
          manifest: { ...manifest, revision: 4 },
          warnings: []
        }, refreshed)
      }
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomHistory) {
        return invocation(actionId, { roomId: 'room-1', currentRevision: 4, entries: [], truncated: false })
      }
      throw new Error(`Unexpected action ${actionId}`)
    })
    let nextInvocation = 0
    const facades = createCapabilityFacades({
      invoke,
      createInvocationId: () => `room-invocation-${++nextInvocation}`
    })

    await expect(facades.biologyRoom.create({
      workspaceRoot: '/workspace',
      title: 'Room 1'
    })).resolves.toMatchObject({
      roomId: 'room-1',
      capability: { resource: observed, operations: [operation] }
    })

    await expect(facades.biologyRoom.apply({
      workspaceRoot: '/workspace',
      roomId: 'room-1',
      baseRevision: 999,
      operations: []
    })).resolves.toMatchObject({
      revision: 3,
      manifest: { capability: { resource: applied, operations: [operation] } }
    })
    const applyPayload = invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.biologyRoomApply)
    expect(applyPayload).toMatchObject({
      workspaceId: '/workspace',
      request: {
        invocationId: 'room-invocation-2',
        expectedRevision: observed.semanticRevision,
        resource: observed,
        input: { operations: [] }
      }
    })
    expect(requestRecord(applyPayload).input).not.toHaveProperty('workspaceRoot')
    expect(requestRecord(applyPayload).input).not.toHaveProperty('roomId')
    expect(requestRecord(applyPayload).input).not.toHaveProperty('baseRevision')

    await expect(facades.biologyRoom.refresh({
      workspaceRoot: '/workspace',
      roomId: 'room-1'
    })).resolves.toMatchObject({
      revision: 4,
      manifest: { capability: { resource: refreshed, operations: [operation] } }
    })
    await expect(facades.biologyRoom.history({
      workspaceRoot: '/workspace',
      roomId: 'room-1'
    })).resolves.toMatchObject({ currentRevision: 4 })
    expect(invoke.mock.calls.map(([channel]) => channel).some((channel) => channel.startsWith('biologyRoom:'))).toBe(false)
  })

  it('fails closed for unknown preview sessions and acquires missing Biology Room handles through biology-room.open', async () => {
    const room = handle('room-open')
    const renewed = handle('room-renewed')
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'capability:readiness') return readyCapabilityBroker()
      const actionId = channel === 'capability:invoke' ? invocationAction(payload) : ''
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomOpen) {
        return invocation(actionId, { observation: { roomId: 'room-2' }, resource: room })
      }
      if (channel === 'capability:observe') return observation(renewed, { roomId: 'room-2' })
      if (actionId === PRELOAD_CAPABILITY_IDS.biologyRoomHistory) {
        return invocation(actionId, { roomId: 'room-2', currentRevision: 1, entries: [], truncated: false })
      }
      throw new Error(`Unexpected route ${channel}:${actionId}`)
    })
    const facades = createCapabilityFacades({ invoke, createInvocationId: () => 'unused' })

    await expect(facades.workspacePreview.readRange('missing', { offset: 0, length: 1 }))
      .rejects.toThrow(/no capability resource handle/)
    expect(invoke).not.toHaveBeenCalled()

    await expect(facades.biologyRoom.history({
      workspaceRoot: '/workspace',
      roomId: 'room-2'
    })).resolves.toMatchObject({ currentRevision: 1 })
    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.biologyRoomOpen)).toMatchObject({
      workspaceId: '/workspace',
      request: { actionId: PRELOAD_CAPABILITY_IDS.biologyRoomOpen, input: { roomId: 'room-2' } }
    })
    expect(invokeRequest(invoke, PRELOAD_CAPABILITY_IDS.biologyRoomHistory)).toMatchObject({
      request: { resource: renewed }
    })
  })
})

function handle(label: string): CapabilityResourceHandle {
  return {
    token: `cap_${label.replaceAll('-', '_').padEnd(24, 'x')}`,
    semanticRevision: `revision-${label}`,
    expiresAt: '2026-07-16T14:00:00.000Z'
  }
}

function invocation(
  actionId: string,
  output: CapabilityInvocationResult['output'],
  resource?: CapabilityResourceHandle
): CapabilityInvocationResult {
  return {
    actionId,
    output,
    ...(resource ? { resource } : {}),
    changed: Boolean(resource),
    replayed: false,
    completedAt: '2026-07-16T13:00:00.000Z'
  }
}

function observation(resource: CapabilityResourceHandle, state: Record<string, unknown>) {
  return {
    resource,
    resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
    resourceKind: 'test.resource',
    semanticRevision: resource.semanticRevision,
    observedAt: '2026-07-16T13:00:00.000Z',
    state,
    operations: [operation]
  }
}

function invocationAction(payload: unknown): string {
  return String(requestRecord(payload).actionId)
}

function requestRecord(payload: unknown): Record<string, unknown> {
  return record(record(payload).request)
}

function invokeRequest(invoke: ReturnType<typeof vi.fn>, actionId: string): Record<string, unknown> {
  const call = invoke.mock.calls.find(([channel, payload]) => (
    channel === 'capability:invoke' && invocationAction(payload) === actionId
  ))
  if (!call) throw new Error(`Missing invoke for ${actionId}`)
  return record(call[1])
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected record.')
  return value as Record<string, unknown>
}
