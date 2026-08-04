import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  ANCHORED_COMMENT_SCHEMA_VERSION,
  anchoredCommentCaptureRequestSchema,
  anchoredCommentCaptureResultSchema,
  anchoredCommentDeleteResultSchema,
  anchoredCommentGetResultSchema,
  anchoredCommentListInputSchema,
  anchoredCommentListResultSchema,
  anchoredCommentReadAssetInputSchema,
  anchoredCommentReadAssetResultSchema,
  anchoredCommentThreadIdInputSchema,
  anchoredCommentThreadSchema,
  anchoredCommentUpsertInputSchema,
  feedbackSubmissionRequestSchema,
  feedbackSubmissionResultSchema,
  type AnchoredCommentCaptureRequest,
  type AnchoredCommentThread,
  type CommentCanonicalTarget,
  type FeedbackDisclosureChoices,
  type FeedbackSubmissionResult,
  type ProductFeedbackPacket
} from '../contract'
import type { AnchoredCommentThreadView, CommentTargetInspection } from './types'

const contracts = Object.freeze({
  list: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.list,
    effect: 'read' as const,
    inputSchema: anchoredCommentListInputSchema,
    outputSchema: anchoredCommentListResultSchema
  },
  get: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.get,
    effect: 'read' as const,
    inputSchema: anchoredCommentThreadIdInputSchema,
    outputSchema: anchoredCommentGetResultSchema
  },
  upsert: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
    effect: 'workspace-write' as const,
    inputSchema: anchoredCommentUpsertInputSchema,
    outputSchema: anchoredCommentThreadSchema
  },
  delete: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
    effect: 'workspace-write' as const,
    inputSchema: anchoredCommentThreadIdInputSchema,
    outputSchema: anchoredCommentDeleteResultSchema
  },
  readAsset: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.readAsset,
    effect: 'read' as const,
    inputSchema: anchoredCommentReadAssetInputSchema,
    outputSchema: anchoredCommentReadAssetResultSchema
  },
  capture: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.capture,
    effect: 'workspace-write' as const,
    inputSchema: anchoredCommentCaptureRequestSchema,
    outputSchema: anchoredCommentCaptureResultSchema
  },
  submitFeedback: {
    actionId: ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
    effect: 'external-write' as const,
    inputSchema: feedbackSubmissionRequestSchema,
    outputSchema: feedbackSubmissionResultSchema
  }
})

export type AnchoredCommentsCapabilityClient = ReturnType<
  typeof createAnchoredCommentsCapabilityClient
>

export function createAnchoredCommentsCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
) {
  return Object.freeze({
    list: (workspaceKey: string) =>
      invoker.invoke(contracts.list, { workspaceKey }),
    get: (threadId: string) =>
      invoker.invoke(contracts.get, { threadId }),
    upsert: (thread: AnchoredCommentThread) =>
      invoker.invoke(contracts.upsert, { thread }, { workspaceId: thread.workspaceKey }),
    delete: (threadId: string, workspaceId?: string) =>
      invoker.invoke(
        contracts.delete,
        { threadId },
        {
          ...(workspaceId ? { workspaceId } : {}),
          approval: { mode: 'confirmation' }
        }
      ),
    readAsset: (asset: AnchoredCommentThread['capture']['fullWindowScreenshot']) => {
      if (!asset) throw new Error('Screenshot asset is required.')
      return invoker.invoke(contracts.readAsset, { asset })
    },
    capture: (
      input: AnchoredCommentCaptureRequest,
      workspaceId?: string
    ) => invoker.invoke(
      contracts.capture,
      anchoredCommentCaptureRequestSchema.parse(input),
      workspaceId ? { workspaceId } : {}
    ),
    submitFeedback: (
      packet: ProductFeedbackPacket,
      workspaceId?: string
    ) => invoker.invoke(
      contracts.submitFeedback,
      { packet },
      {
        ...(workspaceId ? { workspaceId } : {}),
        approval: { mode: 'confirmation' }
      }
    )
  })
}

function selectionFromTarget(
  target: CommentTargetInspection
): Record<string, string | number | boolean | null> | undefined {
  if (!target.selection) return undefined
  try {
    const parsed = JSON.parse(target.selection) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number | boolean | null>
    }
  } catch {
    // A short opaque selection remains useful without trusting it as structured data.
  }
  return { value: target.selection }
}

function canonicalTarget(target: CommentTargetInspection): CommentCanonicalTarget {
  if (target.resourceType && target.resourceId) {
    return {
      kind: 'research',
      resourceKind: target.resourceType,
      resourceId: target.resourceId,
      selection: selectionFromTarget(target)
    }
  }
  if (target.componentId) {
    return {
      kind: 'ui',
      componentId: target.componentId,
      elementId: target.elementId,
      route: target.route,
      selection: selectionFromTarget(target)
    }
  }
  return {
    kind: 'visual',
    route: target.route,
    selection: selectionFromTarget(target)
  }
}

