import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import { createDomainHostCapabilityInvoker } from './domain-host-capability-invoker'

function fixture() {
  const handler = vi.fn(async () => ({ output: {} }))
  const capability = (id: string, effect: 'external-write' | 'workspace-write' = 'external-write') => defineCapability({
    id, version: '1', title: id, description: 'Exercises Host-owned capability delegation.', audiences: ['ui'], scope: 'global',
    effect, approval: 'confirmation', concurrency: { revision: 'none', idempotency: 'required' },
    inputSchema: z.object({}).strict(), outputSchema: z.object({}).strict(), handler
  })
  const broker = new CapabilityBroker(new CapabilityRegistry([capability('outer.write'), capability('nested.write'), capability('local.write', 'workspace-write')]))
  let live = true
  const adapter = createDomainHostCapabilityInvoker(() => broker)
  const context = { caller: { audience: 'ui' as const, callerId: 'window:1', approvals: [
    { actionId: 'outer.write', invocationId: 'outer-confirmation', mode: 'confirmation' as const }
  ] }, delegation: { actionId: 'outer.write', invocationId: 'outer-confirmation', effect: 'external-write' },
  signal: new AbortController().signal, assertCurrent: () => { if (!live) throw new Error('Outer invocation revoked.') } }
  return { handler, adapter, context, broker, revoke: () => { live = false }, request: { actionId: 'nested.write', invocationId: 'attempt-1', input: {} } }
}

describe('production domain Host capability adapter', () => {
  it('does not treat an unrelated outer approval as direct nested approval', async () => {
    const f = fixture()
    const { delegation: _delegation, ...context } = f.context
    await expect(f.adapter.invoke(f.request, context)).rejects.toMatchObject({ code: 'approval_denied' })
    expect(f.handler).not.toHaveBeenCalled()
  })

  it('delegates only matching registered effects', async () => {
    const f = fixture()
    await expect(f.adapter.invoke({ ...f.request, actionId: 'local.write' }, f.context)).rejects.toMatchObject({ code: 'approval_denied' })
    expect(f.handler).not.toHaveBeenCalled()
  })

  it('rechecks revocation after resolving the Broker and before minting approval', async () => {
    const f = fixture()
    const adapter = createDomainHostCapabilityInvoker(() => { f.revoke(); return f.broker })
    await expect(adapter.invoke(f.request, f.context)).rejects.toThrow(/revoked/)
    expect(f.handler).not.toHaveBeenCalled()
  })

  it('mints exact nested approvals while leaving the outer confirmation unchanged', async () => {
    const f = fixture()
    await expect(f.adapter.invoke(f.request, f.context)).resolves.toEqual({})
    await expect(f.adapter.invoke({ ...f.request, invocationId: 'attempt-2' }, f.context)).resolves.toEqual({})
    expect(f.handler).toHaveBeenCalledTimes(2)
    expect(f.context.caller.approvals).toEqual([{ actionId: 'outer.write', invocationId: 'outer-confirmation', mode: 'confirmation' }])
  })
})
