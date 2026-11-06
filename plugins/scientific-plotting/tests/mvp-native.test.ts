import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../src/native-dsh/index.js'

type Tool = { execute(args: unknown, exec: unknown): Promise<unknown> }
type Request = { action: string; input: Record<string, unknown>; workspaceRoot: string; approvalGranted?: boolean; confirmationId?: string; preflight?: unknown; execution?: any }

function harness(options: { approval?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'; afterApproval?: () => void; alreadyCompleted?: unknown; workerResponse?: (request: Request) => unknown } = {}) {
  let tool!: Tool
  let command!: { handler(args: unknown): Promise<unknown> }
  let currentDirectory = '/test/current'
  let revision = 1
  let changed = 0
  let asks = 0
  const requests: Request[] = []
  const agent = { session: { id: 'test', header: { cwd: '/test/original' } } }
  const signal = new AbortController().signal
  const preflight = () => ({ documentRevision: revision, candidateHash: 'candidate-hash', baselineHash: 'baseline-hash' })
  const ctx = {
    tools: { register(value: Tool) { tool = value; return () => {} } },
    commands: { register(value: typeof command) { command = value; return () => {} } },
    effect: () => {},
    workingDirectory: { ensure: async () => currentDirectory },
    sandboxPolicy: { resolve: ({ session }: { session: unknown }) => { assert.equal(session, agent.session); return { mode: 'workspace-write', workspaceRoot: '/test/original' } } },
    sandbox: { confine: async (argv: string[], policy: unknown) => { assert.deepEqual(policy, { mode: 'workspace-write', workspaceRoot: '/test/original' }); return { argv: ['sandbox-runner', ...argv], enforcement: 'full' } } },
    approval: { request: async (request: { agent: unknown; callId: string; signal: AbortSignal }) => { asks++; assert.equal(request.agent, agent); assert.equal(request.signal, signal); assert.equal(request.callId, 'call:1'); options.afterApproval?.(); return options.approval ?? 'rejected' } },
    subprocess: { spawn: (spec: { argv: string[]; cwd: string; stdio: { stdin: { data: string } } }) => {
      assert.equal(spec.argv[0], 'sandbox-runner')
      assert.equal(spec.argv.at(-1), '--stdio')
      assert.equal(spec.cwd, currentDirectory)
      const request: Request = JSON.parse(spec.stdio.stdin.data)
      requests.push(request)
      let output: unknown = options.workerResponse ? options.workerResponse(request) : { ok: true }
      let exitCode = 0
      if (request.action === 'preflightAccept') output = options.alreadyCompleted === undefined ? preflight() : { alreadyCompleted: options.alreadyCompleted }
      if (request.action === 'acceptCandidate') {
        assert.equal(request.approvalGranted, true)
        assert.equal(request.confirmationId, 'call_1')
        if ((request.preflight as { documentRevision: number }).documentRevision !== revision) { exitCode = 1; output = { error: 'Stale preflight' } }
        else changed++
      }
      return { done: Promise.resolve({ exitCode, signal: null }), waitForExit: async () => {}, terminate: async () => {}, collected: { stdout: { readFrom: () => ({ text: JSON.stringify(output) }) }, stderr: { readFrom: () => ({ text: 'Stale preflight' }) } } }
    } },
  }
  apply(ctx as never)
  const exec = { agent, callId: 'call:1', signal }
  return { run: (action: string, input: unknown = {}) => tool.execute({ action, input }, exec), command: (rawInput: string) => command.handler({ agent, signal, rawInput }), requests, state: () => ({ changed, asks }), changeRevision: () => { revision++ }, changeDirectory: () => { currentDirectory = '/test/elsewhere' } }
}

test('native DSH refuses caller workspace/approval authority before spawning', async () => {
  const h = harness()
  await assert.rejects(h.run('list', { workspaceRoot: '/arbitrary' }), /authority field/)
  await assert.rejects(h.run('acceptCandidate', { nested: { approvalGranted: true } }), /authority field/)
  assert.equal(h.requests.length, 0)
})

test('native acceptance denied by formal approval does not publish', async () => {
  const h = harness({ approval: 'rejected' })
  assert.deepEqual(await h.run('acceptCandidate'), { ok: false, status: 'cancelled', approval: 'rejected', changed: false })
  assert.deepEqual(h.requests.map(r => r.action), ['preflightAccept'])
  assert.deepEqual(h.state(), { changed: 0, asks: 1 })
})

test('allowed-once forwards host preflight and trusted authorization', async () => {
  const h = harness({ approval: 'allowed-once' })
  await h.run('acceptCandidate')
  assert.deepEqual(h.state(), { changed: 1, asks: 1 })
  assert.equal(h.requests[1]?.workspaceRoot, '/test/current')
  assert.deepEqual(h.requests[1]?.preflight, { documentRevision: 1, candidateHash: 'candidate-hash', baselineHash: 'baseline-hash' })
})

test('revision changes during approval retain old preflight so worker fails stale', async () => {
  const h = harness({ approval: 'allowed-once', afterApproval: () => h.changeRevision() })
  await assert.rejects(h.run('acceptCandidate'), /Stale preflight/)
  assert.equal(h.state().changed, 0)
})

test('workspace changes during approval prevent publication', async () => {
  const h = harness({ approval: 'allowed-once', afterApproval: () => h.changeDirectory() })
  await assert.rejects(h.run('acceptCandidate'), /workspace changed/)
  assert.deepEqual(h.requests.map(r => r.action), ['preflightAccept'])
})

test('completed idempotent acceptance needs no new approval', async () => {
  const h = harness({ alreadyCompleted: { id: 'existing' } })
  assert.deepEqual(await h.run('acceptCandidate'), { id: 'existing' })
  assert.equal(h.state().asks, 0)
})

test('UI command uses caller scope and cannot bypass acceptance approval', async () => {
  const h = harness()
  assert.deepEqual(await h.command(JSON.stringify({ action: 'list', input: {} })), { kind: 'success', text: '{"ok":true}' })
  const result = await h.command(JSON.stringify({ action: 'acceptCandidate', input: {} })) as { kind: string; text: string }
  assert.equal(result.kind, 'error')
  assert.match(result.text, /active agent tool call/)
  assert.deepEqual(h.requests.map(r => r.action), ['list'])
})


function executionHarness(mode: string = 'danger-full-access', enforcement = 'full', cannotStop = false, outputs?: unknown[]) {
  let tool!: Tool
  const events: string[] = [], requests: Request[] = [], policies: any[] = []
  const prepared = { stageRoot: '/test/current/.scientific-figures/.runs-temp/python-abc', stagingRoot: '/test/current/.scientific-figures/.runs-temp', identity: { dev: 1, ino: 2 }, cwd: '/test/current/.scientific-figures/.runs-temp/python-abc/snapshot', argv: ['python3', '-I', '-c', 'wrapper'], env: { MPLBACKEND: 'Agg' }, timeoutMs: 1000 }
  const agent = { session: { id: 'test', header: { cwd: '/test/current' } } }
  const signal = new AbortController().signal
  const ctx = {
    tools: { register(t: Tool) { tool = t; return () => {} } }, commands: { register() { return () => {} } }, effect() {},
    workingDirectory: { ensure: async () => '/test/current' },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: '/test/current' }) },
    sandbox: { confine: async (argv: string[], policy: any) => { policies.push(policy); return { argv: ['confined', ...argv], enforcement } } },
    subprocess: { spawn(spec: any) {
      const python = spec.stdio.stdin.data === ''
      let output: unknown = {}
      if (python) { events.push('python-spawn'); assert.equal(spec.argv[0], 'confined'); assert.equal(spec.cwd, prepared.cwd) }
      else {
        const request: Request = JSON.parse(spec.stdio.stdin.data); requests.push(request)
        if (request.action === 'preparePython') output = { prepared }
        if (request.action === 'finalizePython') output = { status: request.execution!.outcome.status ?? 'completed', runId: 'run-one', ...(outputs ? { outputs } : {}) }
      }
      return { done: Promise.resolve({ exitCode: 0, signal: null }), terminate: async () => { if (python) { events.push('terminate'); if (cannotStop) throw Error('range still live') } }, waitForExit: async () => { if (python) events.push('wait') }, collected: { stdout: { readFrom: () => ({ text: python ? 'script log' : JSON.stringify(output) }) }, stderr: { readFrom: () => ({ text: '' }) } } }
    } }, approval: { request() { throw Error('should not request acceptance') } },
  }
  apply(ctx as never)
  return { run: () => tool.execute({ action: 'executePython', input: { runId: 'run-one', codeRevisionId: 'code-one' } }, { agent, callId: 'call', signal }), events, requests, policies, prepared }
}

