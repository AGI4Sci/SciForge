import type { ReactElement } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type {
  DomainRendererCommandHandler,
  DomainRendererComposerContextProvider,
  DomainRendererWorkbenchGlobalOverlayValue,
  DomainRendererWorkbenchToolbarActionValue
} from '@sciforge/domain-sdk/renderer'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  ANCHORED_COMMENTS_COMMAND_CONTRIBUTION,
  ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRACT,
  ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION,
  ANCHORED_COMMENTS_OVERLAY_CONTRACT,
  ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION,
  ANCHORED_COMMENTS_TOOLBAR_CONTRACT,
  ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { AnchoredCommentsOverlay } from './AnchoredCommentsOverlay'
import { createAnchoredCommentsComposerContextProvider } from './composer-context-provider'
import { createAnchoredCommentsCapabilityClient } from './renderer-bridge'

type AnchoredCommentsRendererContribution =
  | DomainRendererCommandHandler
  | DomainRendererWorkbenchToolbarActionValue<typeof MessageSquarePlus>
  | DomainRendererWorkbenchGlobalOverlayValue<ReactElement>
  | DomainRendererComposerContextProvider

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<AnchoredCommentsRendererContribution> {
  if (!host.workbench?.toggleGlobalOverlay) {
    throw new Error(
      'Anchored Comments requires the generic Workbench global-overlay host.'
    )
  }
  if (!host.visibleContext?.inspectRegisteredTargetAt) {
    throw new Error(
      'Anchored Comments requires Host inspection of registered visual targets.'
    )
  }
  const client = createAnchoredCommentsCapabilityClient(host.capabilityInvoker)
  const workbench = host.workbench
  const visibleContext = host.visibleContext

  const command: DomainRendererCommandHandler = Object.freeze({
    execute: (invocation) => {
      const active =
        invocation.activeSurface?.kind === 'global-overlay' &&
        invocation.activeSurface.contributionId ===
          ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION.id
      workbench.toggleGlobalOverlay!({
        contributionId: ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION.id,
        ...(invocation.sessionId ? { sessionId: invocation.sessionId } : {}),
        open: !active
      })
    },
    isAvailable: (invocation) => Boolean(invocation.sessionId),
    isActive: (invocation) =>
      invocation.activeSurface?.kind === 'global-overlay' &&
      invocation.activeSurface.contributionId ===
        ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION.id
  })

  const toolbar: DomainRendererWorkbenchToolbarActionValue<
    typeof MessageSquarePlus
  > = Object.freeze({ icon: MessageSquarePlus })

  const overlay: DomainRendererWorkbenchGlobalOverlayValue<ReactElement> =
    Object.freeze({
      render: (context) => (
        <AnchoredCommentsOverlay
          client={client}
          context={context}
          visibleContext={visibleContext}
        />
      )
    })

  return defineTrustedRendererDomainPackageEntry<AnchoredCommentsRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...ANCHORED_COMMENTS_COMMAND_CONTRIBUTION,
        value: command
      },
      {
        ...ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION,
        contract: ANCHORED_COMMENTS_TOOLBAR_CONTRACT,
        value: toolbar
      },
      {
        ...ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION,
        contract: ANCHORED_COMMENTS_OVERLAY_CONTRACT,
        value: overlay
      },
      {
        ...ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION,
        contract: ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRACT,
        value: createAnchoredCommentsComposerContextProvider(client)
      }
    ]
  })
}

export { AnchoredCommentsOverlay } from './AnchoredCommentsOverlay'
export { anchoredCommentStore, useAnchoredCommentStore } from './anchored-comment-store'
export { createAnchoredCommentsCapabilityClient } from './renderer-bridge'
