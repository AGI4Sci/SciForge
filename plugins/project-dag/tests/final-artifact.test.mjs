import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Requires a real release and offline-installed wheels, never a source import.
const artifact = process.env.PROJECT_DAG_ARTIFACT
const root = process.env.PROJECT_DAG_CASE_ROOT
assert(artifact && root && process.env.PROJECT_DAG_PYTHON)
const plugin = await import(pathToFileURL(join(artifact, 'index.js')))
const { ProjectDagCore } = await import(pathToFileURL(join(artifact, 'core.js')))
const { ProjectDagPythonProcess } = await import(pathToFileURL(join(artifact, 'python-process.js')))
const results = []
const tick = () => new Promise(resolve => setImmediate(resolve))
function gate() {
  let release, enter
  const barrier = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { enter = resolve })
  return { barrier, entered, release, enter }
}
function sqlite(db) {
  const code = `import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\ntables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]\nprint(json.dumps({t:c.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables},sort_keys=True))`
  const out = spawnSync(process.env.PROJECT_DAG_PYTHON, ['-I', '-B', '-c', code, db], { encoding: 'utf8', env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } })
  assert.equal(out.status, 0, out.stderr)
  return JSON.parse(out.stdout)
}
async function setup(name, customize = port => port, holdPump = false) {
  const caseRoot = join(root, name)
  await mkdir(caseRoot, { recursive: true })
  const seed = spawnSync(process.env.PROJECT_DAG_PYTHON, ['-I', '-B', fileURLToPath(new URL('./seed-evidence.py', import.meta.url)), caseRoot], { encoding: 'utf8', env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } })
  assert.equal(seed.status, 0, seed.stderr)
  const fixture = JSON.parse(await readFile(join(caseRoot, 'fixture.json'), 'utf8'))
  const options = { python: process.env.PROJECT_DAG_PYTHON, db: join(caseRoot, 'project.db'), evidence: join(caseRoot, 'evidence'), workspace: caseRoot, environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, closeTimeoutMs: 150 }
  if (holdPump) {
    // Synthetic scheduling barrier only: all dispatch, queue, compiler and SQLite
    // implementation still come from the installed unmodified release wheel.
    const wrapper = join(caseRoot, 'held-pump-python')
    await writeFile(wrapper, `#!${options.python} -I\nimport sys,time,json\nfrom pathlib import Path\nfrom project_dag import runtime_stdio as r\nsys.argv=['runtime_stdio',*sys.argv[sys.argv.index('--db'):]]\nroot=Path(${JSON.stringify(caseRoot)})\noriginal=r.pump_updates\ndef pump(engine):\n rows=engine.store.q("SELECT id,status FROM project_update_job WHERE status='queued'")\n if rows and not (root/'release-pump').exists():\n  (root/'queued-barrier.json').write_text(json.dumps([dict(row) for row in rows]))\n  while not (root/'release-pump').exists(): time.sleep(0.01)\n return original(engine)\nr.pump_updates=pump\nr.main()\n`)
    await chmod(wrapper, 0o700); options.python = wrapper
  }
  const python = new ProjectDagPythonProcess(options)
  const statusRoute = '/updates/status?workspaceRoot=' + encodeURIComponent(caseRoot)
  await python.request(statusRoute, 'GET')
  const before = sqlite(options.db)
  const port = customize({ serviceUrl: 'http://127.0.0.1:3898', authorize: async () => {}, subscribeInvalidation: () => () => {},
    readSession: async id => ({ id: id.threadId, runtimeId: id.runtimeId, workspaceRoot: caseRoot }), readCommittedSnapshot: async () => fixture,
    request: (...args) => python.request(...args), close: () => python.close(), teardownTimeoutMs: 150 })
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  class Host extends Service { constructor(c) { super(c, 'sciforgeProjectDag') } open() { return port } }
  await ctx.plugin(Host)
  const fork = await ctx.plugin(plugin)
  let sequence = 0
  const call = (name, args, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: { workspaceRoot: caseRoot, ...args }, signal, callId: ToolCallId('artifact-' + (++sequence)) })
  let didClose = false
  const close = async () => {
    if (didClose) return
    await fork.dispose(); await ctx.fiber.dispose(); await python.close().catch(() => {})
    assert.throws(() => process.kill(python.pid, 0))
    didClose = true
    results.push({ case: name, db: options.db, pid: python.pid, pidExited: true })
  }
  return { caseRoot, options, python, statusRoute, before, ctx, fork, call, port, close }
}
after(async () => { await mkdir(root, { recursive: true }); await writeFile(join(root, 'artifact-results.json'), JSON.stringify(results, null, 2)) })

