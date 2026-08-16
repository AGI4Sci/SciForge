import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const enabled = process.env.SCIFORGE_COLLAB_ZULIP_E2E === '1'
const participantSlots = ['A', 'B', 'C', 'D', 'E', 'F']

async function safeStep(label, operation) {
  try {
    return await operation()
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'UNCLASSIFIED_FAILURE'
    throw new Error(`${label} failed (${code})`)
  }
}

async function expectCode(code, operation) {
  try {
    await operation()
  } catch (error) {
    const actual = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'UNCLASSIFIED_FAILURE'
    assert.equal(actual, code)
    return
  }
  assert.fail(`expected ${code}`)
}

function requireDriver(driver) {
  const methods = [
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
  for (const method of methods) {
    assert.equal(typeof driver?.[method], 'function', `acceptance driver must implement ${method}()`)
  }
  return driver
}

test('10.3 real Zulip: six users, two personal sessions, Project workers, directed human answer and coordinator handoff', {
  skip: enabled ? false : 'set SCIFORGE_COLLAB_ZULIP_E2E=1 to run real external acceptance'
}, async () => {
  const driverPath = process.env.SCIFORGE_COLLAB_ZULIP_DRIVER
  assert.ok(driverPath, 'SCIFORGE_COLLAB_ZULIP_DRIVER must point to the production acceptance adapter')
  const module = await safeStep('load acceptance adapter', () => import(pathToFileURL(driverPath).href))
  assert.equal(typeof module.createZulipAcceptanceDriver, 'function')

  const driver = requireDriver(await safeStep('initialize acceptance adapter', () => (
    module.createZulipAcceptanceDriver({
      environment(name) {
        return process.env[name]
      },
      report() {
        process.stdout.write('acceptance:progress\n')
      }
    })
  )))

  const participants = []
  for (const slot of participantSlots) {
    participants.push(await safeStep(`bind participant ${slot}`, () => driver.bindParticipant({ slot })))
  }
  assert.equal(new Set(participants.map((item) => item.userId)).size, 6)
  assert.equal(new Set(participants.map((item) => item.endpointId)).size, 6)
  assert.equal(new Set(participants.map((item) => item.agentId)).size, 6)

  const [a, b, c] = participants
  const projectionA = await safeStep('create personal projection A', () => driver.createPersonalProjection({
    participant: a,
    label: '手机验收-个人会话-A'
  }))
  const projectionB = await safeStep('create personal projection B', () => driver.createPersonalProjection({
    participant: b,
    label: '手机验收-个人会话-B'
  }))

  const mobileMessageA = await safeStep('send mobile message A', () => driver.sendMobileMessage({
    participant: a,
    projection: projectionA,
    text: '真实验收：手机 A 到固定桌面 Session'
  }))
  const desktopTurnA = await safeStep('await desktop turn A', () => driver.awaitDesktopTurn({
    participant: a,
    projection: projectionA,
    sourceMessage: mobileMessageA
  }))
  assert.equal(desktopTurnA.threadId, projectionA.threadId)
  await safeStep('reply from agent A', () => driver.replyFromAgent({
    participant: a,
    projection: projectionA,
    turn: desktopTurnA,
    text: '真实验收：Agent A 回复手机'
  }))
  const mobileReplyA = await safeStep('await mobile reply A', () => driver.awaitMobileMessage({
    participant: a,
    projection: projectionA,
    text: '真实验收：Agent A 回复手机'
  }))
  assert.equal(mobileReplyA.deliveryCount, 1)

  const desktopMessageB = await safeStep('send desktop message B', () => driver.sendDesktopMessage({
    participant: b,
    projection: projectionB,
    text: '真实验收：桌面 B 到手机'
  }))
  const mobileMessageB = await safeStep('await mobile message B', () => driver.awaitMobileMessage({
    participant: b,
    projection: projectionB,
    logicalMessageId: desktopMessageB.logicalMessageId
  }))
  assert.equal(mobileMessageB.deliveryCount, 1)

  await safeStep('disconnect agent A', () => driver.setAgentOnline({ participant: a, online: false }))
  const queuedA = await safeStep('queue mobile message while A is offline', () => driver.sendMobileMessage({
    participant: a,
    projection: projectionA,
    text: '真实验收：离线后只执行一次'
  }))
  assert.equal(queuedA.status, 'queued')
  await safeStep('reconnect agent A', () => driver.setAgentOnline({ participant: a, online: true }))
  const recoveredA = await safeStep('await recovered desktop turn A', () => driver.awaitDesktopTurn({
    participant: a,
    projection: projectionA,
    sourceMessage: queuedA
  }))
  assert.equal(recoveredA.executionCount, 1)

  const project = await safeStep('create six-user project', () => driver.createProject({
    owner: a,
    members: participants,
    coordinator: a,
    label: '手机验收-六用户协作'
  }))
  const sourceInputs = await Promise.all([a, b, c].map((participant, index) => safeStep(
    `send project input ${participantSlots[index]}`,
    () => driver.sendProjectInput({
      participant,
      project,
      text: `真实验收：ProjectInput ${participantSlots[index]}`
    })
  )))
  const projectedInputs = []
  for (const sourceInput of sourceInputs) {
    projectedInputs.push(await safeStep('await project input', () => driver.awaitProjectInput({
      coordinator: a,
      project,
      sourceInput
    })))
  }
  assert.deepEqual(projectedInputs.map((input) => input.senderUserId), [a.userId, b.userId, c.userId])

  const [taskB, taskC] = await Promise.all([
    safeStep('create task B', () => driver.createTask({ coordinator: a, project, assignee: b, label: 'worker-b' })),
    safeStep('create task C', () => driver.createTask({ coordinator: a, project, assignee: c, label: 'worker-c' }))
  ])
  const [offerB, offerC] = await Promise.all([
    safeStep('await task offer B', () => driver.awaitTaskOffer({ participant: b, task: taskB })),
    safeStep('await task offer C', () => driver.awaitTaskOffer({ participant: c, task: taskC }))
  ])
  const [resultB, resultC] = await Promise.all([
    safeStep('complete task B', () => driver.completeTask({ participant: b, offer: offerB, result: 'worker-b-result' })),
    safeStep('complete task C', () => driver.completeTask({ participant: c, offer: offerC, result: 'worker-c-result' }))
  ])
  await Promise.all([
    safeStep('await task result B', () => driver.awaitTaskResult({ coordinator: a, task: taskB, result: resultB })),
    safeStep('await task result C', () => driver.awaitTaskResult({ coordinator: a, task: taskC, result: resultC }))
  ])

  const humanNeeded = await safeStep('create HumanNeeded for B', () => driver.createHumanNeeded({
    participant: b,
    project,
    task: taskB,
    target: b,
    text: '真实验收：只由 B 回答'
  }))
  await safeStep('await HumanNeeded on B', () => driver.awaitHumanNeeded({ participant: b, humanNeeded }))
  await safeStep('assert HumanNeeded absent on A', () => driver.assertNoHumanNeeded({ participant: a, humanNeeded }))
  await expectCode('HUMAN_TARGET_REQUIRED', () => driver.answerHumanNeeded({
    participant: a,
    humanNeeded,
    text: 'A 不得代答'
  }))
  const humanAnswer = await safeStep('answer HumanNeeded as B', () => driver.answerHumanNeeded({
    participant: b,
    humanNeeded,
    text: 'B 的真实回答'
  }))
  await safeStep('await HumanAnswer at coordinator', () => driver.awaitHumanAnswer({
    coordinator: a,
    humanNeeded,
    humanAnswer
  }))

  const handedOff = await safeStep('handoff coordinator A to C', () => driver.handoffCoordinator({
    owner: a,
    project,
    from: a,
    to: c
  }))
  assert.equal(handedOff.coordinatorAgentId, c.agentId)
  await expectCode('COORDINATOR_REQUIRED', () => driver.createTaskAsAgent({
    agent: a,
    project,
    assignee: b,
    label: 'old-coordinator-must-fail'
  }))
  await safeStep('new coordinator creates task', () => driver.createTaskAsAgent({
    agent: c,
    project,
    assignee: b,
    label: 'new-coordinator-succeeds'
  }))
})
