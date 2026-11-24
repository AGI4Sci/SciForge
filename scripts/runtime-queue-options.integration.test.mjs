import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeContextLedgerService } from '../src/main/services/runtime-context-ledger-service'

const bridge = vi.hoisted(() => ({
  completeInputRecovery: vi.fn(), acceptQueuedInput: vi.fn(), readQueuedInputs: vi.fn(),
  abandonQueuedInput: vi.fn(), startTurn: vi.fn()
}))
vi.mock('../src/renderer/src/agent/agent-runtime-client', () => ({ agentRuntimeClient: bridge }))
vi.mock('../src/renderer/src/store/chat-session-persistence', () => ({ readLegacyInputRecovery: () => [] }))
const roots = []

beforeEach(() => { vi.resetModules(); vi.resetAllMocks() })
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(runtimeId) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-queue-options-'))
  roots.push(root)
  const ledger = new RuntimeContextLedgerService(root, new Map([[runtimeId, null]]))
  bridge.completeInputRecovery.mockImplementation(input => ledger.completeInputRecovery(input))
  bridge.acceptQueuedInput.mockImplementation((input) => ledger.acceptQueuedInput(input))
  bridge.readQueuedInputs.mockImplementation(input => ledger.readQueuedInputs(input))
  const dispatch = vi.fn()
  bridge.startTurn.mockImplementation(async (input) => {
    if (!input.clientDirectiveId) throw new Error('Missing directive identity.')
    await ledger.acceptDirective({ runtimeId: input.runtimeId, threadId: input.threadId,
      id: input.clientDirectiveId, text: input.displayText ?? input.text,
      inputRevision: input.inputRevision, deliveryPayload: input })
    if (runtimeId === 'dsh' && input.mode) throw new Error('unsupported mode')
    dispatch(input)
    return { runtimeId, threadId: input.threadId, turnId: 'native-turn' }
  })
  const { AgentRuntimeProvider } = await import('../src/renderer/src/agent/agent-runtime-provider')
  const { acceptSessionInput, retrySessionInput } = await import('../src/renderer/src/store/chat-session-admission')
  const ref = { runtimeId, threadId: 'bound-thread' }
  const provider = new AgentRuntimeProvider()
  provider.rememberThreadRuntime(ref.threadId, runtimeId)
  return { ledger, dispatch, ref, provider, acceptSessionInput, retrySessionInput }
}

describe('native composer admission and provider use the same immutable runtime options', () => {
  it.each(['dsh', 'claude', 'codex'])('admits and dispatches one exact %s payload', async runtimeId => {
    const h = await fixture(runtimeId)
    const original = { id: 'correction', text: 'Correct the research input.', mode: 'agent',
      model: 'inherited-model', reasoningEffort: 'medium', serviceTier: 'fast',
      permissionLevel: 'workspace-write', allowedTools: [], governanceProfile: 'default' }
    const accepted = await h.acceptSessionInput(h.ref, original)
    const { id, admissionReceipt, ...options } = accepted
    await h.provider.sendUserMessage(h.ref.threadId, accepted.text, {
      ...options, runtimeId, clientDirectiveId: id, inputRevision: admissionReceipt.revision
    })
    expect(h.dispatch).toHaveBeenCalledOnce()
    const stored = (await h.ledger.readQueuedInputs(h.ref))[0].payload
    const sent = h.dispatch.mock.calls[0][0]
    for (const key of ['mode', 'model', 'reasoningEffort', 'serviceTier', 'permissionLevel', 'allowedTools', 'governanceProfile']) {
      expect(sent[key]).toEqual(stored[key])
    }
    expect(original.reasoningEffort).toBe('medium')
    if (runtimeId === 'dsh') expect(stored).not.toHaveProperty('reasoningEffort')
    else expect(sent.reasoningEffort).toBe('medium')
  })

  it('preserves and refuses an old DSH receipt; only a fresh send normalizes its hints', async () => {
    const h = await fixture('dsh')
    const payload = { id: 'old', text: 'Correct input.', reasoningEffort: 'medium' }
    const receipt = await h.ledger.acceptQueuedInput({ ...h.ref, clientDirectiveId: payload.id, text: payload.text, payload })
    const old = await h.acceptSessionInput(h.ref, { ...payload, admissionReceipt: receipt })
    await expect(h.provider.sendUserMessage(h.ref.threadId, old.text, {
      runtimeId: 'dsh', clientDirectiveId: old.id, inputRevision: receipt.revision, reasoningEffort: old.reasoningEffort
    })).rejects.toThrow('Queued reasoningEffort changed before dispatch')
    expect((await h.ledger.readQueuedInputs(h.ref))[0]).toEqual({ receipt, payload })
    expect(await h.retrySessionInput(h.ref, old.id)).toBeNull()
    expect(h.dispatch).not.toHaveBeenCalled()
    await h.ledger.abandonQueuedInput({ ...h.ref, clientDirectiveId: old.id, expectedRevision: receipt.revision })
    const fresh = await h.acceptSessionInput(h.ref, { ...payload, id: 'explicit-new-send' })
    await h.provider.sendUserMessage(h.ref.threadId, fresh.text, { runtimeId: 'dsh',
      clientDirectiveId: fresh.id, inputRevision: fresh.admissionReceipt.revision, reasoningEffort: fresh.reasoningEffort })
    expect(h.dispatch).toHaveBeenCalledOnce()
  })

  it('retains unsupported nonneutral mode for refusal before native dispatch', async () => {
    const h = await fixture('dsh')
    const queued = await h.acceptSessionInput(h.ref, { id: 'plan', text: 'Plan.', mode: 'plan' })
    await expect(h.provider.sendUserMessage(h.ref.threadId, queued.text, { runtimeId: 'dsh',
      clientDirectiveId: queued.id, inputRevision: queued.admissionReceipt.revision, mode: queued.mode }))
      .rejects.toThrow('unsupported mode')
    expect((await h.ledger.readQueuedInputs(h.ref))[0].payload.mode).toBe('plan')
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
