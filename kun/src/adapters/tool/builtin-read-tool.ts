import { createHash } from 'node:crypto'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { DEFAULT_LIST_LIMIT, type ListEntry } from './builtin-tool-types.js'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from './truncate.js'
import type { ReadLocalToolOptions, TextSlice } from './builtin-tool-types.js'
import { defaultLsLocalToolOperations, defaultReadLocalToolOperations } from './builtin-tool-operations.js'
import {
  formatDimensionNote,
  getReadClassification,
  isBinaryBuffer,
  listDirectoryWithOps,
  normalizePositiveInteger,
  resolveWorkspacePath,
  withToolBoundary
} from './builtin-tool-utils.js'

export function createReadLocalTool(options: ReadLocalToolOptions = {}): LocalTool {
  const statOp = options.operations?.stat ?? defaultReadLocalToolOperations.stat!
  const readdirOp = options.operations?.readdir ?? defaultLsLocalToolOperations.readdir!
  const readFileOp = options.operations?.readFile ?? defaultReadLocalToolOperations.readFile!
  const detectImageMimeTypeOp =
    options.operations?.detectImageMimeType ?? defaultReadLocalToolOperations.detectImageMimeType!
  const resizeImageOp = options.operations?.resizeImage
  const autoResizeImages = options.autoResizeImages ?? true
  return LocalToolHost.defineTool({
    name: 'read',
    description: 'Read a workspace file. If a directory path is supplied, summarize its entries so the caller can choose files to read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
        reason: {
          type: 'string',
          description: 'Optional justification to force one reread of an already-covered range.'
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    policy: 'auto',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      if (!rawPath.trim()) return { output: { error: 'path is required' }, isError: true }
      const { workspaceRoot, absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      const targetStat = await statOp(absolutePath)
      if (targetStat.isDirectory()) {
        const entryLimit = normalizePositiveInteger(args.limit, DEFAULT_LIST_LIMIT)
        const entries = await listDirectoryWithOps(absolutePath, workspaceRoot, false, entryLimit, statOp, readdirOp)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            kind: 'directory',
            entries: directoryEntriesForOutput(entries),
            names: entries.map((entry) => (entry.kind === 'directory' ? `${entry.name}/` : entry.name)),
            truncated: entries.length >= entryLimit,
            entry_limit_reached: entries.length >= entryLimit ? entryLimit : null,
            note: 'Path is a directory. Read a listed file path, or use find with a glob pattern to select files recursively.'
          }
        }
      }
      const fileBuffer = await readFileOp(absolutePath)
      const classification = getReadClassification(absolutePath, context.workspace)
      const image = detectImageMimeTypeOp(fileBuffer)
      if (image) {
        if (autoResizeImages && resizeImageOp) {
          const resized = await resizeImageOp(fileBuffer, image.mimeType)
          if (!resized) {
            return {
              output: {
                path: absolutePath,
                relative_path: relativePath,
                kind: 'image',
                mime_type: image.mimeType,
                width: image.width ?? null,
                height: image.height ?? null,
                byte_size: fileBuffer.length,
                note: `Read image file [${image.mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`,
                classification: classification ?? null
              }
            }
          }
          const dimensionNote = formatDimensionNote(resized)
          return {
            output: {
              path: absolutePath,
              relative_path: relativePath,
              kind: 'image',
              mime_type: resized.mimeType,
              width: resized.width,
              height: resized.height,
              byte_size: fileBuffer.length,
              data_base64: resized.dataBase64,
              note: dimensionNote
                ? `Read image file [${resized.mimeType}]\n${dimensionNote}`
                : `Read image file [${resized.mimeType}]`,
              classification: classification ?? null,
              resized: resized.wasResized === true
            }
          }
        }
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            kind: 'image',
            mime_type: image.mimeType,
            width: image.width ?? null,
            height: image.height ?? null,
            byte_size: fileBuffer.length,
            data_base64: fileBuffer.toString('base64'),
            note: `Read image file [${image.mimeType}]`,
            classification: classification ?? null
          }
        }
      }
      if (isBinaryBuffer(fileBuffer)) {
        return { output: { error: 'read only supports text files in SciForge Runtime serve mode', path: absolutePath }, isError: true }
      }
      const text = fileBuffer.toString('utf8').replace(/\r\n/g, '\n')
      const contentSha256 = createHash('sha256').update(fileBuffer).digest('hex')
      const allLines = text.split('\n')
      const offset = Math.max(1, normalizePositiveInteger(args.offset, 1))
      const effectiveMaxLines = options.maxLines ?? DEFAULT_MAX_LINES
      const effectiveMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
      const limit = normalizePositiveInteger(args.limit, effectiveMaxLines)
      const selected = allLines.slice(offset - 1, offset - 1 + limit).join('\n')
      const truncatedResult = truncateHead(selected, {
        maxLines: effectiveMaxLines,
        maxBytes: effectiveMaxBytes
      })
      const truncated: TextSlice = {
        text: truncatedResult.content,
        truncated: truncatedResult.truncated,
        totalLines: truncatedResult.totalLines,
        shownLines: truncatedResult.outputLines,
        totalBytes: truncatedResult.totalBytes,
        shownBytes: truncatedResult.outputBytes,
        firstLineExceedsLimit: truncatedResult.firstLineExceedsLimit,
        truncatedBy: truncatedResult.truncatedBy ?? undefined,
        lastLinePartial: truncatedResult.lastLinePartial
      }
      let content = truncated.text
      if (truncated.firstLineExceedsLimit) {
        content = `[first line exceeds ${formatSize(effectiveMaxBytes)} at line ${offset}. Use bash for a byte-limited slice of this line.]`
      } else if (truncated.truncated) {
        const endLine = Math.max(offset, offset + truncated.shownLines - 1)
        const nextOffset = endLine + 1
        if (truncated.truncatedBy === 'lines') {
          content = `${truncated.text}\n\n[showing lines ${offset}-${endLine} of ${allLines.length}. Use offset=${nextOffset} to continue.]`
        } else {
          content = `${truncated.text}\n\n[showing lines ${offset}-${endLine} of ${allLines.length} (${formatSize(effectiveMaxBytes)} limit). Use offset=${nextOffset} to continue.]`
        }
      } else if (limit !== undefined && offset - 1 + limit < allLines.length) {
        const nextOffset = offset + limit
        const remaining = allLines.length - (offset - 1 + limit)
        content = `${truncated.text}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
      }
      return {
        output: {
          path: absolutePath,
          relative_path: relativePath,
          content,
          content_sha256: contentSha256,
          classification: classification ?? null,
          start_line: offset,
          end_line: Math.max(offset, offset + truncated.shownLines - 1),
          total_lines: allLines.length,
          truncated: truncated.truncated,
          truncation_by: truncated.truncatedBy ?? null,
          first_line_exceeds_limit: truncated.firstLineExceedsLimit === true
        }
      }
    })
  })
}

export const createReadTool = createReadLocalTool
export const createReadToolDefinition = createReadLocalTool

function directoryEntriesForOutput(entries: ListEntry[]): Array<ListEntry & { display_name: string }> {
  return entries.map((entry) => ({
    ...entry,
    display_name: entry.kind === 'directory' ? `${entry.name}/` : entry.name
  }))
}
