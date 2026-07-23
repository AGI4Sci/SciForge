import { describe, expect, it, vi } from 'vitest'
import {
  REMOTE_SSH_CAPABILITY_IDS,
  REMOTE_SSH_TARGET_RESOURCE_KIND,
  type RemoteSshLab,
  type RemoteSshTarget
} from './contract.js'
import { domainPackageDefinition } from './definition.js'
import {
  createDomainMainEntry,
  type RemoteSshCapabilityHandlerContext,
  type RemoteSshCapabilityOptions,
  type RemoteSshCapabilityResourceRegistration,
  type RemoteSshServicePort
} from './main.js'

const now = '2026-07-22T00:00:00.000Z'
const executionId = 'ssh_exec_1234567890abcdef'
const transferId = 'ssh_xfer_1234567890abcdef'

const lab: RemoteSshLab = {
  schemaVersion: 2,
  id: 'lab-a',
  displayName: 'Lab A',
  environment: {
    provider: 'vm',
    driver: 'virtualbox',
    vmId: '11111111-2222-4333-8444-555555555555',
    gatewaySshAlias: 'lab-a-gateway'
  },
  maxConcurrentExecutions: 8,
  revision: 'lab-r1',
  createdAt: now,
  updatedAt: now
}

const target: RemoteSshTarget = {
  schemaVersion: 2,
  id: 'gpu-01',
  labId: lab.id,
  displayName: 'GPU 01',
  sshAlias: 'lab-a-gpu01',
  labels: { gpu: 'a100' },
  capabilities: ['shell', 'file-transfer'],
  maxConcurrentExecutions: 2,
  revision: 'target-r1',
  createdAt: now,
  updatedAt: now
}

function service(): RemoteSshServicePort {
  return {
    listLabs: vi.fn(async () => ({ labs: [lab] })),
    saveLab: vi.fn(async () => ({ lab })),
    deleteLab: vi.fn(async () => ({ deletedLabId: lab.id })),
    getLabEnvironment: vi.fn(async () => ({
      labId: lab.id,
      provider: lab.environment.provider,
      state: 'ready' as const,
      consoleAvailable: true,
      checkedAt: now
    })),
    ensureLabEnvironment: vi.fn(async () => ({
      labId: lab.id,
      provider: lab.environment.provider,
      state: 'login-required' as const,
      consoleAvailable: true,
      checkedAt: now
    })),
    openLabEnvironmentConsole: vi.fn(async () => ({
      labId: lab.id,
      presentation: { kind: 'opened' as const }
    })),
    stopLabEnvironment: vi.fn(async () => ({
      labId: lab.id,
      provider: lab.environment.provider,
      state: 'stopped' as const,
      consoleAvailable: true,
      checkedAt: now
    })),
    getBinding: vi.fn(async (workspaceId) => ({
      binding: {
        schemaVersion: 2 as const,
        workspaceId,
        allowedTargetIds: [target.id],
        revision: 'binding-r1',
        updatedAt: now
      }
    })),
    saveBinding: vi.fn(async (workspaceId, input) => ({
      binding: {
        schemaVersion: 2 as const,
        workspaceId,
        allowedTargetIds: input.allowedTargetIds,
        revision: 'binding-r2',
        updatedAt: now
      }
    })),
    listTargetCatalog: vi.fn(async () => [target]),
    listTargets: vi.fn(async () => [target]),
    saveTarget: vi.fn(async () => ({ target })),
    deleteTarget: vi.fn(async () => ({ deletedTargetId: target.id })),
    observeTarget: vi.fn(async () => ({
      target,
      activeExecutions: 0,
      observedAt: now
    })),
    probeTarget: vi.fn(async () => ({
      targetId: target.id,
      target: { status: 'reachable' as const, latencyMs: 7 },
      ready: true,
      checkedAt: now
    })),
    executeCommand: vi.fn(async () => ({
      ok: true as const,
      executionId,
      targetId: target.id,
      exitCode: 0 as const,
      stdout: 'ok\n',
      stderr: '',
      outputTruncated: false,
      startedAt: now,
      completedAt: now
    })),
    cancelCommand: vi.fn(async (_workspaceId, input) => ({
      executionId: input.executionId,
      cancelled: true
    })),
    uploadFile: vi.fn(async () => ({
      ok: true as const,
      transferId,
      targetId: target.id,
      direction: 'upload' as const,
      localPath: 'inputs/job.sh',
      remotePath: '/project/jobs/job.sh',
      sizeBytes: 42,
      completedAt: now
    })),
    downloadFile: vi.fn(async () => ({
      ok: true as const,
      transferId,
      targetId: target.id,
      direction: 'download' as const,
      localPath: 'outputs/result.txt',
      remotePath: '/project/jobs/result.txt',
      sizeBytes: 42,
      completedAt: now
    })),
    close: vi.fn()
  }
}

