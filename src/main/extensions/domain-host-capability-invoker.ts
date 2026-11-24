import type { DomainMainOrdinarySessionIdentity } from '@sciforge/domain-sdk/host'
import { CapabilityBroker, CapabilityBrokerError } from '../capabilities/broker'
import { assertCapabilityDefinitionCurrent } from '../capabilities/registry'
import type { CapabilityCallerContextInput, CapabilityInvocationRequest } from '../../shared/capability-broker'

/** Host-only delegation from an admitted service operation under its live outer invocation. */
export function createDomainHostCapabilityInvoker(getBroker: () => CapabilityBroker | null | undefined) {
  return {
    async invoke(request: CapabilityInvocationRequest, context: {
      caller: unknown
      ordinarySession?: unknown
      originalContext?: Readonly<Record<string, unknown>>
      delegation?: Readonly<{ actionId: string; invocationId: string; effect: string }>
      signal: AbortSignal
      assertCurrent(): void
    }): Promise<unknown> {
      const assertCurrent = () => { context.signal.throwIfAborted(); context.assertCurrent() }
      assertCurrent()
      const broker = getBroker()
      if (!broker) throw new Error('The Host capability broker is not ready.')
      let caller = context.caller as CapabilityCallerContextInput
      if (context.delegation) {
        const outer = broker.registry.require(context.delegation.actionId)
        const nested = broker.registry.require(request.actionId)
        const assertDelegation = () => {
          assertCurrent()
          assertCapabilityDefinitionCurrent(outer.descriptor)
          assertCapabilityDefinitionCurrent(nested.descriptor)
          if (!request.invocationId || outer.descriptor.approval !== 'confirmation' ||
            nested.descriptor.approval !== 'confirmation' || outer.descriptor.effect !== context.delegation!.effect ||
            nested.descriptor.effect !== outer.descriptor.effect || !caller.approvals?.some(grant =>
              grant.actionId === context.delegation!.actionId && grant.invocationId === context.delegation!.invocationId &&
              grant.mode === 'confirmation')) {
            throw new CapabilityBrokerError('approval_denied', 'Host service delegation requires a live confirmed outer invocation with matching effect.')
          }
        }
        assertDelegation()
        caller = { ...caller, approvals: [...(caller.approvals ?? []), {
          actionId: request.actionId, invocationId: request.invocationId!, mode: 'confirmation'
        }] }
        assertDelegation()
      }
      assertCurrent()
      const result = caller.audience === 'agent' && context.ordinarySession
        ? await broker.invokeOrdinarySession(caller, request, context.ordinarySession as DomainMainOrdinarySessionIdentity,
          { signal: context.signal, ...(context.originalContext ? { context: context.originalContext } : {}) })
        : await broker.invoke(caller, request, { signal: context.signal })
      assertCurrent()
      return result.output
    }
  }
}
