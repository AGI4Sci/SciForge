import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  domainExternalNavigationIssuedTargetSchema,
  domainExternalNavigationIssueTargetInputSchema
} from './external-navigation.js'
import {
  domainRendererDownloadSelectionSchema,
  domainRendererPickDownloadDestinationInputSchema,
  domainRendererPickUploadSourceInputSchema,
  domainRendererUploadSelectionSchema
} from './file-transfer.js'

const transferHandle = `xfer_${'a'.repeat(32)}`
const portalHandle = `portal_${'b'.repeat(32)}`

describe('Host-owned resource grant contracts', () => {
  it('bounds renderer picker requests to one safe file name and byte limit', () => {
    assert.deepEqual(domainRendererPickUploadSourceInputSchema.parse({
      title: 'Choose a file',
      maxBytes: 1024
    }), { title: 'Choose a file', maxBytes: 1024 })
    for (const suggestedName of [
      '../secret.txt',
      'folder/secret.txt',
      'folder\\secret.txt',
      '.',
      '..',
      'control\nname.txt',
      '\nleading-control.txt',
      'trailing-control.txt\t'
    ]) {
      assert.throws(() => domainRendererPickDownloadDestinationInputSchema.parse({
        title: 'Save file',
        suggestedName
      }))
    }
    assert.throws(() => domainRendererPickUploadSourceInputSchema.parse({
      title: '',
      maxBytes: 1024
    }))
    assert.throws(() => domainRendererPickUploadSourceInputSchema.parse({
      title: 'Choose\na file',
      maxBytes: 1024
    }))
    assert.throws(() => domainRendererPickUploadSourceInputSchema.parse({
      title: '\tChoose a file',
      maxBytes: 1024
    }))
    assert.throws(() => domainRendererPickUploadSourceInputSchema.parse({
      title: 'Choose a file',
      maxBytes: 1_073_741_825
    }))
    assert.throws(() => domainRendererPickUploadSourceInputSchema.parse({
      title: 'Choose a file',
      maxBytes: 1024,
      path: '/private/tmp/forged'
    }))
  })

  it('keeps local paths and portal URLs out of renderer-safe results', () => {
    assert.throws(() => domainRendererUploadSelectionSchema.parse({
      cancelled: false,
      handle: transferHandle,
      name: 'paper.pdf',
      size: 100,
      path: '/private/tmp/paper.pdf'
    }))
    assert.throws(() => domainRendererDownloadSelectionSchema.parse({
      cancelled: false,
      handle: transferHandle,
      label: 'paper.pdf',
      path: '/private/tmp/paper.pdf'
    }))
    assert.throws(() => domainRendererUploadSelectionSchema.parse({
      cancelled: false,
      handle: transferHandle,
      name: 'unsafe\nname.pdf',
      size: 100
    }))
    assert.throws(() => domainRendererDownloadSelectionSchema.parse({
      cancelled: false,
      handle: transferHandle,
      label: 'folder\\paper.pdf'
    }))
    assert.throws(() => domainExternalNavigationIssuedTargetSchema.parse({
      handle: portalHandle,
      expiresAt: '2026-08-16T10:01:00.000Z',
      url: 'https://content.example/token-bearing-target'
    }))
    assert.throws(() => domainExternalNavigationIssueTargetInputSchema.parse({
      url: 'https://content.example/portal',
      expiresAt: 'ambiguous local time'
    }))
    assert.throws(() => domainExternalNavigationIssueTargetInputSchema.parse({
      url: 'https://content.example/portal',
      expiresAt: '2026-08-16T10:01:00.000Z',
      callerId: 'renderer-forged'
    }))
  })
})
