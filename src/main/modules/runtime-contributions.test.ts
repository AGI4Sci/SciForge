import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  type TrustedDomainProcessEntryInput
} from '@sciforge/domain-sdk'
import {
  MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
  MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
  MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
  type DomainAgentArtifactConsumer,
  type DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import { DomainModuleCatalog } from './catalog'
import {
  activateMainRuntimeContributions,
  createMainActionGuardEvaluator,
  createMainSystemCapabilityInvoker,
  listMainAgentArtifactConsumers
} from './runtime-contributions'

describe('main runtime contributions', () => {
  it('activates in catalog order and disposes in reverse with owner-scoped signals', async () => {
    const events: string[] = []
    const contexts: DomainMainRuntimeLifecycleContext[] = []
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.low', '@fixture/low', 10, [{
        id: 'fixture.low.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            contexts.push(context)
            events.push('activate:low')
            return () => events.push(`dispose:low:${context.signal.aborted}`)
          }
        }
      }]),
      fixtureEntry('fixture.high', '@fixture/high', 100, [{
        id: 'fixture.high.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            contexts.push(context)
            events.push('activate:high')
            return () => events.push(`dispose:high:${context.signal.aborted}`)
          }
        }
      }])
    ])

    const activated = await activateMainRuntimeContributions(catalog, runtimeHost())

    expect(events).toEqual(['activate:high', 'activate:low'])
    expect(contexts.map((context) => context.owner.moduleId)).toEqual([
      'fixture.high',
      'fixture.low'
    ])
    expect(contexts.every((context) => Object.isFrozen(context))).toBe(true)
    expect(contexts.every((context) => !context.signal.aborted)).toBe(true)
    await expect(contexts[0]?.enablement.isEnabled()).resolves.toBe(true)

    await activated.dispose()
    await activated.dispose()

    expect(activated.disposed).toBe(true)
    expect(events).toEqual([
      'activate:high',
      'activate:low',
      'dispose:low:true',
      'dispose:high:true'
    ])
  })

  it('validates all projected contributions before activating any runtime', async () => {
    const activate = vi.fn()
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.runtime', '@fixture/runtime', 100, [{
        id: 'fixture.runtime.lifecycle',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: { activate }
      }]),
      fixtureEntry('fixture.invalid', '@fixture/invalid', 10, [{
        id: 'fixture.invalid.consumer',
        kind: MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
        value: { consume: 'invalid' }
      }])
    ])

    await expect(activateMainRuntimeContributions(catalog, runtimeHost()))
      .rejects.toMatchObject({ code: 'invalid_contribution_value' })
    expect(activate).not.toHaveBeenCalled()
  })

  it('rolls back already activated runtimes when a later activation fails', async () => {
    const dispose = vi.fn()
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.first', '@fixture/first', 100, [{
        id: 'fixture.first.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: { activate: () => dispose }
      }]),
      fixtureEntry('fixture.second', '@fixture/second', 10, [{
        id: 'fixture.second.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: () => {
            throw new Error('activation failed')
          }
        }
      }])
    ])

    await expect(activateMainRuntimeContributions(catalog, runtimeHost()))
      .rejects.toThrow('activation failed')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('projects artifact consumers without exposing catalog metadata to callers', async () => {
    const consumer: DomainAgentArtifactConsumer = { consume: vi.fn() }
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.consumer', '@fixture/consumer', 100, [{
      id: 'fixture.consumer.artifacts',
      kind: MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
      value: consumer
    }]))

    expect(listMainAgentArtifactConsumers(catalog)).toEqual([consumer])
    const activated = await activateMainRuntimeContributions(catalog, runtimeHost())

    expect(activated.artifactConsumers).toEqual([consumer])
    expect(Object.isFrozen(activated.artifactConsumers)).toBe(true)
  })

  it('evaluates matching action guards in catalog order and stops on the first rejection', async () => {
    const events: string[] = []
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.first', '@fixture/first', 100, [{
        id: 'fixture.first.guard',
        kind: MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
        priority: 100,
        value: {
          actions: ['write.export'],
          evaluate: async () => {
            events.push('first')
            return { allowed: true, metadata: { audit: 'fresh' } }
          }
        }
      }]),
      fixtureEntry('fixture.reject', '@fixture/reject', 50, [{
        id: 'fixture.reject.guard',
        kind: MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
        priority: 50,
        value: {
          actions: ['write.export'],
          evaluate: () => {
            events.push('reject')
            return {
              allowed: false,
              message: 'Export requires confirmation.',
              metadata: { requiresConfirmation: true }
            }
          }
        }
      }]),
      fixtureEntry('fixture.last', '@fixture/last', 10, [{
        id: 'fixture.last.guard',
        kind: MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
        priority: 10,
        value: {
          actions: ['write.export'],
          evaluate: () => {
            events.push('last')
            return { allowed: true }
          }
        }
      }])
    ])

    const evaluator = createMainActionGuardEvaluator(catalog)

    await expect(evaluator.evaluate({
      actionId: 'write.export',
      payload: { overrideConfirmed: false }
    })).resolves.toEqual({
      allowed: false,
      message: 'Export requires confirmation.',
      metadata: {
        'fixture.first.guard': { audit: 'fresh' },
        'fixture.reject.guard': { requiresConfirmation: true }
      }
    })
    expect(events).toEqual(['first', 'reject'])
  })

  it('ignores unrelated action guards and rejects non-JSON-safe guard metadata', async () => {
    const unrelated = vi.fn(() => ({ allowed: false }))
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.unrelated', '@fixture/unrelated', 100, [{
        id: 'fixture.unrelated.guard',
        kind: MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
        value: {
          actions: ['workspace.delete'],
          evaluate: unrelated
        }
      }]),
      fixtureEntry('fixture.invalid', '@fixture/invalid', 50, [{
        id: 'fixture.invalid.guard',
        kind: MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
        value: {
          actions: ['write.export'],
          evaluate: () => ({ allowed: true, metadata: { invalid: undefined } })
        }
      }])
    ])
    const evaluator = createMainActionGuardEvaluator(catalog)

    await expect(evaluator.evaluate({
      actionId: 'write.export',
      payload: { path: '/tmp/report.md' }
    })).rejects.toThrow('fixture.invalid.guard returned non-JSON-safe metadata')
    expect(unrelated).not.toHaveBeenCalled()
  })

  it('invokes package contracts as an idempotent system capability caller', async () => {
    const execute = vi.fn(async (input: { value: string }) => ({
      output: { echoed: input.value }
    }))
    const broker = new CapabilityBroker(new CapabilityRegistry([
      defineCapability({
        id: 'fixture.runtime.compute',
        version: '1.0.0',
        title: 'Runtime compute',
        description: 'Exercises the generic runtime capability facade.',
        audiences: ['system'],
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: z.object({ value: z.string() }).strict(),
        outputSchema: z.object({ echoed: z.string() }).strict(),
        handler: execute
      })
    ]))
    const invoker = createMainSystemCapabilityInvoker(broker, {
      callerId: 'fixture.runtime',
      createInvocationId: () => 'generated-invocation'
    })
    const contract = {
      actionId: 'fixture.runtime.compute',
      effect: 'compute' as const,
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ echoed: z.string() }).strict()
    }

    await expect(invoker.invoke(contract, { value: 'one' }, {
      workspaceId: '/workspace',
      idempotencyKey: 'stable-invocation'
    })).resolves.toEqual({ echoed: 'one' })
    await expect(invoker.invoke(contract, { value: 'one' }, {
      workspaceId: '/workspace',
      idempotencyKey: 'stable-invocation'
    })).resolves.toEqual({ echoed: 'one' })

    expect(execute).toHaveBeenCalledOnce()
    expect(broker.listAuditRecords().map(({ caller, status, invocationId }) => ({
      caller,
      status,
      invocationId
    }))).toEqual([
      {
        caller: {
          audience: 'system',
          callerId: 'fixture.runtime',
          workspaceId: '/workspace'
        },
        status: 'success',
        invocationId: 'stable-invocation'
      },
      {
        caller: {
          audience: 'system',
          callerId: 'fixture.runtime',
          workspaceId: '/workspace'
        },
        status: 'replayed',
        invocationId: 'stable-invocation'
      }
    ])
  })

  it('only propagates approval from a matching active destructive action', async () => {
    const inner = defineCapability({
      id: 'fixture.vcs.restore',
      version: '1.0.0',
      title: 'Restore snapshot',
      description: 'Restores one resource revision.',
      audiences: ['system'],
      scope: 'resource',
      resourceKinds: ['fixture.workspace'],
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      inputSchema: z.object({ snapshotId: z.string() }).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict(),
      handler: async () => ({
        output: { restored: true },
        changed: true,
        semanticRevision: 'revision-2'
      })
    })
    const registry = new CapabilityRegistry([inner])
    const broker = new CapabilityBroker(registry)
    const invoker = createMainSystemCapabilityInvoker(broker, {
      callerId: 'fixture.package',
      createInvocationId: () => 'inner-invocation'
    })
    const resource = broker.issueResourceHandle({
      audience: 'system',
      callerId: 'fixture.package',
      workspaceId: '/workspace'
    }, {
      resourceId: '/workspace',
      resourceKind: 'fixture.workspace',
      workspaceId: '/workspace',
      audiences: ['system'],
      semanticRevision: 'revision-1',
      observe: async () => ({
        state: {},
        semanticRevision: 'revision-1'
      })
    })
    const contract = {
      actionId: 'fixture.vcs.restore',
      effect: 'destructive' as const,
      inputSchema: z.object({ snapshotId: z.string() }).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict()
    }

    await expect(invoker.invoke(contract, { snapshotId: 'snapshot-1' }, {
      workspaceId: '/workspace',
      resource,
      expectedRevision: 'revision-1',
      authorization: { mode: 'inherit-current-action' }
    })).rejects.toThrow('cannot inherit approval')

    registry.register(defineCapability({
      id: 'fixture.checkpoints.restore',
      version: '1.0.0',
      title: 'Restore checkpoint',
      description: 'Approved package operation wrapping the generic VCS restore.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ snapshotId: z.string() }).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict(),
      handler: async (input) => ({
        output: await invoker.invoke(contract, input, {
          workspaceId: '/workspace',
          idempotencyKey: 'inner-from-outer',
          resource,
          expectedRevision: 'revision-1',
          authorization: { mode: 'inherit-current-action' }
        })
      })
    }))

    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'renderer',
      workspaceId: '/workspace',
      approvals: [{
        actionId: 'fixture.checkpoints.restore',
        invocationId: 'outer-invocation',
        mode: 'confirmation'
      }]
    }, {
      actionId: 'fixture.checkpoints.restore',
      invocationId: 'outer-invocation',
      input: { snapshotId: 'snapshot-1' }
    })).resolves.toMatchObject({
      output: { restored: true }
    })
  })
})

