import { dirname } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  firstChangedLine,
  generateDisplayDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom
} from './edit-diff.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import type {
  ApplyPatchLocalToolOptions,
  EditLocalToolOptions,
  WriteLocalToolOptions
} from './builtin-tool-types.js'
import { defaultEditLocalToolOperations, defaultWriteLocalToolOperations } from './builtin-tool-operations.js'
import { parseEditInstructions, resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { isHygienePlaceholderValue } from '../../shared/hygiene-placeholders.js'

export function createWriteLocalTool(_options: WriteLocalToolOptions = {}): LocalTool {
  const mkdirOp = _options.operations?.mkdir ?? defaultWriteLocalToolOperations.mkdir!
  const writeFileOp = _options.operations?.writeFile ?? defaultWriteLocalToolOperations.writeFile!
  return LocalToolHost.defineTool({
    name: 'write',
    description: 'Create or overwrite a workspace file with the provided content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      if (isHygienePlaceholderValue(args.content)) {
        return {
          output: {
            error:
              'refusing to write a request/cache-hygiene placeholder as file content; read the source or generate the real content before retrying'
          },
          isError: true
        }
      }
      const content = typeof args.content === 'string' ? args.content : null
      if (!rawPath.trim() || content == null) {
        return { output: { error: 'path and content are required' }, isError: true }
      }
      if (isHygienePlaceholderValue(content)) {
        return {
          output: {
            error:
              'refusing to write a request/cache-hygiene placeholder as file content; read the source or generate the real content before retrying'
          },
          isError: true
        }
      }
      const { absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        await mkdirOp(dirname(absolutePath))
        await writeFileOp(absolutePath, content)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            bytes_written: Buffer.byteLength(content, 'utf8')
          }
        }
      })
    })
  })
}

export const createWriteTool = createWriteLocalTool
export const createWriteToolDefinition = createWriteLocalTool

export function createEditLocalTool(_options: EditLocalToolOptions = {}): LocalTool {
  const readFileOp = _options.operations?.readFile ?? defaultEditLocalToolOperations.readFile!
  const writeFileOp = _options.operations?.writeFile ?? defaultEditLocalToolOperations.writeFile!
  return LocalToolHost.defineTool({
    name: 'edit',
    description: 'Edit a workspace file using exact text replacement. Supports multiple disjoint edits in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' }
            },
            required: ['oldText', 'newText'],
            additionalProperties: false
          }
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      if (editContainsHygienePlaceholderValue(args)) {
        return {
          output: {
            error:
              'refusing to insert a request/cache-hygiene placeholder into a file; read the source or generate the real replacement before retrying'
          },
          isError: true
        }
      }
      const edits = parseEditInstructions(args)
      if (!rawPath.trim() || edits.length === 0) {
        return { output: { error: 'path and at least one edit are required' }, isError: true }
      }
      const { absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        const rawSource = await readFileOp(absolutePath)
        const { bom, text: source } = stripBom(rawSource)
        const lineEnding = detectLineEnding(source)
        const normalizedSource = normalizeToLF(source)
        const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedSource, edits, relativePath)
        const next = bom + restoreLineEndings(newContent, lineEnding)
        await writeFileOp(absolutePath, next)
        const diff = generateDisplayDiff(baseContent, newContent)
        const patch = generateUnifiedPatch(relativePath, baseContent, newContent)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            replacements: edits.length,
            bytes_written: Buffer.byteLength(next, 'utf8'),
            diff,
            patch,
            first_changed_line: firstChangedLine(baseContent, newContent)
          }
        }
      })
    })
  })
}

export const createEditTool = createEditLocalTool
export const createEditToolDefinition = createEditLocalTool

type UnifiedPatchHunk = {
  oldStart?: number
  oldCount?: number
  oldLines: string[]
  newLines: string[]
}

