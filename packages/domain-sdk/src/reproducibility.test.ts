import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  canonicalizeReproValue,
  canonicalizeReproSpecForDigest,
  domainExecutionEventSchema,
  sciforgeReproSpecSchema
} from './reproducibility.js'

const digest = `sha256:${'a'.repeat(64)}`

describe('reproducibility contracts', () => {
  it('canonicalizes object keys without reordering arrays', () => {
    assert.equal(
      canonicalizeReproValue({ z: 1, a: [{ y: true, x: false }] }),
      '{"a":[{"x":false,"y":true}],"z":1}'
    )
    assert.equal(
      canonicalizeReproValue({ '2': 2, '10': 10, '\ue000': 1, '😀': 2 }),
      '{"10":10,"2":2,"😀":2,"":1}'
    )
    assert.equal(
      canonicalizeReproValue([1.0, 1e-7, 1e20, -0]),
      '[1,1e-7,100000000000000000000,0]'
    )
    assert.equal(
      canonicalizeReproValue([1e30, 4.5, 0.002, 1e-27, 333333333.3333333, 5e-324]),
      '[1e+30,4.5,0.002,1e-27,333333333.3333333,5e-324]'
    )
    assert.throws(
      () => canonicalizeReproValue({ invalid: '\ud800' }),
      /lone UTF-16 surrogate/
    )
    assert.throws(
      () => canonicalizeReproValue({ invalid: '\udc00' }),
      /lone UTF-16 surrogate/
    )
    assert.throws(
      () => canonicalizeReproValue({ ['\ud800']: 'invalid key' }),
      /lone UTF-16 surrogate/
    )
  })

  it('requires blocking breakpoints to agree with execution readiness', () => {
    const base = {
      schemaVersion: 'sciforge.rerun.v1' as const,
      specId: 'spec-1',
      specDigest: digest,
      source: { snapshotDigest: digest, activityId: 'activity-1' },
      target: { kind: 'activity' as const, id: 'activity-1' },
      executionReady: true,
      reproducibility: 'controlled' as const,
      activities: [{
        id: 'activity-1',
        type: 'analysis_run' as const,
        name: 'analysis',
        executor: {
          kind: 'create-loop' as const,
          workflow: { id: 'workflow-1' },
          workflowDigest: digest,
          target: { kind: 'workflow' as const, id: 'workflow-1' }
        },
        inputs: [],
        code: [],
        environments: [],
        parameterSets: [],
        tools: [],
        approvals: [],
        outputs: [],
        stochastic: false,
        inputFingerprint: digest,
        specFingerprint: digest
      }],
      dependencies: [],
      secretSlots: [],
      breakpoints: [],
      createdAt: '2026-08-05T00:00:00.000Z'
    }
    assert.equal(sciforgeReproSpecSchema.parse(base).executionReady, true)
    assert.equal(
      canonicalizeReproSpecForDigest(base).includes('"specDigest"'),
      false
    )
    const blocking = {
      ...base,
      executionReady: false,
      reproducibility: 'incomplete' as const,
      breakpoints: [{
        code: 'missing-environment',
        component: 'environment',
        message: 'Environment is not pinned.',
        blocking: true
      }]
    }
    assert.equal(sciforgeReproSpecSchema.safeParse(blocking).success, true)
    assert.equal(sciforgeReproSpecSchema.safeParse({
      ...blocking,
      executionReady: true
    }).success, false)

    const stochastic = {
      ...base,
      reproducibility: 'uncontrolled' as const,
      activities: [{ ...base.activities[0]!, stochastic: true }],
      breakpoints: [{
        code: 'unseeded-stochastic-activity',
        component: 'randomness' as const,
        activityId: 'activity-1',
        message: 'The activity has no explicit random seed.',
        blocking: false
      }]
    }
    assert.equal(sciforgeReproSpecSchema.safeParse(stochastic).success, true)
    assert.equal(sciforgeReproSpecSchema.safeParse({
      ...stochastic,
      breakpoints: []
    }).success, false)

    const secondActivity = {
      ...base.activities[0]!,
      id: 'activity-2',
      name: 'follow-up'
    }
    assert.equal(sciforgeReproSpecSchema.safeParse({
      ...base,
      activities: [...base.activities, secondActivity],
      dependencies: [
        { src: 'activity-1', dst: 'activity-2', relation: 'precedes' },
        { src: 'activity-2', dst: 'activity-1', relation: 'precedes' }
      ]
    }).success, false)
  })

  it('validates a package-owned terminal execution event', () => {
    const event = domainExecutionEventSchema.parse({
      schemaVersion: 'sciforge.execution-event.v1',
      eventId: 'event-1',
      phase: 'run_completed',
      producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-1',
      runId: 'run-1',
      occurredAt: '2026-08-05T00:00:00.000Z',
      artifacts: []
    })
    assert.equal(event.phase, 'run_completed')
  })
})
