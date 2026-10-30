import React, { lazy, Suspense, useMemo, type ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { DomainRendererChatMessageValue, DomainRendererWorkbenchMainAreaValue, DomainRendererWorkbenchSurfaceActivation } from '@sciforge/domain-sdk/renderer-contributions'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererComposerContextProvider,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  COLLABORATION_CHAT_MESSAGE_CONTRACT,
  COLLABORATION_CHAT_MESSAGE_CONTRIBUTION,
  COLLABORATION_COMPOSER_CONTEXT_CONTRACT,
  COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION,
  COLLABORATION_I18N_CONTRIBUTION,
  COLLABORATION_MAIN_AREA_CONTRACT,
  COLLABORATION_MAIN_AREA_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createCollaborationRendererClient } from './collaboration-capability-client.js'
import { createCollaborationChatMessageContribution } from './chat-message.js'
import {
  collaborationI18nResourceContribution,
  type CollaborationI18nResourceContribution
} from './collaboration-messages.js'
import { createProjectCoordinatorRendererClient } from '../coordinator/renderer/project-coordinator-capability-client.js'
import { createProjectCoordinatorComposerContextProvider } from '../coordinator/renderer/composer-context-provider.js'
const CollaborationWorkspacePage = lazy(() => import('./workspace/CollaborationWorkspacePage.browser.js'))

export type CollaborationMainAreaContribution =
  DomainRendererWorkbenchMainAreaValue<ReactElement>

export type CollaborationRendererContribution =
  | CollaborationMainAreaContribution
  | DomainRendererChatMessageValue<ReactElement>
  | DomainRendererComposerContextProvider
  | CollaborationI18nResourceContribution

function CollaborationMainAreaPage({
  host,
  active,
  activation,
  className
}: Readonly<{
  host: DomainRendererHost
  active: boolean
  activation?: DomainRendererWorkbenchSurfaceActivation
  className: string
}>): ReactElement {
  const coordinatorClient = useMemo(() => createProjectCoordinatorRendererClient(host.capabilityInvoker), [host])
  const collaborationClient = useMemo(() => createCollaborationRendererClient(host.capabilityInvoker), [host])
  return (
    <Suspense fallback={<div className={className} aria-busy="true" />}>
      <CollaborationWorkspacePage
        coordinatorClient={coordinatorClient}
        collaborationClient={collaborationClient}
        workspacePreview={host.workspacePreview}
        resourcePreview={host.resourcePreview}
        workspace={host.workspace}
        workbench={host.workbench}
        active={active}
        activation={activation}
        className={className}
      />
    </Suspense>
  )
}

export function createCollaborationMainAreaContribution(
  host: DomainRendererHost
): CollaborationMainAreaContribution {
  return Object.freeze({
    render: ({ active, className, activation }) => (
      <CollaborationMainAreaPage
        host={host}
        active={active}
        activation={activation}
        className={className}
      />
    )
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<CollaborationRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<CollaborationRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...COLLABORATION_MAIN_AREA_CONTRIBUTION,
        contract: COLLABORATION_MAIN_AREA_CONTRACT,
        value: createCollaborationMainAreaContribution(host)
      },
      {
        ...COLLABORATION_I18N_CONTRIBUTION,
        value: collaborationI18nResourceContribution
      },
      {
        ...COLLABORATION_CHAT_MESSAGE_CONTRIBUTION,
        contract: COLLABORATION_CHAT_MESSAGE_CONTRACT,
        value: createCollaborationChatMessageContribution(
          createCollaborationRendererClient(host.capabilityInvoker)
        )
      },
      {
        ...COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION,
        contract: COLLABORATION_COMPOSER_CONTEXT_CONTRACT,
        value: createProjectCoordinatorComposerContextProvider(
          createProjectCoordinatorRendererClient(host.capabilityInvoker)
        )
      }
    ]
  })
}

export * from './collaboration-capability-client.js'
export * from './collaboration-messages.js'
