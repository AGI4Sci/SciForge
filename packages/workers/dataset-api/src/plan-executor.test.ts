import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { datasetPreparePlanInputSchema } from './contract.js'
import { createDatasetPlanExecutor } from './plan-executor.js'
import { createDatasetProcessingService } from './processing.js'
import { createDatasetApiService } from './service.js'

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-executor-'))
  let fetchCount = 0
  const api = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => {
      fetchCount += 1
      return new Response(JSON.stringify([
        { accession: 'P04637', reviewed: true },
        { accession: 'Q9TEST', reviewed: false }
      ]), { headers: { 'content-type': 'application/json' } })
    }
  })
  const processing = createDatasetProcessingService({ workspaceRoot })
  await api.register({
    id: 'fixture',
    baseUrl: 'https://example.com/',
    metadataEndpoint: 'metadata',
    rawDataEndpoint: 'records'
  })
  return {
    workspaceRoot,
    api,
    processing,
    fetchCount: () => fetchCount,
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true })
  }
}

async function confirmedPipeline(
  processing: ReturnType<typeof createDatasetProcessingService>,
  publish = true
) {
  const operations: Array<{ tool: 'dataset_api_raw_data' | 'dataset_filter' | 'dataset_validate' | 'dataset_publish'; description: string; parameters: Record<string, unknown> }> = [
    {
      tool: 'dataset_api_raw_data',
      description: 'Download fixture records.',
      parameters: { sourceId: 'fixture', outputFileName: 'raw.json', expectedFormat: 'json', overwrite: true }
    },
    {
      tool: 'dataset_filter',
      description: 'Keep reviewed records.',
      parameters: {
        inputArtifact: 'raw.json',
        conditions: [{ field: 'reviewed', operator: 'equals', value: true }],
        outputFileName: 'reviewed.json'
      }
    },
    {
      tool: 'dataset_validate',
      description: 'Validate reviewed records.',
      parameters: {
        inputArtifact: 'reviewed.json',
        minRecords: 1,
        rules: [{ field: 'accession', required: true }],
        failOnInvalid: true,
        outputFileName: 'reviewed.validation.json'
      }
    }
  ]
  if (publish) operations.push({
    tool: 'dataset_publish',
    description: 'Publish reviewed records.',
    parameters: { name: 'reviewed-fixture', artifacts: ['reviewed.json', 'reviewed.validation.json'] }
  })
  const prepared = await processing.preparePlan({
    objective: 'Create a reviewed fixture dataset.',
    operations,
    outputs: [{ name: 'reviewed.json', format: 'json' }],
    confirmedByUser: true
  })
  return prepared.plan.planId
}

test('executes a confirmed plan end-to-end and resolves logical artifact names', async () => {
  const context = await fixture()
  try {
    const planId = await confirmedPipeline(context.processing)
    const executor = createDatasetPlanExecutor(context.api, context.processing)
    const result = await executor.execute({ planId })
    assert.equal(result.execution.status, 'succeeded', JSON.stringify(result.execution.steps, null, 2))
    assert.equal(result.execution.completedSteps, 4)
    assert.equal(context.fetchCount(), 1)
    assert.match(result.execution.steps[1].artifacts[0].path, /reviewed\.json$/)
    const checkpoint = JSON.parse(await readFile(result.artifact.path, 'utf8'))
    assert.equal(checkpoint.status, 'succeeded')
    assert.equal(checkpoint.steps[1].resolvedParameters.inputArtifact.endsWith('/raw.json'), true)
    assert.equal(checkpoint.steps[3].resolvedParameters.artifacts[0].endsWith('-reviewed.json'), true)
    const reused = await executor.execute({ planId })
    assert.equal(reused.execution.reused, true)
    assert.equal(context.fetchCount(), 1)
  } finally {
    await context.cleanup()
  }
})

