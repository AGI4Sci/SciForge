import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentWriter } from './documents.js'
import type { SiYuanClient } from './client.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
it.each([false, true])('reconciles duplicate delivery across restart (lost response: %s)', async (lost) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-receipts-'))
  roots.push(userDataDir)
  const id = '20261018120000-abcdefg'
  let committed = false
  const client = {
    listNotebooks: vi.fn(async () => []),
    createNotebook: vi.fn(async () => '20261018120000-hijklmn'),
    documentIds: vi.fn(async () => committed ? [id] : []),
    createDocument: vi.fn(async () => {
      committed = true
      if (lost) throw new Error('response lost')
      return id
    })
  }
  const options = { userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'http://127.0.0.1:6806' }) }
  const request = { title: 'Task', markdown: 'Result', path: '/SciForge/task' }
  const writer = createDocumentWriter(options)
  if (lost) await expect(writer.create(request)).rejects.toThrow('response lost')
  else await expect(writer.create(request)).resolves.toMatchObject({ id })
  const restarted = createDocumentWriter(options)
  await expect(restarted.create(request)).resolves.toMatchObject({ id })
  expect(client.createDocument).toHaveBeenCalledTimes(1)
  expect(client.createNotebook).toHaveBeenCalledTimes(1)
})

it('refuses a blind retry of an uncertain write', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-unknown-'))
  roots.push(userDataDir)
  const client = {
    listNotebooks: vi.fn(async () => [{ id: '20261018120000-abcdefg', name: 'SciForge 工作总结', closed: false }]),
    documentIds: vi.fn(async () => []),
    createDocument: vi.fn(async () => { throw new Error('timeout') })
  }
  const writer = createDocumentWriter({ userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'http://127.0.0.1:6806' }) })
  const request = { title: 'Task', markdown: 'Result' }
  await expect(writer.create(request)).rejects.toThrow('timeout')
  await expect(writer.create(request)).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(client.createDocument).toHaveBeenCalledTimes(1)
})

it('creates one notebook when two completed turns arrive together', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-concurrent-'))
  roots.push(userDataDir)
  let exists = false
  const notebook = { id: '20261018120000-abcdefg', name: 'SciForge 工作总结', closed: false }
  const client = {
    listNotebooks: vi.fn(async () => exists ? [notebook] : []),
    createNotebook: vi.fn(async () => { exists = true; return notebook.id }),
    documentIds: vi.fn(async () => []),
    createDocument: vi.fn(async () => '20261018120000-hijklmn')
  }
  const writer = createDocumentWriter({ userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'http://127.0.0.1:6806' }) })
  await Promise.all([
    writer.create({ title: 'Task one', markdown: 'One' }),
    writer.create({ title: 'Task two', markdown: 'Two' })
  ])
  expect(client.createNotebook).toHaveBeenCalledTimes(1)
  expect(client.createDocument).toHaveBeenCalledTimes(2)
})
