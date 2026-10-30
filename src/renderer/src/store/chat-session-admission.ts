import { sessionInputReceiptSchema, type SessionAdmissionRef, type SessionInputReceipt, type SessionQueuedInput, type SessionInputRecovery, type SessionQueuedInputSnapshot } from '@sciforge/domain-sdk/agent-execution'
import type { AgentRuntimeContextLedger, AgentRuntimeId } from '@shared/agent-runtime-contract'
import { agentRuntimeClient } from '../agent/agent-runtime-client'
import i18n from '../i18n'
import type { QueuedUserMessage } from './chat-store-types'

export const INPUT_RECONCILIATION_REQUIRED = 'This input needs its original runtime receipt verified before it can be sent again.'
export const LEGACY_INPUT_DISPOSITION_REQUIRED = 'This saved input has no durable receipt. Copy it into the composer to send it explicitly, or remove it.'

/**
 * Display copy for a queue entry whose receipt can never dispatch again in its
 * current state. States the actual receipt values, the likely cause, and the
 * two escape hatches (delete-and-resend, or copy the preserved text) instead
 * of claiming a verification step that does not exist.
 */
export function inputReconciliationMessage(receipt: SessionInputReceipt): string {
  return `This input cannot be sent again in its current state: the runtime receipt shows delivery "${receipt.delivery}" and execution "${receipt.execution}". ` +
    'The previous send never settled — usually because the runtime process ended before delivery completed. ' +
    'Delete this entry and send it again; the original text remains in the queue so you can copy it.'
}

let recoveryCheckpoint: Promise<void> | null = null

export async function ensureSessionInputRecovery(): Promise<void> {
  if (!recoveryCheckpoint) {
    recoveryCheckpoint = (async () => {
      const { readLegacyInputRecovery } = await import('./chat-session-persistence')
      const inputs: SessionInputRecovery['inputs'] = readLegacyInputRecovery().map(({ message, disposition }) => {
        const threadId = message.threadId ?? message.targetThreadId
        if (!threadId || !message.runtimeId) throw new Error('A saved input has no exact Session/runtime binding; explicitly dispose it before resuming.')
        return { runtimeId: message.runtimeId, threadId, clientDirectiveId: message.id,
          text: message.displayText ?? message.text, disposition,
          payload: JSON.parse(JSON.stringify({ ...message, legacyDispositionRequired: true })) as SessionQueuedInput['payload'] }
      })
      await agentRuntimeClient.completeInputRecovery({ version: 1, inputs })
    })().catch((error) => { recoveryCheckpoint = null; throw error })
  }
  await recoveryCheckpoint
}

export async function acceptSessionInput<T extends { id: string; text: string; displayText?: string; admissionReceipt?: SessionInputReceipt }>(
  ref: SessionAdmissionRef, message: T
): Promise<T & { admissionReceipt: SessionInputReceipt }> {
  await ensureSessionInputRecovery()
  const { admissionReceipt, ...body } = message
  const payload = JSON.parse(JSON.stringify(body)) as SessionQueuedInput['payload']
  const receipt = await agentRuntimeClient.acceptQueuedInput({
    ...ref, clientDirectiveId: message.id, text: message.displayText ?? message.text, payload,
    ...(admissionReceipt ? { expectedRevision: admissionReceipt.revision } : {})
  })
  return { ...message, admissionReceipt: receipt }
}

export function canReexecuteSessionInput(receipt: SessionInputReceipt | undefined): boolean {
  return receipt?.delivery === 'delivered' && receipt.execution === 'failed' && Boolean(receipt.turnId)
}

export function canReplaySessionInput(receipt: SessionInputReceipt | undefined): boolean {
  return canDispatchSessionInput(receipt) || (receipt?.mode === 'queue' && receipt.delivery === 'rejected')
}

export function canDispatchSessionInput(receipt: SessionInputReceipt | undefined): boolean {
  return receipt?.mode === 'queue' && receipt.delivery === 'accepted' && receipt.execution === 'not_started'
}

