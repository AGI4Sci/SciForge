import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeContextLedgerService } from './runtime-context-ledger-service'
import * as storage from './app-data-store'

const roots: string[] = []
const session = { runtimeId: 'codex' as const, threadId: 'bound-session' }
const submission = { ...session, operationId: 'submission-1', expectedRevision: 0, targetDigest: 'a'.repeat(64) }
const queue = { ...session, clientDirectiveId: 'input-1', text: 'Check the output', payload: { id: 'input-1', text: 'Check the output', attachmentIds: ['file-1'], model: 'configured-model' } }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-admission-'))
  roots.push(root)
  const ledger = new RuntimeContextLedgerService(root, ledgerRuntimes)
  await ledger.completeInputRecovery({ version: 1, inputs: [] })
  return { root, ledger }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const ledgerRuntimes = new Map([['codex', null], ['claude', null], ['dsh', null]] as const)

describe('durable Session input and submission admission', () => {
  it.each(['failed', 'cancelled'] as const)('does not queue delivered %s input ahead of a fresh Member message', async (state) => {
    const { ledger } = await fixture()
    await ledger.acceptDirective({ ...session, id: 'old-worker-input', text: 'Original task' })
    await ledger.beginDirectiveDelivery({ ...session, id: 'old-worker-input' })
    await ledger.finishDirectiveDelivery({ ...session, id: 'old-worker-input', delivery: 'delivered', turnId: 'old-worker-turn' })
    await ledger.observeTurnOutput({ ...session, turnId: 'old-worker-turn', state, validated: true })
    await ledger.acceptQueuedInput({ ...queue, clientDirectiveId: 'fresh-member-input', text: 'Please continue with a new requirement', payload: { text: 'Please continue with a new requirement' } })
    const pending = await ledger.readQueuedInputs(session)
    expect(pending.map(({ receipt }) => receipt.clientDirectiveId)).toEqual(['fresh-member-input'])
    expect(pending[0]?.receipt).toMatchObject({ delivery: 'accepted', mode: 'queue', execution: 'not_started' })
    expect((await ledger.beginDirectiveDelivery({ ...session, id: 'fresh-member-input' })).deliver).toBe(true)
    expect((await ledger.beginDirectiveDelivery({ ...session, id: 'old-worker-input' })).deliver).toBe(false)
    expect((await ledger.readAdmission(session)).receipts.find(({ clientDirectiveId }) => clientDirectiveId === 'old-worker-input')).toMatchObject({ delivery: 'delivered', execution: state })
  })

  it('serializes both queue-versus-submit orders at the durable mutation', async () => {
    const first = await fixture()
    const accepted = first.ledger.acceptQueuedInput(queue)
    const blocked = first.ledger.acquireSubmission(submission)
    await expect(accepted).resolves.toMatchObject({ delivery: 'accepted', revision: 1 })
    await expect(blocked).rejects.toMatchObject({ code: 'admission_revision_conflict' })
    const second = await fixture()
    const locked = second.ledger.acquireSubmission(submission)
    const unsent = second.ledger.acceptQueuedInput(queue)
    await expect(locked).resolves.toMatchObject({ submission: { operationId: 'submission-1' } })
    await expect(unsent).rejects.toMatchObject({ code: 'submission_locked' })
    expect(await second.ledger.readQueuedInputs(session)).toEqual([])
  })

  it('keeps fences across restart with exact replay and release identity', async () => {
    const { root, ledger } = await fixture()
    const locked = await ledger.acquireSubmission(submission)
    const restored = new RuntimeContextLedgerService(root, ledgerRuntimes)
    expect(await restored.acquireSubmission(submission)).toEqual(locked)
    await expect(restored.releaseSubmission({ ...submission, targetDigest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'submission_identity_conflict' })
    await expect(restored.acceptDirective({ ...session, id: 'direct', text: 'Change output' })).rejects.toMatchObject({ code: 'submission_locked' })
    await expect(restored.acceptDirective({ ...session, id: 'steer', text: 'Change output', mode: 'steer' })).rejects.toMatchObject({ code: 'submission_locked' })
    await restored.releaseSubmission(submission)
    expect((await restored.acceptQueuedInput(queue)).delivery).toBe('accepted')
  })

  it('preserves complete queue payload and rejects stale edits or dispatch options', async () => {
    const { root, ledger } = await fixture()
    await ledger.acceptQueuedInput(queue)
    const restored = new RuntimeContextLedgerService(root, ledgerRuntimes)
    expect((await restored.readQueuedInputs(session))[0]?.payload).toEqual(queue.payload)
    await expect(restored.acceptDirective({ ...session, id: queue.clientDirectiveId, text: queue.text, inputRevision: 1, deliveryPayload: { attachmentIds: ['other'], model: 'configured-model' } })).rejects.toMatchObject({ code: 'input_immutable' })
    const edited = await restored.acceptQueuedInput({ ...queue, text: 'Recheck', payload: { ...queue.payload, text: 'Recheck' }, expectedRevision: 1 })
    expect(edited.revision).toBe(2)
    await expect(restored.abandonQueuedInput({ ...queue, expectedRevision: 1 })).rejects.toMatchObject({ code: 'input_revision_conflict' })
    await restored.abandonQueuedInput({ ...queue, expectedRevision: 2 })
    expect(await restored.readQueuedInputs(session)).toEqual([])
  })

  it('keeps terminal output pending until validation, without advancing the candidate watermark', async () => {
    const { ledger } = await fixture()
    await ledger.acceptDirective({ ...session, id: 'direct', text: 'Create candidate' })
    await ledger.beginDirectiveDelivery({ ...session, id: 'direct' })
    await ledger.finishDirectiveDelivery({ ...session, id: 'direct', delivery: 'delivered', turnId: 'turn-1' })
    const output = { ...session, turnId: 'turn-1', state: 'completed' as const }
    await ledger.observeTurnOutput({ ...output, validated: false })
    const pending = await ledger.readAdmission(session)
    await expect(ledger.acquireSubmission({ ...submission, expectedRevision: pending.revision })).rejects.toMatchObject({ code: 'session_input_pending' })
    await ledger.observeTurnOutput({ ...output, validated: true })
    expect((await ledger.readAdmission(session)).revision).toBe(pending.revision)
    await expect(ledger.acquireSubmission({ ...submission, expectedRevision: pending.revision })).resolves.toMatchObject({ submission: { operationId: 'submission-1' } })
  })

  it.each(['failed', 'cancelled'] as const)('keeps a delivered %s receipt unchanged while a fresh input completes and releases submission', async (outcome) => {
    const { ledger } = await fixture()
    await ledger.acceptDirective({ ...session, id: 'failed-source', text: 'Original task text' })
    await ledger.beginDirectiveDelivery({ ...session, id: 'failed-source' })
    await ledger.finishDirectiveDelivery({ ...session, id: 'failed-source', delivery: 'delivered', turnId: 'failed-turn' })
    await ledger.observeTurnOutput({ ...session, turnId: 'failed-turn', state: outcome, validated: true })
    const old = (await ledger.readAdmission(session)).receipts.find(({ clientDirectiveId }) => clientDirectiveId === 'failed-source')!
    expect(old).toMatchObject({ delivery: 'delivered', execution: outcome })
    expect(await ledger.readQueuedInputs(session)).toEqual([])
    expect((await ledger.beginDirectiveDelivery({ ...session, id: 'failed-source' })).deliver).toBe(false)
    const fresh = { ...session, clientDirectiveId: 'fresh-input', text: 'Original task text', payload: { text: 'Original task text' } }
    await ledger.acceptQueuedInput(fresh)
    await expect(ledger.acceptDirective({ ...session, id: 'failed-source', text: 'Original task text' })).resolves.toMatchObject({ delivery: 'delivered' })
    await ledger.acceptDirective({ ...session, id: 'fresh-input', text: fresh.text, inputRevision: 1 })
    expect((await ledger.beginDirectiveDelivery({ ...session, id: 'fresh-input' })).deliver).toBe(true)
    await ledger.finishDirectiveDelivery({ ...session, id: 'fresh-input', delivery: 'delivered', turnId: 'fresh-turn' })
    await ledger.observeTurnOutput({ ...session, turnId: 'fresh-turn', state: 'completed', validated: true })
    const done = await ledger.readAdmission(session)
    expect(done.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientDirectiveId: 'failed-source', delivery: 'delivered', execution: outcome, revision: old.revision }),
      expect.objectContaining({ clientDirectiveId: 'fresh-input', delivery: 'delivered', execution: 'completed' })
    ]))
    await expect(ledger.acquireSubmission({ ...submission, expectedRevision: done.revision })).resolves.toMatchObject({ submission: { operationId: 'submission-1' } })
  })

  it.each(['delivering', 'uncertain'] as const)('keeps %s delivery ahead of a fresh Member input and blocks submission', async (delivery) => {
    const first = await fixture()
    await first.ledger.acceptDirective({ ...session, id: 'unsettled-input', text: 'Original task' })
    await first.ledger.beginDirectiveDelivery({ ...session, id: 'unsettled-input' })
    if (delivery === 'uncertain') await first.ledger.finishDirectiveDelivery({ ...session, id: 'unsettled-input', delivery: 'uncertain' })
    const ledger = first.ledger
    await ledger.acceptQueuedInput({ ...queue, clientDirectiveId: 'waiting-member-input' })
    const pending = await ledger.readQueuedInputs(session)
    expect(pending.map(({ receipt }) => receipt.clientDirectiveId)).toEqual(['unsettled-input', 'waiting-member-input'])
    expect(pending[0]?.receipt.delivery).toBe(delivery)
    const current = await ledger.readAdmission(session)
    await expect(ledger.acquireSubmission({ ...submission, expectedRevision: current.revision })).rejects.toMatchObject({ code: 'session_input_pending' })
  })

  it('preserves uncertain delivery and refuses abandonment or another provider attempt', async () => {
    const { root, ledger } = await fixture()
    await ledger.acceptQueuedInput(queue)
    await ledger.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId })
    const restored = new RuntimeContextLedgerService(root, ledgerRuntimes)
    await expect(restored.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId })).rejects.toThrow('uncertain')
    await expect(restored.abandonQueuedInput({ ...queue, expectedRevision: 1 })).rejects.toMatchObject({ code: 'admission_recovery_required' })
    expect((await restored.readAdmission(session)).recovery).toBe('required')
  })

  it('requires explicit same-payload retry for a definite provider rejection', async () => {
    const { ledger } = await fixture()
    await ledger.acceptQueuedInput(queue)
    await ledger.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId })
    await ledger.finishDirectiveDelivery({ ...session, id: queue.clientDirectiveId, delivery: 'rejected' })
    await expect(ledger.acceptQueuedInput(queue)).rejects.toMatchObject({ code: 'input_revision_conflict' })
    expect(await ledger.acceptQueuedInput({ ...queue, expectedRevision: 1 })).toMatchObject({ revision: 2, delivery: 'accepted', execution: 'not_started' })
  })

  it('does not publish failed writes or treat corrupt storage as an empty Session', async () => {
    const { root, ledger } = await fixture()
    await ledger.readAdmission(session)
    vi.spyOn(storage, 'atomicWriteAppDataJson').mockRejectedValueOnce(new Error('disk failure'))
    await expect(ledger.acceptQueuedInput(queue)).rejects.toThrow('disk failure')
    expect((await ledger.readAdmission(session)).receipts).toEqual([])
    await mkdir(join(root, 'runtime-context-ledgers'), { recursive: true })
    await writeFile(join(root, 'runtime-context-ledgers', 'ledgers.json'), '{broken')
    await expect(new RuntimeContextLedgerService(root, ledgerRuntimes).acquireSubmission(submission)).rejects.toThrow()
  })

  it('rechecks captured authority at the final mutation before persisting a fence', async () => {
    const { ledger } = await fixture()
    await expect(ledger.acquireSubmission(submission, () => { throw new Error('binding reassigned') })).rejects.toThrow('binding reassigned')
    expect((await ledger.readAdmission(session)).submission).toBeNull()
  })
})


