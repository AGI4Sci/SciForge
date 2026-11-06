/** Unit wiring tests, not official runtime or real-Session acceptance evidence. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { ChangeInspectorService } from '../src/core/service.js'
import { changeInspectorTools, EXPECTED_HOST_GRANTS, registerChangeInspectorTools } from '../src/dsh-adapter/tools.js'
import { corpusSessions } from './cases.js'
import { fakeAgentThreads } from './runner.js'

const serviceFor = () => new ChangeInspectorService({ agentThreads: fakeAgentThreads(corpusSessions()) })

test('registers only public non-plugin-prefixed read capabilities', () => {
  const service = serviceFor()
  const registered: unknown[] = []
  registerChangeInspectorTools(tool => registered.push(tool), definition => definition, () => service)
  assert.equal(registered.length, 2)
  assert.deepEqual(changeInspectorTools(() => service).map(tool => tool.name), ['open_session', 'list_changes'])
  assert.deepEqual(EXPECTED_HOST_GRANTS, {
    open_session: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, effect: 'read' },
    list_changes: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, effect: 'read' }
  })
  for (const grant of Object.values(EXPECTED_HOST_GRANTS)) assert.equal(grant.id.includes('plugin-'), false)
})

test('open_session defaults to the current authenticated port session', async () => {
  const [tool] = changeInspectorTools(serviceFor)
  assert.deepEqual(Object.keys(tool!.parameters).sort(), ['runtimeId', 'sessionId'])
  const result = await tool!.execute({}) as { snapshot: { sessionId: string; revision: string; changes: unknown[] } }
  assert.equal(result.snapshot.sessionId, 'thread-plain-diff')
  assert.match(result.snapshot.revision, /^changes-[a-f0-9]{64}$/)
  assert.equal(result.snapshot.changes.length, 1)
})

test('list_changes pages canonical summaries with hash-bound cursors', async () => {
  const tool = changeInspectorTools(serviceFor)[1]!
  const input = { sessionId: 'thread-json-keys', limit: 1 }
  const first = await tool.execute(input) as { changes: { id: string; patchBytes: number; patchTruncated: boolean }[]; nextCursor: string; revision: string }
  assert.equal(first.changes[0]!.id, 'k-diff')
  assert.equal(first.changes[0]!.patchBytes > 0, true)
  assert.equal(first.changes[0]!.patchTruncated, false)
  assert.match(first.nextCursor, /^ci1:[a-f0-9]{64}:1$/)
  const second = await tool.execute({ ...input, cursor: first.nextCursor }) as { changes: { id: string }[]; revision: string }
  assert.equal(second.changes[0]!.id, 'k-patch')
  assert.equal(second.revision, first.revision)
  await assert.rejects(tool.execute({ sessionId: 'thread-plain-diff', cursor: first.nextCursor }), /cursor does not match/)
  await assert.rejects(tool.execute({ ...input, cursor: 'nope' }), /cursor does not match/)
})

test('both tools reject arbitrary workspace/detail authority instead of stripping it', async () => {
  let reads = 0
  const service = new ChangeInspectorService({ agentThreads: { read: async () => { reads++; throw new Error('unexpected read') } } })
  for (const tool of changeInspectorTools(() => service)) {
    assert.equal('workspaceRoot' in tool.parameters, false)
    assert.equal('sessionDetail' in tool.parameters, false)
    for (const input of [{ workspaceRoot: '/forged' }, { sessionDetail: { artifacts: [] } }, { extra: true }]) {
      await assert.rejects(tool.execute(input), /unrecognized/i)
    }
  }
  assert.equal(reads, 0)
})

test('plain JSON output schema renders the returned value as text', () => {
  for (const tool of changeInspectorTools(serviceFor)) {
    assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true })
    assert.deepEqual(tool.output.render({}, { sessionId: 's' }), [{ type: 'text', text: '{"sessionId":"s"}' }])
  }
})
