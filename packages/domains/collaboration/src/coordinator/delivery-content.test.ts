import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DELIVERY_MAX_FILE_BYTES, type ObjectReference } from '@sciforge/collaboration-contracts'
import { createDeliveryContentCapabilities } from './delivery-content.js'
import { DELIVERY_CONTENT_ACTIONS, DELIVERY_OBJECT_RESOURCE_KIND } from './delivery-content-contract.js'
import type { ProjectCoordinatorCapabilityInvocationContext as Context } from './main.js'

type Registration = Parameters<NonNullable<Context['issueResource']>>[0]
function fixture() {
  const body = Buffer.from('immutable sealed delivery bytes')
  const object: ObjectReference = { objectId: 'obj_DeliveryRange001', objectKey: 'objects/prj_DeliveryRange001/obj_DeliveryRange001',
    projectId: 'prj_DeliveryRange001', ownerUserId: 'usr_DeliveryRange001', revision: 1,
    sha256: 'a'.repeat(64), byteCount: body.length, mediaType: 'text/plain', visibility: 'project_public', retentionUntil: null }
  let reads = 0, authorizations = 0, revoked = false, principalCurrent = true
  let current = object
  let registration: Registration | undefined
  const definitions = createDeliveryContentCapabilities({ defineCapability: definition => definition,
    read: async () => { reads++; return { object, body } },
    authorize: async () => { authorizations++; if (revoked) throw new Error('Membership revoked'); return current } })
  const assertion = () => { if (!principalCurrent) throw new Error('Principal changed') }
  const context = { assertPrincipalCurrent: assertion, issueResource: (value: Registration) => {
    registration = value; return { resourceId: value.resourceId, resourceKind: value.resourceKind }
  } } as unknown as Context
  const input = { deliveryManifestId: 'mft_DeliveryRange001', objectId: object.objectId }
  const handler = (id: string) => definitions.find(definition => definition.id === id)!.handler
  const resourceContext = () => ({ ...context, resource: { resourceId: registration!.resourceId,
    resourceKind: DELIVERY_OBJECT_RESOURCE_KIND, semanticRevision: registration!.semanticRevision } })
  return { body, object, input, handler, context, resourceContext, registration: () => registration!,
    counts: () => ({ reads, authorizations }), revoke: () => { revoked = true },
    changePrincipal: () => { principalCurrent = false }, changeObject: (value: ObjectReference) => { current = value } }
}

test('resource open downloads once; observe, describe and 65 ranges each reauthorize without body transfers', async () => {
  const f = fixture()
  await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context)
  await f.registration().observe()
  await f.handler(DELIVERY_CONTENT_ACTIONS.describe)({}, f.resourceContext())
  for (let index = 0; index < 65; index++) {
    const response = await f.handler(DELIVERY_CONTENT_ACTIONS.readRange)({ range: { offset: 0, length: 10 } }, f.resourceContext())
    assert.deepEqual(Buffer.from((response.output as { dataBase64: string }).dataBase64, 'base64'), f.body.subarray(0, 10))
  }
  assert.deepEqual(f.counts(), { reads: 1, authorizations: 68 })
})

test('cached bytes do not cache membership permission, principal validity or changed immutable identity', async () => {
  for (const alteration of ['membership', 'principal', 'identity'] as const) {
    const f = fixture()
    await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context)
    if (alteration === 'membership') f.revoke()
    if (alteration === 'principal') f.changePrincipal()
    if (alteration === 'identity') f.changeObject({ ...f.object, byteCount: f.object.byteCount + 1 })
    await assert.rejects(f.registration().observe())
    await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.describe)({}, f.resourceContext()))
    await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.readRange)({ range: { offset: 0, length: 10 } }, f.resourceContext()))
    assert.equal(f.counts().reads, 1)
  }
})

test('resource disposal retires retained bytes and all subsequent observations or ranges', async () => {
  const f = fixture()
  await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context)
  f.registration().dispose(); f.registration().dispose()
  await assert.rejects(f.registration().observe(), /no longer available/)
  await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.readRange)({ range: { offset: 0, length: 10 } }, f.resourceContext()), /no longer available/)
  await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context)
  assert.equal(f.counts().reads, 2)
})

