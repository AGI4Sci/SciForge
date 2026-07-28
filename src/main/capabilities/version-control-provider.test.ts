import { describe, expect, it, vi } from 'vitest'
import { capabilityResourceHandleSchema } from '../../shared/capability-broker'
import {
  VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
  VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
  VERSION_CONTROL_DIFF_ACTION_ID,
  VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
  VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
  VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
  VERSION_CONTROL_READ_FILE_ACTION_ID,
  VERSION_CONTROL_RESTORE_ACTION_ID,
  VERSION_CONTROL_STATUS_ACTION_ID,
  VERSION_CONTROL_WORKSPACE_RESOURCE_KIND
} from '@sciforge/domain-sdk/version-control'
import { CapabilityBroker, CapabilityBrokerError } from './broker'
import { CapabilityRegistry } from './registry'
import {
  VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY,
  type VersionControlCapabilityDependencies
} from './version-control-provider'

const uiCaller = {
  audience: 'ui' as const,
  callerId: 'window-1',
  workspaceId: '/workspace'
}

function expectBrokerCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(CapabilityBrokerError)
  expect((error as CapabilityBrokerError).code).toBe(code)
  return true
}

function createHarness() {
  const session = {
    resourceId: 'version-control-session-1',
    ownerId: uiCaller.callerId,
    ownerAudience: uiCaller.audience,
    workspaceId: uiCaller.workspaceId,
    workspaceRoot: uiCaller.workspaceId,
    repositoryRoot: uiCaller.workspaceId
  }
  let revision = 'revision-1'
  const restore = vi.fn(async () => {
    revision = 'revision-2'
    return { ok: true as const, revision }
  })
  const service = {
    open: vi.fn(async (
      ownerId: string,
      ownerAudience: 'ui' | 'agent' | 'system',
      workspaceId: string
    ) => ({
      ...session,
      ownerId,
      ownerAudience,
      workspaceId,
      workspaceRoot: workspaceId,
      repositoryRoot: workspaceId
    })),
    requireSession: vi.fn((
      ownerId: string,
      ownerAudience: 'ui' | 'agent' | 'system',
      resourceId: string,
      workspaceId: string
    ) => {
      if (
        ownerId !== session.ownerId ||
        ownerAudience !== session.ownerAudience ||
        resourceId !== session.resourceId ||
        workspaceId !== session.workspaceId
      ) {
        throw new Error('Version-control workspace is unavailable to this caller.')
      }
      return session
    }),
    status: vi.fn(async () => ({
      revision,
      clean: true,
      changes: [],
      truncated: false
    })),
    createSnapshot: vi.fn(async (_session: unknown, _input: unknown, expected: string) => {
      if (expected !== revision) throw new Error('The version-control workspace revision is stale.')
      return {
      id: 'snapshot-1',
      revision,
      createdAt: '2026-07-28T00:00:00.000Z'
      }
    }),
    createReference: vi.fn(async (
      _session: unknown,
      input: { name: string; target: string },
      expected: string
    ) => {
      if (expected !== revision) throw new Error('The version-control workspace revision is stale.')
      return { name: input.name, target: input.target }
    }),
    listSnapshots: vi.fn(async () => ({ snapshots: [] })),
    diff: vi.fn(async () => ({ text: '', truncated: false })),
    readFile: vi.fn(async () => ({ content: '', truncated: false })),
    restore: vi.fn(async (_session: unknown, _input: unknown, expected: string) => {
      if (expected !== revision) throw new Error('The version-control workspace revision is stale.')
      return restore()
    })
  } as unknown as VersionControlCapabilityDependencies['versionControlWorkspaceService']
  const definitions = VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY.createDefinitions({
    versionControlWorkspaceService: service
  })
  const broker = new CapabilityBroker(new CapabilityRegistry(definitions))
  return {
    broker,
    service,
    restore,
    setRevision: (value: string) => {
      revision = value
    }
  }
}

async function openWorkspace(broker: CapabilityBroker) {
  const result = await broker.invoke(uiCaller, {
    actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
    input: { workspaceRoot: uiCaller.workspaceId }
  })
  const output = result.output as Record<string, unknown>
  return capabilityResourceHandleSchema.parse(output.resource)
}

