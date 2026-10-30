import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  pdfMetadataTitleFileName,
  suggestPdfNameFromWorkspaceRead
} from './workspace-pdf-auto-rename'

describe('workspace PDF auto rename fallback', () => {
  it('creates a portable filename from embedded PDF metadata', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.setTitle('OpenClaw-RL: Train Any Agent Simply by Talking')
    const bytes = await pdf.save()
    const result = await suggestPdfNameFromWorkspaceRead({
      ok: true,
      kind: 'pdf',
      path: '/tmp/2603.10165v2.pdf',
      content: '',
      dataBase64: globalThis.btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join('')),
      mimeType: 'application/pdf',
      size: bytes.length,
      truncated: false,
      mtimeMs: 1,
      revision: 'revision-1'
    }, '2603.10165v2.pdf')

    expect(result).toMatchObject({
      ok: true,
      title: 'OpenClaw-RL: Train Any Agent Simply by Talking',
      source: 'metadata'
    })
    if (result.ok) expect(result.suggestedName).toBe('202603-Arxiv-OpenClaw-RL - Train Any Agent Simply by Talking.pdf')
  })

  it('sanitizes reserved names and invisible formatting characters', () => {
    expect(pdfMetadataTitleFileName('CON')).toBe('CON paper.pdf')
    expect(pdfMetadataTitleFileName('Safe\u202Ename')).toBe('Safe name.pdf')
  })
})
