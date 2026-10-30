import { createHash } from 'node:crypto'
import {
  OBJECT_STAGE_ROUTE, OBJECT_READ_ROUTE, objectStageHeaderNames, objectReadHeaderNames, objectStagedResponseSchema,
  type ObjectStagedResponse
} from '@sciforge/collaboration-contracts'
import {
  authenticatedObjectReadInputSchema, authenticatedObjectStageInputSchema, AuthenticatedCloudTransportError,
  type AuthenticatedObjectStageInput, type AuthenticatedObjectReadInput, type AuthenticatedObjectReadResult
} from '../authenticated-cloud-transport.js'

/** Private transport implementation; credentials and configured origin stay inside Identity. */
export type ObjectTransportLease = Readonly<{
  fetch(path: string, init: RequestInit): Promise<Response>
  userId: string
  assertCurrent(): void
}>
export type WithObjectTransportLease = <T>(operation: (lease: ObjectTransportLease) => Promise<T>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<T>

export function stageCloudObject(rawInput: AuthenticatedObjectStageInput, withLease: WithObjectTransportLease,
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
    if (response.status !== 200) return rejectResponse(response, lease.assertCurrent)
    const body = await readBoundedBody(response, 1_048_576, lease.assertCurrent)
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

export function readCloudObject(rawInput: AuthenticatedObjectReadInput, withLease: WithObjectTransportLease,
  options?: Readonly<{ signal?: AbortSignal }>): Promise<AuthenticatedObjectReadResult> {
  const input = authenticatedObjectReadInputSchema.parse(rawInput)
  return withLease(async (lease) => {
    const response = await lease.fetch(`${OBJECT_READ_ROUTE}?${new URLSearchParams(input.request)}`, {
      method: 'GET', headers: { accept: 'application/octet-stream' }
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
    const body = await readBoundedBody(response, expected.byteCount, lease.assertCurrent)
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

async function readBoundedBody(response: Response, maximumBytes: number, assertCurrent: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      assertCurrent()
      const chunk = await reader.read()
      assertCurrent()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > maximumBytes) throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud object response exceeded its bounded size.')
      chunks.push(chunk.value)
    }
    return new Uint8Array(Buffer.concat(chunks, total))
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
}

async function rejectResponse(response: Response, assertCurrent: () => void): Promise<never> {
  await readBoundedBody(response, 1_048_576, assertCurrent)
  // A server or transport failure does not prove that a write failed to commit.
  throw new AuthenticatedCloudTransportError(response.status >= 400 && response.status < 500 ? 'cloud_rejected' : 'cloud_unavailable',
    `Cloud object request returned HTTP ${response.status}.`)
}
