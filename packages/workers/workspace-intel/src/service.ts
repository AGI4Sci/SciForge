import type { Dirent, Stats } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { access, lstat, mkdir, open as openFile, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path'

import {
  WORKSPACE_INTEL_DEFAULT_LIST_LIMIT,
  WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS,
  WORKSPACE_INTEL_DEFAULT_READ_BYTES,
  WORKSPACE_INTEL_MAX_LIST_LIMIT,
  WORKSPACE_INTEL_MAX_READ_BYTES,
  WORKSPACE_INTEL_MAX_TREE_DEPTH,
  VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  VisualCaptureBrokerResponseSchema,
  workspaceFileResourceUri,
  type VisualCaptureInput,
  type VisualCaptureResult,
  type VisualContextTarget,
  type VisibleContextComponent,
  type VisibleContextInput,
  type VisibleContextResource,
  type VisibleContextResult,
  type WorkspaceEntry,
  type WorkspaceEntryKind,
  type WorkspaceIntelError,
  type WorkspaceIntelErrorCode,
  type WorkspaceIntelFailure,
  type WorkspaceListInput,
  type WorkspaceListResult,
  type WorkspacePreviewInput,
  type WorkspacePreviewResult,
  type WorkspaceReadInput,
  type WorkspaceReadResult,
  type WorkspaceReference,
  type WorkspaceReferenceKind,
  type WorkspaceReferenceListInput,
  type WorkspaceReferenceListResult,
  type WorkspaceReferencePreviewInput,
  type WorkspaceReferencePreviewResult,
  type WorkspaceSkillListInput,
  type WorkspaceSkillListResult,
  type WorkspaceSkillReadInput,
  type WorkspaceSkillReadResult,
  type WorkspaceSkillScope,
  type WorkspaceSkillSummary,
  type WorkspaceTreeInput,
  type WorkspaceTreeNode,
  type WorkspaceTreeResult
} from './contract.js'
import {
  modelRouterVisualInspectorFromEnv,
  type VisualInspector
} from './visual-inspection.js'

export type WorkspaceIntelServiceOptions = {
  workspaceRoot?: string
  skillRoots?: string[]
  includeGlobalSkillRoots?: boolean
  visibleContextPath?: string
  visualCaptureTimeoutMs?: number
  visualCapturePollIntervalMs?: number
  visualInspector?: VisualInspector
  maxReadBytes?: number
  maxPreviewChars?: number
  maxListEntries?: number
}

type ResolvedTarget = {
  workspaceRoot: string
  absolutePath: string
  relativePath: string
  stats: Stats
  lstats: Stats
}

type SkillRoot = {
  path: string
  scope: WorkspaceSkillScope
}

type InternalSkill = {
  summary: WorkspaceSkillSummary
  packageRoot: string
  entryPath: string
  guardRoot: string
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage'
])

const MAX_SKILL_METADATA_BYTES = 64 * 1024
const DEFAULT_VISUAL_CAPTURE_TIMEOUT_MS = 15_000
const DEFAULT_VISUAL_CAPTURE_POLL_INTERVAL_MS = 40
const MIN_VISUAL_CAPTURE_TIMEOUT_MS = 100
const MAX_VISUAL_CAPTURE_TIMEOUT_MS = 25_000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const IMAGE_MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

const TEXT_MIME_BY_EXT = new Map([
  ['.c', 'text/plain; charset=utf-8'],
  ['.cc', 'text/plain; charset=utf-8'],
  ['.cpp', 'text/plain; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.go', 'text/plain; charset=utf-8'],
  ['.h', 'text/plain; charset=utf-8'],
  ['.hpp', 'text/plain; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.java', 'text/plain; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jsx', 'text/javascript; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.py', 'text/x-python; charset=utf-8'],
  ['.rs', 'text/plain; charset=utf-8'],
  ['.sh', 'text/x-shellscript; charset=utf-8'],
  ['.ts', 'text/typescript; charset=utf-8'],
  ['.tsx', 'text/typescript; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.yaml', 'application/yaml; charset=utf-8'],
  ['.yml', 'application/yaml; charset=utf-8']
])

export class WorkspaceIntelService {
  readonly workspaceRoot?: string
  readonly skillRoots: string[]
  readonly includeGlobalSkillRoots: boolean
  readonly visibleContextPath?: string
  readonly visualCaptureTimeoutMs: number
  readonly visualCapturePollIntervalMs: number
  readonly visualInspector?: VisualInspector
  readonly maxReadBytes: number
  readonly maxPreviewChars: number
  readonly maxListEntries: number

  constructor(options: WorkspaceIntelServiceOptions = {}) {
    this.workspaceRoot = cleanOptionalPath(options.workspaceRoot)
    this.skillRoots = uniqueStrings((options.skillRoots ?? []).map(cleanOptionalPath).filter(isPresent))
    this.includeGlobalSkillRoots = options.includeGlobalSkillRoots === true
    this.visibleContextPath = cleanOptionalPath(options.visibleContextPath)
    this.visualCaptureTimeoutMs = clampInteger(
      options.visualCaptureTimeoutMs ?? DEFAULT_VISUAL_CAPTURE_TIMEOUT_MS,
      MIN_VISUAL_CAPTURE_TIMEOUT_MS,
      MAX_VISUAL_CAPTURE_TIMEOUT_MS
    )
    this.visualCapturePollIntervalMs = clampInteger(
      options.visualCapturePollIntervalMs ?? DEFAULT_VISUAL_CAPTURE_POLL_INTERVAL_MS,
      5,
      1_000
    )
    this.visualInspector = options.visualInspector
    this.maxReadBytes = clampInteger(
      options.maxReadBytes ?? WORKSPACE_INTEL_DEFAULT_READ_BYTES,
      1,
      WORKSPACE_INTEL_MAX_READ_BYTES
    )
    this.maxPreviewChars = clampInteger(
      options.maxPreviewChars ?? WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS,
      1,
      WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS
    )
    this.maxListEntries = clampInteger(
      options.maxListEntries ?? WORKSPACE_INTEL_MAX_LIST_LIMIT,
      1,
      WORKSPACE_INTEL_MAX_LIST_LIMIT
    )
  }

