import type {
  ProjectDagEvidencePreviewResolveRequest,
  ProjectDagEvidencePreviewResolveResult,
  ProjectDagSourceSelector
} from '@shared/sciforge-api'
import type { WorkspacePreviewAnchor } from '@shared/workspace-preview'
import {
  normalizeProjectDagGraphNodeId,
  previewWorkspaceFile,
  type WorkspaceFilePreviewDetail
} from '../../lib/workspace-file-preview'

export const PROJECT_DAG_PREVIEW_REQUEST = 'sciforge.project-dag.preview-workspace-evidence'
export const PROJECT_DAG_PREVIEW_RESULT = 'sciforge.project-dag.preview-workspace-evidence-result'

export type ProjectDagPreviewRequest = {
  type: typeof PROJECT_DAG_PREVIEW_REQUEST
  version: 1
  requestId: string
  artifactVersionId: string
  sourceAnchorId: string
  graphNodeId?: string
  claim: {
    id: string
    snapshotDigest: string
  }
}

type ProjectDagPreviewTarget = WorkspaceFilePreviewDetail & {
  anchor?: WorkspacePreviewAnchor
  returnTo: {
    kind: 'project-dag'
    label: string
    claimId: string
    nodeId?: string
  }
}

type Resolver = (
  input: ProjectDagEvidencePreviewResolveRequest
) => Promise<ProjectDagEvidencePreviewResolveResult>

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

function sha256Digest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '')
  return /^[a-f0-9]{64}$/u.test(normalized) ? `sha256:${normalized}` : undefined
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

function numericRange(value: unknown, min: number): [number, number] | null {
  if (typeof value !== 'string' || !/^\d+:\d+$/u.test(value)) return null
  const [start, end] = value.split(':').map(Number)
  return start! >= min && end! >= start! && end! <= 1_000_000 ? [start!, end!] : null
}

export function projectDagSelectorAnchor(
  selector: ProjectDagSourceSelector,
  sourceAnchorId: string
): WorkspacePreviewAnchor | undefined {
  const native = selector as ProjectDagSourceSelector & {
    line?: number
    column?: number
    endLine?: number
    endColumn?: number
    rowStart?: number
    rowEnd?: number
    columnStart?: number
    columnEnd?: number
    sheet?: string
  }
  const line = positiveInteger(native.line)
  if (line) {
    const column = positiveInteger(native.column)
    const endLine = positiveInteger(native.endLine)
    const endColumn = positiveInteger(native.endColumn)
    return {
      kind: 'text',
      line,
      ...(column ? { column } : {}),
      ...(endLine ? { endLine } : {}),
      ...(endColumn ? { endColumn } : {})
    }
  }
  const lineRange = numericRange(selector.lineRange, 1)
  if (lineRange) return { kind: 'text', line: lineRange[0], endLine: lineRange[1] }

  const rowStart = nonnegativeInteger(native.rowStart)
  const rowEnd = nonnegativeInteger(native.rowEnd)
  const columnStart = nonnegativeInteger(native.columnStart)
  const columnEnd = nonnegativeInteger(native.columnEnd)
  if (rowStart !== undefined && rowEnd !== undefined && columnStart !== undefined &&
      columnEnd !== undefined && rowEnd >= rowStart && columnEnd >= columnStart) {
    return {
      kind: 'tabular',
      ...(native.sheet?.trim() ? { sheet: native.sheet.trim().slice(0, 256) } : {}),
      rowStart,
      rowEnd,
      columnStart,
      columnEnd
    }
  }
  const rowRange = numericRange(selector.rowRange, 0)
  if (rowRange) {
    return {
      kind: 'tabular',
      ...(selector.table?.trim() ? { sheet: selector.table.trim().slice(0, 256) } : {}),
      rowStart: rowRange[0],
      rowEnd: rowRange[1],
      columnStart: 0,
      columnEnd: 0
    }
  }

  const page = positiveInteger(selector.page)
  const quote = boundedString(selector.quote, 8_000)
  if (page || quote || sourceAnchorId) {
    return {
      kind: 'document',
      id: sourceAnchorId.slice(0, 256),
      ...(page ? { page } : {}),
      ...(quote ? { quote } : {})
    }
  }
  return undefined
}

