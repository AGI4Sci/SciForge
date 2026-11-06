import { describe, expect, it } from 'vitest'
import type { AgentRuntimeEvent, AgentRuntimeId } from '../../../shared/agent-runtime-contract'
import { RuntimeUserInputService } from './user-input-service'

const request = { questions: [{ id: 'scope', header: '', question: 'Which scope?', options: [{ id: 'all', label: 'All', description: '', recommended: true }] }] }
const answers = [{ id: 'scope', label: 'All', value: 'All\n\nInclude controls' }]
function harness(runtimeId: AgentRuntimeId = 'codex') {
  const service = new RuntimeUserInputService()
  const events: AgentRuntimeEvent[] = []
  const scope = { runtimeId, threadId: 'thread', turnId: 'turn' }
  const controller = new AbortController()
  const pending = service.request(scope, request, async (event) => { events.push(event) }, controller.signal)
  const requestId = (events[0] as Extract<AgentRuntimeEvent, { kind: 'user_input_requested' }>).requestId
  return { service, events, scope, pending, requestId, controller }
}

describe('runtime-neutral user input', () => {
  it.each<AgentRuntimeId>(['codex', 'claude', 'dsh', 'pi'])('returns the human answer to the original %s tool call once', async (id) => {
    const h = harness(id)
    await Promise.all([h.service.submit(h.scope, h.requestId, answers), h.service.submit(h.scope, h.requestId, answers)])
    await expect(h.pending).resolves.toEqual({ status: 'submitted', answers })
    expect(h.events.map((event) => event.kind)).toEqual(['user_input_requested', 'item_snapshot', 'user_input_resolved', 'item_snapshot'])
    expect(h.events.at(-1)).toMatchObject({ item: { meta: { questions: request.questions, answers, userInputStatus: 'submitted' } } })
    await expect(h.service.submit(h.scope, h.requestId, [{ ...answers[0], value: 'different' }])).rejects.toThrow('already resolved')
  })
  it('rejects cross-session, unknown, duplicate and missing answers without settling', async () => {
    const h = harness()
    await expect(h.service.submit({ ...h.scope, threadId: 'wrong' }, h.requestId, answers)).rejects.toThrow('another session')
    for (const invalid of [[], [answers[0], answers[0]], [{ ...answers[0], label: 'invented' }], [{ ...answers[0], id: 'wrong' }]]) {
      await expect(h.service.submit(h.scope, h.requestId, invalid)).rejects.toThrow()
    }
    await h.service.submit(h.scope, h.requestId, [{ id: 'scope', label: 'Other', value: 'Only validated samples' }])
    expect((await h.pending).status).toBe('submitted')
  })
  it('cancels on turn abort without selecting a default', async () => {
    const h = harness('pi')
    h.controller.abort()
    await expect(h.pending).resolves.toEqual({ status: 'cancelled', answers: [] })
    await expect(h.service.submit(h.scope, h.requestId, answers)).rejects.toThrow('already resolved')
  })
  it('rejects lost requests after restart and cancels their historical projection', async () => {
    const h = harness()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const itemEvent = h.events.find((event) => event.kind === 'item_snapshot')!
    if (itemEvent.kind !== 'item_snapshot') throw new Error('snapshot missing')
    const restarted = new RuntimeUserInputService()
    expect(restarted.reconcileTurns([{ id: 'turn', threadId: 'thread', status: 'running', items: [itemEvent.item] }])[0].items?.[0]).toMatchObject({ meta: { userInputStatus: 'cancelled' } })
    await expect(restarted.submit(h.scope, h.requestId, answers)).rejects.toThrow('expired')
    h.service.dispose()
    expect((await h.pending).status).toBe('cancelled')
  })
  it('does not leave a waiter behind when history publication fails', async () => {
    const service = new RuntimeUserInputService()
    await expect(service.request({ runtimeId: 'claude', threadId: 't', turnId: 'x' }, request, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  })
})