  async listWorkspace(input: WorkspaceListInput = {}): Promise<WorkspaceListResult> {
    return this.captureFailure(async () => {
      const target = await this.resolveWorkspaceTarget(input.workspaceRoot, input.path)
      if (!target.stats.isDirectory()) {
        throw serviceError('not_directory', 'Target path is not a directory.', 'Use gui_workspace_read or gui_workspace_preview for files.')
      }

      const limit = this.limitFor(input.limit)
      const offset = decodeCursor(input.cursor)
      const depth = input.recursive
        ? clampInteger(input.depth ?? WORKSPACE_INTEL_MAX_TREE_DEPTH, 0, WORKSPACE_INTEL_MAX_TREE_DEPTH)
        : 0
      const entries = await this.collectEntries({
        workspaceRoot: target.workspaceRoot,
        startPath: target.absolutePath,
        depth,
        includeHidden: input.includeHidden === true,
        offset,
        limit
      })
      return {
        ok: true,
        workspaceRoot: target.workspaceRoot,
        root: await this.entryForPath(target.workspaceRoot, target.absolutePath, target.relativePath),
        entries: entries.page,
        limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(entries.nextCursor ? { nextCursor: entries.nextCursor } : {}),
        truncated: entries.truncated
      }
    })
  }

  async tree(input: WorkspaceTreeInput = {}): Promise<WorkspaceTreeResult> {
    return this.captureFailure(async () => {
      const target = await this.resolveWorkspaceTarget(input.workspaceRoot, input.path)
      if (!target.stats.isDirectory()) {
        throw serviceError('not_directory', 'Target path is not a directory.', 'Use workspace://file/{path} for files.')
      }

      const maxDepth = clampInteger(input.depth ?? 3, 0, WORKSPACE_INTEL_MAX_TREE_DEPTH)
      const maxEntries = this.limitFor(input.limit)
      const root = await this.entryForPath(target.workspaceRoot, target.absolutePath, target.relativePath)
      const state = {
        count: 0,
        truncated: false,
        visitedDirectories: new Set<string>([await canonicalPath(target.absolutePath)])
      }
      const tree = await this.populateTree({
        workspaceRoot: target.workspaceRoot,
        absolutePath: target.absolutePath,
        node: root,
        depth: 0,
        maxDepth,
        maxEntries,
        includeHidden: input.includeHidden === true,
        state
      })

      return {
        ok: true,
        workspaceRoot: target.workspaceRoot,
        tree,
        maxDepth,
        entryCount: state.count,
        truncated: state.truncated
      }
    })
  }

  async readFile(input: WorkspaceReadInput): Promise<WorkspaceReadResult> {
    return this.captureFailure(async () => {
      const target = await this.resolveWorkspaceTarget(input.workspaceRoot, input.path)
      if (target.stats.isDirectory()) {
        throw serviceError('is_directory', 'Cannot read a directory as a file.', 'Use gui_workspace_list or gui_workspace_preview for directories.')
      }

      const read = await readTextChunk(target.absolutePath, target.stats, {
        offset: input.offset,
        maxBytes: this.maxBytesFor(input.maxBytes)
      })
      return {
        ok: true,
        workspaceRoot: target.workspaceRoot,
        relativePath: target.relativePath,
        name: basename(target.relativePath || target.absolutePath),
        kind: 'text',
        mimeType: textMimeForPath(target.absolutePath),
        encoding: 'utf8',
        size: target.stats.size,
        mtimeMs: target.stats.mtimeMs,
        offset: read.offset,
        bytesRead: read.bytesRead,
        content: read.content,
        truncated: read.truncated,
        ...(read.nextOffset !== undefined ? { nextOffset: read.nextOffset } : {}),
        resourceUri: workspaceFileResourceUri(target.relativePath)
      }
    })
  }

  async preview(input: WorkspacePreviewInput = {}): Promise<WorkspacePreviewResult> {
    return this.captureFailure(async () => {
      const target = await this.resolveWorkspaceTarget(input.workspaceRoot, input.path)
      const name = basename(target.relativePath || target.absolutePath)
      if (target.stats.isDirectory()) {
        const listing = await this.listWorkspace({
          workspaceRoot: target.workspaceRoot,
          path: target.relativePath,
          limit: 80,
          includeHidden: false
        })
        if (!listing.ok) return listing
        return {
          ok: true,
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
          name,
          kind: 'directory',
          mtimeMs: target.stats.mtimeMs,
          contentSummary: `Directory with ${listing.entries.length}${listing.truncated ? '+' : ''} visible entr${listing.entries.length === 1 ? 'y' : 'ies'}.`,
          children: listing.entries,
          truncated: listing.truncated
        }
      }

      const ext = extname(target.absolutePath).toLowerCase()
      const imageMime = IMAGE_MIME_BY_EXT.get(ext)
      if (imageMime) {
        return {
          ok: true,
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
          name,
          kind: 'image',
          mimeType: imageMime,
          size: target.stats.size,
          mtimeMs: target.stats.mtimeMs,
          contentSummary: `Image ${target.relativePath} (${formatBytes(target.stats.size)}).`,
          truncated: false,
          resourceUri: workspaceFileResourceUri(target.relativePath)
        }
      }
      if (ext === '.pdf') {
        return {
          ok: true,
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
          name,
          kind: 'pdf',
          mimeType: 'application/pdf',
          size: target.stats.size,
          mtimeMs: target.stats.mtimeMs,
          contentSummary: `PDF ${target.relativePath} (${formatBytes(target.stats.size)}).`,
          truncated: false,
          resourceUri: workspaceFileResourceUri(target.relativePath)
        }
      }

      if (await isLikelyBinaryFile(target.absolutePath, target.stats)) {
        return {
          ok: true,
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
          name,
          kind: 'binary',
          size: target.stats.size,
          mtimeMs: target.stats.mtimeMs,
          contentSummary: `Binary file ${target.relativePath} (${formatBytes(target.stats.size)}); text content is omitted.`,
          truncated: false,
          resourceUri: workspaceFileResourceUri(target.relativePath)
        }
      }

      const maxChars = clampInteger(input.maxChars ?? this.maxPreviewChars, 1, this.maxPreviewChars)
      const read = await readTextChunk(target.absolutePath, target.stats, {
        maxBytes: Math.min(this.maxReadBytes, Math.max(maxChars * 4, 1024))
      })
      const content = read.content.slice(0, maxChars)
      const truncated = read.truncated || read.content.length > content.length
      return {
        ok: true,
        workspaceRoot: target.workspaceRoot,
        relativePath: target.relativePath,
        name,
        kind: 'text',
        mimeType: textMimeForPath(target.absolutePath),
        size: target.stats.size,
        mtimeMs: target.stats.mtimeMs,
        contentSummary: summarizeText(content, truncated),
        content,
        truncated,
        resourceUri: workspaceFileResourceUri(target.relativePath)
      }
    })
  }

  async referenceList(input: WorkspaceReferenceListInput = {}): Promise<WorkspaceReferenceListResult> {
    const listing = await this.listWorkspace({
      ...input,
      recursive: input.recursive ?? true
    })
    if (!listing.ok) return listing
    return {
      ok: true,
      workspaceRoot: listing.workspaceRoot,
      references: listing.entries.map(referenceFromEntry),
      limit: listing.limit,
      ...(listing.cursor ? { cursor: listing.cursor } : {}),
      ...(listing.nextCursor ? { nextCursor: listing.nextCursor } : {}),
      truncated: listing.truncated
    }
  }

