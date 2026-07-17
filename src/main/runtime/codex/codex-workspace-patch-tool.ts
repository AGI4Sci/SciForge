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

type WorkspacePatchFailureClass =
  | 'invalid_arguments'
  | 'permission_denied'
  | 'stale_resource'
  | 'unsupported_target'
  | 'execution_error'

class WorkspacePatchError extends Error {
  readonly code: string
  readonly failureClass: WorkspacePatchFailureClass
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(input: {
    code: string
    message: string
    failureClass: WorkspacePatchFailureClass
    retryable: boolean
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = 'WorkspacePatchError'
    this.code = input.code
    this.failureClass = input.failureClass
    this.retryable = input.retryable
    this.details = input.details
  }
}

export class CodexWorkspacePatchTool {
  dynamicTools(): CodexAppServerDynamicToolSpec[] {
    return [{
      type: 'function',
      name: CODEX_WORKSPACE_APPLY_PATCH_TOOL_NAME,
      description:
        'Apply a unified diff to exactly one existing text file inside the current workspace. ' +
        'For changes spanning multiple files, call this tool once per file; multiple hunks for the same file are supported. ' +
        'Requires reading that file in the current turn and explicit user approval. ' +
        'Add, delete, rename, multi-file, ambiguous-context, and context-free patches are rejected. ' +
        'An exact retry succeeds idempotently without rewriting when the resulting changed and unchanged context can be verified uniquely.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative path of one existing text file.'
          },
          patch: {
            type: 'string',
            description:
              'Unified diff or *** Begin Patch / *** Update File patch for only the path file. ' +
              'Use exact current text read in this turn; include more unchanged context when a hunk is not unique.'
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
          text: result.applied
            ? `Applied ${result.hunks} hunk${result.hunks === 1 ? '' : 's'} to ${result.relativePath} (sha256 ${result.sha256.slice(0, 12)}).`
            : `Patch is already applied to ${result.relativePath} (sha256 ${result.sha256.slice(0, 12)}); no write was needed.`
        }],
        structuredContent: {
          ok: true,
          relativePath: result.relativePath,
          hunks: result.hunks,
          sha256: result.sha256,
          applied: result.applied
        },
        evidenceDelta: true,
        stateChanged: result.applied,
        resourceIdentity: result.canonicalPath
      }
    } catch (error) {
      return failedPatchResponse(error, input.path)
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

export async function workspaceFileSnapshot(input: {
  workspaceRoot: string
  path: string
}): Promise<{ canonicalPath: string; sha256: string }> {
  const target = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  const bytes = await readFile(target.absolutePath)
  return {
    canonicalPath: target.canonicalPath,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

async function applyWorkspacePatch(input: {
  workspaceRoot: string
  path: string
  patch: string
}): Promise<{ relativePath: string; canonicalPath: string; hunks: number; sha256: string; applied: boolean }> {
  if (!input.path.trim()) {
    throw patchError('patch_missing_path', 'path is required', 'invalid_arguments', true)
  }
  if (!input.patch.trim()) {
    throw patchError('patch_missing_content', 'patch is required', 'invalid_arguments', true)
  }
  if (Buffer.byteLength(input.patch, 'utf8') > MAX_PATCH_BYTES) {
    throw patchError(
      'patch_too_large',
      `patch exceeds the ${MAX_PATCH_BYTES}-byte limit`,
      'invalid_arguments',
      true,
      { maxBytes: MAX_PATCH_BYTES }
    )
  }
  const target = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  const hunks = parseSingleFilePatch(input.patch, target.relativePath)
  const originalBytes = await readFile(target.absolutePath)
  if (originalBytes.includes(0)) {
    throw patchError(
      'patch_unsupported_encoding',
      'gui_workspace_apply_patch only supports UTF-8 text files',
      'unsupported_target',
      false
    )
  }
  let original: string
  try {
    original = new TextDecoder('utf-8', { fatal: true }).decode(originalBytes)
  } catch {
    throw patchError(
      'patch_unsupported_encoding',
      'gui_workspace_apply_patch only supports valid UTF-8 text files',
      'unsupported_target',
      false
    )
  }
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = bom ? original.slice(1) : original
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const application = applyUniqueContextHunks(normalized, hunks, target.relativePath)
  const updated = application.content
  if (updated === normalized && !application.alreadyApplied) {
    throw patchError(
      'patch_no_changes',
      `patch produced no changes for ${target.relativePath}`,
      'invalid_arguments',
      true,
      { relativePath: target.relativePath }
    )
  }
  const output = bom + (lineEnding === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated)

  // Re-check the canonical target after parsing and immediately before the atomic replacement.
  const current = await resolveExistingWorkspaceTextFile(input.workspaceRoot, input.path)
  if (current.canonicalPath !== target.canonicalPath) {
    throw patchError(
      'patch_target_changed',
      'target changed while preparing the patch; read it again before retrying',
      'stale_resource',
      true
    )
  }
  const currentBytes = await readFile(current.absolutePath)
  if (!currentBytes.equals(originalBytes)) {
    throw patchError(
      'patch_target_changed',
      'target changed after it was inspected; read it again before retrying',
      'stale_resource',
      true
    )
  }
  if (application.alreadyApplied) {
    return {
      relativePath: current.relativePath,
      canonicalPath: current.canonicalPath,
      hunks: hunks.length,
      sha256: createHash('sha256').update(originalBytes).digest('hex'),
      applied: false
    }
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
    canonicalPath: current.canonicalPath,
    hunks: hunks.length,
    sha256: createHash('sha256').update(output).digest('hex'),
    applied: true
  }
}

async function resolveExistingWorkspaceTextFile(workspaceRoot: string, path: string): Promise<{
  absolutePath: string
  canonicalPath: string
  relativePath: string
}> {
  const root = await realpath(resolve(workspaceRoot)).catch(() => '')
  if (!root) {
    throw patchError(
      'patch_workspace_missing',
      'current workspace root does not exist',
      'stale_resource',
      false
    )
  }
  const rawPath = path.trim()
  if (!rawPath) throw patchError('patch_missing_path', 'path is required', 'invalid_arguments', true)
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath)
  const relativeCandidate = relative(root, absolutePath)
  if (!relativeCandidate || relativeCandidate === '.') {
    throw patchError(
      'patch_invalid_path',
      'path must name one existing workspace file',
      'invalid_arguments',
      true
    )
  }
  if (relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) {
    throw patchError(
      'patch_path_outside_workspace',
      'path must stay inside the current workspace',
      'permission_denied',
      false
    )
  }
  const linkInfo = await lstat(absolutePath).catch(() => null)
  if (!linkInfo) {
    throw patchError(
      'patch_target_missing',
      'gui_workspace_apply_patch only updates an existing file',
      'stale_resource',
      true
    )
  }
  if (linkInfo.isSymbolicLink()) {
    throw patchError(
      'patch_symlink_unsupported',
      'gui_workspace_apply_patch rejects symbolic-link targets',
      'unsupported_target',
      false
    )
  }
  if (!linkInfo.isFile()) {
    throw patchError(
      'patch_target_not_file',
      'gui_workspace_apply_patch requires one existing file',
      'unsupported_target',
      false
    )
  }
  const canonicalPath = await realpath(absolutePath)
  const canonicalRelative = relative(root, canonicalPath)
  if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) {
    throw patchError(
      'patch_path_outside_workspace',
      'path must stay inside the current workspace',
      'permission_denied',
      false
    )
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
      throw patchError(
        'patch_invalid_format',
        'patch must contain exactly one *** Update File section for an existing file',
        'invalid_arguments',
        true
      )
    }
    declaredPath = normalizePatchPath(update[1] ?? '')
    index += 1
  } else if (lines[index]?.startsWith('--- ')) {
    const oldPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    index += 1
    if (!lines[index]?.startsWith('+++ ')) {
      throw patchError(
        'patch_invalid_format',
        'unified diff is missing the +++ file header',
        'invalid_arguments',
        true
      )
    }
    const newPath = normalizeDiffHeaderPath(lines[index]!.slice(4))
    if (oldPath !== newPath) {
      throw patchError(
        'patch_rename_unsupported',
        'gui_workspace_apply_patch does not support renaming files',
        'invalid_arguments',
        false
      )
    }
    declaredPath = newPath
    index += 1
  }
  if (declaredPath && declaredPath !== expectedPath) {
    throw patchError(
      'patch_path_mismatch',
      `patch file header ${declaredPath} does not match path ${expectedPath}`,
      'invalid_arguments',
      true,
      { declaredPath, expectedPath }
    )
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
      throw patchError(
        'patch_multiple_files',
        'gui_workspace_apply_patch supports exactly one existing file per call; split the change into one call per file',
        'invalid_arguments',
        true
      )
    }
    const counts = customWrapper && line.startsWith('@@')
      ? null
      : parseHunkCounts(line)
    if (!(customWrapper ? line.startsWith('@@') : counts)) {
      throw patchError(
        'patch_invalid_format',
        `invalid unified diff hunk header: ${line}`,
        'invalid_arguments',
        true
      )
    }
    index += 1
    const oldLines: string[] = []
    const newLines: string[] = []
    while (index < lines.length) {
      const hunkLine = lines[index] ?? ''
      if (hunkLine.startsWith('@@') || (customWrapper && hunkLine.trim() === '*** End Patch')) break
      if (/^(?:\*\*\* (?:Update|Add|Delete|Move) File:|--- |\+\+\+ )/.test(hunkLine)) {
        throw patchError(
          'patch_multiple_files',
          'gui_workspace_apply_patch supports exactly one existing file per call; split the change into one call per file',
          'invalid_arguments',
          true
        )
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
        throw patchError(
          'patch_invalid_format',
          `invalid unified diff line in hunk: ${hunkLine}`,
          'invalid_arguments',
          true
        )
      }
      index += 1
    }
    if (oldLines.length === 0) {
      throw patchError(
        'patch_missing_context',
        'gui_workspace_apply_patch requires non-empty unique old context for every hunk',
        'invalid_arguments',
        true
      )
    }
    if (counts && (counts.oldCount !== oldLines.length || counts.newCount !== newLines.length)) {
      throw patchError(
        'patch_invalid_counts',
        'unified diff hunk line counts do not match the hunk header',
        'invalid_arguments',
        true
      )
    }
    hunks.push({ oldLines, newLines, ...(counts ?? {}) })
  }
  if (customWrapper && !sawWrapperEnd) {
    throw patchError('patch_invalid_format', 'patch is missing *** End Patch', 'invalid_arguments', true)
  }
  if (lines.slice(index).some((line) => line.trim())) {
    throw patchError('patch_invalid_format', 'unexpected content after patch end', 'invalid_arguments', true)
  }
  if (hunks.length === 0) {
    throw patchError(
      'patch_missing_hunks',
      'patch must contain at least one unified diff hunk',
      'invalid_arguments',
      true
    )
  }
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

function applyUniqueContextHunks(
  source: string,
  hunks: PatchHunk[],
  relativePath: string
): { content: string; alreadyApplied: boolean } {
  const lines = source.split('\n')
  try {
    let minimumIndex = 0
    for (const [hunkIndex, hunk] of hunks.entries()) {
      const matches = uniqueSequenceMatches(lines, hunk.oldLines, minimumIndex)
      if (matches.length === 0) {
        throw patchError(
          'patch_context_mismatch',
          `patch context mismatch for ${relativePath} at hunk ${hunkIndex + 1}; re-read the file and rebuild a smaller patch from its exact current text`,
          'stale_resource',
          true,
          { relativePath, hunk: hunkIndex + 1 }
        )
      }
      if (matches.length > 1) {
        throw patchError(
          'patch_context_ambiguous',
          `patch context is ambiguous for ${relativePath} at hunk ${hunkIndex + 1}; include more unchanged surrounding lines`,
          'invalid_arguments',
          true,
          { relativePath, hunk: hunkIndex + 1 }
        )
      }
      const matchIndex = matches[0]!
      lines.splice(matchIndex, hunk.oldLines.length, ...hunk.newLines)
      minimumIndex = matchIndex + hunk.newLines.length
    }
    return { content: lines.join('\n'), alreadyApplied: false }
  } catch (error) {
    if (
      error instanceof WorkspacePatchError &&
      error.code === 'patch_context_mismatch' &&
      patchAlreadyApplied(source, hunks)
    ) {
      return { content: source, alreadyApplied: true }
    }
    throw error
  }
}

function patchAlreadyApplied(source: string, hunks: PatchHunk[]): boolean {
  if (!hunks.some((hunk) => !sameLines(hunk.oldLines, hunk.newLines))) return false
  const lines = source.split('\n')
  let minimumIndex = 0
  for (const hunk of hunks) {
    const hasUnchangedAnchor = hunk.newLines.some((line) => hunk.oldLines.includes(line))
    const hasChangedResult = hunk.newLines.some((line) => !hunk.oldLines.includes(line))
    if (!hasUnchangedAnchor || !hasChangedResult) return false
    const matches = uniqueSequenceMatches(lines, hunk.newLines, minimumIndex)
    if (matches.length !== 1) return false
    minimumIndex = matches[0]! + hunk.newLines.length
  }
  return true
}

function uniqueSequenceMatches(lines: string[], sequence: string[], minimumIndex: number): number[] {
  const matches: number[] = []
  for (let candidate = minimumIndex; candidate <= lines.length - sequence.length; candidate += 1) {
    if (sequence.every((line, offset) => lines[candidate + offset] === line)) matches.push(candidate)
    if (matches.length > 1) break
  }
  return matches
}

function sameLines(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

function normalizeDiffHeaderPath(raw: string): string {
  const withoutTimestamp = raw.split('\t', 1)[0]?.trim() ?? ''
  if (!withoutTimestamp || withoutTimestamp === '/dev/null') {
    throw patchError(
      'patch_add_delete_unsupported',
      'gui_workspace_apply_patch rejects add/delete patches',
      'invalid_arguments',
      false
    )
  }
  return normalizePatchPath(withoutTimestamp.replace(/^[ab]\//, ''))
}

function normalizePatchPath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/\\/g, '/')
}

function patchError(
  code: string,
  message: string,
  failureClass: WorkspacePatchFailureClass,
  retryable: boolean,
  details?: Record<string, unknown>
): WorkspacePatchError {
  return new WorkspacePatchError({ code, message, failureClass, retryable, details })
}

function normalizeWorkspacePatchError(error: unknown): WorkspacePatchError {
  if (error instanceof WorkspacePatchError) return error
  return patchError(
    'patch_execution_error',
    error instanceof Error ? error.message : String(error),
    'execution_error',
    true
  )
}

function failedPatchResponse(error: unknown, path: string): CodexAppServerDynamicToolCallResponse {
  const normalized = normalizeWorkspacePatchError(error)
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: normalized.message }],
    structuredContent: {
      ok: false,
      relativePath: normalizePatchPath(path),
      error: {
        code: normalized.code,
        failureClass: normalized.failureClass,
        retryable: normalized.retryable,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {})
      }
    },
    errorCode: normalized.code,
    failureClass: normalized.failureClass,
    retryable: normalized.retryable,
    evidenceDelta: true,
    stateChanged: false
  }
}
