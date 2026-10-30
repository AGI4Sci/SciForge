import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererWorkbenchHost, DomainWorkbenchOpenSessionInput } from '@sciforge/domain-sdk/host'
import { COLLABORATION_MAIN_AREA_CONTRIBUTION } from '../definition.js'
import { openCollaborationTaskSession } from './task-session-navigation.js'

test('task editing opens its exact standard Session with a package-owned return activation', async () => {
  let request: DomainWorkbenchOpenSessionInput | undefined
  const workbench: DomainRendererWorkbenchHost = {
    openRightPanel: () => { throw new Error('must not open a parallel panel') },
    openSession: async input => { request = input; return true }
  }
  assert.equal(await openCollaborationTaskSession(workbench,
    { runtimeId: 'codex', threadId: 'worker-thread' },
    { projectId: 'project-1', taskId: 'task-1', taskReference: '#1' }), true)
  assert.deepEqual(request, {
    runtimeId: 'codex', threadId: 'worker-thread', focusComposer: true,
    returnTo: {
      contributionId: COLLABORATION_MAIN_AREA_CONTRIBUTION.id,
      label: '协作任务 #1 · 返回交付草稿',
      activation: { revision: 1, payload: { projectId: 'project-1', taskId: 'task-1' } }
    }
  })
})

test('unavailable or incomplete Session bindings never use a different active Session', async () => {
  const task = { projectId: 'project-1', taskId: 'task-1', taskReference: '#1' }
  assert.equal(await openCollaborationTaskSession(undefined, { runtimeId: 'codex', threadId: 'worker-thread' }, task), false)
  assert.equal(await openCollaborationTaskSession({ openRightPanel: () => undefined },
    { runtimeId: 'codex', threadId: 'worker-thread' }, task), false)
  assert.equal(await openCollaborationTaskSession({ openRightPanel: () => undefined,
    openSession: async () => { throw new Error('invalid binding must not navigate') } },
  { runtimeId: 'codex', threadId: '' }, task), false)
})
