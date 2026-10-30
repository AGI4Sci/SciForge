import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalOracleResult,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  ANCHORED_COMMENT_SCHEMA_VERSION,
  anchoredCommentThreadSchema,
  type AnchoredCommentThread,
  type CommentScreenshotAssetRef,
  type AnchoredCommentStore
} from './contract'
import {
  AnchoredCommentService,
  anchoredCommentAssetPath,
  anchoredCommentStorePath
} from './main/comment-service'
import { ANCHORED_COMMENTS_DOMAIN_MODULE_ID } from './definition'

export const ANCHORED_COMMENTS_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
export const ANCHORED_COMMENTS_LIST_EVAL_CASE_ID = 'anchored-comments-list-local-fixture'
export const ANCHORED_COMMENTS_GET_EVAL_CASE_ID = 'anchored-comments-get-local-fixture'
export const ANCHORED_COMMENTS_UPSERT_EVAL_CASE_ID = 'anchored-comments-upsert-local-fixture'
export const ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID = 'anchored-comments-delete-local-fixture'
export const ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID = 'anchored-comments-read-asset-local-fixture'
export const ANCHORED_COMMENTS_FEEDBACK_STATUS_EVAL_CASE_ID = 'anchored-comments-feedback-status-local-fixture'

const ANCHORED_COMMENTS_EVAL_CASE_IDS = new Set([
  ANCHORED_COMMENTS_LIST_EVAL_CASE_ID,
  ANCHORED_COMMENTS_GET_EVAL_CASE_ID,
  ANCHORED_COMMENTS_UPSERT_EVAL_CASE_ID,
  ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID,
  ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID,
  ANCHORED_COMMENTS_FEEDBACK_STATUS_EVAL_CASE_ID
])
const ANCHORED_COMMENTS_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'core.comments.review': ANCHORED_COMMENTS_LIST_EVAL_CASE_ID
})

const EVAL_WORKSPACE_KEY = 'eval-workspace'
const EVAL_TARGET_KEY = 'figure:eval'
const EVAL_ASSET_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42, 0, 0, 0])
const EVAL_ASSET_DIGEST = createHash('sha256').update(EVAL_ASSET_BYTES).digest('hex')

export const ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: ANCHORED_COMMENTS_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: Object.values(ANCHORED_COMMENT_CAPABILITY_IDS),
  evaluationActionIds: [
    ANCHORED_COMMENT_CAPABILITY_IDS.list,
    ANCHORED_COMMENT_CAPABILITY_IDS.get,
    ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
    ANCHORED_COMMENT_CAPABILITY_IDS.delete,
    ANCHORED_COMMENT_CAPABILITY_IDS.readAsset,
    ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus
  ],
  prepare: prepareAnchoredCommentsEvaluationFixture,
  inspect: inspectAnchoredCommentsEvaluation
})

async function prepareAnchoredCommentsEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = anchoredCommentsEvaluationCaseId(context)
  if (!ANCHORED_COMMENTS_EVAL_CASE_IDS.has(caseId)) return undefined
  const userDataDirectory = context.userDataDirectory ?? join(context.workspaceDirectory, '.sciforge-anchored-comments-eval')
  const service = new AnchoredCommentService(userDataDirectory)
  const paths = [relative(context.workspaceDirectory, anchoredCommentStorePath(userDataDirectory))]

  if (caseId === ANCHORED_COMMENTS_LIST_EVAL_CASE_ID ||
      caseId === ANCHORED_COMMENTS_GET_EVAL_CASE_ID) {
    await service.upsertThread(makeThread('eval-thread-readable', 'Read this deterministic comment.'))
  } else if (caseId === ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID) {
    await service.upsertThread(makeThread('eval-thread-delete', 'Delete this deterministic comment.'))
  } else if (caseId === ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID) {
    const asset = await service.putScreenshotAsset(EVAL_ASSET_BYTES, { width: 2, height: 2 })
    await service.upsertThread(makeThread('eval-thread-asset', 'Read the stored screenshot.', asset))
    paths.push(relative(context.workspaceDirectory, anchoredCommentAssetPath(userDataDirectory, asset)))
  } else if (caseId === ANCHORED_COMMENTS_FEEDBACK_STATUS_EVAL_CASE_ID) {
    await service.upsertThread({
      ...makeThread('eval-thread-feedback', 'Read the local feedback state.'),
      purpose: 'product_feedback'
    })
  }

  return {
    fixtureId: `anchored-comments.${caseId}.v1`,
    paths,
    metadata: {
      userDataDirectory,
      expectedWorkspaceKey: EVAL_WORKSPACE_KEY,
      expectedTargetKey: EVAL_TARGET_KEY,
      ...(caseId === ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID
        ? { expectedAssetDigest: EVAL_ASSET_DIGEST }
        : {})
    }
  }
}

async function inspectAnchoredCommentsEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = anchoredCommentsEvaluationCaseId(input.context)
  if (!ANCHORED_COMMENTS_EVAL_CASE_IDS.has(caseId)) return undefined
  const userDataDirectory = input.context.userDataDirectory ?? join(input.context.workspaceDirectory, '.sciforge-anchored-comments-eval')
  const store = await readStore(userDataDirectory)
  if (!store) {
    return { taskSuccess: false, evidence: ['Anchored Comments persisted store was not readable.'], verifiedActions: [] }
  }

  if (caseId === ANCHORED_COMMENTS_LIST_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.list)
    const thread = store.threads.find((candidate) => candidate.id === 'eval-thread-readable')
    if (!invocation || !thread || !matchesArgs(invocation.args, { workspaceKey: EVAL_WORKSPACE_KEY })) {
      return { taskSuccess: false, evidence: ['List did not preserve and expose the deterministic comment store entry.'], verifiedActions: [] }
    }
    return success(ANCHORED_COMMENT_CAPABILITY_IDS.list, 'Independently read comments.json and verified the workspace-filtered thread.')
  }

  if (caseId === ANCHORED_COMMENTS_GET_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.get)
    const thread = store.threads.find((candidate) => candidate.id === 'eval-thread-readable')
    if (!invocation || !thread || !matchesArgs(invocation.args, { threadId: thread.id })) {
      return { taskSuccess: false, evidence: ['Get did not read the deterministic thread from the persisted store.'], verifiedActions: [] }
    }
    return success(ANCHORED_COMMENT_CAPABILITY_IDS.get, 'Independently read comments.json and verified the requested thread identity.')
  }

  if (caseId === ANCHORED_COMMENTS_UPSERT_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.upsert)
    const thread = store.threads.find((candidate) => candidate.id === 'eval-thread-upsert')
    if (!invocation || !thread || thread.messages[0]?.body !== 'Persist this deterministic comment.') {
      return { taskSuccess: false, evidence: ['Upsert did not persist the expected thread contents in comments.json.'], verifiedActions: [] }
    }
    return success(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, 'Independently read comments.json and verified the new thread and message body.')
  }

  if (caseId === ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.delete)
    const deleted = !store.threads.some((candidate) => candidate.id === 'eval-thread-delete')
    if (!invocation || !deleted || !matchesArgs(invocation.args, { threadId: 'eval-thread-delete' })) {
      return { taskSuccess: false, evidence: ['Delete did not remove the expected thread from comments.json.'], verifiedActions: [] }
    }
    return success(ANCHORED_COMMENT_CAPABILITY_IDS.delete, 'Independently read comments.json and verified the target thread is absent.')
  }

  if (caseId === ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.readAsset)
    const asset = store.threads.find((candidate) => candidate.id === 'eval-thread-asset')?.capture.focusedScreenshot
    if (!invocation || !asset || asset.digest !== EVAL_ASSET_DIGEST) {
      return { taskSuccess: false, evidence: ['The persisted comment did not retain the expected content-addressed asset.'], verifiedActions: [] }
    }
    try {
      const bytes = await readFile(anchoredCommentAssetPath(userDataDirectory, asset))
      if (createHash('sha256').update(bytes).digest('hex') !== asset.digest) throw new Error('asset digest mismatch')
    } catch {
      return { taskSuccess: false, evidence: ['The independent asset readback failed its SHA-256 integrity check.'], verifiedActions: [] }
    }
    return success(ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, 'Independently read the content-addressed PNG and verified its SHA-256 digest.')
  }

  const invocation = successfulInvocation(input.invocations, ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus)
  const thread = store.threads.find((candidate) => candidate.id === 'eval-thread-feedback')
  if (!invocation || !thread || thread.feedback.state !== 'local' || !matchesArgs(invocation.args, { threadId: thread.id })) {
    return { taskSuccess: false, evidence: ['Feedback status did not match the independently persisted local state.'], verifiedActions: [] }
  }
  return success(ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, 'Independently read comments.json and verified the local feedback state.')
}

function anchoredCommentsEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && ANCHORED_COMMENTS_ROUTING_PROFILES[context.fixtureProfile]
    ? ANCHORED_COMMENTS_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

function makeThread(
  id: string,
  body: string,
  asset?: CommentScreenshotAssetRef
): AnchoredCommentThread {
  const timestamp = '2026-09-17T00:00:00.000Z'
  return anchoredCommentThreadSchema.parse({
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id,
    workspaceKey: EVAL_WORKSPACE_KEY,
    purpose: 'research',
    anchor: {
      targetKey: EVAL_TARGET_KEY,
      targetLabel: 'Evaluation figure',
      canonical: { kind: 'research', resourceKind: 'figure', resourceId: 'figure-eval' },
      bounds: { x: 10, y: 10, width: 120, height: 80 }
    },
    capture: {
      capturedAt: timestamp,
      appVersion: 'eval',
      platform: 'test',
      viewport: { width: 400, height: 300, scaleFactor: 1 },
      targetLabel: 'Evaluation figure',
      targetBounds: { x: 10, y: 10, width: 120, height: 80 },
      ...(asset ? { focusedScreenshot: asset } : { unavailableReason: 'No visual capture in deterministic fixture.' })
    },
    messages: [{
      id: `${id}-message`,
      authorKind: 'user',
      body,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: timestamp,
    updatedAt: timestamp
  })
}

async function readStore(userDataDirectory: string): Promise<AnchoredCommentStore | undefined> {
  try {
    return JSON.parse(await readFile(anchoredCommentStorePath(userDataDirectory), 'utf8')) as AnchoredCommentStore
  } catch {
    return undefined
  }
}

function successfulInvocation(
  invocations: readonly DomainCapabilityEvalObservedInvocation[],
  actionId: string
): DomainCapabilityEvalObservedInvocation | undefined {
  return [...invocations].reverse().find((invocation) => invocation.actionId === actionId && invocation.success)
}

function matchesArgs(args: DomainPackageJsonValue, expected: Record<string, unknown>): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  return Object.entries(expected).every(([key, value]) => JSON.stringify((args as Record<string, unknown>)[key]) === JSON.stringify(value))
}

function success(actionId: string, evidence: string): DomainCapabilityEvalOracleResult {
  return {
    taskSuccess: true,
    finalState: { actionId, storePath: 'anchored-comments/comments.json' },
    evidence: [evidence],
    verifiedActions: [actionId]
  }
}
