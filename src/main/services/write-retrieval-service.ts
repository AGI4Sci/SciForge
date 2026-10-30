import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import type {
  WriteRetrievalContext,
  WriteRetrievalRequest,
  WriteRetrievalSnippet
} from '../../shared/write-retrieval'
import { tokenizeWriteRetrievalText } from '../../../packages/workers/write-assist/src/service'
import type { WriteRetrieveContextResult } from '../../../packages/workers/write-assist/src/contract'
import { getWriteAssistService, resetWriteAssistService } from './write-assist-worker-service'

export type {
  WriteRetrievalContext,
  WriteRetrievalRequest,
  WriteRetrievalSnippet,
  WriteRetrievalSnippetLocation
} from '../../shared/write-retrieval'

const INLINE_QUERY_MAX_CHARS = 2_000
const DEFAULT_MAX_SNIPPETS = 3

export { tokenizeWriteRetrievalText }

export async function retrieveWriteInlineCompletionContext(
  request: WriteInlineCompletionRequest,
  options: { maxSnippets?: number } = {}
): Promise<WriteRetrievalContext | null> {
  const workspaceRoot = request.workspaceRoot?.trim()
  if (!workspaceRoot) return null

  const result = await getWriteAssistService().retrieveContext({
    workspaceRoot,
    query: inlineCompletionRetrievalQuery(request),
    currentFilePath: await workspaceRelativePath(workspaceRoot, request.currentFilePath),
    maxSnippets: boundedSnippetLimit(options.maxSnippets, 6),
    includeCurrentFile: false,
    includePdf: false
  })
  return contextFromWorkerResult(result)
}

export async function retrieveWriteContext(
  request: WriteRetrievalRequest
): Promise<WriteRetrievalContext | null> {
  const workspaceRoot = request.workspaceRoot?.trim()
  if (!workspaceRoot) return null

  const result = await getWriteAssistService().retrieveContext({
    workspaceRoot,
    query: request.query,
    currentFilePath: await workspaceRelativePath(workspaceRoot, request.currentFilePath),
    maxSnippets: boundedSnippetLimit(request.maxSnippets, 8),
    includeCurrentFile: request.includeCurrentFile !== false,
    includePdf: true
  })
  return contextFromWorkerResult(result)
}

export function clearWriteRetrievalCache(): void {
  resetWriteAssistService()
}

function contextFromWorkerResult(result: WriteRetrieveContextResult): WriteRetrievalContext | null {
  if (!result.ok || result.snippets.length === 0) return null
  return {
    source: result.source,
    query: result.query,
    keywords: result.keywords,
    snippets: result.snippets.map(sharedSnippet),
    indexedFiles: result.indexedFiles,
    indexedChunks: result.indexedChunks
  }
}

function sharedSnippet(snippet: WriteRetrievalSnippet): WriteRetrievalSnippet {
  return {
    path: snippet.path,
    title: snippet.title,
    text: snippet.text,
    score: snippet.score,
    keywords: snippet.keywords,
    location: snippet.location,
    ...(snippet.location.kind === 'text'
      ? { lineStart: snippet.location.lineStart, lineEnd: snippet.location.lineEnd }
      : { pageStart: snippet.location.pageStart, pageEnd: snippet.location.pageEnd })
  }
}

function inlineCompletionRetrievalQuery(request: WriteInlineCompletionRequest): string {
  return compactText([
    request.context.currentLinePrefix,
    request.context.previousNonEmptyLine,
    request.context.previousLine,
    request.editCandidate?.original ?? '',
    ...(request.recentEdits ?? []).flatMap((edit) => [edit.deletedText, edit.insertedText]),
    request.preview.documentTail,
    clipTail(request.prefix, 700)
  ].join(' ')).slice(0, INLINE_QUERY_MAX_CHARS)
}

function boundedSnippetLimit(value: number | undefined, max: number): number {
  return Math.max(1, Math.min(max, Math.round(value ?? DEFAULT_MAX_SNIPPETS)))
}

function compactText(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
}

function clipTail(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(source.length - maxChars)
}

async function workspaceRelativePath(workspaceRoot: string, path: string | undefined): Promise<string | undefined> {
  const value = path?.trim()
  if (!value || !isAbsolute(value)) return value || undefined
  const rel = relative(workspaceRoot, value)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return rel

  try {
    const [workspaceRealPath, targetRealPath] = await Promise.all([
      realpath(workspaceRoot),
      realpath(value)
    ])
    const canonicalRel = relative(workspaceRealPath, targetRealPath)
    return canonicalRel === '' || (!canonicalRel.startsWith('..') && !isAbsolute(canonicalRel))
      ? canonicalRel
      : value
  } catch {
    return value
  }
}
