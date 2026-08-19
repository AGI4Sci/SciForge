import { createElement } from 'react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
  type ContentSpaceProviderAccessState,
  type ContentSpaceProviderEnrollmentView
} from '@sciforge/domain-content-space/renderer'
import { OPENCONTENT_PROVIDER_KIND } from '@sciforge/domain-opencontent-connector/contract'
import {
  OpenContentEnrollment,
  createOpenContentConnectionRendererClient,
  isOpenContentEnrollmentViewState,
  type OpenContentEnrollmentViewState
} from '@sciforge/domain-opencontent-connector/renderer/enrollment'

import {
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT,
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'

export function createOpenContentContentSpaceEnrollmentView(
  host: DomainRendererHost
): ContentSpaceProviderEnrollmentView {
  const client = createOpenContentConnectionRendererClient(host.capabilityInvoker)

  return Object.freeze({
    contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
    providerKind: OPENCONTENT_PROVIDER_KIND,
    readAccessState: async ({
      providerInstanceRef,
      signal
    }): Promise<ContentSpaceProviderAccessState> => {
      if (signal.aborted) return unavailableAccess(providerInstanceRef)
      try {
        const result = await client.status(providerInstanceRef, { signal })
        if (signal.aborted) return unavailableAccess(providerInstanceRef)
        const viewState = Object.freeze({
          phase: 'resolved' as const,
          providerInstanceRef,
          result
        }) satisfies OpenContentEnrollmentViewState
        if (result.outcome === 'error') {
          return Object.freeze({ status: 'unavailable' as const, viewState })
        }
        if (result.status.state === 'disconnected') {
          return Object.freeze({ status: 'human_action_required' as const, viewState })
        }
        if (result.status.providerInstanceRef !== providerInstanceRef) {
          return Object.freeze({ status: 'unavailable' as const, viewState })
        }
        return Object.freeze({
          status: result.status.state === 'connected'
            ? 'ready' as const
            : 'human_action_required' as const,
          viewState
        })
      } catch {
        return unavailableAccess(providerInstanceRef)
      }
    },
    render: ({ providerInstanceRef, accessState, onAccessChanged }) => {
      const viewState = accessState.viewState
      const safeViewState = isOpenContentEnrollmentViewState(viewState) &&
        viewState.providerInstanceRef === providerInstanceRef
        ? viewState
        : Object.freeze({
            phase: accessState.status === 'checking'
              ? 'checking' as const
              : 'unavailable' as const,
            providerInstanceRef
          })
      return createElement(OpenContentEnrollment, {
        client,
        providerInstanceRef,
        viewState: safeViewState,
        onConnectionChanged: onAccessChanged
      })
    }
  })
}

function unavailableAccess(
  providerInstanceRef: string
): ContentSpaceProviderAccessState {
  const viewState = Object.freeze({
    phase: 'unavailable' as const,
    providerInstanceRef
  }) satisfies OpenContentEnrollmentViewState
  return Object.freeze({ status: 'unavailable' as const, viewState })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ContentSpaceProviderEnrollmentView> {
  return defineTrustedRendererDomainPackageEntry({
    definition: domainPackageDefinition,
    contributions: [{
      ...OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION,
      contract: OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT,
      value: createOpenContentContentSpaceEnrollmentView(host)
    }]
  })
}
