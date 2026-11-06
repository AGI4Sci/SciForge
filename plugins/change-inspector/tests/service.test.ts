import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changeInspectorOpenSessionResultSchema } from '../src/contract.js'
import { openSession } from '../src/core/operations.js'
import { ChangeInspectorService, changeInspectorResourceId } from '../src/core/service.js'
import { corpusSessions } from './cases.js'
import { fakeAgentThreads } from './runner.js'

const serviceFor = () => new ChangeInspectorService({ agentThreads: fakeAgentThreads(corpusSessions()) })

test('resource identity hashes the unambiguous runtime/session tuple', () => {
  const id = changeInspectorResourceId({ runtimeId: 'codex', sessionId: 'thread-1' })
  assert.match(id, /^session-changes:[a-f0-9]{64}$/u)
  assert.equal(id, changeInspectorResourceId({ runtimeId: 'codex', sessionId: 'thread-1' }))
  assert.notEqual(changeInspectorResourceId({ runtimeId: 'a:b', sessionId: 'c' }), changeInspectorResourceId({ runtimeId: 'a', sessionId: 'b:c' }))
})

test('openSession accepts omitted selectors and resolves the authenticated port identity', async () => {
  const service = serviceFor()
  const output = changeInspectorOpenSessionResultSchema.parse((await openSession(service, {})).output)
  assert.equal(output.snapshot.sessionId, 'thread-plain-diff')
  assert.equal(output.snapshot.changes.length, 1)
  assert.match(output.snapshot.revision, /^changes-[a-f0-9]{64}$/u)
  assert.equal(output.snapshot.changes[0]!.patchBytes, Buffer.byteLength(output.snapshot.changes[0]!.patch))
  assert.equal(output.snapshot.changes[0]!.patchTruncated, false)
  assert.deepEqual(output.snapshot.truncationReasons, [])
})

test('strict input rejects workspaceRoot, sessionDetail and other authority injection before reads', async () => {
  let reads = 0
  const service = new ChangeInspectorService({ agentThreads: { read: async () => { reads++; return corpusSessions()['thread-plain-diff']! } } })
  for (const input of [{ workspaceRoot: '/forged' }, { sessionDetail: {} }, { sessionId: 42 }, { runtimeId: '' }, { extra: true }]) {
    await assert.rejects(openSession(service, input))
  }
  assert.equal(reads, 0)
})

test('Host DTO requires sessionId, runtimeId and workspaceRoot', async () => {
  for (const key of ['sessionId', 'runtimeId', 'workspaceRoot']) {
    const detail: Record<string, unknown> = { ...corpusSessions()['thread-plain-diff']! }
    delete detail[key]
    const service = new ChangeInspectorService({ agentThreads: { read: async () => detail as never } })
    await assert.rejects(openSession(service, {}), /invalid|expected/i)
  }
})

test('service refuses a mismatched Host session or runtime identity', async () => {
  const service = new ChangeInspectorService({ agentThreads: { read: async () => corpusSessions()['thread-plain-diff']! } })
  await assert.rejects(openSession(service, { sessionId: 'foreign-same-workspace' }), /identity does not match/)
  await assert.rejects(openSession(service, { runtimeId: 'foreign-runtime' }), /identity does not match/)
})

test('list continues across Host reads that advance watermark, then rejects a new file change', async () => {
  const changes = [
    { kind: 'tool', toolKind: 'file_change', id: 'price', filePath: 'price.js', detail: '@@ -1 +1 @@\n-10\n+20' },
    { kind: 'tool', toolKind: 'file_change', id: 'test', filePath: 'price.test.js', detail: '@@ -1 +1 @@\n-10\n+20' }
  ]
  let reads = 0
  let newChange = false
  const service = new ChangeInspectorService({ agentThreads: { read: async () => ({
    sessionId: 'live-session', runtimeId: 'host', workspaceRoot: '/workspace',
    watermark: `read-${++reads}`,
    artifacts: [
      ...changes,
      ...Array.from({ length: reads }, (_, index) => ({
        kind: 'tool', toolKind: 'read', id: `list-${index}`, detail: 'change_inspector.list_changes'
      })),
      ...(newChange ? [{ ...changes[0], id: 'next-price-edit' }] : [])
    ]
  }) } })
  const first = await service.listChanges({ sessionId: 'live-session', limit: 1 })
  assert.ok(first.nextCursor)
  const second = await service.listChanges({ sessionId: 'live-session', limit: 1, cursor: first.nextCursor })
  assert.equal(second.revision, first.revision)
  assert.equal(second.changes[0]!.filePath, 'price.test.js')
  assert.equal(second.nextCursor, null)
  newChange = true
  await assert.rejects(service.listChanges({ sessionId: 'live-session', limit: 1, cursor: first.nextCursor }), /cursor does not match/u)
  const latest = await service.listChanges({ sessionId: 'live-session', limit: 1 })
  assert.notEqual(latest.revision, first.revision)
})

test('service rejects an existing cursor after whitespace-only plain or JSON diff changes', async () => {
  for (const json of [false, true]) {
    let patch = '@@ -1 +1 @@\n-before\n+after \n'
    const service = new ChangeInspectorService({ agentThreads: { read: async () => ({
      sessionId: 'byte-session', runtimeId: 'dsh', workspaceRoot: '/workspace', watermark: 'unchanged',
      artifacts: [
        { id: 'one', kind: 'tool', toolKind: 'file_change', detail: json ? JSON.stringify({ diff: patch }) : patch },
        { id: 'two', kind: 'tool', toolKind: 'file_change', detail: '@@ -1 +1 @@\n-x\n+y\n' }
      ]
    }) } })
    const first = await service.listChanges({ limit: 1 })
    assert.ok(first.nextCursor)
    assert.equal(first.changes[0]!.patch, patch)
    const unchanged = await service.listChanges({ limit: 1, cursor: first.nextCursor })
    assert.equal(unchanged.revision, first.revision)
    patch = '@@ -1 +1 @@\n-before\n+after  \n'
    await assert.rejects(service.listChanges({ limit: 1, cursor: first.nextCursor }), /cursor does not match/u)
    const latest = await service.snapshot({})
    assert.notEqual(latest.revision, first.revision)
    assert.equal(latest.changes[0]!.patch, patch)
    assert.equal(latest.changes[0]!.patchBytes, Buffer.byteLength(patch))
  }
})

test('authorized port failures propagate unchanged', async () => {
  const failure = new Error('Host denied read')
  const service = new ChangeInspectorService({ agentThreads: { read: async () => { throw failure } } })
  await assert.rejects(openSession(service, {}), error => error === failure)
})
