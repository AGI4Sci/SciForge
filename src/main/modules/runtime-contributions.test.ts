import { createHash } from 'node:crypto'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  type DomainPackageJsonValue,
  type TrustedDomainProcessEntryInput
} from '@sciforge/domain-sdk'
import {
  MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
  MAIN_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
  MAIN_SYSTEM_CAPABILITY_GRANT_CONTRIBUTION_KIND,
  canonicalizeDomainMainFiniteCapabilityBatchPlan,
  defineDomainMainSystemCapabilityGrant,
  domainMainFiniteCapabilityBatchPlanDigestSchema,
  domainMainFiniteCapabilityBatchPlanSchema,
  type DomainArtifactConsumer,
  type DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import {
  MAIN_WORKFLOW_EXECUTION_RECEIPT_PROVIDER_CONTRIBUTION_KIND,
  defineDomainWorkflowExecutionReceiptProvider
} from '@sciforge/domain-sdk/workflow-template'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityBroker, CapabilityBrokerError } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import { DomainModuleCatalog } from './catalog'
import {
  activateMainRuntimeContributions,
  createMainActionGuardEvaluator,
  createMainSystemCapabilityInvokerFactory,
  listMainArtifactConsumers,
  listMainExtensionContributions
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
        kind: MAIN_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
        value: { consume: 'invalid' }
      }])
    ])

    await expect(activateMainRuntimeContributions(catalog, runtimeHost()))
      .rejects.toMatchObject({ code: 'invalid_contribution_value' })
    expect(activate).not.toHaveBeenCalled()
  })

  it('projects package-owned workflow receipt providers through the public lifecycle contract', async () => {
    const contexts: DomainMainRuntimeLifecycleContext[] = []
    const provider = defineDomainWorkflowExecutionReceiptProvider({
      id: 'fixture.receipts',
      matches: (workflow) => workflow === 'fixture'
    })
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.workflow', '@fixture/workflow', 100, [
      {
        id: 'fixture.workflow.receipts',
        kind: MAIN_WORKFLOW_EXECUTION_RECEIPT_PROVIDER_CONTRIBUTION_KIND,
        value: provider
      },
      {
        id: 'fixture.workflow.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            contexts.push(context)
          }
        }
      }
    ]))

    const activated = await activateMainRuntimeContributions(catalog, runtimeHost())
    expect(contexts[0]?.workflowExecutionReceipts).toEqual([provider])
    expect(Object.isFrozen(contexts[0]?.workflowExecutionReceipts)).toBe(true)
    await activated.dispose()
  })

  it('projects declared main extensions through the generic lifecycle host', async () => {
    const contexts: DomainMainRuntimeLifecycleContext[] = []
    const executor = Object.freeze({
      id: 'fixture-provider',
      version: 'runtime-cannot-override-declaration',
      execute: vi.fn()
    })
    const contract = Object.freeze({
      location: 'fixture.resource-executor',
      providerId: 'fixture-provider'
    })
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.extensions', '@fixture/extensions', 100, [
      {
        id: 'fixture.extensions.executor',
        kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
        version: '1.3.0',
        publicRelease: 'forbidden',
        contract,
        value: executor
      },
      {
        id: 'fixture.extensions.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            contexts.push(context)
          }
        }
      }
    ]))

    expect(listMainExtensionContributions(catalog)).toMatchObject([{
      id: 'fixture.extensions.executor',
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: '@fixture/extensions',
      version: '1.3.0',
      publicRelease: 'forbidden',
      contract,
      value: executor
    }])
    const activated = await activateMainRuntimeContributions(catalog, runtimeHost())
    expect(contexts[0]?.contributions?.list(MAIN_EXTENSION_CONTRIBUTION_KIND))
      .toEqual(listMainExtensionContributions(catalog))
    await activated.dispose()
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
    const consumer: DomainArtifactConsumer = { consume: vi.fn() }
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.consumer', '@fixture/consumer', 100, [{
      id: 'fixture.consumer.artifacts',
      kind: MAIN_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
      value: consumer
    }]))

    expect(listMainArtifactConsumers(catalog)).toEqual([consumer])
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
    const invoker = createMainSystemCapabilityInvokerFactory(broker, {
      createInvocationId: () => 'generated-invocation'
    }).forDomain({ moduleId: 'fixture.runtime', moduleVersion: '1.0.0' })
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
          callerId: 'domain-runtime:fixture.runtime',
          workspaceId: '/workspace'
        },
        status: 'success',
        invocationId: 'stable-invocation'
      },
      {
        caller: {
          audience: 'system',
          callerId: 'domain-runtime:fixture.runtime',
          workspaceId: '/workspace'
        },
        status: 'replayed',
        invocationId: 'stable-invocation'
      }
    ])
  })

  it('projects only canonical Principal and execution-context digests to system handlers', async () => {
    const principal = Object.freeze({
      authority: 'sciforge.local-identity',
      subject: 'person-1',
      assurance: 'local-selection' as const,
      deviceId: 'device-1',
      identityVersion: 7
    })
    const capability = defineCapability({
      id: 'fixture.runtime.execution-context',
      version: '1.0.0',
      title: 'Inspect system execution binding',
      description: 'Returns only Host-derived digests for a system execution.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        principalSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        executionContextDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        rawExecutionContextPresent: z.boolean()
      }).strict(),
      handler: async (_input, context) => {
        const caller = context.caller as typeof context.caller & Readonly<{
          principalSnapshotDigest?: string
          executionContextDigest?: string
          systemExecutionContext?: unknown
        }>
        return {
          output: {
            principalSnapshotDigest: caller.principalSnapshotDigest ?? '',
            executionContextDigest: caller.executionContextDigest ?? '',
            rawExecutionContextPresent: Object.hasOwn(caller, 'systemExecutionContext')
          }
        }
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
      resolveCurrentPrincipal: () => principal
    })
    const invoker = createMainSystemCapabilityInvokerFactory(broker)
      .forDomain({ moduleId: 'fixture.runtime', moduleVersion: '1.0.0' })
    const contract = {
      actionId: capability.descriptor.id,
      effect: 'compute' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: capability.outputSchema
    }
    const executionContext = {
      taskId: 'task-1',
      contractVersion: 1,
      executionId: 'execution-1',
      projectId: 'project-1'
    }
    const options = {
      workspaceId: '/workspace',
      idempotencyKey: 'fixture-execution-context-1',
      systemExecutionContext: executionContext
    }

    await expect(invoker.invoke(contract, {}, options)).resolves.toEqual({
      principalSnapshotDigest: createHash('sha256').update(
        '{"assurance":"local-selection","authority":"sciforge.local-identity",' +
        '"deviceId":"device-1","identityVersion":7,"subject":"person-1"}'
      ).digest('hex'),
      executionContextDigest: createHash('sha256').update(
        '{"contractVersion":1,"executionId":"execution-1",' +
        '"projectId":"project-1","taskId":"task-1"}'
      ).digest('hex'),
      rawExecutionContextPresent: false
    })
    const callerAuthoredDigestOptions = {
      ...options,
      idempotencyKey: 'fixture-execution-context-forged-digest',
      executionContextDigest: 'f'.repeat(64),
      principalSnapshotDigest: 'e'.repeat(64)
    }
    await expect(invoker.invoke(contract, {}, callerAuthoredDigestOptions)).resolves.toEqual({
      principalSnapshotDigest: createHash('sha256').update(
        '{"assurance":"local-selection","authority":"sciforge.local-identity",' +
        '"deviceId":"device-1","identityVersion":7,"subject":"person-1"}'
      ).digest('hex'),
      executionContextDigest: createHash('sha256').update(
        '{"contractVersion":1,"executionId":"execution-1",' +
        '"projectId":"project-1","taskId":"task-1"}'
      ).digest('hex'),
      rawExecutionContextPresent: false
    })
    await expect(invoker.invoke(contract, {}, {
      ...options,
      systemExecutionContext: { ...executionContext, executionId: 'execution-2' }
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(JSON.stringify(broker.listAuditRecords())).not.toContain('execution-1')
  })

  it('issues a fresh Host invocation identity for execution-bound system reads', async () => {
    const principal = Object.freeze({
      authority: 'sciforge.local-identity',
      subject: 'person-1',
      assurance: 'local-selection' as const,
      deviceId: 'device-1',
      identityVersion: 1
    })
    const capability = defineCapability({
      id: 'fixture.runtime.execution-read',
      version: '1.0.0',
      title: 'Read system execution state',
      description: 'Binds each fresh system read to one Host invocation identity.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ invocationId: z.string().min(1) }).strict(),
      handler: async (_input, context) => ({
        output: { invocationId: context.invocationId ?? '' }
      })
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
      resolveCurrentPrincipal: () => principal
    })
    let sequence = 0
    const invoker = createMainSystemCapabilityInvokerFactory(broker, {
      createInvocationId: () => `generated-system-read-${++sequence}`
    }).forDomain({ moduleId: 'fixture.runtime', moduleVersion: '1.0.0' })
    const contract = {
      actionId: capability.descriptor.id,
      effect: 'read' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: capability.outputSchema
    }
    const options = {
      workspaceId: '/workspace',
      systemExecutionContext: { contractVersion: 1, executionId: 'execution-1' }
    }

    await expect(invoker.invoke(contract, {}, options)).resolves.toEqual({
      invocationId: 'generated-system-read-1'
    })
    await expect(invoker.invoke(contract, {}, options)).resolves.toEqual({
      invocationId: 'generated-system-read-2'
    })
  })

  it('projects a package-scoped caller and only its declared lifecycle grants', async () => {
    let lifecycleContext: DomainMainRuntimeLifecycleContext | undefined
    const capability = defineCapability({
      id: 'fixture.authority.inspect',
      version: '1.0.0',
      title: 'Inspect runtime authority',
      description: 'Returns Host-authenticated package authority for the lifecycle test.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        callerId: z.string(),
        capabilityGrants: z.array(z.string())
      }).strict(),
      handler: async (_input, context) => ({
        output: {
          callerId: context.caller.callerId,
          capabilityGrants: [...(context.caller.capabilityGrants ?? [])]
        }
      })
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.provider', '@fixture/provider', 200, [{
        id: 'fixture.authority.inspect',
        kind: MAIN_SYSTEM_CAPABILITY_GRANT_CONTRIBUTION_KIND,
        value: defineDomainMainSystemCapabilityGrant({
          id: 'fixture.authority.inspect',
          eligibility: 'trusted-domain-runtime',
          description: 'Allows inspection of the generic authority projection.'
        })
      }]),
      fixtureEntry('fixture.granted', '@fixture/granted', 100, [{
        id: 'fixture.granted.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        contract: { requestedSystemCapabilityGrants: ['fixture.authority.inspect'] },
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            lifecycleContext = context
          }
        }
      }])
    ])

    const activated = await activateMainRuntimeContributions(
      catalog,
      runtimeHost(createMainSystemCapabilityInvokerFactory(broker))
    )
    expect(lifecycleContext).toBeDefined()
    expect(Object.hasOwn(lifecycleContext!.capabilities, 'forDomain')).toBe(false)
    await expect(lifecycleContext!.capabilities.invoke({
      actionId: capability.descriptor.id,
      effect: 'read',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        callerId: z.string(),
        capabilityGrants: z.array(z.string())
      }).strict()
    }, {}, { workspaceId: '/workspace' })).resolves.toEqual({
      callerId: 'domain-runtime:fixture.granted',
      capabilityGrants: ['fixture.authority.inspect']
    })
    await activated.dispose()
  })

  it('rejects an unknown lifecycle grant before activating package side effects', async () => {
    const activate = vi.fn()
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.unknown', '@fixture/unknown', 100, [{
      id: 'fixture.unknown.runtime',
      kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
      contract: { requestedSystemCapabilityGrants: ['fixture.authority.unknown'] },
      value: { activate }
    }]))

    await expect(activateMainRuntimeContributions(catalog, runtimeHost()))
      .rejects.toThrow('requests unregistered system capability grant fixture.authority.unknown')
    expect(activate).not.toHaveBeenCalled()
  })

  it('rejects a provider grant whose value does not match its declaration', async () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(fixtureEntry('fixture.provider', '@fixture/provider', 100, [{
      id: 'fixture.authority.declared',
      kind: MAIN_SYSTEM_CAPABILITY_GRANT_CONTRIBUTION_KIND,
      value: defineDomainMainSystemCapabilityGrant({
        id: 'fixture.authority.different',
        eligibility: 'trusted-domain-runtime',
        description: 'Deliberately mismatched provider grant fixture.'
      })
    }]))

    await expect(activateMainRuntimeContributions(catalog, runtimeHost()))
      .rejects.toThrow('must match its provider-owned value ID')
  })

  it('does not issue a provider grant to undeclared or non-lifecycle callers', async () => {
    let lifecycleContext: DomainMainRuntimeLifecycleContext | undefined
    const capability = defineCapability({
      id: 'fixture.authority.project',
      version: '1.0.0',
      title: 'Project caller authority',
      description: 'Projects caller identity and grants for negative authority tests.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ callerId: z.string(), capabilityGrants: z.array(z.string()) }).strict(),
      handler: async (_input, context) => ({
        output: {
          callerId: context.caller.callerId,
          capabilityGrants: [...(context.caller.capabilityGrants ?? [])]
        }
      })
    })
    const contract = {
      actionId: capability.descriptor.id,
      effect: 'read' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ callerId: z.string(), capabilityGrants: z.array(z.string()) }).strict()
    }
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      fixtureEntry('fixture.provider', '@fixture/provider', 200, [{
        id: 'fixture.authority.project',
        kind: MAIN_SYSTEM_CAPABILITY_GRANT_CONTRIBUTION_KIND,
        value: defineDomainMainSystemCapabilityGrant({
          id: 'fixture.authority.project',
          eligibility: 'trusted-domain-runtime',
          description: 'Allows a trusted runtime to project its authority.'
        })
      }]),
      fixtureEntry('fixture.ungranted', '@fixture/ungranted', 100, [{
        id: 'fixture.ungranted.runtime',
        kind: MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
        value: {
          activate: (context: DomainMainRuntimeLifecycleContext) => {
            lifecycleContext = context
          }
        }
      }])
    ])
    const activated = await activateMainRuntimeContributions(
      catalog,
      runtimeHost(createMainSystemCapabilityInvokerFactory(broker))
    )

    await expect(lifecycleContext!.capabilities.invoke(
      contract,
      {},
      { workspaceId: '/workspace' }
    )).resolves.toEqual({
      callerId: 'domain-runtime:fixture.ungranted',
      capabilityGrants: []
    })
    await expect(broker.invoke({
      audience: 'system',
      callerId: 'non-lifecycle-host-caller',
      workspaceId: '/workspace'
    }, {
      actionId: contract.actionId,
      input: {}
    })).resolves.toMatchObject({
      output: {
        callerId: 'non-lifecycle-host-caller',
        capabilityGrants: []
      }
    })
    await activated.dispose()
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
    const invoker = createMainSystemCapabilityInvokerFactory(broker, {
      createInvocationId: () => 'inner-invocation'
    }).forDomain({ moduleId: 'fixture.package', moduleVersion: '1.0.0' })
    const resource = broker.issueResourceHandle({
      audience: 'system',
      callerId: 'domain-runtime:fixture.package',
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

  it('rejects inherited approval when the live Principal changed inside the outer action', async () => {
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
    let currentPrincipal = principalA
    const innerHandler = vi.fn(async () => ({ output: { restored: true } }))
    const inner = defineCapability({
      id: 'fixture.principal-bound-inner',
      version: '1.0.0',
      title: 'Principal-bound inner action',
      description: 'Must inherit approval only under the same Principal lease.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict(),
      handler: innerHandler
    })
    const registry = new CapabilityRegistry([inner])
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const invoker = createMainSystemCapabilityInvokerFactory(broker, {
      createInvocationId: () => 'principal-inner-invocation'
    }).forDomain({ moduleId: 'fixture.package', moduleVersion: '1.0.0' })
    const contract = {
      actionId: inner.descriptor.id,
      effect: 'destructive' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict()
    }
    const outer = defineCapability({
      id: 'fixture.principal-bound-outer',
      version: '1.0.0',
      title: 'Principal-bound outer action',
      description: 'Switches Principal before attempting nested approval inheritance.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ restored: z.boolean() }).strict(),
      handler: async () => {
        currentPrincipal = principalB
        return {
          output: await invoker.invoke(contract, {}, {
            workspaceId: '/workspace',
            authorization: { mode: 'inherit-current-action' }
          })
        }
      }
    })
    registry.register(outer)

    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'renderer',
      workspaceId: '/workspace',
      approvals: [{
        actionId: outer.descriptor.id,
        invocationId: 'principal-outer-invocation',
        mode: 'confirmation'
      }]
    }, {
      actionId: outer.descriptor.id,
      invocationId: 'principal-outer-invocation',
      input: {}
    })).rejects.toMatchObject({ code: 'principal_changed' })
    expect(innerHandler).not.toHaveBeenCalled()
  })

  it('expires inherited approval when a deferred callback outlives its outer handler', async () => {
    const innerHandler = vi.fn(async () => ({ output: { ok: true } }))
    const inner = defineCapability({
      id: 'fixture.deferred-inner',
      version: '1.0.0',
      title: 'Deferred inner action',
      description: 'Must not inherit an already-settled outer approval.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: innerHandler
    })
    const registry = new CapabilityRegistry([inner])
    const broker = new CapabilityBroker(registry)
    const invoker = createMainSystemCapabilityInvokerFactory(broker)
      .forDomain({ moduleId: 'fixture.package', moduleVersion: '1.0.0' })
    const contract = {
      actionId: inner.descriptor.id,
      effect: 'destructive' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict()
    }
    let invokeDeferred: (() => Promise<{ ok: boolean }>) | undefined
    const outer = defineCapability({
      id: 'fixture.deferred-outer',
      version: '1.0.0',
      title: 'Deferred outer action',
      description: 'Schedules work after the approved handler settles.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'destructive',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ scheduled: z.boolean() }).strict(),
      handler: async () => {
        invokeDeferred = () => invoker.invoke(contract, {}, {
          workspaceId: '/workspace',
          authorization: { mode: 'inherit-current-action' }
        })
        return { output: { scheduled: true } }
      }
    })
    registry.register(outer)

    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'renderer',
      workspaceId: '/workspace',
      approvals: [{
        actionId: outer.descriptor.id,
        invocationId: 'deferred-outer-invocation',
        mode: 'confirmation'
      }]
    }, {
      actionId: outer.descriptor.id,
      invocationId: 'deferred-outer-invocation',
      input: {}
    })).resolves.toMatchObject({ output: { scheduled: true } })

    await expect(invokeDeferred?.()).rejects.toThrow('cannot inherit approval')
    expect(innerHandler).not.toHaveBeenCalled()
  })

  it('forwards AbortSignal through the package-scoped system capability invoker', async () => {
    let handlerSignal: AbortSignal | undefined
    let started: (() => void) | undefined
    const handlerStarted = new Promise<void>((resolve) => { started = resolve })
    const capability = defineCapability({
      id: 'fixture.cancellable-system-read',
      version: '1.0.0',
      title: 'Cancellable system read',
      description: 'Observes the caller-provided system cancellation signal.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ cancelled: z.boolean() }).strict(),
      handler: async (_input, context) => {
        handlerSignal = context.signal
        started?.()
        if (!context.signal?.aborted) {
          await new Promise<void>((resolve) => {
            context.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
        }
        return { output: { cancelled: context.signal?.aborted === true } }
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const invoker = createMainSystemCapabilityInvokerFactory(broker)
      .forDomain({ moduleId: 'fixture.package', moduleVersion: '1.0.0' })
    const controller = new AbortController()
    const pending = invoker.invoke({
      actionId: capability.descriptor.id,
      effect: 'read',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ cancelled: z.boolean() }).strict()
    }, {}, { workspaceId: '/workspace', signal: controller.signal })

    await handlerStarted
    controller.abort()
    await expect(pending).resolves.toEqual({ cancelled: true })
    expect(handlerSignal).toBe(controller.signal)
  })

  it('derives one exact finite batch from one Human confirmation and consumes each operation once', async () => {
    const principal = Object.freeze({
      authority: 'sciforge.identity-access',
      subject: 'owner-1',
      assurance: 'cloud-authenticated' as const,
      deviceId: 'device-1',
      identityVersion: 7
    })
    const grantId = 'fixture.provisioning-batch'
    const calls: string[] = []
    let providerChange: ((change: { semanticRevision: string }) => void) | undefined
    const resourceOutputSchema = z.object({
      resource: z.object({
        token: z.string(),
        semanticRevision: z.string(),
        expiresAt: z.string()
      }).strict()
    }).strict()
    const okOutputSchema = z.object({ ok: z.boolean() }).strict()
    const authorize = defineCapability({
      id: 'fixture.provision.authorize',
      version: '1.0.0',
      title: 'Authorize provider',
      description: 'Issues an exact provider administration resource.',
      audiences: ['agent', 'system'],
      scope: 'global',
      producedResourceKinds: ['fixture.provider-administration'],
      effect: 'external-write',
      approval: 'confirmation',
      delegatedBatchGrant: grantId,
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ provider: z.string() }).strict(),
      outputSchema: resourceOutputSchema,
      handler: async (_input, context) => {
        calls.push('authorize')
        return {
          output: {
            resource: context.issueResource({
              resourceId: 'provider-1',
              resourceKind: 'fixture.provider-administration',
              audiences: ['system'],
              semanticRevision: 'provider-1',
              observe: async () => ({ state: {}, semanticRevision: 'provider-1' })
            })
          }
        }
      }
    })
    const create = defineCapability({
      id: 'fixture.provision.create',
      version: '1.0.0',
      title: 'Create root',
      description: 'Creates one exact shared root from provider administration authority.',
      audiences: ['agent', 'system'],
      scope: 'resource',
      resourceKinds: ['fixture.provider-administration'],
      producedResourceKinds: ['fixture.root'],
      effect: 'external-write',
      approval: 'none',
      delegatedBatchGrant: grantId,
      autonomousWrite: 'resource-authorized',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ label: z.string() }).strict(),
      outputSchema: resourceOutputSchema,
      handler: async (_input, context) => {
        calls.push(`create:${context.resource?.resourceId}`)
        return {
          output: {
            resource: context.issueResource({
              resourceId: 'root-1',
              resourceKind: 'fixture.root',
              audiences: ['system'],
              semanticRevision: 'root-1',
              observe: async () => ({ state: {}, semanticRevision: 'root-1' }),
              subscribeChanges: (listener) => {
                providerChange = listener
                return () => { providerChange = undefined }
              }
            })
          },
          changed: true,
          semanticRevision: 'provider-2'
        }
      }
    })
    const list = defineCapability({
      id: 'fixture.provision.list',
      version: '1.0.0',
      title: 'List members',
      description: 'Reads the exact shared-root membership.',
      audiences: ['agent', 'system'],
      scope: 'resource',
      resourceKinds: ['fixture.root'],
      effect: 'read',
      approval: 'none',
      delegatedBatchGrant: grantId,
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({ phase: z.enum(['before', 'after']) }).strict(),
      outputSchema: okOutputSchema,
      handler: async (input, context) => {
        calls.push(`list:${input.phase}:${context.resource?.resourceId}`)
        return { output: { ok: true } }
      }
    })
    const add = defineCapability({
      id: 'fixture.provision.add',
      version: '1.0.0',
      title: 'Add member',
      description: 'Adds one exact member to the exact shared root.',
      audiences: ['agent', 'system'],
      scope: 'resource',
      resourceKinds: ['fixture.root'],
      effect: 'external-write',
      approval: 'confirmation',
      delegatedBatchGrant: grantId,
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ member: z.string() }).strict(),
      outputSchema: okOutputSchema,
      handler: async (input, context) => {
        calls.push(`add:${input.member}:${context.resource?.resourceId}`)
        return { output: { ok: true }, changed: true, semanticRevision: 'root-2' }
      }
    })
    const registry = new CapabilityRegistry([authorize, create, list, add])
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => principal
    })
    const invoker = createMainSystemCapabilityInvokerFactory(broker)
      .forDomain(
        { moduleId: 'fixture.coordinator', moduleVersion: '1.0.0' },
        [grantId]
      )
    const authorizeContract = {
      actionId: authorize.descriptor.id,
      effect: authorize.descriptor.effect,
      inputSchema: authorize.inputSchema,
      outputSchema: authorize.outputSchema
    }
    const createContract = {
      actionId: create.descriptor.id,
      effect: create.descriptor.effect,
      inputSchema: create.inputSchema,
      outputSchema: create.outputSchema
    }
    const listContract = {
      actionId: list.descriptor.id,
      effect: list.descriptor.effect,
      inputSchema: list.inputSchema,
      outputSchema: list.outputSchema
    }
    const addContract = {
      actionId: add.descriptor.id,
      effect: add.descriptor.effect,
      inputSchema: add.inputSchema,
      outputSchema: add.outputSchema
    }
    const plan = domainMainFiniteCapabilityBatchPlanSchema.parse({
      requiredSystemCapabilityGrant: grantId,
      revision: 'project-1:7',
      operations: [
        {
          operationId: 'authorize',
          actionId: authorize.descriptor.id,
          idempotencyKey: 'authorize-7',
          input: { provider: 'provider-1' }
        },
        {
          operationId: 'create',
          actionId: create.descriptor.id,
          idempotencyKey: 'create-7',
          input: { label: 'Project 1' },
          resource: { kind: 'operation-output', operationId: 'authorize', path: ['resource'] }
        },
        {
          operationId: 'list-before',
          actionId: list.descriptor.id,
          input: { phase: 'before' },
          resource: { kind: 'operation-output', operationId: 'create', path: ['resource'] }
        },
        {
          operationId: 'add',
          actionId: add.descriptor.id,
          idempotencyKey: 'add-7-member-1',
          input: { member: 'provider-user-1' },
          resource: { kind: 'operation-output', operationId: 'create', path: ['resource'] }
        },
        {
          operationId: 'list-after',
          actionId: list.descriptor.id,
          input: { phase: 'after' },
          resource: { kind: 'operation-output', operationId: 'create', path: ['resource'] }
        }
      ]
    })
    const confirmedPlanDigest = createHash('sha256')
      .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
      .digest('hex')
    let replayRejected = false
    let secondBatchRejected = false
    let planDigest = ''
    const outer = defineCapability({
      id: 'fixture.project.provision',
      version: '1.0.0',
      title: 'Provision Project content',
      description: 'Represents the one complete Human-confirmed immutable plan.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({
        revision: z.literal(7),
        confirmedPlanDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
      }).strict(),
      outputSchema: z.object({ completed: z.boolean() }).strict(),
      handler: async () => {
        const batch = invoker.createApprovedBatch(plan)
        planDigest = batch.planDigest
        await batch.invoke('authorize', authorizeContract)
        await batch.invoke('create', createContract)
        await batch.invoke('list-before', listContract)
        await batch.invoke('add', addContract)
        await batch.invoke('list-after', listContract)
        try {
          await batch.invoke('list-after', listContract)
        } catch {
          replayRejected = true
        }
        try {
          invoker.createApprovedBatch({
            requiredSystemCapabilityGrant: grantId,
            revision: 'project-1:8',
            operations: [{
              operationId: 'authorize',
              actionId: authorize.descriptor.id,
              idempotencyKey: 'authorize-8',
              input: { provider: 'provider-1' }
            }]
          })
        } catch {
          secondBatchRejected = true
        }
        return { output: { completed: true } }
      }
    })
    registry.register(outer)

    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'window:1',
      approvals: [{
        actionId: outer.descriptor.id,
        invocationId: 'outer-project-1-revision-7',
        mode: 'confirmation'
      }]
    }, {
      actionId: outer.descriptor.id,
      invocationId: 'outer-project-1-revision-7',
      input: { revision: 7, confirmedPlanDigest }
    })).resolves.toMatchObject({ output: { completed: true } })

    expect(calls).toEqual([
      'authorize',
      'create:provider-1',
      'list:before:root-1',
      'add:provider-user-1:root-1',
      'list:after:root-1'
    ])
    expect(planDigest).toBe(confirmedPlanDigest)
    expect(replayRejected).toBe(true)
    expect(secondBatchRejected).toBe(true)
    expect(providerChange).toBeTypeOf('function')
  })

  it('invalidates a finite batch on operation or resource revision drift and requires a new confirmation', async () => {
    const principal = Object.freeze({
      authority: 'sciforge.identity-access',
      subject: 'owner-2',
      assurance: 'cloud-authenticated' as const,
      deviceId: 'device-2',
      identityVersion: 3
    })
    const grantId = 'fixture.reconcile-batch'
    const read = defineCapability({
      id: 'fixture.reconcile.read',
      version: '1.0.0',
      title: 'Read exact root',
      description: 'Reads one exact root revision for finite-batch drift tests.',
      audiences: ['agent', 'system'],
      scope: 'resource',
      resourceKinds: ['fixture.root'],
      effect: 'read',
      approval: 'none',
      delegatedBatchGrant: grantId,
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({ step: z.number().int() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([read])
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => principal
    })
    let publishProviderChange: ((change: { semanticRevision: string }) => void) | undefined
    const resource = broker.issueResourceHandle({
      audience: 'system',
      callerId: 'domain-runtime:fixture.reconciler'
    }, {
      resourceId: 'root-2',
      resourceKind: 'fixture.root',
      audiences: ['system'],
      semanticRevision: 'root-revision-1',
      observe: async () => ({ state: {}, semanticRevision: 'root-revision-1' }),
      subscribeChanges: (listener) => {
        publishProviderChange = listener
        return () => { publishProviderChange = undefined }
      }
    })
    const invoker = createMainSystemCapabilityInvokerFactory(broker)
      .forDomain(
        { moduleId: 'fixture.reconciler', moduleVersion: '1.0.0' },
        [grantId]
      )
    const contract = {
      actionId: read.descriptor.id,
      effect: 'read' as const,
      inputSchema: read.inputSchema,
      outputSchema: read.outputSchema
    }
    const resultSchema = z.object({
      firstRejected: z.boolean(),
      retryRejected: z.boolean(),
      replacementRejected: z.boolean()
    }).strict()
    const confirmedPlanDigest = (plan: unknown) => createHash('sha256')
      .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
      .digest('hex')
    const orderPlan = domainMainFiniteCapabilityBatchPlanSchema.parse({
      requiredSystemCapabilityGrant: grantId,
      revision: 'reconcile:1',
      operations: [1, 2].map((step) => ({
        operationId: `read-${step}`,
        actionId: read.descriptor.id,
        input: { step },
        resource: { kind: 'fixed' as const, resource }
      }))
    })
    const revisionPlan = domainMainFiniteCapabilityBatchPlanSchema.parse({
      requiredSystemCapabilityGrant: grantId,
      revision: 'reconcile:resource-1',
      operations: [{
        operationId: 'read-1',
        actionId: read.descriptor.id,
        input: { step: 1 },
        resource: { kind: 'fixed' as const, resource }
      }]
    })
    const confirmationInputSchema = z.object({
      revision: z.literal(1),
      confirmedPlanDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
    }).strict()
    const orderOuter = defineCapability({
      id: 'fixture.reconcile.order',
      version: '1.0.0',
      title: 'Confirm ordered reconcile',
      description: 'Confirms one exact ordered reconcile plan.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: confirmationInputSchema,
      outputSchema: resultSchema,
      handler: async () => {
        const batch = invoker.createApprovedBatch(orderPlan)
        let firstRejected = false
        let retryRejected = false
        let replacementRejected = false
        try { await batch.invoke('read-2', contract) } catch { firstRejected = true }
        try { await batch.invoke('read-1', contract) } catch { retryRejected = true }
        try { invoker.createApprovedBatch({ ...orderPlan, revision: 'reconcile:2' }) } catch {
          replacementRejected = true
        }
        return { output: { firstRejected, retryRejected, replacementRejected } }
      }
    })
    const revisionOuter = defineCapability({
      id: 'fixture.reconcile.revision',
      version: '1.0.0',
      title: 'Confirm revision reconcile',
      description: 'Confirms one exact resource revision for reconcile.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: confirmationInputSchema,
      outputSchema: resultSchema,
      handler: async () => {
        const batch = invoker.createApprovedBatch(revisionPlan)
        publishProviderChange?.({ semanticRevision: 'root-revision-2' })
        let firstRejected = false
        let retryRejected = false
        let replacementRejected = false
        try { await batch.invoke('read-1', contract) } catch { firstRejected = true }
        try { await batch.invoke('read-1', contract) } catch { retryRejected = true }
        try { invoker.createApprovedBatch({ ...revisionPlan, revision: 'reconcile:resource-2' }) } catch {
          replacementRejected = true
        }
        return { output: { firstRejected, retryRejected, replacementRejected } }
      }
    })
    const replacementOuter = defineCapability({
      id: 'fixture.reconcile.confirmed-plan-replacement',
      version: '1.0.0',
      title: 'Reject confirmed plan replacement',
      description: 'Rejects a first batch whose full plan differs from the confirmed plan digest.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: confirmationInputSchema,
      outputSchema: z.object({
        replacementCode: z.string(),
        confirmedRetryCode: z.string()
      }).strict(),
      handler: async () => {
        let replacementCode = ''
        let confirmedRetryCode = ''
        try {
          invoker.createApprovedBatch({
            ...orderPlan,
            operations: orderPlan.operations.map((operation, index) => index === 0
              ? { ...operation, input: { step: 99 } }
              : operation)
          })
        } catch (error) {
          replacementCode = error instanceof CapabilityBrokerError ? error.code : 'unexpected'
        }
        try {
          invoker.createApprovedBatch(orderPlan)
        } catch (error) {
          confirmedRetryCode = error instanceof CapabilityBrokerError ? error.code : 'unexpected'
        }
        return { output: { replacementCode, confirmedRetryCode } }
      }
    })
    registry.registerAll([orderOuter, revisionOuter, replacementOuter])

    const invokeOuter = (
      definition: Readonly<{ descriptor: Readonly<{ id: string }> }>,
      invocationId: string,
      planDigest: string
    ) => broker.invoke({
      audience: 'ui',
      callerId: 'window:2',
      approvals: [{ actionId: definition.descriptor.id, invocationId, mode: 'confirmation' }]
    }, {
      actionId: definition.descriptor.id,
      invocationId,
      input: { revision: 1, confirmedPlanDigest: planDigest }
    })
    await expect(invokeOuter(
      orderOuter,
      'order-confirmation-1',
      confirmedPlanDigest(orderPlan)
    )).resolves.toMatchObject({
      output: { firstRejected: true, retryRejected: true, replacementRejected: true }
    })
    await expect(invokeOuter(
      revisionOuter,
      'revision-confirmation-1',
      confirmedPlanDigest(revisionPlan)
    )).resolves.toMatchObject({
      output: { firstRejected: true, retryRejected: true, replacementRejected: true }
    })
    await expect(invokeOuter(
      replacementOuter,
      'replacement-confirmation-1',
      confirmedPlanDigest(orderPlan)
    )).resolves.toMatchObject({
      output: {
        replacementCode: 'delegated_batch_confirmation_drift',
        confirmedRetryCode: 'delegated_batch_already_created'
      }
    })
  })
})

