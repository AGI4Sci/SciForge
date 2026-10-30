import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type DshRuntimeOptions, type DshEvent, type DshIdentity, type DshRuntimeAdapter, createDshRuntimeAdapter, createDshEnvironment, resolveDshLaunchInvocation, DSH_SAFETY_PATCH } from '../src/index.ts'

const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url))
const context = { settings: {} }
test('disconnect cleanup rejection survives strict host isolation and remains observable', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const child = fileURLToPath(new URL('./disconnect-cleanup-child.mjs', import.meta.url))
  const { stdout } = await run(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', child], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME }, timeout: 15_000
  })
  const reports = stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(reports.length, 2)
  for (const report of reports) {
    assert.equal(report.strictHostSurvived, true)
    assert.equal(report.childExited, true)
    assert.equal(report.cleanupAttempts, 1)
    assert.equal(report.publicRejections, 4)
  }
})
test('second prompt may exceed the lifecycle budget without replacing the session or process', async () => {
  const s = await setup({ requestTimeoutMs: 350, promptTimeoutMs: 1500 } as Partial<DshRuntimeOptions>)
  let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const first = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'env' })
    await until(stream.events, e => e.turnId === first.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')
    const firstDelta = stream.events.find(e => e.turnId === first.turnId && e.kind === 'assistant_delta')
    assert.ok(firstDelta?.kind === 'assistant_delta')
    const pid = JSON.parse(firstDelta.text).pid
    const second = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'slow' })
    await until(stream.events, e => e.turnId === second.turnId && e.kind === 'turn_lifecycle' && e.state !== 'running')
    assert.ok(stream.events.some(e => e.turnId === second.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed'), JSON.stringify(stream.events.filter(e => e.turnId === second.turnId)))
    const third = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'env' })
    await until(stream.events, e => e.turnId === third.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')
    const thirdDelta = stream.events.find(e => e.turnId === third.turnId && e.kind === 'assistant_delta')
    assert.ok(thirdDelta?.kind === 'assistant_delta')
    assert.equal(JSON.parse(thirdDelta.text).pid, pid)
    assert.equal(second.threadId, first.threadId)
  } finally { await stream?.stop(); await s.cleanup() }
})

test('unresponsive cancel has an independent budget and waits for actual child exit', async () => {
  const s = await setup({ promptTimeoutMs: 5000, cancelTimeoutMs: 100, executableArgs: [fixture, '--ignore-sigterm'] })
  let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const first = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'env' })
    await until(stream.events, e => e.turnId === first.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')
    const delta = stream.events.find(e => e.turnId === first.turnId && e.kind === 'assistant_delta')
    assert.ok(delta?.kind === 'assistant_delta')
    const pid = JSON.parse(delta.text).pid
    const held = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hang' })
    const cancelling = s.adapter.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id, turnId: held.turnId })
    await assert.rejects(s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' }), /runtime_busy/)
    assert.equal(await Promise.race([cancelling.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('still waiting for prompt'), 1500))]), 'settled')
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
    assert.equal(stream.events.filter(e => e.turnId === held.turnId && e.kind === 'turn_lifecycle' && e.state !== 'running').length, 1)
    assert.ok(stream.events.some(e => e.turnId === held.turnId && e.kind === 'turn_lifecycle' && e.state === 'interrupted'))
    const next = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    await until(stream.events, e => e.turnId === next.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')
  } finally { await stream?.stop(); await s.cleanup() }
})

test('invalid timeout budgets are rejected before spawning a child', () => {
  for (const key of ['requestTimeoutMs', 'promptTimeoutMs', 'cancelTimeoutMs', 'approvalTimeoutMs'] as const) {
    for (const value of [0, -1, NaN, Infinity, 2 ** 31]) {
      assert.throws(() => createDshRuntimeAdapter({ executable: process.execPath, stateDirectory: process.env.TMPDIR!, verifyDeployment: async () => {}, [key]: value }), /runtime_timeout_invalid/, `${key}=${value}`)
    }
  }
})

