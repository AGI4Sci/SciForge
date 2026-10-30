import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  PDF_TEXT_RESOURCE_URI_TEMPLATE,
  PdfExtractTextInputSchema,
  WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE,
  WriteRetrieveContextInputSchema,
  type PdfExtractTextResult,
  type WriteAssistFailure,
  type WriteIndexStatsResult,
  type WriteRetrieveContextResult
} from './contract.js'
import {
  createWriteAssistService,
  type WriteAssistService
} from './service.js'

type WriteAssistResult = WriteRetrieveContextResult | PdfExtractTextResult | WriteIndexStatsResult

type McpTextToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartWriteAssistMcpServerOptions = {
  transport?: Transport
}

export function createWriteAssistMcpServer(
  service: WriteAssistService = createWriteAssistService()
): McpServer {
  const server = new McpServer(
    { name: 'sciforge-write-assist', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_write_retrieve_context', {
    description: [
      'Retrieve read-only writing context from bounded workspace text and PDF indexes.',
      'Results are paginated with cursor/nextCursor; large index details are available as write-index://workspace/{id}/stats.'
    ].join(' '),
    inputSchema: WriteRetrieveContextInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async (args) => resultToToolResult(await service.retrieveContext(args), 'write context retrieval'))

  server.registerTool('gui_pdf_extract_text', {
    description: [
      'Extract bounded text from a workspace PDF with path guard, page filters, cursor pagination, and maxChars.',
      'Use pdf://{path}/text resources for repeat reads of the same bounded PDF text surface.',
      'This tool is text-only: extracted text is not evidence for figures, charts, equations, or page layout.'
    ].join(' '),
    inputSchema: PdfExtractTextInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async (args) => resultToToolResult(await service.extractPdfText(args), 'PDF text extraction'))

  server.registerResource('write-index-stats', new ResourceTemplate(WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE, {
    list: undefined
  }), {
    title: 'Write Index Stats',
    description: 'Bounded JSON statistics for a workspace write retrieval index.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const id = firstVariable(variables.id)
    return resourceJson(uri.toString(), await service.indexStatsByWorkspaceId(decodeResourcePart(id)))
  })

  server.registerResource('pdf-text', new ResourceTemplate(PDF_TEXT_RESOURCE_URI_TEMPLATE, {
    list: undefined
  }), {
    title: 'PDF Text',
    description: 'Bounded JSON PDF text extraction result for a PDF inside the configured workspace.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const path = decodeResourcePart(firstVariable(variables.path))
    return resourceJson(uri.toString(), await service.extractPdfTextResource(path))
  })

  return server
}

export async function startWriteAssistMcpServer(
  service: WriteAssistService = createWriteAssistService(),
  options: StartWriteAssistMcpServerOptions = {}
): Promise<void> {
  const server = createWriteAssistMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function resultToToolResult(
  result: WriteRetrieveContextResult | PdfExtractTextResult,
  label: string
): McpTextToolResult {
  if (!result.ok) return errorToolResult(result, label)
  return {
    content: [{ type: 'text', text: result.summary }],
    structuredContent: result as unknown as Record<string, unknown>
  }
}

function errorToolResult(result: WriteAssistFailure, label: string): McpTextToolResult {
  const { error } = result
  return {
    content: [{
      type: 'text',
      text: `${label} failed (${error.code}): ${error.reason} Suggestion: ${error.suggestion}`
    }],
    structuredContent: result,
    isError: true
  }
}

function resourceJson(uri: string, result: WriteAssistResult) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2)
    }]
  }
}

function firstVariable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function decodeResourcePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
