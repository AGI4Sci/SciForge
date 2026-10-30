import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectWorkspaceFinalState } from './final-state-inspector'
import { evalCaseSchema } from './schema'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace final-state inspector', () => {
  it('verifies a real artifact and explicit JSON-field data lineage', async () => {
    const directory = await mkdtemp('/tmp/sciforge-final-state-test-')
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'source.json'), JSON.stringify({ artifactId: 'source-1' }))
    await writeFile(join(directory, 'result.json'), JSON.stringify({ sourceId: 'source-1' }))

    const evalCase = evalCaseSchema.parse({
      id: 'final-state-positive',
      query: 'verify output',
      expected: { requiredActions: [], allowedActions: [] },
      expectedFinalState: {
        assertions: [],
        artifacts: [{ path: 'result.json', format: 'json', minBytes: 1 }],
        dataLineage: [{
          sourcePath: 'source.json',
          targetPath: 'result.json',
          sourceJsonPath: 'artifactId',
          targetJsonPath: 'sourceId'
        }]
      }
    })

    const result = await inspectWorkspaceFinalState(evalCase, directory)

    expect(result.taskSuccess).toBe(true)
    expect(result.finalState).toMatchObject({
      artifacts: { 'result.json': { exists: true, formatValid: true } },
      dataLineage: { 'source.json → result.json': { status: 'verified' } }
    })
    expect(result.unsupported).toEqual([])
  })

  it('fails the task when the declared artifact or lineage is wrong', async () => {
    const directory = await mkdtemp('/tmp/sciforge-final-state-test-')
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'source.json'), JSON.stringify({ artifactId: 'source-1' }))
    await writeFile(join(directory, 'result.json'), JSON.stringify({ sourceId: 'other-source' }))

    const evalCase = evalCaseSchema.parse({
      id: 'final-state-negative',
      query: 'verify output',
      expected: { requiredActions: [], allowedActions: [] },
      expectedFinalState: {
        assertions: [],
        artifacts: [{ path: 'missing.json', format: 'json' }],
        dataLineage: [{
          sourcePath: 'source.json',
          targetPath: 'result.json',
          sourceJsonPath: 'artifactId',
          targetJsonPath: 'sourceId'
        }]
      }
    })

    const result = await inspectWorkspaceFinalState(evalCase, directory)

    expect(result.taskSuccess).toBe(false)
    expect(result.evidence.join('\n')).toContain('missing')
    expect(result.evidence.join('\n')).toContain('mismatch')
  })

  it('resolves dynamic artifact paths and explicit output lineage from observed Action output', async () => {
    const directory = await mkdtemp('/tmp/sciforge-final-state-test-')
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'filtered.json'), '{"rows":[{"id":"p1"}]}\n')

    const evalCase = evalCaseSchema.parse({
      id: 'final-state-output-locator',
      query: 'verify dynamic output',
      expected: { requiredActions: [], allowedActions: [] },
      expectedFinalState: {
        assertions: [],
        artifacts: [{
          pathFromOutput: { actionId: 'dataset-api.filter', jsonPath: 'datasetApi.result.artifact.path' },
          format: 'json',
          minBytes: 1
        }],
        dataLineage: [{
          sourceFromOutput: { actionId: 'dataset-api.filter', jsonPath: 'datasetApi.result.artifact.path' },
          targetFromOutput: { actionId: 'dataset-api.validate', jsonPath: 'datasetApi.result.artifact.parents.0.path' }
        }]
      }
    })

    const result = await inspectWorkspaceFinalState(evalCase, directory, {}, {
      invocations: [
        {
          actionId: 'dataset-api.filter',
          args: {},
          output: { datasetApi: { actionId: 'dataset-api.filter', success: true, result: { artifact: { path: 'filtered.json' } } } },
          success: true,
          retryCount: 0,
          latencyMs: 1
        },
        {
          actionId: 'dataset-api.validate',
          args: {},
          output: { datasetApi: { actionId: 'dataset-api.validate', success: true, result: { artifact: { parents: [{ path: 'filtered.json' }] } } } },
          success: true,
          retryCount: 0,
          latencyMs: 1
        }
      ]
    })

    expect(result.taskSuccess).toBe(true)
    expect(result.finalState).toMatchObject({
      artifacts: { 'dataset-api.filter.datasetApi.result.artifact.path': { exists: true, formatValid: true } },
      dataLineage: { 'dataset-api.filter.datasetApi.result.artifact.path → dataset-api.validate.datasetApi.result.artifact.parents.0.path': { status: 'verified' } }
    })
  })

  it('does not guess lineage without explicit field mappings', async () => {
    const directory = await mkdtemp('/tmp/sciforge-final-state-test-')
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'source.json'), '{}')
    await writeFile(join(directory, 'result.json'), '{}')

    const evalCase = evalCaseSchema.parse({
      id: 'final-state-unsupported',
      query: 'verify lineage',
      expected: {
        requiredActions: [],
        allowedActions: []
      },
      expectedFinalState: {
        assertions: [],
        dataLineage: [{ sourcePath: 'source.json', targetPath: 'result.json' }]
      }
    })

    const result = await inspectWorkspaceFinalState(evalCase, directory)

    expect(result.taskSuccess).toBeUndefined()
    expect(result.unsupported).toHaveLength(1)
  })

  it('marks dynamic lineage without observed output as unsupported', async () => {
    const directory = await mkdtemp('/tmp/sciforge-final-state-test-')
    temporaryDirectories.push(directory)

    const evalCase = evalCaseSchema.parse({
      id: 'final-state-dynamic-lineage-unsupported',
      query: 'verify lineage',
      expected: { requiredActions: [], allowedActions: [] },
      expectedFinalState: {
        assertions: [],
        dataLineage: [{
          sourceFromOutput: { actionId: 'dataset-api.filter', jsonPath: 'datasetApi.result.artifact.path' },
          targetFromOutput: { actionId: 'dataset-api.validate', jsonPath: 'datasetApi.result.artifact.parents.0.path' }
        }]
      }
    })

    const result = await inspectWorkspaceFinalState(evalCase, directory, {}, { invocations: [] })

    expect(result.taskSuccess).toBeUndefined()
    expect(result.finalState).toMatchObject({
      dataLineage: { 'dataset-api.filter.datasetApi.result.artifact.path → dataset-api.validate.datasetApi.result.artifact.parents.0.path': { status: 'unsupported' } }
    })
    expect(result.unsupported).toHaveLength(1)
  })
})
