import { describe, expect, it } from 'vitest'

import {
  COMPOSER_ATTACHMENT_ACCEPT,
  composerPickedAttachmentKind,
  composerWebDocumentMetadata
} from './composer-attachment-policy'

describe('composer attachment policy', () => {
  it('offers HTML and MHTML files in the attachment picker', () => {
    const accepted = new Set(COMPOSER_ATTACHMENT_ACCEPT.split(','))

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
    expect(composerPickedAttachmentKind({ name, type })).toBe('web-document')
  })

  it('assigns text metadata to HTML and archive metadata to MHTML', () => {
    expect(composerWebDocumentMetadata({ name: 'article.html' })).toEqual({
      kind: 'text',
      mimeType: 'text/html'
    })
    expect(composerWebDocumentMetadata({ name: 'saved-page.mhtml' })).toEqual({
      kind: 'file',
      mimeType: 'multipart/related'
    })
  })

  it('uses a recognized web-document MIME type only when the file has no conflicting extension', () => {
    expect(composerPickedAttachmentKind({ name: 'download', type: 'text/html' })).toBe('web-document')
    expect(composerPickedAttachmentKind({ name: 'download', type: 'application/x-mimearchive' })).toBe('web-document')
    expect(composerPickedAttachmentKind({ name: 'article.xhtml', type: 'text/html' })).toBe('unsupported')
    expect(composerWebDocumentMetadata({ name: 'article.xhtml' })).toBeNull()
  })
})
