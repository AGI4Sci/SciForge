import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  type AnchoredCommentCaptureRequest,
  type AnchoredCommentCaptureResult,
  type AnchoredCommentThread,
  type CommentCanonicalTarget,
  type FeedbackDisclosureChoices,
  type FeedbackSubmissionResult,
  type ProductFeedbackPacket
} from '@shared/anchored-comments'
import type { AnchoredCommentThreadView, CommentTargetInspection } from './types'
import { useChatStore } from '../../store/chat-store'

type RendererAnchoredCommentsApi = {
  list?: (filter?: { workspaceKey?: string }) => Promise<AnchoredCommentThread[]>
  get?: (threadId: string) => Promise<AnchoredCommentThread | null>
  upsert?: (thread: AnchoredCommentThread) => Promise<AnchoredCommentThread>
  delete?: (threadId: string) => Promise<boolean | { ok: boolean }>
  readAsset?: (asset: NonNullable<AnchoredCommentThread['capture']['fullWindowScreenshot']>) => Promise<{
    digest: string
    mimeType: 'image/png'
    dataUrl: string
  }>
  capture?: (request: AnchoredCommentCaptureRequest) => Promise<AnchoredCommentCaptureResult>
  submitFeedback?: (request: { packet: ProductFeedbackPacket }) => Promise<FeedbackSubmissionResult>
}

function rendererApi(): RendererAnchoredCommentsApi | null {
  if (typeof window === 'undefined') return null
  return (window.sciforge as unknown as { anchoredComments?: RendererAnchoredCommentsApi })
    .anchoredComments ?? null
}

function selectionFromTarget(target: CommentTargetInspection): Record<string, string | number | boolean | null> | undefined {
  if (!target.selection) return undefined
  try {
    const parsed = JSON.parse(target.selection) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number | boolean | null>
    }
  } catch {
    // A short opaque selection remains useful without making the DOM attribute require JSON.
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
  return `visual:${target.route}:${target.bounds.x}:${target.bounds.y}:${target.bounds.width}:${target.bounds.height}:${target.selection ?? ''}`.slice(0, 2_048)
}

function redactionBounds(): AnchoredCommentCaptureRequest['redactionBounds'] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll([
    '[data-sciforge-comment-deny]',
    '[data-sciforge-comment-sensitive]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]'
  ].join(','))).slice(0, 64).flatMap((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return []
    return [{
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }]
  })
}

function fallbackCapture(view: AnchoredCommentThreadView, reason: string): AnchoredCommentThread['capture'] {
  return {
    capturedAt: view.createdAt,
    appVersion: 'unknown',
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'unknown',
    route: view.target.route,
    viewport: {
      width: Math.max(1, typeof window === 'undefined' ? 1 : window.innerWidth),
      height: Math.max(1, typeof window === 'undefined' ? 1 : window.innerHeight),
      scaleFactor: Math.max(0.1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    },
    theme: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    locale: typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined,
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
      label: thread.anchor.targetLabel,
      route: canonical.kind === 'ui' || canonical.kind === 'visual' ? canonical.route ?? '' : thread.capture.route ?? '',
      bounds: thread.anchor.bounds,
      componentId: canonical.kind === 'ui' ? canonical.componentId : undefined,
      elementId: canonical.kind === 'ui' ? canonical.elementId : undefined,
      resourceType: canonical.kind === 'research' ? canonical.resourceKind : undefined,
      resourceId: canonical.kind === 'research' ? canonical.resourceId : undefined,
      selection: canonical.selection
        ? JSON.stringify(canonical.selection)
        : undefined,
      domFingerprint: thread.anchor.domFingerprint?.path?.map((segment) => segment.tagName) ?? []
    },
    comment: thread.messages.find((message) => message.authorKind === 'user')?.body ?? thread.messages[0]?.body ?? '',
    createdAt: thread.createdAt,
    status: thread.anchorResolution === 'needs_retargeting' ? 'needs_retargeting' : thread.status,
    feedbackStatus: thread.feedback.state,
    ...screenshots,
    githubIssue: issue ? { number: issue.issueNumber, url: issue.issueUrl } : undefined,
    error: thread.feedback.error
  }
}

export async function listAnchoredCommentViews(workspaceKey: string): Promise<AnchoredCommentThreadView[] | null> {
  const api = rendererApi()
  if (!api?.list) return null
  const threads = await api.list({ workspaceKey })
  return threads.map((thread) => threadViewFromPersisted(thread))
}

