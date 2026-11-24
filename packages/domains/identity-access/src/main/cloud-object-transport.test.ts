import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createCollaborationError } from '@sciforge/collaboration-contracts'
import { describe, expect, it, vi } from 'vitest'
import { stageCloudObject, readCloudObject } from './cloud-object-transport.js'
import type { WithCloudTransportLease } from './cloud-authority.js'

const body = new TextEncoder().encode('frozen result')
const hash = createHash('sha256').update(body).digest('hex')
const object = {
  objectId: 'obj_Object000001', objectKey: 'project/immutable/object', revision: 1,
  sha256: hash, byteCount: body.length, mediaType: 'text/plain', projectId: 'prj_Project000001',
  visibility: 'staged' as const, ownerUserId: 'usr_User00000001', retentionUntil: null
}
const stage = { request: {
  protocolVersion: '1.0' as const, type: 'object.stage' as const, requestId: 'req_Request00001',
  idempotencyKey: 'idem_stage-result-one', projectId: object.projectId, taskId: 'tsk_Task00000001',
  executionId: 'exe_Execution001', sha256: hash, byteCount: body.length, mediaType: object.mediaType
}, body }
const query = { projectId: object.projectId, objectId: object.objectId, deliveryManifestId: 'mft_Manifest000001' }
function leaseWith(response: Response) {
  const fetch = vi.fn(async () => response)
  const assertCurrent = vi.fn()
  const withLease: WithCloudTransportLease = async (run) => run({ fetch, assertCurrent, userId: object.ownerUserId })
  return { withLease, fetch, assertCurrent }
}
function objectResponse(overrides: Record<string, string> = {}, bytes: Uint8Array = body) {
  return new Response(new Uint8Array(bytes), { headers: {
    'x-sciforge-object-id': object.objectId, 'x-sciforge-object-revision': String(object.revision),
    'x-sciforge-sha256': hash, 'content-length': String(body.length), 'content-type': object.mediaType,
    'x-sciforge-version-id': 'immutable-version-1', ...overrides
  } })
}