test('a long prompt budget does not relax session lifecycle timeouts', async () => {
  const barrier = join(process.env.TMPDIR!, `lifecycle-budget-${process.pid}-${Date.now()}`)
  const s = await setup({ requestTimeoutMs: 300, promptTimeoutMs: 3000, executableArgs: [fixture, '--barrier-resume', '--barrier-file', `${barrier}.started`, '--release-file', `${barrier}.release`], getAuthorizedMcpServers: async () => [{ name: 'host', type: 'http', url: 'http://127.0.0.1:1/mcp', headers: [] }] })
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    await assert.rejects(s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' }), /runtime_disconnected|runtime_request_timeout/)
    assert.ok(existsSync(`${barrier}.started`))
  } finally { await s.cleanup(); await rm(`${barrier}.started`, { force: true }); await rm(`${barrier}.release`, { force: true }) }
})

test('responsive cancellation waits for the prompt barrier and preserves the connection', async () => {
  const barrier = join(process.env.TMPDIR!, `cancel-budget-${process.pid}-${Date.now()}`)
  const s = await setup({ requestTimeoutMs: 350, promptTimeoutMs: 3000, cancelTimeoutMs: 1500, executableArgs: [fixture, '--barrier-cancel', '--barrier-file', `${barrier}.started`, '--release-file', `${barrier}.release`] })
  let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const turn = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'cancelbarrier' })
    let done = false
    const cancellation = s.adapter.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id, turnId: turn.turnId }).then(() => { done = true })
    const duplicate = s.adapter.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id, turnId: turn.turnId })
    const deadline = Date.now() + 2000
    while (!existsSync(`${barrier}.started`)) { assert.ok(Date.now() < deadline, 'cancel barrier deadline'); await new Promise(resolve => setTimeout(resolve, 5)) }
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(done, false)
    await assert.rejects(s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' }), /runtime_busy/)
    writeFileSync(`${barrier}.release`, 'release')
    await Promise.all([cancellation, duplicate])
    assert.equal(stream.events.filter(e => e.turnId === turn.turnId && e.kind === 'turn_lifecycle' && e.state === 'interrupted').length, 1)
    assert.equal(stream.events.some(e => e.kind === 'assistant_delta' && e.text === 'LATE'), false)
    const next = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    await until(stream.events, e => e.turnId === next.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')

  } finally { await stream?.stop(); await s.cleanup(); await rm(`${barrier}.started`, { force: true }); await rm(`${barrier}.release`, { force: true }) }
})

test('reconnect remounts the same session after a child disconnect rather than trusting stale MCP state', async () => {
  const s = await setup({ executableArgs: [fixture, '--require-mounted'], getAuthorizedMcpServers: async () => [{ name: 'host', type: 'http', url: 'http://127.0.0.1:1/mcp', headers: [] }] }); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const crashed = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'crash' })
    await until(stream.events, e => e.turnId === crashed.turnId && e.kind === 'turn_lifecycle' && e.state === 'failed')
    const recovered = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    await until(stream.events, e => e.turnId === recovered.turnId && e.kind === 'turn_lifecycle' && ['completed', 'failed'].includes(e.state))
    assert.ok(stream.events.some(e => e.turnId === recovered.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed'))
    assert.equal(recovered.threadId, crashed.threadId)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('cancellation during real stdio MCP resume keeps startup busy until the old turn settles', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-acp-barrier-'))
  const barrier = join(root, 'resume.started')
  const release = join(root, 'resume.release')
  const s = await setup({ stateDirectory: root, requestTimeoutMs: 5000, executableArgs: [fixture, '--barrier-resume', '--barrier-file', barrier, '--release-file', release], getAuthorizedMcpServers: async () => [{ name: 'host', type: 'http', url: 'http://127.0.0.1:1/mcp', headers: [] }] })
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: root })
    const starting = s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    const deadline = Date.now() + 2000
    while (!existsSync(barrier)) { assert.ok(Date.now() < deadline, 'resume barrier deadline'); await new Promise(r => setTimeout(r, 5)) }
    const cancelling = s.adapter.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id })
    const cancelState = await Promise.race([cancelling.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('pending'), 200))])
    assert.equal(cancelState, 'pending', `cancel state: ${cancelState}`)
    const second = s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'second' }).then(() => 'started', error => error instanceof Error ? error.message : String(error))
    const secondState = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve('pending'), 200))])
    assert.equal(secondState, 'runtime_busy', `second state: ${secondState}`)
    writeFileSync(release, '')
    await cancelling
    await assert.rejects(starting, /runtime_stale_generation|runtime_turn_start_failed|runtime_cancelled|runtime_closed/)
    assert.equal(await second, 'runtime_busy')
  } finally { writeFileSync(release, ''); await s.cleanup(); await rm(root, { recursive: true, force: true }) }
})

