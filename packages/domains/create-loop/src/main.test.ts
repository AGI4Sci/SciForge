import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import { CREATE_LOOP_CAPABILITY_IDS, type WorkflowSettingsV1 } from './contract.js'
import {
  createCreateLoopCapabilityFactory,
  createDomainMainEntry,
  type CreateLoopCapabilityOptions
} from './main.js'
import type { CreateLoopRuntime } from './runtime.js'
import { defaultWorkflowSettings } from './workflow-settings.js'

test('publishes the complete node-workflow operation set through one governed factory', async () => {
  const settings = defaultWorkflowSettings()
  const runtime = {
    read: async () => ({ revision: 2, settings }),
    save: async () => ({ revision: 3, settings }),
    runWorkflow: async () => ({ ok: true, runId: 'run-1', status: 'running', message: 'started' }),
    stopWorkflow: async () => ({ ok: true, runId: 'run-1', status: 'error', message: 'stopped' }),
    status: () => ({
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }),
    resolveApproval: () => true,
    runNode: async () => ({ ok: true, runId: 'run-2', status: 'success', message: 'done' }),
    testNode: async () => ({ ok: false, message: 'not found' })
  } as unknown as CreateLoopRuntime
  const factory = createCreateLoopCapabilityFactory<CreateLoopCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  })
  const definitions = new Map(
    factory.createDefinitions().map((definition) => [definition.id, definition])
  )

  assert.deepEqual([...definitions.keys()], Object.values(CREATE_LOOP_CAPABILITY_IDS))
  assert.equal(definitions.get(CREATE_LOOP_CAPABILITY_IDS.read)?.effect, 'read')
  assert.equal(definitions.get(CREATE_LOOP_CAPABILITY_IDS.save)?.effect, 'workspace-write')
  assert.equal(definitions.get(CREATE_LOOP_CAPABILITY_IDS.buildDataset)?.effect, 'external-write')
  assert.equal(definitions.get(CREATE_LOOP_CAPABILITY_IDS.buildDataset)?.approval, 'confirmation')
  assert.deepEqual(definitions.get(CREATE_LOOP_CAPABILITY_IDS.buildDataset)?.tags, [
    'workflow', 'automation', 'loop', 'dataset', 'generation'
  ])
  assert.equal(definitions.get(CREATE_LOOP_CAPABILITY_IDS.run)?.approval, 'confirmation')
  assert.equal(
    definitions.get(CREATE_LOOP_CAPABILITY_IDS.run)?.concurrency.idempotency,
    'required'
  )
  assert.equal(factory.policy.directTransportPrefixes.length, 0)
  assert.deepEqual(
    await definitions.get(CREATE_LOOP_CAPABILITY_IDS.read)!.handler(
      {},
      { caller: { workspaceId: '/workspace' } }
    ),
    { output: { revision: 2, settings } }
  )
})

test('main entry owns one lifecycle and persists below the package data root', async () => {
  const calls: string[] = []
  const resourceExecutor = Object.freeze({
    id: 'fixture-data-provider',
    execute: async () => ({ result: { ok: true } })
  })
  const runtime = {
    activate: async () => {
      calls.push('activate')
      return async () => { calls.push('deactivate') }
    },
    close: async () => { calls.push('close') }
  } as unknown as CreateLoopRuntime
  const entry = createDomainMainEntry({
    getUserDataDir: () => '/unused',
    defineCapability: (definition) => definition,
    createCreateLoopRuntime: ({ statePath, resourceExecutors }) => {
      calls.push(`create:${statePath}`)
      calls.push(`resources:${resourceExecutors?.map((executor) => executor.id).join(',')}`)
      return runtime
    }
  })
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: DomainMainRuntimeLifecycleContext): Promise<unknown>
  }
  const deactivate = await lifecycle.activate({
    userDataDir: '/user-data',
    contributions: {
      list: () => [{
        id: 'fixture-data-provider.executor',
        kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
        packageName: '@fixture/data-provider',
        owner: { moduleId: 'fixture.data-provider', moduleVersion: '1.0.0' },
        contract: {
          location: 'create-loop.resource-executor',
          providerId: 'fixture-data-provider'
        },
        value: resourceExecutor
      }]
    }
  } as unknown as DomainMainRuntimeLifecycleContext) as () => Promise<void>
  assert.deepEqual(calls, [
    'create:/user-data/domains/create-loop/state.json',
    'resources:fixture-data-provider',
    'activate'
  ])
  await deactivate()
  await entry.contributions[1]!.onDispose?.()
  assert.deepEqual(calls, [
    'create:/user-data/domains/create-loop/state.json',
    'resources:fixture-data-provider',
    'activate',
    'deactivate'
  ])
})

