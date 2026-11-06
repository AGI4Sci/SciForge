import { expect, it, vi } from 'vitest'
import { createDocumentReader } from './reader.js'
import type { SiYuanClient } from './client.js'

const id = '20261030140949-abcdefg'
const notebook = '20261029151725-tmcqisz'
const baseUrl = 'http://127.0.0.1:6806'

const readerFor = (client: Record<string, unknown>) => createDocumentReader({
  client: async () => ({ client: client as unknown as SiYuanClient, baseUrl })
})

const row = { id, box: notebook, hpath: '/SciForge/实验记录-1a2b3c', updated: '20261030140949' }

it('reads a document by id and hands back the body without export front matter', async () => {
  const client = {
    documentMetadata: vi.fn(async () => row),
    exportDocumentMarkdown: vi.fn(async () => ({
      path: row.hpath, markdown: '---\ntitle: 实验记录\ndate: 2026-10-30\n---\n# 结论\n\n可行。\n'
    })),
    listNotebooks: vi.fn(async () => []),
    findDocumentByPath: vi.fn(),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ id })).resolves.toEqual({
    id, path: row.hpath, notebook, title: '实验记录-1a2b3c', updated: row.updated,
    markdown: '# 结论\n\n可行。\n', truncated: false
  })
  expect(client.exportDocumentMarkdown).toHaveBeenCalledWith(id)
})

it('resolves a human path through the notebook name the user reads in the tree', async () => {
  const client = {
    documentMetadata: vi.fn(),
    exportDocumentMarkdown: vi.fn(async () => ({ path: row.hpath, markdown: '正文\n' })),
    listNotebooks: vi.fn(async () => [{ id: notebook, name: 'SciForge 工作总结', closed: false }]),
    findDocumentByPath: vi.fn(async () => row),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ path: row.hpath, notebookName: 'SciForge 工作总结' }))
    .resolves.toMatchObject({ id, markdown: '正文\n' })
  expect(client.findDocumentByPath).toHaveBeenCalledWith(row.hpath, notebook)
})

it('truncates a long document instead of flooding the conversation', async () => {
  const client = {
    documentMetadata: vi.fn(async () => row),
    exportDocumentMarkdown: vi.fn(async () => ({ path: row.hpath, markdown: 'a'.repeat(500) })),
    listNotebooks: vi.fn(async () => []),
    findDocumentByPath: vi.fn(),
    searchDocuments: vi.fn()
  }
  const reader = readerFor(client)
  await expect(reader.read({ id, maxChars: 200 })).resolves.toMatchObject({
    markdown: 'a'.repeat(200), truncated: true
  })
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