async function setup(extra: Partial<DshRuntimeOptions> = {}) {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-acp-test-'))
  const adapter = createDshRuntimeAdapter({
    executable: process.execPath, executableArgs: [fixture], stateDirectory: root,
    // Fixture only: a trusted deployment reviewer must validate the real composed config.
    verifyDeployment: async () => {}, requestTimeoutMs: 1000, approvalTimeoutMs: 300,
    ...extra
  })
  return { adapter, root, async cleanup() { await adapter.close(); await rm(root, { recursive: true, force: true }) } }
}
async function until(events: DshEvent[], predicate: (event: DshEvent) => boolean) {
  const deadline = Date.now() + 2000
  while (!events.some(predicate)) { assert.ok(Date.now() < deadline, 'event deadline'); await new Promise(r => setTimeout(r, 5)) }
}
async function collect(adapter: DshRuntimeAdapter, threadId: string) {
  const events: DshEvent[] = []
  const controller = new AbortController()
  const task = (async () => { for await (const event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId, signal: controller.signal })) events.push(event) })()
  return { events, async stop() { controller.abort(); await task } }
}
test('a slow event subscriber reports queue overflow instead of normal completion', async () => {
  const s = await setup()
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    const source = s.adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id })
    // Exercise the production broadcaster synchronously while the consumer is held.
    const broadcaster = s.adapter as unknown as { emit(turn: { identity: { threadId: string; turnId: string } }, event: object): void }
    for (let i = 0; i < 2049; i++) broadcaster.emit({ identity: { threadId: thread.id, turnId: 'overflow-turn' } }, { kind: 'assistant_delta', text: 'x' })
    await assert.rejects(async () => { for await (const _event of source) { /* drain */ } }, /runtime_event_queue_overflow/)
  } finally { await s.cleanup() }
})

