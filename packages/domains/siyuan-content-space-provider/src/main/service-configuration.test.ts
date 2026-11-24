import { afterEach, expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import { createSiYuanServiceConfiguration } from './service-configuration.js'
import { createDomainMainEntry } from './index.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
function fixture() {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = { mode: 'custom', url: null }
  const secrets = new Map<string, string>()
  const host = {
    defineCapability: (definition: unknown) => definition,
    packageSettings: {
      read: vi.fn(async () => ({ revision, value })),
      write: vi.fn(async (next, expected) => {
        if (expected !== revision) throw new Error('revision conflict')
        value = next
        return { revision: ++revision, value }
      }),
      clear: vi.fn(async () => ({ revision: ++revision, value: value = null }))
    } satisfies DomainMainPackageSettingsHost,
    packageSecrets: {
      has: async (key: string) => secrets.has(key),
      read: async (key: string) => secrets.get(key) ?? null,
      write: async (key: string, token: string) => { secrets.set(key, token) },
      remove: async (key: string) => { secrets.delete(key) }
    }
  } as unknown as DomainMainHost
  return { host, secrets }
}

it('persists the endpoint and supports main-chat reads after restart before the editor opens', async () => {
  vi.stubEnv('SIYUAN_BASE_URL', '')
  const { host } = fixture()
  await createSiYuanServiceConfiguration(host).configure({ url: 'https://remote.test/notes/', token: 'private' })
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://remote.test/notes/api/query/sql')
    expect(init.headers).toMatchObject({ Authorization: 'Token private' })
    return Response.json({ code: 0, data: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  const entry = createDomainMainEntry(host)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as {
    createDefinitions(): { id: string; handler(input: unknown): Promise<unknown> }[]
  }
  const search = factory.createDefinitions().find(item => item.id === 'siyuan.document.search')!
  await expect(search.handler({ query: '结果' })).resolves.toEqual({ output: { documents: [] } })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(JSON.stringify(await createSiYuanServiceConfiguration(host).status())).not.toContain('private')
})

it('isolates stored and installation credentials by normalized endpoint including its path', async () => {
  vi.stubEnv('SIYUAN_BASE_URL', 'https://installation.test/')
  vi.stubEnv('SIYUAN_API_TOKEN', 'installation-private')
  const { host } = fixture()
  const configuration = createSiYuanServiceConfiguration(host)
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://installation.test', token: 'installation-private' })
  await configuration.configure({ url: 'https://other.test/a', token: 'a-private' })
  await configuration.configure({ url: 'https://other.test/b' })
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://other.test/b' })
  await configuration.configure({ url: 'https://other.test/a/' })
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://other.test/a', token: 'a-private' })
  await configuration.configure({ token: null })
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://other.test/a' })
  await configuration.configure({ url: '' })
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://installation.test', token: 'installation-private' })
})

it('serializes concurrent saves and status waits for the committed configuration', async () => {
  const { host } = fixture()
  const configuration = createSiYuanServiceConfiguration(host)
  const first = configuration.configure({ url: 'https://one.test', token: 'one' })
  const second = configuration.configure({ url: 'https://two.test', token: 'two' })
  await expect(configuration.status()).resolves.toMatchObject({ url: 'https://two.test', token: 'stored' })
  await Promise.all([first, second])
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://two.test', token: 'two' })
})

it('never falls back to another server when durable settings are unreadable or corrupt', async () => {
  vi.stubEnv('SIYUAN_BASE_URL', 'https://installation.test')
  const { host } = fixture()
  vi.mocked(host.packageSettings!.read).mockRejectedValueOnce(new Error('private filesystem detail'))
  await expect(createSiYuanServiceConfiguration(host).endpoint()).rejects.toMatchObject({ code: 'configuration_unavailable' })
  vi.mocked(host.packageSettings!.read).mockResolvedValueOnce({ revision: 1, value: { unexpected: true } })
  await expect(createSiYuanServiceConfiguration(host).endpoint()).rejects.toMatchObject({ code: 'configuration_unavailable' })
})

it('rejects malformed URLs before writing secrets and keeps the last committed address after save failure', async () => {
  const { host, secrets } = fixture()
  const configuration = createSiYuanServiceConfiguration(host)
  await configuration.configure({ url: 'https://saved.test', token: 'saved-private' })
  for (const url of ['file:///private', 'https://user:password@test', 'https://test/?token=private']) {
    await expect(configuration.configure({ url, token: 'bad' })).rejects.toMatchObject({ code: 'invalid_configuration' })
  }
  expect(secrets.size).toBe(1)
  vi.mocked(host.packageSettings!.write).mockRejectedValueOnce(new Error('CAS failed'))
  await expect(configuration.configure({ url: 'https://new.test', token: 'new-private' })).rejects.toMatchObject({ code: 'configuration_unavailable' })
  await expect(configuration.endpoint()).resolves.toEqual({ baseUrl: 'https://saved.test', token: 'saved-private' })
})

it('uses a valid saved URL even if the shadowed environment default is invalid', async () => {
  const { host } = fixture()
  await createSiYuanServiceConfiguration(host).configure({ url: 'https://saved.test' })
  vi.stubEnv('SIYUAN_BASE_URL', 'invalid')
  vi.stubEnv('SIYUAN_API_TOKEN', 'private')
  await expect(createSiYuanServiceConfiguration(host).endpoint()).resolves.toEqual({ baseUrl: 'https://saved.test' })
})


it('defaults existing unscoped settings to managed without reading a legacy credential or opening its endpoint', async () => {
  const read = vi.fn(async () => 'legacy-secret')
  const configuration = createSiYuanServiceConfiguration({
    packageSettings: { read: async () => ({ revision: 1, value: { url: 'https://legacy-shared.test' } }) },
    packageSecrets: { read }
  } as unknown as DomainMainHost)
  await expect(configuration.status()).resolves.toMatchObject({ mode: 'managed', token: 'none' })
  await expect(configuration.endpoint()).rejects.toMatchObject({ code: 'space_required' })
  expect(read).not.toHaveBeenCalled()
})
