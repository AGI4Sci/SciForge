import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { siyuanDocumentReadRequestSchema } from '../editor-contract.js'
import { createDocumentReader } from './reader.js'
import type { SiYuanClient } from './client.js'

const id = '20261030140949-abcdefg'
const notebook = '20261029151725-tmcqisz'
const baseUrl = 'http://127.0.0.1:6806'

const readerFor = (client: Record<string, unknown>) => createDocumentReader({
  client: async () => ({ client: client as unknown as SiYuanClient, baseUrl })
})

const row = { id, box: notebook, hpath: '/SciForge/实验记录-1a2b3c', updated: '20261030140949' }

it('returns the version from the same body snapshot instead of a lagging SQL index', async () => {
  const reader = readerFor({ documentMetadata: async () => row,
    exportDocumentMarkdown: async () => ({ path: row.hpath, markdown: 'New body', updated: '20261111220000' }) })
  await expect(reader.read({ id })).resolves.toMatchObject({ markdown: 'New body', updated: '20261111220000' })
})

it('reads a document by id and hands back the clean export body', async () => {
  const client = {
    documentMetadata: vi.fn(async () => row),
    exportDocumentMarkdown: vi.fn(async () => ({
      updated: row.updated, path: row.hpath, markdown: '# 结论\n\n可行。\n'
    })),
    listNotebooks: vi.fn(async () => []),
    findDocumentByPath: vi.fn(),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ id })).resolves.toEqual({
    id, path: row.hpath, notebook, title: '实验记录-1a2b3c', updated: row.updated,
    markdown: '# 结论\n\n可行。\n', truncated: false,
    offset: 0, nextOffset: null, totalChars: 10, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
  })
  expect(client.exportDocumentMarkdown).toHaveBeenCalledWith(id, undefined)
})

it('resolves a human path through the notebook name the user reads in the tree', async () => {
  const client = {
    documentMetadata: vi.fn(),
    exportDocumentMarkdown: vi.fn(async () => ({ updated: row.updated, path: row.hpath, markdown: '正文\n' })),
    listNotebooks: vi.fn(async () => [{ id: notebook, name: 'SciForge 工作总结', closed: false }]),
    findDocumentByPath: vi.fn(async () => row),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ path: row.hpath, notebookName: 'SciForge 工作总结' }))
    .resolves.toMatchObject({ id, markdown: '正文\n' })
  expect(client.findDocumentByPath).toHaveBeenCalledWith(row.hpath, notebook, undefined)
})

it('truncates a long document instead of flooding the conversation', async () => {
  const client = {
    documentMetadata: vi.fn(async () => row),
    exportDocumentMarkdown: vi.fn(async () => ({ updated: row.updated, path: row.hpath, markdown: 'a'.repeat(500) })),
    listNotebooks: vi.fn(async () => []),
    findDocumentByPath: vi.fn(),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ id, maxChars: 200 })).resolves.toMatchObject({
    markdown: 'a'.repeat(200), truncated: true
  })
})

it('reads an entire long Unicode document in version-checked pages without losing characters', async () => {
  const markdown = '中'.repeat(199) + '🧪' + '\n正文'.repeat(15000)
  const reader = readerFor({ documentMetadata: async () => row,
    exportDocumentMarkdown: async () => ({ updated: row.updated, path: row.hpath, markdown }) })
  let offset = 0, contentHash: string | undefined, collected = ''
  for (;;) {
    const page = await reader.read({ id, offset, contentHash, maxChars: 200 })
    expect(page.offset).toBe(offset)
    expect(page.totalChars).toBe(markdown.length)
    collected += page.markdown
    contentHash = page.contentHash
    if (page.nextOffset === null) break
    expect(page.nextOffset).toBeGreaterThan(offset)
    offset = page.nextOffset
  }
  expect(collected).toBe(markdown)
})

it('rejects changed content, missing version tokens and invalid continuation offsets', async () => {
  let markdown = 'a'.repeat(500)
  const reader = readerFor({ documentMetadata: async () => row,
    exportDocumentMarkdown: async () => ({ updated: row.updated, path: row.hpath, markdown }) })
  const first = await reader.read({ id, maxChars: 200 })
  await expect(reader.read({ id, offset: 200 })).rejects.toMatchObject({ code: 'pagination_hash_required' })
  await expect(reader.read({ id, offset: 501, contentHash: first.contentHash })).rejects.toMatchObject({ code: 'pagination_offset_invalid' })
  markdown = 'b'.repeat(500)
  await expect(reader.read({ id, offset: 200, contentHash: first.contentHash })).rejects.toMatchObject({ code: 'stale_document' })
})

it('preserves YAML written by the user rather than stripping it as server metadata', async () => {
  const markdown = '---\ntitle: 用户正文中的 YAML\n---\n\n正文。'
  const reader = readerFor({ documentMetadata: async () => row,
    exportDocumentMarkdown: async () => ({ updated: row.updated, path: row.hpath, markdown }) })
  await expect(reader.read({ id })).resolves.toMatchObject({ markdown })
})

it('refuses an ambiguous reference and an empty one', async () => {
  const reader = readerFor({ documentMetadata: vi.fn(), findDocumentByPath: vi.fn(), exportDocumentMarkdown: vi.fn() })
  await expect(reader.read({ id, path: row.hpath })).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(reader.read({})).rejects.toMatchObject({ code: 'invalid_input' })
})

it('reports a missing notebook as a missing document', async () => {
  const client = {
    documentMetadata: vi.fn(), exportDocumentMarkdown: vi.fn(),
    listNotebooks: vi.fn(async () => []), findDocumentByPath: vi.fn(), searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ path: row.hpath, notebookName: '不存在的笔记本' }))
    .rejects.toMatchObject({ code: 'document_not_found' })
  expect(client.findDocumentByPath).not.toHaveBeenCalled()
})

it('searches by path fragment and keeps the limit the caller asked for', async () => {
  const client = {
    documentMetadata: vi.fn(), exportDocumentMarkdown: vi.fn(), findDocumentByPath: vi.fn(),
    listNotebooks: vi.fn(async () => []),
    searchDocuments: vi.fn(async () => [row])
  }
  const reader = readerFor(client)
  await expect(reader.search({ query: '实验', limit: 5 })).resolves.toEqual({
    documents: [{ id, path: row.hpath, notebook, updated: row.updated }]
  })
  expect(client.searchDocuments).toHaveBeenCalledWith({ query: '实验', limit: 5 })
})

it('describes continuation requirements in the discoverable schema and rejects missing hashes before I/O', async () => {
  expect(siyuanDocumentReadRequestSchema.parse({})).toMatchObject({ offset: 0 })
  expect(siyuanDocumentReadRequestSchema.safeParse({ offset: 200 }).success).toBe(false)
  expect(siyuanDocumentReadRequestSchema.safeParse({ offset: 200, contentHash: 'a'.repeat(64) }).success).toBe(true)
  const schema = z.toJSONSchema(siyuanDocumentReadRequestSchema)
  expect(JSON.stringify(schema)).toContain('contentHash')
  expect(schema.anyOf?.[1]?.required).toContain('contentHash')
  const client = vi.fn()
  const reader = createDocumentReader({ client })
  await expect(reader.read({ id, offset: 200 })).rejects.toMatchObject({
    code: 'pagination_hash_required', message: expect.stringContaining('nextOffset')
  })
  expect(client).not.toHaveBeenCalled()
})
