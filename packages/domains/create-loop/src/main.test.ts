import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { CREATE_LOOP_CAPABILITY_IDS } from './contract.js'
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
    createCreateLoopRuntime: ({ statePath }) => {
      calls.push(`create:${statePath}`)
      return runtime
    }
  })
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: DomainMainRuntimeLifecycleContext): Promise<unknown>
  }
  const deactivate = await lifecycle.activate({
    userDataDir: '/user-data'
  } as DomainMainRuntimeLifecycleContext) as () => Promise<void>
  assert.deepEqual(calls, [
    'create:/user-data/domains/create-loop/state.json',
    'activate'
  ])
  await deactivate()
  await entry.contributions[1]!.onDispose?.()
  assert.deepEqual(calls, [
    'create:/user-data/domains/create-loop/state.json',
    'activate',
    'deactivate'
  ])
})
