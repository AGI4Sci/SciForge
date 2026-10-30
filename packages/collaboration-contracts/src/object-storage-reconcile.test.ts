import { describe, expect, it } from 'vitest'

import { restRequestSchema } from './protocol.js'
import { TEST_IDS } from './testing.js'

const command = {
  protocolVersion: '1.0',
  type: 'object.storage.reconcile',
  requestId: TEST_IDS.requestId,
  idempotencyKey: 'idem_object_reconcile_scope',
  projectId: TEST_IDS.projectId,
  dryRun: false
}

describe('object reconciliation public command', () => {
  it('requires an explicit Project and leaves retention time to the server', () => {
    expect(restRequestSchema.parse(command)).toEqual(command)
  })

  it.each([
    { ...command, projectId: undefined },
    { ...command, projectId: null },
    { ...command, projectId: '' },
    { ...command, now: '2099-01-01T00:00:00.000Z' }
  ])('rejects an unscoped command or caller-supplied clock: %j', (input) => {
    expect(restRequestSchema.safeParse(input).success).toBe(false)
  })
})