  async referencePreview(input: WorkspaceReferencePreviewInput): Promise<WorkspaceReferencePreviewResult> {
    const preview = await this.preview(input)
    if (!preview.ok) return preview
    return {
      ok: true,
      workspaceRoot: preview.workspaceRoot,
      reference: referenceFromPreview(preview),
      preview: withoutWorkspaceRoot(preview)
    }
  }

  async listSkills(input: WorkspaceSkillListInput = {}): Promise<WorkspaceSkillListResult> {
    return this.captureFailure(async () => {
      const discovered = await this.discoverSkills(input.workspaceRoot)
      return {
        ok: true,
        ...(discovered.workspaceRoot ? { workspaceRoot: discovered.workspaceRoot } : {}),
        skills: discovered.skills.map((skill) => skill.summary),
        validationErrors: discovered.validationErrors
      }
    })
  }

  async readSkill(input: WorkspaceSkillReadInput): Promise<WorkspaceSkillReadResult> {
    return this.captureFailure(async () => {
      const discovered = await this.discoverSkills(input.workspaceRoot)
      const skill = discovered.skills.find((candidate) => candidate.summary.id === input.skillId)
      if (!skill) {
        throw serviceError('skill_not_found', `Skill not found: ${input.skillId}`, 'Call gui_workspace_skill_list and use one of the returned ids.')
      }
      const target = await resolvePathWithinRoot(skill.entryPath, skill.guardRoot, 'read_failed')
      const info = await stat(target)
      if (info.isDirectory()) {
        throw serviceError('is_directory', 'Skill entry is a directory.', 'Choose a skill with a readable SKILL.md or manifest entry.')
      }
      const read = await readTextChunk(target, info, {
        offset: input.offset,
        maxBytes: this.maxBytesFor(input.maxBytes)
      })
      return {
        ok: true,
        skill: skill.summary,
        content: read.content,
        size: info.size,
        truncated: read.truncated,
        ...(read.nextOffset !== undefined ? { nextOffset: read.nextOffset } : {})
      }
    })
  }

  async visibleContext(input: VisibleContextInput = {}): Promise<VisibleContextResult> {
    return this.captureFailure(async () => {
      if (!this.visibleContextPath) {
        return {
          ok: true,
          components: [],
          componentCount: 0,
          unavailable: true,
          message: 'No visible context snapshot path was configured for this worker.'
        }
      }

      const raw = await readFile(this.visibleContextPath, 'utf8').catch((error) => {
        if (isNodeErrorCode(error, 'ENOENT')) return ''
        throw error
      })
      if (!raw.trim()) {
        return {
          ok: true,
          snapshotPath: this.visibleContextPath,
          components: [],
          componentCount: 0,
          unavailable: true,
          message: 'No visible context snapshot has been published yet.'
        }
      }

      const snapshot = parseVisibleContextSnapshot(raw)
      const components = filterVisibleContextComponents(snapshot.components, input)
      return {
        ok: true,
        snapshotPath: this.visibleContextPath,
        ...(snapshot.windowId ? { windowId: snapshot.windowId } : {}),
        ...(snapshot.revision !== undefined ? { revision: snapshot.revision } : {}),
        ...(snapshot.publishedAt ? { publishedAt: snapshot.publishedAt } : {}),
        ...(snapshot.freshness ? { freshness: snapshot.freshness } : {}),
        ...(snapshot.activeThreadId !== undefined ? { activeThreadId: snapshot.activeThreadId } : {}),
        ...(snapshot.workspaceRoot ? { workspaceRoot: snapshot.workspaceRoot } : {}),
        ...(snapshot.route ? { route: snapshot.route } : {}),
        components,
        componentCount: components.length
      }
    })
  }

