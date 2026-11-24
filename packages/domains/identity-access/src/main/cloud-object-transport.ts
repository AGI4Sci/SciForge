import { createHash } from 'node:crypto'
import {
  OBJECT_STAGE_ROUTE, OBJECT_READ_ROUTE, objectStageHeaderNames, objectReadHeaderNames, objectStagedResponseSchema, restResponseSchema,
  type ObjectStagedResponse
} from '@sciforge/collaboration-contracts'
import {
  authenticatedObjectReadInputSchema, authenticatedObjectStageInputSchema, AuthenticatedCloudTransportError,
  type AuthenticatedObjectStageInput, type AuthenticatedObjectReadInput, type AuthenticatedObjectReadResult
} from '../authenticated-cloud-transport.js'

import { readBoundedCloudBody, type WithCloudTransportLease } from './cloud-authority.js'

export function stageCloudObject(rawInput: AuthenticatedObjectStageInput, withLease: WithCloudTransportLease,
  options?: Readonly<{ signal?: AbortSignal }>): Promise<ObjectStagedResponse> {
  const input = authenticatedObjectStageInputSchema.parse(rawInput)
  const bytes = new Uint8Array(input.body)
  if (sha256(bytes) !== input.request.sha256) {
    throw new AuthenticatedCloudTransportError('operation_not_allowed', 'Object bytes do not match the confirmed SHA-256 digest.')
  }
  return withLease(async (lease) => {
    const request = input.request
    const response = await lease.fetch(OBJECT_STAGE_ROUTE, {
      method: 'POST', headers: {
        accept: 'application/json',
        [objectStageHeaderNames.requestId]: request.requestId,
        [objectStageHeaderNames.idempotencyKey]: request.idempotencyKey,
        [objectStageHeaderNames.projectId]: request.projectId,
        [objectStageHeaderNames.taskId]: request.taskId,
        [objectStageHeaderNames.executionId]: request.executionId,
        [objectStageHeaderNames.mediaType]: request.mediaType,
        [objectStageHeaderNames.byteCount]: String(request.byteCount),
        [objectStageHeaderNames.sha256]: request.sha256
      }, body: bytes
    })
    lease.assertCurrent()
    if (response.status === 413) {
      await response.body?.cancel()
      lease.assertCurrent()
      throw new AuthenticatedCloudTransportError('object_upload_limit', 'Cloud object request returned HTTP 413.')
    }
    if (response.status !== 200) return rejectResponse(response, lease.assertCurrent)
    const body = await readBoundedCloudBody(response, 1_048_576, lease.assertCurrent)
    let result: ObjectStagedResponse
    try { result = objectStagedResponseSchema.parse(JSON.parse(new TextDecoder().decode(body))) } catch {
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud returned invalid object staging metadata.')
    }
    if (result.requestId !== request.requestId || result.object.projectId !== request.projectId ||
      result.object.sha256 !== request.sha256 || result.object.byteCount !== request.byteCount ||
      result.object.mediaType !== request.mediaType || result.object.visibility !== 'staged' ||
      result.object.ownerUserId !== lease.userId) {
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud staging response does not match the exact requested object.')
    }
    return result
  }, options)
}

export function readCloudObject(rawInput: AuthenticatedObjectReadInput, withLease: WithCloudTransportLease,
  options?: Readonly<{ signal?: AbortSignal }>): Promise<AuthenticatedObjectReadResult> {
  const input = authenticatedObjectReadInputSchema.parse(rawInput)
  return withLease(async (lease) => {
    const response = await lease.fetch(`${OBJECT_READ_ROUTE}?${new URLSearchParams(input.request)}`, {
      method: 'GET', headers: { accept: 'application/octet-stream' }, signal: options?.signal
    })
    lease.assertCurrent()
    if (response.status !== 200) return rejectResponse(response, lease.assertCurrent)
    const expected = input.expected
    if (response.headers.get(objectReadHeaderNames.objectId) !== expected.objectId ||
      response.headers.get(objectReadHeaderNames.revision) !== String(expected.revision) ||
      response.headers.get(objectReadHeaderNames.sha256) !== expected.sha256 ||
      response.headers.get(objectReadHeaderNames.byteCount) !== String(expected.byteCount) ||
      response.headers.get(objectReadHeaderNames.mediaType) !== expected.mediaType) {
      await response.body?.cancel()
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud returned different metadata for the pinned object.')
    }
    const body = await readBoundedCloudBody(response, expected.byteCount, lease.assertCurrent)
    if (body.byteLength !== expected.byteCount || sha256(body) !== expected.sha256) {
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud object bytes do not match the pinned size and SHA-256 digest.')
    }
    const versionId = response.headers.get(objectReadHeaderNames.versionId)
    if (versionId !== null && (!versionId.trim() || versionId.length > 2_048)) {
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud returned an invalid object version identifier.')
    }
    return { body, object: expected, versionId }
  }, options)
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function rejectResponse(response: Response, assertCurrent: () => void): Promise<never> {
  const bytes = await readBoundedCloudBody(response, 1_048_576, assertCurrent)
  let message = `Cloud object request returned HTTP ${response.status}.`
  try {
    const parsed = restResponseSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (parsed.success && parsed.data.type === 'rest.error' && parsed.data.error.httpStatus === response.status) {
      // Never forward server messages or arbitrary details: even a valid error
      // envelope may contain credentials in free text. Map closed codes/reasons
      // to locally owned explanations instead.
      const error = parsed.data.error
      const explanations: Partial<Record<typeof error.code, string>> = {
        authentication_required: 'Cloud authentication is required for this object operation.',
        credential_revoked: 'Cloud credentials were revoked; reconnect before continuing.',
        permission_denied: 'The current Worker or Project authorization does not permit this object operation.',
        revision_conflict: 'The object or Task version changed; reread the current facts before retrying.',
        idempotency_conflict: 'The original operation identity was reused with different object facts.',
        invalid_state_transition: 'The current Task execution state does not permit this object operation.',
        provider_unavailable: 'Cloud object storage is unavailable or busy; reconcile the original operation before retrying.',
        validation_error: 'Cloud rejected the object request because its declared facts do not match the required contract.'
      }
      message = explanations[error.code] ?? message
      const details = error.details
      const reason = details && typeof details === 'object' && !Array.isArray(details) ? details.reason : undefined
      if (reason === 'digest_mismatch') message = 'Cloud object SHA-256 verification failed; the original operation must be reconciled.'
      if (reason === 'size_mismatch') message = 'Cloud object byte-count verification failed; the original operation must be reconciled.'
      if (reason === 'storage_unavailable') message = 'Cloud could not verify the object storage outcome or exact storage version; reconcile the original operation before retrying.'
    }
  } catch { /* Untrusted or proxy error bodies keep the generic explanation. */ }
  // A server or transport failure does not prove that a write failed to commit.
  throw new AuthenticatedCloudTransportError(response.status >= 400 && response.status < 500 ? 'cloud_rejected' : 'cloud_unavailable', message)
}