async function threadViewWithAssets(thread: AnchoredCommentThread): Promise<AnchoredCommentThreadView> {
  const api = rendererApi()
  const load = async (
    asset: AnchoredCommentThread['capture']['fullWindowScreenshot']
  ): Promise<string | undefined> => {
    if (!asset || !api?.readAsset) return undefined
    try {
      return (await api.readAsset(asset)).dataUrl
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

export async function getAnchoredCommentView(threadId: string): Promise<AnchoredCommentThreadView | null> {
  const thread = await rendererApi()?.get?.(threadId)
  return thread ? threadViewWithAssets(thread) : null
}

function feedbackPacket(
  thread: AnchoredCommentThread,
  disclosure: FeedbackDisclosureChoices
): ProductFeedbackPacket {
  const firstComment = thread.messages.find((message) => message.authorKind === 'user') ?? thread.messages[0]
  const titleTarget = thread.anchor.targetLabel.slice(0, 120)
  const comment = firstComment?.body.trim() || 'SciForge interface feedback'
  const environment = disclosure.applicationEnvironment
    ? {
        'SciForge version': thread.capture.appVersion,
        Platform: thread.capture.platform,
        ...(thread.capture.osVersion ? { 'OS version': thread.capture.osVersion } : {}),
        ...(thread.capture.route ? { Route: thread.capture.route } : {}),
        ...(thread.capture.theme ? { Theme: thread.capture.theme } : {}),
        Viewport: `${thread.capture.viewport.width}×${thread.capture.viewport.height} @ ${thread.capture.viewport.scaleFactor}x`,
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
      ? ['', '## Environment', '', ...Object.entries(environment).map(([key, value]) => `- ${key}: ${value}`)]
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
  const chatState = useChatStore.getState()
  const logs = disclosure.logs
    ? [chatState.error, chatState.runtimeErrorDetail].filter((value): value is string => Boolean(value?.trim())).join('\n\n').slice(0, 200_000) || undefined
    : undefined
  const conversationExcerpt = disclosure.conversationExcerpt
    ? chatState.blocks.slice(-12).flatMap((block) => {
        if (block.kind !== 'user' && block.kind !== 'assistant') return []
        const text = typeof block.text === 'string' ? block.text.trim() : ''
        return text ? [`${block.kind}: ${text}`] : []
      }).join('\n\n').slice(0, 100_000) || undefined
    : undefined
  const workspacePaths = disclosure.workspacePaths && thread.workspaceKey !== 'global'
    ? [thread.workspaceKey]
    : undefined
  const fileMetadata = disclosure.fileMetadata && thread.anchor.canonical.kind === 'research'
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
    idempotencyKey: thread.feedback.idempotencyKey ?? `sciforge-feedback-${thread.id}`.slice(0, 256),
    threadId: thread.id,
    repository: { owner: 'XingYu-Zhong', name: 'SciForge' },
    title: `[UI Feedback] ${titleTarget}`.slice(0, 256),
    body,
    disclosure,
    ...(screenshots?.length ? { screenshots } : {}),
    ...(environment ? { environment } : {}),
    ...(logs ? { logs } : {}),
    ...(conversationExcerpt ? { conversationExcerpt } : {}),
    ...(workspacePaths ? { workspacePaths } : {}),
    ...(fileMetadata ? { fileMetadata } : {})
  }
}

export async function submitAnchoredCommentFeedback(
  threadId: string,
  disclosure: FeedbackDisclosureChoices
): Promise<FeedbackSubmissionResult> {
  const api = rendererApi()
  if (!api?.get || !api.submitFeedback) {
    return { ok: false, message: 'Product feedback submission is unavailable in this build.', retryable: false }
  }
  const thread = await api.get(threadId)
  if (!thread) return { ok: false, message: 'Anchored comment thread was not found.', retryable: false }
  return api.submitFeedback({ packet: feedbackPacket(thread, disclosure) })
}

export async function captureAndPersistThread(
  view: AnchoredCommentThreadView,
  workspaceKey: string
): Promise<AnchoredCommentThreadView | null> {
  const api = rendererApi()
  if (!api?.upsert) return null
  let capture: AnchoredCommentThread['capture']
  if (api.capture) {
    const result = await api.capture({
      targetBounds: view.target.bounds,
      redactionBounds: redactionBounds(),
      targetLabel: view.target.label,
      route: view.target.route,
      viewport: {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
        scaleFactor: Math.max(0.1, window.devicePixelRatio || 1)
      },
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      locale: document.documentElement.lang || undefined
    })
    capture = result.ok ? result.capture : fallbackCapture(view, result.message)
  } else {
    capture = fallbackCapture(view, 'Screenshot capture is not available in this build.')
  }

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
      domFingerprint: {
        tagName: (view.target.domFingerprint.at(-1) ?? 'unknown').slice(0, 64),
        accessibleName: view.target.label,
        commentId: view.target.elementId,
        path: view.target.domFingerprint.map((tagName) => ({ tagName: tagName.slice(0, 64) }))
      },
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
  return threadViewWithAssets(await api.upsert(thread))
}

export async function persistThreadStatus(
  threadId: string,
  status: AnchoredCommentThread['status']
): Promise<void> {
  const api = rendererApi()
  if (!api?.get || !api.upsert) return
  const thread = await api.get(threadId)
  if (!thread) return
  await api.upsert({ ...thread, status, updatedAt: new Date().toISOString() })
}

export async function deletePersistedThread(threadId: string): Promise<void> {
  await rendererApi()?.delete?.(threadId)
}
