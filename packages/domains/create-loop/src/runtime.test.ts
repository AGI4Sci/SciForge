import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  canonicalizeReproSpecForDigest,
  sciforgeReproSpecSchema,
  type DomainExecutionEventV1,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'
import {
  createDatasetWorkflowExecutionReceiptProvider,
  renderDatasetLoopRunReport
} from '@sciforge/domain-dataset-api/receipt-provider'
import {
  CreateLoopRuntime,
  createLoopStatePath
} from './runtime.js'
import {
  defaultWorkflowSettings
} from './workflow-settings.js'
import type { WorkflowRunV1, WorkflowV1 } from './contract.js'
import {
  createWorkflowExecutionSnapshot,
  createWorkflowReproSpec,
  createWorkflowRunContext,
  createWorkflowRunManifest,
  parseCreateLoopReproSpec
} from './rerun.js'

test('persists the canonical Workflow V1 graph and run history', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let sequence = 0
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    createId: () => `fixture-${++sequence}`,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  const trigger = workflow.nodes[0]
  if (trigger?.type !== 'manual-trigger') throw new Error('Fixture trigger changed unexpectedly.')
  trigger.config.workspaceRoot = '/trigger-workspace'
  const settings = { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }
  const saved = await runtime.save(settings, 0)
  assert.equal(saved.revision, 1)
  assert.equal(saved.settings.workflows[0]?.nodes.length, 3)

  const started = await runtime.runWorkflow(workflow.id, { topic: 'biology' }, '/workspace')
  assert.equal(started.ok, true)
  await waitForRun(runtime, workflow.id)
  const completed = await runtime.read()
  assert.equal(completed.settings.workflows[0]?.lastStatus, 'success')
  assert.equal(completed.settings.workflows[0]?.runs.length, 1)
  assert.match(completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.outputJson ?? '', /biology/)
  assert.equal(completed.settings.workflows[0]?.runs[0]?.manifest?.context.nodeVersion, process.version)
  assert.equal(completed.settings.workflows[0]?.runs[0]?.manifest?.context.platform, process.platform)
  assert.equal(completed.settings.workflows[0]?.runs[0]?.manifest?.context.architecture, process.arch)
  assert.equal(completed.settings.workflows[0]?.runs[0]?.manifest?.context.workspaceRoot, '/workspace')
  await deactivate()

  const reloaded = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivateReloaded = await reloaded.activate(runtimeContext())
  assert.equal((await reloaded.read()).settings.workflows[0]?.runs.length, 1)
  await deactivateReloaded()
})

test('rejects stale saves and cancels active delay nodes', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'template',
    name: 'Wait',
    type: 'delay',
    position: { x: 200, y: 0 },
    disabled: false,
    config: { delayMs: 60_000 }
  }
  const settings = { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }
  await runtime.save(settings, 0)
  await assert.rejects(runtime.save(settings, 0), /changed from revision 0 to 1/)

  await runtime.runWorkflow(workflow.id, undefined, '/workspace')
  await waitForNodeStatus(runtime, workflow.id, 'template', 'running')
  assert.equal((await runtime.stopWorkflow(workflow.id)).ok, true)
  await waitForRun(runtime, workflow.id)
  const stopped = await runtime.read()
  assert.equal(stopped.settings.workflows[0]?.lastStatus, 'error')
  const stoppedNode = stopped.settings.workflows[0]?.runs[0]?.nodeResults.find((result) => result.nodeId === 'template')
  assert.equal(stoppedNode?.status, 'error', JSON.stringify(stopped.settings.workflows[0]?.runs[0]))
  assert.match(stoppedNode?.error ?? '', /stopped/i)
  await deactivate()
})

test('rejects duplicate workflow node ids before they can shadow approvals at runtime', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  workflow.nodes.push({
    ...structuredClone(workflow.nodes[1]!),
    type: 'human-approval',
    config: {
      title: 'Shadowed approval',
      instruction: 'Must not be shadowed by the earlier node.',
      timeoutMs: 0,
      onTimeout: 'rejected'
    }
  } as WorkflowV1['nodes'][number])

  await assert.rejects(
    runtime.save({ ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }, 0),
    /duplicate node id/u
  )
  await deactivate()
})

test('routes AI Agent nodes through the Host agent execution port and records the thread', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const requests: Parameters<NonNullable<DomainMainRuntimeLifecycleContext['agentExecution']>['run']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    agentExecution: {
      run: async (request) => {
        requests.push(request)
        return { text: 'agent result', threadId: 'thread-agent-1' }
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'agent',
    name: 'Agent',
    type: 'ai-agent',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      prompt: 'Investigate {{json.topic}}',
      workspaceRoot: '/node-workspace',
      runtimeId: 'codex',
      providerId: '',
      model: 'gpt-test',
      reasoningEffort: 'high',
      mode: 'agent'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'agent', targetHandle: '' },
    { id: 'edge-2', source: 'agent', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save(
    {
      ...defaultWorkflowSettings(),
      enabled: true,
      defaultWorkspaceRoot: '/default-workspace',
      workflows: [workflow]
    },
    0
  )

  await runtime.runWorkflow(workflow.id, { topic: 'biology' })
  await waitForRun(runtime, workflow.id)

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.workspaceRoot, '/node-workspace')
  assert.equal(requests[0]?.runtimeId, 'codex')
  assert.equal(requests[0]?.prompt, 'Investigate biology')
  const completed = await runtime.read()
  assert.equal(
    completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.threadId,
    'thread-agent-1'
  )
  await deactivate()
})

