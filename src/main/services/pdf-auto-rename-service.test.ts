import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  inferPdfTitleFromFirstPage,
  pdfTitleFileName,
  suggestWorkspacePdfName,
  usablePdfTitle
} from './pdf-auto-rename-service'

describe('PDF auto rename', () => {
  it('sanitizes paper titles into portable PDF filenames', () => {
    expect(pdfTitleFileName('Alpha/Beta: a "better" model?')).toBe(
      'Alpha - Beta - a - better - model.pdf'
    )
    expect(pdfTitleFileName('CON')).toBe('CON paper.pdf')
    expect(pdfTitleFileName('Safe\u202Ename')).toBe('Safe name.pdf')
    expect(usablePdfTitle('2603.10165v2', '2603.10165v2.pdf')).toBeNull()
  })

  it('infers a wrapped title from the largest text near the top of the first page', () => {
    const title = inferPdfTitleFromFirstPage([
      { str: 'Reliable Agents for', height: 22, transform: [22, 0, 0, 22, 90, 720] },
      { str: 'Scientific Discovery', height: 22, transform: [22, 0, 0, 22, 95, 690] },
      { str: 'Ada Researcher, Lin Scientist', height: 11, transform: [11, 0, 0, 11, 110, 645] },
      { str: 'Abstract', height: 13, transform: [13, 0, 0, 13, 72, 520] }
    ], 800)

    expect(title).toBe('Reliable Agents for Scientific Discovery')
  })

  it('uses embedded PDF title metadata when available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-pdf-rename-'))
    const workspaceRoot = join(root, 'workspace')
    try {
      await mkdir(workspaceRoot)
      const pdf = await PDFDocument.create()
      pdf.addPage()
      pdf.setTitle('Auditable Workflows for Scientific Agents')
      await writeFile(join(workspaceRoot, '2603.10165v2.pdf'), await pdf.save())

      const result = await suggestWorkspacePdfName({
        workspaceRoot,
        path: '2603.10165v2.pdf'
      })

      expect(result).toEqual({
        ok: true,
        title: 'Auditable Workflows for Scientific Agents',
        suggestedName: 'Auditable Workflows for Scientific Agents.pdf',
        source: 'metadata'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('inspects PDFs larger than the former 64 MiB limit without loading the whole file first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-pdf-rename-large-'))
    const workspaceRoot = join(root, 'workspace')
    try {
      await mkdir(workspaceRoot)
      const parts = [
        '%PDF-1.7\n',
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
        '4 0 obj\n<< /Title (Large-Scale Evidence Synthesis for Scientific Agents) >>\nendobj\n'
      ].map((value) => Buffer.from(value))
      const objectOffsets: number[] = []
      let offset = 0
      for (const part of parts) {
        objectOffsets.push(offset)
        offset += part.length
      }
      const paddingBytes = 65 * 1024 * 1024
      const streamHeader = Buffer.from(`5 0 obj\n<< /Length ${paddingBytes} >>\nstream\n`)
      objectOffsets.push(offset)
      offset += streamHeader.length + paddingBytes
      const streamFooter = Buffer.from('\nendstream\nendobj\n')
      offset += streamFooter.length
      const xrefOffset = offset
      const xrefEntries = objectOffsets
        .map((entryOffset) => `${entryOffset.toString().padStart(10, '0')} 00000 n \n`)
        .join('')
      const footer = Buffer.from(
        `xref\n0 6\n0000000000 65535 f \n${xrefEntries}` +
        `trailer\n<< /Size 6 /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
      )
      const targetPath = join(workspaceRoot, 'large-paper.pdf')
      const handle = await open(targetPath, 'w')
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

      const result = await suggestWorkspacePdfName({
        workspaceRoot,
        path: 'large-paper.pdf'
      })

      expect(result).toEqual({
        ok: true,
        title: 'Large-Scale Evidence Synthesis for Scientific Agents',
        suggestedName: 'Large-Scale Evidence Synthesis for Scientific Agents.pdf',
        source: 'metadata'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
