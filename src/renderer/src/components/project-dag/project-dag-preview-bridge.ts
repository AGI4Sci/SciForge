import type {
  WorkspaceFileResolveResult,
  WorkspaceFileTarget
} from '@shared/workspace-file'
import type { WorkspacePreviewAnchor } from '@shared/workspace-preview'
import {
  previewWorkspaceFile,
  type WorkspaceFilePreviewDetail
} from '../../lib/workspace-file-preview'

export const PROJECT_DAG_PREVIEW_REQUEST = 'sciforge.project-dag.preview-workspace-evidence'
export const PROJECT_DAG_PREVIEW_RESULT = 'sciforge.project-dag.preview-workspace-evidence-result'

export type ProjectDagPreviewRequest = {
  type: typeof PROJECT_DAG_PREVIEW_REQUEST
  version: 1
  requestId: string
  locator: string
  artifactId?: string
  artifactVersionId?: string
  sourceAnchorId?: string
  anchor?: WorkspacePreviewAnchor
  claim: {
    id: string
    statement?: string
    snapshotDigest?: string
  }
}

type ProjectDagPreviewTarget = WorkspaceFilePreviewDetail & {
  anchor?: WorkspacePreviewAnchor
  returnTo: {
    kind: 'project-dag'
    label: string
    claimId: string
  }
}

type Resolver = (target: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>

export type ProjectDagPreviewBridgeResult =
  | { status: 'ignored' }
  | { status: 'opened'; target: ProjectDagPreviewTarget }
  | { status: 'rejected'; message: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function boundedString(value: unknown, max: number, required = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if ((!trimmed && required) || trimmed.length > max) return undefined
  return trimmed || undefined
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000
    ? Number(value)
    : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000
    ? Number(value)
    : undefined
}

function finiteUnit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined
}

function parseDocumentRects(value: unknown): Extract<WorkspacePreviewAnchor, { kind: 'document' }>['rects'] | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 64) return null
  const rects: NonNullable<Extract<WorkspacePreviewAnchor, { kind: 'document' }>['rects']> = []
  for (const item of value) {
    const candidate = record(item)
    if (!candidate || !hasOnlyKeys(candidate, ['page', 'x', 'y', 'width', 'height'])) return null
    const page = positiveInteger(candidate.page)
    const x = finiteUnit(candidate.x)
    const y = finiteUnit(candidate.y)
    const width = finiteUnit(candidate.width)
    const height = finiteUnit(candidate.height)
    if (!page || x === undefined || y === undefined || !width || !height || x + width > 1 || y + height > 1) {
      return null
    }
    rects.push({ page, x, y, width, height })
  }
  return rects
}