test('executes normal HTTP credentials in memory but redacts every persisted terminal resource', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const canary = 'create-loop-authorization-canary'
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  let observedAuthorization = ''
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    observedAuthorization = new Headers(init?.headers).get('authorization') ?? ''
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'http',
    name: 'Authenticated request',
    type: 'http-request',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      method: 'GET',
      url: 'https://example.invalid/data',
      headers: [{ key: 'Authorization', value: `Bearer ${canary}` }],
      body: '',
      timeoutMs: 1_000,
      parseJson: true
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'http', targetHandle: '' },
    { id: 'edge-2', source: 'http', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  const started = await runtime.runWorkflow(workflow.id, {}, '/workspace')
  assert.equal(started.ok, true)
  await waitForRun(runtime, workflow.id)
  assert.equal(observedAuthorization, `Bearer ${canary}`)

  const run = (await runtime.read()).settings.workflows[0]!.runs[0]!
  assert.equal(run.status, 'success')
  assert.doesNotMatch(JSON.stringify(run.manifest), new RegExp(canary, 'u'))
  assert.doesNotMatch(JSON.stringify(published), new RegExp(canary, 'u'))

  const spec = await runtime.exportReproSpec(workflow.id, run.id)
  assert.equal(spec.executionReady, false)
  assert.equal(spec.secretSlots.length, 1)
  assert.equal(
    spec.breakpoints.some((point) => (
      point.code === 'secret_binding_resolver_unavailable' && point.blocking
    )),
    true
  )
  assert.doesNotMatch(JSON.stringify(spec), new RegExp(canary, 'u'))
  assert.throws(() => parseCreateLoopReproSpec(spec), /no safe secret resolver/u)
  await assert.rejects(runtime.runRerun(spec, '/workspace'), /no safe secret resolver/u)

  const terminal = published.find((event) => event.phase === 'run_completed')
  const terminalSpec = terminal?.artifacts?.find((artifact) => (
    isRecord(artifact) && artifact.kind === 'sciforge.repro-spec'
  ))
  assert.equal(isRecord(terminalSpec) && isRecord(terminalSpec.spec), true)
  assert.equal(
    isRecord(terminalSpec) && isRecord(terminalSpec.spec)
      ? terminalSpec.spec.executionReady
      : undefined,
    false
  )
  await deactivate()
})

test('redacts structured run input and node output before state, export, and terminal persistence', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const canary = 'structured-runtime-secret-canary'
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(structuredClone(event))
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  const started = await runtime.runWorkflow(workflow.id, {
    topic: 'biology',
    credentials: { refreshToken: canary },
    headers: [{ key: 'Authorization', value: `Bearer ${canary}` }]
  }, '/workspace')
  assert.equal(started.ok, true)
  await waitForRun(runtime, workflow.id)

  const snapshot = await runtime.read()
  const serializedState = JSON.stringify(snapshot)
  assert.doesNotMatch(serializedState, new RegExp(canary, 'u'))
  assert.doesNotMatch(JSON.stringify(published), new RegExp(canary, 'u'))
  const run = snapshot.settings.workflows[0]!.runs[0]!
  const spec = await runtime.exportReproSpec(workflow.id, run.id)
  assert.equal(spec.executionReady, false)
  assert.equal(spec.secretSlots.length >= 2, true)
  assert.doesNotMatch(JSON.stringify(spec), new RegExp(canary, 'u'))
  await assert.rejects(runtime.runRerun(spec, '/workspace'), /no safe secret resolver/u)
  await deactivate()
})

test('scrubs echoed bearer and URL userinfo secrets from failures, receipts, state, and execution events', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const statePath = createLoopStatePath(root)
  const bearerCanary = 'bearer-runtime-secret-canary'
  const userinfoCanary = 'url-userinfo-secret-canary'
  const endpoint = `https://demo:${userinfoCanary}@example.invalid/data`
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    throw new Error(`request rejected for ${String(input)} with ${authorization}`)
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const runtime = new CreateLoopRuntime({
    statePath,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(structuredClone(event))
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'http',
    name: 'Echoing HTTP failure',
    type: 'http-request',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      method: 'GET',
      url: '{{json.endpoint}}',
      headers: [{ key: 'Authorization', value: 'Bearer {{json.token}}' }],
      body: '',
      timeoutMs: 1_000,
      parseJson: true
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'http', targetHandle: '' },
    { id: 'edge-2', source: 'http', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  assert.equal((await runtime.runWorkflow(workflow.id, {
    endpoint,
    token: bearerCanary
  }, '/workspace')).ok, true)
  await waitForRun(runtime, workflow.id)

  const snapshot = await runtime.read()
  const run = snapshot.settings.workflows[0]!.runs[0]!
  const failedNode = run.nodeResults.find((result) => result.nodeId === 'http')!
  assert.equal(run.status, 'error')
  assert.match(`${run.message}\n${failedNode.error}\n${failedNode.attempts[0]?.receipt.detail}`, /\[REDACTED\]/u)
  for (const serialized of [
    JSON.stringify(snapshot),
    await readFile(statePath, 'utf8'),
    JSON.stringify(published)
  ]) {
    assert.doesNotMatch(serialized, new RegExp(bearerCanary, 'u'))
    assert.doesNotMatch(serialized, new RegExp(userinfoCanary, 'u'))
  }
  await deactivate()
})

test('blocks a self-consistent re-signed spec that is not the trusted local export', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )
  await runtime.runWorkflow(workflow.id, { topic: 'biology' }, '/workspace')
  await waitForRun(runtime, workflow.id)
  const run = (await runtime.read()).settings.workflows[0]!.runs[0]!
  const exported = await runtime.exportReproSpec(workflow.id, run.id)
  const forged = resignRuntimeSpec({ ...exported, specId: 'attacker-re-signed-spec' })

  await assert.rejects(
    runtime.runRerun(forged, '/workspace'),
    /was not exported by this Create Loop instance/u
  )
  assert.equal((await runtime.read()).settings.workflows[0]?.runs.length, 1)
  assert.deepEqual(runtime.status().runningWorkflowIds, [])
  await deactivate()
})

