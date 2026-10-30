import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { SciForgeReproSpecV1 } from '@sciforge/domain-sdk/reproducibility'
import {
  CREATE_LOOP_CAPABILITY_IDS
} from '../contract.js'
import { createCreateLoopCapabilityClient } from './capability-client.js'
import { createCreateLoopRuntimeBridge } from './runtime-bridge.js'
import {
  rerunSpecFileName,
  rerunWorkflowRun
} from './workflow/WorkflowRunHistory.js'
import { loadWorkflowViewState } from './workflow/WorkflowView.js'
import { defaultWorkflowSettings } from '../workflow-settings.js'

test('Create Loop still loads workflows when the live runtime status is temporarily invalid', async () => {
  const settings = {
    workspaceRoot: '/workspace',
    workflow: defaultWorkflowSettings()
  }

  const loaded = await loadWorkflowViewState({
    getSettings: async () => settings,
    getWorkflowStatus: async () => { throw new Error('invalid legacy runtime status') }
  })

  assert.equal(loaded.settings, settings)
  assert.equal(loaded.status, null)
})

test('run history export uses the canonical exportRerun capability and a stable JSON filename', async () => {
  const calls: Array<{ actionId: string; input: unknown; workspaceId?: string }> = []
  const invoker = {
    observe: async () => { throw new Error('not used') },
    invoke: async (contract: { actionId: string }, input: unknown, options?: { workspaceId?: string }) => {
      calls.push({ actionId: contract.actionId, input, workspaceId: options?.workspaceId })
      return {} as never
    }
  } as DomainRendererCapabilityInvoker
  const client = createCreateLoopCapabilityClient(invoker)

  await client.exportRerun('/workspace', 'workflow/one', 'run:1')

  assert.deepEqual(calls, [{
    actionId: CREATE_LOOP_CAPABILITY_IDS.exportRerun,
    input: { workflowId: 'workflow/one', runId: 'run:1' },
    workspaceId: '/workspace'
  }])
  assert.equal(
    rerunSpecFileName('workflow/one', 'run:1'),
    'workflow_one-run_1.sciforge-rerun.json'
  )
})

test('renderer bridge forwards a canonical spec through client.rerun with fresh confirmation', async () => {
  const calls: Array<{
    actionId: string
    input: unknown
    workspaceId?: string
    approvalMode?: string
  }> = []
  const invoker = {
    observe: async () => { throw new Error('not used') },
    invoke: async (
      contract: { actionId: string },
      input: unknown,
      options?: { workspaceId?: string; approval?: { mode?: string } }
    ) => {
      calls.push({
        actionId: contract.actionId,
        input,
        workspaceId: options?.workspaceId,
        ...(options?.approval?.mode ? { approvalMode: options.approval.mode } : {})
      })
      return {} as never
    }
  } as DomainRendererCapabilityInvoker
  const bridge = createCreateLoopRuntimeBridge(
    createCreateLoopCapabilityClient(invoker),
    '/workspace',
    []
  )
  const spec = { schemaVersion: 'sciforge.rerun.v1', specId: 'spec-1' } as SciForgeReproSpecV1

  await bridge.rerunWorkflow(spec, 'activity-1')

  assert.deepEqual(calls, [{
    actionId: CREATE_LOOP_CAPABILITY_IDS.run,
    input: { rerunSpec: spec, activityId: 'activity-1' },
    workspaceId: '/workspace',
    approvalMode: 'confirmation'
  }])
})

test('run history exports before rerunning and closes only after rerun succeeds', async () => {
  const events: string[] = []
  const spec = { schemaVersion: 'sciforge.rerun.v1', specId: 'spec-1' } as SciForgeReproSpecV1
  const result = { ok: true, message: 'started' } as Awaited<
    ReturnType<ReturnType<typeof createCreateLoopRuntimeBridge>['rerunWorkflow']>
  >
  let receivedSpec: SciForgeReproSpecV1 | null = null
  let finishRerun!: (value: typeof result) => void
  let rerunInvoked!: () => void
  const rerunWasInvoked = new Promise<void>((resolve) => { rerunInvoked = resolve })
  const rerunResult = new Promise<typeof result>((resolve) => { finishRerun = resolve })

  const pending = rerunWorkflowRun({
    exportWorkflowRerun: async (workflowId, runId) => {
      events.push(`export:${workflowId}:${runId}`)
      return spec
    },
    rerunWorkflow: async (value) => {
      events.push('rerun')
      receivedSpec = value
      rerunInvoked()
      return rerunResult
    }
  }, 'workflow-1', 'run-1', () => events.push('close'))

  await rerunWasInvoked
  assert.deepEqual(events, ['export:workflow-1:run-1', 'rerun'])
  finishRerun(result)
  const observed = await pending

  assert.equal(receivedSpec, spec)
  assert.equal(observed, result)
  assert.deepEqual(events, ['export:workflow-1:run-1', 'rerun', 'close'])
})

test('run history keeps the dialog open when canonical spec export fails', async () => {
  let rerunCalled = false
  let closeCalled = false
  await assert.rejects(
    rerunWorkflowRun({
      exportWorkflowRerun: async () => { throw new Error('canonical export failed') },
      rerunWorkflow: async () => {
        rerunCalled = true
        return { ok: true } as never
      }
    }, 'workflow-1', 'run-1', () => { closeCalled = true }),
    /canonical export failed/u
  )
  assert.equal(rerunCalled, false)
  assert.equal(closeCalled, false)
})

test('run history keeps the dialog open when the awaited rerun is rejected', async () => {
  let closeCalled = false
  const result = await rerunWorkflowRun({
    exportWorkflowRerun: async () => (
      { schemaVersion: 'sciforge.rerun.v1', specId: 'spec-1' } as SciForgeReproSpecV1
    ),
    rerunWorkflow: async () => ({ ok: false, message: 'source trust failed' })
  }, 'workflow-1', 'run-1', () => { closeCalled = true })

  assert.equal(result.ok, false)
  assert.equal(closeCalled, false)
})
