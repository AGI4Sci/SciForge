import { describe, expect, it, vi } from 'vitest'
import type {
  CapabilityDescriptor,
  CapabilityInvocationResult,
  CapabilityResourceHandle
} from '@shared/capability-broker'
import { workspacePreviewExtensionIdSchema } from '@shared/workspace-preview'
import { createWorkspacePreviewCapabilityAdapter } from './capability-adapter'

const DOMAIN_MODALITY = workspacePreviewExtensionIdSchema.parse('fixture.preview.modality')
const DOMAIN_SELECTION_TYPE = workspacePreviewExtensionIdSchema.parse('fixture.preview.selection')

const operation: CapabilityDescriptor = {
  contractVersion: 1,
  id: 'workspace-preview.apply-edit',
  version: '1',
  title: 'Apply edit',
  description: 'Applies an edit.',
  audiences: ['ui'],
  scope: 'resource',
  resourceKinds: ['workspace-preview'],
  effect: 'workspace-write',
  approval: 'none',
  concurrency: { revision: 'optimistic', idempotency: 'required' },
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  tags: []
}

describe('WorkspacePreview capability adapter', () => {
  it('retries incomplete generic capability readiness without caching failure', async () => {
    let checks = 0
    const transport = {
      readiness: vi.fn(async (request: { expectedContractVersion: number; requiredCapabilityIds: string[] }) => {
        checks += 1
        return {
          contractVersion: request.expectedContractVersion,
          status: checks === 1 ? 'incomplete' as const : 'ready' as const,
          registryFingerprint: 'a'.repeat(64),
          availableCapabilityIds: checks === 1 ? [] : request.requiredCapabilityIds,
          missingCapabilityIds: checks === 1 ? request.requiredCapabilityIds : [],
          message: checks === 1 ? 'Workspace Preview is unavailable.' : 'Capability broker is ready.'
        }
      }),
      bind: vi.fn(),
      invoke: vi.fn(async ({ request }: { request: { actionId: string } }) => invocation(request.actionId, [])),
      observe: vi.fn()
    }
    const adapter = createWorkspacePreviewCapabilityAdapter({ transport })

    await expect(adapter.listPlugins()).rejects.toThrow(/unavailable/)
    await expect(adapter.listPlugins()).resolves.toEqual([])
    expect(checks).toBe(2)
  })

  it('owns resource handles while all transport calls stay on the generic broker', async () => {
    const opened = handle('opened')
    const observed = handle('observed')
    const edited = handle('edited')
    const requests: Array<Record<string, unknown>> = []
    const transport = {
      readiness: vi.fn(async (request: { expectedContractVersion: number; requiredCapabilityIds: string[] }) => ({
        contractVersion: request.expectedContractVersion,
        status: 'ready' as const,
        registryFingerprint: 'a'.repeat(64),
        availableCapabilityIds: request.requiredCapabilityIds,
        missingCapabilityIds: [],
        message: 'Capability broker is ready.'
      })),
      bind: vi.fn(async () => observed),
      invoke: vi.fn(async (payload: { request: Record<string, unknown> }) => {
        requests.push(payload.request)
        const actionId = String(payload.request.actionId)
        if (actionId === 'workspace-preview.open') {
          return invocation(actionId, {
            ok: true,
            session: {
              id: 'session-1',
              pluginId: 'fixture-preview',
              workspaceRoot: '/workspace',
              path: 'protein.pdb',
              mode: 'inspect',
              createdAt: '2026-07-16T13:00:00.000Z'
            },
            manifest: { id: 'fixture-preview' },
            route: 'matched',
            file: { path: 'protein.pdb' },
            resource: opened
          })
        }
        if (actionId === 'workspace-preview.apply-edit') {
          return invocation(actionId, { ok: true, operationKind: 'workspace.setSelection' }, edited)
        }
        if (actionId === 'workspace-preview.release') return invocation(actionId, true)
        return invocation(actionId, { ok: true })
      }),
      observe: vi.fn(async () => ({
        resource: observed,
        resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
        resourceKind: 'workspace-preview',
        semanticRevision: observed.semanticRevision,
        observedAt: '2026-07-16T13:00:00.000Z',
        state: {
          observation: {
            schemaVersion: 1,
            file: { path: 'protein.pdb', workspaceRoot: '/workspace', size: 4 },
            view: {
              pluginId: 'fixture-preview',
              modality: DOMAIN_MODALITY,
              mode: 'preview',
              title: 'protein.pdb'
            },
            actions: []
          }
        },
        operations: [operation]
      }))
    }
    let invocationId = 0
    const adapter = createWorkspacePreviewCapabilityAdapter({
      transport,
      createInvocationId: () => `invocation-${++invocationId}`,
      now: () => Date.parse('2026-07-16T13:00:00.000Z')
    })

    await expect(adapter.open({ workspaceRoot: '/workspace', path: 'protein.pdb' })).resolves.toMatchObject({
      ok: true,
      capability: { resource: opened, operations: [] }
    })
    await expect(adapter.observe('session-1')).resolves.toMatchObject({
      ok: true,
      capability: { resource: observed, operations: [operation] }
    })
    await expect(adapter.applyEdit('session-1', {
      kind: 'workspace.setSelection',
      path: 'protein.pdb',
      selection: {
        kind: 'domain',
        selectionType: DOMAIN_SELECTION_TYPE,
        data: { selectedIds: ['A'] }
      }
    })).resolves.toMatchObject({
      ok: true,
      capability: { resource: edited, operations: [operation] }
    })

    expect(requests.find((request) => request.actionId === 'workspace-preview.apply-edit')).toMatchObject({
      actionId: 'workspace-preview.apply-edit',
      invocationId: 'invocation-1',
      expectedRevision: observed.semanticRevision,
      resource: observed
    })

    await expect(adapter.releaseSession('session-1')).resolves.toBe(true)
    await expect(adapter.describeAsset('session-1')).rejects.toThrow(/no capability resource handle/)
  })

  it('serializes revisioned mutations and observations on the same resource binding', async () => {
    const opened = handle('queue-opened')
    const mutationRequests: Array<Record<string, unknown>> = []
    const observedRevisions: string[] = []
    let mutationIndex = 0
    let invocationIndex = 0
    let activeMutations = 0
    let maxActiveMutations = 0
    const transport = {
      readiness: vi.fn(async (request: { expectedContractVersion: number; requiredCapabilityIds: string[] }) => ({
        contractVersion: request.expectedContractVersion,
        status: 'ready' as const,
        registryFingerprint: 'a'.repeat(64),
        availableCapabilityIds: request.requiredCapabilityIds,
        missingCapabilityIds: [],
        message: 'Capability broker is ready.'
      })),
      bind: vi.fn(async () => opened),
      invoke: vi.fn(async (payload: { request: Record<string, unknown> }) => {
        const actionId = String(payload.request.actionId)
        if (actionId === 'workspace-preview.open') {
          return invocation(actionId, {
            ok: true,
            session: { id: 'session-queue' },
            manifest: { id: 'fixture-preview' },
            route: 'matched',
            file: { path: 'paper.pdf' },
            resource: opened
          })
        }
        if (actionId === 'workspace-preview.annotations.update') {
          mutationRequests.push(payload.request)
          activeMutations += 1
          maxActiveMutations = Math.max(maxActiveMutations, activeMutations)
          await Promise.resolve()
          mutationIndex += 1
          const resource = handle(`queue-mutation-${mutationIndex}`)
          activeMutations -= 1
          return invocation(actionId, {
            ok: true,
            operationKind: 'annotation.upsert'
          }, resource)
        }
        return invocation(actionId, { ok: true })
      }),
      observe: vi.fn(async (payload: {
        request: { resource: CapabilityResourceHandle }
      }) => {
        observedRevisions.push(payload.request.resource.semanticRevision)
        return {
          resource: payload.request.resource,
          resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
          resourceKind: 'workspace-preview',
          semanticRevision: payload.request.resource.semanticRevision,
          observedAt: '2026-07-16T13:00:00.000Z',
          state: {
            observation: {
              schemaVersion: 1,
              file: {
                path: '/workspace/paper.pdf',
                workspaceRoot: '/workspace',
                mimeType: 'application/pdf'
              },
              view: {
                pluginId: 'pdf',
                modality: 'document',
                mode: 'preview',
                title: 'paper.pdf'
              },
              actions: []
            }
          },
          operations: [operation]
        }
      })
    }
    const adapter = createWorkspacePreviewCapabilityAdapter({
      transport,
      createInvocationId: () => `invocation-${++invocationIndex}`,
      now: () => Date.parse('2026-07-16T13:00:00.000Z')
    })
    await adapter.open({ workspaceRoot: '/workspace', path: 'paper.pdf' })

    const first = adapter.updateAnnotation('session-queue', {
      annotationId: 'annotation-1',
      annotationKind: 'question',
      body: 'First'
    })
    const second = adapter.updateAnnotation('session-queue', {
      annotationId: 'annotation-2',
      annotationKind: 'answer',
      body: 'Second'
    })
    const observation = adapter.observe('session-queue')
    await expect(Promise.all([first, second, observation])).resolves.toHaveLength(3)

    expect(maxActiveMutations).toBe(1)
    expect(mutationRequests.map((request) => request.expectedRevision)).toEqual([
      opened.semanticRevision,
      handle('queue-mutation-1').semanticRevision
    ])
    expect(observedRevisions).toEqual([
      handle('queue-mutation-2').semanticRevision
    ])
  })

  it('renews an expiring session handle through its stable resource reference', async () => {
    const opened = handle('renew-opened')
    const observed = handle('renew-observed')
    const renewed = {
      ...handle('renew-bound'),
      expiresAt: '2026-07-16T15:00:00.000Z'
    }
    const annotationRequests: Array<Record<string, unknown>> = []
    const transport = {
      readiness: vi.fn(async (request: { expectedContractVersion: number; requiredCapabilityIds: string[] }) => ({
        contractVersion: request.expectedContractVersion,
        status: 'ready' as const,
        registryFingerprint: 'a'.repeat(64),
        availableCapabilityIds: request.requiredCapabilityIds,
        missingCapabilityIds: [],
        message: 'Capability broker is ready.'
      })),
      bind: vi.fn(async () => renewed),
      invoke: vi.fn(async (payload: { request: Record<string, unknown> }) => {
        const actionId = String(payload.request.actionId)
        if (actionId === 'workspace-preview.open') {
          return invocation(actionId, {
            ok: true,
            session: { id: 'session-renew' },
            manifest: { id: 'fixture-preview' },
            route: 'matched',
            file: { path: 'paper.pdf' },
            resource: opened
          })
        }
        if (actionId === 'workspace-preview.annotations.list') {
          annotationRequests.push(payload.request)
        }
        return invocation(actionId, { ok: true })
      }),
      observe: vi.fn(async () => ({
        resource: observed,
        resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
        resourceKind: 'workspace-preview',
        semanticRevision: observed.semanticRevision,
        observedAt: '2026-07-16T13:59:30.000Z',
        state: {
          observation: {
            schemaVersion: 1,
            file: {
              path: '/workspace/paper.pdf',
              workspaceRoot: '/workspace',
              mimeType: 'application/pdf'
            },
            view: {
              pluginId: 'pdf',
              modality: 'document',
              mode: 'preview',
              title: 'paper.pdf'
            },
            actions: []
          }
        },
        operations: [operation]
      }))
    }
    const adapter = createWorkspacePreviewCapabilityAdapter({
      transport,
      now: () => Date.parse('2026-07-16T13:59:30.000Z')
    })

    await adapter.open({ workspaceRoot: '/workspace', path: 'paper.pdf' })
    await adapter.observe('session-renew')
    await adapter.listAnnotations('session-renew')

    expect(transport.bind).toHaveBeenCalledWith({
      workspaceId: '/workspace',
      request: { resourceRef: 'res_abcdefghijklmnopqrstuvwxyz' }
    })
    expect(annotationRequests).toEqual([
      expect.objectContaining({ resource: renewed })
    ])
  })
})

function handle(label: string): CapabilityResourceHandle {
  return {
    token: `cap_${label.padEnd(24, 'x')}`,
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
