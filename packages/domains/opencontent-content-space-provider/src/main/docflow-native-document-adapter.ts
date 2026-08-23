import { z } from 'zod'

import {
  DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
  docflowCommandInvocationSchema,
  docflowNativeDocumentConflictReceiptSchema,
  docflowNativeDocumentFailureReceiptSchema,
  docflowNativeDocumentOutcomeUnknownReceiptSchema,
  docflowNativeDocumentSuccessReceiptSchema,
  docflowTransportErrorSchema,
  docflowTransportResultSchema,
  type DocflowCommand,
  type DocflowCommandInvocation,
  type DocflowCommandTransport,
  type DocflowNativeDocumentReceipt
} from '@sciforge/domain-opencontent-connector/main-contract'

export type DocflowNativeDocumentAdapter = Readonly<{
  execute(input: unknown): Promise<DocflowNativeDocumentReceipt>
}>

export function createDocflowNativeDocumentAdapter(
  transport: DocflowCommandTransport
): DocflowNativeDocumentAdapter {
  return Object.freeze({
    async execute(input: unknown): Promise<DocflowNativeDocumentReceipt> {
      const invocation = docflowCommandInvocationSchema.parse(input)
      let rawResponse: unknown
      try {
        rawResponse = await transport.invoke(invocation)
      } catch (error) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'write',
              boundedMessage(error, 'The command transport failed after dispatch began.')
            )
          : failureReceipt(
              invocation,
              'provider_unavailable',
              boundedMessage(error, 'The command transport is unavailable.')
            )
      }
      const parsedResponse = docflowTransportResultSchema.safeParse(rawResponse)
      if (!parsedResponse.success) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'verify',
              'The command returned an invalid result after a possible write.'
            )
          : failureReceipt(
              invocation,
              'contract_violation',
              'The command returned an invalid structured result.'
            )
      }
      const response = parsedResponse.data
      if (response.command !== invocation.command) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'verify',
              'The command result could not be bound to the requested write.'
            )
          : failureReceipt(
              invocation,
              'contract_violation',
              'The command result does not match the requested command.'
            )
      }
      if (!response.ok) {
        return mapTransportFailure(invocation, response.error)
      }
      if (requiresStructuredDelivery(invocation.command) &&
        response.structuredDeliveryItems.length !== 1) {
        return outcomeUnknownReceipt(
          invocation,
          'verify',
          'The write result lacks its required structured delivery receipt.'
        )
      }
      return Object.freeze(docflowNativeDocumentSuccessReceiptSchema.parse({
        protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
        invocationId: invocation.invocationId,
        command: invocation.command,
        attemptCount: 1,
        outcome: 'succeeded',
        json: response.json,
        structuredDeliveryItems: response.structuredDeliveryItems,
        managedDataFiles: response.managedDataFiles
      }))
    }
  })
}

const HASH_CONFLICT_CODES = new Set([
  'DOCFLOW_DOCUMENT_HASH_MISMATCH',
  'DOCFLOW_EDIT_PLAN_PRECONDITION_FAILED',
  'DOCFLOW_REVISION_CONFLICT'
])

const WRITE_COMMANDS = new Set<DocflowCommand>([
  'docflow-create',
  'docflow-image-upload',
  'docflow-image-download',
  'docflow-export'
])

const DELIVERY_COMMANDS = new Set<DocflowCommand>([
  'docflow-create'
])

function isWriteCommand(command: DocflowCommand): boolean {
  return WRITE_COMMANDS.has(command)
}

function requiresStructuredDelivery(command: DocflowCommand): boolean {
  return DELIVERY_COMMANDS.has(command)
}

function mapTransportFailure(
  invocation: DocflowCommandInvocation,
  error: z.infer<typeof docflowTransportErrorSchema>
): DocflowNativeDocumentReceipt {
  if (HASH_CONFLICT_CODES.has(error.code)) {
    return Object.freeze(docflowNativeDocumentConflictReceiptSchema.parse({
      protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
      invocationId: invocation.invocationId,
      command: invocation.command,
      attemptCount: 1,
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: error.code === 'DOCFLOW_REVISION_CONFLICT'
          ? 'revision_conflict'
          : 'hash_mismatch',
        message: error.message,
        retry: 'never',
        expectedHash: error.expectedHash ?? invocationBaseHash(invocation),
        actualHash: error.actualHash
      }
    }))
  }
  if (error.code === 'DOCFLOW_POSTCOMMIT_VERIFY_FAILED') {
    return outcomeUnknownReceipt(invocation, 'verify', error.message)
  }
  if (error.dispatched && isWriteCommand(invocation.command) &&
    !['validation', 'read'].includes(error.stage)) {
    const stage = error.stage === 'publish'
      ? 'publish'
      : error.stage === 'verify'
        ? 'verify'
        : 'write'
    return outcomeUnknownReceipt(invocation, stage, error.message)
  }
  return failureReceipt(invocation, normalizeFailureCode(error.code), error.message)
}

function outcomeUnknownReceipt(
  invocation: DocflowCommandInvocation,
  stage: 'write' | 'publish' | 'verify',
  message: string
): DocflowNativeDocumentReceipt {
  return Object.freeze(docflowNativeDocumentOutcomeUnknownReceiptSchema.parse({
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'outcome_unknown',
    error: { code: 'outcome_unknown', stage, message, retry: 'never' }
  }))
}

function failureReceipt(
  invocation: DocflowCommandInvocation,
  code: z.infer<typeof docflowNativeDocumentFailureReceiptSchema>['error']['code'],
  message: string
): DocflowNativeDocumentReceipt {
  return Object.freeze(docflowNativeDocumentFailureReceiptSchema.parse({
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'failed',
    error: { code, message, retry: 'never' }
  }))
}

function invocationBaseHash(invocation: DocflowCommandInvocation): string | undefined {
  return 'baseHash' in invocation.args && typeof invocation.args.baseHash === 'string'
    ? invocation.args.baseHash
    : undefined
}

function normalizeFailureCode(
  code: string
): z.infer<typeof docflowNativeDocumentFailureReceiptSchema>['error']['code'] {
  if (/AUTH|PERMISSION|NOT_PERMISSION|FORBIDDEN/iu.test(code)) return 'unauthorized'
  if (/NOT_FOUND|TARGET_UNRESOLVED/iu.test(code)) return 'not_found'
  if (/UNSUPPORTED/iu.test(code)) return 'unsupported'
  if (/INVALID|PARAM/iu.test(code)) return 'invalid_input'
  if (/CANCEL/iu.test(code)) return 'cancelled'
  return 'provider_unavailable'
}

function boundedMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback
  return message.slice(0, 512)
}