describe('Session recovery and confirmation leases', () => {
  it('requires durable browser recovery checkpoint, preserving residual input without dispatch', async () => {
    const freshRoot = await mkdtemp(join(tmpdir(), 'session-recovery-'))
    roots.push(freshRoot)
    const fresh = new RuntimeContextLedgerService(freshRoot, ledgerRuntimes)
    await expect(fresh.acquireSubmission(submission)).rejects.toMatchObject({ code: 'admission_recovery_required' })
    await fresh.completeInputRecovery({ version: 1, inputs: [{ ...queue, disposition: 'unconfirmed' }] })
    const restored = new RuntimeContextLedgerService(freshRoot, ledgerRuntimes)
    const [item] = await restored.readQueuedInputs(session)
    expect(item).toMatchObject({ receipt: { delivery: 'rejected', execution: 'not_started' }, payload: { legacyDispositionRequired: true } })
    await expect(restored.acceptQueuedInput({ ...queue, payload: { ...queue.payload, legacyDispositionRequired: true }, expectedRevision: 1 })).rejects.toMatchObject({ code: 'admission_recovery_required' })
    await expect(restored.acquireSubmission({ ...submission, expectedRevision: 1 })).rejects.toMatchObject({ code: 'session_input_pending' })
    await restored.abandonQueuedInput({ ...queue, expectedRevision: 1 })
    await expect(restored.acquireSubmission({ ...submission, expectedRevision: 2 })).resolves.toMatchObject({ submission: { operationId: 'submission-1' } })
  })

  it('invalidates a native confirmation lease on input or context reset and preserves the fence', async () => {
    const { ledger } = await fixture()
    const assertCurrent = await ledger.captureAdmissionLease(session)
    assertCurrent()
    await ledger.acceptQueuedInput(queue)
    expect(assertCurrent).toThrow(/changed/u)
    await ledger.abandonQueuedInput({ ...queue, expectedRevision: 1 })
    const beforeReset = await ledger.captureAdmissionLease(session)
    await ledger.reset(session)
    expect(beforeReset).toThrow(/changed/u)
    await ledger.acquireSubmission({ ...submission, expectedRevision: 3 })
    await expect(ledger.reset(session)).rejects.toMatchObject({ code: 'submission_locked' })
  })

  it('allows plain queue Steer without irrelevant model options but rejects attachment loss', async () => {
    const { ledger } = await fixture()
    await ledger.acceptQueuedInput({ ...queue, payload: { ...queue.payload, attachmentIds: [] } })
    await expect(ledger.acceptDirective({ ...session, id: queue.clientDirectiveId, text: queue.text, inputRevision: 1, mode: 'steer' })).resolves.toMatchObject({ id: queue.clientDirectiveId, admission: { mode: 'queue', revision: 1 } })
    await expect(ledger.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId, mode: 'steer' })).resolves.toMatchObject({ deliver: true, directive: { admission: { mode: 'steer', revision: 1 } } })
    const other = await fixture()
    await other.ledger.acceptQueuedInput(queue)
    await expect(other.ledger.acceptDirective({ ...session, id: queue.clientDirectiveId, text: queue.text, inputRevision: 1, mode: 'steer' })).rejects.toMatchObject({ code: 'input_immutable' })
    expect((await other.ledger.readAdmission(session)).receipts[0]?.mode).toBe('queue')
  })

  it.each(['delivered', 'uncertain'] as const)('never relabels a %s queued delivery as Steer', async (delivery) => {
    const { ledger } = await fixture()
    await ledger.acceptQueuedInput({ ...queue, payload: { text: queue.text } })
    await ledger.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId })
    await ledger.finishDirectiveDelivery({ ...session, id: queue.clientDirectiveId, delivery, turnId: 'original-turn' })
    const before = (await ledger.readAdmission(session)).receipts[0]
    await ledger.acceptDirective({ ...session, id: queue.clientDirectiveId, text: queue.text, inputRevision: 1, mode: 'steer' })
    const attempt = ledger.beginDirectiveDelivery({ ...session, id: queue.clientDirectiveId, mode: 'steer' })
    if (delivery === 'delivered') await expect(attempt).resolves.toMatchObject({ deliver: false })
    else await expect(attempt).rejects.toThrow('uncertain')
    expect((await ledger.readAdmission(session)).receipts[0]).toEqual(before)
  })
})
