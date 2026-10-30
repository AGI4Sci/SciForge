import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  type CapabilityDescriptor
} from '../../shared/capability-broker'
import {
  buildCapabilityEvalPreflightSnapshot,
  CapabilityEvalPreflightError,
  type CapabilityEvalPreflightRequest
} from './preflight'

const request: CapabilityEvalPreflightRequest = {
  expectedCapabilityContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
  referenceActions: [
    { id: 'fixture.alpha', version: '1.0.0' },
    { id: 'fixture.beta', version: '1.0.0' }
  ],
  requiredContributionActionIds: ['fixture.alpha']
}

describe('capability evaluation preflight', () => {
  it('reports a ready snapshot from the actual Agent-visible registry', () => {
    const snapshot = buildCapabilityEvalPreflightSnapshot({
      request,
      descriptors: [
        descriptor('fixture.alpha'),
        descriptor('fixture.beta'),
        descriptor('fixture.ui', '1.0.0', ['ui'])
      ],
      contributions: [contribution(['fixture.alpha'])]
    })

    expect(snapshot.status).toBe('ready')
    expect(snapshot.referenceActionIds).toEqual(['fixture.alpha', 'fixture.beta'])
    expect(snapshot.actualAgentActionIds).toEqual(['fixture.alpha', 'fixture.beta'])
    expect(snapshot.registryFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(snapshot.evaluationActionIds).toEqual(['fixture.alpha'])
  })

  it('keeps registry drift and missing package contributions explicit', () => {
    const snapshot = buildCapabilityEvalPreflightSnapshot({
      request,
      descriptors: [descriptor('fixture.alpha', '2.0.0'), descriptor('fixture.gamma')],
      contributions: [contribution(['fixture.gamma'], [])]
    })

    expect(snapshot.status).toBe('incomplete')
    expect(snapshot.missingActionIds).toEqual(['fixture.beta'])
    expect(snapshot.unexpectedActionIds).toEqual(['fixture.gamma'])
    expect(snapshot.versionMismatches).toEqual([{
      actionId: 'fixture.alpha',
      expected: '1.0.0',
      actual: '2.0.0'
    }])
    expect(snapshot.missingContributionActionIds).toEqual(['fixture.alpha'])
    expect(() => { throw new CapabilityEvalPreflightError(snapshot) })
      .toThrow(snapshot.message)
  })
})

function descriptor(
  id: string,
  version = '1.0.0',
  audiences: CapabilityDescriptor['audiences'] = ['agent']
): CapabilityDescriptor {
  return {
    contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    id,
    version,
    title: id,
    description: `Fixture ${id}`,
    audiences,
    scope: 'workspace',
    resourceKinds: [],
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: {}, additionalProperties: false },
    tags: ['fixture']
  }
}

function contribution(
  actionIds: readonly string[],
  evaluationActionIds: readonly string[] = actionIds
) {
  return {
    contributionId: 'fixture.capability-eval',
    moduleId: 'fixture.capability',
    packageName: '@fixture/capability',
    moduleVersion: '1.0.0',
    contractVersion: 1 as const,
    actionIds,
    evaluationActionIds,
    contract: {
      contractVersion: 1 as const,
      kind: 'capability-evaluation' as const,
      actionSource: 'fixture.registry'
    }
  }
}
