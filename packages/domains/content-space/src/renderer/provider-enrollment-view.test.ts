import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import type {
  DomainRendererContribution,
  DomainRendererContributionHost
} from '@sciforge/domain-sdk/host'

import {
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
  collectContentSpaceProviderEnrollmentViews,
  contentSpaceProviderAccessStateSchema,
  type ContentSpaceProviderEnrollmentView
} from './provider-enrollment-view.js'

describe('Content Space Provider enrollment renderer extension', () => {
  it('collects one exactly matching view per Provider Kind', () => {
    const view = enrollmentView('fixture-content-space')

    expect(collectContentSpaceProviderEnrollmentViews(host([
      contribution('fixture.enrollment', 'fixture-content-space', view)
    ]))).toEqual([view])
  })

  it('fails closed for malformed contracts, runtime values, or contract/value mismatch', () => {
    const malformedRuntime = {
      ...enrollmentView('malformed-content-space'),
      vendorPrivateMode: true
    }

    expect(() => collectContentSpaceProviderEnrollmentViews(host([
      {
        ...contribution(
          'malformed-contract.enrollment',
          'malformed-contract-content-space',
          enrollmentView('malformed-contract-content-space')
        ),
        contract: {
          location: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
          contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
          providerKind: 'malformed-contract-content-space',
          endpoint: 'must-not-enter-content-space'
        }
      }
    ]))).toThrow(/invalid contract/u)
    expect(() => collectContentSpaceProviderEnrollmentViews(host([
      contribution(
        'malformed-runtime.enrollment',
        'malformed-content-space',
        malformedRuntime
      )
    ]))).toThrow(/does not match/u)
    expect(() => collectContentSpaceProviderEnrollmentViews(host([
      contribution(
        'mismatch.enrollment',
        'declared-content-space',
        enrollmentView('different-content-space')
      )
    ]))).toThrow(/does not match/u)
  })

  it('rejects duplicate Provider Kind ownership instead of choosing by installation order', () => {
    expect(() => collectContentSpaceProviderEnrollmentViews(host([
      contribution('duplicate-a.enrollment', 'duplicate-content-space',
        enrollmentView('duplicate-content-space')),
      contribution('unique.enrollment', 'unique-content-space',
        enrollmentView('unique-content-space')),
      contribution('duplicate-b.enrollment', 'duplicate-content-space',
        enrollmentView('duplicate-content-space'))
    ]))).toThrow(/duplicated/u)
  })

  it('accepts only the four generic access states and no Provider-private detail', () => {
    for (const status of [
      'checking',
      'ready',
      'human_action_required',
      'unavailable'
    ] as const) {
      expect(contentSpaceProviderAccessStateSchema.parse({ status })).toEqual({ status })
    }
    expect(() => contentSpaceProviderAccessStateSchema.parse({
      status: 'connected',
      accountToken: 'secret'
    })).toThrow()
    expect(() => contentSpaceProviderAccessStateSchema.parse({
      status: 'ready',
      accountToken: 'secret'
    })).toThrow()
  })

  it('round-trips one opaque renderer-only view state without opening Provider fields', () => {
    const viewState = Object.freeze({
      providerOwnedPhase: 'resolved',
      safeAccountSummary: Object.freeze({ account: 'scientist' })
    })

    const parsed = contentSpaceProviderAccessStateSchema.parse({
      status: 'ready',
      viewState
    })

    expect(parsed).toEqual({ status: 'ready', viewState })
    expect(parsed.viewState).toBe(viewState)
    expect(() => contentSpaceProviderAccessStateSchema.parse({
      status: 'ready',
      viewState,
      providerOwnedPhase: 'resolved'
    })).toThrow()
  })
})

function enrollmentView(providerKind: string): ContentSpaceProviderEnrollmentView {
  return Object.freeze({
    contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
    providerKind,
    readAccessState: async () => Object.freeze({ status: 'ready' as const }),
    render: () => createElement('div')
  })
}

function contribution(
  id: string,
  providerKind: string,
  value: unknown
): DomainRendererContribution {
  return Object.freeze({
    id,
    kind: 'renderer.extension',
    packageName: '@fixture/content-space-provider',
    owner: Object.freeze({
      moduleId: 'fixture.content-space-provider',
      moduleVersion: '1.0.0'
    }),
    contract: Object.freeze({
      location: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
      contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
      providerKind
    }),
    value
  })
}

function host(
  contributions: readonly DomainRendererContribution[]
): Readonly<{ contributions: DomainRendererContributionHost }> {
  return Object.freeze({
    contributions: Object.freeze({
      list: (kind: string) => kind === 'renderer.extension' ? contributions : []
    })
  })
}
