import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION,
  ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID,
  ANCHORED_COMMENTS_FEEDBACK_STATUS_EVAL_CASE_ID,
  ANCHORED_COMMENTS_LIST_EVAL_CASE_ID,
  ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID
} from './capability-eval'
import { AnchoredCommentService } from './main/comment-service'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Anchored Comments capability evaluation contribution', () => {
  it('exposes package-owned action coverage while leaving host-dependent actions explicit', () => {
    expect(ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION.actionIds).toHaveLength(8)
    expect(ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds).toEqual([
      'anchored-comments.list',
      'anchored-comments.get',
      'anchored-comments.upsert',
      'anchored-comments.delete',
      'anchored-comments.asset.read',
      'anchored-comments.feedback.status'
    ])
    expect(ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds)
      .not.toContain('anchored-comments.capture')
    expect(ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds)
      .not.toContain('anchored-comments.feedback.submit')
  })

  it('prepares and independently inspects persisted comment and asset state', async () => {
    const workspaceDirectory = await mkdtemp(join(tmpdir(), 'sciforge-anchored-eval-'))
    tempDirs.push(workspaceDirectory)
    const contribution = ANCHORED_COMMENTS_CAPABILITY_EVAL_CONTRIBUTION
    const cases = [
      [ANCHORED_COMMENTS_LIST_EVAL_CASE_ID, 'anchored-comments.list', { workspaceKey: 'eval-workspace' }],
      [ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID, 'anchored-comments.delete', { threadId: 'eval-thread-delete' }],
      [ANCHORED_COMMENTS_READ_ASSET_EVAL_CASE_ID, 'anchored-comments.asset.read', {}],
      [ANCHORED_COMMENTS_FEEDBACK_STATUS_EVAL_CASE_ID, 'anchored-comments.feedback.status', { threadId: 'eval-thread-feedback' }]
    ] as const

    for (const [caseId, actionId, args] of cases) {
      const context = {
        caseId,
        runId: `run-${caseId}`,
        workspaceDirectory,
        userDataDirectory: workspaceDirectory
      }
      const fixture = await contribution.prepare?.(context)
      if (caseId === ANCHORED_COMMENTS_DELETE_EVAL_CASE_ID) {
        await new AnchoredCommentService(workspaceDirectory).deleteThread('eval-thread-delete')
      }
      const result = await contribution.inspect?.({
        context,
        fixture,
        invocations: [{ actionId, args, success: true }]
      })
      expect(result?.taskSuccess).toBe(true)
    }
  })
})
