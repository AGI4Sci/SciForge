import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_IDS,
  scientificComputeRunBaselineResultSchema,
  scientificComputeStatusResultSchema
} from './contract.js'
import { SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID } from './definition.js'
import {
  createDomainMainEntry,
  createScientificComputeCapabilityFactory
} from './main.js'

type CapabilityDefinition = Readonly<{
  id: string
  effect: string
  concurrency: Readonly<{ idempotency: string }>
  handler: (input: unknown) => Promise<Readonly<{ output: unknown }>>
}>

describe('Scientific Compute main contribution', () => {
  test('publishes one governed capability factory through the generated domain contract', () => {
    const entry = createDomainMainEntry({
      getUserDataDir: () => '/tmp/sciforge-scientific-compute-test',
      defineCapability: (options) => options
    } satisfies DomainMainHost)

    assert.equal(entry.definition.module.id, SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID)
    assert.deepEqual(
      entry.contributions.map((contribution) => `${contribution.kind}:${contribution.id}`),
      ['main.capability-factory:scientific-compute.capabilities']
    )
  })

  test('exposes status and a deterministic local baseline without claiming a real scheduler', async () => {
    const factory = createScientificComputeCapabilityFactory<CapabilityDefinition>(
      (options) => options as CapabilityDefinition
    )
    const definitions = factory.createDefinitions()
    const status = definitions.find((definition) => definition.id === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status)
    const run = definitions.find((definition) => definition.id === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline)

    assert.ok(status)
    assert.ok(run)
    assert.equal(status.effect, 'read')
    assert.equal(run.effect, 'compute')
    assert.equal(run.concurrency.idempotency, 'required')

    const statusResult = scientificComputeStatusResultSchema.parse((await status.handler({})).output)
    assert.equal(statusResult.provider, 'local-fixture')
    assert.equal(statusResult.realScheduler, false)

    const first = scientificComputeRunBaselineResultSchema.parse((await run.handler({
      scenario: 'success',
      traceId: 'trace-capability-success',
      jobId: 'job-capability-success'
    })).output)
    const second = scientificComputeRunBaselineResultSchema.parse((await run.handler({
      scenario: 'success',
      traceId: 'trace-capability-success',
      jobId: 'job-capability-success'
    })).output)

    assert.equal(first.validationOk, true)
    assert.equal(first.state, 'finished')
    assert.equal(first.jsonl, second.jsonl)
    const eventTypes = first.jsonl.split('\n').map((line) => (
      JSON.parse(line) as { type: string }
    ).type)
    assert.equal(eventTypes[0], 'TRACE_STARTED')
    assert.equal(eventTypes.at(-1), 'TRACE_COMPLETED')
  })
})