test('persists a failed middle step and resumes without rerunning completed access', async () => {
  const context = await fixture()
  let failFilter = true
  const processing = new Proxy(context.processing, {
    get(target, property, receiver) {
      if (property !== 'filter') return Reflect.get(target, property, receiver)
      return async (input: never) => {
        if (failFilter) {
          failFilter = false
          throw new Error('simulated transient processing failure')
        }
        return target.filter(input)
      }
    }
  })
  try {
    const planId = await confirmedPipeline(context.processing, false)
    const executor = createDatasetPlanExecutor(context.api, processing)
    const failed = await executor.execute({ planId })
    assert.equal(failed.execution.status, 'failed')
    assert.equal(failed.execution.currentStepIndex, 1)
    assert.equal(failed.execution.steps[0].attempts, 1)
    assert.equal(context.fetchCount(), 1)
    const resumed = await executor.resume({ planId, runId: failed.execution.runId })
    assert.equal(resumed.execution.status, 'succeeded', JSON.stringify(resumed.execution.steps, null, 2))
    assert.equal(resumed.execution.steps[0].attempts, 1)
    assert.equal(resumed.execution.steps[1].attempts, 2)
    assert.equal(context.fetchCount(), 1)
  } finally {
    await context.cleanup()
  }
})

test('requires exact declared parameters and rejects unrelated resume checkpoints', async () => {
  const context = await fixture()
  try {
    const incomplete = await context.processing.preparePlan({
      objective: 'Incomplete automatic plan.',
      operations: [{ tool: 'dataset_profile', description: 'Missing exact parameters.' }],
      outputs: [{ name: 'profile.json', format: 'json' }],
      confirmedByUser: true
    })
    const executor = createDatasetPlanExecutor(context.api, context.processing)
    await assert.rejects(
      executor.execute({ planId: incomplete.plan.planId }),
      /must declare exact parameters/
    )
    await assert.rejects(
      executor.resume({ planId: incomplete.plan.planId, runId: 'run-0000000000000000' }),
      /does not belong/
    )
  } finally {
    await context.cleanup()
  }
})

test('rolls back to the earliest checksum-invalid step before resuming', async () => {
  const context = await fixture()
  try {
    const planId = await confirmedPipeline(context.processing, false)
    const executor = createDatasetPlanExecutor(context.api, context.processing)
    const completed = await executor.execute({ planId })
    assert.equal(completed.execution.status, 'succeeded')
    await writeFile(completed.execution.steps[0].artifacts[0].path, 'corrupt')
    const repaired = await executor.resume({ planId, runId: completed.execution.runId })
    assert.equal(repaired.execution.status, 'succeeded', JSON.stringify(repaired.execution.steps, null, 2))
    assert.equal(repaired.execution.steps[0].attempts, 2)
    assert.equal(repaired.execution.steps[1].attempts, 2)
    assert.equal(context.fetchCount(), 2)
  } finally {
    await context.cleanup()
  }
})

test('rejects a plan file changed after user confirmation', async () => {
  const context = await fixture()
  try {
    const planId = await confirmedPipeline(context.processing, false)
    const executor = createDatasetPlanExecutor(context.api, context.processing)
    const completed = await executor.execute({ planId })
    const checkpoint = JSON.parse(await readFile(completed.artifact.path, 'utf8'))
    const plan = JSON.parse(await readFile(checkpoint.planPath, 'utf8'))
    await writeFile(checkpoint.planPath, `${JSON.stringify({ ...plan, objective: 'mutated after confirmation' }, null, 2)}\n`)
    await assert.rejects(
      executor.resume({ planId, runId: completed.execution.runId }),
      /confirmed draft has changed/
    )
  } finally {
    await context.cleanup()
  }
})

test('keeps reviewable automatic-execution templates aligned with the plan contract', async () => {
  for (const name of ['ensembl-access-plan.json', 'multi-source-synthesis-plan.json']) {
    const template = JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'))
    const parsed = datasetPreparePlanInputSchema.parse(template)
    assert.equal(parsed.confirmedByUser, false)
    assert.ok(parsed.operations?.every((operation) => operation.parameters && Object.keys(operation.parameters).length > 0))
  }
})
