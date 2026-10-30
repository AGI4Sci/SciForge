import { describe, expect, it } from 'vitest'

import {
  WORKSPACE_ATTACHMENT_ACCEPT,
  workspaceAttachmentKind,
  workspaceAttachmentMaxBytes,
  workspaceAttachmentMediaType,
  workspaceAttachmentDisplayName,
  workspaceWebDocumentMetadata
} from '@sciforge/domain-sdk/attachment-policy'

describe('composer attachment policy', () => {
  it('offers HTML and MHTML files in the attachment picker', () => {
    const accepted = new Set(WORKSPACE_ATTACHMENT_ACCEPT.split(','))

    expect(accepted.has('.html')).toBe(true)
    expect(accepted.has('.mhtml')).toBe(true)
    expect(accepted.has('text/html')).toBe(true)
    expect(accepted.has('multipart/related')).toBe(true)
  })

  it.each([
    ['article.html', 'text/html'],
    ['article.HTM', ''],
    ['saved-page.mhtml', 'multipart/related'],
    ['saved-page.MHT', 'application/x-mimearchive']
  ])('classifies %s as a web document', (name, type) => {
    expect(workspaceAttachmentKind({ name, type })).toBe('web-document')
  })

  it('assigns text metadata to HTML and archive metadata to MHTML', () => {
    expect(workspaceWebDocumentMetadata({ name: 'article.html' })).toEqual({
      kind: 'text',
      mimeType: 'text/html'
    })
    expect(workspaceWebDocumentMetadata({ name: 'saved-page.mhtml' })).toEqual({
      kind: 'file',
      mimeType: 'multipart/related'
    })
  })

  it('uses a recognized web-document MIME type only when the file has no conflicting extension', () => {
    expect(workspaceAttachmentKind({ name: 'download', type: 'text/html' })).toBe('web-document')
    expect(workspaceAttachmentKind({ name: 'download', type: 'application/x-mimearchive' })).toBe('web-document')
    expect(workspaceAttachmentKind({ name: 'article.xhtml', type: 'text/html' })).toBe('unsupported')
    expect(workspaceWebDocumentMetadata({ name: 'article.xhtml' })).toBeNull()
  })
  it.each(['csv', 'tsv', 'json', 'xlsx', 'parquet', 'txt', 'md', 'markdown', 'fasta'])(
    'offers and permits %s scientific files up to 100 MiB', extension => {
      const kind = workspaceAttachmentKind({ name: `data.${extension}`, type: 'application/octet-stream' })
      expect(kind).toBe('scientific')
      expect(WORKSPACE_ATTACHMENT_ACCEPT.split(',')).toContain(`.${extension}`)
      expect(workspaceAttachmentMaxBytes(kind)).toBe(100 * 1024 * 1024)
    }
  )
  it('preserves image and document limits and rejects executable/archive files', () => {
    expect(workspaceAttachmentMaxBytes('image')).toBe(32 * 1024 * 1024)
    expect(workspaceAttachmentMaxBytes('pdf')).toBe(64 * 1024 * 1024)
    expect(workspaceAttachmentMaxBytes('web-document')).toBe(64 * 1024 * 1024)
    expect(workspaceAttachmentKind({ name: 'data.zip', type: '' })).toBe('unsupported')
    expect(workspaceAttachmentKind({ name: 'tool.exe', type: '' })).toBe('unsupported')
  })

  it('derives media types and user-facing upload names without reading file content', () => {
    expect(workspaceAttachmentMediaType({ name: 'table.parquet' })).toBe('application/vnd.apache.parquet')
    expect(workspaceAttachmentMediaType({ name: 'table.xlsx' })).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(workspaceAttachmentMediaType({ name: 'figure.png' })).toBe('image/png')
    expect(workspaceAttachmentDisplayName('.sciforge/uploads/thread/20261021T010203-deadbeef-table.csv')).toBe('table.csv')
    expect(workspaceAttachmentDisplayName('data/20261021T010203-deadbeef-table.csv')).toBe('20261021T010203-deadbeef-table.csv')
  })

})
