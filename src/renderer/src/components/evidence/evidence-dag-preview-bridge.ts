import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  EvidenceDagEvidencePreviewResolveRequest,
  EvidenceDagEvidencePreviewResolveResult
} from '@shared/sciforge-api'
import {
  previewWorkspaceFile,
  type WorkspaceFilePreviewDetail
} from '../../lib/workspace-file-preview'
import { projectDagSelectorAnchor } from '../project-dag/project-dag-preview-bridge'

export type {
  EvidenceDagEvidencePreviewResolveRequest,
  EvidenceDagEvidencePreviewResolveResult
} from '@shared/sciforge-api'

export const EVIDENCE_DAG_PREVIEW_REQUEST = 'sciforge.evidence-dag.preview-workspace-evidence'
export const EVIDENCE_DAG_PREVIEW_RESULT = 'sciforge.evidence-dag.preview-workspace-evidence-result'

export type EvidenceDagPreviewRequest = {
  type: typeof EVIDENCE_DAG_PREVIEW_REQUEST
  version: 1
  requestId: string
  threadId: string
  snapshotDigest: string
  sourceAssertionId: string
  artifactVersionId: string
  sourceAnchorId: string
}

type PreviewTarget = WorkspaceFilePreviewDetail & {
  returnTo: {
    kind: 'evidence-dag'
    label: 'Evidence'
    nodeId: string
    threadId: string
  }
}

type Resolver = (
  input: EvidenceDagEvidencePreviewResolveRequest
) => Promise<EvidenceDagEvidencePreviewResolveResult>

export type EvidenceDagPreviewBridgeResult =
  | { status: 'ignored' }
  | { status: 'opened'; target: PreviewTarget }
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

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function sha256Digest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '')
  return /^[a-f0-9]{64}$/u.test(normalized) ? `sha256:${normalized}` : undefined
}

export function parseEvidenceDagPreviewRequest(value: unknown): EvidenceDagPreviewRequest | null {
  const message = record(value)
  if (!message || !hasOnlyKeys(message, [
    'type', 'version', 'requestId', 'threadId', 'snapshotDigest', 'sourceAssertionId',
    'artifactVersionId', 'sourceAnchorId'
  ]) || message.type !== EVIDENCE_DAG_PREVIEW_REQUEST || message.version !== 1) return null
  const requestId = boundedString(message.requestId, 128)
  const threadId = boundedString(message.threadId, 512)
  const snapshotDigest = boundedString(message.snapshotDigest, 512)
  const sourceAssertionId = boundedString(message.sourceAssertionId, 512)
  const artifactVersionId = boundedString(message.artifactVersionId, 512)
  const sourceAnchorId = boundedString(message.sourceAnchorId, 512)
  if (!requestId || !threadId || !snapshotDigest || !sourceAssertionId ||
      !artifactVersionId || !sourceAnchorId) return null
  return {
    type: EVIDENCE_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId,
    threadId,
    snapshotDigest,
    sourceAssertionId,
    artifactVersionId,
    sourceAnchorId
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
    type: EVIDENCE_DAG_PREVIEW_RESULT,
    version: 1,
    requestId,
    ...result
  }, origin)
}

function failureMessage(result: Extract<EvidenceDagEvidencePreviewResolveResult, { ok: false }>): string {
  if (result.code === 'access_restricted') return '该证据受访问策略限制，无法打开。'
  if (result.code === 'unsupported_locator') return '该来源是 runtime、citation 或远程引用，不能作为 workspace 文件打开。'
  if (result.code === 'file_unavailable') return '证据文件不存在或当前不可访问。'
  if (result.code === 'snapshot_mismatch') return '证据请求不属于当前正在查看的 Evidence Snapshot。'
  return '无法验证该 SourceAssertion 与原始证据的固定溯源关系。'
}

export async function handleEvidenceDagPreviewMessage(input: {
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>
  frameWindow: WindowProxy | null
  frameUrl: string
  runtimeId: AgentRuntimeId | undefined
  currentThreadId: string | null
  expectedSnapshotDigest: string | undefined
  resolveEvidenceDagEvidencePreview: Resolver
  openPreview?: (target: PreviewTarget) => void
}): Promise<EvidenceDagPreviewBridgeResult> {
  const origin = expectedOrigin(input.frameUrl)
  if (!origin || !input.frameWindow || input.event.source !== input.frameWindow || input.event.origin !== origin) {
    return { status: 'ignored' }
  }
  const request = parseEvidenceDagPreviewRequest(input.event.data)
  if (!request) {
    const message = 'Evidence DAG 的证据预览请求格式无效。'
    const requestId = boundedString(record(input.event.data)?.requestId, 128) ?? 'invalid-request'
    sendResult(input.event.source!, origin, requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const iframeThreadId = input.runtimeId && input.currentThreadId
    ? (input.currentThreadId.startsWith(`${input.runtimeId}:`)
        ? input.currentThreadId
        : `${input.runtimeId}:${input.currentThreadId}`)
    : null
  if (!input.runtimeId || !input.currentThreadId || request.threadId !== iframeThreadId) {
    const message = '证据请求不属于当前 Evidence DAG thread，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  if (!input.expectedSnapshotDigest || request.snapshotDigest !== input.expectedSnapshotDigest) {
    const message = '证据请求不属于当前正在查看的 Evidence Snapshot，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  let resolved: EvidenceDagEvidencePreviewResolveResult
  try {
    resolved = await input.resolveEvidenceDagEvidencePreview({
      runtimeId: input.runtimeId,
      threadId: input.currentThreadId,
      snapshotDigest: request.snapshotDigest,
      sourceAssertionId: request.sourceAssertionId,
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
  if (resolved.runtimeId !== input.runtimeId || resolved.threadId !== input.currentThreadId ||
      resolved.snapshotDigest !== request.snapshotDigest ||
      resolved.sourceAssertionId !== request.sourceAssertionId ||
      resolved.artifactVersionId !== request.artifactVersionId ||
      resolved.sourceAnchorId !== request.sourceAnchorId) {
    const message = '受信解析结果与请求的固定溯源标识不一致，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const anchor = projectDagSelectorAnchor(resolved.selector, resolved.sourceAnchorId)
  const digest = sha256Digest(resolved.contentDigest)
  if (!digest) {
    const message = '证据版本缺少可验证的内容摘要，已拒绝打开。'
    sendResult(input.event.source!, origin, request.requestId, { ok: false, message })
    return { status: 'rejected', message }
  }
  const target: PreviewTarget = {
    path: resolved.path,
    workspaceRoot: resolved.workspaceRoot,
    ...(anchor ? { anchor } : {}),
    integrity: { algorithm: 'sha256', expectedDigest: digest },
    ...(anchor?.kind === 'text' ? {
      line: anchor.line,
      ...(anchor.column ? { column: anchor.column } : {})
    } : {}),
    returnTo: {
      kind: 'evidence-dag',
      label: 'Evidence',
      nodeId: request.sourceAssertionId,
      threadId: input.currentThreadId
    }
  }
  ;(input.openPreview ?? previewWorkspaceFile)(target)
  sendResult(input.event.source!, origin, request.requestId, { ok: true })
  return { status: 'opened', target }
}
