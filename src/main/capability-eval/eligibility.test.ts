import { describe, expect, it } from 'vitest'
import { createCapabilityEvalEligibilityManifest } from './eligibility'
import { evalCaseSchema } from './schema'

describe('capability eval eligibility', () => {
  it('retains missing oracle and context reasons even when another dataset issue exists', () => {
    const evalCase = evalCaseSchema.parse({
      id: 'context-gap',
      query: '读取当前研究状态。',
      split: 'holdout',
      scenarioId: 'context-gap',
      contextContract: {
        mode: 'workspace',
        visibleInputs: ['query', 'workspace-state'],
        requiredTurns: 1,
        missingContextBehavior: 'blocked'
      },
      expected: {
        domain: 'evidence-dag',
        requiredActions: ['evidence-dag.view'],
        expectedActions: ['evidence-dag.view'],
        allowedActions: ['evidence-dag.view']
      }
    })

    const manifest = createCapabilityEvalEligibilityManifest([evalCase], {
      datasetPath: 'inline.jsonl',
      datasetSha256: 'sha256',
      selectedCaseIds: [evalCase.id]
    })

    expect(manifest.cases[0]?.status).toBe('dataset_issue')
    expect(manifest.cases[0]?.reasons.map((reason) => reason.code)).toEqual([
      'not_development_split',
      'missing_live_oracle_source',
      'missing_context_source'
    ])
  })
})
