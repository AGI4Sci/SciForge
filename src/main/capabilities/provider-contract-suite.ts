import { describe, expect, it } from 'vitest'
import type {
  CapabilityAudience,
  CapabilityCallerContextInput,
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityJsonValue
} from '../../shared/capability-broker'
import { CapabilityBroker, CapabilityBrokerError } from './broker'
import type { CapabilityRegistry, CapabilityResourceRegistration } from './registry'

const ALL_AUDIENCES: readonly CapabilityAudience[] = ['ui', 'agent', 'system']

export type CapabilityProviderContractFixture = {
  registry: CapabilityRegistry
  broker: CapabilityBroker
  actionId: string
  validInput: CapabilityJsonValue
  invalidInput: CapabilityJsonValue
  callers: Record<CapabilityAudience, CapabilityCallerContextInput>
  executionCount: () => number
  createResource?: () => CapabilityResourceRegistration
}

export type CapabilityProviderContractFactory = (
  testName: string
) => CapabilityProviderContractFixture | Promise<CapabilityProviderContractFixture>

function descriptorFor(fixture: CapabilityProviderContractFixture): CapabilityDescriptor {
  const descriptor = fixture.registry.get(fixture.actionId)?.descriptor
  if (!descriptor) throw new Error(`Provider contract fixture action is not registered: ${fixture.actionId}`)
  return descriptor
}

function invocationIdFor(testName: string, audience: CapabilityAudience): string {
  return `provider-contract:${testName}:${audience}`
}

function approvedCaller(
  caller: CapabilityCallerContextInput,
  descriptor: CapabilityDescriptor,
  invocationId: string | undefined
): CapabilityCallerContextInput {
  if (descriptor.approval === 'none') return caller
  return {
    ...caller,
    approvals: [
      ...(caller.approvals ?? []),
      {
        actionId: descriptor.id,
        invocationId,
        mode: descriptor.approval
      }
    ]
  }
}

function issueResource(
  fixture: CapabilityProviderContractFixture,
  caller: CapabilityCallerContextInput
) {
  if (!fixture.createResource) return undefined
  return fixture.broker.issueResourceHandle(caller, fixture.createResource())
}

function validInvocation(
  fixture: CapabilityProviderContractFixture,
  descriptor: CapabilityDescriptor,
  audience: CapabilityAudience,
  testName: string
): { caller: CapabilityCallerContextInput; request: CapabilityInvocationRequest } {
  const baseCaller = fixture.callers[audience]
  const resource = issueResource(fixture, baseCaller)
  const invocationId = descriptor.effect === 'read' ? undefined : invocationIdFor(testName, audience)
  const caller = approvedCaller(baseCaller, descriptor, invocationId)
  return {
    caller,
    request: {
      actionId: descriptor.id,
      invocationId,
      resource,
      expectedRevision: descriptor.concurrency.revision === 'optimistic'
        ? resource?.semanticRevision
        : undefined,
      input: fixture.validInput
    }
  }
}

function expectBrokerError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(CapabilityBrokerError)
  expect((error as CapabilityBrokerError).code).toBe(code)
}

/**
 * Registers the standard contract suite for a product capability provider.
 *
 * Provider tests supply only a fresh broker fixture and domain-valid inputs.
 * The common suite owns cross-cutting assertions so a new feature cannot skip
 * discovery, audience, schema, revision, idempotency, audit, or event checks.
 */