test('builds, saves, and starts a conversational dataset loop without a preset', async () => {
  const settings = { ...defaultWorkflowSettings(), model: 'default-model' }
  let savedSettings = settings
  const runCalls: Array<{ workflowId: string; input: unknown; workspaceRoot: string }> = []
  const runtime = {
    read: async () => ({ revision: 4, settings }),
    save: async (next: typeof settings & { workflows?: unknown[] }) => {
      savedSettings = next as typeof settings
      return { revision: 5, settings: next }
    },
    runWorkflow: async (workflowId: string, input: unknown, workspaceRoot: string) => {
      runCalls.push({ workflowId, input, workspaceRoot })
      return { ok: true, runId: 'run-generated', status: 'running', message: 'started' }
    }
  } as unknown as CreateLoopRuntime
  const factory = createCreateLoopCapabilityFactory<CreateLoopCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  })
  const definition = factory.createDefinitions().find(
    (candidate) => candidate.id === CREATE_LOOP_CAPABILITY_IDS.buildDataset
  )!
  const result = await definition.handler({
    name: 'Protein QA',
    objective: 'Create grounded protein questions.',
    sourceIds: ['uniprot'],
    outputSchema: {
      question: { type: 'string', required: true },
      answer: { type: 'string', required: true }
    },
    quality: {
      criteria: ['Answers must be grounded.'],
      targetCount: 2,
      maxIterations: 4,
      minQualityScore: 0.7,
      minStrongScore: 0.65,
      maxWeakScore: 0.5,
      minScoreGap: 0.2,
      maxDuplicateFraction: 0
    },
    output: {
      datasetName: 'protein-qa',
      fileName: 'protein-qa.jsonl',
      format: 'jsonl'
    },
    humanReview: false,
    run: true
  }, { caller: { workspaceId: '/workspace' } }) as { output: Record<string, unknown> }

  assert.equal(savedSettings.enabled, true)
  assert.equal(savedSettings.presets.length, 0)
  assert.equal(savedSettings.workflows.length, 2)
  assert.equal(result.output.created, true)
  assert.equal(runCalls.length, 1)
  assert.equal(runCalls[0]?.workspaceRoot, '/workspace')
  assert.equal(runCalls[0]?.workflowId, result.output.workflowId)
})

test('re-enables an existing generated loop without replacing user edits', async () => {
  let revision = 1
  let currentSettings: WorkflowSettingsV1 = {
    ...defaultWorkflowSettings(),
    model: 'default-model'
  }
  const runtime = {
    read: async () => ({ revision, settings: currentSettings }),
    save: async (next: WorkflowSettingsV1) => {
      currentSettings = next
      revision += 1
      return { revision, settings: currentSettings }
    }
  } as unknown as CreateLoopRuntime
  const factory = createCreateLoopCapabilityFactory<CreateLoopCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  })
  const definition = factory.createDefinitions().find(
    (candidate) => candidate.id === CREATE_LOOP_CAPABILITY_IDS.buildDataset
  )!
  const request = {
    name: 'Editable Dataset',
    objective: 'Create one grounded record.',
    sourceIds: ['uniprot'],
    outputSchema: { answer: { type: 'string', required: true } },
    quality: {
      criteria: ['The answer must be grounded.'],
      targetCount: 1,
      maxIterations: 1,
      minQualityScore: 0.7,
      minStrongScore: 0.65,
      maxWeakScore: 0.5,
      minScoreGap: 0.2,
      maxDuplicateFraction: 0
    },
    output: {
      datasetName: 'editable-dataset',
      fileName: 'editable-dataset.jsonl',
      format: 'jsonl'
    },
    humanReview: false,
    run: false
  }
  const context = { caller: { workspaceId: '/workspace' } }
  const first = await definition.handler(request, context) as { output: Record<string, unknown> }
  const workflowId = String(first.output.workflowId)
  currentSettings = {
    ...currentSettings,
    enabled: false,
    workflows: currentSettings.workflows.map((workflow) => workflow.id === workflowId
      ? { ...workflow, name: 'User edited workflow' }
      : workflow)
  }

  const second = await definition.handler(request, context) as { output: Record<string, unknown> }

  assert.equal(second.output.created, false)
  assert.equal(currentSettings.enabled, true)
  assert.equal(
    currentSettings.workflows.find((workflow) => workflow.id === workflowId)?.name,
    'User edited workflow'
  )
  assert.equal(currentSettings.presets.length, 0)
})
