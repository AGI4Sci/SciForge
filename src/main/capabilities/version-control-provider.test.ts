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
import {
  CapabilityBroker,
  CapabilityBrokerError,
  type CapabilityBrokerOptions
} from './broker'
import { CapabilityRegistry } from './registry'
import {
  VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY,
  type VersionControlCapabilityDependencies
} from './version-control-provider'
import type {
  VersionControlWorkspaceSession
} from '../services/version-control-workspace-service'

const remoteWorkspaceLocator = {
  contractVersion: 1 as const,
  hostSessionId: 'remote-session-1',
  path: '/workspace'
}

const uiCaller = {
  audience: 'ui' as const,
  callerId: 'window-1',
  workspaceId: '/workspace'
}

const principalA = {
  authority: 'sciforge.identity-access',
  subject: 'person-a',
  assurance: 'local-selection' as const,
  deviceId: 'installation-1',
  identityVersion: 1
}

const principalB = {
  ...principalA,
  subject: 'person-b',
  identityVersion: 2
}

function expectBrokerCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(CapabilityBrokerError)
  expect((error as CapabilityBrokerError).code).toBe(code)
  return true
}

function createHarness(options: CapabilityBrokerOptions = {}) {
  const session = {
    resourceId: 'version-control-session-1',
    ownerId: uiCaller.callerId,
    ownerAudience: uiCaller.audience,
    workspaceId: uiCaller.workspaceId,
    workspaceRoot: uiCaller.workspaceId,
    repositoryRoot: uiCaller.workspaceId
  }
  let openedSession: VersionControlWorkspaceSession = session
  let revision = 'revision-1'
  const restore = vi.fn(async () => {
    revision = 'revision-2'
    return { ok: true as const, revision }
  })
  const service = {
    open: vi.fn(async (
      ownerId: string,
      ownerAudience: 'ui' | 'agent' | 'system',
      workspaceId: string,
      workspaceLocator?: typeof remoteWorkspaceLocator
    ) => {
      openedSession = {
        ...session,
        ownerId,
        ownerAudience,
        workspaceId,
        workspaceRoot: workspaceId,
        repositoryRoot: workspaceId,
        ...(workspaceLocator ? { workspaceLocator } : {})
      }
      return openedSession
    }),
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
      return openedSession
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
  const broker = new CapabilityBroker(new CapabilityRegistry(definitions), options)
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

  it('reuses one stable provider registration when the same owner reopens a workspace', async () => {
    const { broker, service, setRevision } = createHarness()
    const first = await openWorkspace(broker)
    setRevision('revision-2')
    const second = await openWorkspace(broker)

    expect(first.token).not.toBe(second.token)
    expect(second.semanticRevision).toBe('revision-2')
    await expect(broker.observe(uiCaller, { resource: first }))
      .resolves.toMatchObject({ semanticRevision: 'revision-2' })
    await expect(broker.observe(uiCaller, { resource: second }))
      .resolves.toMatchObject({ semanticRevision: 'revision-2' })
    expect(service.open).toHaveBeenCalledTimes(2)
  })

  it('fails closed when one canonical owner workspace changes provider session identity', async () => {
    const { broker, service } = createHarness()
    await openWorkspace(broker)
    vi.mocked(service.open).mockResolvedValueOnce({
      resourceId: 'replacement-version-control-session',
      ownerId: uiCaller.callerId,
      ownerAudience: uiCaller.audience,
      workspaceId: uiCaller.workspaceId,
      workspaceRoot: uiCaller.workspaceId,
      repositoryRoot: uiCaller.workspaceId
    })

    await expect(openWorkspace(broker)).rejects.toMatchObject({ code: 'handler_failed' })
    expect(service.status).toHaveBeenCalledOnce()
  })

  it('binds stable registrations to the exact Principal context lease', async () => {
    let principalContext = { identityVersion: 1, principal: principalA }
    const { broker } = createHarness({
      resolveCurrentPrincipalContext: () => principalContext
    })
    const first = await openWorkspace(broker)

    principalContext = { identityVersion: 2, principal: principalB }
    const second = await openWorkspace(broker)
    expect(second.token).not.toBe(first.token)

    principalContext = { identityVersion: 1, principal: principalA }
    await expect(broker.observe(uiCaller, { resource: first })).resolves.toBeTruthy()
    principalContext = { identityVersion: 2, principal: principalB }
    await expect(broker.observe(uiCaller, { resource: second })).resolves.toBeTruthy()
  })

  it('accounts a provider session before status and rejects new allocation at capacity', async () => {
    const { broker, service } = createHarness()
    vi.mocked(service.status).mockRejectedValueOnce(new Error('status unavailable'))
    await expect(broker.invoke({ ...uiCaller, workspaceId: '/workspace-0' }, {
      actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      input: { workspaceRoot: '/workspace-0' }
    })).rejects.toMatchObject({ code: 'handler_failed' })

    for (let index = 1; index < 512; index += 1) {
      const workspaceId = `/workspace-${index}`
      await broker.invoke({ ...uiCaller, workspaceId }, {
        actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
        input: { workspaceRoot: workspaceId }
      })
    }

    await expect(broker.invoke({ ...uiCaller, workspaceId: '/workspace-0' }, {
      actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      input: { workspaceRoot: '/workspace-0' }
    })).resolves.toBeTruthy()
    expect(service.open).toHaveBeenCalledTimes(513)

    await expect(broker.invoke({ ...uiCaller, workspaceId: '/workspace-over-capacity' }, {
      actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      input: { workspaceRoot: '/workspace-over-capacity' }
    })).rejects.toMatchObject({ code: 'handler_failed' })
    expect(service.open).toHaveBeenCalledTimes(513)
  })

  it('keeps the process-lifetime workspace binding stable after a handle expires', async () => {
    vi.useFakeTimers()
    try {
      const { broker } = createHarness({ handleTtlMs: 5 })
      await openWorkspace(broker)
      await vi.advanceTimersByTimeAsync(6)
      await expect(openWorkspace(broker)).resolves.toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes remote placement into open and advertises only remote host operations', async () => {
    const { broker, service } = createHarness()
    const remoteCaller = { ...uiCaller, workspaceLocator: remoteWorkspaceLocator }
    const opened = await broker.invoke(remoteCaller, {
      actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      input: { workspaceRoot: uiCaller.workspaceId }
    })
    const resource = capabilityResourceHandleSchema.parse(
      (opened.output as Record<string, unknown>).resource
    )

    const observation = await broker.observe(remoteCaller, { resource })
    expect(observation.operations.map((operation) => operation.id)).toEqual([
      VERSION_CONTROL_STATUS_ACTION_ID,
      VERSION_CONTROL_DIFF_ACTION_ID,
      VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID
    ])
    await expect(broker.invoke(remoteCaller, {
      actionId: VERSION_CONTROL_STATUS_ACTION_ID,
      resource,
      input: {}
    })).resolves.toMatchObject({ output: { revision: 'revision-1' } })
    await expect(broker.invoke(remoteCaller, {
      actionId: VERSION_CONTROL_DIFF_ACTION_ID,
      resource,
      input: { from: 'HEAD' }
    })).resolves.toMatchObject({ output: { text: '' } })
    await expect(broker.invoke(remoteCaller, {
      actionId: VERSION_CONTROL_READ_FILE_ACTION_ID,
      resource,
      input: { revision: 'HEAD', path: 'notes.md' }
    })).rejects.toBeInstanceOf(CapabilityBrokerError)

    expect(service.open).toHaveBeenCalledWith(
      uiCaller.callerId,
      uiCaller.audience,
      uiCaller.workspaceId,
      remoteWorkspaceLocator
    )
    expect(service.readFile).not.toHaveBeenCalled()
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