function parseAnchor(value: unknown): WorkspacePreviewAnchor | null | undefined {
  if (value === undefined) return undefined
  const anchor = record(value)
  if (!anchor || typeof anchor.kind !== 'string') return null
  if (anchor.kind === 'text') {
    if (!hasOnlyKeys(anchor, ['kind', 'line', 'column', 'endLine', 'endColumn'])) return null
    const line = positiveInteger(anchor.line)
    const column = anchor.column === undefined ? undefined : positiveInteger(anchor.column)
    const endLine = anchor.endLine === undefined ? undefined : positiveInteger(anchor.endLine)
    const endColumn = anchor.endColumn === undefined ? undefined : positiveInteger(anchor.endColumn)
    if (!line || (anchor.column !== undefined && !column) || (anchor.endLine !== undefined && !endLine) ||
        (anchor.endColumn !== undefined && !endColumn)) return null
    return {
      kind: 'text',
      line,
      ...(column ? { column } : {}),
      ...(endLine ? { endLine } : {}),
      ...(endColumn ? { endColumn } : {})
    }
  }
  if (anchor.kind === 'document') {
    if (!hasOnlyKeys(anchor, ['kind', 'id', 'page', 'paragraphIndex', 'quote', 'rects'])) return null
    const id = anchor.id === undefined ? undefined : boundedString(anchor.id, 256, true)
    const page = anchor.page === undefined ? undefined : positiveInteger(anchor.page)
    const paragraphIndex = anchor.paragraphIndex === undefined ? undefined : positiveInteger(anchor.paragraphIndex)
    const quote = anchor.quote === undefined ? undefined : boundedString(anchor.quote, 8_000)
    const rects = parseDocumentRects(anchor.rects)
    if ((anchor.id !== undefined && !id) || (anchor.page !== undefined && !page) ||
        (anchor.paragraphIndex !== undefined && !paragraphIndex) ||
        (anchor.quote !== undefined && quote === undefined) || rects === null) return null
    return {
      kind: 'document',
      ...(id ? { id } : {}),
      ...(page ? { page } : {}),
      ...(paragraphIndex ? { paragraphIndex } : {}),
      ...(quote ? { quote } : {}),
      ...(rects?.length ? { rects } : {})
    }
  }
  if (anchor.kind === 'tabular') {
    if (!hasOnlyKeys(anchor, ['kind', 'sheet', 'rowStart', 'rowEnd', 'columnStart', 'columnEnd'])) return null
    const sheet = anchor.sheet === undefined ? undefined : boundedString(anchor.sheet, 256, true)
    const rowStart = nonnegativeInteger(anchor.rowStart)
    const rowEnd = nonnegativeInteger(anchor.rowEnd)
    const columnStart = nonnegativeInteger(anchor.columnStart)
    const columnEnd = nonnegativeInteger(anchor.columnEnd)
    if ((anchor.sheet !== undefined && !sheet) || rowStart === undefined || rowEnd === undefined ||
        columnStart === undefined || columnEnd === undefined || rowEnd < rowStart || columnEnd < columnStart) {
      return null
    }
    return {
      kind: 'tabular',
      ...(sheet ? { sheet } : {}),
      rowStart,
      rowEnd,
      columnStart,
      columnEnd
    }
  }
  return null
}

export function parseProjectDagPreviewRequest(value: unknown): ProjectDagPreviewRequest | null {
  const message = record(value)
  if (!message || !hasOnlyKeys(message, [
    'type', 'version', 'requestId', 'locator', 'artifactId', 'artifactVersionId',
    'sourceAnchorId', 'anchor', 'claim'
  ])) return null
  if (message.type !== PROJECT_DAG_PREVIEW_REQUEST || message.version !== 1) return null
  const requestId = boundedString(message.requestId, 128, true)
  const locator = boundedString(message.locator, 4_096, true)
  const artifactId = message.artifactId === undefined ? undefined : boundedString(message.artifactId, 512, true)
  const artifactVersionId = message.artifactVersionId === undefined
    ? undefined
    : boundedString(message.artifactVersionId, 512, true)
  const sourceAnchorId = message.sourceAnchorId === undefined
    ? undefined
    : boundedString(message.sourceAnchorId, 512, true)
  const anchor = parseAnchor(message.anchor)
  const claim = record(message.claim)
  if (!requestId || !locator || anchor === null || !claim ||
      !hasOnlyKeys(claim, ['id', 'statement', 'snapshotDigest'])) return null
  const claimId = boundedString(claim.id, 512, true)
  const statement = claim.statement === undefined ? undefined : boundedString(claim.statement, 8_000)
  const snapshotDigest = claim.snapshotDigest === undefined
    ? undefined
    : boundedString(claim.snapshotDigest, 512, true)
  if (!claimId || (message.artifactId !== undefined && !artifactId) ||
      (message.artifactVersionId !== undefined && !artifactVersionId) ||
      (message.sourceAnchorId !== undefined && !sourceAnchorId) ||
      (claim.statement !== undefined && statement === undefined) ||
      (claim.snapshotDigest !== undefined && snapshotDigest === undefined)) return null
  return {
    type: PROJECT_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId,
    locator,
    ...(artifactId ? { artifactId } : {}),
    ...(artifactVersionId ? { artifactVersionId } : {}),
    ...(sourceAnchorId ? { sourceAnchorId } : {}),
    ...(anchor ? { anchor } : {}),
    claim: {
      id: claimId,
      ...(statement ? { statement } : {}),
      ...(snapshotDigest ? { snapshotDigest } : {})
    }
  }
}

