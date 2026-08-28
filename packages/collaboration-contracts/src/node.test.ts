import { describe, expect, it } from 'vitest'

import { canonicalTaskIdForPlanItem } from './node.js'

describe('canonical Node collaboration identities', () => {
  it('preserves the server Plan-item Task ID vector', () => {
    expect(canonicalTaskIdForPlanItem(
      'pln_PlanIdentity001',
      'item_analysis01'
    )).toBe('tsk_769cd7d0fed688b5a5b54f2c0f03b4c3')
  })

  it('rejects malformed Plan and item identities before hashing', () => {
    expect(() => canonicalTaskIdForPlanItem('bad-plan', 'item_analysis01')).toThrow()
    expect(() => canonicalTaskIdForPlanItem('pln_PlanIdentity001', 'bad-item')).toThrow()
  })
})