function targetKey(target: CommentTargetInspection): string {
  if (target.resourceType && target.resourceId) {
    return `research:${target.resourceType}:${target.resourceId}:${target.selection ?? ''}`.slice(0, 2_048)
  }
  if (target.componentId) {
    return `ui:${target.componentId}:${target.elementId ?? ''}:${target.route}:${target.selection ?? ''}`.slice(0, 2_048)
  }
  return `visual:${target.targetRef}:${target.selection ?? ''}`.slice(0, 2_048)
}

function fallbackCapture(
  view: AnchoredCommentThreadView,
  reason: string
): AnchoredCommentThread['capture'] {
  return {
    capturedAt: view.createdAt,
    appVersion: 'unknown',
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'unknown',
    route: view.target.route,
    viewport: {
      width: Math.max(1, typeof window === 'undefined' ? 1 : window.innerWidth),
      height: Math.max(1, typeof window === 'undefined' ? 1 : window.innerHeight),
      scaleFactor: Math.max(
        0.1,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
      )
    },
    theme: typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
    locale: typeof document === 'undefined'
      ? undefined
      : document.documentElement.lang || undefined,
    targetLabel: view.target.label,
    targetBounds: view.target.bounds,
    unavailableReason: reason
  }
}

export function threadViewFromPersisted(
  thread: AnchoredCommentThread,
  screenshots: { fullScreenshotUrl?: string; focusedScreenshotUrl?: string } = {}
): AnchoredCommentThreadView {
  const canonical = thread.anchor.canonical
  const issue = thread.feedback.issue
  return {
    id: thread.id,
    kind: thread.purpose,
    target: {
      targetRef: thread.anchor.targetKey,
      label: thread.anchor.targetLabel,
      route: canonical.kind === 'ui' || canonical.kind === 'visual'
        ? canonical.route ?? ''
        : thread.capture.route ?? '',
      bounds: thread.anchor.bounds,
      componentId: canonical.kind === 'ui' ? canonical.componentId : undefined,
      elementId: canonical.kind === 'ui' ? canonical.elementId : undefined,
      resourceType: canonical.kind === 'research' ? canonical.resourceKind : undefined,
      resourceId: canonical.kind === 'research' ? canonical.resourceId : undefined,
      selection: canonical.selection ? JSON.stringify(canonical.selection) : undefined
    },
    comment: thread.messages.find((message) => message.authorKind === 'user')?.body ??
      thread.messages[0]?.body ??
      '',
    createdAt: thread.createdAt,
    status: thread.anchorResolution === 'needs_retargeting'
      ? 'needs_retargeting'
      : thread.status,
    feedbackStatus: thread.feedback.state,
    ...screenshots,
    githubIssue: issue ? { number: issue.issueNumber, url: issue.issueUrl } : undefined,
    error: thread.feedback.error
  }
}

export async function listAnchoredCommentViews(
  client: AnchoredCommentsCapabilityClient,
  workspaceKey: string
): Promise<AnchoredCommentThreadView[]> {
  const result = await client.list(workspaceKey)
  return result.threads.map((thread) => threadViewFromPersisted(thread))
}

async function threadViewWithAssets(
  client: AnchoredCommentsCapabilityClient,
  thread: AnchoredCommentThread
): Promise<AnchoredCommentThreadView> {
  const load = async (
    asset: AnchoredCommentThread['capture']['fullWindowScreenshot']
  ): Promise<string | undefined> => {
    if (!asset) return undefined
    try {
      return (await client.readAsset(asset)).dataUrl
    } catch {
      return undefined
    }
  }
  const [fullScreenshotUrl, focusedScreenshotUrl] = await Promise.all([
    load(thread.capture.fullWindowScreenshot),
    load(thread.capture.focusedScreenshot)
  ])
  return threadViewFromPersisted(thread, {
    ...(fullScreenshotUrl ? { fullScreenshotUrl } : {}),
    ...(focusedScreenshotUrl ? { focusedScreenshotUrl } : {})
  })
}

export async function getAnchoredCommentView(
  client: AnchoredCommentsCapabilityClient,
  threadId: string
): Promise<AnchoredCommentThreadView | null> {
  const result = await client.get(threadId)
  return result.thread ? threadViewWithAssets(client, result.thread) : null
}

