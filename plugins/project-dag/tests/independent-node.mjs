import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const artifact = process.env.PROJECT_DAG_ARTIFACT
const root = process.env.PROJECT_DAG_CASE_ROOT
const fixture = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8'))
const plugin = await import(pathToFileURL(join(artifact, 'index.js')))
const { ProjectDagCore } = await import(pathToFileURL(join(artifact, 'core.js')))
const { ProjectDagPythonProcess } = await import(pathToFileURL(join(artifact, 'python-process.js')))
const processes = []
let listener
let allow = true
let snapshotMetadata = fixture
function openPort(name) {
  const python = new ProjectDagPythonProcess({ python: process.env.PROJECT_DAG_PYTHON,
    db: join(root, name+'.db'), evidence: join(root, 'evidence'), workspace: root,
    environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } })
  processes.push(python)
  return {
    serviceUrl: 'http://127.0.0.1:3898',
    authorize: async (_action, input, call) => {
      assert.equal(call.agentId, 'synthetic-agent')
      if (!allow || input.workspaceRoot !== root) throw new Error('access denied')
    },
    readSession: async identity => {
      assert.deepEqual(identity, { runtimeId: 'codex', threadId: 't' })
      return { id: 't', runtimeId: 'codex', workspaceRoot: root }
    },
    readCommittedSnapshot: async identity => {
      assert.equal(identity.engineId, 'codex:t')
      assert.equal(identity.workspaceRoot, root)
      // Immutable metadata fixture was produced by the installed Evidence wheel,
      // not a invented digest; Python subsequently verifies the shared file.
      return snapshotMetadata
    },
    subscribeInvalidation: callback => { listener = callback; return () => { listener = undefined } },
    request: (route, method, body) => python.request(route, method, body),
    close: () => python.close()
  }
}
const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(Tools)
class ProjectHost extends Service {
  constructor(context) { super(context, 'sciforgeProjectDag') }
  open() { return openPort('runtime') }
}
await ctx.plugin(ProjectHost)
const fork = await ctx.plugin(plugin)
const agent = { id: 'synthetic-agent' }
async function call(name, args, signal = new AbortController().signal) {
  return ctx.tools.execute({ name, arguments: args, signal, agent, callId: ToolCallId('synthetic-'+name) })
}
function value(result) {
  assert.equal(result.isError, false, JSON.stringify(result))
  return result.value ?? JSON.parse(result.content[0].text)
}
const update = { workspaceRoot: root, scope: ['codex:t'] }
try {
  const staticPort = openPort('static')
  const staticCore = new ProjectDagCore(staticPort)
  const staticResult = await staticCore.update(update)
  const dshResult = value(await call('project_dag_update', update))
  assert.deepEqual(dshResult.receipt.desiredEvidenceVector, staticResult.receipt.desiredEvidenceVector)
  assert.deepEqual(dshResult.receipt.capturedScope, staticResult.receipt.capturedScope)
  assert.equal(dshResult.receipt.desiredEvidenceVector[0].digest, fixture.digest)
  const committed = value(await call('project_dag_status', { workspaceRoot: root }))
  assert.deepEqual(committed.committed.evidenceVector, [{ threadId: 'codex:t', digest: fixture.digest }])
  const parallel = await Promise.all([call('project_dag_update', update), call('project_dag_update', update)])
  for (const result of parallel) assert.deepEqual(value(result).receipt.desiredEvidenceVector, committed.committed.evidenceVector)
  const goalInput = { workspaceRoot: root, title: 'Synthetic project goal', description: 'No model calls' }
  const staticGoal = await staticCore.saveGoal(goalInput)
  const runtimeGoal = value(await call('project_dag_save_goal', goalInput))
  assert.equal(runtimeGoal.goal.title, staticGoal.goal.title)
  assert.equal(runtimeGoal.goal.description, staticGoal.goal.description)
  const bad = { workspaceRoot: root, scope: [] }
  await assert.rejects(staticCore.update(bad))
  assert.equal((await call('project_dag_update', bad)).isError, true)
  allow = false
  assert.equal((await call('project_dag_update', update)).isError, true)
  allow = true
  const cancel = new AbortController(); cancel.abort()
  assert.equal((await call('project_dag_update', update, cancel.signal)).isError, true)
  await listener({ workspaceRoot: root, changedFields: ['evidenceVector'] })
  const stale = value(await call('project_dag_status', { workspaceRoot: root }))
  assert.equal(stale.invalidation.stale, true)
  // Mutate the actual Evidence file and cross the installed Python boundary.
  // Restore in finally; there is no synthesized Project response/digest.
  const snapshotPath = join(root, 'evidence', (await readdir(join(root, 'evidence'))).find(name => name.endsWith('.prov.json')))
  const original = await readFile(snapshotPath, 'utf8')
  for (const mutation of ['pending', 'tampered-watermark']) {
    const document = JSON.parse(original)
    if (mutation === 'pending') document['edag:meta'].snapshot.status = 'pending'
    else document['edag:meta'].snapshot.inputWatermark += ':actually-mutated'
    try {
      await writeFile(snapshotPath, JSON.stringify(document))
      assert.equal((await call('project_dag_update', update)).isError, true, mutation)
    } finally { await writeFile(snapshotPath, original) }
  }
  snapshotMetadata = { ...fixture, threadId: 'codex:wrong-thread' }
  try { assert.equal((await call('project_dag_update', update)).isError, true) }
  finally { snapshotMetadata = fixture }
  await staticPort.close()
  await fork.dispose()
  assert.equal(listener, undefined)
  assert(!ctx.tools.schemas().some(item => item.name.startsWith('project_dag_')))
  for (const process of processes) assert.throws(() => globalThis.process.kill(process.pid, 0))
  const restarted = await ctx.plugin(plugin)
  const old = value(await call('project_dag_status', { workspaceRoot: root }))
  assert.equal(old.committed.digest, stale.committed.digest)
  assert.equal(old.invalidation.stale, true)
  await restarted.dispose()
  console.log(JSON.stringify({ tier: 'official-DSH-independent-Node-installed-Python-wheels',
    digest: fixture.digest, projectDigest: committed.committed.digest, restart: true,
    concurrency: true, preDispatchCancel: true, denied: true, invalidation: true,
    sameCoreAdapterComparison: true, actualFileMutationRejected: true, wrongThreadRejected: true,
    pids: processes.map(p => p.pid) }))
} finally {
  await ctx.fiber.dispose()
  await Promise.allSettled(processes.map(process => process.close()))
}