describe('version-control capability provider', () => {
  it('registers the complete public contract on one resource kind', () => {
    const { broker } = createHarness()
    expect(broker.registry.list().map(({ id }) => id)).toEqual([
      VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
      VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
      VERSION_CONTROL_DIFF_ACTION_ID,
      VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
      VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
      VERSION_CONTROL_READ_FILE_ACTION_ID,
      VERSION_CONTROL_RESTORE_ACTION_ID,
      VERSION_CONTROL_STATUS_ACTION_ID
    ])
    expect(
      broker.registry.require(VERSION_CONTROL_RESTORE_ACTION_ID).descriptor
    ).toMatchObject({
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'optimistic', idempotency: 'required' }
    })
  })

  it('binds a workspace handle to its opening owner as well as its workspace', async () => {
    const { broker } = createHarness()
    const resource = await openWorkspace(broker)

    await expect(broker.observe({
      ...uiCaller,
      callerId: 'window-2'
    }, { resource })).rejects.toSatisfy((error) =>
      expectBrokerCode(error, 'observation_failed')
    )
    await expect(broker.invoke({
      ...uiCaller,
      callerId: 'window-2'
    }, {
      actionId: VERSION_CONTROL_STATUS_ACTION_ID,
      resource,
      input: {}
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await expect(broker.observe({
      ...uiCaller,
      workspaceId: '/another-workspace'
    }, { resource })).rejects.toSatisfy((error) =>
      expectBrokerCode(error, 'resource_scope_mismatch')
    )
  })

  it('enforces optimistic revision and confirmation policy before restore', async () => {
    const { broker, restore } = createHarness()
    const resource = await openWorkspace(broker)

    await expect(broker.invoke(uiCaller, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'restore-unapproved',
      resource,
      expectedRevision: resource.semanticRevision,
      input: { target: 'snapshot-1' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'approval_denied'))

    await expect(broker.invoke({
      ...uiCaller,
      approvals: [{
        actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
        invocationId: 'restore-stale',
        mode: 'confirmation' as const
      }]
    }, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'restore-stale',
      resource,
      expectedRevision: 'stale-revision',
      input: { target: 'snapshot-1' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'revision_conflict'))

    await expect(broker.invoke({
      ...uiCaller,
      approvals: [{
        actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
        invocationId: 'restore-approved',
        mode: 'confirmation' as const
      }]
    }, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'restore-approved',
      resource,
      expectedRevision: resource.semanticRevision,
      input: { target: 'snapshot-1' }
    })).resolves.toMatchObject({
      changed: true,
      beforeRevision: 'revision-1',
      afterRevision: 'revision-2',
      output: { ok: true, revision: 'revision-2' }
    })
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('rechecks the live workspace revision inside a mutation handler', async () => {
    const { broker, service, setRevision } = createHarness()
    const resource = await openWorkspace(broker)
    setRevision('revision-external')

    await expect(broker.invoke(uiCaller, {
      actionId: VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
      invocationId: 'snapshot-after-external-change',
      resource,
      expectedRevision: resource.semanticRevision,
      input: { label: 'stale snapshot' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    expect(service.createSnapshot).toHaveBeenCalledTimes(1)
  })

  it('reports a same-revision restore as a no-op', async () => {
    const { broker } = createHarness()
    const resource = await openWorkspace(broker)
    const first = await broker.invoke({
      ...uiCaller,
      approvals: [{
        actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
        invocationId: 'restore-first',
        mode: 'confirmation' as const
      }]
    }, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'restore-first',
      resource,
      expectedRevision: resource.semanticRevision,
      input: { target: 'snapshot-1' }
    })
    const refreshed = capabilityResourceHandleSchema.parse(first.resource)

    await expect(broker.invoke({
      ...uiCaller,
      approvals: [{
        actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
        invocationId: 'restore-no-op',
        mode: 'confirmation' as const
      }]
    }, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'restore-no-op',
      resource: refreshed,
      expectedRevision: refreshed.semanticRevision,
      input: { target: 'snapshot-1' }
    })).resolves.toMatchObject({
      changed: false,
      beforeRevision: 'revision-2',
      afterRevision: 'revision-2'
    })
  })

  it('does not grant the system audience a destructive bypass', async () => {
    const { broker } = createHarness()
    const opened = await broker.invoke({
      audience: 'system',
      callerId: 'domain-runtime',
      workspaceId: '/workspace'
    }, {
      actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      input: { workspaceRoot: '/workspace' }
    })
    const resource = capabilityResourceHandleSchema.parse(
      (opened.output as Record<string, unknown>).resource
    )

    await expect(broker.invoke({
      audience: 'system',
      callerId: 'domain-runtime',
      workspaceId: '/workspace'
    }, {
      actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
      invocationId: 'system-restore',
      resource,
      expectedRevision: resource.semanticRevision,
      input: { target: 'snapshot-1' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'approval_denied'))
  })
})
