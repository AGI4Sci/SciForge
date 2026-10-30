import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION,
  SCIENTIFIC_COMPUTE_BASELINE_BLOCKED_EVAL_CASE_ID,
  SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID,
  SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID
} from './capability-eval.js'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_IDS,
  scientificComputeRunBaselineResultSchema
} from './contract.js'
import { createScientificComputeCapabilityFactory } from './main.js'

type CapabilityDefinition = Readonly<{
  id: string
  handler: (input: unknown) => Promise<Readonly<{ output: unknown }>>
}>

describe('Scientific Compute capability evaluation contribution', () => {
  test('independently validates status and successful baseline output', async () => {
    const definitions = createScientificComputeCapabilityFactory<CapabilityDefinition>(
      (options) => options as CapabilityDefinition
    ).createDefinitions()
    const status = definitions.find(({ id }) => id === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status)!
    const baseline = definitions.find(({ id }) => id === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline)!

    const statusOutput = (await status.handler({})).output
    const statusResult = await SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context: {
        caseId: SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID,
        runId: 'run-status',
        workspaceDirectory: '/tmp/sciforge-scientific-compute-eval'
      },
      invocations: [{
        actionId: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status,
        args: {},
        success: true,
        output: statusOutput as never
      }]
    })
    assert.equal(statusResult?.taskSuccess, true)
    assert.deepEqual(statusResult?.verifiedActions, [SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status])

    const baselineOutput = (await baseline.handler({
      scenario: 'success',
      traceId: 'trace-eval-success',
      jobId: 'job-eval-success'
    })).output
    const baselineResult = scientificComputeRunBaselineResultSchema.parse(baselineOutput)
    const inspected = await SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context: {
        caseId: SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID,
        runId: 'run-baseline',
        workspaceDirectory: '/tmp/sciforge-scientific-compute-eval'
      },
      invocations: [{
        actionId: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline,
        args: { scenario: 'success' },
        success: true,
        output: baselineOutput as never
      }]
    })
    assert.equal(baselineResult.validationOk, true)
    assert.equal(inspected?.taskSuccess, true)
    assert.deepEqual(inspected?.verifiedActions, [SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline])
  })

  test('retains blocked scenario as a successful boundary result', async () => {
    const definitions = createScientificComputeCapabilityFactory<CapabilityDefinition>(
      (options) => options as CapabilityDefinition
    ).createDefinitions()
    const baseline = definitions.find(({ id }) => id === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline)!
    const output = (await baseline.handler({ scenario: 'blocked' })).output
    const result = await SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context: {
        caseId: SCIENTIFIC_COMPUTE_BASELINE_BLOCKED_EVAL_CASE_ID,
        runId: 'run-blocked',
        workspaceDirectory: '/tmp/sciforge-scientific-compute-eval'
      },
      invocations: [{
        actionId: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline,
        args: { scenario: 'blocked' },
        success: true,
        output: output as never
      }]
    })
    assert.equal(result?.taskSuccess, true)
    const finalState = result?.finalState
    assert.equal(isRecord(finalState) ? finalState.state : undefined, 'blocked')
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