  async visualCapture(input: VisualCaptureInput): Promise<VisualCaptureResult> {
    return this.captureFailure(async () => {
      if (!this.visibleContextPath) {
        throw serviceError(
          'visual_capture_unavailable',
          'No visible context path was configured for visual capture.',
          'Launch the GUI-managed workspace-intel server before requesting a visual capture.'
        )
      }

      const brokerDirectory = join(dirname(this.visibleContextPath), 'capture-requests')
      const requestId = randomUUID()
      const requestPath = join(brokerDirectory, `${requestId}.request.json`)
      const responsePath = join(brokerDirectory, `${requestId}.response.json`)
      const now = Date.now()
      const request = {
        schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
        requestId,
        requestedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.visualCaptureTimeoutMs).toISOString(),
        scope: input.scope,
        ...(input.scope === 'target'
          ? { componentId: input.componentId, targetId: input.targetId }
          : {})
      }

      await mkdir(brokerDirectory, { recursive: true })
      await atomicWriteJson(requestPath, request)
      try {
        const response = await this.waitForVisualCaptureResponse(responsePath, requestId)
        if (!response.ok) {
          throw serviceError(
            visualCaptureErrorCode(response.error.code),
            response.error.message,
            'Refresh the visible context and retry with a currently published visual target.',
            response.error.retryable
          )
        }
        await validateVisualCaptureAsset(response.capture.path, this.visibleContextPath)
        const requireSemanticInspection = input.requireSemanticInspection !== false
        let inspection
        if (requireSemanticInspection) {
          if (!this.visualInspector) {
            throw serviceError(
              'visual_inspection_unavailable',
              'The screenshot was captured, but semantic visual inspection is unavailable.',
              'Configure the local SciForge Model Router vision translator and retry.'
            )
          }
          const inspected = await this.visualInspector({
            imagePath: response.capture.path,
            ...(input.inspectionPrompt ? { prompt: input.inspectionPrompt } : {}),
            ...(input.truthLockedElements ? { truthLockedElements: input.truthLockedElements } : {})
          })
          if (inspected.status !== 'inspected') {
            throw serviceError(
              inspected.status,
              inspected.message,
              'Check the Model Router vision translator health and retry.',
              true
            )
          }
          inspection = inspected
        }
        return {
          ok: true,
          requestId,
          resource: response.capture,
          ...(inspection ? { inspection } : {})
        }
      } finally {
        await Promise.all([
          rm(requestPath, { force: true }),
          rm(responsePath, { force: true })
        ])
      }
    })
  }

  private async waitForVisualCaptureResponse(responsePath: string, requestId: string) {
    const deadline = Date.now() + this.visualCaptureTimeoutMs
    while (Date.now() < deadline) {
      const raw = await readFile(responsePath, 'utf8').catch((error) => {
        if (isNodeErrorCode(error, 'ENOENT')) return ''
        throw error
      })
      if (raw) {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw) as unknown
        } catch (error) {
          throw serviceError('visual_capture_failed', `Visual capture response is invalid JSON: ${errorMessage(error)}`)
        }
        const response = VisualCaptureBrokerResponseSchema.safeParse(parsed)
        if (!response.success || response.data.requestId !== requestId) {
          throw serviceError('visual_capture_failed', 'Visual capture response failed contract validation.')
        }
        return response.data
      }
      await delay(this.visualCapturePollIntervalMs)
    }
    throw serviceError(
      'visual_capture_timeout',
      `Visual capture did not complete within ${this.visualCaptureTimeoutMs} ms.`,
      'Keep SciForge open with a visible target and retry.',
      true
    )
  }

  private async discoverSkills(inputWorkspaceRoot?: string): Promise<{
    workspaceRoot?: string
    skills: InternalSkill[]
    validationErrors: Array<{ root: string; message: string }>
  }> {
    const validationErrors: Array<{ root: string; message: string }> = []
    const roots = await this.skillSearchRoots(inputWorkspaceRoot)
    const workspaceRoot = roots.workspaceRoot
    const skills: InternalSkill[] = []

    for (const root of roots.roots) {
      const candidates = await skillPackageCandidates(root.path).catch((error) => {
        validationErrors.push({ root: root.path, message: errorMessage(error) })
        return []
      })
      for (const candidate of candidates) {
        const loaded = await loadSkill(candidate, root.path, root.scope, workspaceRoot).catch((error) => {
          validationErrors.push({ root: candidate, message: errorMessage(error) })
          return null
        })
        if (loaded) skills.push(loaded)
      }
    }

    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      skills: dedupeSkills(skills),
      validationErrors
    }
  }

  private async skillSearchRoots(inputWorkspaceRoot?: string): Promise<{ workspaceRoot?: string; roots: SkillRoot[] }> {
    let workspaceRoot: string | undefined
    if (inputWorkspaceRoot?.trim() || this.workspaceRoot) {
      workspaceRoot = await this.resolveWorkspaceRoot(inputWorkspaceRoot)
    } else if (this.skillRoots.length === 0) {
      throw serviceError('workspace_root_required', 'Workspace root is required.', 'Launch the worker with SCIFORGE_WORKSPACE_INTEL_ROOT or pass workspaceRoot.')
    }

    const roots: SkillRoot[] = []
    if (workspaceRoot) {
      roots.push(
        { path: join(workspaceRoot, '.codex', 'skills'), scope: 'project' },
        { path: join(workspaceRoot, '.agents', 'skills'), scope: 'project' },
        { path: join(workspaceRoot, 'skills'), scope: 'project' }
      )
    }
    roots.push(...this.skillRoots.map((path) => ({ path: expandHomePath(path), scope: 'configured' as const })))
    if (this.includeGlobalSkillRoots) {
      roots.push(
        { path: join(homedir(), '.agents', 'skills'), scope: 'configured' },
        { path: join(homedir(), '.sciforge', 'skills'), scope: 'configured' },
        { path: join(homedir(), '.codex', 'skills'), scope: 'configured' }
      )
    }

    const existing: SkillRoot[] = []
    for (const root of uniqueSkillRoots(roots)) {
      if (await isDirectory(root.path)) existing.push({ path: await canonicalPath(root.path), scope: root.scope })
    }
    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      roots: existing
    }
  }

  private async resolveWorkspaceRoot(inputWorkspaceRoot?: string): Promise<string> {
    const rawRoot = cleanOptionalPath(inputWorkspaceRoot) ?? this.workspaceRoot
    if (!rawRoot) {
      throw serviceError('workspace_root_required', 'Workspace root is required.', 'Launch the worker with SCIFORGE_WORKSPACE_INTEL_ROOT or pass workspaceRoot.')
    }
    const rootPath = resolve(expandHomePath(rawRoot))
    const canonicalRoot = await canonicalPath(rootPath).catch(() => {
      throw serviceError('workspace_root_not_found', `Workspace root not found: ${rawRoot}`, 'Choose an existing workspace directory.')
    })
    const info = await stat(canonicalRoot).catch(() => {
      throw serviceError('workspace_root_not_found', `Workspace root not found: ${rawRoot}`, 'Choose an existing workspace directory.')
    })
    if (!info.isDirectory()) {
      throw serviceError('workspace_root_not_found', `Workspace root is not a directory: ${rawRoot}`, 'Choose an existing workspace directory.')
    }

    if (this.workspaceRoot && inputWorkspaceRoot?.trim()) {
      const configuredRoot = await canonicalPath(resolve(expandHomePath(this.workspaceRoot)))
      if (!samePath(configuredRoot, canonicalRoot)) {
        throw serviceError('workspace_root_mismatch', 'Requested workspace root does not match the worker launch root.', 'Omit workspaceRoot or use the configured workspace.')
      }
    }

    return canonicalRoot
  }

  private async resolveWorkspaceTarget(inputWorkspaceRoot: string | undefined, inputPath: string | undefined): Promise<ResolvedTarget> {
    const workspaceRoot = await this.resolveWorkspaceRoot(inputWorkspaceRoot)
    const rawPath = cleanOptionalPath(inputPath) ?? ''
    const expanded = rawPath ? expandHomePath(normalizeUserPath(rawPath)) : ''
    const directPath = expanded
      ? isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceRoot, expanded)
      : workspaceRoot

    const canonicalTarget = await canonicalPath(directPath).catch(() => {
      throw serviceError('path_not_found', `Path not found: ${rawPath || '.'}`, 'Check the path and call gui_workspace_list to inspect available files.')
    })
    if (!isWithinRoot(workspaceRoot, canonicalTarget)) {
      throw serviceError('path_outside_workspace', 'Path must stay within the selected workspace.', 'Use a path relative to the workspace root.')
    }

    const stats = await stat(directPath).catch(() => {
      throw serviceError('path_not_found', `Path not found: ${rawPath || '.'}`, 'Check the path and call gui_workspace_list to inspect available files.')
    })
    const lstats = await lstat(directPath).catch(() => stats)
    return {
      workspaceRoot,
      absolutePath: directPath,
      relativePath: relativePathForDisplay(workspaceRoot, directPath, canonicalTarget),
      stats,
      lstats
    }
  }

  private async collectEntries(options: {
    workspaceRoot: string
    startPath: string
    depth: number
    includeHidden: boolean
    offset: number
    limit: number
  }): Promise<{ page: WorkspaceEntry[]; nextCursor?: string; truncated: boolean }> {
    const page: WorkspaceEntry[] = []
    const queue: Array<{ path: string; depth: number }> = [{ path: options.startPath, depth: 0 }]
    const visitedDirectories = new Set<string>()
    let seen = 0
    let truncated = false

    while (queue.length > 0 && !truncated) {
      const current = queue.shift()!
      const currentReal = await canonicalPath(current.path).catch(() => '')
      if (!currentReal || visitedDirectories.has(currentReal)) continue
      visitedDirectories.add(currentReal)

      const entries = await sortedDirectoryEntries(current.path, options.includeHidden)
      for (const dirent of entries) {
        const childPath = join(current.path, dirent.name)
        const entry = await this.entryForPath(options.workspaceRoot, childPath)
        if (seen >= options.offset) {
          if (page.length < options.limit) {
            page.push(entry)
          } else {
            truncated = true
            break
          }
        }
        seen += 1

        if (
          current.depth < options.depth &&
          entry.kind === 'directory' &&
          !dirent.isSymbolicLink() &&
          !DEFAULT_IGNORED_DIRS.has(entry.name)
        ) {
          queue.push({ path: childPath, depth: current.depth + 1 })
        }
      }
    }

    return {
      page,
      ...(truncated ? { nextCursor: String(options.offset + page.length) } : {}),
      truncated
    }
  }

  private async populateTree(options: {
    workspaceRoot: string
    absolutePath: string
    node: WorkspaceTreeNode
    depth: number
    maxDepth: number
    maxEntries: number
    includeHidden: boolean
    state: { count: number; truncated: boolean; visitedDirectories: Set<string> }
  }): Promise<WorkspaceTreeNode> {
    if (options.depth >= options.maxDepth || options.state.truncated) return options.node
    const children: WorkspaceTreeNode[] = []
    const entries = await sortedDirectoryEntries(options.absolutePath, options.includeHidden)

    for (const dirent of entries) {
      if (options.state.count >= options.maxEntries) {
        options.state.truncated = true
        options.node.childrenTruncated = true
        break
      }
      const childPath = join(options.absolutePath, dirent.name)
      const child = await this.entryForPath(options.workspaceRoot, childPath)
      options.state.count += 1
      if (
        child.kind === 'directory' &&
        !dirent.isSymbolicLink() &&
        !DEFAULT_IGNORED_DIRS.has(child.name)
      ) {
        const childReal = await canonicalPath(childPath).catch(() => '')
        if (childReal && !options.state.visitedDirectories.has(childReal)) {
          options.state.visitedDirectories.add(childReal)
          children.push(await this.populateTree({
            ...options,
            absolutePath: childPath,
            node: child,
            depth: options.depth + 1
          }))
          continue
        }
      }
      children.push(child)
    }

    if (children.length > 0) options.node.children = children
    return options.node
  }

  private async entryForPath(workspaceRoot: string, absolutePath: string, displayRelativePath?: string): Promise<WorkspaceEntry> {
    const lstats = await lstat(absolutePath)
    const name = basename(absolutePath)
    const relativePath = normalizePathSeparators(displayRelativePath ?? relativePathForDisplay(workspaceRoot, absolutePath))
    if (lstats.isSymbolicLink()) {
      const canonicalTarget = await canonicalPath(absolutePath).catch(() => '')
      const targetInsideWorkspace = Boolean(canonicalTarget && isWithinRoot(workspaceRoot, canonicalTarget))
      const targetStats = targetInsideWorkspace ? await stat(absolutePath).catch(() => undefined) : undefined
      const targetKind = targetStats ? entryKindForStats(targetStats) : undefined
      return {
        name,
        relativePath,
        kind: 'symlink',
        ...(targetKind ? { targetKind } : {}),
        targetInsideWorkspace,
        size: lstats.size,
        mtimeMs: lstats.mtimeMs,
        ...(targetInsideWorkspace && targetKind !== 'directory' ? { resourceUri: workspaceFileResourceUri(relativePath) } : {})
      }
    }

    const kind = entryKindForStats(lstats)
    return {
      name,
      relativePath,
      kind,
      ...(lstats.isFile() ? { size: lstats.size } : {}),
      mtimeMs: lstats.mtimeMs,
      ...(lstats.isFile() ? { mimeType: mimeForPath(absolutePath) } : {}),
      ...(lstats.isFile() ? { resourceUri: workspaceFileResourceUri(relativePath) } : {})
    }
  }

  private limitFor(inputLimit: number | undefined): number {
    return clampInteger(inputLimit ?? WORKSPACE_INTEL_DEFAULT_LIST_LIMIT, 1, this.maxListEntries)
  }

  private maxBytesFor(inputMaxBytes: number | undefined): number {
    return clampInteger(inputMaxBytes ?? this.maxReadBytes, 1, this.maxReadBytes)
  }

  private async captureFailure<T>(
    operation: () => Promise<T>
  ): Promise<T | WorkspaceIntelFailure> {
    try {
      return await operation()
    } catch (error) {
      return { ok: false, error: errorToWorkspaceIntelError(error) }
    }
  }
}

