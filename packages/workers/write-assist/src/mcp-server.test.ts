import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  PDF_TEXT_RESOURCE_URI_TEMPLATE,
  WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE,
  pdfTextResourceUri
} from './contract.js'
import { createWriteAssistMcpServer } from './mcp-server.js'
import { createWriteAssistService } from './service.js'

test('serves write-assist tools and resources over MCP', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'write-assist-mcp-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'notes.md'), [
    '# Retrieval',
    '',
    'Chlorophyll retrieval context for MCP structured content and resource stats.'
  ].join('\n'), 'utf8')
  await writeFile(join(workspaceRoot, 'paper.pdf'), minimalPdf('MCP PDF text about chlorophyll extraction.'))
  await writeFile(join(tempRoot, 'outside.pdf'), minimalPdf('outside PDF text'))

  const service = createWriteAssistService({ workspaceRoot })
  const server = createWriteAssistMcpServer(service)
  const client = new Client({ name: 'write-assist-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'gui_pdf_extract_text',
    'gui_write_retrieve_context'
  ])

  const retrieval = await client.callTool({
    name: 'gui_write_retrieve_context',
    arguments: { workspaceRoot, query: 'chlorophyll retrieval', maxSnippets: 1 }
  })
  const structuredRetrieval = asRecord(retrieval.structuredContent)
  assert.equal(structuredRetrieval.ok, true)
  assert.equal(Array.isArray(structuredRetrieval.snippets), true)
  const statsUri = String(structuredRetrieval.statsResourceUri)

  const pdf = await client.callTool({
    name: 'gui_pdf_extract_text',
    arguments: { workspaceRoot, path: 'paper.pdf', maxChars: 80 }
  })
  const structuredPdf = asRecord(pdf.structuredContent)
  assert.equal(structuredPdf.ok, true)
  assert.match(JSON.stringify(structuredPdf), /MCP PDF text/)

  const failure = await client.callTool({
    name: 'gui_pdf_extract_text',
    arguments: { workspaceRoot, path: '../outside.pdf' }
  })
  assert.equal(failure.isError, true)
  const structuredFailure = asRecord(failure.structuredContent)
  assert.equal(structuredFailure.ok, false)
  assert.equal(asRecord(structuredFailure.error).code, 'path_outside_workspace')

  const templates = await client.listResourceTemplates()
  assert.deepEqual(templates.resourceTemplates.map((template) => template.uriTemplate).sort(), [
    PDF_TEXT_RESOURCE_URI_TEMPLATE,
    WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE
  ])

  const statsResource = await client.readResource({ uri: statsUri })
  const stats = JSON.parse(String(statsResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(stats.ok, true)
  assert.equal(asRecord(stats.stats).indexedFiles, 1)

  const pdfResource = await client.readResource({ uri: pdfTextResourceUri('paper.pdf') })
  const pdfJson = JSON.parse(String(pdfResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(pdfJson.ok, true)
  assert.match(JSON.stringify(pdfJson), /chlorophyll extraction/)

  const missingStatsResource = await client.readResource({ uri: 'write-index://workspace/missing/stats' })
  const missingStats = JSON.parse(String(missingStatsResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(missingStats.ok, false)
  assert.equal(asRecord(missingStats.error).code, 'index_not_found')

  const escapedPdfResource = await client.readResource({ uri: pdfTextResourceUri('../outside.pdf') })
  const escapedPdf = JSON.parse(String(escapedPdfResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(escapedPdf.ok, false)
  assert.equal(asRecord(escapedPdf.error).code, 'path_outside_workspace')
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

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