test('persists and replays one deterministic redacted terminal intent after Host publish failure', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const statePath = createLoopStatePath(root)
  const canary = 'pending-terminal-secret-canary'
  type ExecutionEventInput = Parameters<
    DomainMainRuntimeLifecycleContext['executionEvents']['publish']
  >[0]
  const firstTerminalAttempts: ExecutionEventInput[] = []
  let firstSequence = 0
  const firstRuntime = new CreateLoopRuntime({
    statePath,
    createId: () => `terminal-fixture-${++firstSequence}`,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivateFirst = await firstRuntime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        if (event.phase === 'run_completed' || event.phase === 'run_failed') {
          firstTerminalAttempts.push(structuredClone(event))
          throw new Error('Host fanout failed after durable acceptance.')
        }
        return publishedEvent(event, firstSequence)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.env = [{ key: 'API_TOKEN', type: 'secret', value: canary }]
  await firstRuntime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  assert.equal((await firstRuntime.runWorkflow(workflow.id, {}, '/workspace')).ok, true)
  await waitForRun(firstRuntime, workflow.id)
  assert.equal(firstTerminalAttempts.length, 1)

  const failedState = JSON.parse(await readFile(statePath, 'utf8')) as {
    schemaVersion: number
    settings: { workflows: Array<{ runs: unknown[] }> }
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.equal(failedState.schemaVersion, 3)
  assert.equal(failedState.settings.workflows[0]?.runs.length, 1)
  assert.equal(failedState.pendingExecutionEvents.length, 1)
  if (process.platform !== 'win32') {
    assert.equal((await stat(statePath)).mode & 0o777, 0o600)
    assert.equal((await stat(path.dirname(statePath))).mode & 0o777, 0o700)
  }
  const pending = failedState.pendingExecutionEvents[0]!
  const firstAttempt = firstTerminalAttempts[0]!
  assert.match(pending.eventId ?? '', /^create-loop-terminal:[0-9a-f]{64}$/u)
  assert.equal(pending.eventId, firstAttempt.eventId)
  assert.deepEqual(pending.artifacts, firstAttempt.artifacts)
  assert.deepEqual(pending, firstAttempt)
  assert.doesNotMatch(JSON.stringify(pending), new RegExp(canary, 'u'))

  const beforeSave = await firstRuntime.read()
  await firstRuntime.save(beforeSave.settings, beforeSave.revision)
  const afterSave = JSON.parse(await readFile(statePath, 'utf8')) as {
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.equal(afterSave.pendingExecutionEvents.length, 1)
  assert.equal(afterSave.pendingExecutionEvents[0]?.eventId, pending.eventId)
  await deactivateFirst()

  const replayed: ExecutionEventInput[] = []
  const secondRuntime = new CreateLoopRuntime({
    statePath,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivateSecond = await secondRuntime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        replayed.push(structuredClone(event))
        return publishedEvent(event, replayed.length)
      }
    }
  }))

  assert.equal(replayed.length, 1)
  assert.equal(replayed[0]?.eventId, pending.eventId)
  assert.deepEqual(replayed[0]?.artifacts, pending.artifacts)
  assert.deepEqual(replayed[0], pending)
  assert.doesNotMatch(JSON.stringify(replayed[0]), new RegExp(canary, 'u'))
  assert.equal((await secondRuntime.read()).settings.workflows[0]?.runs.length, 1)
  const replayedState = JSON.parse(await readFile(statePath, 'utf8')) as {
    schemaVersion: number
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.equal(replayedState.schemaVersion, 3)
  assert.deepEqual(replayedState.pendingExecutionEvents, [])
  await deactivateSecond()
})

test('migrates legacy state once into the pending execution event schema', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const statePath = createLoopStatePath(root)
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 2,
    revision: 7,
    settings: defaultWorkflowSettings(),
    approvalJournal: []
  })}\n`, 'utf8')

  const runtime = new CreateLoopRuntime({
    statePath,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  assert.equal((await runtime.read()).revision, 7)
  const migrated = JSON.parse(await readFile(statePath, 'utf8')) as {
    schemaVersion: number
    pendingExecutionEvents: unknown[]
  }
  assert.equal(migrated.schemaVersion, 3)
  assert.deepEqual(migrated.pendingExecutionEvents, [])
  await deactivate()
})

test('fails closed at terminal outbox capacity without discarding the oldest intent', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const statePath = createLoopStatePath(root)
  type ExecutionEventInput = Parameters<
    DomainMainRuntimeLifecycleContext['executionEvents']['publish']
  >[0]
  const published: ExecutionEventInput[] = []
  const runtime = new CreateLoopRuntime({
    statePath,
    maxPendingExecutionEvents: 1,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(structuredClone(event))
        if (event.phase === 'run_completed' || event.phase === 'run_failed') {
          throw new Error('Terminal delivery remains unavailable.')
        }
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  assert.equal((await runtime.runWorkflow(workflow.id, { run: 1 }, '/workspace')).ok, true)
  await waitForRun(runtime, workflow.id)
  const before = JSON.parse(await readFile(statePath, 'utf8')) as {
    settings: { workflows: Array<{ runs: unknown[] }> }
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.equal(before.pendingExecutionEvents.length, 1)
  const oldestEventId = before.pendingExecutionEvents[0]?.eventId

  const blocked = await runtime.runWorkflow(workflow.id, { run: 2 }, '/workspace')
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /terminal event delivery is backlogged/u)
  const after = JSON.parse(await readFile(statePath, 'utf8')) as {
    settings: { workflows: Array<{ runs: unknown[] }> }
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.equal(after.pendingExecutionEvents.length, 1)
  assert.equal(after.pendingExecutionEvents[0]?.eventId, oldestEventId)
  assert.equal(after.settings.workflows[0]?.runs.length, 1)
  assert.equal(published.filter((event) => event.phase === 'run_started').length, 1)
  assert.equal(published.filter((event) => event.eventId === oldestEventId).length, 2)
  await deactivate()
})

test('replay attempts later terminal intents while retaining an earlier failed delivery', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const statePath = createLoopStatePath(root)
  type ExecutionEventInput = Parameters<
    DomainMainRuntimeLifecycleContext['executionEvents']['publish']
  >[0]
  const terminalIntent = (eventId: string, runId: string): ExecutionEventInput => ({
    eventId,
    phase: 'run_completed',
    executionId: runId,
    runId,
    occurredAt: '2026-08-06T00:00:00.000Z',
    scope: {
      runtimeId: 'sciforge.create-loop',
      threadId: 'workflow:workflow-1'
    },
    payload: { runId },
    artifacts: [{ runId }]
  })
  const first = terminalIntent('terminal:first', 'run-first')
  const second = terminalIntent('terminal:second', 'run-second')
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 3,
    revision: 0,
    settings: defaultWorkflowSettings(),
    approvalJournal: [],
    pendingExecutionEvents: [first, second]
  })}\n`, 'utf8')

  const attempts: ExecutionEventInput[] = []
  const runtime = new CreateLoopRuntime({
    statePath,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        attempts.push(structuredClone(event))
        if (event.eventId === first.eventId) throw new Error('First consumer remains unavailable.')
        return publishedEvent(event, attempts.length)
      }
    }
  }))

  assert.deepEqual(attempts.map((event) => event.eventId), [first.eventId, second.eventId])
  const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
    pendingExecutionEvents: ExecutionEventInput[]
  }
  assert.deepEqual(
    persisted.pendingExecutionEvents.map((event) => event.eventId),
    [first.eventId]
  )
  assert.deepEqual(persisted.pendingExecutionEvents[0], first)
  await deactivate()
})

