import { describe, expect, it } from 'vitest'

import { canonicalTaskIdForPlanItem } from './index.js'
import { canonicalTaskIdForPlanItem as canonicalNodeTaskIdForPlanItem } from './node.js'

describe('canonical Node collaboration identities', () => {
  it('preserves the server Plan-item Task ID vector', () => {
    const taskId = canonicalTaskIdForPlanItem(
      'pln_PlanIdentity001',
      'item_analysis01'
    )
    expect(taskId).toBe('tsk_769cd7d0fed688b5a5b54f2c0f03b4c3')
    expect(canonicalNodeTaskIdForPlanItem(
      'pln_PlanIdentity001',
      'item_analysis01'
    )).toBe(taskId)
  })

  it('rejects malformed Plan and item identities before hashing', () => {
    expect(() => canonicalTaskIdForPlanItem('bad-plan', 'item_analysis01')).toThrow()
    expect(() => canonicalTaskIdForPlanItem('pln_PlanIdentity001', 'bad-item')).toThrow()
  })
})