export function createApplyPatchLocalTool(_options: ApplyPatchLocalToolOptions = {}): LocalTool {
  const readFileOp = _options.operations?.readFile ?? defaultEditLocalToolOperations.readFile!
  const writeFileOp = _options.operations?.writeFile ?? defaultEditLocalToolOperations.writeFile!
  return LocalToolHost.defineTool({
    name: 'apply_patch',
    description:
      'Apply a unified diff to one existing workspace file in-process. ' +
      'Pass path separately; optional file headers must name the same path. Never use a shell patch binary.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        patch: { type: 'string' }
      },
      required: ['path', 'patch'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      const patchText = typeof args.patch === 'string' ? args.patch : ''
      if (!rawPath.trim() || !patchText.trim()) {
        return { output: { error: 'path and patch are required' }, isError: true }
      }
      if (isHygienePlaceholderValue(patchText)) {
        return {
          output: {
            error:
              'refusing to apply a request/cache-hygiene placeholder as a patch; provide the real unified diff'
          },
          isError: true
        }
      }
      const { absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      const hunks = parseUnifiedPatch(patchText, relativePath)
      if (hunks.some((hunk) => hunk.newLines.some((line) => isHygienePlaceholderValue(line)))) {
        return {
          output: {
            error:
              'refusing to insert a request/cache-hygiene placeholder through apply_patch; provide the real content'
          },
          isError: true
        }
      }
      return withFileMutationQueue(absolutePath, async () => {
        const rawSource = await readFileOp(absolutePath)
        const { bom, text: source } = stripBom(rawSource)
        const lineEnding = detectLineEnding(source)
        const normalizedSource = normalizeToLF(source)
        const newContent = applyUnifiedPatchHunks(normalizedSource, hunks, relativePath)
        if (newContent === normalizedSource) {
          throw new Error(`patch produced no changes for ${relativePath}`)
        }
        const next = bom + restoreLineEndings(newContent, lineEnding)
        await writeFileOp(absolutePath, next)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            hunks: hunks.length,
            bytes_written: Buffer.byteLength(next, 'utf8'),
            diff: generateDisplayDiff(normalizedSource, newContent),
            patch: generateUnifiedPatch(relativePath, normalizedSource, newContent),
            first_changed_line: firstChangedLine(normalizedSource, newContent)
          }
        }
      })
    })
  })
}

export const createApplyPatchTool = createApplyPatchLocalTool
export const createApplyPatchToolDefinition = createApplyPatchLocalTool

function parseUnifiedPatch(patchText: string, relativePath: string): UnifiedPatchHunk[] {
  const normalized = normalizeToLF(patchText).replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  const patchPath = normalizePatchPath(relativePath)
  let index = 0
  let declaredPath: string | null = null
  let customWrapper = false

  if (lines[index]?.trim() === '*** Begin Patch') {
    customWrapper = true
    index += 1
    const update = lines[index]?.match(/^\*\*\* Update File:\s*(.+?)\s*$/)
    if (!update) {
      throw new Error('apply_patch supports exactly one *** Update File section for an existing file')
    }
    declaredPath = normalizePatchPath(update[1] ?? '')
    index += 1
  } else if (lines[index]?.startsWith('--- ')) {
    const oldPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    index += 1
    if (!lines[index]?.startsWith('+++ ')) {
      throw new Error('unified diff is missing the +++ file header')
    }
    const newPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    if (oldPath !== newPath) {
      throw new Error('apply_patch does not support renaming files')
    }
    declaredPath = newPath
    index += 1
  }

  if (declaredPath && declaredPath !== patchPath) {
    throw new Error(`patch file header ${declaredPath} does not match path ${patchPath}`)
  }

  const hunks: UnifiedPatchHunk[] = []
  while (index < lines.length) {
    const line = lines[index]
    if (customWrapper && line?.trim() === '*** End Patch') {
      index += 1
      break
    }
    if (!line?.trim()) {
      index += 1
      continue
    }
    if (/^\*\*\* (?:Update|Add|Delete|Move) File:/.test(line)) {
      throw new Error('apply_patch supports one existing file per call')
    }
    const header = customWrapper && line.startsWith('@@')
      ? { oldStart: undefined, oldCount: undefined, newCount: undefined }
      : (() => {
          const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
          return match ? {
            oldStart: Number(match[1]),
            oldCount: match[2] === undefined ? 1 : Number(match[2]),
            newCount: match[4] === undefined ? 1 : Number(match[4])
          } : null
        })()
    if (!header) throw new Error(`invalid unified diff hunk header: ${line}`)
    index += 1
    const oldLines: string[] = []
    const newLines: string[] = []
    while (index < lines.length) {
      const hunkLine = lines[index]!
      if (hunkLine.startsWith('@@') || (customWrapper && hunkLine.trim() === '*** End Patch')) break
      if (hunkLine === '' && index === lines.length - 1) {
        index += 1
        break
      }
      if (hunkLine === '\\ No newline at end of file') {
        index += 1
        continue
      }
      const marker = hunkLine[0]
      const content = hunkLine.slice(1)
      if (marker === ' ') {
        oldLines.push(content)
        newLines.push(content)
      } else if (marker === '-') {
        oldLines.push(content)
      } else if (marker === '+') {
        newLines.push(content)
      } else {
        throw new Error(`invalid unified diff line in hunk: ${hunkLine}`)
      }
      index += 1
    }
    if (oldLines.length === 0 && header.oldStart === undefined) {
      throw new Error('context-free insertion requires a standard hunk line number')
    }
    if (
      header.oldCount !== undefined &&
      (oldLines.length !== header.oldCount || newLines.length !== header.newCount)
    ) {
      throw new Error('unified diff hunk line counts do not match the hunk header')
    }
    hunks.push({
      ...(header.oldStart !== undefined ? { oldStart: header.oldStart } : {}),
      ...(header.oldCount !== undefined ? { oldCount: header.oldCount } : {}),
      oldLines,
      newLines
    })
  }
  if (customWrapper && lines.slice(index).some((line) => line.trim())) {
    throw new Error('unexpected content after *** End Patch')
  }
  if (hunks.length === 0) throw new Error('patch must contain at least one unified diff hunk')
  return hunks
}