function feedbackPacket(
  thread: AnchoredCommentThread,
  disclosure: FeedbackDisclosureChoices
): ProductFeedbackPacket {
  const firstComment =
    thread.messages.find((message) => message.authorKind === 'user') ??
    thread.messages[0]
  const titleTarget = thread.anchor.targetLabel.slice(0, 120)
  const comment = firstComment?.body.trim() || 'SciForge interface feedback'
  const environment = disclosure.applicationEnvironment
    ? {
        'SciForge version': thread.capture.appVersion,
        Platform: thread.capture.platform,
        ...(thread.capture.osVersion ? { 'OS version': thread.capture.osVersion } : {}),
        ...(thread.capture.route ? { Route: thread.capture.route } : {}),
        ...(thread.capture.theme ? { Theme: thread.capture.theme } : {}),
        Viewport:
          `${thread.capture.viewport.width}×${thread.capture.viewport.height} @ ` +
          `${thread.capture.viewport.scaleFactor}x`,
        'Target key': thread.anchor.targetKey
      }
    : undefined
  const body = [
    '## Feedback',
    '',
    comment,
    '',
    '## Commented target',
    '',
    `- Label: ${thread.anchor.targetLabel}`,
    `- Kind: ${thread.anchor.canonical.kind}`,
    `- Captured at: ${thread.capture.capturedAt}`,
    ...(environment
      ? [
          '',
          '## Environment',
          '',
          ...Object.entries(environment).map(([key, value]) => `- ${key}: ${value}`)
        ]
      : [])
  ].join('\n')
  const screenshots = disclosure.annotatedScreenshots
    ? [
        ...(thread.capture.focusedScreenshot
          ? [{ kind: 'focused' as const, asset: thread.capture.focusedScreenshot }]
          : []),
        ...(thread.capture.fullWindowScreenshot
          ? [{ kind: 'full_window' as const, asset: thread.capture.fullWindowScreenshot }]
          : [])
      ]
    : undefined
  const workspacePaths = disclosure.workspacePaths && thread.workspaceKey !== 'global'
    ? [thread.workspaceKey]
    : undefined
  const fileMetadata =
    disclosure.fileMetadata && thread.anchor.canonical.kind === 'research'
      ? [{
          resourceKind: thread.anchor.canonical.resourceKind,
          resourceId: thread.anchor.canonical.resourceId,
          ...(thread.anchor.canonical.contentDigest
            ? { contentDigest: thread.anchor.canonical.contentDigest }
            : {})
        }]
      : undefined
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    idempotencyKey:
      thread.feedback.idempotencyKey ??
      `sciforge-feedback-${thread.id}`.slice(0, 256),
    threadId: thread.id,
    repository: { owner: 'XingYu-Zhong', name: 'SciForge' },
    title: `[UI Feedback] ${titleTarget}`.slice(0, 256),
    body,
    disclosure,
    ...(screenshots?.length ? { screenshots } : {}),
    ...(environment ? { environment } : {}),
    ...(workspacePaths ? { workspacePaths } : {}),
    ...(fileMetadata ? { fileMetadata } : {})
  }
}

export async function submitAnchoredCommentFeedback(
  client: AnchoredCommentsCapabilityClient,
  threadId: string,
  disclosure: FeedbackDisclosureChoices
): Promise<FeedbackSubmissionResult> {
  const result = await client.get(threadId)
  if (!result.thread) {
    return {
      ok: false,
      message: 'Anchored comment thread was not found.',
      retryable: false
    }
  }
  return client.submitFeedback(
    feedbackPacket(result.thread, disclosure),
    result.thread.workspaceKey
  )
}

export async function captureAndPersistThread(
  client: AnchoredCommentsCapabilityClient,
  view: AnchoredCommentThreadView,
  workspaceKey: string
): Promise<AnchoredCommentThreadView> {
  const result = await client.capture({
    targetRef: view.target.targetRef,
    targetBounds: view.target.bounds,
    targetLabel: view.target.label,
    route: view.target.route,
    viewport: {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      scaleFactor: Math.max(0.1, window.devicePixelRatio || 1)
    },
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    locale: document.documentElement.lang || undefined
  }, workspaceKey)
  const capture = result.ok
    ? result.capture
    : fallbackCapture(view, result.message)
  const now = view.createdAt
  const thread: AnchoredCommentThread = {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id: view.id,
    workspaceKey,
    purpose: view.kind,
    anchor: {
      targetKey: targetKey(view.target),
      targetLabel: view.target.label,
      canonical: canonicalTarget(view.target),
      bounds: view.target.bounds
    },
    capture,
    messages: [{
      id: `${view.id}:message:1`.slice(0, 256),
      authorKind: 'user',
      body: view.comment,
      createdAt: now,
      updatedAt: now
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: now,
    updatedAt: now
  }
  return threadViewWithAssets(client, await client.upsert(thread))
}

export async function persistThreadStatus(
  client: AnchoredCommentsCapabilityClient,
  threadId: string,
  status: AnchoredCommentThread['status']
): Promise<void> {
  const result = await client.get(threadId)
  if (!result.thread) return
  await client.upsert({
    ...result.thread,
    status,
    updatedAt: new Date().toISOString()
  })
}

export async function deletePersistedThread(
  client: AnchoredCommentsCapabilityClient,
  threadId: string,
  workspaceId?: string
): Promise<void> {
  await client.delete(threadId, workspaceId)
}
