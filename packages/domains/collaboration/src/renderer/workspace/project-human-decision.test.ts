import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerReviewedHumanRequest } from './human-request-decision.js'
import type { HumanNeeded } from '@sciforge/collaboration-contracts'

test('project choice answers use the reviewed authority epoch and option rather than requiring a worker execution', async () => {
  const request = { humanRequestId: 'hrq_Human0000001', projectId: 'prj_Proj00000001', targetUserId: 'usr_User00000001', revision: 2, prompt: 'Recovery?', status: 'pending', expiresAt: '2099-01-01T00:00:00Z', confirmableAction: null, context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: 3 }, interaction: { kind: 'choice', options: [{ id: 'retry', label: 'Retry' }, { id: 'manual', label: 'Manual' }] } } as HumanNeeded
  const writes: unknown[] = []
  let epoch = 3
  const client = { readWorkspace: async () => ({ connection: { state: 'ready', userId: request.targetUserId }, projects: [{ project: { projectId: request.projectId, coordinatorAuthorityEpoch: epoch }, pendingHumanNeeded: [request] }] }), answerHumanNeeded: async (input: unknown) => { writes.push(input) } } as never
  await answerReviewedHumanRequest(client, request, request.targetUserId, 'Retry', undefined, 'retry')
  assert.equal((writes[0] as { selectedOptionId: string }).selectedOptionId, 'retry')
  epoch++
  await assert.rejects(answerReviewedHumanRequest(client, request, request.targetUserId, 'Retry', undefined, 'retry'))
  assert.equal(writes.length, 1)
})

import { collaborationFailure } from './collaboration-errors.js'
test('expired approval assurance asks for a new sign-in without claiming approval', () => {
  assert.match(collaborationFailure(new Error('assurance_insufficient: recent sign-in required')).message, /重新登录 SciForge/u)
})
