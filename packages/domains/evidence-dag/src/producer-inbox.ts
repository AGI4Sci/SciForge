import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { evidenceOperationIdSchema, evidenceProducerIdSchema } from './producer-receipt.js'

/**
 * Where a producer's receipt and Evidence's delivery receipt live in a
 * workspace. Node-only: the file name is a SHA-256 of the operation id.
 */
export const EVIDENCE_INBOX_RELATIVE_ROOT = join('.sciforge', 'evidence-dag', 'inbox')
export const EVIDENCE_DELIVERY_RELATIVE_ROOT = join('.sciforge', 'evidence-dag', 'delivery-receipts')

export function evidenceProducerReceiptFileName(operationId: string): string {
  const safeOperationId = evidenceOperationIdSchema.parse(operationId)
  return `${createHash('sha256').update(safeOperationId).digest('hex')}.json`
}

/** Workspace-relative path of the pending receipt a producer writes. */
export function evidenceProducerInboxRelativePath(producer: string, operationId: string): string {
  return join(
    EVIDENCE_INBOX_RELATIVE_ROOT,
    evidenceProducerIdSchema.parse(producer),
    evidenceProducerReceiptFileName(operationId)
  )
}

/** Workspace-relative path of the delivery receipt Evidence writes back. */
export function evidenceProducerDeliveryRelativePath(producer: string, operationId: string): string {
  return join(
    EVIDENCE_DELIVERY_RELATIVE_ROOT,
    evidenceProducerIdSchema.parse(producer),
    evidenceProducerReceiptFileName(operationId)
  )
}
