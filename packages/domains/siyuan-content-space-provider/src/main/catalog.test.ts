import { expect, it, vi } from 'vitest'
import { createSiYuanCatalog } from './catalog.js'
import type { SiYuanClient } from './client.js'

const notebook = '20261108120000-noteboo'
const id = (n: number) => `20261108120000-${String(n).padStart(7, '0')}`
const document = (n: number, parent = '/') => ({
  id: id(n), title: `Document ${n}`, path: `${parent}${id(n)}.sy`, childCount: n === 0 ? 1 : 0
})
function fixture() {
  let scope = 'account-a/service-a'
  const notebooks = [{ id: notebook, name: 'Research', closed: false },
    { id: '20261108120000-closedx', name: 'Research', closed: true }]
  const files = Array.from({ length: 137 }, (_, n) => document(n))
  const listDirectory = vi.fn(async (_notebook: string, path: string) =>
    path === '/' ? [...files].reverse() : [document(138, `/${id(0)}/`)])
  const resolveClient = vi.fn(async (_spaceId?: string, _signal?: AbortSignal) => ({ scope, client: {
    listNotebooks: async () => [...notebooks], listDirectory
  } as unknown as SiYuanClient }))
  const catalog = createSiYuanCatalog({ client: resolveClient })
  return { catalog, files, notebooks, listDirectory, resolveClient, switchAccount: () => { scope = 'account-b/service-a' } }
}

it('enumerates every notebook including closed and duplicate-name entries', async () => {
  const { catalog } = fixture()
  const first = await catalog.notebooks({ limit: 1 })
  expect(first.total).toBe(2)
  expect(first.nextCursor).not.toBeNull()
  const last = await catalog.notebooks({ limit: 1, cursor: first.nextCursor })
  expect(last.nextCursor).toBeNull()
  expect([...first.notebooks, ...last.notebooks].map(item => item.closed).sort()).toEqual([false, true])
})

it('pages beyond display/search limits and makes nested documents traversable without title guessing', async () => {
  const { catalog, files } = fixture()
  const received: typeof files = []
  let cursor: string | undefined
  do {
    const result = await catalog.directory({ notebook, limit: 50, ...(cursor ? { cursor } : {}) })
    expect(result.scope).toBe('direct-children')
    expect(result.total).toBe(137)
    received.push(...result.documents)
    cursor = result.nextCursor ?? undefined
  } while (cursor)
  expect(received).toEqual(files)
  const child = await catalog.directory({ notebook, path: received[0].path })
  expect(child.documents).toEqual([document(138, `/${id(0)}/`)])
  expect(child.nextCursor).toBeNull()
})

it('rejects stale, cross-directory and cross-account cursors instead of claiming completeness', async () => {
  const { catalog, files, switchAccount } = fixture()
  const first = await catalog.directory({ notebook, limit: 1 })
  await expect(catalog.directory({ notebook, path: files[0].path, cursor: first.nextCursor }))
    .rejects.toMatchObject({ code: 'catalog_changed' })
  files[1].title = 'Renamed'
  await expect(catalog.directory({ notebook, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'catalog_changed' })
  const fresh = await catalog.directory({ notebook, limit: 1 })
  switchAccount()
  await expect(catalog.directory({ notebook, cursor: fresh.nextCursor })).rejects.toMatchObject({ code: 'catalog_changed' })
  await expect(catalog.directory({ notebook, cursor: 'garbage' })).rejects.toMatchObject({ code: 'invalid_input' })
})

it('distinguishes empty, closed, missing and failed directories', async () => {
  const { catalog, files, listDirectory } = fixture()
  files.length = 0
  await expect(catalog.directory({ notebook })).resolves.toMatchObject({ documents: [], total: 0, nextCursor: null })
  await expect(catalog.directory({ notebook: '20261108120000-closedx' })).rejects.toMatchObject({ code: 'notebook_closed' })
  await expect(catalog.directory({ notebook: '20261108120000-missing' })).rejects.toMatchObject({ code: 'document_not_found' })
  listDirectory.mockRejectedValueOnce(new Error('offline'))
  await expect(catalog.directory({ notebook })).rejects.toThrow('offline')
})

it('resolves the explicit project for every page and binds cursors even when projects have identical listings', async () => {
  const { catalog, resolveClient, listDirectory } = fixture()
  const signal = new AbortController().signal
  const first = await catalog.directory({ spaceId: 'spc_00000000000000000000000000000001', notebook, limit: 1 }, signal)
  expect(first.spaceId).toBe('spc_00000000000000000000000000000001')
  expect(resolveClient).toHaveBeenLastCalledWith('spc_00000000000000000000000000000001', signal)
  expect(listDirectory).toHaveBeenLastCalledWith(notebook, '/', signal)
  await catalog.directory({ spaceId: 'spc_00000000000000000000000000000001', notebook, cursor: first.nextCursor })
  expect(resolveClient).toHaveBeenCalledTimes(2)
  await expect(catalog.directory({ spaceId: 'spc_00000000000000000000000000000002', notebook, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'catalog_changed' })
  const notebooks = await catalog.notebooks({ spaceId: 'spc_00000000000000000000000000000001', limit: 1 })
  expect(notebooks.spaceId).toBe('spc_00000000000000000000000000000001')
  await expect(catalog.notebooks({ spaceId: 'spc_00000000000000000000000000000002', cursor: notebooks.nextCursor })).rejects.toMatchObject({ code: 'catalog_changed' })
})

it('does not resolve a cancelled request or hide an authorization failure behind cached pages', async () => {
  const { catalog, resolveClient } = fixture()
  const controller = new AbortController()
  controller.abort()
  await expect(catalog.notebooks({ spaceId: 'spc_00000000000000000000000000000001' }, controller.signal)).rejects.toThrow()
  expect(resolveClient).not.toHaveBeenCalled()
  const first = await catalog.notebooks({ spaceId: 'spc_00000000000000000000000000000001', limit: 1 })
  resolveClient.mockRejectedValueOnce(new Error('membership revoked'))
  await expect(catalog.notebooks({ spaceId: 'spc_00000000000000000000000000000001', cursor: first.nextCursor })).rejects.toThrow('membership revoked')
})

it('rejects duplicate provider identities rather than returning an apparently complete catalog', async () => {
  const { catalog, notebooks, files } = fixture()
  notebooks.push(notebooks[0])
  await expect(catalog.notebooks({})).rejects.toMatchObject({ code: 'provider_contract_violation' })
  files.push(files[0])
  await expect(catalog.directory({ notebook })).rejects.toMatchObject({ code: 'provider_contract_violation' })
})
