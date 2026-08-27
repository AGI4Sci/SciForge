import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  acceptanceEnvironmentContract,
  createZulipAcceptanceDriver
} from './collaboration-zulip-acceptance-driver.mjs'

const requiredMethods = [
  'bindParticipant',
  'createPersonalProjection',
  'sendMobileMessage',
  'awaitDesktopTurn',
  'replyFromAgent',
  'awaitMobileMessage',
  'sendDesktopMessage',
  'setAgentOnline',
  'createProject',
  'sendProjectInput',
  'awaitProjectInput',
  'createTask',
  'awaitTaskOffer',
  'completeTask',
  'awaitTaskResult',
  'createHumanNeeded',
  'awaitHumanNeeded',
  'assertNoHumanNeeded',
  'answerHumanNeeded',
  'awaitHumanAnswer',
  'handoffCoordinator',
  'createTaskAsAgent'
]

test('real Zulip acceptance adapter exposes the complete driver contract without reading credentials at import', async () => {
  const values = new Map([
    ['SCIFORGE_COLLAB_ZULIP_SERVER_URL', 'https://collaboration.example.invalid/collaboration'],
    ['SCIFORGE_COLLAB_ZULIP_REALM_URL', 'https://zulip.example.invalid'],
    ['SCIFORGE_COLLAB_ZULIP_STREAM', '验收'],
    ['SCIFORGE_COLLAB_ZULIP_BOT_EMAIL', 'collaboration-bot@example.invalid']
  ])
  const driver = createZulipAcceptanceDriver({ environment: (name) => values.get(name) })
  for (const method of requiredMethods) assert.equal(typeof driver[method], 'function')
  await assert.rejects(driver.bindParticipant({ slot: 'A' }), (error) => {
    assert.equal(error?.code, 'ACCEPTANCE_CONFIGURATION_MISSING')
    assert.doesNotMatch(error.message, /credential|secret|token|api.?key/iu)
    return true
  })
})

test('environment contract publishes names and placeholders only', () => {
  const serialized = JSON.stringify(acceptanceEnvironmentContract)
  assert.match(serialized, /<SLOT>/u)
  assert.match(serialized, /OIDC_ACCESS_TOKEN/u)
  assert.match(serialized, /DEVICE_ID/u)
  assert.match(serialized, /AGENT_CREDENTIAL/u)
  assert.doesNotMatch(serialized, /USER_CREDENTIAL|DEVICE_CREDENTIAL/u)
  assert.doesNotMatch(serialized, /Bearer\s+|Basic\s+|-----BEGIN/u)
})

test('acceptance driver uses only the final plan, offer, execution and result command path', async () => {
  const source = await readFile(new URL('./collaboration-zulip-acceptance-driver.mjs', import.meta.url), 'utf8')
  for (const requiredCommand of [
    'project.plan.submit',
    'project.plan.confirm',
    'project.transition',
    'worker.availability.publish',
    'task.offer.create',
    'task.offer.accept',
    'task.execution.preflight.get',
    'task.execution.start',
    'task.result.submit',
    'task.result.review'
  ]) {
    assert.ok(source.includes(`type: '${requiredCommand}'`), `missing final command ${requiredCommand}`)
  }
  assert.doesNotMatch(source, /memberUserIds|type: 'task\.create'|type: 'task\.transition'|executionFence/u)
})
