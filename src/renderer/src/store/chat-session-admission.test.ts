import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ completeInputRecovery: vi.fn(), acceptQueuedInput: vi.fn(),
  readQueuedInputs: vi.fn(), abandonQueuedInput: vi.fn(), auxiliary: vi.fn() }))
const legacy = vi.hoisted(() => ({ readLegacyInputRecovery: vi.fn() }))
vi.mock('../agent/agent-runtime-client', () => ({ agentRuntimeClient: bridge }))
vi.mock('./chat-session-persistence', () => legacy)

describe('Session admission recovery checkpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    legacy.readLegacyInputRecovery.mockReturnValue([])
    bridge.completeInputRecovery.mockResolvedValue(undefined)
    bridge.readQueuedInputs.mockResolvedValue([])
    bridge.auxiliary.mockResolvedValue(null)
  })

  it('imports all bound legacy sessions before acknowledging the one global checkpoint', async () => {
    legacy.readLegacyInputRecovery.mockReturnValue([
      { message: { id: 'a', text: 'private A', threadId: 'A', runtimeId: 'codex', attachmentIds: ['file'] }, disposition: 'unconfirmed' },
      { message: { id: 'b', text: 'private B', threadId: 'B', runtimeId: 'claude' }, disposition: 'uncertain' }
    ])
    const { ensureSessionInputRecovery } = await import('./chat-session-admission')
    await Promise.all([ensureSessionInputRecovery(), ensureSessionInputRecovery()])
    expect(bridge.completeInputRecovery).toHaveBeenCalledTimes(1)
    expect(bridge.completeInputRecovery).toHaveBeenCalledWith({ version: 1, inputs: [
      expect.objectContaining({ threadId: 'A', disposition: 'unconfirmed', payload: expect.objectContaining({ attachmentIds: ['file'], legacyDispositionRequired: true }) }),
      expect.objectContaining({ threadId: 'B', disposition: 'uncertain' })
    ] })
  })

  it('never records an empty checkpoint after an unreadable or unroutable legacy queue', async () => {
    const { ensureSessionInputRecovery } = await import('./chat-session-admission')
    legacy.readLegacyInputRecovery.mockImplementationOnce(() => { throw new Error('corrupt storage') })
    await expect(ensureSessionInputRecovery()).rejects.toThrow('corrupt storage')
    expect(bridge.completeInputRecovery).not.toHaveBeenCalled()
    legacy.readLegacyInputRecovery.mockReturnValue([{ message: { id: 'old', text: 'unbound' }, disposition: 'unconfirmed' }])
    await expect(ensureSessionInputRecovery()).rejects.toThrow('no exact Session/runtime')
    expect(bridge.completeInputRecovery).not.toHaveBeenCalled()
  })

  it('can retry a failed checkpoint without acknowledging success prematurely', async () => {
    const { ensureSessionInputRecovery } = await import('./chat-session-admission')
    bridge.completeInputRecovery.mockRejectedValueOnce(new Error('disk full'))
    await expect(ensureSessionInputRecovery()).rejects.toThrow('disk full')
    await ensureSessionInputRecovery()
    expect(bridge.completeInputRecovery).toHaveBeenCalledTimes(2)
  })

  it('does not promote a legacy disposition record using ordinary retry', async () => {
    bridge.readQueuedInputs.mockResolvedValue([{ receipt: { clientDirectiveId: 'legacy', mode: 'queue', delivery: 'rejected' },
      payload: { id: 'legacy', text: 'private', legacyDispositionRequired: true } }])
    const { retrySessionInput } = await import('./chat-session-admission')
    expect(await retrySessionInput({ runtimeId: 'codex', threadId: 'A' }, 'legacy')).toBeNull()
    expect(bridge.acceptQueuedInput).not.toHaveBeenCalled()
  })

  it('resolves an imported legacy receipt before applying explicit abandonment', async () => {
    bridge.readQueuedInputs.mockResolvedValue([{ receipt: { clientDirectiveId: 'legacy', revision: 7, mode: 'queue', delivery: 'rejected' },
      payload: { id: 'legacy', text: 'private', legacyDispositionRequired: true } }])
    const { abandonSessionInput } = await import('./chat-session-admission')
    await abandonSessionInput({ runtimeId: 'codex', threadId: 'A' }, { id: 'legacy' })
    expect(bridge.abandonQueuedInput).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'A', clientDirectiveId: 'legacy', expectedRevision: 7 })
  })

  it('uses the current language for hydrated input warnings and reconciliation errors', async () => {
    const { readSessionInputs, readSessionInputHistory } = await import('./chat-session-admission')
    const { default: i18n } = await import('../i18n')
    const ref = { runtimeId: 'codex', threadId: 'A' }
    const receipt = { clientDirectiveId: 'input', revision: 3, payloadDigest: 'a'.repeat(64), mode: 'queue', execution: 'not_started' }
    bridge.readQueuedInputs.mockResolvedValue([
      { receipt: { ...receipt, delivery: 'uncertain' }, payload: { text: 'uncertain' } },
      { receipt: { ...receipt, clientDirectiveId: 'legacy', delivery: 'rejected' }, payload: { text: 'legacy', legacyDispositionRequired: true } },
      { receipt: { ...receipt, clientDirectiveId: 'failed', delivery: 'delivered', execution: 'failed', turnId: 'failed-turn' }, payload: { text: 'failed' } }
    ])
    bridge.auxiliary.mockResolvedValue({ runtimeId: 'codex', threadId: 'different', directives: [] })
    const { INPUT_RECONCILIATION_REQUIRED, LEGACY_INPUT_DISPOSITION_REQUIRED } = await import('./chat-session-admission')
    for (const language of ['en', 'zh'] as const) {
      await i18n.changeLanguage(language)
      const warnings = (await readSessionInputs(ref)).map(message => message.sendFailure?.message)
      expect(warnings[0]).toContain('delivery "uncertain"')
      expect(warnings[0]).toContain('execution "not_started"')
      expect(warnings[1]).toEqual(LEGACY_INPUT_DISPOSITION_REQUIRED)
      expect(warnings[2]).toEqual(i18n.t('common:sessionInputExecutionFailed'))
      await expect(readSessionInputHistory(ref, 'input')).rejects.toThrow(i18n.t('common:sessionInputReconciliationRequired'))
    }
  })

  it('keeps unbound legacy disposition safe across language changes without trusting display text', async () => {
    const { abandonSessionInput, INPUT_RECONCILIATION_REQUIRED, LEGACY_INPUT_DISPOSITION_REQUIRED } = await import('./chat-session-admission')
    const { default: i18n } = await import('../i18n')
    await i18n.changeLanguage('zh')
    const ref = { runtimeId: 'codex', threadId: '' }
    const warning = { message: LEGACY_INPUT_DISPOSITION_REQUIRED,
      kind: 'legacy-disposition-required' as const }
    await expect(abandonSessionInput(ref, { id: 'known-unsent', sendFailure: warning })).resolves.toBeUndefined()
    await expect(abandonSessionInput(ref, { id: 'unknown-failure', sendFailure: { message: i18n.t('common:sessionInputLegacyDispositionRequired') } }))
      .rejects.toThrow(INPUT_RECONCILIATION_REQUIRED)
    await expect(abandonSessionInput(ref, { id: 'attempted', deliveryAttempt: {}, sendFailure: warning }))
      .rejects.toThrow(INPUT_RECONCILIATION_REQUIRED)
    expect(bridge.abandonQueuedInput).not.toHaveBeenCalled()
  })

  it('normal queue hydration keeps Host ordering and never reads or filters Session history', async () => {
    const receipt = { clientDirectiveId: 'uncertain', revision: 3, payloadDigest: 'a'.repeat(64), mode: 'queue',
      delivery: 'uncertain', execution: 'not_started' }
    bridge.readQueuedInputs.mockResolvedValue([
      { receipt, payload: { text: 'unresolved input' } },
      { receipt: { ...receipt, clientDirectiveId: 'delivering', delivery: 'delivering' }, payload: { text: 'delivering input' } }
    ])
    const { readSessionInputs } = await import('./chat-session-admission')
    const inputs = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(inputs.map(input => input.id)).toEqual(['uncertain', 'delivering'])
    expect(inputs.every(input => Boolean(input.sendFailure))).toBe(true)
    expect(bridge.auxiliary).not.toHaveBeenCalled()
  })

  it('keeps output validation pending without mislabelling the accepted execution as a send failure', async () => {
    const receipt = { clientDirectiveId: 'validating', revision: 4, payloadDigest: 'a'.repeat(64), mode: 'queue',
      delivery: 'delivered', execution: 'output_pending', turnId: 'completed-turn' }
    bridge.readQueuedInputs.mockResolvedValue([{ receipt, payload: { text: 'original instruction',
      sendFailure: { message: 'obsolete local failure' } } }])
    const { readSessionInputs, canDispatchSessionInput } = await import('./chat-session-admission')
    const [message] = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(message.admissionReceipt).toEqual(receipt)
    expect(message.sendFailure).toBeUndefined()
    expect(canDispatchSessionInput(message.admissionReceipt)).toBe(false)
  })

  it.each(['delivering', 'delivered'] as const)('keeps a known %s active input in Host order without labelling execution as send failure', async (delivery) => {
    const receipt = { clientDirectiveId: 'active', revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct',
      delivery, execution: 'active' }
    bridge.readQueuedInputs.mockResolvedValue([
      { receipt, payload: { text: 'current instruction', sendFailure: { message: 'obsolete' } } },
      { receipt: { ...receipt, clientDirectiveId: 'next', mode: 'queue', delivery: 'accepted', execution: 'not_started' },
        payload: { text: 'next instruction' } }
    ])
    const { readSessionInputs, canDispatchSessionInput } = await import('./chat-session-admission')
    const inputs = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(inputs.map(input => input.id)).toEqual(['active', 'next'])
    expect(inputs[0].admissionReceipt).toEqual(receipt)
    expect(inputs[0].sendFailure).toBeUndefined()
    expect(canDispatchSessionInput(inputs[0].admissionReceipt)).toBe(false)
    expect(canDispatchSessionInput(inputs[1].admissionReceipt)).toBe(true)
    expect(bridge.auxiliary).not.toHaveBeenCalled()
  })

  it('does not treat an uncertain active receipt as confirmed execution or bypass its ordering barrier', async () => {
    const receipt = { clientDirectiveId: 'uncertain-active', revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct',
      delivery: 'uncertain', execution: 'active' }
    bridge.readQueuedInputs.mockResolvedValue([{ receipt, payload: { text: 'uncertain instruction' } }])
    const { readSessionInputs, canDispatchSessionInput, isSessionInputExecuting } = await import('./chat-session-admission')
    const [message] = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(message.admissionReceipt).toEqual(receipt)
    expect(message.sendFailure).toBeDefined()
    expect(isSessionInputExecuting(message.admissionReceipt)).toBe(false)
    expect(canDispatchSessionInput(message.admissionReceipt)).toBe(false)
  })

  it('reads a direct failed instruction from its durable Host ledger text without consulting a transcript or queue', async () => {
    const directive = { id: 'direct-failed', text: 'complete original instruction', acceptedAt: '2026-10-20T01:00:00.000Z',
      delivery: 'delivered', turnId: 'failed-turn',
      admission: { revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct', execution: 'failed' } }
    bridge.auxiliary.mockResolvedValue({ runtimeId: 'codex', threadId: 'A', directives: [directive] })
    const { readSessionInputHistory } = await import('./chat-session-admission')
    const source = await readSessionInputHistory({ runtimeId: 'codex', threadId: 'A' }, directive.id)
    expect(source).toMatchObject({ id: directive.id, text: directive.text, createdAt: directive.acceptedAt,
      runtimeId: 'codex', threadId: 'A', admissionReceipt: { ...directive.admission, clientDirectiveId: directive.id,
        delivery: 'delivered', turnId: 'failed-turn' } })
    expect(bridge.readQueuedInputs).not.toHaveBeenCalled()
    expect(directive.admission.revision).toBe(4)
  })

  it.each([
    { runtimeId: 'claude', threadId: 'A' },
    { runtimeId: 'codex', threadId: 'other-thread' }
  ])('refuses historical payloads from a different exact Session (%j)', async (binding) => {
    bridge.auxiliary.mockResolvedValue({ ...binding, directives: [] })
    const { readSessionInputHistory } = await import('./chat-session-admission')
    const { default: i18n } = await import('../i18n')
    await expect(readSessionInputHistory({ runtimeId: 'codex', threadId: 'A' }, 'failed')).rejects.toThrow(i18n.t('common:sessionInputReconciliationRequired'))
  })

  it('refuses ambiguous or unreceipted history and malformed stored payloads', async () => {
    const ref = { runtimeId: 'codex', threadId: 'A' }
    const directive = { id: 'failed', text: 'durable original', acceptedAt: '2026-10-20T01:00:00.000Z',
      delivery: 'delivered', turnId: 'failed-turn',
      admission: { revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct', execution: 'failed' } }
    const { readSessionInputHistory } = await import('./chat-session-admission')
    const { default: i18n } = await import('../i18n')
    bridge.auxiliary.mockResolvedValue({ ...ref, directives: [directive, directive] })
    expect(await readSessionInputHistory(ref, directive.id)).toBeNull()
    bridge.auxiliary.mockResolvedValue({ ...ref, directives: [{ ...directive, admission: undefined }] })
    expect(await readSessionInputHistory(ref, directive.id)).toBeNull()
    bridge.auxiliary.mockResolvedValue({ ...ref, directives: [{ ...directive, queuePayload: { text: '' } }] })
    await expect(readSessionInputHistory(ref, directive.id)).rejects.toThrow(i18n.t('common:sessionInputReconciliationRequired'))
    expect(bridge.acceptQueuedInput).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'] as const)('projects the latest confirmed %s receipt as a separate action fact while the runnable queue stays empty', async execution => {
    const directive = { id: 'terminal-source', text: 'original private instruction', acceptedAt: '2026-10-20T01:00:00.000Z',
      delivery: 'delivered', turnId: 'terminal-turn',
      admission: { revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct', execution } }
    bridge.auxiliary.mockResolvedValue({ runtimeId: 'codex', threadId: 'A', directives: [directive] })
    const { readSessionInputs, readLatestSessionFailure } = await import('./chat-session-admission')
    expect(await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })).toEqual([])
    const fact = await readLatestSessionFailure({ runtimeId: 'codex', threadId: 'A' })
    expect(fact).toEqual({ receipt: { ...directive.admission, clientDirectiveId: directive.id,
      delivery: 'delivered', turnId: directive.turnId } })
    expect(await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })).toEqual([])
    expect(bridge.acceptQueuedInput).not.toHaveBeenCalled()
  })

  it('retires the bottom failure affordance after a newer input and never promotes unresolved history', async () => {
    const ref = { runtimeId: 'codex', threadId: 'A' }
    const failed = { id: 'failed', text: 'original', acceptedAt: '2026-10-20T01:00:00.000Z', delivery: 'delivered',
      turnId: 'failed-turn', admission: { revision: 4, payloadDigest: 'a'.repeat(64), mode: 'direct', execution: 'failed' } }
    const { readLatestSessionFailure } = await import('./chat-session-admission')
    for (const delivery of ['uncertain', 'delivering', 'accepted']) {
      bridge.auxiliary.mockResolvedValue({ ...ref, directives: [{ ...failed, delivery }] })
      expect(await readLatestSessionFailure(ref)).toBeNull()
    }
    for (const execution of ['not_started', 'active', 'output_pending', 'completed']) {
      bridge.auxiliary.mockResolvedValue({ ...ref, directives: [failed, { ...failed, id: 'newer', admission: { ...failed.admission, execution } }] })
      expect(await readLatestSessionFailure(ref)).toBeNull()
    }
  })

  it('refreshes a stale receipt once before abandoning a queue item', async () => {
    const current = { clientDirectiveId: 'queued', revision: 4, payloadDigest: 'a'.repeat(64),
      mode: 'queue' as const, delivery: 'rejected' as const, execution: 'failed' as const }
    bridge.readQueuedInputs.mockResolvedValueOnce([{ receipt: current, payload: { text: 'queued' } }])
    bridge.abandonQueuedInput
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'input_revision_conflict' }))
      .mockResolvedValueOnce(undefined)
    const { abandonSessionInput } = await import('./chat-session-admission')
    await abandonSessionInput({ runtimeId: 'codex', threadId: 'A' }, {
      id: 'queued',
      admissionReceipt: { ...current, revision: 3 }
    })
    expect(bridge.abandonQueuedInput).toHaveBeenNthCalledWith(2, {
      runtimeId: 'codex', threadId: 'A', clientDirectiveId: 'queued', expectedRevision: 4
    })
  })

  it('states the actual receipt state and the delete-or-resend path for a stuck input', async () => {
    bridge.readQueuedInputs.mockResolvedValue([{ receipt: { clientDirectiveId: 'stuck', revision: 2,
      payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'uncertain', execution: 'active' },
      payload: { id: 'stuck', text: 'important instruction' } }])
    const { readSessionInputs, INPUT_RECONCILIATION_REQUIRED } = await import('./chat-session-admission')
    const [message] = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(message.sendFailure?.message).toContain('delivery "uncertain"')
    expect(message.sendFailure?.message).toContain('execution "active"')
    expect(message.sendFailure?.message).toContain('Delete this entry and send it again')
    expect(message.sendFailure?.message).not.toEqual(INPUT_RECONCILIATION_REQUIRED)
  })

  it('keeps the legacy disposition copy for imported inputs without a durable receipt', async () => {
    bridge.readQueuedInputs.mockResolvedValue([{ receipt: { clientDirectiveId: 'legacy', revision: 3,
      payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'rejected', execution: 'failed' },
      payload: { id: 'legacy', text: 'private', legacyDispositionRequired: true } }])
    const { readSessionInputs, LEGACY_INPUT_DISPOSITION_REQUIRED } = await import('./chat-session-admission')
    const [message] = await readSessionInputs({ runtimeId: 'codex', threadId: 'A' })
    expect(message.sendFailure?.message).toEqual(LEGACY_INPUT_DISPOSITION_REQUIRED)
  })
})
