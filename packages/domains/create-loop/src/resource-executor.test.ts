import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import {
  CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION,
  collectCreateLoopResourceExecutors
} from './resource-executor.js'

test('collects provider-owned resource executors from the generic main extension host', () => {
  const executor = Object.freeze({
    id: 'fixture-provider',
    execute: async () => ({ result: { ok: true } })
  })
  const host = contributionHost([contribution('fixture.executor', 'fixture-provider', executor)])

  assert.deepEqual(collectCreateLoopResourceExecutors(host), [executor])
})

test('rejects mismatched and duplicate provider executors', () => {
  const executor = Object.freeze({
    id: 'fixture-provider',
    execute: async () => ({ result: { ok: true } })
  })
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([{
      ...contribution('fixture.invalid', 'fixture-provider', executor),
      contract: {
        location: CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION,
        providerId: 'fixture-provider',
        unexpected: true
      }
    }])),
    /has an invalid contract/
  )
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([
      contribution('fixture.mismatch', 'other-provider', executor)
    ])),
    /does not match provider/
  )
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([
      contribution('fixture.first', 'fixture-provider', executor),
      contribution('fixture.second', 'fixture-provider', executor)
    ])),
    /is duplicated/
  )
})

function contribution(
  id: string,
  providerId: string,
  value: unknown
): DomainMainContribution {
  return {
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/provider',
    owner: { moduleId: 'fixture.provider', moduleVersion: '1.0.0' },
    contract: { location: CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION, providerId },
    value
  }
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return {
    list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  }
}