function applyUnifiedPatchHunks(
  source: string,
  hunks: UnifiedPatchHunk[],
  relativePath: string
): string {
  const lines = source.split('\n')
  let minimumIndex = 0
  let lineDelta = 0
  for (const [hunkIndex, hunk] of hunks.entries()) {
    let matchIndex: number
    if (hunk.oldStart !== undefined) {
      matchIndex = (hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1) + lineDelta
      if (!linesMatchAt(lines, hunk.oldLines, matchIndex)) {
        throw new Error(`patch context mismatch for ${relativePath} at hunk ${hunkIndex + 1}`)
      }
    } else {
      const matches: number[] = []
      for (let candidate = minimumIndex; candidate <= lines.length - hunk.oldLines.length; candidate += 1) {
        if (linesMatchAt(lines, hunk.oldLines, candidate)) matches.push(candidate)
        if (matches.length > 1) break
      }
      if (matches.length === 0) {
        throw new Error(`patch context mismatch for ${relativePath} at hunk ${hunkIndex + 1}`)
      }
      if (matches.length > 1) {
        throw new Error(`patch context is ambiguous for ${relativePath} at hunk ${hunkIndex + 1}`)
      }
      matchIndex = matches[0]!
    }
    lines.splice(matchIndex, hunk.oldLines.length, ...hunk.newLines)
    minimumIndex = matchIndex + hunk.newLines.length
    lineDelta += hunk.newLines.length - hunk.oldLines.length
  }
  return lines.join('\n')
}

function linesMatchAt(source: string[], expected: string[], index: number): boolean {
  if (index < 0 || index + expected.length > source.length) return false
  return expected.every((line, offset) => source[index + offset] === line)
}

function normalizeDiffHeaderPath(raw: string): string {
  const withoutTimestamp = raw.split('\t', 1)[0]?.trim() ?? ''
  if (!withoutTimestamp || withoutTimestamp === '/dev/null') {
    throw new Error('apply_patch only supports updating an existing file')
  }
  return normalizePatchPath(withoutTimestamp.replace(/^[ab]\//, ''))
}

function normalizePatchPath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/\\/g, '/')
}

function editContainsHygienePlaceholderValue(args: Record<string, unknown>): boolean {
  if (isHygienePlaceholderValue(args.newText)) return true
  if (!Array.isArray(args.edits)) return false
  return args.edits.some((edit) => edit && typeof edit === 'object' && isHygienePlaceholderValue((edit as Record<string, unknown>).newText))
}