export function createWorkspaceIntelService(options: WorkspaceIntelServiceOptions = {}): WorkspaceIntelService {
  return new WorkspaceIntelService(options)
}

export function workspaceIntelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkspaceIntelServiceOptions {
  const skillRoots = parsePathList(env.SCIFORGE_WORKSPACE_INTEL_SKILL_ROOTS)
  const visualInspector = modelRouterVisualInspectorFromEnv(env)
  return {
    workspaceRoot: cleanOptionalPath(env.SCIFORGE_WORKSPACE_INTEL_ROOT) ?? cleanOptionalPath(env.SCIFORGE_WORKSPACE_PATH),
    ...(skillRoots.length > 0 ? { skillRoots } : {}),
    ...(cleanOptionalPath(env.SCIFORGE_VISIBLE_CONTEXT_PATH) ? { visibleContextPath: cleanOptionalPath(env.SCIFORGE_VISIBLE_CONTEXT_PATH) } : {}),
    ...(visualInspector ? { visualInspector } : {}),
    includeGlobalSkillRoots: env.SCIFORGE_WORKSPACE_INTEL_INCLUDE_GLOBAL_SKILLS === '1',
    ...(parsePositiveInteger(env.SCIFORGE_WORKSPACE_INTEL_MAX_READ_BYTES) ? { maxReadBytes: parsePositiveInteger(env.SCIFORGE_WORKSPACE_INTEL_MAX_READ_BYTES) } : {}),
    ...(parsePositiveInteger(env.SCIFORGE_WORKSPACE_INTEL_MAX_LIST_ENTRIES) ? { maxListEntries: parsePositiveInteger(env.SCIFORGE_WORKSPACE_INTEL_MAX_LIST_ENTRIES) } : {})
  }
}

