import type {
  DomainRendererWorkspacePreviewHost,
  DomainWorkspacePreviewTarget,
  DomainWorkbenchRightPanelActivation
} from '@sciforge/domain-sdk/host'
import type {
  EvidenceDagPreviewInput,
  EvidenceDagPreviewOutput,
  EvidenceSourceSelector
} from '../contract'
import { EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION } from '../definition'

export const EVIDENCE_DAG_PREVIEW_REQUEST =
  'sciforge.evidence-dag.preview-workspace-evidence'
export const EVIDENCE_DAG_PREVIEW_RESULT =
  'sciforge.evidence-dag.preview-workspace-evidence-result'

export type EvidenceDagPreviewRequest = Readonly<{
  type: typeof EVIDENCE_DAG_PREVIEW_REQUEST
  version: 1
  requestId: string
  threadId: string
  snapshotDigest: string
  sourceAssertionId: string
  artifactVersionId: string
  sourceAnchorId: string
}>

export type EvidenceDagPreviewBridgeResult =
  | Readonly<{ status: 'ignored' }>
  | Readonly<{ status: 'opened'; target: DomainWorkspacePreviewTarget }>
  | Readonly<{ status: 'rejected'; message: string }>

type Translate = (key: string) => string

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function parseEvidenceDagPreviewRequest(
  value: unknown
): EvidenceDagPreviewRequest | null {
  const message = record(value)
  if (!message || !hasOnlyKeys(message, [
    'type',
    'version',
    'requestId',
    'threadId',
    'snapshotDigest',
    'sourceAssertionId',
    'artifactVersionId',
    'sourceAnchorId'
  ]) || message.type !== EVIDENCE_DAG_PREVIEW_REQUEST || message.version !== 1) {
    return null
  }
  const requestId = boundedString(message.requestId, 128)
  const threadId = boundedString(message.threadId, 512)
  const snapshotDigest = boundedString(message.snapshotDigest, 512)
  const sourceAssertionId = boundedString(message.sourceAssertionId, 512)
  const artifactVersionId = boundedString(message.artifactVersionId, 512)
  const sourceAnchorId = boundedString(message.sourceAnchorId, 512)
  if (
    !requestId ||
    !threadId ||
    !snapshotDigest ||
    !sourceAssertionId ||
    !artifactVersionId ||
    !sourceAnchorId
  ) {
    return null
  }
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

export async function handleEvidenceDagPreviewMessage(input: Readonly<{
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>
  frameWindow: WindowProxy | null
  frameUrl: string
  sessionId: string
  runtimeId?: string
  threadId?: string
  committedSnapshotDigest?: string
  activationRevision?: number
  workspacePreview?: DomainRendererWorkspacePreviewHost
  resolvePreview: (request: EvidenceDagPreviewInput) => Promise<EvidenceDagPreviewOutput>
  t: Translate
}>): Promise<EvidenceDagPreviewBridgeResult> {
  const origin = expectedOrigin(input.frameUrl)
  if (
    !origin ||
    !input.frameWindow ||
    input.event.source !== input.frameWindow ||
    input.event.origin !== origin
  ) {
    return { status: 'ignored' }
  }
  const request = parseEvidenceDagPreviewRequest(input.event.data)
  if (!request) {
    return reject(input.event.source, origin, requestIdFrom(input.event.data), input.t(
      'evidenceDagPreviewInvalid'
    ))
  }
  const iframeThreadId = input.runtimeId && input.threadId
    ? `${input.runtimeId}:${input.threadId}`
    : null
  if (!input.runtimeId || !input.threadId || request.threadId !== iframeThreadId) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'evidenceDagPreviewThreadMismatch'
    ))
  }
  if (
    !input.committedSnapshotDigest ||
    request.snapshotDigest !== input.committedSnapshotDigest
  ) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'evidenceDagPreviewSnapshotMismatch'
    ))
  }
  let resolved: EvidenceDagPreviewOutput
  try {
    resolved = await input.resolvePreview({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      snapshotDigest: request.snapshotDigest,
      sourceAssertionId: request.sourceAssertionId,
      artifactVersionId: request.artifactVersionId,
      sourceAnchorId: request.sourceAnchorId
    })
  } catch {
    return reject(input.event.source, origin, request.requestId, input.t(
      'evidenceDagPreviewMissing'
    ))
  }
  if (!resolved.ok) {
    return reject(
      input.event.source,
      origin,
      request.requestId,
      previewFailureMessage(resolved.code, input.t)
    )
  }
  if (
    resolved.runtimeId !== input.runtimeId ||
    resolved.threadId !== input.threadId ||
    resolved.snapshotDigest !== request.snapshotDigest ||
    resolved.sourceAssertionId !== request.sourceAssertionId ||
    resolved.artifactVersionId !== request.artifactVersionId ||
    resolved.sourceAnchorId !== request.sourceAnchorId
  ) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'evidenceDagPreviewProvenanceMismatch'
    ))
  }
  if (!input.workspacePreview) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'evidenceDagPreviewMissing'
    ))
  }
  const activation: DomainWorkbenchRightPanelActivation = {
    contributionId: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    revision: input.activationRevision ?? 0,
    payload: {
      view: 'graph',
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      snapshotDigest: request.snapshotDigest,
      nodeId: request.sourceAssertionId
    }
  }
  const anchor = selectorAnchor(resolved.selector, resolved.sourceAnchorId)
  const target: DomainWorkspacePreviewTarget = {
    path: resolved.path,
    sessionId: input.sessionId,
    workspaceRoot: resolved.workspaceRoot,
    ...(anchor ? { anchor } : {}),
    ...(anchor?.kind === 'text'
      ? {
          line: typeof anchor.line === 'number' ? anchor.line : undefined,
          column: typeof anchor.column === 'number' ? anchor.column : undefined
        }
      : {}),
    integrity: {
      algorithm: 'sha256',
      expectedDigest: resolved.contentDigest
    },
    returnTo: {
      contributionId: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      label: 'Evidence DAG',
      activation
    }
  }
  input.workspacePreview.open(target)
  sendResult(input.event.source, origin, request.requestId, { ok: true })
  return { status: 'opened', target }
}