test('fails manual and rerun execution before events when workspace scope is empty', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  const manual = await runtime.runWorkflow(workflow.id)
  assert.equal(manual.ok, false)
  assert.match(manual.message, /non-empty workspace root/u)

  const snapshot = createWorkflowExecutionSnapshot(workflow)
  const manifest = createWorkflowRunManifest({
    source: 'workflow',
    workflow: snapshot,
    runInput: {},
    context: createWorkflowRunContext(
      snapshot,
      '',
      { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' }
    ),
    output: {},
    nodeResults: [],
    approvals: []
  })
  const spec = createWorkflowReproSpec({
    id: 'empty-workspace-baseline',
    trigger: 'manual',
    status: 'success',
    startedAt: '2026-08-06T00:00:00.000Z',
    finishedAt: '2026-08-06T00:00:01.000Z',
    message: 'fixture',
    nodeResults: [],
    manifest
  })
  const rerun = await runtime.runRerun(spec)
  assert.equal(rerun.ok, false)
  assert.match(rerun.message, /non-empty workspace root/u)
  assert.deepEqual(published, [])
  assert.deepEqual(runtime.status().runningWorkflowIds, [])
  await deactivate()
})

test('fails a due schedule before execution when no workspace can be resolved', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let scheduleTick: (() => void) | undefined
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    now: () => new Date('2026-08-06T00:00:00.000Z'),
    setInterval: (handler) => {
      scheduleTick = handler
      return { timer: true }
    },
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[0] = {
    id: 'trigger',
    name: 'Schedule',
    type: 'schedule-trigger',
    position: { x: 0, y: 0 },
    disabled: false,
    config: {
      schedule: {
        kind: 'interval',
        everyMinutes: 1,
        timeOfDay: '00:00',
        atTime: '',
        cron: ''
      },
      workspaceRoot: ''
    }
  }
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  assert.ok(scheduleTick)
  scheduleTick()
  await waitForWorkflowState(runtime, workflow.id, (candidate) => Boolean(candidate.nextRunAt))
  const scheduled = (await runtime.read()).settings.workflows[0]!
  assert.equal(scheduled.runs.length, 0)
  assert.deepEqual(published, [])
  assert.deepEqual(runtime.status().runningWorkflowIds, [])
  await deactivate()
})

test('fails a webhook-triggered workflow before execution when workspace scope is empty', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[0] = {
    id: 'trigger',
    name: 'Webhook',
    type: 'webhook-trigger',
    position: { x: 0, y: 0 },
    disabled: false,
    config: { path: '/empty-workspace', method: 'POST', workspaceRoot: '' }
  }
  await runtime.save({
    ...defaultWorkflowSettings(),
    enabled: false,
    workflows: [workflow]
  }, 0)

  const result = await runtime.runWorkflow(workflow.id, { input: true })
  assert.equal(result.ok, false)
  assert.match(result.message, /non-empty workspace root/u)
  assert.deepEqual(published, [])
  assert.deepEqual(runtime.status().runningWorkflowIds, [])
  assert.equal((await runtime.read()).settings.workflows[0]?.runs.length, 0)
  await deactivate()
})

test('does not guess between multiple execution-node workspaces', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  workflow.nodes.push(
    agentNode('agent-a', '/workspace-a'),
    agentNode('agent-b', '/workspace-b')
  )
  workflow.connections.push(
    { id: 'edge-agent-a', source: 'trigger', sourceHandle: '', target: 'agent-a', targetHandle: '' },
    { id: 'edge-agent-b', source: 'trigger', sourceHandle: '', target: 'agent-b', targetHandle: '' }
  )
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  const result = await runtime.runWorkflow(workflow.id)
  assert.equal(result.ok, false)
  assert.match(result.message, /multiple workspace roots/u)
  await deactivate()
})

