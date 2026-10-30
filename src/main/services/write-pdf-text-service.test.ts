import { mkdir, mkdtemp, open, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearWritePdfTextCache, readWritePdfText } from './write-pdf-text-service'

function escapePdfText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function createSimpleTextPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    [
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'endobj\n'
    ].join('\n'),
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += 'xref\n0 6\n'
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

afterEach(() => {
  clearWritePdfTextCache()
})

describe('write PDF text service', () => {
  it('extracts page text from a text-layer PDF fixture', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-pdf-text-'))
    const pdfPath = join(workspaceRoot, 'papers', 'fixture.pdf')
    await mkdir(join(workspaceRoot, 'papers'), { recursive: true })
    await writeFile(pdfPath, createSimpleTextPdf('PDF BM25 keyword retrieval context'))

    const result = await readWritePdfText({
      workspaceRoot,
      path: 'papers/fixture.pdf'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(1)
    expect(result.hasText).toBe(true)
    expect(result.pages[0]).toMatchObject({
      page: 1,
      charStart: 0
    })
    expect(result.pages[0].text).toContain('PDF BM25 keyword retrieval context')
  })

  it('rejects path traversal and symlink escapes before extraction', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-pdf-guard-'))
    const workspaceRoot = join(tempRoot, 'workspace')
    const outsideRoot = join(tempRoot, 'outside')
    await mkdir(workspaceRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(outsideRoot, 'secret.pdf'), createSimpleTextPdf('outside secret'))
    await symlink(join(outsideRoot, 'secret.pdf'), join(workspaceRoot, 'linked-secret.pdf'))

    const traversal = await readWritePdfText({
      workspaceRoot,
      path: '../outside/secret.pdf'
    })
    expect(traversal.ok).toBe(false)

    const symlinkRead = await readWritePdfText({
      workspaceRoot,
      path: 'linked-secret.pdf'
    })
    expect(symlinkRead.ok).toBe(false)

  })

  it('extracts text from a PDF larger than the former 64 MiB limit', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-large-pdf-'))
    const largePdf = join(workspaceRoot, 'large.pdf')
    await writeLargePdf(largePdf, 'Unbounded PDF size with bounded text extraction')

    const result = await readWritePdfText({
      workspaceRoot,
      path: 'large.pdf'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pages[0]?.text).toContain('Unbounded PDF size')
  })
})

async function writeLargePdf(path: string, text: string): Promise<void> {
  const escaped = escapePdfText(text)
  const content = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
  const parts = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`
  ].map((value) => Buffer.from(value, 'latin1'))
  const objectOffsets: number[] = []
  let offset = 0
  for (const part of parts) {
    objectOffsets.push(offset)
    offset += part.length
  }
  const paddingBytes = 65 * 1024 * 1024
  const streamHeader = Buffer.from(`6 0 obj\n<< /Length ${paddingBytes} >>\nstream\n`)
  objectOffsets.push(offset)
  offset += streamHeader.length + paddingBytes
  const streamFooter = Buffer.from('\nendstream\nendobj\n')
  offset += streamFooter.length
  const xrefOffset = offset
  const xrefEntries = objectOffsets
    .map((entryOffset) => `${entryOffset.toString().padStart(10, '0')} 00000 n \n`)
    .join('')
  const footer = Buffer.from(
    `xref\n0 7\n0000000000 65535 f \n${xrefEntries}` +
    `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  )
  const handle = await open(path, 'w')
  try {
    for (const part of parts) await handle.write(part)
    await handle.write(streamHeader)
    const chunk = Buffer.alloc(1024 * 1024, 0x20)
    for (let written = 0; written < paddingBytes; written += chunk.length) {
      await handle.write(chunk)
    }
    await handle.write(streamFooter)
    await handle.write(footer)
  } finally {
    await handle.close()
  }
}