function expectedOrigin(frameUrl: string): string | null {
  try {
    const origin = new URL(frameUrl).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

function requestIdFrom(value: unknown): string {
  return boundedString(record(value)?.requestId, 128) ?? 'invalid-request'
}

function sendResult(
  source: MessageEventSource | null,
  origin: string,
  requestId: string,
  result: Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>
): void {
  if (!source || !('postMessage' in source)) return
  ;(source as WindowProxy).postMessage({
    type: EVIDENCE_DAG_PREVIEW_RESULT,
    version: 1,
    requestId,
    ...result
  }, origin)
}

function reject(
  source: MessageEventSource | null,
  origin: string,
  requestId: string,
  message: string
): EvidenceDagPreviewBridgeResult {
  sendResult(source, origin, requestId, { ok: false, message })
  return { status: 'rejected', message }
}

function previewFailureMessage(
  code: Extract<EvidenceDagPreviewOutput, { ok: false }>['code'],
  t: Translate
): string {
  if (code === 'access_restricted') return t('evidenceDagPreviewRestricted')
  if (code === 'unsupported_locator') return t('evidenceDagPreviewUnsupported')
  if (code === 'file_unavailable') return t('evidenceDagPreviewMissing')
  if (code === 'snapshot_mismatch') return t('evidenceDagPreviewSnapshotMismatch')
  return t('evidenceDagPreviewFailed')
}

function selectorAnchor(
  selector: EvidenceSourceSelector,
  sourceAnchorId: string
): Record<string, string | number> | undefined {
  const lineRange = numericRange(selector.lineRange, 1)
  if (lineRange) {
    return { kind: 'text', line: lineRange[0], endLine: lineRange[1] }
  }
  const rowRange = numericRange(selector.rowRange, 0)
  if (rowRange) {
    return {
      kind: 'tabular',
      ...(selector.table ? { sheet: selector.table } : {}),
      rowStart: rowRange[0],
      rowEnd: rowRange[1],
      columnStart: 0,
      columnEnd: 0
    }
  }
  if (selector.page || selector.quote || sourceAnchorId) {
    return {
      kind: 'document',
      id: sourceAnchorId,
      ...(selector.page ? { page: selector.page } : {}),
      ...(selector.quote ? { quote: selector.quote } : {})
    }
  }
  return undefined
}

function numericRange(value: string | undefined, minimum: number): [number, number] | null {
  if (!value || !/^\d+:\d+$/u.test(value)) return null
  const [start, end] = value.split(':').map(Number)
  return start! >= minimum && end! >= start! ? [start!, end!] : null
}
