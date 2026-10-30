import { describe, expect, it } from 'vitest'

import { canonicalTaskIdForPlanItem, canonicalTaskIdForRequirementsModule } from './index.js'
import {
  canonicalTaskIdForPlanItem as canonicalNodeTaskIdForPlanItem,
  canonicalTaskIdForRequirementsModule as canonicalNodeTaskIdForRequirementsItem
} from './node.js'

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

  it('derives the requirements-lineage Task ID independently of the Plan lineage', () => {
    const taskId = canonicalTaskIdForRequirementsModule(
      'rqd_RequirementsIdentity001',
      'item_analysis01'
    )
    expect(taskId).toBe('tsk_cf4d1c33532221e5a076e2be94b58362')
    expect(canonicalNodeTaskIdForRequirementsItem(
      'rqd_RequirementsIdentity001',
      'item_analysis01'
    )).toBe(taskId)
    expect(taskId).not.toBe(canonicalTaskIdForPlanItem('pln_PlanIdentity001', 'item_analysis01'))
    expect(() => canonicalTaskIdForRequirementsModule('pln_PlanIdentity001', 'item_analysis01')).toThrow()
    expect(() => canonicalTaskIdForRequirementsModule('rqd_RequirementsIdentity001', 'bad-item')).toThrow()
  })
})
