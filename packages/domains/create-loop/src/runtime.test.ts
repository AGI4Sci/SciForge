import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  CreateLoopRuntime,
  createLoopStatePath
} from './runtime.js'
import {
  defaultWorkflowSettings
} from './workflow-settings.js'
import type { WorkflowV1 } from './contract.js'

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
  const settings = { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] }
  const saved = await runtime.save(settings, 0)
  assert.equal(saved.revision, 1)
  assert.equal(saved.settings.workflows[0]?.nodes.length, 3)

  const started = await runtime.runWorkflow(workflow.id, { topic: 'biology' })
  assert.equal(started.ok, true)
  await waitForRun(runtime, workflow.id)
  const completed = await runtime.read()
  assert.equal(completed.settings.workflows[0]?.lastStatus, 'success')
  assert.equal(completed.settings.workflows[0]?.runs.length, 1)
  assert.match(completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.outputJson ?? '', /biology/)
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

  await runtime.runWorkflow(workflow.id)
  assert.equal((await runtime.stopWorkflow(workflow.id)).ok, true)
  await waitForRun(runtime, workflow.id)
  assert.equal((await runtime.read()).settings.workflows[0]?.lastStatus, 'error')
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
      workspaceRoot: '',
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
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )

  await runtime.runWorkflow(workflow.id, { topic: 'biology' }, '/caller-workspace')
  await waitForRun(runtime, workflow.id)

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.workspaceRoot, '/caller-workspace')
  assert.equal(requests[0]?.runtimeId, 'codex')
  assert.equal(requests[0]?.prompt, 'Investigate biology')
  const completed = await runtime.read()
  assert.equal(
    completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.threadId,
    'thread-agent-1'
  )
  await deactivate()
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
    config: { template: "```json\n{state: {ok: true}, 'candidate': {id: 1},}\n```", outputMode: 'json' }
  }
  await runtime.save(
    { ...defaultWorkflowSettings(), enabled: true, workflows: [workflow] },
    0
  )
  await runtime.runWorkflow(workflow.id)
  await waitForRun(runtime, workflow.id)
  const completed = await runtime.read()
  assert.equal(completed.settings.workflows[0]?.lastStatus, 'success')
  assert.deepEqual(
    JSON.parse(completed.settings.workflows[0]?.runs[0]?.nodeResults[1]?.outputJson ?? '{}'),
    { state: { ok: true }, candidate: { id: 1 } }
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

async function waitForRun(runtime: CreateLoopRuntime, workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Workflow did not complete in time.')
}