export function defineCapabilityProviderContractSuite(
  providerName: string,
  createFixture: CapabilityProviderContractFactory
): void {
  describe(`${providerName} capability provider contract`, () => {
    it('discovers the action only for registered audiences', async () => {
      const fixture = await createFixture('discovery')
      const descriptor = descriptorFor(fixture)

      for (const audience of ALL_AUDIENCES) {
        const ids = fixture.broker.discover(fixture.callers[audience]).map((entry) => entry.id)
        expect(ids.includes(descriptor.id)).toBe(descriptor.audiences.includes(audience))
      }
    })

    it('rejects invalid input before the provider handler runs', async () => {
      const fixture = await createFixture('invalid-input')
      const descriptor = descriptorFor(fixture)
      const audience = descriptor.audiences[0]
      const { caller, request } = validInvocation(fixture, descriptor, audience, 'invalid-input')

      try {
        await fixture.broker.invoke(caller, { ...request, input: fixture.invalidInput })
        expect.unreachable('Invalid provider input must be rejected.')
      } catch (error) {
        expectBrokerError(error, 'invalid_input')
      }
      expect(fixture.executionCount()).toBe(0)
    })

    it('routes every declared audience to the same registered provider', async () => {
      const fixture = await createFixture('audience-parity')
      const descriptor = descriptorFor(fixture)
      let expectedExecutions = 0

      for (const audience of descriptor.audiences) {
        const { caller, request } = validInvocation(fixture, descriptor, audience, 'audience-parity')
        await fixture.broker.invoke(caller, request)
        expectedExecutions += 1
        expect(fixture.executionCount()).toBe(expectedExecutions)
      }

      const deniedAudience = ALL_AUDIENCES.find((audience) => !descriptor.audiences.includes(audience))
      if (deniedAudience) {
        try {
          await fixture.broker.invoke(fixture.callers[deniedAudience], {
            actionId: descriptor.id,
            input: fixture.validInput
          })
          expect.unreachable('An undeclared audience must not invoke the provider.')
        } catch (error) {
          expectBrokerError(error, 'audience_denied')
        }
        expect(fixture.executionCount()).toBe(expectedExecutions)
      }
    })

    it('returns only registered executable operations from resource observation', async () => {
      const fixture = await createFixture('observation')
      const descriptor = descriptorFor(fixture)
      if (descriptor.scope !== 'resource') return
      if (!fixture.createResource) throw new Error('Resource-scoped provider fixtures must implement createResource().')

      const audience = descriptor.audiences[0]
      const caller = fixture.callers[audience]
      const resource = issueResource(fixture, caller)
      if (!resource) throw new Error('Resource-scoped provider fixture did not issue a resource handle.')
      const observation = await fixture.broker.observe(caller, { resource })

      expect(observation.operations.map((operation) => operation.id)).toContain(descriptor.id)
      for (const operation of observation.operations) {
        expect(fixture.registry.has(operation.id)).toBe(true)
      }
    })

    it('enforces optimistic revision before provider execution', async () => {
      const fixture = await createFixture('revision')
      const descriptor = descriptorFor(fixture)
      if (descriptor.concurrency.revision !== 'optimistic') return
      if (!fixture.createResource) throw new Error('Optimistic provider fixtures must implement createResource().')

      const audience = descriptor.audiences[0]
      const { caller, request } = validInvocation(fixture, descriptor, audience, 'revision')
      try {
        await fixture.broker.invoke(caller, { ...request, expectedRevision: 'stale-provider-contract-revision' })
        expect.unreachable('A stale semantic revision must be rejected.')
      } catch (error) {
        expectBrokerError(error, 'revision_conflict')
      }
      expect(fixture.executionCount()).toBe(0)
    })

    it('enforces idempotency and records audit/event outcomes', async () => {
      const fixture = await createFixture('idempotency')
      const descriptor = descriptorFor(fixture)
      const audience = descriptor.audiences[0]
      const { caller, request } = validInvocation(fixture, descriptor, audience, 'idempotency')

      const first = await fixture.broker.invoke(caller, request)
      expect(first.replayed).toBe(false)
      expect(fixture.executionCount()).toBe(1)

      if (descriptor.effect === 'read') {
        expect(fixture.broker.listAuditRecords().at(-1)?.status).toBe('success')
        expect(fixture.broker.listEvents(caller)).toHaveLength(0)
        return
      }

      const replay = await fixture.broker.invoke(caller, request)
      expect(replay.replayed).toBe(true)
      expect(fixture.executionCount()).toBe(1)
      expect(fixture.broker.listAuditRecords().map((record) => record.status)).toEqual(['success', 'replayed'])

      const events = fixture.broker.listEvents(caller)
      if (first.changed) {
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'resource.changed',
          actionId: descriptor.id,
          invocationId: request.invocationId,
          beforeRevision: first.beforeRevision,
          afterRevision: first.afterRevision
        })
      } else {
        expect(events).toHaveLength(0)
      }
    })
  })
}
