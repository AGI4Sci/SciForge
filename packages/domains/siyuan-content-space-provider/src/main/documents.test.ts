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
    exportDocumentMarkdown: vi.fn(async () => ({ path: '/SciForge/task', markdown: 'Result\n' })),
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
  let saved = { path: '', markdown: '' }
  const notebook = { id: '20261018120000-abcdefg', name: 'SciForge 工作总结', closed: false }
  const client = {
    listNotebooks: vi.fn(async () => exists ? [notebook] : []),
    createNotebook: vi.fn(async () => { exists = true; return notebook.id }),
    documentIds: vi.fn(async () => []),
    exportDocumentMarkdown: vi.fn(async () => saved),
    createDocument: vi.fn(async (input: { path: string; markdown: string }) => {
      saved = input
      return '20261018120000-hijklmn'
    })
  }
  const writer = createDocumentWriter({ userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'http://127.0.0.1:6806' }) })
  await Promise.all([
    writer.create({ title: 'Task one', markdown: 'One' }),
    writer.create({ title: 'Task two', markdown: 'Two' })
  ])
  expect(client.createNotebook).toHaveBeenCalledTimes(1)
  expect(client.createDocument).toHaveBeenCalledTimes(2)
})

async function editingFixture() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-edit-'))
  roots.push(userDataDir)
  const id = '20261109120000-abcdefg'
  let markdown = 'Original\n'
  const client = {
    documentMetadata: vi.fn(async () => ({ id, box: '20261109120000-noteboo', hpath: '/Note', updated: 'same-second' })),
    exportDocumentMarkdown: vi.fn(async () => ({ path: '/Note', markdown, raw: markdown, updated: 'same-second', conditionalWriteVersion: 1 })),
    appendMarkdown: vi.fn(async (_id: string, text: string) => { markdown = markdown.trimEnd() + '\n\n' + text }),
    replaceMarkdown: vi.fn(async (_id: string, text: string) => { markdown = text })
  }
  const options = { userDataDir, client: async () => ({ client: client as unknown as SiYuanClient, baseUrl: 'https://notes.test' }) }
  const { documentContent } = await import('./document-content.js')
  const revision = async () => (await documentContent(client as unknown as SiYuanClient, id)).contentHash
  return { id, client, options, revision, writer: createDocumentWriter(options), get: () => markdown,
    set: (text: string) => { markdown = text }, binding: { identity: 'account/service', spaceId: 'project-a', endpoint: 'https://notes.test', assertCurrent: vi.fn() } }
}

it('appends, replaces and clears the bound document, reading back each result', async () => {
  const f = await editingFixture()
  for (const [mode, markdown, expected] of [
    ['append', 'Added\n', 'Original\n\nAdded\n'], ['replace', 'Rewritten\n', 'Rewritten\n'], ['replace', '', '']
  ] as const) {
    const expectedContentHash = await f.revision()
    const result = await f.writer.edit(f.id, { markdown, expectedContentHash }, mode, f.binding)
    expect(result).toMatchObject({ id: f.id, mode, changed: true, contentHash: await f.revision() })
    expect(result.contentHash).not.toBe(expectedContentHash)
    expect(f.get()).toBe(expected)
  }
  expect(f.client.appendMarkdown).toHaveBeenCalledTimes(1)
  expect(f.client.replaceMarkdown).toHaveBeenCalledTimes(2)
})

it('rejects stale same-second edits and serializes competing writes', async () => {
  const f = await editingFixture()
  const expectedContentHash = await f.revision()
  const results = await Promise.allSettled([
    f.writer.edit(f.id, { markdown: 'A', expectedContentHash }, 'append', f.binding),
    f.writer.edit(f.id, { markdown: 'B', expectedContentHash }, 'replace', f.binding)
  ])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'document_changed' } })
  expect(f.client.replaceMarkdown).not.toHaveBeenCalled()
  expect(f.get()).toBe('Original\n\nA')
})