test('reruns request a fresh approval, fingerprint the decision, and publish canonical events', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let sequence = 0
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    createId: () => `approval-fixture-${++sequence}`,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'approval',
    name: 'Review',
    type: 'human-approval',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      title: 'Review output',
      instruction: 'Approve this run.',
      timeoutMs: 0,
      onTimeout: 'rejected'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'approval', targetHandle: '' },
    { id: 'edge-2', source: 'approval', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  await runtime.runWorkflow(workflow.id, { topic: 'biology' }, '/workspace')
  const firstApproval = await waitForApproval(runtime)
  assert.equal(await runtime.resolveApproval(firstApproval.token, 'approved', 'alice'), true)
  await waitForRun(runtime, workflow.id)
  const firstRun = (await runtime.read()).settings.workflows[0]!.runs[0]!
  const spec = await runtime.exportReproSpec(workflow.id, firstRun.id)
  assert.equal(spec.activities[0]?.approvals[0]?.freshDecisionRequired, true)
  assert.equal(spec.activities[0]?.approvals[0]?.historicalDecisionId, undefined)

  await runtime.runRerun(spec, '/workspace')
  const secondApproval = await waitForApproval(runtime)
  assert.notEqual(secondApproval.token, firstApproval.token)
  assert.equal(await runtime.resolveApproval(secondApproval.token, 'approved', 'bob'), true)
  await waitForRun(runtime, workflow.id)

  const runs = (await runtime.read()).settings.workflows[0]!.runs
  assert.equal(runs.length, 2)
  assert.notEqual(runs[0]!.manifest?.approvalFingerprint, runs[1]!.manifest?.approvalFingerprint)
  assert.equal(runs[1]!.manifest?.comparison?.replicationStatus, 'inconclusive')
  assert.equal(
    runs[1]!.manifest?.comparison?.reasonCodes.includes('approval_decision_changed'),
    true
  )
  assert.equal(published.filter((event) => event.phase === 'approval_requested').length, 2)
  assert.equal(
    published.some((event) => event.phase === 'run_completed' && event.artifacts?.some((artifact) => (
      typeof artifact === 'object' && artifact !== null && !Array.isArray(artifact) &&
      'kind' in artifact &&
      artifact.kind === 'sciforge.create-loop.run-manifest'
    ))),
    true
  )
  assert.equal(
    published.some((event) => event.phase === 'run_completed' && event.artifacts?.some((artifact) => (
      typeof artifact === 'object' && artifact !== null && !Array.isArray(artifact) &&
      'kind' in artifact && artifact.kind === 'sciforge.repro-spec' &&
      'spec' in artifact && typeof artifact.spec === 'object' && artifact.spec !== null
    ))),
    true
  )
  const startedEvents = published.filter((event) => event.phase === 'run_started')
  assert.equal(startedEvents.length, 2)
  assert.notEqual(startedEvents[0]?.executionId, startedEvents[1]?.executionId)
  assert.deepEqual(startedEvents[0]?.scope, {
    runtimeId: 'sciforge.create-loop',
    threadId: `workflow:${workflow.id}`
  })
  assert.deepEqual(startedEvents[1]?.scope, startedEvents[0]?.scope)
  assert.equal(
    published.every((event) => (
      event.scope?.runtimeId === 'sciforge.create-loop' &&
      event.scope.threadId === `workflow:${workflow.id}` &&
      event.workspaceRoot === '/workspace'
    )),
    true
  )
  await deactivate()
})

test('atomically claims an approval before concurrent decisions or timeout can reuse it', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        if (event.phase === 'approval_resolved') {
          await new Promise((resolve) => setTimeout(resolve, 350))
        }
        published.push(structuredClone(event))
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'approval',
    name: 'Race-safe review',
    type: 'human-approval',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      title: 'Review once',
      instruction: 'Exactly one decision may win.',
      timeoutMs: 250,
      onTimeout: 'rejected'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'approval', targetHandle: '' },
    { id: 'edge-2', source: 'approval', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  await runtime.runWorkflow(workflow.id, { topic: 'biology' }, '/workspace')
  const approval = await waitForApproval(runtime)
  const [approved, rejected] = await Promise.all([
    runtime.resolveApproval(approval.token, 'approved', 'alice'),
    runtime.resolveApproval(approval.token, 'rejected', 'mallory')
  ])
  assert.deepEqual([approved, rejected], [true, false])
  await waitForRun(runtime, workflow.id)

  const resolutions = published.filter((event) => event.phase === 'approval_resolved')
  assert.equal(resolutions.length, 1)
  assert.equal(
    isRecord(resolutions[0]?.payload) ? resolutions[0]?.payload.decision : undefined,
    'approved'
  )
  assert.equal((await runtime.read()).settings.workflows[0]?.runs[0]?.status, 'success')
  await deactivate()
})

test('execution events retain the resolved default and trigger workspace scope', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const published: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    executionEvents: {
      publish: async (event) => {
        published.push(event)
        return publishedEvent(event, published.length)
      }
    }
  }))
  const workflow = fixtureWorkflow()
  await runtime.save({
    ...defaultWorkflowSettings(),
    enabled: true,
    defaultWorkspaceRoot: '/default-workspace',
    workflows: [workflow]
  }, 0)

  await runtime.runWorkflow(workflow.id)
  await waitForRun(runtime, workflow.id)
  assert.equal(published.length > 0, true)
  assert.equal(published.every((event) => event.workspaceRoot === '/default-workspace'), true)

  published.length = 0
  const snapshot = await runtime.read()
  const nextWorkflow = snapshot.settings.workflows[0]!
  const trigger = nextWorkflow.nodes[0]!
  if (trigger.type !== 'manual-trigger') throw new Error('Fixture trigger changed unexpectedly.')
  trigger.config.workspaceRoot = '/trigger-workspace'
  await runtime.save(snapshot.settings, snapshot.revision)
  await runtime.runWorkflow(workflow.id)
  await waitForRun(runtime, workflow.id)
  assert.equal(published.length > 0, true)
  assert.equal(published.every((event) => event.workspaceRoot === '/trigger-workspace'), true)
  await deactivate()
})

