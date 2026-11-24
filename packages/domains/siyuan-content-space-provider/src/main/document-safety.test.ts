import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SiYuanClient } from './client.js'
import { createDocumentWriter } from './documents.js'
import { documentContent } from './document-content.js'
import { bodyMarkdown, comparableMarkdown } from './markdown.js'
import { assertDocumentProtection } from './document-protection.js'
import { documentStep } from './document-step.js'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const doc = '20261111120000-documen', notebook = '20261111120000-noteboo'

it('reconciles an existing pending receipt when SiYuan inserted adjacent-reference caret separators', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notes-reference-receipt-')); roots.push(directory)
  const identity = ['user', 'space', doc, 'append-1'], request = { mode: 'append', markdown: 'new section' }
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const before = "((20261112173441-hw6jkxg '20261112173441-hw6jkxg'))((20261112173447-8guqvxe '20261112173447-8guqvxe'))"
  const current = before.replace('))((', '))\u200b((')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, hash(identity) + '.json'), JSON.stringify({ version: 1, state: 'pending', requestHash: hash(request), targetHash: hash(comparableMarkdown(before)) }))
  await expect(documentStep(directory, identity, request, current)).resolves.toEqual({ replay: true })
  await expect(documentStep(directory, identity, request, current)).resolves.toEqual({ replay: true })
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'notes-safe-')); roots.push(directory)
  const blocks = [
    { id: '20261111120000-heading', type: 'h', text: '## 方法演进' },
    { id: '20261111120000-paragra', type: 'p', text: '原方法。((20261111120000-sourcea))' },
    { id: '20261111120000-compare', type: 'h', text: '## 比较' },
    { id: '20261111120000-tableaa', type: 't', text: '| 方法 | 指标 |\n| --- | --- |\n| A | 未报告 |' },
    { id: '20261111120000-endhead', type: 'h', text: '## 局限' },
    { id: '20261111120000-lockedx', type: 'html', text: '<!-- locked -->\n人工定稿。\n<!-- /locked -->' },
    { id: '20261111120000-formula', type: 'math', text: '$$\nA=QK^T\n$$' },
    { id: '20261111120000-imageaa', type: 'p', text: '![人工图](assets/test.svg)' }
  ]
  let updated = '20261111120000', writes = 0, dropResponse = false, race: (() => void) | undefined
  let conditionalWriteVersion: number | undefined = 1, writeRace: (() => void) | undefined
  const raw = (block: typeof blocks[number]) => block.text + `\n{: id="${block.id}" updated="${updated}" custom-human="keep"}\n`
  const full = () => blocks.map(raw).join('\n') + `\n{: id="${doc}" type="doc" updated="${updated}"}\n`
  const client = new SiYuanClient({ baseUrl: 'https://notes.test', fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname, request = JSON.parse(String(init?.body))
    let data: unknown
    if (path === '/api/query/sql') data = [{ id: doc, box: notebook, hpath: '/综述', updated: '20000101000000' }]
    else if (path === '/api/filetree/getHPathByID') data = '/综述'
    else if (path === '/api/block/getBlockKramdown') data = { id: request.id, kramdown: request.id === doc ? full() : raw(blocks.find(block => block.id === request.id)!), conditionalWriteVersion }
    else if (path === '/api/block/getChildBlocks') { race?.(); race = undefined; data = blocks.map(({ id, type }) => ({ id, type })) }
    else if (path === '/api/block/batchUpdateBlock' || path === '/api/block/appendBlock') {
      writeRace?.(); writeRace = undefined
      expect(request.expectedDocument?.id).toBe(doc)
      if (request.expectedDocument.kramdown !== full()) return Response.json({ code: -1, msg: 'document_changed', data: null })
      if (path === '/api/block/batchUpdateBlock') {
      writes++
      for (const change of request.blocks) blocks.find(block => block.id === change.id)!.text = bodyMarkdown(change.data).trim()
      updated = request.blocks.at(-1).data.match(/\bupdated="(\d{14})"/u)?.[1] ?? '20261111120001'; data = [{ doOperations: request.blocks }]
      if (dropResponse) throw new Error('reply lost after commit')
      } else {
      writes++; blocks.push({ id: '20261111120000-addedxx', type: 'p', text: request.data }); data = [{ doOperations: [{}] }]
      }
    } else throw new Error('Unexpected endpoint ' + path)
    return new Response(JSON.stringify({ code: 0, data }))
  } })
  const options = { userDataDir: directory, client: async () => ({ client, baseUrl: 'https://notes.test' }) }
  const binding = { identity: 'user', spaceId: 'space', endpoint: 'https://notes.test', assertCurrent() {} }
  const writer = createDocumentWriter(options)
  const read = () => documentContent(client, doc)
  const request = async (changes: unknown[], operationId = 'revision-1') => ({ expectedContentHash: (await read()).contentHash, expectedUpdated: updated, operationId, changes })
  return { client, writer, options, binding, blocks, read, request, writes: () => writes, setDrop: () => { dropResponse = true },
    setUnsupported: () => { conditionalWriteVersion = undefined },
    setWriteRace: () => { writeRace = () => { blocks[1].text += '人工最后一刻编辑。' } },
    setVersionRace: () => { race = () => { updated = '20261111120001' } },
    setRace: () => { race = () => { blocks[1].text += '人工抢先编辑。' } } }
}

