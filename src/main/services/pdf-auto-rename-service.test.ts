import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
})