function runtimeHost(
  capabilityInvokers: ReturnType<typeof createMainSystemCapabilityInvokerFactory> = {
    forDomain: vi.fn(() => ({
      invoke: vi.fn(async (_contract, input) => input),
      createApprovedBatch: vi.fn(() => {
        throw new Error('not used')
      })
    }))
  }
) {
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
      subscribeMessages: vi.fn(async function* () {}),
      hasActiveTurns: vi.fn(() => false)
    },
    capabilityInvokers,
    executionEvents: {
      publish: vi.fn(async (owner, event) => ({
        ...event,
        schemaVersion: 'sciforge.execution-event.v1' as const,
        eventId: event.eventId ?? 'execution-event-fixture',
        producer: owner,
        occurredAt: event.occurredAt ?? '2026-08-05T00:00:00.000Z',
        artifacts: event.artifacts ?? []
      }))
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
    version?: string
    publicRelease?: 'allowed' | 'forbidden'
    contract?: DomainPackageJsonValue
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
      contributionContracts: Object.fromEntries(
        contributions.flatMap(({ id, contract }) => contract ? [[id, contract]] : [])
      ),
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: contributions.map(({ id, kind, priority, version, publicRelease }) => ({
          id,
          kind,
          ...(priority === undefined ? {} : { priority }),
          ...(version === undefined ? {} : { version }),
          ...(publicRelease === undefined ? {} : { publicRelease })
        }))
      }]
    },
    contributions
  }
}