test('hydrates dataset preparation from the immutable execution report instead of Agent claims', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-receipt-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runsRoot = path.join(root, '.sciforge', 'datasets', 'runs')
  const artifactPath = path.join(root, '.sciforge', 'datasets', 'processed', 'actual.tsv')
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await mkdir(runsRoot, { recursive: true })
  await writeFile(artifactPath, 'id\tvalue\n1\tobserved\n', 'utf8')
  const artifactSha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex')
  const execution = {
    version: 1,
    runId: 'run-actual',
    planId: 'plan-actual',
    status: 'succeeded',
    completedAt: '2026-08-06T00:00:01.000Z',
    steps: [{
      index: 0,
      tool: 'dataset_filter',
      status: 'succeeded',
      counts: { inputRecords: 2, outputRecords: 1, recordSamples: [{ id: '1', value: 'observed' }] },
      artifacts: [{ key: 'artifact', path: artifactPath, sha256: artifactSha256 }]
    }]
  }
  const runPath = path.join(runsRoot, 'run-actual.json')
  await writeFile(runPath, JSON.stringify(execution), 'utf8')

  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    executionReceiptProviders: [createDatasetWorkflowExecutionReceiptProvider()],
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    agentExecution: {
      run: async () => ({
        text: JSON.stringify({
          preparationPlanId: 'plan-actual',
          preparationExecution: { planId: 'plan-actual', status: 'succeeded', steps: [] },
          preparationArtifacts: [{ path: 'invented.tsv', sha256: 'fake' }],
          processingComplete: true,
          groundingComplete: true
        }),
        threadId: 'preparation-thread'
      })
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.id = 'dataset-receipt-hydration'
  workflow.env = [{ key: 'SCIFORGE_GENERATED_KIND', value: 'dataset-generation', type: 'string' }]
  workflow.nodes[1] = {
    id: 'preparation',
    name: 'Preparation',
    type: 'ai-agent',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      prompt: 'Execute preparation.',
      workspaceRoot: '',
      providerId: '',
      model: '',
      reasoningEffort: 'medium',
      mode: 'agent'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'preparation', targetHandle: '' },
    { id: 'edge-2', source: 'preparation', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save({ ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }, 0)
  const started = await runtime.runWorkflow(workflow.id, {}, root)
  assert.equal(started.ok, true, JSON.stringify(started))
  await waitForRun(runtime, workflow.id)

  const completed = await runtime.read()
  const completedWorkflow = completed.settings.workflows.find((candidate) => candidate.id === workflow.id)
  assert.ok(completedWorkflow, JSON.stringify(completed.settings.workflows.map((candidate) => candidate.id)))
  const completedRun = completedWorkflow.runs.at(-1)
  const result = completedRun?.nodeResults.find((node) => node.nodeId === 'preparation')
  assert.ok(result, JSON.stringify(completedRun))
  assert.equal(result.status, 'success', JSON.stringify(result))
  const wrapped = JSON.parse(result?.outputJson ?? '{}') as { text?: string }
  const hydrated = JSON.parse(wrapped.text ?? '{}') as {
    preparationExecution?: { steps?: Array<{ counts?: { outputRecords?: number } }> }
    preparationArtifacts?: Array<{ path: string; sha256: string }>
  }
  assert.equal(hydrated.preparationExecution?.steps?.[0]?.counts?.outputRecords, 1)
  assert.equal(hydrated.preparationArtifacts?.some((artifact) => artifact.path === 'invented.tsv'), false)
  assert.equal(hydrated.preparationArtifacts?.some((artifact) => artifact.path === artifactPath && artifact.sha256 === artifactSha256), true)
  assert.equal(hydrated.preparationArtifacts?.some((artifact) => artifact.path === runPath), true)
  await deactivate()
})

test('recovers dataset preparation from a matching verified run after Agent failure', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-recovery-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runsRoot = path.join(root, '.sciforge', 'datasets', 'runs')
  const artifactPath = path.join(root, '.sciforge', 'datasets', 'processed', 'recovered.tsv')
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await mkdir(runsRoot, { recursive: true })
  await writeFile(artifactPath, 'id\tvalue\n1\trecovered\n', 'utf8')
  const artifactSha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex')
  const runPath = path.join(runsRoot, 'run-recovered.json')
  await writeFile(runPath, JSON.stringify({
    version: 1,
    runId: 'run-recovered',
    planId: 'plan-recovered',
    status: 'succeeded',
    startedAt: '2999-01-01T00:00:00.000Z',
    completedAt: '2999-01-01T00:00:01.000Z',
    steps: [{
      index: 0,
      tool: 'dataset_filter',
      status: 'succeeded',
      counts: { inputRecords: 2, outputRecords: 1, recordSamples: [{ id: '1', value: 'recovered' }] },
      artifacts: [{ key: 'artifact', path: artifactPath, sha256: artifactSha256 }]
    }]
  }), 'utf8')

  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    executionReceiptProviders: [createDatasetWorkflowExecutionReceiptProvider()],
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    agentExecution: { run: async () => { throw new Error('Agent stopped after tool execution.') } }
  }))
  const workflow = fixtureWorkflow()
  workflow.id = 'dataset-receipt-recovery'
  workflow.env = [{ key: 'SCIFORGE_GENERATED_KIND', value: 'dataset-generation', type: 'string' }]
  workflow.nodes[1] = {
    id: 'preparation',
    name: 'Preparation',
    type: 'ai-agent',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      prompt: 'Execute preparation.', workspaceRoot: '', providerId: '', model: '', reasoningEffort: 'medium', mode: 'agent'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'preparation', targetHandle: '' },
    { id: 'edge-2', source: 'preparation', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save({ ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }, 0)
  const started = await runtime.runWorkflow(workflow.id, {
    processingRecipe: [{ capability: 'dataset-api.filter', purpose: 'Filter records.' }]
  }, root)
  assert.equal(started.ok, true, JSON.stringify(started))
  await waitForRun(runtime, workflow.id)

  const completed = await runtime.read()
  const completedRun = completed.settings.workflows.find((candidate) => candidate.id === workflow.id)?.runs.at(-1)
  const result = completedRun?.nodeResults.find((node) => node.nodeId === 'preparation')
  assert.equal(result?.status, 'success', JSON.stringify(completedRun))
  assert.match(result?.error ?? '', /Recovered from immutable execution receipt/)
  const wrapped = JSON.parse(result?.outputJson ?? '{}') as { text?: string }
  const recovered = JSON.parse(wrapped.text ?? '{}') as {
    preparationPlanId?: string
    preparationExecution?: { steps?: Array<{ counts?: { outputRecords?: number } }> }
    preparationArtifacts?: Array<{ path: string; sha256: string }>
  }
  assert.equal(recovered.preparationPlanId, 'plan-recovered')
  assert.equal(recovered.preparationExecution?.steps?.[0]?.counts?.outputRecords, 1)
  assert.equal(recovered.preparationArtifacts?.some((artifact) => artifact.path === runPath), true)
  await deactivate()
})