test('Python is the directly managed root with narrower confinement even in full-access session', async () => {
  const h = executionHarness()
  assert.deepEqual(await h.run(), { status: 'completed', runId: 'run-one' })
  assert.deepEqual(h.requests.map(r => r.action), ['preparePython', 'finalizePython'])
  // Preparation/finalization workers manage workspace records; only the Python
  // process receives the narrower per-run staging root. Verify all three calls.
  assert.deepEqual(h.policies, [
    { mode: 'workspace-write', workspaceRoot: '/test/current' },
    { mode: 'workspace-write', workspaceRoot: h.prepared.stageRoot, sessionId: undefined },
    { mode: 'workspace-write', workspaceRoot: '/test/current' },
  ])
  assert.deepEqual(h.events.slice(0, 3), ['python-spawn', 'terminate', 'wait'])
  assert.equal(h.requests[1]!.execution!.outcome.stdout, 'script log')
})

test('run output references expose their store base without changing immutable relative paths', async () => {
  const output = { path: 'runs/run-one/outputs/figure.png', sha256: 'a'.repeat(64), byteLength: 123 }
  const h = executionHarness('workspace-write', 'full', false, [output])
  assert.deepEqual(await h.run(), { status: 'completed', runId: 'run-one', outputs: [{ ...output, workspaceRoot: '/test/current/.scientific-figures' }] })
  assert.equal('workspaceRoot' in output, false)
})

