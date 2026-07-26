import { z } from 'zod'

export const WRITE_ASSIST_WORKER_VERSION = '0.1.0'
export const WRITE_ASSIST_WORKER_TRANSPORT = 'stdio'

export const WRITE_INDEX_STATS_RESOURCE_URI_TEMPLATE = 'write-index://workspace/{id}/stats'
export const PDF_TEXT_RESOURCE_URI_TEMPLATE = 'pdf://{path}/text'

export const WRITE_ASSIST_DEFAULT_MAX_SNIPPETS = 3
export const WRITE_ASSIST_MAX_SNIPPETS = 8
export const WRITE_ASSIST_DEFAULT_PDF_TEXT_CHARS = 32_000
export const WRITE_ASSIST_MAX_PDF_TEXT_CHARS = 200_000
export const WRITE_ASSIST_MAX_QUERY_CHARS = 20_000
export const WriteAssistToolNames = [
  'gui_write_retrieve_context',
  'gui_pdf_extract_text'
] as const

export type WriteAssistToolName = typeof WriteAssistToolNames[number]

export type WriteAssistErrorCode =
  | 'workspace_root_required'
  | 'workspace_root_not_found'
  | 'workspace_root_mismatch'
  | 'path_required'
  | 'path_not_found'
  | 'path_outside_workspace'
  | 'is_directory'
  | 'not_pdf'
  | 'binary_file'
  | 'file_too_large'
  | 'invalid_request'
  | 'index_not_found'
  | 'pdf_extract_failed'
  | 'read_failed'
  | 'aborted'

export type WriteAssistError = {
  code: WriteAssistErrorCode
  reason: string
  retryable: boolean
  suggestion: string
}

export type WriteAssistFailure = {
  ok: false
  error: WriteAssistError
}

export type WriteRetrievalSnippetLocation =
  | {
      kind: 'text'
      lineStart: number
      lineEnd: number
    }
  | {
      kind: 'pdf'
      pageStart: number
      pageEnd: number
    }

export type WriteRetrievalSnippet = {
  path: string
  title: string
  text: string
  score: number
  keywords: string[]
  location: WriteRetrievalSnippetLocation
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  resourceUri?: string
}

export type WriteIndexSkippedFiles = {
  binary: number
  tooLarge: number
  unreadable: number
  pdfFailed: number
}

export type WriteIndexStats = {
  workspaceRoot: string
  workspaceId: string
  includePdf: boolean
  builtAt: string
  expiresAt: string
  filesScanned: number
  indexedFiles: number
  indexedChunks: number
  skippedFiles: WriteIndexSkippedFiles
  resourceUri: string
}

export type WriteIndexStatsResult = WriteAssistFailure | {
  ok: true
  stats: WriteIndexStats
}

export type WriteRetrieveContextResult = WriteAssistFailure | {
  ok: true
  workspaceRoot: string
  workspaceId: string
  source: 'bm25-keyword'
  query: string
  keywords: string[]
  snippets: WriteRetrievalSnippet[]
  totalMatches: number
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
  indexedFiles: number
  indexedChunks: number
  summary: string
  stats: WriteIndexStats
  statsResourceUri: string
}

export type PdfTextPage = {
  page: number
  text?: string
  charStart: number
  charEnd: number
  truncated: boolean
}

export type PdfExtractTextResult = WriteAssistFailure | {
  ok: true
  workspaceRoot: string
  relativePath: string
  name: string
  mimeType: 'application/pdf'
  size: number
  mtimeMs: number
  pageCount: number
  pageStart: number
  pageEnd: number
  pages: PdfTextPage[]
  charsReturned: number
  hasText: boolean
  cursor?: string
  nextCursor?: string
  truncated: boolean
  summary: string
  resourceUri: string
}

export const WorkspaceRootInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4096)
    .describe('Workspace root. Omit when the managed worker already has a configured workspace.')
    .optional()
}).strict()

export type WriteAssistWorkerDiagnostics = {
  version: typeof WRITE_ASSIST_WORKER_VERSION
  transport: typeof WRITE_ASSIST_WORKER_TRANSPORT
  capabilities: WriteAssistToolName[]
}

export const WriteRetrieveContextInputSchema = WorkspaceRootInputSchema.extend({
  query: z.string().trim().min(1).max(WRITE_ASSIST_MAX_QUERY_CHARS),
  currentFilePath: z.string().trim().max(4096).optional(),
  maxSnippets: z.number().int().min(1).max(WRITE_ASSIST_MAX_SNIPPETS).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  includeCurrentFile: z.boolean().optional(),
  includePdf: z.boolean().optional(),
  summaryOnly: z.boolean().optional()
}).strict()

export const PdfExtractTextInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().min(1).max(4096),
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  maxChars: z.number().int().min(1).max(WRITE_ASSIST_MAX_PDF_TEXT_CHARS).optional(),
  summaryOnly: z.boolean().optional()
}).strict().refine(
  (value) => value.pageStart === undefined || value.pageEnd === undefined || value.pageEnd >= value.pageStart,
  'pageEnd must be greater than or equal to pageStart.'
)

export const WriteIndexStatsInputSchema = WorkspaceRootInputSchema

export type WriteRetrieveContextInput = z.infer<typeof WriteRetrieveContextInputSchema>
export type PdfExtractTextInput = z.infer<typeof PdfExtractTextInputSchema>
export type WriteIndexStatsInput = z.infer<typeof WriteIndexStatsInputSchema>

export function writeIndexStatsResourceUri(workspaceId: string): string {
  return `write-index://workspace/${encodeURIComponent(workspaceId)}/stats`
}

export function pdfTextResourceUri(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `pdf://${encodeURIComponent(normalized)}/text`
}