test('PD-REVIEW-02 both final ESM entrypoints share the same compound Goal lane', { timeout: 5000 }, async () => {
  const g = gate(), bAdmitted = gate(), drafts = []
  const s = await setup('two-esm-goal-lanes', base => ({ ...base,
    authorize: async (_id, input) => { if (input.title === 'plugin-B') bAdmitted.enter() },
    request: async (route, method, body) => {
      if (route === '/goals/draft') drafts.push(body.title)
      const result = await base.request(route, method, body)
      if (route === '/goals/draft' && body.title === 'core-A') { g.enter(); await g.barrier }
      return result
    } }))
  const core = new ProjectDagCore(s.port)
  const a = core.saveGoal({ workspaceRoot: s.caseRoot, title: 'core-A' }).then(value => ({ value }), error => ({ error }))
  await g.entered
  const b = s.call('project_dag_save_goal', { title: 'plugin-B' })
  try {
    await bAdmitted.entered; await tick()
    assert.deepEqual(drafts, ['core-A'], 'plugin entry must not overwrite the held core-entry draft')
    g.release()
    const [left, right] = await Promise.all([a, b])
    assert(!left.error, left.error?.message); assert.equal(left.value.goal.title, 'core-A'); assert.equal(right.isError, false)
    const stored = await s.python.request('/goals?workspaceRoot=' + encodeURIComponent(s.caseRoot), 'GET')
    assert.deepEqual(stored.map(item => item.title).sort(), ['core-A', 'plugin-B'])
    const rows = sqlite(s.options.db)
    assert(JSON.stringify(rows.goal).includes('core-A')); assert(JSON.stringify(rows.goal).includes('plugin-B'))
    results.push({ case: 'two-esm-goal-titles', drafts, storedTitles: stored.map(item => item.title), sameWheelDb: s.options.db })
  } finally { g.release(); await Promise.all([a, b]); await s.close() }
})

for (const closeFails of [false, true]) {
  test('PD-REVIEW-03 hung disposer settles official disposal with retained diagnostics; closeFails=' + closeFails, { timeout: 5000 }, async () => {
    const g = gate()
    let listener, detached = false, requests = 0
    const s = await setup('hung-detach-' + closeFails, base => ({ ...base,
      subscribeInvalidation: callback => { listener = callback; return async () => { g.enter(); await g.barrier; detached = true } },
      request: (...args) => { requests++; return base.request(...args) },
      close: async () => { await base.close(); if (closeFails) throw new Error('synthetic close failure retained') }
    }))
    const disposal = s.fork.dispose()
    try {
      await g.entered
      let timer
      const settled = await Promise.race([disposal.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 700) })])
      clearTimeout(timer)
      assert.equal(settled, true, 'official disposal must settle while subscription release is hung')
      assert.equal(detached, false, 'timeout must not claim actual subscription release')
      assert.throws(() => process.kill(s.python.pid, 0), 'real owned PID must exit')
      await listener({ workspaceRoot: s.caseRoot, changedFields: ['evidenceVector'] })
      assert.equal(requests, 0, 'late subscription callback must be fenced')
      assert.deepEqual(sqlite(s.options.db), s.before)
      const diagnostics = JSON.stringify(s.ctx.logger.buffer)
      assert.match(diagnostics, /subscription detach timed out/)
      assert.match(diagnostics, /release unconfirmed/)
      if (closeFails) assert.match(diagnostics, /synthetic close failure retained/)
      results.push({ case: 'hung-detach-diagnostics-' + closeFails, detached: false, diagnostics, disposalBoundMs: 700 })
    } finally { g.release(); await disposal; await tick(); await s.close() }
  })
}

