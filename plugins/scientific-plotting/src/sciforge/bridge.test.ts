import assert from 'node:assert/strict'
import test from 'node:test'
import { createPanelBridge, type FrameWindow } from './bridge.js'
import { createFiguresClient } from './figures-client.js'

function fixture() {
  const messages: any[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  const parent = { postMessage: (message: unknown) => { messages.push(message) } }
  const frame: FrameWindow = { parent, addEventListener: (_type, listener) => { listeners.add(listener) }, removeEventListener: (_type, listener) => { listeners.delete(listener) } }
  const bindings: unknown[] = []
  const bridge = createPanelBridge(frame, binding => bindings.push(binding))
  const send = (data: unknown, source: unknown = parent) => { for (const listener of listeners) listener({ data, source } as MessageEvent) }
  const init = (workspaceRoot = '/workspace') => send({ type: 'host.init', pluginId: 'plugin', contributionId: 'scientific-figures', generation: 1, version: '1.0.0', workspaceRoot })
  return { bridge, messages, bindings, send, init }
}

test('public iframe bridge binds the host, correlates replies, and delegates acceptance through one capability', async () => {
  const f = fixture()
  try {
    assert.equal(f.messages.length, 1)
    assert.equal(f.messages[0].type, 'ready')
    await assert.rejects(f.bridge.call('list', {}), /No active workspace/)
    f.init()
    const client = createFiguresClient(f.bridge.call)
    const input = { documentId: 'figure', revisionId: 'candidate', operationId: 'durable-operation', expectedDocumentRevision: 2 }
    const accepted = client.acceptCandidate(input)
    const request = f.messages.at(-1)
    assert.equal(request.type, 'capability.invoke')
    assert.equal(request.actionId, 'scientific-figures.operation')
    assert.match(request.requestId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(request.input, { action: 'acceptCandidate', input })
    assert.equal('workspaceRoot' in request, false)
    f.send({ type: 'capability.result', requestId: request.requestId, ok: true, output: 'spoofed' }, {})
    f.send({ type: 'capability.result', requestId: request.requestId, ok: true, output: { status: 'cancelled' } })
    assert.deepEqual(await accepted, { status: 'cancelled' })
    const read = client.read('figure')
    const readRequest = f.messages.at(-1)
    f.send({ type: 'capability.result', requestId: readRequest.requestId, ok: false, error: { code: 'CAPABILITY_REJECTED', message: 'approval unavailable' } })
    await assert.rejects(read, /CAPABILITY_REJECTED: approval unavailable/)
  } finally { f.bridge.dispose() }
})

test('workspace changes and disposal reject pending calls and clear bindings', async () => {
  const f = fixture()
  f.init()
  const pending = f.bridge.call('list', {})
  f.init('/other-workspace')
  await assert.rejects(pending, /binding changed/)
  const pendingDispose = f.bridge.call('status', {})
  f.send({ type: 'dispose' })
  await assert.rejects(pendingDispose, /disposed/)
  await assert.rejects(f.bridge.call('list', {}), /No active workspace/)
  assert.equal(f.bindings.at(-1), null)
  f.bridge.dispose()
})

test('composer request starts only a live Host message and cannot accept capability replies as its acknowledgement', async () => {
  const f = fixture()
  try {
    await assert.rejects(f.bridge.sendMessage('request', 'display'), /No active workspace/)
    f.init()
    let settled = false
    const result = f.bridge.sendMessage('exact acceptance request', '申请接受候选图').then(() => { settled = true })
    const request = f.messages.at(-1)
    assert.equal(request.type, 'composer.sendMessage')
    assert.deepEqual(request.input, { text: 'exact acceptance request', displayText: '申请接受候选图' })
    assert.equal('workspaceRoot' in request, false)
    f.send({ type: 'capability.result', requestId: request.requestId, ok: true })
    f.send({ type: 'composer.result', requestId: request.requestId, ok: true }, {})
    await Promise.resolve()
    assert.equal(settled, false)
    f.send({ type: 'composer.result', requestId: request.requestId, ok: true })
    await result
    assert.equal(settled, true)
    const denied = f.bridge.sendMessage('second request', 'display')
    f.send({ type: 'composer.result', requestId: f.messages.at(-1).requestId, ok: false, error: { message: 'No active conversation' } })
    await assert.rejects(denied, /No active conversation/)
    const stale = f.bridge.sendMessage('stale request', 'display')
    f.init('/new-workspace')
    await assert.rejects(stale, /binding changed/)
  } finally { f.bridge.dispose() }
})