test('completed Python replay presents output bases without spawning Python or finalizing again', async () => {
  const output = Object.freeze({ path: 'runs/run-replay/outputs/figure.png', sha256: 'b'.repeat(64), byteLength: 456 })
  const stored = Object.freeze({ runId: 'run-replay', codeRevisionId: 'code-one', status: 'completed', outputs: Object.freeze([output]), stdout: 'original log' })
  const preparation = Object.freeze({ completed: stored })
  const before = JSON.stringify(preparation)
  const h = harness({ workerResponse: request => {
    assert.equal(request.action, 'preparePython')
    return preparation
  } })
  assert.deepEqual(await h.run('executePython', { runId: stored.runId, codeRevisionId: stored.codeRevisionId }), {
    ...stored, outputs: [{ ...output, workspaceRoot: '/test/current/.scientific-figures' }],
  })
  assert.deepEqual(h.requests, [{ action: 'preparePython', input: { runId: stored.runId, codeRevisionId: stored.codeRevisionId }, workspaceRoot: '/test/current', pythonCommand: process.env.SCIFORGE_PYTHON?.trim() || 'python3' }])
  assert.equal(JSON.stringify(preparation), before)
  assert.deepEqual(h.state(), { changed: 0, asks: 0 })
})

test('history pages preserve compact summaries, cursor, errors and caller page input', async () => {
  const runs = [
    { runId: 'run-one', codeRevisionId: 'code-one', status: 'completed', outputs: [{ path: 'runs/run-one/outputs/figure.png', sha256: 'c'.repeat(64), byteLength: 12 }] },
    { runId: 'run-two', codeRevisionId: 'code-one', status: 'completed', outputs: [{ path: 'runs/run-two/outputs/other.png', sha256: 'd'.repeat(64), byteLength: 34 }, { path: 'runs/run-two/outputs/third.png', sha256: 'e'.repeat(64), byteLength: 56 }] },
    { runId: 'run-failed', status: 'failed', outputs: [] },
  ]
  const unrelated = [{ codeRevisionId: 'code-one', files: [{ path: 'codes/code-one/files/main.py', sha256: 'f'.repeat(64), byteLength: 78 }], parameters: { completed: { runId: 'parameter', outputs: [{ path: 'parameter.png' }] } } }]
  const page = { items: runs.map(({ outputs: _outputs, ...summary }) => summary), nextCursor: 'run-failed', errors: [{ id: 'run-corrupt', error: 'Invalid metadata' }] }
  const codes = { items: unrelated.map(({ codeRevisionId }) => ({ codeRevisionId, parentCodeRevisionId: null, entrypoint: 'main.py', createdAt: '2026-01-01T00:00:00Z' })), nextCursor: null, errors: [] }
  const before = JSON.stringify(page)
  const h = harness({ workerResponse: request => request.action === 'listRuns' ? page : codes })
  const input = { limit: 3, cursor: 'run-z' }
  assert.deepEqual(await h.run('listRuns', input), page)
  assert.deepEqual(await h.run('listCodes'), codes)
  assert.deepEqual(h.requests[0]!.input, input)
  assert.equal(JSON.stringify(page), before)
  assert.deepEqual(h.requests.map(request => request.action), ['listRuns', 'listCodes'])
  assert.deepEqual(h.state(), { changed: 0, asks: 0 })
})