function buildEntry() {
  const definitions: RemoteSshCapabilityOptions[] = []
  const services: RemoteSshServicePort[] = []
  const entry = createDomainMainEntry({
    getUserDataDir: () => '/tmp/remote-ssh-test',
    defineCapability: (definition) => {
      definitions.push(definition as RemoteSshCapabilityOptions)
      return definition
    },
    createService: () => {
      const next = service()
      services.push(next)
      return next
    }
  })
  const factory = entry.contributions[0]!.value as {
    policy: {
      directTransportPrefixes: readonly string[]
      allowedDirectTransports: readonly string[]
    }
    createDefinitions(): readonly RemoteSshCapabilityOptions[]
  }
  factory.createDefinitions()
  return { entry, factory, definitions, services }
}

function context(options: Readonly<{
  audience?: 'ui' | 'agent' | 'system'
  workspaceId?: string
  resource?: RemoteSshCapabilityHandlerContext['resource']
  signal?: AbortSignal
  issueResource?: (registration: RemoteSshCapabilityResourceRegistration) => unknown
}> = {}): RemoteSshCapabilityHandlerContext {
  return {
    caller: {
      audience: options.audience ?? 'agent',
      ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId })
    },
    ...(options.resource === undefined ? {} : { resource: options.resource }),
    issueResource: options.issueResource ?? (() => ({
      token: 'cap_12345678901234567890',
      semanticRevision: target.revision,
      expiresAt: '2026-07-23T00:00:00.000Z'
    })),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  }
}

function definition(
  definitions: readonly RemoteSshCapabilityOptions[],
  id: string
): RemoteSshCapabilityOptions {
  const match = definitions.find((candidate) => candidate.id === id)
  if (!match) throw new Error(`Missing capability ${id}.`)
  return match
}

