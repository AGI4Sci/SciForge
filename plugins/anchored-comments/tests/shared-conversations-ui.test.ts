import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { sharedConversationsPanel } from '../src/ui/shared-conversations.js'
import { researchThread } from './fixtures.js'

const projectId = 'prj_SharedProject001', other = 'prj_SharedProject002'
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)) }
const result = (id = projectId, conversations: unknown[] = []) => ({ projectId: id, conversations, pendingCount: 0, afterSequence: 2 })
function fixture() {
  const window = new Window()
  Object.assign(globalThis, { document: window.document })
  const thread = researchThread('local-code')
  thread.anchor.codeAnchor = { filePath: 'src/example.ts', side: 'new', line: 3, hunkHeader: '@@', code: 'const secret = 1', baseRevision: 'abc', contentDigest: 'a'.repeat(64) }
  thread.messages.push({ ...thread.messages[0], id: 'private-message', body: 'Private unselected message' })
  return { window, thread }
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(item => item.textContent === text)!

test('publication requires explicit message selection and code disclosure; wire contains only selected IDs', async () => {
  const { window, thread } = fixture(), calls: { action: string; input: unknown }[] = []
  const panel = sharedConversationsPanel({ listLocalThreads: () => [thread], invoke: async (action, input) => { calls.push({ action, input }); return result() } })
  panel.setProject(projectId)
  const publish = button(panel.root, '发布所选消息')
  publish.click(); await flush(); assert.equal(calls.length, 0)
  const local = panel.root.querySelector('[aria-label="发布本地消息"]')!
  const checkboxes = local.querySelectorAll<HTMLInputElement>('input')
  assert.equal(checkboxes[0].checked, false)
  checkboxes[0].checked = true; publish.click(); await flush(); assert.equal(calls.length, 0)
  checkboxes[2].checked = true
  assert.match(local.textContent!, /const secret = 1/)
  publish.click(); await flush()
  assert.equal(calls[0].action, 'anchored-comments.shared.publish')
  const input = calls[0].input as Record<string, unknown>
  assert.deepEqual(input.messageIds, [thread.messages[0].id])
  assert.deepEqual(Object.keys(input).sort(), ['idempotencyKey', 'messageIds', 'projectId', 'requestId', 'threadId'])
  assert.doesNotMatch(JSON.stringify(input), /Private unselected|capture|workspace|secret/)
  panel.dispose(); await window.happyDOM.close()
})

test('unknown publication retries exact identity and refuses changed local payload reuse', async () => {
  const { window, thread } = fixture(), calls: unknown[] = []
  const panel = sharedConversationsPanel({ listLocalThreads: () => [thread], invoke: async (_action, input) => { calls.push(input); throw new Error('Host timeout') } })
  panel.setProject(projectId)
  const inputs = panel.root.querySelectorAll<HTMLInputElement>('[aria-label="发布本地消息"] input')
  inputs[0].checked = true; inputs[2].checked = true
  button(panel.root, '发布所选消息').click(); await flush()
  button(panel.root, '重试原操作').click(); await flush()
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0])
  thread.messages[0].body = 'Changed content'
  button(panel.root, '重试原操作').click(); await flush()
  assert.equal(calls.length, 2)
  assert.match(panel.root.querySelector('[role="status"]')!.textContent!, /不能复用操作身份/)
  panel.dispose(); await window.happyDOM.close()
})

test('project change and scope reset fence late responses, including errors', async () => {
  const { window } = fixture()
  const finishes: ((value: unknown) => void)[] = []
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async () => await new Promise(resolve => finishes.push(resolve)) })
  panel.setProject(projectId); button(panel.root, '刷新共享讨论').click()
  panel.setProject(other); button(panel.root, '刷新共享讨论').click()
  finishes[0](result(projectId)); await flush()
  assert.equal(panel.root.querySelector('[aria-label="共享讨论列表"]')!.textContent!.includes('example.ts'), false)
  assert.equal(button(panel.root, '刷新共享讨论').disabled, true)
  panel.resetScope(); finishes[1]({ invalid: true }); await flush()
  assert.equal(panel.root.querySelector('[role="status"]')!.textContent, '')
  assert.equal(button(panel.root, '刷新共享讨论').disabled, true)
  panel.dispose(); await window.happyDOM.close()
})