function runtimeHost() {
  return {
    userDataDir: '/tmp/sciforge-user-data',
    appRoot: '/tmp/sciforge-app',
    environment: Object.freeze({ NODE_ENV: 'test' }),
    agentThreads: {
      list: vi.fn(async () => []),
      read: vi.fn(async ({ runtimeId, threadId }: { runtimeId: string; threadId: string }) => ({
        id: threadId,
        runtimeId,
        watermark: '0',
        turns: [],
        artifacts: []
      })),
      hasActiveTurns: vi.fn(() => false)
    },
    capabilities: {
      invoke: vi.fn(async (_contract, input) => input)
    },
    modelAccess: {
      textReasoner: vi.fn(async () => null)
    },
    enablement: {
      isEnabled: vi.fn(async (_moduleId: string) => true),
      subscribe: vi.fn((_moduleId: string, _listener: (enabled: boolean) => void) =>
        () => undefined
      )
    },
    log: vi.fn()
  }
}

function fixtureEntry(
  moduleId: string,
  packageName: string,
  priority: number,
  contributions: ReadonlyArray<{
    id: string
    kind: string
    priority?: number
    value: unknown
  }>
): TrustedDomainProcessEntryInput<unknown> {
  return {
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time',
      packageName,
      module: {
        id: moduleId,
        displayName: moduleId,
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority
      },
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: contributions.map(({ id, kind, priority }) => ({
          id,
          kind,
          ...(priority === undefined ? {} : { priority })
        }))
      }]
    },
    contributions
  }
}
