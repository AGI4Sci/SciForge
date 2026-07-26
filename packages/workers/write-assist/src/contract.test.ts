import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PDF_TEXT_RESOURCE_URI_TEMPLATE,
  PdfExtractTextInputSchema,
  WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE,
  WriteRetrieveContextInputSchema,
  pdfTextResourceUri,
  writeIndexStatsResourceUri
} from './contract.js'

test('write-assist schemas reject unbounded inputs', () => {
  assert.equal(WriteRetrieveContextInputSchema.safeParse({ query: '' }).success, false)
  assert.equal(WriteRetrieveContextInputSchema.safeParse({ query: 'cells', maxSnippets: 99 }).success, false)
  assert.equal(PdfExtractTextInputSchema.safeParse({ path: '', maxChars: 10 }).success, false)
  assert.equal(PdfExtractTextInputSchema.safeParse({ path: 'paper.pdf', pageStart: 5, pageEnd: 2 }).success, false)
})

test('write-assist resource URI helpers keep path and workspace ids stable', () => {
  assert.equal(WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE, 'write-index://workspace/{id}/stats')
  assert.equal(PDF_TEXT_RESOURCE_URI_TEMPLATE, 'pdf://{path}/text')
  assert.equal(writeIndexStatsResourceUri('ws id'), 'write-index://workspace/ws%20id/stats')
  assert.equal(pdfTextResourceUri('papers/a file.pdf'), 'pdf://papers%2Fa%20file.pdf/text')
})