test('real stdio child initializes, creates, lists, resumes and normalizes a text turn', async () => {
  const s = await setup()
  let stream
  try {
    await s.adapter.connect(context)
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const accepted = []
    const handle = await s.adapter.startTurn({ ...context, onTurnAccepted: async h => { accepted.push(h) } }, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    assert.deepEqual(accepted, [handle])
    assert.equal(stream.events.find(e => e.kind === 'assistant_delta')?.text, 'hello')
    assert.equal(stream.events.find(e => e.kind === 'reasoning_delta')?.text, 'thinking')
    assert.ok(stream.events.every(e => e.runtimeId === 'dsh' && e.threadId === thread.id))
    assert.deepEqual(stream.events.map(e => e.seq), [...stream.events.map(e => e.seq)].sort((a,b) => a-b))
    const listed = await s.adapter.listThreads(context, {})
    assert.ok(listed.some(t => t.id === 'saved-session'))
    const resumed = await s.adapter.resumeSession(context, { runtimeId: 'dsh', sessionId: 'saved-session', workspace: s.root })
    assert.equal(resumed.threadId, 'saved-session')
    assert.equal((await s.adapter.capabilities(context)).controls.steer, false)
    assert.equal((await s.adapter.usage(context, {})).supported, false)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('Host context identity wins over forged input and survives later mutation', async () => {
  const captured: DshIdentity[] = []
  const s = await setup({ getAuthorizedMcpServers: async identity => { captured.push(identity); return [] } })
  let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const principal = { authority: 'fixture', subject: 'host-account', assurance: 'local-selection' as const, deviceId: 'fixture-device', identityVersion: 11 }
    const principalContext = { identityVersion: 11, principal }
    const handle = await s.adapter.startTurn({ ...context, principal, principalContext }, { runtimeId: 'dsh', threadId: thread.id, text: 'hello', principal: { accountId: 'FORGED' } })
    principal.subject = 'CHANGED'
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    assert.equal(captured[0].principal!.subject, 'host-account')
    assert.ok(stream.events.every(e => e.principal?.subject === 'host-account' && e.principalContext?.identityVersion === 11 && e.turnId === handle.turnId))
  } finally { await stream?.stop(); await s.cleanup() }
})
test('neutral approvalId/allowed API resolves once; stale approval cannot cross turn', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'approval' })
    await until(stream.events, e => e.kind === 'approval_requested')
    const approvalId = stream.events.find(e => e.kind === 'approval_requested').approvalId
    await s.adapter.resolveApproval(context, { runtimeId: 'dsh', threadId: thread.id, approvalId, decision: 'allowed' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    assert.equal(stream.events.filter(e => e.kind === 'approval_resolved' && e.decision === 'allowed').length, 1)
    await assert.rejects(s.adapter.resolveApproval(context, { runtimeId: 'dsh', threadId: thread.id, approvalId, decision: 'allowed' }), /runtime_approval_stale/)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('cancel settles pending approval once, suppresses delayed old-process updates, and permits new generation', async () => {
  const leases: string[] = []
  const s = await setup({ getAuthorizedMcpServers: async identity => { leases.push(identity.turnId); return [] } }); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const first = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hold' })
    await until(stream.events, e => e.kind === 'approval_requested')
    await s.adapter.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id, turnId: 'wrong' })
    assert.equal(stream.events.filter(e => e.kind === 'turn_lifecycle' && e.state === 'interrupted').length, 0)
    await s.adapter.interruptTurn(context, first)
    assert.equal(stream.events.filter(e => e.kind === 'approval_resolved').length, 1)
    const second = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    await until(stream.events, e => e.turnId === second.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed')
    assert.equal(stream.events.filter(e => e.kind === 'assistant_delta' && e.text === 'LATE').length, 0)
    assert.equal(stream.events.filter(e => e.turnId === first.turnId && e.kind === 'turn_lifecycle' && e.state === 'completed').length, 0)
    assert.notEqual(leases[0], leases[1])
  } finally { await stream?.stop(); await s.cleanup() }
})
for (const reason of ['close', 'timeout', 'crash', 'hang', 'malformed']) test(`${reason} terminally settles turn and outstanding approval`, async () => {
  const s = await setup({ approvalTimeoutMs: 40, requestTimeoutMs: 350, promptTimeoutMs: 350 }); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: ['close','timeout'].includes(reason) ? 'hold' : reason })
    if (reason === 'close') { await until(stream.events, e => e.kind === 'approval_requested'); await s.adapter.close() }
    await until(stream.events, e => e.kind === 'turn_lifecycle' && ['interrupted', 'failed'].includes(e.state))
    if (['close','timeout'].includes(reason)) assert.equal(stream.events.filter(e => e.kind === 'approval_resolved').length, 1)
    assert.equal(stream.events.filter(e => e.kind === 'turn_lifecycle' && ['interrupted', 'failed','completed'].includes(e.state)).length, 1)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('ambient environment is not inherited; telemetry and preload hooks cannot be overridden', async () => {
  process.env.DSH_RUNTIME_TEST_SENTINEL = 'ambient-must-not-leak'
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'env' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    const child = JSON.parse(stream.events.find(e => e.kind === 'assistant_delta').text)
    assert.equal(child.env.DSH_RUNTIME_TEST_SENTINEL, undefined)
    assert.equal(child.env.NODE_OPTIONS, undefined)
    assert.equal(child.env.DSH_TELEMETRY_MODE, 'DISABLED')
    assert.equal(child.env.HOME, s.root)
    await s.adapter.close()
    assert.throws(() => process.kill(child.pid, 0), /ESRCH/)
  } finally { delete process.env.DSH_RUNTIME_TEST_SENTINEL; await stream?.stop(); await s.cleanup() }
})
test('enabled native execution is rejected even when trusted reviewer mistakenly returns success', async () => {
  const s = await setup({ executableArgs: [fixture, '--unsafe-config'] })
  try { await assert.rejects(s.adapter.connect(context), /runtime_config_unsafe/) }
  finally { await s.cleanup() }
})
test('session close settles approval before forgetting session', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hold' })
    await until(stream.events, e => e.kind === 'approval_requested')
    await s.adapter.closeSession(context, { runtimeId: 'dsh', sessionId: thread.id })
    assert.equal(stream.events.filter(e => e.kind === 'approval_resolved').length, 1)
    await assert.rejects(s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' }), /runtime_thread_not_found/)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('ACP tool updates become neutral snapshots without invented execution receipts', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'tools' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    assert.deepEqual(stream.events.filter(e => e.kind === 'item_snapshot').map(e => e.item.status), ['pending', 'running', 'completed'])
    assert.ok(stream.events.filter(e => e.kind === 'item_snapshot').every(e => e.item.summary === 'Host gateway' && !('receipt' in e)))
    const completed = stream.events.filter(e => e.kind === 'item_snapshot').map(e => e.item).find(e => e.status === 'completed')
    assert.equal(completed?.detail, '{"operations":["op_read"]}')
  } finally { await stream?.stop(); await s.cleanup() }
})
test('ACP preserves full tool detail for canonical durable artifact projection', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'large-tools' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    const completed = stream.events.filter(e => e.kind === 'item_snapshot').map(e => e.item).find(e => e.status === 'completed')
    assert.deepEqual(JSON.parse(completed!.detail!), { source: '报告😀'.repeat(10000), tail: 'recoverable' })
  } finally { await stream?.stop(); await s.cleanup() }
})
test('cancellation rejects a suspended Host authorization callback without waiting for it', async () => {
  let lease
  const s = await setup({ getAuthorizedMcpServers: async identity => { lease = identity; return new Promise(() => {}) } })
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    const starting = s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello' })
    const settled = starting.then(() => false, () => true)
    const deadline = Date.now() + 2000
    while (!lease) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)) }
    await s.adapter.interruptTurn(context, lease)
    assert.equal(await Promise.race([settled, new Promise(r => setTimeout(() => r(false), 200))]), true)
  } finally { await s.cleanup() }
})
test('attachment IDs and output schema are not silently ignored', async () => {
  const s = await setup()
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    for (const extra of [{ attachmentIds: ['file'] }, { outputSchema: { type: 'object' } }]) await assert.rejects(s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello', ...extra }), /runtime_unsupported/)
  } finally { await s.cleanup() }
})
test('Host workspace resolver supports locator-only create and resume; unknown history operations reject', async () => {
  const resolved: unknown[] = []
  const s = await setup({ resolveWorkspace: async (_context, input) => { resolved.push(input.workspaceLocator); return s.root } })
  try {
    const workspaceLocator = { kind: 'fixture-locator' }
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspaceLocator })
    const status = await s.adapter.readThreadStatus(context, { runtimeId: 'dsh', threadId: thread.id })
    assert.equal(status.status, 'idle')
    await s.adapter.resumeSession(context, { runtimeId: 'dsh', sessionId: 'saved-session', workspaceLocator })
    assert.deepEqual(resolved, [workspaceLocator, workspaceLocator])
    for (const method of ['readThreadPage', 'readToolArtifact', 'renameThread', 'deleteThread'] as const) await assert.rejects(s.adapter[method](context, {}), /runtime_unsupported/)
  } finally { await s.cleanup() }
})
test('cancel gives an in-flight neutral tool a terminal aborted snapshot exactly once', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    const handle = await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'toolhold' })
    await until(stream.events, e => e.kind === 'approval_requested')
    await s.adapter.interruptTurn(context, handle)
    await until(stream.events, e => e.kind === 'item_snapshot' && e.item.status === 'aborted')
    assert.equal(stream.events.filter(e => e.kind === 'item_snapshot' && e.item.status === 'aborted').length, 1)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('input AbortSignal cancels before a suspended authorization callback can dispatch', async () => {
  const signal = new AbortController(); let entered = false
  const s = await setup({ getAuthorizedMcpServers: async () => { entered = true; return new Promise(() => {}) } })
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    const starting = s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'hello', signal: signal.signal }).then(() => false, () => true)
    const deadline = Date.now() + 2000
    while (!entered) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)) }
    signal.abort()
    assert.equal(await Promise.race([starting, new Promise(r => setTimeout(() => r(false), 200))]), true)
  } finally { await s.cleanup() }
})
test('malformed correlated response rejects its actual transport promise instead of dropping its owner', async () => {
  const { AcpTransport } = await import('../src/transport.ts')
  const s = await setup()
  const transport = new AcpTransport(process.execPath, [fixture], {}, s.root, 250, () => {}, () => {})
  try {
    const result = transport.request('session/prompt', { sessionId: 'direct', prompt: [{ type: 'text', text: 'badreply' }] }).then(() => 'success', () => 'rejected')
    assert.equal(await Promise.race([result, new Promise(r => setTimeout(() => r('hung'), 500))]), 'rejected')
  } finally { await transport.close(); await s.cleanup() }
})
test('denied approval selects reject_once on the real stdio wire', async () => {
  const s = await setup(); let stream
  try {
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    stream = await collect(s.adapter, thread.id)
    await s.adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'approval' })
    await until(stream.events, e => e.kind === 'approval_requested')
    const request = stream.events.find(e => e.kind === 'approval_requested')!
    assert.equal(request.kind, 'approval_requested')
    if (request.kind !== 'approval_requested') throw new Error('missing approval')
    await s.adapter.resolveApproval(context, { runtimeId: 'dsh', threadId: thread.id, approvalId: request.approvalId, decision: 'denied' })
    await until(stream.events, e => e.kind === 'turn_lifecycle' && e.state === 'completed')
    const text = stream.events.find(e => e.kind === 'assistant_delta')
    assert.equal(text?.kind, 'assistant_delta')
    if (text?.kind !== 'assistant_delta') throw new Error('missing wire echo')
    assert.deepEqual(JSON.parse(text.text), { outcome: { outcome: 'selected', optionId: 'no' } })
    assert.equal(stream.events.filter(e => e.kind === 'approval_resolved' && e.decision === 'denied').length, 1)
  } finally { await stream?.stop(); await s.cleanup() }
})
test('discovered deployments accept any parseable version and probe reports the real version', async () => {
  const s = await setup({ executableArgs: [fixture, '--fixture-version=9.9.9'] })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, true)
    assert.equal(probe.version, '9.9.9')
    assert.equal(probe.deploymentIntegrity, 'pinned')
  } finally { await s.cleanup() }
})
test('expectedVersion demands an exact match and probe reports version failures', async () => {
  const pinned = await setup({ executableArgs: [fixture, '--fixture-version=9.9.9'], expectedVersion: '9.9.9' })
  try {
    const probe = await pinned.adapter.probe(context)
    assert.equal(probe.available, true)
    assert.equal(probe.version, '9.9.9')
  } finally { await pinned.cleanup() }
  const mismatched = await setup({ executableArgs: [fixture, '--fixture-version=9.9.9'], expectedVersion: '0.2.0-rc.2' })
  try {
    const probe = await mismatched.adapter.probe(context)
    assert.equal(probe.available, false)
    assert.equal(probe.failure?.code, 'runtime_version_unsupported')
    assert.equal(probe.version, null)
  } finally { await mismatched.cleanup() }
})
test('an empty or unparseable --version output fails closed', async () => {
  for (const bad of ['', 'not-a-version']) {
    const s = await setup({ executableArgs: [fixture, `--fixture-version=${bad}`] })
    try {
      const probe = await s.adapter.probe(context)
      assert.equal(probe.available, false)
      assert.equal(probe.failure?.code, 'runtime_version_unsupported', JSON.stringify(bad))
    } finally { await s.cleanup() }
  }
})
test('a discovered-style target keeps the install default ACP route instead of forcing audited values', async () => {
  let composed = ''
  const s = await setup({ executableArgs: [fixture, '--fixture-defaults'], defaultAcpRoute: null,
    verifyDeployment: async deployment => { composed = deployment.composedConfig } })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, true)
    const entries = JSON.parse(composed)
    assert.deepEqual(entries.find(row => row.id === 'acp')?.config, { provider: 'stock-provider', model: 'stock-model' })
    assert.equal(entries.find(row => row.id === 'approval')?.config?.policy, 'ask')
  } finally { await s.cleanup() }
})
test('an explicit default ACP route overrides the audited default without weakening invariants', async () => {
  let composed = ''
  const s = await setup({ executableArgs: [fixture, '--fixture-defaults'], defaultAcpRoute: { provider: 'custom-provider', model: 'custom-model' },
    verifyDeployment: async deployment => { composed = deployment.composedConfig } })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, true)
    const entries = JSON.parse(composed)
    assert.deepEqual(entries.find(row => row.id === 'acp')?.config, { provider: 'custom-provider', model: 'custom-model' })
    assert.equal(entries.find(row => row.id === 'approval')?.config?.policy, 'ask')
    assert.equal(entries.find(row => row.id === 'session-telemetry-otel')?.disabled, true)
  } finally { await s.cleanup() }
})
test('the child environment is platform-native and never inherits ambient PATH', () => {
  const base = { stateDirectory: '/state' } as DshRuntimeOptions
  const unix = createDshEnvironment(base, 'linux')
  assert.equal(unix.PATH, '/usr/bin:/bin:/usr/sbin:/sbin')
  assert.equal(unix.SystemRoot, undefined)
  const win = createDshEnvironment(base, 'win32')
  assert.ok(win.PATH!.includes('System32'))
  assert.ok(win.SystemRoot)
  assert.ok(win.COMSPEC)
  assert.equal(win.DSH_HOME, join('/state', 'dsh'))
})
test('Windows command shims launch through the command processor with metacharacter rejection', () => {
  assert.deepEqual(resolveDshLaunchInvocation('C:\\dsh\\dsh.exe', ['acp'], 'win32'), { command: 'C:\\dsh\\dsh.exe', args: ['acp'] })
  const shim = resolveDshLaunchInvocation('C:\\npm\\dsh.cmd', ['acp', '--patch', 'p'], 'win32', 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(shim.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(shim.args, ['/d', '/c', '""C:\\npm\\dsh.cmd" "acp" "--patch" "p""'])
  assert.throws(() => resolveDshLaunchInvocation('C:\\npm\\d&sh.cmd', [], 'win32'), /runtime_path_invalid/)
  assert.throws(() => resolveDshLaunchInvocation('C:\\npm\\dsh.cmd', ['a&b'], 'win32'), /runtime_start_failed/)
  assert.deepEqual(resolveDshLaunchInvocation('/usr/local/bin/dsh', ['acp'], 'darwin'), { command: '/usr/local/bin/dsh', args: ['acp'] })
})
test('a derived safety patch disables newly introduced dangerous entries and tolerates removed ones', async () => {
  let composed = ''
  const s = await setup({ executableArgs: [fixture, '--fixture-defaults', '--fixture-new-tools'], safetyPatch: 'derived', defaultAcpRoute: null,
    verifyDeployment: async deployment => { composed = deployment.composedConfig } })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, true)
    assert.equal(probe.deploymentIntegrity, 'derived')
    const entries = JSON.parse(composed)
    for (const id of ['tool-working-directory', 'web', 'web-search-deepseek', 'subagent-spawn-in-process']) {
      assert.equal(entries.find(row => row.id === id)?.disabled, true, id)
    }
    assert.deepEqual(entries.find(row => row.id === 'acp')?.config, { provider: 'stock-provider', model: 'stock-model' })
    assert.equal(entries.find(row => row.id === 'approval')?.config?.policy, 'ask')
    assert.equal(entries.find(row => row.id === 'session-telemetry-otel')?.disabled, true)
  } finally { await s.cleanup() }
})
test('the static patch still fails closed on a release with unknown enabled tool entries', async () => {
  // The release-audited static patch does not know tool-working-directory; the
  // composed config leaves it enabled and deployment is rejected. Derived mode
  // (previous test) covers such releases instead.
  const s = await setup({ executableArgs: [fixture, '--fixture-defaults', '--fixture-new-tools'], defaultAcpRoute: null })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, false)
    assert.equal(probe.failure?.technicalDetail, 'runtime_config_unsafe')
  } finally { await s.cleanup() }
})
test('a derived patch applies the Host model router route on top of install defaults', async () => {
  const s = await setup({
    executableArgs: [fixture, '--fixture-defaults', '--fixture-new-tools'], safetyPatch: 'derived', defaultAcpRoute: null,
    modelRouter: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'probe-stub', model: 'stub' }
  })
  try {
    const probe = await s.adapter.probe(context)
    assert.equal(probe.available, true)
    const thread = await s.adapter.startThread(context, { runtimeId: 'dsh', workspace: s.root })
    assert.ok(thread.id)
  } finally { await s.cleanup() }
})
test('the launched composition enables the shell only under the switch', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-exec-switch-'))
  let off: string | undefined
  let on: string | undefined
  const offAdapter = createDshRuntimeAdapter({ executable: process.execPath, executableArgs: [fixture], stateDirectory: root,
    verifyDeployment: async deployment => { off = deployment.composedConfig }, requestTimeoutMs: 1000 })
  const onAdapter = createDshRuntimeAdapter({ executable: process.execPath, executableArgs: [fixture], stateDirectory: root, commandExecution: true,
    verifyDeployment: async deployment => { on = deployment.composedConfig }, requestTimeoutMs: 1000 })
  try {
    await offAdapter.connect(context)
    await onAdapter.connect(context)
    // The switch off is the audited composition, byte for byte.
    assert.equal(off, DSH_SAFETY_PATCH)
    assert.ok(on && on !== off, 'the enabled composition must differ from the audited bytes')
    const rows = JSON.parse(on!) as Record<string, any>[]
    for (const id of ['tool-bash', 'tool-pwsh']) assert.ok(!rows.some(row => row.id === id), `${id} must not be disabled`)
    assert.equal(rows.find(row => row.id === 'tool-fs')?.disabled, true)
    assert.equal(rows.find(row => row.id === 'approval')?.config?.policy, 'ask')
  } finally { await offAdapter.close(); await onAdapter.close(); await rm(root, { recursive: true, force: true }) }
})
export { setup, context, collect, until }
