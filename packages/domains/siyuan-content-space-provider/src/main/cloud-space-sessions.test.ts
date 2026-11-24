import { expect, it, vi } from 'vitest'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { createCloudSpaceSessions } from './cloud-space-sessions.js'

function fixture() {
  let userId = 'usr_user_a'
  let authorityState: 'ready' | 'unverified' | 'revoked' = 'ready'
  let clock = Date.parse('2026-11-09T12:00:00Z')
  const grant = { spaceId: 'spc_00000000000000000000000000000001', editorUrl: 'https://one.notes.test/', bootstrapUrl: 'https://one.notes.test/_sciforge/session', bootstrapCode: 'a'.repeat(43), expiresAt: '2026-11-09T12:10:00Z' }
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  const createCloudSpaceSession = vi.fn(async () => grant)
  const listCloudSpaces = vi.fn(async () => {
    authorityState = 'ready'
    return { spaces: [] }
  })
  const transport = { createCloudSpaceSession, listCloudSpaces, status: () => authorityState === 'unverified'
    ? { state: 'unavailable', reasonCode: 'authority_unverified', reason: 'Reconnecting' }
    : authorityState === 'revoked' ? { state: 'device_required', baseUrl: 'https://cloud.test', reason: 'Device revoked' }
      : { state: 'ready', userId, deviceId: 'dev_one', deviceRevision: 1 } } as unknown as AuthenticatedCloudTransport
  const browser = vi.fn(() => ({ fetch: fetch as unknown as typeof globalThis.fetch }))
  const sessions = createCloudSpaceSessions({ transport: () => transport, identity: () => ({ state: 'signed-in', userId, displayName: 'User' }), browser, now: () => clock })
  return { sessions, fetch, browser, createCloudSpaceSession, listCloudSpaces, grant,
    unverify: () => { authorityState = 'unverified' }, revoke: () => { authorityState = 'revoked' },
    switchUser: () => { userId = 'usr_other' }, expire: () => { clock = Date.parse(grant.expiresAt) + 1 } }
}
it('revalidates transient authority before cached reads and preserves a committed response without resending writes', async () => {
  const f = fixture()
  const endpoint = await f.sessions.ensure(f.grant.spaceId)
  f.unverify()
  expect(await f.sessions.ensure(f.grant.spaceId)).toBe(endpoint)
  expect(f.listCloudSpaces).toHaveBeenCalledTimes(1)
  f.fetch.mockImplementationOnce(async () => { f.unverify(); return new Response('{"code":0}', { status: 200 }) })
  const response = await endpoint.fetchImpl(endpoint.baseUrl + '/api/block/updateBlock', { method: 'POST', body: '{}' })
  expect(await response.json()).toEqual({ code: 0 })
  expect(f.fetch).toHaveBeenCalledTimes(2)
  expect(f.listCloudSpaces).toHaveBeenCalledTimes(2)
})
it('fails closed on failed recovery, account replacement during recovery, and revoked devices', async () => {
  const f = fixture()
  const endpoint = await f.sessions.ensure(f.grant.spaceId)
  f.unverify()
  f.listCloudSpaces.mockRejectedValueOnce(new Error('Cloud offline'))
  await expect(endpoint.fetchImpl(endpoint.baseUrl + '/api/block/updateBlock')).rejects.toThrow('Cloud offline')
  expect(f.fetch).toHaveBeenCalledTimes(1)
  f.listCloudSpaces.mockImplementationOnce(async () => { f.switchUser(); return { spaces: [] } })
  await expect(f.sessions.ensure(f.grant.spaceId)).rejects.toMatchObject({ code: 'identity_required' })
  f.revoke()
  await expect(endpoint.fetchImpl(endpoint.baseUrl + '/api/block/updateBlock')).rejects.toMatchObject({ code: 'unauthorized' })
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('bootstraps by POST without URL secrets and shares the exact account/project jar with API calls', async () => {
  const f = fixture()
  const endpoint = await f.sessions.ensure('spc_00000000000000000000000000000001')
  expect(f.fetch).toHaveBeenCalledWith(f.grant.bootstrapUrl, expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: f.grant.bootstrapCode }), credentials: 'include', redirect: 'error' }))
  expect(JSON.stringify(endpoint)).not.toContain(f.grant.bootstrapCode)
  await endpoint.fetchImpl(endpoint.baseUrl + '/api/notebook/lsNotebooks', { method: 'POST' })
  expect(f.fetch).toHaveBeenLastCalledWith(endpoint.baseUrl + '/api/notebook/lsNotebooks', expect.objectContaining({ credentials: 'include', redirect: 'error' }))
  expect(await f.sessions.forUrl(f.grant.editorUrl)).toBe(endpoint)
  expect(new Headers((f.fetch.mock.calls.at(-1) as unknown as [unknown, RequestInit])[1].headers).get('Origin')).toBe('https://one.notes.test')
  expect(f.createCloudSpaceSession).toHaveBeenCalledOnce()
  await expect(endpoint.fetchImpl('https://other.notes.test/api/query/sql')).rejects.toMatchObject({ code: 'invalid_configuration' })
})
it('rejects grants for another project before opening a browser jar', async () => {
  const f = fixture()
  f.createCloudSpaceSession.mockResolvedValue({ ...f.grant, spaceId: 'spc_00000000000000000000000000000002' })
  await expect(f.sessions.ensure('spc_00000000000000000000000000000001')).rejects.toMatchObject({ code: 'provider_contract_violation' })
  expect(f.browser).not.toHaveBeenCalled()
})
it('revokes retained API access after an account change and refuses never-authorized renderer URLs', async () => {
  const f = fixture()
  const endpoint = await f.sessions.ensure('spc_00000000000000000000000000000001')
  f.switchUser()
  await expect(endpoint.fetchImpl(endpoint.baseUrl + '/api/query/sql')).rejects.toMatchObject({ code: 'identity_required' })
  await expect(f.sessions.forUrl(f.grant.editorUrl)).rejects.toMatchObject({ code: 'space_required' })
  expect(f.fetch).toHaveBeenCalledOnce()
})
it('rejects expired sessions and failed bootstrap without retaining a usable endpoint', async () => {
  const f = fixture()
  const endpoint = await f.sessions.ensure('spc_00000000000000000000000000000001')
  f.expire()
  await expect(endpoint.fetchImpl(endpoint.baseUrl + '/api/query/sql')).rejects.toMatchObject({ code: 'unauthorized' })
  await expect(f.sessions.ensure('spc_00000000000000000000000000000001')).rejects.toMatchObject({ code: 'provider_contract_violation' })
  const denied = fixture()
  denied.fetch.mockImplementation(async () => new Response(null, { status: 403 }))
  await expect(denied.sessions.ensure('spc_00000000000000000000000000000001')).rejects.toMatchObject({ code: 'unauthorized' })
  await expect(denied.sessions.forUrl(denied.grant.editorUrl)).rejects.toMatchObject({ code: 'space_required' })
})