test('shared replies and forks retry frozen canonical commands; status observes displayed revision and message', async () => {
  const { window, thread } = fixture(), calls: { action: string; input: unknown }[] = []
  const message = { messageId: 'shared-message', kind: 'user', body: 'Published', publishedByUserId: 'usr_SharedAuthor001', publishedAt: '2026-07-11T00:00:00.000Z' }
  const conversation = { projectId, conversationId: 'shared-thread', anchor: thread.anchor.codeAnchor,
    createdByUserId: message.publishedByUserId, createdAt: message.publishedAt, revision: 3, status: 'open', messages: [message],
    fork: { parentConversationId: 'parent', parentMessageId: 'parent-message', messages: [{ ...message, body: 'Frozen parent prefix' }], truncated: true } }
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async (action, input) => {
    calls.push({ action, input })
    if (action.endsWith('.submit')) throw new Error('unknown outcome')
    return result(projectId, [conversation])
  } })
  panel.setProject(projectId); button(panel.root, '刷新共享讨论').click(); await flush()
  assert.match(panel.root.textContent!, /Frozen parent prefix/)
  panel.root.querySelector('textarea')!.value = 'Reply'
  button(panel.root, '发送共享回复').click(); await flush()
  panel.root.querySelector('textarea')!.value = 'Different reply'
  button(panel.root, '重试原操作').click(); await flush()
  assert.deepEqual(calls[2], calls[1])
  const command = (calls[1].input as { command: Record<string, unknown> }).command
  assert.equal(command.type, 'project.code_conversation.append')
  assert.deepEqual(Object.keys(command).sort(), ['conversationId', 'idempotencyKey', 'message', 'projectId', 'protocolVersion', 'requestId', 'type'])
  panel.resetScope(); panel.setProject(projectId)
  button(panel.root, '刷新共享讨论').click(); await flush()
  button(panel.root, '解决共享讨论').click(); await flush()
  const status = (calls.at(-1)!.input as { command: Record<string, unknown> }).command
  assert.equal(status.expectedRevision, 3); assert.equal(status.observedMessageId, message.messageId)
  panel.resetScope(); panel.setProject(projectId); button(panel.root, '刷新共享讨论').click(); await flush()
  panel.root.querySelector('textarea')!.value = 'Fork question'
  button(panel.root, '从此消息分叉').click(); await flush()
  button(panel.root, '重试原操作').click(); await flush()
  assert.deepEqual(calls.at(-1), calls.at(-2))
  const fork = (calls.at(-1)!.input as { command: Record<string, unknown> }).command
  assert.equal(fork.parentConversationId, 'shared-thread'); assert.equal(fork.parentMessageId, 'shared-message')
  panel.dispose(); await window.happyDOM.close()
})

test('refresh is read only and retry pending writes requires explicit confirmation', async () => {
  const { window } = fixture(), calls: string[] = []
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async action => { calls.push(action); return result() } })
  panel.setProject(projectId); button(panel.root, '刷新共享讨论').click(); await flush()
  button(panel.root, '重试待发送写入').click(); await flush()
  assert.deepEqual(calls, ['anchored-comments.shared.pull'])
  const confirm = panel.root.querySelector<HTMLInputElement>('input')!
  confirm.checked = true; confirm.dispatchEvent(new window.Event('change') as unknown as Event)
  button(panel.root, '重试待发送写入').click(); await flush()
  assert.deepEqual(calls, ['anchored-comments.shared.pull', 'anchored-comments.shared.retry'])
  panel.dispose(); await window.happyDOM.close()
})

test('Project discovery uses canonical titles and load-more cursor without selecting or writing automatically', async () => {
  const { window } = fixture(), calls: { action: string; input: unknown }[] = []
  const timestamp = '2026-07-11T00:00:00.000Z'
  const project = (id: string, displayName: string) => ({ schemaVersion: 1, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    type: 'project', projectId: id, ownerUserId: 'usr_SharedAuthor001', displayName, goal: 'Research',
    coordinatorAgentId: 'agt_SharedAgent001', coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1,
    status: 'active', budget: { maxTasks: 10, maxTasksPerRound: 2, maxCoordinationRounds: 3, maxTaskRetries: 1 } })
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async (action, input) => {
    calls.push({ action, input })
    const cursor = (input as { cursor?: string }).cursor
    return { protocolVersion: '1.0', type: 'rest.project_page', requestId: 'req_DiscoveryTest001', limit: 100,
      observedAt: timestamp, ...(cursor ? { cursor } : { nextCursor: 'page-two' }),
      projects: [project(cursor ? other : projectId, cursor ? 'Second Project' : 'First Project')] }
  } })
  button(panel.root, '读取 Projects').click(); await flush()
  assert.equal(button(panel.root, '刷新共享讨论').disabled, true)
  const dropdown = panel.root.querySelector('select')!
  assert.equal(dropdown.options[1].textContent, 'First Project')
  button(panel.root, '加载更多 Projects').click(); await flush()
  assert.equal(dropdown.options[2].textContent, 'Second Project')
  assert.deepEqual(calls, [{ action: 'anchored-comments.shared.projects', input: {} },
    { action: 'anchored-comments.shared.projects', input: { cursor: 'page-two' } }])
  dropdown.value = other; button(panel.root, '选择 Project').click()
  assert.equal(button(panel.root, '刷新共享讨论').disabled, false)
  panel.resetScope(); assert.equal(dropdown.options.length, 1)
  panel.dispose(); await window.happyDOM.close()
})

test('strict results reject extra local fields and mismatched Project identities', async () => {
  const { window } = fixture()
  let response: unknown = { ...result(), capture: {} }
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async () => response })
  panel.setProject(projectId); button(panel.root, '刷新共享讨论').click(); await flush()
  assert.match(panel.root.querySelector('[role="status"]')!.textContent!, /capture/)
  response = result(other)
  button(panel.root, '刷新共享讨论').click(); await flush()
  assert.match(panel.root.querySelector('[role="status"]')!.textContent!, /Project 身份不匹配/)
  panel.dispose(); await window.happyDOM.close()
})