async function readTextChunk(path: string, stats: Stats, options: {
  offset?: number
  maxBytes: number
}): Promise<{
  offset: number
  bytesRead: number
  content: string
  truncated: boolean
  nextOffset?: number
}> {
  if (await isLikelyBinaryFile(path, stats)) {
    throw serviceError('binary_file', 'This file appears to be binary; text content is omitted.', 'Use gui_workspace_preview for metadata only.')
  }

  const offset = clampInteger(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER)
  if (offset >= stats.size) {
    return { offset, bytesRead: 0, content: '', truncated: false }
  }
  const bytesToRead = Math.min(options.maxBytes, stats.size - offset)
  const handle = await openFile(path, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset)
    const nextOffset = offset + bytesRead
    const truncated = nextOffset < stats.size
    return {
      offset,
      bytesRead,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated,
      ...(truncated ? { nextOffset } : {})
    }
  } finally {
    await handle.close()
  }
}

async function isLikelyBinaryFile(path: string, stats: Stats): Promise<boolean> {
  if (stats.size === 0) return false
  const sampleSize = Math.min(stats.size, 4096)
  const handle = await openFile(path, 'r')
  try {
    const buffer = Buffer.alloc(sampleSize)
    const { bytesRead } = await handle.read(buffer, 0, sampleSize, 0)
    return isLikelyBinaryBuffer(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true
  if (buffer.length === 0) return false
  let suspicious = 0
  for (const byte of buffer) {
    const allowedControl = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13
    if (byte < 32 && !allowedControl) suspicious += 1
  }
  return suspicious / buffer.length > 0.08
}

async function sortedDirectoryEntries(path: string, includeHidden: boolean): Promise<Dirent[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => entry.name !== '.DS_Store')
    .filter((entry) => includeHidden || !entry.name.startsWith('.'))
    .sort(compareDirents)
}

function compareDirents(a: Dirent, b: Dirent): number {
  const aDirectory = a.isDirectory()
  const bDirectory = b.isDirectory()
  if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function referenceFromEntry(entry: WorkspaceEntry): WorkspaceReference {
  const kind = referenceKindForEntry(entry)
  return {
    name: entry.name,
    relativePath: entry.relativePath,
    kind,
    ...(entry.size !== undefined ? { size: entry.size } : {}),
    ...(entry.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {}),
    ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
    ...(entry.resourceUri ? { resourceUri: entry.resourceUri } : {})
  }
}

function referenceFromPreview(preview: Extract<WorkspacePreviewResult, { ok: true }>): WorkspaceReference {
  return {
    name: preview.name,
    relativePath: preview.relativePath,
    kind: preview.kind,
    ...(preview.size !== undefined ? { size: preview.size } : {}),
    ...(preview.mtimeMs !== undefined ? { mtimeMs: preview.mtimeMs } : {}),
    ...(preview.mimeType ? { mimeType: preview.mimeType } : {}),
    ...(preview.resourceUri ? { resourceUri: preview.resourceUri } : {})
  }
}

function withoutWorkspaceRoot(preview: Extract<WorkspacePreviewResult, { ok: true }>): Omit<Extract<WorkspacePreviewResult, { ok: true }>, 'workspaceRoot'> {
  const { workspaceRoot: _workspaceRoot, ...rest } = preview
  return rest
}

function referenceKindForEntry(entry: WorkspaceEntry): WorkspaceReferenceKind {
  if (entry.kind === 'directory') return 'directory'
  if (entry.kind === 'symlink') return 'symlink'
  if (entry.kind !== 'file') return 'other'
  const ext = extname(entry.relativePath).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_MIME_BY_EXT.has(ext)) return 'image'
  if (entry.mimeType?.startsWith('text/') || entry.mimeType?.includes('json') || entry.mimeType?.includes('yaml')) return 'text'
  return 'file'
}

async function skillPackageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (await pathExists(join(root, 'skill.json')) || await pathExists(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name)
    if (await pathExists(join(candidate, 'skill.json')) || await pathExists(join(candidate, 'SKILL.md'))) {
      candidates.add(candidate)
    }
  }
  return [...candidates]
}

async function loadSkill(packageRoot: string, guardRoot: string, scope: WorkspaceSkillScope, workspaceRoot?: string): Promise<InternalSkill | null> {
  const safePackageRoot = await resolvePathWithinRoot(packageRoot, guardRoot, 'read_failed')
  const manifestPath = join(safePackageRoot, 'skill.json')
  if (await pathExists(manifestPath)) {
    const manifest = JSON.parse(await readSkillMetadataText(manifestPath)) as Record<string, unknown>
    const name = stringValue(manifest.name) || titleFromSlug(basename(safePackageRoot))
    const entry = stringValue(manifest.entry) || 'SKILL.md'
    const entryPath = await resolvePathWithinRoot(resolve(safePackageRoot, normalizeUserPath(entry)), safePackageRoot, 'read_failed')
    const description = stringValue(manifest.description)
    return internalSkill({
      id: slug(stringValue(manifest.id) || name || basename(safePackageRoot)),
      name,
      description,
      scope,
      legacy: false,
      packageRoot: safePackageRoot,
      entryPath,
      guardRoot: safePackageRoot,
      workspaceRoot
    })
  }

  const entryPath = join(safePackageRoot, 'SKILL.md')
  if (!await pathExists(entryPath)) return null
  const content = await readSkillMetadataText(entryPath)
  const frontmatter = readFrontmatter(content)
  return internalSkill({
    id: slug(frontmatter.id || basename(safePackageRoot)),
    name: displaySkillName(frontmatter.name, basename(safePackageRoot)),
    description: frontmatter.description,
    scope,
    legacy: true,
    packageRoot: safePackageRoot,
    entryPath,
    guardRoot: safePackageRoot,
    workspaceRoot
  })
}

async function readSkillMetadataText(path: string): Promise<string> {
  const info = await stat(path)
  if (info.isDirectory()) {
    throw serviceError('is_directory', 'Skill metadata entry is a directory.', 'Choose a skill with a readable SKILL.md or skill.json file.')
  }
  const read = await readTextChunk(path, info, { maxBytes: MAX_SKILL_METADATA_BYTES })
  return read.content
}