test('aggregate preview buffer reserves capacity before downloading and releases failed reservations', async () => {
  const f = fixture()
  f.changeObject({ ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES + 1 })
  await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context), /capacity/)
  assert.equal(f.counts().reads, 0)
  f.changeObject({ ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES })
  await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context), /identity changed/)
  f.changeObject(f.object)
  await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, f.context)
  assert.equal(f.counts().reads, 2)
})

test('concurrent open reservations cannot exceed the aggregate budget before body reads settle', async () => {
  const f = fixture()
  let reads = 0, rejectRead: ((error: Error) => void) | undefined
  const object = { ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES }
  const definitions = createDeliveryContentCapabilities({ defineCapability: definition => definition,
    authorize: async () => object,
    read: () => { reads++; return new Promise((_resolve, reject) => { rejectRead = reject }) } })
  const open = definitions.find(definition => definition.id === DELIVERY_CONTENT_ACTIONS.open)!.handler
  const first = assert.rejects(open(f.input, f.context), /Interrupted/)
  await new Promise<void>(resolve => setImmediate(resolve))
  await assert.rejects(open(f.input, f.context), /capacity/)
  assert.equal(reads, 1)
  rejectRead!(new Error('Interrupted')); await first
  const next = assert.rejects(open(f.input, f.context), /Interrupted/)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(reads, 2)
  rejectRead!(new Error('Interrupted')); await next
})

test('pending open freezes authorized identity and returns exactly its reserved capacity after shared metadata mutation', async () => {
  const f = fixture()
  const shared = { ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES }
  let reads = 0
  let resolveRead: ((value: { object: ObjectReference; body: Uint8Array }) => void) | undefined
  const definitions = createDeliveryContentCapabilities({ defineCapability: definition => definition,
    authorize: async () => shared,
    read: () => {
      reads++
      return new Promise(resolve => { resolveRead = resolve })
    } })
  const open = definitions.find(definition => definition.id === DELIVERY_CONTENT_ACTIONS.open)!.handler
  const first = assert.rejects(open(f.input, f.context), /identity changed/)
  await new Promise<void>(resolve => setImmediate(resolve))
  shared.byteCount = f.body.byteLength
  resolveRead!({ object: shared, body: f.body })
  await first
  // A full-capacity reservation succeeds only if the failed first open returned
  // its original reservation, not the subsequently mutated shared byteCount.
  shared.byteCount = DELIVERY_MAX_FILE_BYTES
  const second = assert.rejects(open(f.input, f.context), /identity changed/)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(reads, 2)
  shared.byteCount = f.body.byteLength
  resolveRead!({ object: shared, body: f.body })
  await second
})

const turn = () => new Promise<void>(resolve => setImmediate(resolve))

test('new Principal retires old retained bytes before capacity admission; Broker double disposal is harmless', async () => {
  const f = fixture()
  let principal = 'A', full = false, reads = 0
  const definitions = createDeliveryContentCapabilities({ defineCapability: value => value,
    authorize: async () => full ? { ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES } : f.object,
    read: async () => { reads++; if (full) throw new Error('Full reservation admitted'); return { object: f.object, body: f.body } } })
  const open = definitions.find(value => value.id === DELIVERY_CONTENT_ACTIONS.open)!.handler
  const a = { ...f.context, assertPrincipalCurrent: () => { if (principal !== 'A') throw new Error('Principal changed') } }
  await open(f.input, a)
  const old = f.registration()
  principal = 'B'; full = true
  await assert.rejects(open(f.input, f.context), /Full reservation admitted/)
  old.dispose(); old.dispose()
  await assert.rejects(old.observe(), /no longer available/)
  await assert.rejects(open(f.input, f.context), /Full reservation admitted/)
  assert.equal(reads, 3)
})