test('definitive rejection displays reason and discards only through explicit canonical action', async () => {
  const { window } = fixture(), calls: { action: string; input: unknown }[] = []
  const idempotencyKey = 'idem_rejected_status_001'
  const panel = sharedConversationsPanel({ listLocalThreads: () => [], invoke: async (action, input) => {
    calls.push({ action, input })
    return { ...result(), rejectedCommands: action.endsWith('.discard') ? [] : [{ idempotencyKey, conversationId: 'root',
      status: 409, code: 'conflict', message: 'Stale revision' }] }
  } })
  panel.setProject(projectId); button(panel.root, '刷新共享讨论').click(); await flush()
  assert.match(panel.root.querySelector('[aria-label="已拒绝的共享写入"]')!.textContent!, /409.*Stale revision/)
  assert.equal(calls.length, 1)
  button(panel.root, '丢弃已拒绝写入').click(); await flush()
  assert.deepEqual(calls[1], { action: 'anchored-comments.shared.discard', input: { projectId, idempotencyKey } })
  assert.equal(panel.root.querySelector('[aria-label="已拒绝的共享写入"]')!.textContent, '')
  panel.dispose(); await window.happyDOM.close()
})

test('durable retry receipt unlocks original timed-out publication after local content changes', async () => {
  const { window, thread } = fixture(), calls: { action: string; input: unknown }[] = []
  let originalKey = '', acknowledged = false
  const panel = sharedConversationsPanel({ listLocalThreads: () => [thread], invoke: async (action, input) => {
    calls.push({ action, input })
    if (action.endsWith('.publish')) {
      originalKey = (input as { idempotencyKey: string }).idempotencyKey
      throw new Error('Host timeout after enqueue')
    }
    return { ...result(), outcomeReceipts: acknowledged ? [{ idempotencyKey: originalKey, outcome: 'acknowledged' }] :
      [{ idempotencyKey: 'idem_other_command_001', outcome: 'acknowledged' }] }
  } })
  panel.setProject(projectId)
  const inputs = panel.root.querySelectorAll<HTMLInputElement>('[aria-label="发布本地消息"] input')
  inputs[0].checked = true; inputs[2].checked = true
  button(panel.root, '发布所选消息').click(); await flush()
  thread.messages[0].body = 'Changed local content'
  button(panel.root, '重试原操作').click(); await flush()
  assert.equal(calls.length, 1)
  const retry = async () => {
    const confirm = panel.root.querySelector<HTMLInputElement>('input')!
    confirm.checked = true; confirm.dispatchEvent(new window.Event('change') as unknown as Event)
    button(panel.root, '重试待发送写入').click(); await flush()
  }
  await retry()
  // Neither pendingCount=0 nor another command's receipt resolves this operation.
  assert.equal(button(panel.root, '发布所选消息').disabled, true)
  acknowledged = true
  await retry()
  assert.equal(button(panel.root, '发布所选消息').disabled, false)
  assert.equal(button(panel.root, '重试原操作').disabled, true)
  assert.deepEqual(calls.slice(1).map(call => call.action), ['anchored-comments.shared.retry', 'anchored-comments.shared.retry'])
  panel.dispose(); await window.happyDOM.close()
})

test('oversized publication fails before uncertainty and reducing selection permits publication in same scope', async () => {
  const { window, thread } = fixture(), calls: unknown[] = []
  thread.messages = Array.from({ length: 4 }, (_, index) => ({ ...thread.messages[0], id: `large-${index}`, body: '界'.repeat(10_000) }))
  const panel = sharedConversationsPanel({ listLocalThreads: () => [thread], invoke: async (_action, input) => {
    calls.push(input)
    return { ...result(), outcomeReceipts: [{ idempotencyKey: (input as { idempotencyKey: string }).idempotencyKey, outcome: 'acknowledged' }] }
  } })
  panel.setProject(projectId)
  const inputs = panel.root.querySelectorAll<HTMLInputElement>('[aria-label="发布本地消息"] input')
  for (const input of inputs) input.checked = true
  button(panel.root, '发布所选消息').click(); await flush()
  assert.equal(calls.length, 0)
  assert.match(panel.root.querySelector('[role="status"]')!.textContent!, /减少所选消息/)
  assert.equal(button(panel.root, '发布所选消息').disabled, false)
  assert.equal(button(panel.root, '重试原操作').disabled, true)
  inputs[1].checked = false; inputs[2].checked = false; inputs[3].checked = false
  button(panel.root, '发布所选消息').click(); await flush()
  assert.equal(calls.length, 1)
  assert.deepEqual((calls[0] as { messageIds: string[] }).messageIds, ['large-0'])
  assert.equal(button(panel.root, '发布所选消息').disabled, false)
  panel.dispose(); await window.happyDOM.close()
})
