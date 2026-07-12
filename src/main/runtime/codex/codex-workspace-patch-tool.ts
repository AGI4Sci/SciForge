import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type {
  CodexAppServerDynamicToolCallRequest,
  CodexAppServerDynamicToolCallResponse,
  CodexAppServerDynamicToolSpec
} from './codex-dynamic-mcp-tools'

export const CODEX_WORKSPACE_APPLY_PATCH_TOOL_NAME = 'gui_workspace_apply_patch'

const MAX_PATCH_BYTES = 1_500_000

type PatchHunk = {
  oldLines: string[]
  newLines: string[]
  oldCount?: number
  newCount?: number
}

export class CodexWorkspacePatchTool {
  dynamicTools(): CodexAppServerDynamicToolSpec[] {
    return [{
      type: 'function',
      name: CODEX_WORKSPACE_APPLY_PATCH_TOOL_NAME,
      description:
        'Apply a unified diff to exactly one existing text file inside the current workspace. ' +
        'Requires reading that file in the current turn and explicit user approval. ' +
        'Add, delete, rename, multi-file, ambiguous-context, and context-free patches are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative path of one existing text file.'
          },
          patch: {
            type: 'string',
            description: 'Unified diff or *** Begin Patch / *** Update File patch for the same file.'
          }
        },
        required: ['path', 'patch'],
        additionalProperties: false
      }
    }]
  }

  canHandle(request: CodexAppServerDynamicToolCallRequest): boolean {
    return !request.namespace && request.tool.trim() === CODEX_WORKSPACE_APPLY_PATCH_TOOL_NAME
  }

  async apply(input: {
    workspaceRoot: string
    path: string
    patch: string
  }): Promise<CodexAppServerDynamicToolCallResponse> {
    try {
      const result = await applyWorkspacePatch(input)
      return {
        success: true,
        contentItems: [{
          type: 'inputText',
          text: `Applied ${result.hunks} hunk${result.hunks === 1 ? '' : 's'} to ${result.relativePath} (sha256 ${result.sha256.slice(0, 12)}).`
        }]
      }
    } catch (error) {
      return failedPatchResponse(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function canonicalWorkspaceFileKey(input: {
  workspaceRoot: string
  path: string
}): Promise<string> {
  const target = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  return target.canonicalPath
}

async function applyWorkspacePatch(input: {
  workspaceRoot: string
  path: string
  patch: string
}): Promise<{ relativePath: string; hunks: number; sha256: string }> {
  if (!input.path.trim()) throw new Error('path is required')
  if (!input.patch.trim()) throw new Error('patch is required')
  if (Buffer.byteLength(input.patch, 'utf8') > MAX_PATCH_BYTES) {
    throw new Error(`patch exceeds the ${MAX_PATCH_BYTES}-byte limit`)
  }
  const target = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  const hunks = parseSingleFilePatch(input.patch, target.relativePath)
  const originalBytes = await readFile(target.absolutePath)
  if (originalBytes.includes(0)) throw new Error('gui_workspace_apply_patch only supports UTF-8 text files')
  let original: string
  try {
    original = new TextDecoder('utf-8', { fatal: true }).decode(originalBytes)
  } catch {
    throw new Error('gui_workspace_apply_patch only supports valid UTF-8 text files')
  }
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = bom ? original.slice(1) : original
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const updated = applyUniqueContextHunks(normalized, hunks, target.relativePath)
  if (updated === normalized) throw new Error(`patch produced no changes for ${target.relativePath}`)
  const output = bom + (lineEnding === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated)

  // Re-check the canonical target after parsing and immediately before the atomic replacement.
  const current = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  if (current.canonicalPath !== target.canonicalPath) {
    throw new Error('target changed while preparing the patch; read it again before retrying')
  }
  const currentBytes = await readFile(current.absolutePath)
  if (!currentBytes.equals(originalBytes)) {
    throw new Error('target changed after it was inspected; read it again before retrying')
  }
  const mode = (await stat(current.absolutePath)).mode
  const tempPath = resolve(dirname(current.absolutePath), `.${randomUUID()}.sciforge-patch.tmp`)
  await mkdir(dirname(tempPath), { recursive: true })
  try {
    await writeFile(tempPath, output, { encoding: 'utf8', mode })
    await chmod(tempPath, mode)
    await rename(tempPath, current.absolutePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
  return {
    relativePath: current.relativePath,
    hunks: hunks.length,
    sha256: createHash('sha256').update(output).digest('hex')
  }
}

async function resolveExistingWorkspaceTextFile(workspaceRoot: string, path: string): Promise<{
  absolutePath: string
  canonicalPath: string
  relativePath: string
}> {
  const root = await realpath(resolve(workspaceRoot)).catch(() => '')
  if (!root) throw new Error('current workspace root does not exist')
  const rawPath = path.trim()
  if (!rawPath) throw new Error('path is required')
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath)
  const relativeCandidate = relative(root, absolutePath)
  if (!relativeCandidate || relativeCandidate === '.') throw new Error('path must name one existing workspace file')
  if (relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) {
    throw new Error('path must stay inside the current workspace')
  }
  const linkInfo = await lstat(absolutePath).catch(() => null)
  if (!linkInfo) throw new Error('gui_workspace_apply_patch only updates an existing file')
  if (linkInfo.isSymbolicLink()) throw new Error('gui_workspace_apply_patch rejects symbolic-link targets')
  if (!linkInfo.isFile()) throw new Error('gui_workspace_apply_patch requires one existing file')
  const canonicalPath = await realpath(absolutePath)
  const canonicalRelative = relative(root, canonicalPath)
  if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) {
    throw new Error('path must stay inside the current workspace')
  }
  return {
    absolutePath,
    canonicalPath,
    relativePath: normalizePatchPath(relativeCandidate)
  }
}

function parseSingleFilePatch(patchText: string, relativePath: string): PatchHunk[] {
  const normalized = patchText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const expectedPath = normalizePatchPath(relativePath)
  let index = 0
  let customWrapper = false
  let declaredPath: string | null = null

  if (lines[index]?.trim() === '*** Begin Patch') {
    customWrapper = true
    index += 1
    const update = lines[index]?.match(/^\*\*\* Update File:\s*(.+?)\s*$/)
    if (!update) {
      throw new Error('patch must contain exactly one *** Update File section for an existing file')
    }
    declaredPath = normalizePatchPath(update[1] ?? '')
    index += 1
  } else if (lines[index]?.startsWith('--- ')) {
    const oldPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    index += 1
    if (!lines[index]?.startsWith('+++ ')) throw new Error('unified diff is missing the +++ file header')
    const newPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    if (oldPath !== newPath) throw new Error('gui_workspace_apply_patch does not support renaming files')
    declaredPath = newPath
    index += 1
  }
  if (declaredPath && declaredPath !== expectedPath) {
    throw new Error(`patch file header ${declaredPath} does not match path ${expectedPath}`)
  }

  const hunks: PatchHunk[] = []
  let sawWrapperEnd = false
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (customWrapper && line.trim() === '*** End Patch') {
      sawWrapperEnd = true
      index += 1
      break
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    if (/^(?:\*\*\* (?:Update|Add|Delete|Move) File:|--- |\+\+\+ )/.test(line)) {
      throw new Error('gui_workspace_apply_patch supports exactly one existing file per call')
    }
    const counts = customWrapper && line.startsWith('@@')
      ? null
      : parseHunkCounts(line)
    if (!(customWrapper ? line.startsWith('@@') : counts)) {
      throw new Error(`invalid unified diff hunk header: ${line}`)
    }
    index += 1
    const oldLines: string[] = []
    const newLines: string[] = []
    while (index < lines.length) {
      const hunkLine = lines[index] ?? ''
      if (hunkLine.startsWith('@@') || (customWrapper && hunkLine.trim() === '*** End Patch')) break
      if (/^(?:\*\*\* (?:Update|Add|Delete|Move) File:|--- |\+\+\+ )/.test(hunkLine)) {
        throw new Error('gui_workspace_apply_patch supports exactly one existing file per call')
      }
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
    if (oldLines.length === 0) {
      throw new Error('gui_workspace_apply_patch requires non-empty unique old context for every hunk')
    }
    if (counts && (counts.oldCount !== oldLines.length || counts.newCount !== newLines.length)) {
      throw new Error('unified diff hunk line counts do not match the hunk header')
    }
    hunks.push({ oldLines, newLines, ...(counts ?? {}) })
  }
  if (customWrapper && !sawWrapperEnd) throw new Error('patch is missing *** End Patch')
  if (lines.slice(index).some((line) => line.trim())) throw new Error('unexpected content after patch end')
  if (hunks.length === 0) throw new Error('patch must contain at least one unified diff hunk')
  return hunks
}

function parseHunkCounts(line: string): { oldCount: number; newCount: number } | null {
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
  if (!match) return null
  return {
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  }
}

function applyUniqueContextHunks(source: string, hunks: PatchHunk[], relativePath: string): string {
  const lines = source.split('\n')
  let minimumIndex = 0
  for (const [hunkIndex, hunk] of hunks.entries()) {
    const matches: number[] = []
    for (let candidate = minimumIndex; candidate <= lines.length - hunk.oldLines.length; candidate += 1) {
      if (hunk.oldLines.every((line, offset) => lines[candidate + offset] === line)) matches.push(candidate)
      if (matches.length > 1) break
    }
    if (matches.length === 0) throw new Error(`patch context mismatch for ${relativePath} at hunk ${hunkIndex + 1}`)
    if (matches.length > 1) throw new Error(`patch context is ambiguous for ${relativePath} at hunk ${hunkIndex + 1}`)
    const matchIndex = matches[0]!
    lines.splice(matchIndex, hunk.oldLines.length, ...hunk.newLines)
    minimumIndex = matchIndex + hunk.newLines.length
  }
  return lines.join('\n')
}

function normalizeDiffHeaderPath(raw: string): string {
  const withoutTimestamp = raw.split('\t', 1)[0]?.trim() ?? ''
  if (!withoutTimestamp || withoutTimestamp === '/dev/null') {
    throw new Error('gui_workspace_apply_patch rejects add/delete patches')
  }
  return normalizePatchPath(withoutTimestamp.replace(/^[ab]\//, ''))
}

function normalizePatchPath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/\\/g, '/')
}

function failedPatchResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }]
  }
}
