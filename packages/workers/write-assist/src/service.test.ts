import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createWriteAssistService } from './service.js'

test('retrieves paginated write context from guarded temp workspace files', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'write-assist-retrieve-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(join(workspaceRoot, 'docs'), { recursive: true })
  await writeFile(join(workspaceRoot, 'docs', 'notes.md'), [
    '# Chlorophyll Notes',
    '',
    'Photosynthesis uses chlorophyll pigments to transfer solar energy into chemical energy.',
    'The retrieval context should find this note when the query mentions chlorophyll.'
  ].join('\n'), 'utf8')
  await writeFile(join(workspaceRoot, 'docs', 'outline.txt'), [
    'A second chlorophyll reference explains photosynthesis energy transfer in a different section.',
    'This gives pagination enough matching chunks for the write assist worker.'
  ].join('\n'), 'utf8')

  const service = createWriteAssistService()
  const first = await service.retrieveContext({
    workspaceRoot,
    query: 'chlorophyll photosynthesis energy transfer',
    maxSnippets: 1
  })

  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.snippets.length, 1)
  assert.ok(first.totalMatches >= 2)
  assert.equal(typeof first.nextCursor, 'string')
  assert.match(first.statsResourceUri, /^write-index:\/\/workspace\/.+\/stats$/)

  const second = await service.retrieveContext({
    workspaceRoot,
    query: 'chlorophyll photosynthesis energy transfer',
    maxSnippets: 1,
    cursor: first.nextCursor
  })
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.equal(second.snippets.length, 1)
  assert.notEqual(second.snippets[0]?.path, first.snippets[0]?.path)
})

test('extracts bounded PDF text with cursor pagination', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'write-assist-pdf-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(
    join(workspaceRoot, 'paper.pdf'),
    minimalPdf('Alpha PDF context about chlorophyll retrieval and workspace pagination.')
  )

  const service = createWriteAssistService()
  const first = await service.extractPdfText({
    workspaceRoot,
    path: 'paper.pdf',
    maxChars: 24
  })

  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.relativePath, 'paper.pdf')
  assert.equal(first.pageCount, 1)
  assert.match(first.pages[0]?.text ?? '', /Alpha PDF/)
  assert.equal(typeof first.nextCursor, 'string')

  const second = await service.extractPdfText({
    workspaceRoot,
    path: 'paper.pdf',
    cursor: first.nextCursor,
    maxChars: 80
  })
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.match(second.pages[0]?.text ?? '', /chlorophyll|retrieval|workspace/)
})

test('rejects path traversal and symlink escapes for PDF extraction', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'write-assist-guard-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })
  await writeFile(join(outsideRoot, 'secret.pdf'), minimalPdf('secret pdf text'))
  await symlink(join(outsideRoot, 'secret.pdf'), join(workspaceRoot, 'linked-secret.pdf'))

  const service = createWriteAssistService()
  const traversal = await service.extractPdfText({ workspaceRoot, path: '../outside/secret.pdf' })
  assert.equal(traversal.ok, false)
  if (traversal.ok) return
  assert.equal(traversal.error.code, 'path_outside_workspace')

  const symlinkRead = await service.extractPdfText({ workspaceRoot, path: 'linked-secret.pdf' })
  assert.equal(symlinkRead.ok, false)
  if (symlinkRead.ok) return
  assert.equal(symlinkRead.error.code, 'path_outside_workspace')
})

test('reports binary and oversized file boundaries without unbounded reads', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'write-assist-boundary-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'binary.md'), Buffer.from([0x66, 0x00, 0x67, 0x68]))
  await writeFile(join(workspaceRoot, 'huge.txt'), 'chlorophyll '.repeat(100), 'utf8')
  await writeFile(join(workspaceRoot, 'huge.pdf'), minimalPdf('small but over configured byte cap'))

  const service = createWriteAssistService({ maxTextFileBytes: 32, maxPdfBytes: 20 })
  const retrieval = await service.retrieveContext({
    workspaceRoot,
    query: 'chlorophyll',
    maxSnippets: 3
  })
  assert.equal(retrieval.ok, true)
  if (!retrieval.ok) return
  assert.equal(retrieval.stats.skippedFiles.binary, 1)
  assert.equal(retrieval.stats.skippedFiles.tooLarge >= 1, true)

  const pdf = await service.extractPdfText({ workspaceRoot, path: 'huge.pdf' })
  assert.equal(pdf.ok, false)
  if (pdf.ok) return
  assert.equal(pdf.error.code, 'file_too_large')
})

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`)
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