/** Active Host execution is read-only; an uncertain delivery is still unresolved. */
export function isSessionInputExecuting(receipt: SessionInputReceipt | undefined): boolean {
  return (receipt?.delivery === 'delivering' || receipt?.delivery === 'delivered') && receipt.execution === 'active'
}

export function isSessionInputOutputPending(receipt: SessionInputReceipt | undefined): boolean {
  return receipt?.delivery === 'delivered' && receipt.execution === 'output_pending'
}

/** Only Host receipts may authorize replay. Browser snapshots are private pending disposition. */
export async function readSessionInputs(ref: SessionAdmissionRef): Promise<QueuedUserMessage[]> {
  await ensureSessionInputRecovery()
  const entries = await agentRuntimeClient.readQueuedInputs(ref)
  return entries.map(entry => normalizeSessionInput(ref, entry))
}

/** Completed failures leave the runnable queue; their durable Host history remains authoritative. */
export async function readSessionInputHistory(ref: SessionAdmissionRef, id: string): Promise<QueuedUserMessage | null> {
  const ledger = await readSessionLedger(ref)
  if (!ledger) return null
  const matches = ledger.directives.filter(directive => directive.id === id)
  if (matches.length !== 1) return null
  const directive = matches[0]
  if (!directive.admission) return null
  const receipt = sessionInputReceiptSchema.parse({
    ...directive.admission,
    clientDirectiveId: directive.id,
    delivery: directive.delivery,
    ...(directive.turnId ? { turnId: directive.turnId } : {})
  })
  return normalizeSessionInput(ref, { receipt, payload: directive.queuePayload ?? {
    id: directive.id, text: directive.text, createdAt: directive.acceptedAt
  } })
}

/** Presentation-only terminal fact. It is never inserted into the runnable queue. */
export type SessionFailureFact = Readonly<{ receipt: SessionInputReceipt }>

export async function readLatestSessionFailure(ref: SessionAdmissionRef): Promise<SessionFailureFact | null> {
  const ledger = await readSessionLedger(ref)
  const latest = ledger?.directives.at(-1)
  if (!latest?.admission || latest.delivery !== 'delivered' || !latest.turnId ||
      !['failed', 'cancelled'].includes(latest.admission.execution)) return null
  const receipt = sessionInputReceiptSchema.parse({ ...latest.admission, clientDirectiveId: latest.id,
    delivery: latest.delivery, turnId: latest.turnId })
  return { receipt }
}

async function readSessionLedger(ref: SessionAdmissionRef): Promise<AgentRuntimeContextLedger | null> {
  await ensureSessionInputRecovery()
  const ledger = await agentRuntimeClient.auxiliary<AgentRuntimeContextLedger | null>({
    runtimeId: ref.runtimeId as AgentRuntimeId, operation: 'getRuntimeContextLedger', payload: { threadId: ref.threadId }
  })
  if (ledger && (ledger.runtimeId !== ref.runtimeId || ledger.threadId !== ref.threadId)) throw new Error(i18n.t('common:sessionInputReconciliationRequired'))
  return ledger
}

function normalizeSessionInput(ref: SessionAdmissionRef, { receipt, payload }: SessionQueuedInputSnapshot): QueuedUserMessage {
  if (typeof payload.text !== 'string' || !payload.text.trim()) throw new Error(i18n.t('common:sessionInputReconciliationRequired'))
  const message = {
    ...payload, id: receipt.clientDirectiveId, threadId: ref.threadId,
    runtimeId: ref.runtimeId, admissionReceipt: receipt
  } as QueuedUserMessage
  if (isSessionInputExecuting(receipt) || isSessionInputOutputPending(receipt)) {
    delete message.sendFailure
  } else if (!canDispatchSessionInput(receipt)) {
    message.sendFailure = { userBlockId: message.id, message:
      payload.legacyDispositionRequired === true && receipt.delivery === 'rejected'
        ? LEGACY_INPUT_DISPOSITION_REQUIRED : canReexecuteSessionInput(receipt)
          ? i18n.t('common:sessionInputExecutionFailed') : inputReconciliationMessage(receipt) }
  }
  return message
}

