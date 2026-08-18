import type {
  DomainRendererWorkspacePreviewHost,
  DomainWorkspacePreviewTarget,
  DomainWorkbenchRightPanelActivation
} from '@sciforge/domain-sdk/host'
import {
  projectDagActivationPayloadSchema,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagResolveEvidencePreviewResult,
  type ProjectDagSourceSelector,
  type ProjectDagTarget
} from '../contract'
import { PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION } from '../definition'

export const PROJECT_DAG_PREVIEW_REQUEST =
  'sciforge.project-dag.preview-workspace-evidence'
export const PROJECT_DAG_PREVIEW_RESULT =
  'sciforge.project-dag.preview-workspace-evidence-result'

export type ProjectDagPreviewRequest = Readonly<{
  type: typeof PROJECT_DAG_PREVIEW_REQUEST
  version: 1
  requestId: string
  artifactVersionId: string
  sourceAnchorId: string
  graphNodeId?: string
  claim: Readonly<{
    id: string
    snapshotDigest: string
  }>
}>

export type ProjectDagPreviewBridgeResult =
  | Readonly<{ status: 'ignored' }>
  | Readonly<{ status: 'opened'; target: DomainWorkspacePreviewTarget }>
  | Readonly<{ status: 'rejected'; message: string }>

type Translate = (key: string) => string

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedString(
  value: unknown,
  max: number,
  required = false
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if ((!trimmed && required) || trimmed.length > max) return undefined
  return trimmed || undefined
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function normalizeProjectDagGraphNodeId(value: unknown): string | undefined {
  const nodeId = boundedString(value, 512, true)
  return nodeId && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(nodeId)
    ? nodeId
    : undefined
}

export function parseProjectDagPreviewRequest(
  value: unknown
): ProjectDagPreviewRequest | null {
  const message = record(value)
  if (!message || !hasOnlyKeys(message, [
    'type',
    'version',
    'requestId',
    'artifactVersionId',
    'sourceAnchorId',
    'graphNodeId',
    'claim'
  ]) || message.type !== PROJECT_DAG_PREVIEW_REQUEST || message.version !== 1) {
    return null
  }
  const requestId = boundedString(message.requestId, 128, true)
  const artifactVersionId = boundedString(message.artifactVersionId, 512, true)
  const sourceAnchorId = boundedString(message.sourceAnchorId, 512, true)
  const graphNodeId = message.graphNodeId === undefined
    ? undefined
    : normalizeProjectDagGraphNodeId(message.graphNodeId)
  const claim = record(message.claim)
  if (
    !requestId ||
    !artifactVersionId ||
    !sourceAnchorId ||
    (message.graphNodeId !== undefined && !graphNodeId) ||
    !claim ||
    !hasOnlyKeys(claim, ['id', 'snapshotDigest'])
  ) {
    return null
  }
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

export async function handleProjectDagPreviewMessage(input: Readonly<{
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>
  frameWindow: WindowProxy | null
  frameUrl: string
  sessionId: string
  surfaceId: string
  target: ProjectDagTarget
  committedSnapshotDigest?: string
  activationRevision?: number
  workspacePreview?: DomainRendererWorkspacePreviewHost
  resolvePreview: (
    request: ProjectDagResolveEvidencePreviewInput
  ) => Promise<ProjectDagResolveEvidencePreviewResult>
  t: Translate
}>): Promise<ProjectDagPreviewBridgeResult> {
  const origin = expectedOrigin(input.frameUrl)
  if (
    !origin ||
    !input.frameWindow ||
    input.event.source !== input.frameWindow ||
    input.event.origin !== origin
  ) {
    return { status: 'ignored' }
  }
  const request = parseProjectDagPreviewRequest(input.event.data)
  if (!request) {
    return reject(input.event.source, origin, requestIdFrom(input.event.data), input.t(
      'projectDagPreviewInvalid'
    ))
  }
  if (
    !input.committedSnapshotDigest ||
    request.claim.snapshotDigest !== input.committedSnapshotDigest
  ) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'projectDagPreviewSnapshotMismatch'
    ))
  }
  const workspaceRoot = input.target.workspaceRoot?.trim()
  if (!workspaceRoot) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'projectDagPreviewMissing'
    ))
  }
  let resolved: ProjectDagResolveEvidencePreviewResult
  try {
    resolved = await input.resolvePreview({
      ...input.target,
      workspaceRoot,
      snapshotDigest: request.claim.snapshotDigest,
      claimId: request.claim.id,
      artifactVersionId: request.artifactVersionId,
      sourceAnchorId: request.sourceAnchorId
    })
  } catch {
    return reject(input.event.source, origin, request.requestId, input.t(
      'projectDagPreviewMissing'
    ))
  }
  if (!resolved.ok) {
    return reject(
      input.event.source,
      origin,
      request.requestId,
      previewFailureMessage(resolved.error.code, input.t)
    )
  }
  const data = resolved.data
  if (
    data.workspaceRoot !== workspaceRoot ||
    data.snapshotDigest !== request.claim.snapshotDigest ||
    data.claimId !== request.claim.id ||
    data.artifactVersionId !== request.artifactVersionId ||
    data.sourceAnchorId !== request.sourceAnchorId
  ) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'projectDagPreviewProvenanceMismatch'
    ))
  }
  if (!input.workspacePreview) {
    return reject(input.event.source, origin, request.requestId, input.t(
      'projectDagPreviewMissing'
    ))
  }
  const activationPayload = projectDagActivationPayloadSchema.parse({
    ...input.target,
    view: 'graph',
    focus: {
      claimId: request.claim.id,
      ...(request.graphNodeId ? { nodeId: request.graphNodeId } : {})
    }
  })
  const activation: DomainWorkbenchRightPanelActivation = {
    contributionId: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    revision: input.activationRevision ?? 0,
    payload: activationPayload
  }
  const anchor = projectDagSelectorAnchor(data.selector, data.sourceAnchorId)
  const target: DomainWorkspacePreviewTarget = {
    path: data.path,
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
    workspaceRoot: data.workspaceRoot,
    ...(anchor ? { anchor } : {}),
    ...(anchor?.kind === 'text'
      ? {
          line: typeof anchor.line === 'number' ? anchor.line : undefined,
          column: typeof anchor.column === 'number' ? anchor.column : undefined
        }
      : {}),
    ...(data.contentDigest?.startsWith('sha256:')
      ? {
          integrity: {
            algorithm: 'sha256' as const,
            expectedDigest: data.contentDigest
          }
        }
      : {}),
    returnTo: {
      contributionId: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      label: 'Project DAG',
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
    type: PROJECT_DAG_PREVIEW_RESULT,
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
): ProjectDagPreviewBridgeResult {
  sendResult(source, origin, requestId, { ok: false, message })
  return { status: 'rejected', message }
}

function previewFailureMessage(
  code: Extract<ProjectDagResolveEvidencePreviewResult, { ok: false }>['error']['code'],
  t: Translate
): string {
  if (code === 'access_restricted') return t('projectDagPreviewRestricted')
  if (code === 'unsupported_locator') return t('projectDagPreviewUnsupported')
  if (code === 'file_unavailable') return t('projectDagPreviewMissing')
  if (code === 'snapshot_mismatch') return t('projectDagPreviewSnapshotMismatch')
  return t('projectDagPreviewFailed')
}

export function projectDagSelectorAnchor(
  selector: ProjectDagSourceSelector,
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
