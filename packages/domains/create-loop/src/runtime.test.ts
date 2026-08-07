import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
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
  const stopped = await runtime.read()
  assert.equal(stopped.settings.workflows[0]?.lastStatus, 'error')
  const stoppedNode = stopped.settings.workflows[0]?.runs[0]?.nodeResults.find((result) => result.nodeId === 'template')
  assert.equal(stoppedNode?.status, 'error')
  assert.match(stoppedNode?.error ?? '', /stopped/i)
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
        error: ''
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
        error: 'Agent execution failed.'
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
        error: 'Model Router rejected a private model slug.'
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
  await runtime.runWorkflow(workflow.id)
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
  await runtime.runWorkflow(workflow.id)
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

async function waitForRun(runtime: CreateLoopRuntime, workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Workflow did not complete in time.')
}