for (const preparation of ['readSession', 'readCommittedSnapshot']) {
  test('PD-REVIEW-01 cancels before first write after ' + preparation, { timeout: 5000 }, async () => {
    const g = gate(), posts = []
    const s = await setup('abort-' + preparation, base => ({ ...base,
      [preparation]: async (...args) => { g.enter(); await g.barrier; return base[preparation](...args) },
      request: (...args) => { if (args[1] === 'POST') posts.push(args[0]); return base.request(...args) } }))
    const ctrl = new AbortController()
    const pending = s.call('project_dag_update', { scope: ['codex:t'] }, ctrl.signal)
    try {
      await g.entered; assert.deepEqual(posts, []); ctrl.abort(); g.release()
      assert.equal((await pending).isError, true)
      assert.deepEqual(posts, [], 'cancelled preparation must not POST')
      assert.deepEqual(sqlite(s.options.db), s.before, 'all SQLite rows must remain unchanged')
      results.push({ case: 'cancel-' + preparation, posts, sqliteAllRowsUnchanged: true })
    } finally { g.release(); await pending; await s.close() }
  })
}

test('PD-REVIEW-01 cancelled Goal waiting in lane never drafts', { timeout: 5000 }, async () => {
  const g = gate(), bAdmitted = gate(), drafts = []
  const s = await setup('abort-goal-lane', base => ({ ...base,
    authorize: async (_id, input) => { if (input.title === 'cancelled') bAdmitted.enter() },
    request: async (route, method, body) => {
      if (route === '/goals/draft') { drafts.push(body.title); if (body.title === 'predecessor') { g.enter(); await g.barrier } }
      return base.request(route, method, body)
    } }))
  const a = s.call('project_dag_save_goal', { title: 'predecessor' })
  await g.entered
  const ctrl = new AbortController(), b = s.call('project_dag_save_goal', { title: 'cancelled' }, ctrl.signal)
  try {
    await bAdmitted.entered; await tick(); ctrl.abort(); g.release()
    assert.equal((await a).isError, false); assert.equal((await b).isError, true)
    assert.deepEqual(drafts, ['predecessor'])
    const stored = await s.python.request('/goals?workspaceRoot=' + encodeURIComponent(s.caseRoot), 'GET')
    assert.deepEqual(stored.map(item => item.title), ['predecessor'])
    assert(!JSON.stringify(sqlite(s.options.db)).includes('cancelled'))
    results.push({ case: 'cancel-queued-goal', drafts, storedTitles: stored.map(item => item.title) })
  } finally { g.release(); await Promise.all([a, b]); await s.close() }
})

