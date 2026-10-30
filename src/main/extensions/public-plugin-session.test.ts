import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CapabilityBroker } from '../capabilities/broker'
import type { CapabilityAgentBroker } from '../capabilities/agent-tools'
import { CapabilityRegistry, defineCapability, type CapabilityHandlerContext } from '../capabilities/registry'
import { createCapabilityEvalFaultBroker } from '../capability-eval/provider-fault-harness'
import { createRuntimeCapabilityBroker } from '../runtime/agent-runtime/runtime-capability-broker'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

describe('public plugin ordinary Session provenance', () => {
  it('does not replay an invocation admitted under different original turn facts', async () => {
    let calls = 0
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.replay', version: '1', title: 'Neutral Session replay', description: 'Neutral idempotency binding.',
      audiences: ['agent'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.object({}), outputSchema: z.object({}),
      handler: () => { calls++; return { output: {} } }
    })]))
    const caller = { audience: 'agent' as const, callerId: 'neutral-caller', approvals: [] }
    const request = { actionId: 'neutral-session.replay', invocationId: 'neutral-replay', input: {} }
    const session = { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }
    await broker.invokeOrdinarySession(caller, request, session, { context: { ...session, turnId: 'first-turn' } })
    await expect(broker.invokeOrdinarySession(caller, request, session, {
      context: { ...session, turnId: 'second-turn' }
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(calls).toBe(1)
  })
  it('binds idempotency to own __proto__ context facts without dropping them', async () => {
    const delivered: unknown[] = []
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.lossless', version: '1', title: 'Lossless neutral Session', description: 'Neutral lossless idempotency.',
      audiences: ['agent'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.object({}), outputSchema: z.object({ marker: z.string() }),
      handler: (_input, context) => {
        delivered.push(context.originalContext)
        const facts = context.originalContext as { __proto__: { marker: string } }
        return { output: { marker: facts.__proto__.marker } }
      }
    })]))
    const caller = { audience: 'agent' as const, callerId: 'neutral-caller', approvals: [] }
    const request = { actionId: 'neutral-session.lossless', invocationId: 'neutral-lossless', input: {} }
    const session = { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }
    const first = JSON.parse('{"runtimeId":"neutral-runtime","threadId":"neutral-thread","__proto__":{"marker":"first"}}')
    const second = JSON.parse('{"runtimeId":"neutral-runtime","threadId":"neutral-thread","__proto__":{"marker":"second"}}')
    const result = await broker.invokeOrdinarySession(caller, request, session, { context: first })
    expect(result.output).toEqual({ marker: 'first' })
    expect(Object.hasOwn(delivered[0] as object, '__proto__')).toBe(true)
    expect(Object.isFrozen(delivered[0])).toBe(true)
    expect(Object.isFrozen((delivered[0] as typeof first).__proto__)).toBe(true)
    await expect(broker.invokeOrdinarySession(caller, request, session, { context: second }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(delivered).toHaveLength(1)
    const replay = await broker.invokeOrdinarySession(caller, request, session, { context: first })
    expect(replay.replayed).toBe(true)
    expect(replay.output).toEqual({ marker: 'first' })
    expect(delivered).toHaveLength(1)
  })
  it('does not replay signed-zero context facts distinguishable by the handler', async () => {
    let calls = 0
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.signed-zero', version: '1', title: 'Signed-zero neutral Session', description: 'Neutral lossless numeric provenance.',
      audiences: ['agent'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.object({}), outputSchema: z.object({ marker: z.string() }),
      handler: (_input, context) => {
        calls++
        const facts = context.originalContext as { value: number }
        return { output: { marker: Object.is(facts.value, -0) ? 'negative-zero' : 'positive-zero' } }
      }
    })]))
    const wrapped = createCapabilityEvalFaultBroker(broker, { rules: [{
      actionId: 'neutral-session.unrelated', failures: 'always', errorCode: 'neutral_fault'
    }] })
    expect(wrapped).not.toBe(broker)
    const runtime = createRuntimeCapabilityBroker({
      broker: wrapped, managedTools: {} as never,
      assertOrdinarySessionAccess: (_caller, session, context) => {
        expect(session).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread' })
        expect(Object.isFrozen(context)).toBe(true)
      }
    })
    const caller = { audience: 'agent' as const, callerId: 'neutral-caller', approvals: [] }
    const request = { actionId: 'neutral-session.signed-zero', invocationId: 'neutral-signed-zero', input: {} }
    const negative = JSON.parse('{"requestId":"neutral-request","runtimeId":"neutral-runtime","threadId":"neutral-thread","value":-0}')
    const positive = JSON.parse('{"requestId":"neutral-request","runtimeId":"neutral-runtime","threadId":"neutral-thread","value":0}')
    expect(Object.is(negative.value, positive.value)).toBe(false)
    const first = await runtime.invoke(caller, request, { context: negative })
    expect(first.output).toEqual({ marker: 'negative-zero' })
    expect(first.replayed).not.toBe(true)
    const replay = await runtime.invoke(caller, request, { context: negative })
    expect(replay.output).toEqual({ marker: 'negative-zero' })
    expect(replay.replayed).toBe(true)
    expect(calls).toBe(1)
    const control = await runtime.invoke(caller, { ...request, invocationId: 'neutral-positive-zero' }, { context: positive })
    expect(control.output).toEqual({ marker: 'positive-zero' })
    expect(control.replayed).not.toBe(true)
    expect(calls).toBe(2)
    await expect(runtime.invoke(caller, request, { context: positive }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(calls).toBe(2)
  })
  it.each(['object', 'array', 'nested-object', 'nested-array'] as const)(
    'binds shared-reference %s topology without changing original handler facts', async (shape) => {
      let calls = 0
      const session = { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }
      const leaf = () => JSON.parse('{"é":"same","é":"same","__proto__":{"reference":["object",0]},"number":-0}')
      const node = () => shape.includes('array') ? [leaf(), ['reference', 0]] : leaf()
      const contextFor = (shared: boolean, reversed = false) => {
        const first: unknown = node()
        const second: unknown = shared ? first : node()
        const left = shape.startsWith('nested') ? { items: [first] } : first
        const right = shape.startsWith('nested') ? [{ item: second }] : second
        return reversed
          ? { right, left, requestId: 'neutral-request', threadId: session.threadId, runtimeId: session.runtimeId }
          : { ...session, requestId: 'neutral-request', left, right }
      }
      const pair = (facts: Readonly<Record<string, unknown>>) => shape.startsWith('nested')
        ? [(facts.left as { items: unknown[] }).items[0], (facts.right as { item: unknown }[])[0]!.item]
        : [facts.left, facts.right]
      const shared = contextFor(true)
      const distinct = contextFor(false)
      const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
        id: 'neutral-session.graph', version: '1', title: 'Graph neutral Session', description: 'Lossless reference topology.',
        audiences: ['agent'], scope: 'global', effect: 'compute', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.object({}),
        outputSchema: z.object({ marker: z.string() }),
        handler: (_input, context) => {
          calls++
          const facts = context.originalContext!
          const [left, right] = pair(facts)
          expect(facts).not.toBe(shared)
          expect(Object.isFrozen(facts)).toBe(true)
          expect(Object.isFrozen(left)).toBe(true)
          expect(Object.isFrozen(right)).toBe(true)
          const value = (Array.isArray(left) ? left[0] : left) as { number: number; __proto__: object }
          expect(Object.is(value.number, -0)).toBe(true)
          expect(Object.hasOwn(value, '__proto__')).toBe(true)
          expect(Object.isFrozen(value.__proto__)).toBe(true)
          return { output: { marker: left === right ? 'shared' : 'distinct' } }
        }
      })]))
      const wrapped = createCapabilityEvalFaultBroker(broker, { rules: [{
        actionId: 'neutral-session.unrelated', failures: 'always', errorCode: 'neutral_fault'
      }] })
      expect(wrapped).not.toBe(broker)
      let authorizations = 0
      const runtime = createRuntimeCapabilityBroker({
        broker: wrapped, managedTools: {} as never,
        assertOrdinarySessionAccess: (_caller, identity, context) => {
          authorizations++
          expect(identity).toEqual(session)
          expect(Object.isFrozen(context)).toBe(true)
        }
      })
      const caller = { audience: 'agent' as const, callerId: 'neutral-caller', approvals: [] }
      const request = { actionId: 'neutral-session.graph', invocationId: 'neutral-graph', input: {} }
      expect((await runtime.invoke(caller, request, { context: shared })).output).toEqual({ marker: 'shared' })
      // A fresh isomorphic graph with reordered keys remains an exact retry.
      const replay = await runtime.invoke(caller, request, { context: contextFor(true, true) })
      expect(replay).toMatchObject({ replayed: true, output: { marker: 'shared' } })
      expect(calls).toBe(1)
      const control = await runtime.invoke(caller, { ...request, invocationId: 'neutral-distinct-graph' }, { context: distinct })
      expect(control.output).toEqual({ marker: 'distinct' })
      expect(control.replayed).not.toBe(true)
      expect(calls).toBe(2)
      await expect(runtime.invoke(caller, request, { context: distinct }))
        .rejects.toMatchObject({ code: 'idempotency_conflict' })
      expect(calls).toBe(2)
      expect(authorizations).toBe(4)
      expect(pair(shared)[0]).toBe(pair(shared)[1])
      expect(pair(distinct)[0]).not.toBe(pair(distinct)[1])
      expect(Object.isFrozen(shared)).toBe(false)
    }
  )
  it.each([
    { runtimeId: 'foreign-runtime', threadId: 'neutral-thread' },
    { runtimeId: 'neutral-runtime', threadId: 'foreign-thread' },
    { runtimeId: 'neutral-runtime' }
  ])('rejects original context outside the authenticated Session: %j', async (context) => {
    let calls = 0
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.bound', version: '1', title: 'Bound neutral Session', description: 'Neutral Host binding.',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: z.object({}), outputSchema: z.object({}),
      handler: () => { calls++; return { output: {} } }
    })]))
    await expect(broker.invokeOrdinarySession({ audience: 'agent', callerId: 'neutral-caller', approvals: [] }, {
      actionId: 'neutral-session.bound', input: {}
    }, { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }, { context })).rejects.toMatchObject({
      code: 'invalid_invocation_provenance'
    })
    expect(calls).toBe(0)
  })
  it('accepts schema-valid padded Session identity while preserving original context', async () => {
    let delivered: CapabilityHandlerContext | undefined
    let approved: unknown
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.padded', version: '1', title: 'Padded neutral Session', description: 'Neutral public identity normalization.',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: z.object({}), outputSchema: z.object({}),
      handler: (_input, context) => { delivered = context; return { output: {} } }
    })]))
    const runtime = createRuntimeCapabilityBroker({
      broker: createCapabilityEvalFaultBroker(broker, { rules: [] }),
      managedTools: {} as never,
      assertOrdinarySessionAccess: (_caller, identity, context) => {
        expect(identity).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread' })
        approved = context
      }
    })
    const original = { runtimeId: ' neutral-runtime ', threadId: ' neutral-thread ', requestId: 'neutral-request', marker: { value: 'original' } }
    await expect(runtime.invoke({ audience: 'agent', callerId: 'neutral-caller', approvals: [] }, {
      actionId: 'neutral-session.padded', input: {}
    }, { context: original })).resolves.toMatchObject({ output: {} })
    expect(delivered?.ordinarySession).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread' })
    expect(delivered?.originalContext).toEqual(original)
    expect(delivered?.originalContext).toEqual(approved)
    expect(delivered?.originalContext).not.toBe(original)
    expect(Object.isFrozen(delivered?.originalContext)).toBe(true)
    expect(Object.isFrozen((delivered?.originalContext as typeof original).marker)).toBe(true)
    expect(original.runtimeId).toBe(' neutral-runtime ')
    expect(original.threadId).toBe(' neutral-thread ')
  })
  it('forwards typed context and live signal through the ordinary Session fault wrapper', async () => {
    let delivered: CapabilityHandlerContext | undefined
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'neutral-session.wrapped', version: '1', title: 'Wrapped neutral Session', description: 'Neutral public options forwarding.',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: z.object({}), outputSchema: z.object({}),
      handler: (_input, context) => { delivered = context; return { output: {} } }
    })]))
    const wrapped: CapabilityAgentBroker = createCapabilityEvalFaultBroker(broker, { rules: [{
      actionId: 'neutral-session.unrelated', failures: 'always', errorCode: 'neutral_fault'
    }] })
    expect(wrapped).not.toBe(broker)
    const session = { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }
    const original = { ...session, requestId: 'neutral-request', turnId: 'neutral-turn' }
    const control = new AbortController()
    const options: NonNullable<Parameters<NonNullable<CapabilityAgentBroker['invokeOrdinarySession']>>[3]> = {
      context: original, signal: control.signal
    }
    await wrapped.invokeOrdinarySession!({ audience: 'agent', callerId: 'neutral-caller', approvals: [] }, {
      actionId: 'neutral-session.wrapped', input: {}
    }, session, options)
    expect(delivered?.originalContext).toEqual(original)
    expect(delivered?.originalContext).not.toBe(original)
    expect(Object.isFrozen(delivered?.originalContext)).toBe(true)
    expect(delivered?.signal).toBe(control.signal)
    expect(delivered?.ordinarySession).toEqual(session)
  })
  it('snapshots context at the Host Broker boundary before a handler can mutate the originals', async () => {
    const original = { runtimeId: 'neutral-runtime', threadId: 'neutral-thread', marker: { value: 'original' } }
    let delivered: unknown
    const registry = new CapabilityRegistry([defineCapability({
      id: 'neutral-session.direct', version: '1', title: 'Direct neutral Session', description: 'Neutral Host boundary.',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: z.object({}), outputSchema: z.object({}),
      handler: (_input, context) => {
        original.marker.value = 'changed'
        delivered = context.originalContext
        return { output: {} }
      }
    })])
    const broker = new CapabilityBroker(registry)
    await broker.invokeOrdinarySession({ audience: 'agent', callerId: 'neutral-caller', approvals: [] }, {
      actionId: 'neutral-session.direct', input: {}
    }, { runtimeId: 'neutral-runtime', threadId: 'neutral-thread' }, { context: original })
    expect(delivered).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread', marker: { value: 'original' } })
    expect(Object.isFrozen(delivered)).toBe(true)
    expect(Object.isFrozen((delivered as typeof original).marker)).toBe(true)
  })
  it('carries the original immutable tool context through Runtime Broker and Broker to the handler', async () => {
    const started = barrier()
    const authorized = barrier()
    let approvedContext: unknown
    let handlerContext: CapabilityHandlerContext | undefined
    const registry = new CapabilityRegistry([defineCapability({
      id: 'neutral-session.inspect', version: '1', title: 'Inspect neutral Session',
      description: 'Neutral provenance contract, no plugin business or external effects.',
      audiences: ['agent'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ marker: z.string() }).strict(),
      outputSchema: z.object({ marker: z.string() }).strict(),
      handler: (input, context) => { handlerContext = context; return { output: input } }
    })])
    const broker = new CapabilityBroker(registry)
    const runtime = createRuntimeCapabilityBroker({
      broker: createCapabilityEvalFaultBroker(broker, { rules: [] }),
      managedTools: {} as never,
      assertOrdinarySessionAccess: async (caller, identity, originalContext) => {
        expect(caller.callerId).toBe('neutral-caller')
        expect(identity).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread' })
        approvedContext = originalContext
        started.release()
        await authorized.promise
      }
    })
    const originalContext = {
      runtimeId: 'neutral-runtime', threadId: 'neutral-thread', requestId: 'neutral-request',
      turnId: 'neutral-turn', callId: 'neutral-call', marker: { value: 'original' }
    }
    const request = { actionId: 'neutral-session.inspect', invocationId: 'neutral-invocation', input: { marker: 'original' } }
    const control = new AbortController()
    const invocation = runtime.invoke({ audience: 'agent', callerId: 'neutral-caller', approvals: [] }, request, {
      context: originalContext, signal: control.signal
    })
    await started.promise
    originalContext.marker.value = 'changed'
    originalContext.threadId = 'foreign-thread'
    request.input.marker = 'changed'
    authorized.release()
    expect((await invocation).output).toEqual({ marker: 'original' })
    const delivered = handlerContext as CapabilityHandlerContext & { originalContext?: unknown }
    expect(delivered.originalContext).toEqual({
      runtimeId: 'neutral-runtime', threadId: 'neutral-thread', requestId: 'neutral-request',
      turnId: 'neutral-turn', callId: 'neutral-call', marker: { value: 'original' }
    })
    expect(Object.isFrozen(delivered.originalContext)).toBe(true)
    expect(Object.isFrozen((delivered.originalContext as typeof originalContext).marker)).toBe(true)
    expect(delivered.originalContext).not.toBe(originalContext)
    expect(delivered.originalContext).toEqual(approvedContext)
    expect(delivered.signal).toBe(control.signal)
    expect(delivered.ordinarySession).toEqual({ runtimeId: 'neutral-runtime', threadId: 'neutral-thread' })
  })
})