it('coalesces simultaneous explicit opens but obtains a new grant for a later explicit refresh', async () => {
  const f = fixture()
  const id = f.grant.spaceId
  await Promise.all(Array.from({ length: 8 }, () => f.sessions.ensure(id, { fresh: true })))
  expect(f.createCloudSpaceSession).toHaveBeenCalledTimes(1)
  expect(f.fetch).toHaveBeenCalledTimes(1)
  await Promise.all(Array.from({ length: 8 }, () => f.sessions.ensure(id, { fresh: true })))
  expect(f.createCloudSpaceSession).toHaveBeenCalledTimes(2)
  expect(f.fetch).toHaveBeenCalledTimes(2)
})

it('keeps viewport updates on cached authority and does not wait for a different space login', async () => {
  const f = fixture()
  const first = 'spc_00000000000000000000000000000002'
  let finish!: (value: typeof f.grant) => void
  f.createCloudSpaceSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const unrelated = f.sessions.ensure(first)
  const endpoint = await f.sessions.ensure(f.grant.spaceId)
  for (let i = 0; i < 10; i++) expect(await f.sessions.forUrl(f.grant.editorUrl)).toBe(endpoint)
  expect(f.createCloudSpaceSession).toHaveBeenCalledTimes(2)
  expect(f.fetch).toHaveBeenCalledTimes(1)
  finish({ ...f.grant, spaceId: first, editorUrl: 'https://two.notes.test/', bootstrapUrl: 'https://two.notes.test/_sciforge/session' })
  await unrelated
})