test('PD-REVIEW-01 cancellation with a physically queued SQLite job retains then drains it', { timeout: 5000 }, async () => {
  const admitted = gate()
  let acknowledgedReceipt
  const s = await setup('abort-physically-queued', base => ({ ...base, request: async (...args) => {
    const value = await base.request(...args)
    if (args[0] === '/updates') { acknowledgedReceipt = value; admitted.enter(); await admitted.barrier }
    return value
  } }), true)
  const ctrl = new AbortController()
  const pending = s.call('project_dag_update', { scope: ['codex:t'] }, ctrl.signal)
  try {
    await admitted.entered
    assert.equal(acknowledgedReceipt.state, 'queued')
    let queued
    for (let attempt = 0; attempt < 100; attempt++) {
      try { queued = JSON.parse(await readFile(join(s.caseRoot, 'queued-barrier.json'), 'utf8')); break } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
    }
    assert.equal(queued?.[0]?.status, 'queued')
    const durableBefore = sqlite(s.options.db)
    ctrl.abort()
    let settled = false; void pending.then(() => { settled = true }); await tick()
    assert.equal(settled, false)
    assert.deepEqual(sqlite(s.options.db), durableBefore, 'abort must not remove the queued job/receipt')
    const settledBeforeRelease = settled
    await writeFile(join(s.caseRoot, 'release-pump'), 'release synthetic scheduling barrier')
    admitted.release(); assert.equal((await pending).isError, true)
    const status = await s.python.request(s.statusRoute, 'GET')
    assert.equal(status.latestReceipt.jobId, acknowledgedReceipt.jobId)
    assert.equal(status.latestReceipt.state, 'committed'); assert(status.committedSnapshot.digest)
    results.push({ case: 'cancel-physically-queued', acknowledgedReceipt, queued, settledBeforeRelease, retainedAllRowsDuringAbort: true, finalReceipt: status.latestReceipt })
    await s.close()
    const restarted = new ProjectDagPythonProcess({ ...s.options, python: process.env.PROJECT_DAG_PYTHON })
    try { const old = await restarted.request(s.statusRoute, 'GET'); assert.equal(old.latestReceipt.jobId, acknowledgedReceipt.jobId); assert.equal(old.committedSnapshot.digest, status.committedSnapshot.digest) }
    finally { await restarted.close(); assert.throws(() => process.kill(restarted.pid, 0)); results.push({ case: 'restart-queued', pid: restarted.pid, pidExited: true }) }
  } finally { await writeFile(join(s.caseRoot, 'release-pump'), 'release'); admitted.release(); await pending; await s.close() }
})

for (const command of ['update', 'save_goal']) {
  test('PD-REVIEW-01 cancellation after ' + command + ' admission drains and retains durable state', { timeout: 5000 }, async () => {
    const g = gate(), posts = []
    const route = command === 'update' ? '/updates' : '/goals/draft'
    const s = await setup('abort-admitted-' + command, base => ({ ...base, request: async (...args) => {
      if (args[1] === 'POST') posts.push(args[0])
      const value = await base.request(...args)
      if (args[0] === route) { g.enter(); await g.barrier }
      return value
    } }))
    const ctrl = new AbortController()
    const pending = s.call('project_dag_' + command, command === 'update' ? { scope: ['codex:t'] } : { title: 'admitted-goal' }, ctrl.signal)
    try {
      await g.entered; ctrl.abort()
      let settled = false; void pending.then(() => { settled = true }); await tick()
      assert.equal(settled, false, 'caller must wait for admitted command quiescence')
      const settledBeforeRelease = settled
      g.release(); assert.equal((await pending).isError, true)
      const status = await s.python.request(s.statusRoute, 'GET')
      if (command === 'update') { assert(status.latestReceipt.jobId); assert.equal(status.latestReceipt.state, 'committed'); assert(status.committedSnapshot.digest) }
      else { assert.deepEqual(posts, ['/goals/draft', '/goals/apply']); assert(JSON.stringify(sqlite(s.options.db)).includes('admitted-goal')) }
      results.push({ case: 'cancel-after-admission-' + command, posts, settledBeforeRelease, receipt: status.latestReceipt, committedSnapshot: status.committedSnapshot })
      await s.close()
      const restarted = new ProjectDagPythonProcess(s.options)
      try {
        if (command === 'update') { const old = await restarted.request(s.statusRoute, 'GET'); assert.equal(old.latestReceipt.jobId, status.latestReceipt.jobId); assert.equal(old.committedSnapshot.digest, status.committedSnapshot.digest) }
        else { const old = await restarted.request('/goals?workspaceRoot=' + encodeURIComponent(s.caseRoot), 'GET'); assert.equal(old[0].title, 'admitted-goal') }
      } finally { await restarted.close(); assert.throws(() => process.kill(restarted.pid, 0)); results.push({ case: 'restart-' + command, pid: restarted.pid, pidExited: true }) }
    } finally { g.release(); await pending; await s.close() }
  })
}
