import { describe, expect, it } from 'vitest'

import { idempotencyComparableCommandProjection } from './idempotency.js'

describe('idempotencyComparableCommandProjection', () => {
  it('removes only transport request correlation', () => {
    const command = {
      protocolVersion: '1.0',
      requestId: 'req_FirstRequest0001',
      idempotencyKey: 'idem_project.create.intent-01',
      type: 'project.create',
      displayName: 'Run 0',
      nested: { requestId: 'business-field-is-preserved', value: 1 }
    } as const

    expect(idempotencyComparableCommandProjection(command)).toEqual({
      protocolVersion: '1.0',
      idempotencyKey: 'idem_project.create.intent-01',
      type: 'project.create',
      displayName: 'Run 0',
      nested: { requestId: 'business-field-is-preserved', value: 1 }
    })
    expect(command.requestId).toBe('req_FirstRequest0001')
  })

  it('retains every business field that must participate in conflict detection', () => {
    const first = idempotencyComparableCommandProjection({
      requestId: 'req_FirstRequest0001',
      idempotencyKey: 'idem_project.create.intent-01',
      goal: 'First goal'
    })
    const retry = idempotencyComparableCommandProjection({
      requestId: 'req_SecondRequest001',
      idempotencyKey: 'idem_project.create.intent-01',
      goal: 'First goal'
    })
    const drifted = idempotencyComparableCommandProjection({
      requestId: 'req_ThirdRequest0001',
      idempotencyKey: 'idem_project.create.intent-01',
      goal: 'Different goal'
    })

    expect(retry).toEqual(first)
    expect(drifted).not.toEqual(first)
  })
})