export function parseProjectDagPreviewRequest(value: unknown): ProjectDagPreviewRequest | null {
  const message = record(value)
  if (!message || !hasOnlyKeys(message, [
    'type', 'version', 'requestId', 'artifactVersionId', 'sourceAnchorId', 'graphNodeId', 'claim'
  ])) return null
  if (message.type !== PROJECT_DAG_PREVIEW_REQUEST || message.version !== 1) return null
  const requestId = boundedString(message.requestId, 128, true)
  const artifactVersionId = boundedString(message.artifactVersionId, 512, true)
  const sourceAnchorId = boundedString(message.sourceAnchorId, 512, true)
  const graphNodeId = message.graphNodeId === undefined
    ? undefined
    : normalizeProjectDagGraphNodeId(message.graphNodeId)
  const claim = record(message.claim)
  if (!requestId || !artifactVersionId || !sourceAnchorId ||
      (message.graphNodeId !== undefined && !graphNodeId) || !claim ||
      !hasOnlyKeys(claim, ['id', 'snapshotDigest'])) return null
  const claimId = boundedString(claim.id, 512, true)
  const snapshotDigest = boundedString(claim.snapshotDigest, 512, true)
  if (!claimId || !snapshotDigest) return null
  return {
    type: PROJECT_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId,
    artifactVersionId,
    sourceAnchorId,
    ...(graphNodeId ? { graphNodeId } : {}),
    claim: { id: claimId, snapshotDigest }
  }
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

function failureMessage(result: Extract<ProjectDagEvidencePreviewResolveResult, { ok: false }>): string {
  if (result.code === 'access_restricted') return '该证据受访问策略限制，无法打开。'
  if (result.code === 'unsupported_locator') return '该来源不是当前 workspace 内可预览的本地文件。'
  if (result.code === 'file_unavailable') return '证据文件不存在或当前不可访问。'
  if (result.code === 'snapshot_mismatch') return '证据请求不属于当前正在查看的 committed Project Snapshot。'
  return '无法验证该 Claim 与原始证据的固定溯源关系。'
}

export async function handleProjectDagPreviewMessage(input: {
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>
  frameWindow: WindowProxy | null
  frameUrl: string
  workspaceRoot: string
  projectRoot?: string
  project?: string
  expectedSnapshotDigest: string | undefined
  resolveProjectDagEvidencePreview: Resolver
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
  if (!input.expectedSnapshotDigest || request.claim.snapshotDigest !== input.expectedSnapshotDigest) {
    const message = '证据请求不属于当前正在查看的 committed Project Snapshot，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  let resolved: ProjectDagEvidencePreviewResolveResult
  try {
    resolved = await input.resolveProjectDagEvidencePreview({
      workspaceRoot: input.workspaceRoot,
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      ...(input.project ? { project: input.project } : {}),
      snapshotDigest: request.claim.snapshotDigest,
      claimId: request.claim.id,
      artifactVersionId: request.artifactVersionId,
      sourceAnchorId: request.sourceAnchorId
    })
  } catch {
    resolved = { ok: false, code: 'file_unavailable', message: 'Unable to resolve evidence.' }
  }
  if (!resolved.ok) {
    const message = failureMessage(resolved)
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  if (resolved.workspaceRoot !== input.workspaceRoot ||
      resolved.snapshotDigest !== request.claim.snapshotDigest ||
      resolved.claimId !== request.claim.id ||
      resolved.artifactVersionId !== request.artifactVersionId ||
      resolved.sourceAnchorId !== request.sourceAnchorId) {
    const message = '受信解析结果与请求的固定溯源标识不一致，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const anchor = projectDagSelectorAnchor(resolved.selector, resolved.sourceAnchorId)
  const digest = sha256Digest(resolved.contentDigest)
  const target: ProjectDagPreviewTarget = {
    path: resolved.path,
    workspaceRoot: resolved.workspaceRoot,
    ...(anchor ? { anchor } : {}),
    ...(digest ? { integrity: { algorithm: 'sha256', expectedDigest: digest } } : {}),
    ...(anchor?.kind === 'text' ? {
      line: anchor.line,
      ...(anchor.column ? { column: anchor.column } : {})
    } : {}),
    returnTo: {
      kind: 'project-dag',
      label: request.graphNodeId ? 'Project DAG' : 'Claim',
      claimId: request.claim.id,
      ...(request.graphNodeId ? { nodeId: request.graphNodeId } : {})
    }
  }
  ;(input.openPreview ?? previewWorkspaceFile)(target)
  sendResult(input.event.source!, origin, request.requestId, { ok: true })
  return { status: 'opened', target }
}