describe('Remote SSH main domain entry', () => {
  it('matches the manifest, owns one lazy disposable service, and forbids direct transport', async () => {
    const harness = buildEntry()

    expect(harness.entry.definition).toBe(domainPackageDefinition)
    expect(harness.entry.contributions.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'main.capability-factory:remote-ssh.capabilities'
    ])
    expect(harness.definitions).toHaveLength(Object.keys(REMOTE_SSH_CAPABILITY_IDS).length)
    expect(harness.services).toHaveLength(0)
    expect(harness.factory.policy).toMatchObject({
      directTransportPrefixes: [],
      allowedDirectTransports: []
    })

    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.listLabs)
      .handler({}, context({ audience: 'ui' }))
    expect(harness.services).toHaveLength(1)

    harness.entry.contributions[0]!.onDispose?.()
    expect(harness.services[0]!.close).toHaveBeenCalledOnce()
    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.listLabs)
      .handler({}, context({ audience: 'ui' }))
    expect(harness.services).toHaveLength(2)
  })

  it('governs every mutation and exposes configuration mutations only to UI', () => {
    const { definitions } = buildEntry()
    const uiOnlyIds = new Set<string>([
      REMOTE_SSH_CAPABILITY_IDS.listLabs,
      REMOTE_SSH_CAPABILITY_IDS.saveLab,
      REMOTE_SSH_CAPABILITY_IDS.deleteLab,
      REMOTE_SSH_CAPABILITY_IDS.getLabEnvironment,
      REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment,
      REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole,
      REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment,
      REMOTE_SSH_CAPABILITY_IDS.getBinding,
      REMOTE_SSH_CAPABILITY_IDS.saveBinding,
      REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog,
      REMOTE_SSH_CAPABILITY_IDS.saveTarget,
      REMOTE_SSH_CAPABILITY_IDS.deleteTarget
    ])
    const optimisticResourceMutationIds = new Set<string>([
      REMOTE_SSH_CAPABILITY_IDS.executeCommand,
      REMOTE_SSH_CAPABILITY_IDS.uploadFile,
      REMOTE_SSH_CAPABILITY_IDS.downloadFile
    ])

    for (const capability of definitions) {
      if (capability.effect !== 'read') {
        expect(capability.approval, capability.id).toBe('confirmation')
        expect(capability.concurrency.idempotency, capability.id).toBe('required')
      } else {
        expect(capability.approval, capability.id).toBe('none')
        expect(capability.concurrency.idempotency, capability.id).toBe('none')
      }
      if (uiOnlyIds.has(capability.id)) expect(capability.audiences).toEqual(['ui'])
      else if (capability.effect !== 'read') expect(capability.audiences).toEqual(['ui', 'agent'])
      else expect(capability.audiences).toEqual(['ui', 'agent', 'system'])
      expect(capability.concurrency.revision, capability.id).toBe(
        optimisticResourceMutationIds.has(capability.id) ? 'optimistic' : 'none'
      )
    }
    expect(definition(definitions, REMOTE_SSH_CAPABILITY_IDS.executeCommand).effect)
      .toBe('destructive')
    expect(definition(definitions, REMOTE_SSH_CAPABILITY_IDS.downloadFile).effect)
      .toBe('workspace-write')
    expect(definition(definitions, REMOTE_SSH_CAPABILITY_IDS.uploadFile).effect)
      .toBe('external-write')
  })

  it('registers provider-neutral environment lifecycle and console capabilities', async () => {
    const harness = buildEntry()
    const environmentIds = [
      REMOTE_SSH_CAPABILITY_IDS.getLabEnvironment,
      REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment,
      REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole,
      REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment
    ]

    for (const id of environmentIds) {
      const capability = definition(harness.definitions, id)
      expect(capability.tags).toContain('environment')
      expect(`${capability.title} ${capability.description} ${capability.tags.join(' ')}`)
        .not.toMatch(/docker|atrust/i)
    }

    const input = { labId: lab.id, expectedRevision: lab.revision }
    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment)
      .handler(input, context({ audience: 'ui' }))
    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole)
      .handler(input, context({ audience: 'ui' }))
    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment)
      .handler(input, context({ audience: 'ui' }))

    expect(harness.services[0]!.ensureLabEnvironment)
      .toHaveBeenCalledWith(lab.id, lab.revision)
    expect(harness.services[0]!.openLabEnvironmentConsole)
      .toHaveBeenCalledWith(lab.id, lab.revision)
    expect(harness.services[0]!.stopLabEnvironment)
      .toHaveBeenCalledWith(lab.id, lab.revision)
  })

  it('lists workspace-filtered targets and issues canonical observable resources', async () => {
    const harness = buildEntry()
    const list = definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.listTargets)
    let registration: RemoteSshCapabilityResourceRegistration | undefined
    const result = await list.handler({}, context({
      workspaceId: '/workspace',
      audience: 'agent',
      issueResource: (value) => {
        registration = value
        return {
          token: 'cap_12345678901234567890',
          semanticRevision: value.semanticRevision,
          expiresAt: '2026-07-23T00:00:00.000Z'
        }
      }
    }))

    expect(harness.services[0]!.listTargets).toHaveBeenCalledWith('/workspace')
    expect(result.output).toMatchObject({
      targets: [{ target: { id: target.id }, resource: { semanticRevision: target.revision } }]
    })
    expect(JSON.stringify(result.output)).not.toContain(target.sshAlias)
    expect(registration).toMatchObject({
      resourceId: target.id,
      resourceKind: REMOTE_SSH_TARGET_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: target.revision
    })
    const agentObservation = await registration!.observe({ audience: 'agent' })
    expect(agentObservation.operationIds).toEqual([
      REMOTE_SSH_CAPABILITY_IDS.probeTarget,
      REMOTE_SSH_CAPABILITY_IDS.executeCommand,
      REMOTE_SSH_CAPABILITY_IDS.uploadFile,
      REMOTE_SSH_CAPABILITY_IDS.downloadFile
    ])
    expect(JSON.stringify(agentObservation.state)).not.toContain(target.sshAlias)
    expect((await registration!.observe({ audience: 'system' })).operationIds).toEqual([
      REMOTE_SSH_CAPABILITY_IDS.probeTarget
    ])

    vi.mocked(harness.services[0]!.observeTarget).mockResolvedValue({
      target: { ...target, capabilities: ['shell'], revision: 'target-r2' },
      activeExecutions: 0,
      observedAt: now
    })
    expect((await registration!.observe({ audience: 'agent' })).operationIds).toEqual([
      REMOTE_SSH_CAPABILITY_IDS.probeTarget,
      REMOTE_SSH_CAPABILITY_IDS.executeCommand
    ])

    const catalog = await definition(
      harness.definitions,
      REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog
    ).handler({}, context({ audience: 'ui' }))
    expect(catalog.output).toMatchObject({ targets: [{ sshAlias: target.sshAlias }] })
  })

  it('derives workspace and target scope from Broker context and forwards cancellation', async () => {
    const harness = buildEntry()
    const abort = new AbortController()
    const targetContext = context({
      workspaceId: '/workspace',
      resource: {
        resourceId: target.id,
        workspaceId: '/workspace',
        semanticRevision: target.revision
      },
      signal: abort.signal
    })

    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.probeTarget)
      .handler({}, targetContext)
    expect(harness.services[0]!.probeTarget).toHaveBeenCalledWith(
      '/workspace', target.id, abort.signal
    )

    const commandInput = { executionId, script: 'nvidia-smi\n', timeoutMs: 5_000 }
    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.executeCommand)
      .handler(commandInput, targetContext)
    expect(harness.services[0]!.executeCommand).toHaveBeenCalledWith(
      '/workspace', target.id, target.revision, commandInput, abort.signal
    )

    await definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.cancelCommand)
      .handler({ executionId }, context({ workspaceId: '/workspace' }))
    expect(harness.services[0]!.cancelCommand).toHaveBeenCalledWith('/workspace', { executionId })

    await expect(
      definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.getBinding)
        .handler({}, context({ audience: 'ui' }))
    ).rejects.toThrow('workspace-scoped caller')
    await expect(
      definition(harness.definitions, REMOTE_SSH_CAPABILITY_IDS.probeTarget).handler({}, context({
        workspaceId: '/other-workspace',
        resource: {
          resourceId: target.id,
          workspaceId: '/workspace',
          semanticRevision: target.revision
        }
      }))
    ).rejects.toThrow('does not belong to the caller workspace')
  })
})
