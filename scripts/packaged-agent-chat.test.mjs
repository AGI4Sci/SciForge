import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./packaged-agent-chat.mjs', import.meta.url), 'utf8')
// Evaluate the actual pure functions, without evaluating credential reads or app startup.
const start = source.indexOf('function analyseTranscript(')
const end = source.indexOf('\nconst probeQuestion', start)
assert.ok(start >= 0 && end > start)
const { analyseTranscript, requireSelftestSuccess } = runInNewContext(
  `${source.slice(start, end)}\n({ analyseTranscript, requireSelftestSuccess })`
)
const payload = { ok: true, capability: 'market-selftest.ping', plugin: '@sciforge/plugin-market-selftest' }
const tool = (overrides = {}) => ({
  id: 'call-1', turnId: 'turn-1', kind: 'tool', toolKind: 'tool_call',
  summary: 'market_selftest_ping', status: 'completed', detail: JSON.stringify(payload),
  meta: { origin: 'acp', authoritativeExecutionReceipt: false }, ...overrides
})
// AgentRuntimeThreadPage from durable-runtime-history: latest item snapshot per id.
const page = (...items) => ({
  runtimeId: 'dsh', threadId: 'thread-1', latestSeq: 6, nextCursor: null,
  turns: [{ id: 'turn-1', threadId: 'thread-1', status: 'completed', items }]
})
const verify = (input, label) => requireSelftestSuccess(analyseTranscript(input, null), label)

for (const label of ['T1', 'T3']) {
  test(`${label}: accepts the completed self-test and preserves its associated result`, () => {
    const calls = verify(page(tool()), label)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].id, 'call-1')
    assert.equal(calls[0].turnId, 'turn-1')
    assert.equal(JSON.stringify(calls[0].result), JSON.stringify(payload))
  })
  for (const status of ['failed', 'error', 'pending', 'running', 'aborted', undefined]) {
    test(`${label}: rejects ${status} even with a healthy payload`, () => {
      assert.throws(() => verify(page(tool({ status })), label), /did not complete successfully/)
    })
  }
  for (const [name, result] of [
    ['ok false', { ...payload, ok: false }],
    ['truthy ok', { ...payload, ok: 'true' }],
    ['wrong capability', { ...payload, capability: 'other.ping' }],
    ['wrong plugin', { ...payload, plugin: '@other/plugin' }],
    ['missing ok', { capability: payload.capability, plugin: payload.plugin }],
    ['missing capability', { ok: true, plugin: payload.plugin }],
    ['missing plugin', { ok: true, capability: payload.capability }],
    ['null', null]
  ]) {
    test(`${label}: rejects ${name}`, () => {
      assert.throws(() => verify(page(tool({ detail: JSON.stringify(result) })), label), /invalid self-test result/)
    })
  }
  for (const detail of [undefined, '', 'not JSON']) {
    test(`${label}: rejects missing or unreadable result ${JSON.stringify(detail)}`, () => {
      assert.throws(() => verify(page(tool({ detail })), label), /invalid self-test result/)
    })
  }
  test(`${label}: cannot borrow a result from another tool item or a message`, () => {
    assert.throws(() => verify(page(
      tool({ detail: undefined }),
      tool({ id: 'call-other', summary: 'another_tool' }),
      { id: 'reply', kind: 'assistant_message', text: JSON.stringify(payload), meta: { toolName: 'market_selftest_ping', arguments: {}, result: payload } }
    ), label), /invalid self-test result/)
  })
  test(`${label}: rejects substring names and fabricated nested tool calls`, () => {
    assert.throws(() => verify(page(tool({ summary: 'fake_market_selftest_ping' }), {
      id: 'reply', kind: 'assistant_message', text: 'market_selftest_ping succeeded',
      meta: { toolName: 'market_selftest_ping', arguments: {}, status: 'completed', result: payload }
    }), label), /tool call missing/)
  })
  test(`${label}: a healthy retry cannot mask a failed self-test call`, () => {
    assert.throws(() => verify(page(tool({ status: 'failed' }), tool({ id: 'retry' })), label), /did not complete successfully/)
  })
}

test('rejects unsupported transcript envelopes instead of guessing formats', () => {
  assert.throws(() => analyseTranscript({ items: [tool()] }, null), /AgentRuntimeThreadPage/)
})

test('both first-start and restart acceptance use the strict validator', () => {
  assert.match(source, /turn\.expectTool \? requireSelftestSuccess\(analysis, turn\.id\)/)
  assert.match(source, /requireSelftestSuccess\(analysis, restartTurn\.id\)/)
})

test('market install forwards the catalogue approval snapshot and explicit ports', async () => {
  const phaseStart = source.indexOf('const PHASE_INSTALL = String.raw`')
  const phaseEnd = source.indexOf('\n/** One natural-language turn', phaseStart)
  const phase = source.slice(phaseStart, phaseEnd).replace('const PHASE_INSTALL =', 'var PHASE_INSTALL =')
  let request
  const entry = {
    name: '@sciforge/plugin-market-selftest', installed: false, enabled: false,
    approvalSnapshot: { packageName: '@sciforge/plugin-market-selftest', version: '0.1.0' },
    tools: [{ name: 'market_selftest_ping' }], ports: [], capabilities: []
  }
  const context = {
    PRELUDE: 'const steps = []; const step = (name, detail) => steps.push({name, detail}); const fail = (message) => { throw new Error(message) }',
    runtimeId: 'dsh',
    window: { sciforge: {
      market: { list: async () => ({ plugins: [entry] }), install: async (input) => { request = input } },
      agentRuntime: { capabilities: async () => ({}) }
    } }
  }
  runInNewContext(phase, context)
  await runInNewContext(context.PHASE_INSTALL, context)
  assert.equal(request.approvalSnapshot, entry.approvalSnapshot)
  assert.equal(request.approvedPorts, entry.ports)
  assert.equal(request.packageName, entry.name)
  assert.equal(JSON.stringify(request.approvedToolNames), '["market_selftest_ping"]')
})