test('replaces an Agent-reported failed preparation plan with a matching successful retry', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-failed-receipt-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runsRoot = path.join(root, '.sciforge', 'datasets', 'runs')
  const artifactPath = path.join(root, '.sciforge', 'datasets', 'processed', 'successful-retry.tsv')
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await mkdir(runsRoot, { recursive: true })
  await writeFile(artifactPath, 'id\tvalue\n1\tsuccessful retry\n', 'utf8')
  const artifactSha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex')
  await writeFile(path.join(runsRoot, 'run-failed.json'), JSON.stringify({
    version: 1,
    runId: 'run-failed',
    planId: 'plan-failed',
    status: 'failed',
    startedAt: '2999-01-01T00:00:02.000Z',
    completedAt: '2999-01-01T00:00:03.000Z',
    steps: [{ index: 0, tool: 'dataset_filter', status: 'failed', artifacts: [] }]
  }), 'utf8')
  const successfulRunPath = path.join(runsRoot, 'run-successful-retry.json')
  await writeFile(successfulRunPath, JSON.stringify({
    version: 1,
    runId: 'run-successful-retry',
    planId: 'plan-successful-retry',
    status: 'succeeded',
    startedAt: '2999-01-01T00:00:00.000Z',
    completedAt: '2999-01-01T00:00:01.000Z',
    steps: [{
      index: 0,
      tool: 'dataset_filter',
      status: 'succeeded',
      counts: { inputRecords: 2, outputRecords: 1, recordSamples: [{ id: '1', value: 'successful retry' }] },
      artifacts: [{ key: 'artifact', path: artifactPath, sha256: artifactSha256 }]
    }]
  }), 'utf8')

  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    executionReceiptProviders: [createDatasetWorkflowExecutionReceiptProvider()],
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    agentExecution: {
      run: async () => ({
        text: JSON.stringify({
          preparationPlanId: 'plan-failed',
          preparationExecution: { planId: 'plan-failed', status: 'failed', steps: [] },
          preparationArtifacts: [],
          processingComplete: false,
          groundingComplete: false
        })
      })
    }
  }))
  const workflow = fixtureWorkflow()
  workflow.id = 'dataset-failed-receipt-recovery'
  workflow.env = [{ key: 'SCIFORGE_GENERATED_KIND', value: 'dataset-generation', type: 'string' }]
  workflow.nodes[1] = {
    id: 'preparation',
    name: 'Preparation',
    type: 'ai-agent',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      prompt: 'Execute preparation.', workspaceRoot: '', providerId: '', model: '', reasoningEffort: 'medium', mode: 'agent'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'preparation', targetHandle: '' },
    { id: 'edge-2', source: 'preparation', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  await runtime.save({ ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }, 0)
  const started = await runtime.runWorkflow(workflow.id, {
    processingRecipe: [{ capability: 'dataset-api.filter', purpose: 'Filter records.' }]
  }, root)
  assert.equal(started.ok, true, JSON.stringify(started))
  await waitForRun(runtime, workflow.id)

  const completed = await runtime.read()
  const completedRun = completed.settings.workflows.find((candidate) => candidate.id === workflow.id)?.runs.at(-1)
  const result = completedRun?.nodeResults.find((node) => node.nodeId === 'preparation')
  assert.equal(result?.status, 'success', JSON.stringify(completedRun))
  const wrapped = JSON.parse(result?.outputJson ?? '{}') as { text?: string }
  const recovered = JSON.parse(wrapped.text ?? '{}') as {
    preparationPlanId?: string
    preparationExecution?: { status?: string }
    preparationArtifacts?: Array<{ path: string; sha256: string }>
  }
  assert.equal(recovered.preparationPlanId, 'plan-successful-retry')
  assert.equal(recovered.preparationExecution?.status, 'succeeded')
  assert.equal(recovered.preparationArtifacts?.some((artifact) => artifact.path === successfulRunPath), true)
  await deactivate()
})

test('failure reports retain the latest designed state and node errors', () => {
  const workflow = fixtureWorkflow()
  workflow.env = [{ key: 'SCIFORGE_GENERATED_KIND', value: 'dataset-generation', type: 'string' }]
  const run: WorkflowRunV1 = {
    id: 'failed-run',
    trigger: 'manual',
    status: 'error',
    startedAt: '2026-08-06T00:00:00.000Z',
    finishedAt: '2026-08-06T00:01:00.000Z',
    message: 'Agent execution failed.',
    nodeResults: [
      {
        nodeId: 'initialize',
        status: 'success',
        startedAt: '2026-08-06T00:00:00.000Z',
        finishedAt: '2026-08-06T00:00:01.000Z',
        message: '',
        inputJson: '{}',
        outputJson: JSON.stringify({
          outputSchema: { question: { type: 'string', required: true } },
          processingRecipe: [{ capability: 'dataset-api.raw-data', purpose: 'Acquire evidence.' }],
          strategy: { version: 1, revisions: [] }
        }),
        retries: 0,
        threadId: '',
        error: '',
        componentFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        inputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        outputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        attempts: [],
        artifactRefs: []
      },
      {
        nodeId: 'grounding',
        status: 'error',
        startedAt: '2026-08-06T00:00:01.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
        message: '',
        inputJson: '{}',
        outputJson: '',
        retries: 1,
        threadId: '',
        error: 'Agent execution failed.',
        componentFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        inputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        outputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        attempts: [],
        artifactRefs: []
      },
      {
        nodeId: 'generation-loop',
        status: 'error',
        startedAt: '2026-08-06T00:00:01.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
        message: '',
        inputJson: '{}',
        outputJson: '',
        retries: 0,
        threadId: '',
        error: 'Model Router rejected a private model slug.',
        componentFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        inputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        outputFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        attempts: [],
        artifactRefs: []
      }
    ]
  }
  const report = renderDatasetLoopRunReport(workflow, run)
  assert.match(report, /\| question \| string \| yes \|/)
  assert.match(report, /dataset-api\.raw-data/)
  assert.match(report, /\| Message \| Agent execution failed\. \|/)
  assert.match(report, /`grounding` \| error .* Agent execution failed\./)
})