it.each([false, true])('never repeats a lost append across restart (committed: %s)', async committed => {
  const f = await editingFixture()
  const request = { markdown: 'Added', expectedContentHash: await f.revision() }
  f.client.appendMarkdown.mockImplementation(async () => {
    if (committed) f.set('Original\n\nAdded')
    throw new Error('lost response')
  })
  if (committed) await expect(f.writer.edit(f.id, request, 'append', f.binding)).resolves.toMatchObject({ changed: true })
  else await expect(f.writer.edit(f.id, request, 'append', f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  const restarted = createDocumentWriter(f.options)
  if (committed) await expect(restarted.edit(f.id, request, 'append', f.binding)).resolves.toMatchObject({ changed: false })
  else await expect(restarted.edit(f.id, request, 'append', f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(f.client.appendMarkdown).toHaveBeenCalledTimes(1)
})

it('rejects changed accounts, cancelled writes and empty append without dispatch; identical replacement is a no-op', async () => {
  const f = await editingFixture()
  const request = { markdown: f.get(), expectedContentHash: await f.revision() }
  await expect(f.writer.edit(f.id, request, 'replace', f.binding)).resolves.toMatchObject({ changed: false })
  expect(() => f.writer.edit(f.id, { ...request, markdown: ' ' }, 'append', f.binding)).toThrow()
  await expect(f.writer.edit(f.id, { ...request, markdown: 'New' }, 'replace', {
    ...f.binding, signal: AbortSignal.abort()
  })).rejects.toMatchObject({ code: 'cancelled' })
  f.binding.assertCurrent.mockImplementation(() => { throw new Error('account changed') })
  await expect(f.writer.edit(f.id, request, 'append', f.binding)).rejects.toThrow('account changed')
  expect(f.client.replaceMarkdown).not.toHaveBeenCalled()
  expect(f.client.appendMarkdown).not.toHaveBeenCalled()
})

it('reports an uncertain outcome if read-back fails after the write', async () => {
  const f = await editingFixture()
  const request = { markdown: 'New', expectedContentHash: await f.revision() }
  f.client.replaceMarkdown.mockImplementation(async () => {
    f.client.exportDocumentMarkdown.mockRejectedValue(new Error('disconnected'))
  })
  await expect(f.writer.edit(f.id, request, 'replace', f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(f.client.replaceMarkdown).toHaveBeenCalledTimes(1)
})

it('permits a new deliberate edit after a confirmed edit was reverted', async () => {
  const f = await editingFixture()
  const request = { markdown: 'New', expectedContentHash: await f.revision() }
  await f.writer.edit(f.id, request, 'replace', f.binding)
  f.set('Original\n')
  await expect(createDocumentWriter(f.options).edit(f.id, request, 'replace', f.binding))
    .resolves.toMatchObject({ changed: true })
  expect(f.client.replaceMarkdown).toHaveBeenCalledTimes(2)
})

it('does not retarget a bound edit when project resolution returns a different endpoint', async () => {
  const f = await editingFixture()
  const resolver = vi.fn(async (spaceId?: string) => { expect(spaceId).toBe('project-a'); return { client: f.client as unknown as SiYuanClient, baseUrl: 'https://other.test' } })
  const writer = createDocumentWriter({ userDataDir: f.options.userDataDir, client: resolver })
  await expect(writer.edit(f.id, { markdown: 'New', expectedContentHash: await f.revision() }, 'replace', f.binding))
    .rejects.toMatchObject({ code: 'invalid_configuration' })
  expect(f.client.replaceMarkdown).not.toHaveBeenCalled()
})

it('does not confirm a replacement when read-back differs from the requested body', async () => {
  const f = await editingFixture()
  f.client.replaceMarkdown.mockImplementation(async () => { f.set('Different body') })
  await expect(f.writer.edit(f.id, { markdown: 'Requested', expectedContentHash: await f.revision() }, 'replace', f.binding))
    .rejects.toMatchObject({ code: 'outcome_unknown' })
})