/** Explicit retry preserves the exact stored body; failed direct/steer summaries cannot reconstruct a request. */
export async function retrySessionInput(ref: SessionAdmissionRef, id: string): Promise<QueuedUserMessage | null> {
  const entry = (await agentRuntimeClient.readQueuedInputs(ref)).find(({ receipt }) => receipt.clientDirectiveId === id)
  if (!entry || entry.receipt.mode !== 'queue' || entry.payload.legacyDispositionRequired === true) return null
  const { receipt, payload } = entry
  if (receipt.delivery !== 'rejected') return null
  if (typeof payload.text !== 'string') throw new Error(i18n.t('common:sessionInputReconciliationRequired'))
  const accepted = await agentRuntimeClient.acceptQueuedInput({ ...ref, clientDirectiveId: id,
    text: typeof payload.displayText === 'string' ? payload.displayText : payload.text,
    payload: { ...payload }, expectedRevision: receipt.revision })
  return { ...payload, id, runtimeId: ref.runtimeId, threadId: ref.threadId, admissionReceipt: accepted } as QueuedUserMessage
}

export async function abandonSessionInput(
  ref: SessionAdmissionRef,
  message: { id: string; admissionReceipt?: SessionInputReceipt; deliveryAttempt?: unknown;
    sendFailure?: Pick<NonNullable<QueuedUserMessage['sendFailure']>, 'message' | 'kind'>; force?: boolean }
): Promise<void> {
  await ensureSessionInputRecovery()
  let receipt = message.admissionReceipt
  if (!receipt) {
    if (!ref.threadId || !ref.runtimeId) {
      const legacyDisposition = message.sendFailure?.kind === 'legacy-disposition-required' ||
        message.sendFailure?.message === LEGACY_INPUT_DISPOSITION_REQUIRED
      if (message.deliveryAttempt || (message.sendFailure && !legacyDisposition)) {
        throw new Error(INPUT_RECONCILIATION_REQUIRED)
      }
      return // A known-unsent legacy draft without an execution binding can be disposed locally.
    }
    receipt = (await agentRuntimeClient.readQueuedInputs(ref)).find(({ receipt: candidate }) =>
      candidate.clientDirectiveId === message.id)?.receipt
    if (!receipt) return
  }
  const abandon = (candidate: SessionInputReceipt): Promise<void> =>
    agentRuntimeClient.abandonQueuedInput({
      ...ref,
      clientDirectiveId: message.id,
      expectedRevision: candidate.revision,
      ...(message.sendFailure || message.deliveryAttempt || message.force ? { force: true } : {})
    })
  try {
    await abandon(receipt)
  } catch (error) {
    // Delivery reconciliation can advance the durable revision while the
    // renderer is still displaying the queue item. Refresh once and retry
    // only against the latest receipt; never overwrite an active operation.
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    const isRevisionConflict = code === 'input_revision_conflict' ||
      (error instanceof Error && (
        error.message.includes('input_revision_conflict') ||
        error.message.includes('Input changed before abandonment.')
      ))
    if (!isRevisionConflict) throw error
    const latest = (await agentRuntimeClient.readQueuedInputs(ref)).find(({ receipt: candidate }) =>
      candidate.clientDirectiveId === message.id)?.receipt
    if (!latest) return
    if (!message.sendFailure && !message.deliveryAttempt && !message.force &&
      (latest.delivery === 'delivering' || latest.delivery === 'uncertain' ||
      latest.execution === 'active' || latest.execution === 'output_pending')) {
      throw error
    }
    await abandon(latest)
  }
}