describe('Identity object byte transport', () => {
  it('stages exact bytes with canonical headers and preserves replay identity', async () => {
    const expected = { protocolVersion: '1.0', type: 'rest.object.staged', requestId: stage.request.requestId, object }
    const h = leaseWith(Response.json(expected))
    await expect(stageCloudObject(stage, h.withLease)).resolves.toEqual(expected)
    expect(h.fetch).toHaveBeenCalledWith('/v1/objects/stage', expect.objectContaining({
      method: 'POST', body, headers: expect.objectContaining({ 'idempotency-key': stage.request.idempotencyKey,
        'x-sciforge-sha256': hash, 'content-length': String(body.length) })
    }))
    expect(h.assertCurrent).toHaveBeenCalled()
  })

  it('rejects changed bytes, size, and arbitrary route/header input before transport', async () => {
    const h = leaseWith(new Response())
    expect(() => stageCloudObject({ ...stage, body: new Uint8Array(body.length) }, h.withLease)).toThrow()
    expect(() => stageCloudObject({ ...stage, body: new Uint8Array(1) }, h.withLease)).toThrow()
    expect(() => stageCloudObject({ ...stage, url: 'https://other.invalid' } as never, h.withLease)).toThrow()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('snapshots bytes before asynchronous authority revalidation', async () => {
    const bytes = new Uint8Array(body)
    const fetch = vi.fn(async (_path, init: RequestInit) => {
      expect(init.body).toEqual(body)
      return Response.json({ protocolVersion: '1.0', type: 'rest.object.staged', requestId: stage.request.requestId, object })
    })
    const withLease: WithCloudTransportLease = async (run) => {
      bytes.fill(0)
      await Promise.resolve()
      return run({ fetch, assertCurrent: () => undefined, userId: object.ownerUserId })
    }
    await stageCloudObject({ ...stage, body: bytes }, withLease)
  })

  it.each(['requestId', 'projectId', 'ownerUserId', 'sha256', 'visibility'] as const)('rejects an unrelated staged %s', async (field) => {
    const invalid = { protocolVersion: '1.0', type: 'rest.object.staged', requestId: stage.request.requestId, object: { ...object } }
    if (field === 'requestId') invalid.requestId = 'req_OtherRequest1'
    else Object.assign(invalid.object, { [field]: field === 'visibility' ? 'project_public' : field === 'sha256' ? 'f'.repeat(64) : `${object[field]}other` })
    await expect(stageCloudObject(stage, leaseWith(Response.json(invalid)).withLease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
  })

  it('reads the exact expected manifest object with its true storage version', async () => {
    const h = leaseWith(objectResponse())
    await expect(readCloudObject({ request: query, expected: object }, h.withLease)).resolves.toEqual({ body, object, versionId: 'immutable-version-1' })
    expect(h.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/objects/read?projectId='), expect.objectContaining({ method: 'GET' }))
  })

  it.each(['x-sciforge-object-id', 'x-sciforge-object-revision', 'x-sciforge-sha256', 'content-length', 'content-type'])('rejects mismatched %s', async (header) => {
    await expect(readCloudObject({ request: query, expected: object }, leaseWith(objectResponse({ [header]: 'wrong' })).withLease))
      .rejects.toMatchObject({ code: 'cloud_response_invalid' })
  })

  it('checks the actual downloaded hash, not just response headers', async () => {
    await expect(readCloudObject({ request: query, expected: object }, leaseWith(objectResponse({}, new Uint8Array(body.length))).withLease))
      .rejects.toMatchObject({ code: 'cloud_response_invalid' })
  })

  it('cancels a response stream after its bound is exceeded', async () => {
    const cancel = vi.fn()
    const response = objectResponse()
    const overflowing = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(body.length + 1)) }, cancel }), { headers: response.headers })
    await expect(readCloudObject({ request: query, expected: object }, leaseWith(overflowing).withLease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('maps validated server classifications without exposing arbitrary messages or details', async () => {
    const error = createCollaborationError('internal_error', 'DO_NOT_EXPOSE_SERVER_SECRET', { details: { reason: 'size_mismatch' } })
    const h = leaseWith(Response.json({ protocolVersion: '1.0', type: 'rest.error', requestId: stage.request.requestId, error }, { status: 500 }))
    await expect(stageCloudObject(stage, h.withLease)).rejects.toMatchObject({ code: 'cloud_unavailable',
      message: 'Cloud object byte-count verification failed; the original operation must be reconciled.' })
    const rejected = createCollaborationError('permission_denied', 'DO_NOT_EXPOSE_SERVER_SECRET')
    await expect(stageCloudObject(stage, leaseWith(Response.json({ protocolVersion: '1.0', type: 'rest.error', requestId: stage.request.requestId, error: rejected }, { status: 403 })).withLease))
      .rejects.toMatchObject({ code: 'cloud_rejected', message: 'The current Worker or Project authorization does not permit this object operation.' })
  })

  it('does not expose malformed or status-mismatched error response content', async () => {
    const error = createCollaborationError('internal_error', 'DO_NOT_EXPOSE_SERVER_SECRET', { details: { reason: 'size_mismatch' } })
    for (const body of [{ arbitrary: 'DO_NOT_EXPOSE_SERVER_SECRET' }, { protocolVersion: '1.0', type: 'rest.error', requestId: stage.request.requestId, error }]) {
      await expect(stageCloudObject(stage, leaseWith(Response.json(body, { status: 403 })).withLease))
        .rejects.toMatchObject({ code: 'cloud_rejected', message: 'Cloud object request returned HTTP 403.' })
    }
  })

  it.each([[403, 'cloud_rejected'], [503, 'cloud_unavailable']] as const)('preserves HTTP %i as %s without retrying', async (status, code) => {
    const h = leaseWith(new Response('{}', { status }))
    await expect(stageCloudObject(stage, h.withLease)).rejects.toMatchObject({ code })
    expect(h.fetch).toHaveBeenCalledOnce()
  })
})


it('read cancellation reaches actual HTTP fetch before headers and during body streaming', async () => {
  for (const streamBody of [false, true]) {
    let requestArrived!: () => void, requestClosed!: () => void
    const arrived = new Promise<void>(resolve => { requestArrived = resolve })
    const closed = new Promise<void>(resolve => { requestClosed = resolve })
    const server = createServer((req, res) => {
      req.on('close', requestClosed)
      if (streamBody) {
        res.writeHead(200, Object.fromEntries(objectResponse().headers))
        res.write(body.subarray(0, 1))
      }
      requestArrived()
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local fixture address')
    const controller = new AbortController()
    const withLease: WithCloudTransportLease = async (run, options) => {
      expect(options?.signal).toBe(controller.signal)
      return run({ fetch: (path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init),
        assertCurrent: () => options?.signal?.throwIfAborted(), userId: object.ownerUserId })
    }
    try {
      const read = expect(readCloudObject({ request: query, expected: object }, withLease, { signal: controller.signal })).rejects.toThrow()
      await arrived
      controller.abort(new Error('Cancelled actual object read'))
      await read; await closed
      expect(controller.signal.aborted).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
})

it('uses a typed 413 rejection with non-JSON proxy body and replays the same bytes after correction over local HTTP', async () => {
  let rejectUpload = true
  const received: Buffer[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push(Buffer.concat(chunks))
    res.writeHead(rejectUpload ? 413 : 200, { 'content-type': rejectUpload ? 'text/html' : 'application/json' })
    res.end(rejectUpload ? '<html>Request Entity Too Large</html>' : JSON.stringify({
      protocolVersion: '1.0', type: 'rest.object.staged', requestId: stage.request.requestId, object
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local fixture address')
  const withLease: WithCloudTransportLease = async run => run({
    fetch: (path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init),
    assertCurrent: () => undefined, userId: object.ownerUserId
  })
  try {
    await expect(stageCloudObject(stage, withLease)).rejects.toMatchObject({ code: 'object_upload_limit' })
    rejectUpload = false
    await expect(stageCloudObject(stage, withLease)).resolves.toMatchObject({ object })
    expect(received).toEqual([Buffer.from(body), Buffer.from(body)])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