test('Principal loss during awaited authorization retires once; temporary network failure preserves cached bytes', async () => {
  for (const principalLoss of [false, true]) {
    const f = fixture()
    let current = true, fail = false
    let rejectAuthorization: ((error: Error) => void) | undefined
    const definitions = createDeliveryContentCapabilities({ defineCapability: value => value,
      read: async () => ({ object: f.object, body: f.body }),
      authorize: () => fail ? new Promise((_resolve, reject) => { rejectAuthorization = reject }) : Promise.resolve(f.object) })
    const open = definitions.find(value => value.id === DELIVERY_CONTENT_ACTIONS.open)!.handler
    const context = { ...f.context, assertPrincipalCurrent: () => { if (!current) throw new Error('Principal changed') } }
    await open(f.input, context)
    fail = true
    const observation = assert.rejects(f.registration().observe(), principalLoss ? /Principal changed/ : /Network failed/)
    await turn(); current = !principalLoss; rejectAuthorization!(new Error('Network failed')); await observation
    fail = false
    if (principalLoss) {
      await assert.rejects(f.registration().observe(), /no longer available/)
      f.registration().dispose(); f.registration().dispose()
    } else {
      await f.registration().observe()
    }
  }
})

test('cancel before dispatch performs neither authorization nor byte transfer', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort(new Error('Cancelled before'))
  await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, { ...f.context, signal: controller.signal }), /Cancelled before/)
  assert.deepEqual(f.counts(), { reads: 0, authorizations: 0 })
})

for (const cause of ['cancel', 'deadline', 'principal'] as const) {
  test(`${cause} aborts pending transport, blocks overlapping admission until late settlement, and restores budget`, async (t) => {
    if (cause === 'deadline') t.mock.timers.enable({ apis: ['setTimeout'] })
    const f = fixture(), controller = new AbortController()
    let principalCurrent = true, reads = 0, signal: AbortSignal | undefined
    let resolveRead: ((value: { object: ObjectReference; body: Uint8Array }) => void) | undefined
    const full = { ...f.object, byteCount: DELIVERY_MAX_FILE_BYTES }
    const definitions = createDeliveryContentCapabilities({ defineCapability: value => value,
      authorize: async () => full,
      read: (_input, options) => { reads++; signal = options.signal; return new Promise(resolve => { resolveRead = resolve }) } })
    const open = definitions.find(value => value.id === DELIVERY_CONTENT_ACTIONS.open)!.handler
    const a = { ...f.context, signal: controller.signal,
      assertPrincipalCurrent: () => { if (!principalCurrent) throw new Error('Principal changed') } }
    const first = assert.rejects(open(f.input, a), cause === 'cancel' ? /Cancelled during/ : cause === 'deadline' ? /timed out/ : /Principal changed/)
    await turn()
    if (cause === 'cancel') controller.abort(new Error('Cancelled during'))
    if (cause === 'deadline') t.mock.timers.tick(240_000)
    if (cause === 'principal') principalCurrent = false
    await assert.rejects(open(f.input, f.context), /capacity/)
    assert.equal(signal!.aborted, true)
    assert.equal(reads, 1, 'an ignored abort must not permit overlapping full-capacity reads')
    // Misbehaving/late success still cannot publish a cancelled resource.
    resolveRead!({ object: f.object, body: f.body }); await first
    assert.equal(f.registration(), undefined)
    const second = assert.rejects(open(f.input, f.context), /identity changed/)
    await turn(); assert.equal(reads, 2)
    resolveRead!({ object: f.object, body: f.body }); await second
  })
}

test('cancellation during resource issuance retires bytes, but cancellation after completed open does not revoke its resource', async () => {
  const f = fixture(), controller = new AbortController()
  const context = { ...f.context, signal: controller.signal, issueResource: (registration: Registration) => {
    const handle = f.context.issueResource!(registration)
    controller.abort(new Error('Cancelled after read'))
    return handle
  } }
  await assert.rejects(f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, context), /Cancelled after read/)
  await assert.rejects(f.registration().observe(), /no longer available/)
  const next = new AbortController()
  await f.handler(DELIVERY_CONTENT_ACTIONS.open)(f.input, { ...f.context, signal: next.signal })
  next.abort()
  await f.registration().observe()
})
