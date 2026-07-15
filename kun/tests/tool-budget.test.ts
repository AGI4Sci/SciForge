import { describe, expect, it } from 'vitest'
import {
  checkpointSupportsContinuation,
  classifyToolBudgetProfile,
  parseToolBudgetCheckpoint,
  resolveToolBudgetProfile
} from '../src/loop/tool-budget.js'

describe('tool budget helpers', () => {
  it('classifies explicit reviews, implementations, and active goals', () => {
    expect(classifyToolBudgetProfile({ prompt: 'Explain why this fails' })).toBe('explanation')
    expect(classifyToolBudgetProfile({ prompt: '帮我查一下这个行为' })).toBe('explanation')
    expect(classifyToolBudgetProfile({ prompt: 'Implement the fix' })).toBe('implementation')
    expect(classifyToolBudgetProfile({ prompt: 'Use ChEMBL and PDB evidence for molecular target discovery' })).toBe('scientific')
    expect(classifyToolBudgetProfile({ prompt: '检索文献、比较靶点并完成候选分子验证' })).toBe('scientific')
    expect(classifyToolBudgetProfile({ prompt: 'continue', hasActiveGoal: true })).toBe('long')
    expect(classifyToolBudgetProfile({ prompt: 'anything', explicit: 'review' })).toBe('review')
  })

  it('normalizes invalid profile limits without allowing soft above hard', () => {
    expect(resolveToolBudgetProfile({
      profiles: { review: { softLimit: 20, hardLimit: 10, maxAutomaticPhases: 2, totalLimit: 5 } }
    }, 'review')).toEqual({ softLimit: 10, hardLimit: 10, maxAutomaticPhases: 2, totalLimit: 10 })
  })

  it('parses checkpoint JSON and requires a new concrete continuation plan', () => {
    const checkpoint = parseToolBudgetCheckpoint(
      'internal\n{"decision":"continue","summary":"phase one","evidenceDelta":["A verified"],"remaining":["B"],"nextPlan":["Read B"],"stopCondition":["B verified"]}'
    )
    expect(checkpoint).not.toBeNull()
    expect(checkpoint?.evidenceDelta).toEqual(['A verified'])
    expect(checkpoint?.stopCondition).toEqual(['B verified'])
    expect(checkpointSupportsContinuation(checkpoint!, undefined)).toBe(true)
    expect(checkpointSupportsContinuation(checkpoint!, ['read   b'])).toBe(false)
    expect(checkpointSupportsContinuation(checkpoint!, ['READ-B.'])).toBe(false)
    expect(parseToolBudgetCheckpoint('{"decision":"continue","remaining":[],"nextPlan":[]}')).not.toBeNull()
    expect(checkpointSupportsContinuation(
      parseToolBudgetCheckpoint('{"decision":"continue","remaining":[],"nextPlan":[]}')!,
      undefined
    )).toBe(false)
  })
})
