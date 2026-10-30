import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluationMatrix, deriveCaseMatrixContract, renderMatrixHtml } from './generate-capability-eval-matrix.mjs'

const expected = {
  domain: 'dataset-api',
  requiredActions: ['dataset-api.filter'],
  taskSuccess: true,
  authorization: {},
  invocation: {},
  arguments: {}
}

test('matrix distinguishes declared, inferred, and absent contracts', () => {
  const declared = {
    id: 'routing-case',
    query: 'filter the dataset',
    semanticsVersion: 'semantics-v2',
    taskType: 'routing',
    evaluationDimensions: ['discovery', 'action_selection', 'arguments', 'invocation'],
    expected
  }
  const legacy = {
    id: 'legacy-case',
    query: 'filter the dataset',
    expected
  }
  assert.equal(deriveCaseMatrixContract(declared).tool_execution.source, 'declared')
  assert.equal(deriveCaseMatrixContract(legacy).tool_execution.source, 'inferred')
  assert.equal(deriveCaseMatrixContract(legacy).interaction.source, 'absent')
})

test('matrix deduplicates case IDs while retaining scenario and evidence status', () => {
  const cases = [
    {
      id: 'case-a',
      scenarioId: 'dataset-filter',
      query: 'filter',
      tags: ['dataset'],
      expected
    },
    {
      id: 'case-a',
      scenarioId: 'dataset-filter',
      query: 'filter',
      tags: ['dataset', 'live'],
      evaluationDimensions: ['task_completion'],
      expected
    }
  ]
  const matrix = createEvaluationMatrix(cases, [
    {
      caseId: 'case-a',
      mode: 'live-agent',
      outcome: 'PASS',
      evidenceStatus: 'complete',
      executionStatus: 'completed',
      taskEvidence: true,
      finalStateSource: 'inspector',
      independentStateEvidence: false,
      controlledEvidence: false,
      caseBinding: 'verified'
    }
  ])
  assert.equal(matrix.summary.uniqueCaseCount, 1)
  assert.equal(matrix.summary.scenarioCount, 1)
  assert.deepEqual(matrix.scenarios[0].sourceFiles, [])
  assert.equal(matrix.scenarios[0].dimensions.task_result.status, 'OBSERVED')
  assert.equal(matrix.scenarios[0].dimensions.task_result.independentEvidence, 1)
  assert.equal(matrix.scenarios[0].dimensions.state.status, 'NOT_COVERED')
})

test('simulation-only observations do not become live evidence', () => {
  const matrix = createEvaluationMatrix([{
    id: 'case-sim',
    query: 'list',
    expected,
    expectedFinalState: { assertions: [{ path: 'listed', operator: 'equals', value: true }] }
  }], [{
    caseId: 'case-sim',
    mode: 'deterministic-simulation',
    outcome: 'PASS',
    evidenceStatus: 'complete',
    executionStatus: 'completed',
    taskEvidence: true,
    independentStateEvidence: false,
    controlledEvidence: false
  }])
  const row = matrix.scenarios[0]
  assert.equal(row.dimensions.tool_execution.status, 'SIMULATION_ONLY')
  assert.equal(row.dimensions.tool_execution.liveObserved, 0)
  assert.equal(row.dimensions.state.independentEvidence, 0)
})

test('dimension outcome columns use dimension results instead of case outcome', () => {
  const matrix = createEvaluationMatrix([{
    id: 'case-dimension-results',
    query: 'filter',
    semanticsVersion: 'semantics-v2',
    taskType: 'end_to_end',
    evaluationDimensions: ['action_selection', 'task_completion'],
    expected: { ...expected, taskSuccess: true }
  }], [{
    caseId: 'case-dimension-results',
    mode: 'live-agent',
    outcome: 'PASS',
    executionStatus: 'completed',
    dimensionOutcomes: { action_selection: 'FAIL', task_completion: 'PASS' },
    runtimeOutcome: 'PASS',
    caseBinding: 'verified',
    taskEvidence: true,
    independentStateEvidence: false,
    controlledEvidence: false
  }])
  const row = matrix.scenarios[0]
  assert.deepEqual(row.dimensions.tool_execution.outcomes, { PASS: 0, FAIL: 1, INCONCLUSIVE: 0 })
  assert.deepEqual(row.dimensions.task_result.outcomes, { PASS: 1, FAIL: 0, INCONCLUSIVE: 0 })
  assert.equal(row.dimensions.tool_execution.outcomeSource, 'dimension-result')
})

test('catalog-only scenarios remain visible without executable cases', () => {
  const matrix = createEvaluationMatrix([], [], [{
    scenarioId: 'catalog-only',
    domain: 'dataset-api',
    taskType: 'end_to_end',
    userGoal: 'planned workflow',
    requiredDimensions: ['runtime', 'tool_execution', 'task_result'],
    caseIds: [],
    status: 'planned'
  }])
  const row = matrix.scenarios[0]
  assert.equal(matrix.summary.catalogScenarioCount, 1)
  assert.equal(matrix.summary.uncoveredCatalogScenarios, 1)
  assert.equal(row.readiness, 'catalog_only')
  assert.equal(row.dimensions.tool_execution.status, 'NOT_RUN')
  assert.match(renderMatrixHtml(matrix), /catalog-only/)
})