function normalizeAbsolutePath(value: string): string | null {
  const path = value.trim().replaceAll('\\', '/')
  if (!path || /[\u0000-\u001f\u007f]/u.test(path) || path.startsWith('//')) return null
  const drive = /^([A-Za-z]):\/(.*)$/u.exec(path)
  const isPosix = path.startsWith('/')
  if (!drive && !isPosix) return null
  const prefix = drive ? `${drive[1]!.toUpperCase()}:/` : '/'
  const tail = drive ? drive[2]! : path.slice(1)
  const segments: string[] = []
  for (const segment of tail.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `${prefix}${segments.join('/')}`.replace(/\/$/u, '') || prefix
}

export function resolveProjectDagWorkspaceLocator(locator: string, workspaceRoot: string): string | null {
  const root = normalizeAbsolutePath(workspaceRoot)
  const candidate = locator.trim().replaceAll('\\', '/')
  if (!root || !candidate || /[\u0000-\u001f\u007f]/u.test(candidate) || candidate.startsWith('~')) return null
  const windowsAbsolute = /^[A-Za-z]:\//u.test(candidate)
  if (!windowsAbsolute && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(candidate)) return null
  const absolute = candidate.startsWith('/') || windowsAbsolute
    ? normalizeAbsolutePath(candidate)
    : normalizeAbsolutePath(`${root}/${candidate}`)
  if (!absolute) return null
  const windows = /^[A-Za-z]:\//u.test(root)
  const comparableRoot = windows ? root.toLowerCase() : root
  const comparablePath = windows ? absolute.toLowerCase() : absolute
  if (comparablePath === comparableRoot || !comparablePath.startsWith(`${comparableRoot}/`)) return null
  return absolute
}

function expectedOrigin(frameUrl: string): string | null {
  try {
    const origin = new URL(frameUrl).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

function sendResult(
  source: MessageEventSource,
  origin: string,
  requestId: string,
  result: { ok: true } | { ok: false; message: string }
): void {
  if (!('postMessage' in source)) return
  ;(source as WindowProxy).postMessage({
    type: PROJECT_DAG_PREVIEW_RESULT,
    version: 1,
    requestId,
    ...result
  }, origin)
}

export async function handleProjectDagPreviewMessage(input: {
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>
  frameWindow: WindowProxy | null
  frameUrl: string
  workspaceRoot: string
  resolveWorkspaceFile: Resolver
  openPreview?: (target: ProjectDagPreviewTarget) => void
}): Promise<ProjectDagPreviewBridgeResult> {
  const origin = expectedOrigin(input.frameUrl)
  if (!origin || !input.frameWindow || input.event.source !== input.frameWindow || input.event.origin !== origin) {
    return { status: 'ignored' }
  }
  const request = parseProjectDagPreviewRequest(input.event.data)
  if (!request) {
    const message = 'Project DAG 的证据预览请求格式无效。'
    const requestId = boundedString(record(input.event.data)?.requestId, 128) ?? 'invalid-request'
    sendResult(input.event.source!, origin, requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const candidate = resolveProjectDagWorkspaceLocator(request.locator, input.workspaceRoot)
  if (!candidate) {
    const message = '只能预览当前 workspace 内的本地证据；远程、runtime、受限或越界路径不会被打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  let resolved: WorkspaceFileResolveResult
  try {
    resolved = await input.resolveWorkspaceFile({ path: candidate, workspaceRoot: input.workspaceRoot })
  } catch {
    resolved = { ok: false, message: '无法验证证据文件。' }
  }
  if (!resolved.ok || resolved.kind === 'directory') {
    const message = resolved.ok ? '证据定位到目录，无法作为文件预览。' : (resolved.message || '证据文件不存在或不可访问。')
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const safeResolvedPath = resolveProjectDagWorkspaceLocator(resolved.path, input.workspaceRoot)
  if (!safeResolvedPath) {
    const message = '证据文件解析后超出当前 workspace，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const target: ProjectDagPreviewTarget = {
    path: safeResolvedPath,
    workspaceRoot: input.workspaceRoot,
    ...(request.anchor ? { anchor: request.anchor } : {}),
    ...(request.anchor?.kind === 'text' ? {
      line: request.anchor.line,
      ...(request.anchor.column ? { column: request.anchor.column } : {})
    } : {}),
    returnTo: {
      kind: 'project-dag',
      label: '返回 Claim',
      claimId: request.claim.id
    }
  }
  ;(input.openPreview ?? previewWorkspaceFile)(target)
  sendResult(input.event.source!, origin, request.requestId, { ok: true })
  return { status: 'opened', target }
}