it('rejects writes to an unpatched server while keeping reads available', async () => {
  const f = await fixture()
  f.setUnsupported()
  const request = await f.request([{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订方法。' }])
  await expect(f.writer.edit(doc, request, 'patch', f.binding)).rejects.toMatchObject({ code: 'conditional_write_unsupported' })
  expect((await f.read()).markdown).toContain('原方法。')
  expect(f.writes()).toBe(0)
})

it('preserves a last-moment human edit rejected by the server and permits a fresh retry', async () => {
  const f = await fixture()
  const changes = [{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订方法。' }]
  const request = await f.request(changes, 'server-race')
  f.setWriteRace()
  await expect(f.writer.edit(doc, request, 'patch', f.binding)).rejects.toMatchObject({ code: 'document_changed' })
  expect(f.writes()).toBe(0)
  expect((await f.read()).markdown).toContain('原方法。((20261111120000-sourcea))人工最后一刻编辑。')
  await expect(f.writer.edit(doc, await f.request(changes, 'server-race'), 'patch', f.binding)).resolves.toMatchObject({ changed: true })
  expect(f.writes()).toBe(1)
  expect((await f.read()).markdown).toContain('修订方法。((20261111120000-sourcea))人工最后一刻编辑。')
})

it('keeps native references, assets and literal attribute examples without publication expansion', () => {
  const literal = '```md\n{: id="20261111120000-example"}\n```'
  const source = '来源((20261111120000-sourcea)) [笔记](siyuan://blocks/20261111120000-sourceb)\n{: id="20261111120000-paragra"}\n\n' + literal
  expect(bodyMarkdown(source)).toBe('来源((20261111120000-sourcea)) [笔记](siyuan://blocks/20261111120000-sourceb)\n\n' + literal)
  expect(comparableMarkdown('((20261111120000-sourcea))')).toBe(comparableMarkdown("((20261111120000-sourcea '20261111120000-sourcea'))"))
  expect(comparableMarkdown('`((20261111120000-sourcea))`')).not.toBe(comparableMarkdown("`((20261111120000-sourcea '20261111120000-sourcea'))`"))
  for (const literal of ['    {: id="20261111120000-example"}\n', '<pre>\n{: id="20261111120000-example"}\n</pre>', '$$\n{: id="20261111120000-example"}\n$$']) expect(bodyMarkdown(literal)).toBe(literal)
})

it('protects nested tables during whole-document replacement', () => {
  const before = '> | 方法 | 指标 |\n> | --- | --- |\n> | 人工方法 | 0.8 |'
  expect(() => assertDocumentProtection(before, before.replace('0.8', '0.9'))).toThrow()
  expect(() => assertDocumentProtection(before, before + '\n> | 新方法 | 未报告 |')).not.toThrow()
})

it('advances document timestamps through repeated same-second edits even when the local clock is behind', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 11, 11, 0, 0))
  const f = await fixture(), before = await f.read()
  const first = await f.writer.edit(doc, await f.request([
    { type: 'text', section: '方法演进', find: '原方法。', replace: '修订方法。' }
  ], 'clock-1'), 'patch', f.binding)
  expect(first.updated).toBe('20261111120001')
  expect(first.updated > before.updated).toBe(true)
  const second = await f.writer.edit(doc, await f.request([
    { type: 'table-cell', section: '比较', tableIndex: 0, row: 1, column: 1, expected: '未报告', value: '待核对' }
  ], 'clock-2'), 'patch', f.binding)
  expect(second.updated).toBe('20261111120002')
  expect(await f.client.readDocument(f.blocks[3].id)).toContain('custom-human="keep"')
})

it('patches a section and explicit table cell atomically, retaining every block and all other text', async () => {
  const f = await fixture(), before = f.blocks.map(block => ({ ...block }))
  const request = await f.request([
    { type: 'text', section: '方法演进', find: '原方法。', replace: '修订方法。' },
    { type: 'table-cell', section: '比较', row: 1, column: 1, expected: '未报告', value: '仍缺证据' },
    { type: 'table-append', section: '比较', rows: [['新方法', '未报告']] }
  ])
  await expect(f.writer.edit(doc, request, 'patch', f.binding)).resolves.toMatchObject({ changed: true, mode: 'patch' })
  expect(f.blocks.map(block => block.id)).toEqual(before.map(block => block.id))
  expect(f.blocks[1].text).toContain('修订方法。')
  expect(f.blocks[3].text).toContain('仍缺证据')
  expect(f.blocks[3].text).toContain('| 新方法 | 未报告 |')
  for (const index of [0, 2, 4, 5, 6, 7]) expect(f.blocks[index]).toEqual(before[index])
  expect(f.writes()).toBe(1)
  const retry = { ...request, expectedContentHash: (await f.read()).contentHash, expectedUpdated: '20261111120001' }
  await expect(createDocumentWriter(f.options).edit(doc, retry, 'patch', f.binding)).resolves.toMatchObject({ changed: false })
  expect(f.writes()).toBe(1)
  await expect(f.writer.edit(doc, { ...retry, changes: [{ type: 'text', section: '方法演进', find: '修订', replace: '另改' }] }, 'patch', f.binding)).rejects.toMatchObject({ code: 'operation_conflict' })
})

it('rejects protected content, out-of-section text, table restructuring and stale versions before dispatch', async () => {
  const f = await fixture(), before = await f.read()
  for (const changes of [
    [{ type: 'text', section: '局限', find: '人工定稿。', replace: '错误修改。' }],
    [{ type: 'text', section: '方法演进', find: '人工定稿。', replace: '越界。' }],
    [{ type: 'text', section: '比较', find: '未报告', replace: '擅改数值' }],
    [{ type: 'table-append', section: '比较', rows: [['多', '一', '列']] }],
    [{ type: 'table-cell', section: '比较', row: 0, column: 0, expected: '方法', value: '新表头' }],
    [{ type: 'text', section: '方法演进', find: '原方法。', replace: '## 新标题' }],
    [{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订。\n{: id="20261111120000-smuggle"}' }]
  ]) {
    const request = await f.request(changes)
    await expect(Promise.resolve().then(() => f.writer.edit(doc, request, 'patch', f.binding))).rejects.toBeDefined()
  }
  const request = await f.request([{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订。' }])
  await expect(f.writer.edit(doc, { ...request, expectedUpdated: 'old' }, 'patch', f.binding)).rejects.toMatchObject({ code: 'document_changed', message: '文档已更新，请重新读取。' })
  await expect(f.writer.edit(doc, { markdown: before.markdown.replace('人工定稿。', '擅改。'), expectedContentHash: before.contentHash }, 'replace', f.binding)).rejects.toMatchObject({ code: 'protected_content' })
  await expect(f.writer.edit(doc, { markdown: before.markdown.replace('未报告', '编造数值'), expectedContentHash: before.contentHash }, 'replace', f.binding)).rejects.toMatchObject({ code: 'protected_content' })
  expect(await f.read()).toEqual(before)
  expect(f.writes()).toBe(0)
})

it('detects edits made during patch planning and reconciles a lost successful acknowledgement', async () => {
  const f = await fixture(), request = await f.request([{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订。' }])
  f.setRace()
  await expect(f.writer.edit(doc, request, 'patch', f.binding)).rejects.toMatchObject({ code: 'document_changed' })
  expect(f.writes()).toBe(0)
  f.setDrop()
  const fresh = await f.request(request.changes)
  await expect(f.writer.edit(doc, fresh, 'patch', f.binding)).resolves.toMatchObject({ changed: true })
  await expect(createDocumentWriter(f.options).edit(doc, fresh, 'patch', f.binding)).resolves.toMatchObject({ changed: false })
  expect(f.writes()).toBe(1)
})

it('rejects a version-only change during planning even when the Markdown hash is unchanged', async () => {
  const f = await fixture(), request = await f.request([{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订。' }])
  f.setVersionRace()
  await expect(f.writer.edit(doc, request, 'patch', f.binding)).rejects.toMatchObject({ code: 'document_changed' })
  expect(f.writes()).toBe(0)
  expect(f.blocks[1].text).toContain('原方法。')
})

it('deduplicates append even after re-reading and restarting, with explicit new-step support', async () => {
  const f = await fixture(), before = await f.read()
  await f.writer.edit(doc, { markdown: '## 新材料\n\nTODO(证据缺失)：待补。', expectedContentHash: before.contentHash }, 'append', f.binding)
  await expect(createDocumentWriter(f.options).edit(doc, { markdown: '## 新材料\n\nTODO(证据缺失)：待补。', expectedContentHash: (await f.read()).contentHash }, 'append', f.binding)).resolves.toMatchObject({ changed: false })
  expect(f.writes()).toBe(1)
  await expect(f.writer.edit(doc, { markdown: '## 新材料\n\nTODO(证据缺失)：待补。', operationId: 'explicit-second-copy', expectedContentHash: (await f.read()).contentHash }, 'append', f.binding)).resolves.toMatchObject({ changed: true })
  expect(f.writes()).toBe(2)
})
