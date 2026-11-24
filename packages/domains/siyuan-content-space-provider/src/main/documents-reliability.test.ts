import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentWriter } from './documents.js'
import { SiYuanError, type SiYuanClient } from './client.js'

const roots: string[] = []
const id = '20261109120000-abcdefg', notebook = '20261109120000-hijklmn'
const request = { title: '结果', path: '/结果', markdown: '# 实验\n\n完成。  \n下一行。' }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-reliability-'))
  roots.push(userDataDir)
  let document: { path: string; markdown: string } | undefined
  const client = {
    listNotebooks: vi.fn(async () => [{ id: notebook, name: 'SciForge 工作总结', closed: false }]),
    documentIds: vi.fn(async () => document ? [id] : []),
    createDocument: vi.fn(async (input: { path: string; markdown: string }) => { document = input; return id }),
    exportDocumentMarkdown: vi.fn(async () => ({ path: document!.path, markdown: `${document!.markdown}\n` }))
  }
  const options = { userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'https://one.test' }) }
  return { client, options, writer: createDocumentWriter(options), replace: (value: typeof document) => { document = value } }
}

it('does not claim an old document with different content was saved', async () => {
  const f = await fixture()
  f.replace({ path: request.path, markdown: 'Old content' })
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'document_conflict' })
  expect(f.client.createDocument).not.toHaveBeenCalled()
})

it('checks content again after restart and rejects edits, deletions and a different replay body', async () => {
  const f = await fixture()
  await expect(f.writer.create(request)).resolves.toMatchObject({ id, verified: true })
  const restarted = createDocumentWriter(f.options)
  await expect(restarted.create({ ...request, markdown: 'different' })).rejects.toMatchObject({ code: 'document_conflict' })
  f.replace({ path: request.path, markdown: 'external modification' })
  await expect(restarted.create(request)).rejects.toMatchObject({ code: 'document_conflict' })
  f.replace(undefined)
  await expect(restarted.create(request)).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(f.client.createDocument).toHaveBeenCalledTimes(1)
})

it('keeps uncertain receipts and reconciles readback failures without repeating the write', async () => {
  const f = await fixture()
  f.client.exportDocumentMarkdown.mockRejectedValueOnce(new Error('offline'))
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'outcome_unknown' })
  await expect(createDocumentWriter(f.options).create(request)).resolves.toMatchObject({ verified: true })
  expect(f.client.createDocument).toHaveBeenCalledTimes(1)
})

it('reports transformed or incomplete content instead of returning a false success', async () => {
  const f = await fixture()
  f.client.exportDocumentMarkdown.mockResolvedValueOnce({ path: request.path, markdown: '# 实验\n\n完成。\n下一行。' })
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'write_verification_failed' })
  expect(f.client.createDocument).toHaveBeenCalledOnce()
})

it('allows corrected retry after an explicit authentication rejection', async () => {
  const f = await fixture()
  f.client.createDocument.mockRejectedValueOnce(new SiYuanError('unauthorized'))
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'unauthorized' })
  await expect(f.writer.create(request)).resolves.toMatchObject({ verified: true })
  expect(f.client.createDocument).toHaveBeenCalledTimes(2)
})

it('keeps receipts and queued requests attached to their original server', async () => {
  const f = await fixture(), other = await fixture()
  let current = f.client
  let baseUrl = 'https://one.test'
  const writer = createDocumentWriter({ userDataDir: f.options.userDataDir, client: async () => ({ client: current as unknown as SiYuanClient, baseUrl }) })
  const first = writer.create(request)
  const second = writer.create(request)
  current = other.client
  baseUrl = 'https://two.test'
  const third = writer.create(request)
  await expect(Promise.all([first, second, third])).resolves.toMatchObject([
    { url: 'https://one.test/' }, { url: 'https://one.test/' }, { url: 'https://two.test/' }
  ])
  expect(f.client.createDocument).toHaveBeenCalledOnce()
  expect(other.client.createDocument).toHaveBeenCalledOnce()
})

it('refuses ambiguous notebooks or paths before writing', async () => {
  const f = await fixture()
  f.client.listNotebooks.mockResolvedValueOnce([
    { id: notebook, name: 'SciForge 工作总结', closed: false },
    { id, name: 'SciForge 工作总结', closed: false }
  ])
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'document_ambiguous' })
  f.client.documentIds.mockResolvedValueOnce([id, notebook])
  await expect(f.writer.create(request)).rejects.toMatchObject({ code: 'document_ambiguous' })
  expect(f.client.createDocument).not.toHaveBeenCalled()
})

it('does not dispatch a queued write after its turn was cancelled', async () => {
  const f = await fixture()
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  f.client.exportDocumentMarkdown.mockImplementationOnce(async () => {
    await waiting
    return { path: request.path, markdown: request.markdown }
  })
  const first = f.writer.create(request)
  const controller = new AbortController()
  const second = f.writer.create({ ...request, path: '/取消的文档' }, controller.signal)
  const cancelled = expect(second).rejects.toMatchObject({ code: 'cancelled' })
  controller.abort()
  release()
  await first
  await cancelled
  expect(f.client.createDocument).toHaveBeenCalledOnce()
})
