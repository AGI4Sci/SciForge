import { expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { siyuanCloudBrowserSession } from './native-view.js'
import { createDomainMainEntry } from './index.js'
vi.mock('./native-view.js', () => ({ createSiYuanNativeView: vi.fn(), siyuanCloudBrowserSession: vi.fn() }))
it('opens and reads managed notes through the same authorized project session and never exposes the bootstrap code', async () => {
  const userId = 'usr_user_a'
  const grant = { spaceId: 'spc_00000000000000000000000000000001', editorUrl: 'https://one.notes.test/', bootstrapUrl: 'https://one.notes.test/_sciforge/session', bootstrapCode: 'x'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }
  const fetch = vi.fn(async (url: unknown) => String(url).endsWith('/_sciforge/session') ? new Response(null, { status: 204 }) : Response.json({ code: 0, data: [] }))
  vi.mocked(siyuanCloudBrowserSession).mockReturnValue({ fetch: fetch as typeof globalThis.fetch })
  const transport = { status: () => ({ state: 'ready', userId, deviceId: 'dev_one', deviceRevision: 1 }), createCloudSpaceSession: vi.fn(async () => grant) }
  const entry = createDomainMainEntry({
    defineCapability: (value: unknown) => value,
    packageSettings: { read: async () => ({ revision: 1, value: { mode: 'managed', url: 'https://legacy-shared.test' } }) },
    internalServices: { acquire: (id: string) => id === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID ? transport : { read: () => ({ state: 'signed-in', userId, displayName: 'User' }) } }
  } as unknown as DomainMainHost)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as { createDefinitions(): Array<{ id: string; handler(input: unknown): Promise<unknown> }> }
  const definitions = factory.createDefinitions()
  const open = definitions.find(item => item.id === 'siyuan.editor.open')!.handler
  await expect(open({})).rejects.toMatchObject({ code: 'space_required' })
  expect(fetch).not.toHaveBeenCalled()
  const result = await open({ spaceId: 'spc_00000000000000000000000000000001' })
  expect(result).toEqual({ output: { url: grant.editorUrl, spaceId: grant.spaceId, expiresAt: grant.expiresAt } })
  expect(JSON.stringify(result)).not.toContain(grant.bootstrapCode)
  await expect(definitions.find(item => item.id === 'siyuan.document.search')!.handler({ spaceId: 'spc_00000000000000000000000000000001', query: 'notes' })).resolves.toEqual({ output: { documents: [] } })
  expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://one.notes.test/'))).toBe(true)
})


it('ordinary editor opens reuse authorization and explicit refresh obtains a fresh grant', async () => {
  const userId = 'usr_user_a'
  const grant = { spaceId: 'spc_00000000000000000000000000000001', editorUrl: 'https://one.notes.test/', bootstrapUrl: 'https://one.notes.test/_sciforge/session', bootstrapCode: 'a'.repeat(43), expiresAt: new Date(Date.now() + 600_000).toISOString() }
  const fetch = vi.fn(async (url: unknown) => String(url).endsWith('/_sciforge/session') ? new Response(null, { status: 204 }) : Response.json({ code: 0, data: [] }))
  vi.mocked(siyuanCloudBrowserSession).mockReturnValue({ fetch: fetch as typeof globalThis.fetch })
  const transport = { status: () => ({ state: 'ready', userId, deviceId: 'dev_one', deviceRevision: 1 }),
    createCloudSpaceSession: vi.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, bootstrapCode: 'b'.repeat(43) }) }
  const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value,
    packageSettings: { read: async () => ({ revision: 1, value: { mode: 'managed', url: null } }) },
    internalServices: { acquire: (id: string) => id === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID ? transport : { read: () => ({ state: 'signed-in', userId, displayName: 'User' }) } }
  } as unknown as DomainMainHost)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as { createDefinitions(): Array<{ id: string; handler(input: unknown): Promise<unknown> }> }
  const definitions = factory.createDefinitions()
  const open = definitions.find(item => item.id === 'siyuan.editor.open')!.handler
  const search = definitions.find(item => item.id === 'siyuan.document.search')!.handler
  await open({ spaceId: 'spc_00000000000000000000000000000001' })
  await search({ spaceId: 'spc_00000000000000000000000000000001', query: 'notes' })
  expect(transport.createCloudSpaceSession).toHaveBeenCalledTimes(1)
  await open({ spaceId: 'spc_00000000000000000000000000000001' })
  expect(transport.createCloudSpaceSession).toHaveBeenCalledTimes(1)
  await open({ spaceId: grant.spaceId, refresh: true })
  expect(transport.createCloudSpaceSession).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/_sciforge/session'))).toHaveLength(2)
  await search({ spaceId: 'spc_00000000000000000000000000000001', query: 'notes' })
  expect(transport.createCloudSpaceSession).toHaveBeenCalledTimes(2)
})