function internalSkill(input: {
  id: string
  name: string
  description?: string
  scope: WorkspaceSkillScope
  legacy: boolean
  packageRoot: string
  entryPath: string
  guardRoot: string
  workspaceRoot?: string
}): InternalSkill {
  const packageRelativePath = input.workspaceRoot && isWithinRoot(input.workspaceRoot, input.packageRoot)
    ? normalizePathSeparators(relative(input.workspaceRoot, input.packageRoot))
    : undefined
  const entryRelativePath = input.workspaceRoot && isWithinRoot(input.workspaceRoot, input.entryPath)
    ? normalizePathSeparators(relative(input.workspaceRoot, input.entryPath))
    : undefined
  return {
    summary: {
      id: input.id,
      name: input.name,
      scope: input.scope,
      legacy: input.legacy,
      ...(input.description ? { description: input.description } : {}),
      ...(packageRelativePath ? { packageRelativePath } : {}),
      ...(entryRelativePath ? {
        entryRelativePath,
        entryResourceUri: workspaceFileResourceUri(entryRelativePath)
      } : {})
    },
    packageRoot: input.packageRoot,
    entryPath: input.entryPath,
    guardRoot: input.guardRoot
  }
}

function dedupeSkills(skills: InternalSkill[]): InternalSkill[] {
  const unique = new Map<string, InternalSkill>()
  for (const skill of skills.sort(compareSkills)) {
    if (!unique.has(skill.summary.id)) unique.set(skill.summary.id, skill)
  }
  return [...unique.values()]
}

function compareSkills(a: InternalSkill, b: InternalSkill): number {
  if (a.summary.scope !== b.summary.scope) return a.summary.scope === 'project' ? -1 : 1
  return a.summary.name.localeCompare(b.summary.name)
}

function readFrontmatter(content: string): { id?: string; name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { description: firstMarkdownParagraph(content) }
  const yaml = match[1] ?? ''
  return {
    id: frontmatterString(yaml, 'id'),
    name: frontmatterString(yaml, 'name'),
    description: frontmatterString(yaml, 'description') || firstMarkdownParagraph(content.slice(match[0].length))
  }
}

function frontmatterString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? stripQuotes(match[1] ?? '').trim() || undefined : undefined
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function displaySkillName(frontmatterName: string | undefined, folderName: string): string {
  const value = frontmatterName?.trim() ?? ''
  if (!value) return titleFromSlug(folderName)
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value) ? titleFromSlug(value) : value
}

function titleFromSlug(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

async function resolvePathWithinRoot(targetPath: string, root: string, code: WorkspaceIntelErrorCode): Promise<string> {
  const canonicalRoot = await canonicalPath(root)
  const canonicalTarget = await canonicalPath(targetPath)
  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    throw serviceError(code, 'Resolved path escapes its allowed root.', 'Use a path inside the allowed workspace or skill root.')
  }
  return canonicalTarget
}

async function canonicalPath(path: string): Promise<string> {
  return await realpath(path)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function validateVisualCaptureAsset(path: string, visibleContextPath: string): Promise<void> {
  const capturesRoot = await realpath(join(dirname(visibleContextPath), 'captures')).catch(() => '')
  const capturePath = await realpath(path).catch(() => '')
  if (!capturesRoot || !capturePath || !isWithinRoot(capturesRoot, capturePath)) {
    throw serviceError(
      'visual_capture_failed',
      'Visual capture response referenced an asset outside the managed capture directory.'
    )
  }
  const info = await stat(capturePath).catch(() => null)
  if (!info?.isFile()) {
    throw serviceError('visual_capture_failed', 'Visual capture response did not reference a readable file.')
  }
  const handle = await openFile(capturePath, 'r')
  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.byteLength)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
    if (bytesRead !== PNG_SIGNATURE.byteLength || !signature.equals(PNG_SIGNATURE)) {
      throw serviceError('visual_capture_failed', 'Visual capture asset is not a PNG image.')
    }
  } finally {
    await handle.close()
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function cleanOptionalPath(path: string | undefined): string | undefined {
  const value = path?.trim()
  return value ? value : undefined
}

function normalizeUserPath(raw: string): string {
  const trimmed = raw.trim().replace(/\0/g, '')
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) ? trimmed.slice(1, -1).trim() : trimmed
  return process.platform === 'win32' ? unquoted : unquoted.replace(/\\/g, '/')
}

function expandHomePath(raw: string): string {
  const value = raw.trim()
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b)
}

function comparablePath(path: string): string {
  const normalized = normalizePathSeparators(resolve(path)).replace(/\/+$/g, '')
  return process.platform === 'linux' ? normalized : normalized.toLowerCase()
}

function relativePathForDisplay(workspaceRoot: string, directPath: string, canonicalTarget?: string): string {
  const directRelative = relative(workspaceRoot, resolve(directPath))
  if (directRelative === '' || (!directRelative.startsWith('..') && !isAbsolute(directRelative))) {
    return normalizePathSeparators(directRelative)
  }
  return normalizePathSeparators(relative(workspaceRoot, canonicalTarget ?? directPath))
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

function entryKindForStats(stats: Stats): WorkspaceEntryKind {
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  return 'other'
}

function mimeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  return IMAGE_MIME_BY_EXT.get(ext) ?? textMimeForPath(path)
}

function textMimeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  return TEXT_MIME_BY_EXT.get(ext) ?? 'text/plain; charset=utf-8'
}