test('readRun uses the live caller base on each read without rebasing immutable paths', async () => {
  const stored = { runId: 'run-one', status: 'completed', outputs: [{ path: 'runs/run-one/outputs/figure.png', sha256: 'a'.repeat(64), byteLength: 123 }], environment: { language: 'python' } }
  const before = JSON.stringify(stored)
  const h = harness({ workerResponse: () => stored })
  const input = { runId: stored.runId }
  assert.deepEqual(await h.run('readRun', input), { ...stored, outputs: [{ ...stored.outputs[0], workspaceRoot: '/test/current/.scientific-figures' }] })
  h.changeDirectory()
  assert.deepEqual(await h.run('readRun', input), { ...stored, outputs: [{ ...stored.outputs[0], workspaceRoot: '/test/elsewhere/.scientific-figures' }] })
  assert.deepEqual(h.requests.map(request => ({ action: request.action, workspaceRoot: request.workspaceRoot, input: request.input })), [
    { action: 'readRun', workspaceRoot: '/test/current', input },
    { action: 'readRun', workspaceRoot: '/test/elsewhere', input },
  ])
  assert.equal(JSON.stringify(stored), before)
  assert.deepEqual(h.state(), { changed: 0, asks: 0 })
})

test('native interrupted finalization reuses durable outcome without spawning Python', async () => {
  const prepared = { stageRoot: '/test/current/.scientific-figures/.runs-temp/python-abc', stagingRoot: '/test/current/.scientific-figures/.runs-temp', identity: { dev: 1, ino: 2 }, cwd: '/test/current/.scientific-figures/.runs-temp/python-abc/snapshot', argv: ['python3'], env: {}, timeoutMs: 1000 }
  const outcome = { exitCode: 0, stdout: 'original log', stderr: '' }
  const h = harness({ workerResponse: request => {
    if (request.action === 'preparePython') return { recovery: true, prepared, outcome }
    assert.equal(request.action, 'finalizePython')
    assert.deepEqual(request.execution, { prepared, outcome })
    return { runId: 'run-one', status: 'completed', outputs: [] }
  } })
  assert.deepEqual(await h.run('executePython', { runId: 'run-one', codeRevisionId: 'code-one' }), { runId: 'run-one', status: 'completed', outputs: [] })
  assert.deepEqual(h.requests.map(request => request.action), ['preparePython', 'finalizePython'])
})

test('failed process quiescence retains logs, exit facts and explicit no-cleanup flag', async () => {
  const h = executionHarness('danger-full-access', 'full', true)
  assert.deepEqual(await h.run(), { status: 'failed', runId: 'run-one' })
  const outcome = h.requests[1]!.execution!.outcome
  assert.equal(outcome.quiescent, false)
  assert.equal(outcome.exitCode, 0)
  assert.equal(outcome.stdout, 'script log')
  assert.match(outcome.error, /range did not stop/)
})

test('read-only sessions refuse Python before preparation; partial confinement finalizes failed', async () => {
  const readonly = executionHarness('read-only')
  await assert.rejects(readonly.run(), /workspace-write/)
  assert.equal(readonly.requests.length, 0)
  const partial = executionHarness('danger-full-access', 'partial')
  assert.deepEqual(await partial.run(), { status: 'failed', runId: 'run-one' })
  assert.equal(partial.events.length, 0)
  assert.match(partial.requests[1]!.execution!.outcome.error, /complete file-write confinement/)
})