test('repairs common JSON-like model output before downstream workflow nodes run', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'template',
    name: 'Loose JSON',
    type: 'template',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      template: "```json\n{state: {ok: true}, 'candidate': {id: 1}, rubric: [\"difficulty example \"TP53 interaction\"\"],}\n```",
      outputMode: 'json'
    }
  }
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )
  await runtime.runWorkflow(workflow.id, undefined, '/workspace')
  await waitForRun(runtime, workflow.id)
  const completed = await runtime.read()
  assert.equal(completed.settings.workflows[0]?.lastStatus, 'success')
  assert.deepEqual(
    JSON.parse(completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.outputJson ?? '{}'),
    {
      state: { ok: true },
      candidate: { id: 1 },
      rubric: ['difficulty example "TP53 interaction"']
    }
  )
  await deactivate()
})

test('prefers the final parseable JSON value after malformed reasoning examples', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'template',
    name: 'Reasoning followed by JSON',
    type: 'template',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      template: 'Example shape: {"state":<unchanged>,"verifier":{...}}\nFinal answer:\n{"state":{"round":2},"verifier":{"grounded":false}}',
      outputMode: 'json'
    }
  }
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )
  await runtime.runWorkflow(workflow.id, undefined, '/workspace')
  await waitForRun(runtime, workflow.id)
  const completed = await runtime.read()
  assert.equal(completed.settings.workflows[0]?.lastStatus, 'success')
  assert.deepEqual(
    JSON.parse(completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.outputJson ?? '{}'),
    { state: { round: 2 }, verifier: { grounded: false } }
  )
  await deactivate()
})

function fixtureWorkflow(): WorkflowV1 {
  const now = '2026-07-28T00:00:00.000Z'
  return {
    id: 'workflow-1',
    name: 'Existing node workflow',
    enabled: true,
    callableByAgent: true,
    env: [],
    nodes: [
      {
        id: 'trigger',
        name: 'Manual',
        type: 'manual-trigger',
        position: { x: 0, y: 0 },
        disabled: false,
        config: { workspaceRoot: '', inputSchema: [] }
      },
      {
        id: 'template',
        name: 'Template',
        type: 'template',
        position: { x: 200, y: 0 },
        disabled: false,
        config: { template: 'Topic: {{json.topic}}', outputMode: 'text' }
      },
      {
        id: 'output',
        name: 'Output',
        type: 'output',
        position: { x: 400, y: 0 },
        disabled: false,
        config: { mode: 'auto', textTemplate: '', jsonPath: '' }
      }
    ],
    connections: [
      { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'template', targetHandle: '' },
      { id: 'edge-2', source: 'template', sourceHandle: '', target: 'output', targetHandle: '' }
    ],
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: []
  }
}

function agentNode(
  id: string,
  workspaceRoot: string
): WorkflowV1['nodes'][number] {
  return {
    id,
    name: id,
    type: 'ai-agent',
    position: { x: 200, y: 100 },
    disabled: false,
    config: {
      prompt: 'Fixture',
      workspaceRoot,
      runtimeId: 'codex',
      providerId: '',
      model: 'fixture-model',
      reasoningEffort: 'low',
      mode: 'agent'
    }
  }
}

async function waitForWorkflowState(
  runtime: CreateLoopRuntime,
  workflowId: string,
  predicate: (workflow: WorkflowV1) => boolean
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const workflow = (await runtime.read()).settings.workflows.find(
      (candidate) => candidate.id === workflowId
    )
    if (workflow && predicate(workflow)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Workflow state did not reach the expected condition.')
}

async function waitForNodeStatus(
  runtime: CreateLoopRuntime,
  workflowId: string,
  nodeId: string,
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (runtime.status().nodeStatus[workflowId]?.[nodeId] === status) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Node ${nodeId} did not reach ${status}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resignRuntimeSpec(spec: SciForgeReproSpecV1): SciForgeReproSpecV1 {
  const provisional = sciforgeReproSpecSchema.parse({
    ...spec,
    specDigest: `sha256:${'0'.repeat(64)}`
  })
  return sciforgeReproSpecSchema.parse({
    ...provisional,
    specDigest: `sha256:${createHash('sha256')
      .update(canonicalizeReproSpecForDigest(provisional))
      .digest('hex')}`
  })
}

function runtimeContext(
  overrides: Partial<DomainMainRuntimeLifecycleContext> = {}
): DomainMainRuntimeLifecycleContext {
  return {
    userDataDir: '/unused',
    appRoot: '/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread',
        runtimeId: 'codex',
        watermark: '0',
        turns: [],
        artifacts: []
      }),
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => { throw new Error('not used') }
    },
    modelAccess: {
      textReasoner: async () => null
    },
    executionEvents: {
      publish: async (event) => publishedEvent(event, 0)
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: () => true,
      subscribe: () => (() => undefined)
    },
    log: () => undefined,
    owner: {
      moduleId: 'sciforge.create-loop',
      moduleVersion: '1.0.0'
    },
    signal: new AbortController().signal,
    ...overrides
  }
}

function publishedEvent(
  event: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0],
  sequence: number
): DomainExecutionEventV1 {
  return {
    schemaVersion: 'sciforge.execution-event.v1',
    eventId: `event-${sequence}-${event.executionId}-${event.phase}`,
    producer: {
      moduleId: 'sciforge.create-loop',
      moduleVersion: '1.0.0'
    },
    occurredAt: event.occurredAt ?? new Date(0).toISOString(),
    artifacts: event.artifacts ?? [],
    ...event
  } as DomainExecutionEventV1
}

async function waitForRun(runtime: CreateLoopRuntime, workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Workflow did not complete in time.')
}

async function waitForApproval(runtime: CreateLoopRuntime) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const approval = runtime.status().pendingApprovals[0]
    if (approval) return approval
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Workflow did not request approval in time.')
}