function summarizeText(content: string, truncated: boolean): string {
  const lines = content.split('\n').slice(0, 80)
  const summary = lines.join('\n').trim()
  return `${summary}${truncated ? '\n...[truncated]' : ''}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  if (!/^\d+$/.test(cursor)) {
    throw serviceError('invalid_request', 'Cursor must be an integer offset returned by a previous list call.', 'Use the nextCursor value unchanged.')
  }
  return Number(cursor)
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.floor(value), max))
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parsePathList(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return value.split(delimiter).map((item) => item.trim()).filter(Boolean)
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = comparablePath(expandHomePath(value))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function uniqueSkillRoots(roots: SkillRoot[]): SkillRoot[] {
  const seen = new Set<string>()
  const out: SkillRoot[] = []
  for (const root of roots) {
    const key = comparablePath(expandHomePath(root.path))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

type VisibleContextSnapshotRecord = {
  windowId?: string
  revision?: number
  publishedAt?: string
  freshness?: { stale: boolean; ageMs: number; staleAfterMs: number }
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
  components: VisibleContextComponent[]
}

function parseVisibleContextSnapshot(raw: string): VisibleContextSnapshotRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw serviceError('read_failed', `Visible context snapshot is not valid JSON: ${errorMessage(error)}`, 'Wait for the GUI to publish a fresh visible context snapshot.')
  }
  const record = recordValue(parsed)
  if (!record) {
    throw serviceError('read_failed', 'Visible context snapshot must be a JSON object.', 'Wait for the GUI to publish a fresh visible context snapshot.')
  }
  if (record.schemaVersion !== VISIBLE_CONTEXT_SCHEMA_VERSION) {
    throw serviceError(
      'read_failed',
      `Visible context snapshot schema version must be ${VISIBLE_CONTEXT_SCHEMA_VERSION}.`,
      'Wait for SciForge to publish a current visible context snapshot.'
    )
  }
  const windowId = stringValue(record.windowId)
  const revision = numberValue(record.revision)
  const publishedAt = stringValue(record.publishedAt)
  const declaredFreshness = recordValue(record.freshness)
  const staleAfterMs = numberValue(declaredFreshness?.staleAfterMs)
  if (
    !windowId || revision === undefined || !Number.isInteger(revision) || revision < 0 ||
    !publishedAt || !Number.isFinite(Date.parse(publishedAt)) ||
    staleAfterMs === undefined || !Number.isInteger(staleAfterMs) || staleAfterMs < 1 ||
    !Array.isArray(record.components)
  ) {
    throw serviceError(
      'read_failed',
      'Visible context snapshot does not satisfy the current snapshot contract.',
      'Wait for SciForge to publish a fresh visible context snapshot.'
    )
  }
  const parsedComponents = record.components.map(visibleContextComponentFromUnknown)
  if (parsedComponents.some((component) => component === undefined)) {
    throw serviceError(
      'read_failed',
      'Visible context snapshot contains an invalid component.',
      'Wait for SciForge to publish a fresh visible context snapshot.'
    )
  }
  const components = parsedComponents.filter(isPresent)
  const boundedStaleAfterMs = clampInteger(staleAfterMs, 1, 300_000)
  const ageMs = Math.max(0, Date.now() - Date.parse(publishedAt))
  return {
    windowId,
    revision,
    publishedAt,
    freshness: { stale: ageMs > boundedStaleAfterMs, ageMs, staleAfterMs: boundedStaleAfterMs },
    activeThreadId: record.activeThreadId === null ? null : stringValue(record.activeThreadId) || undefined,
    workspaceRoot: stringValue(record.workspaceRoot) || undefined,
    route: stringValue(record.route) || undefined,
    components
  }
}

function visibleContextComponentFromUnknown(value: unknown): VisibleContextComponent | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const id = stringValue(record.id)
  const region = stringValue(record.region)
  const component = stringValue(record.component)
  const updatedAt = stringValue(record.updatedAt)
  if (!id || !region || !component || !updatedAt) return undefined
  return {
    id,
    region,
    component,
    title: stringValue(record.title) || undefined,
    visible: record.visible !== false,
    priority: numberValue(record.priority),
    updatedAt,
    summary: stringValue(record.summary),
    resources: Array.isArray(record.resources)
      ? record.resources.map(visibleContextResourceFromUnknown).filter(isPresent)
      : undefined,
    visualTargets: Array.isArray(record.visualTargets)
      ? record.visualTargets.map(visualContextTargetFromUnknown).filter(isPresent)
      : undefined,
    state: recordValue(record.state) ?? undefined
  }
}

function visualContextTargetFromUnknown(value: unknown): VisualContextTarget | undefined {
  const record = recordValue(value)
  const id = stringValue(record?.id)
  const kind = stringValue(record?.kind)
  if (!record || !id || !['component', 'document-page', 'region', 'window'].includes(kind)) return undefined
  const bounds = recordValue(record.bounds)
  const width = numberValue(bounds?.width)
  const height = numberValue(bounds?.height)
  return {
    id,
    kind: kind as VisualContextTarget['kind'],
    contentType: stringValue(record.contentType) || undefined,
    ...(bounds && width !== undefined && width > 0 && height !== undefined && height > 0
      ? {
          bounds: {
            x: numberValue(bounds.x) ?? 0,
            y: numberValue(bounds.y) ?? 0,
            width,
            height
          }
        }
      : {}),
    page: numberValue(record.page),
    active: typeof record.active === 'boolean' ? record.active : undefined,
    metadata: recordValue(record.metadata) ?? undefined
  }
}

function visibleContextResourceFromUnknown(value: unknown): VisibleContextResource | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const kind = stringValue(record.kind)
  if (!kind) return undefined
  return {
    kind,
    role: stringValue(record.role) || undefined,
    title: stringValue(record.title) || undefined,
    accessHint: stringValue(record.accessHint) || undefined,
    resourceUri: stringValue(record.resourceUri) || undefined,
    workspaceRoot: stringValue(record.workspaceRoot) || undefined,
    path: stringValue(record.path) || undefined,
    relativePath: stringValue(record.relativePath) || undefined,
    name: stringValue(record.name) || undefined,
    mimeType: stringValue(record.mimeType) || undefined,
    fileKind: stringValue(record.fileKind) || undefined,
    size: numberValue(record.size),
    mtimeMs: numberValue(record.mtimeMs),
    annotationCount: numberValue(record.annotationCount),
    threadCount: numberValue(record.threadCount),
    openThreadCount: numberValue(record.openThreadCount),
    selectedThreadId: record.selectedThreadId === null ? null : stringValue(record.selectedThreadId) || undefined,
    updatedAt: stringValue(record.updatedAt) || undefined,
    metadata: recordValue(record.metadata) ?? undefined
  }
}

function filterVisibleContextComponents(
  components: VisibleContextComponent[],
  input: VisibleContextInput
): VisibleContextComponent[] {
  return components.filter((component) => {
    if (!input.includeHidden && !component.visible) return false
    if (input.region && component.region !== input.region) return false
    if (input.componentId && component.id !== input.componentId) return false
    return true
  })
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

class WorkspaceIntelServiceError extends Error {
  readonly code: WorkspaceIntelErrorCode
  readonly retryable: boolean
  readonly suggestedFix?: string

  constructor(code: WorkspaceIntelErrorCode, message: string, suggestedFix?: string, retryable = false) {
    super(message)
    this.name = 'WorkspaceIntelServiceError'
    this.code = code
    this.retryable = retryable
    this.suggestedFix = suggestedFix
  }
}

function serviceError(
  code: WorkspaceIntelErrorCode,
  message: string,
  suggestedFix?: string,
  retryable = false
): WorkspaceIntelServiceError {
  return new WorkspaceIntelServiceError(code, message, suggestedFix, retryable)
}

function errorToWorkspaceIntelError(error: unknown): WorkspaceIntelError {
  if (error instanceof WorkspaceIntelServiceError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.suggestedFix ? { suggestedFix: error.suggestedFix } : {})
    }
  }
  return {
    code: 'read_failed',
    message: errorMessage(error),
    retryable: false,
    suggestedFix: 'Check that the file exists and is readable.'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function visualCaptureErrorCode(code: string): WorkspaceIntelErrorCode {
  switch (code) {
    case 'invalid_visual_capture_request':
    case 'stale_visible_context':
    case 'visual_target_not_found':
    case 'visual_target_bounds_unavailable':
    case 'visual_capture_request_expired':
    case 'visual_capture_broker_failed':
    case 'visual_capture_failed':
      return code
    default:
      return 'visual_capture_failed'
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code)
}
