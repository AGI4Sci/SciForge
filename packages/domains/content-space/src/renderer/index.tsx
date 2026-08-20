import { lazy, type ReactElement } from 'react'
import { Folder } from 'lucide-react'
import { z } from 'zod'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererResourceNavigationValue,
  type DomainRendererSessionResource,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  CONTENT_SPACE_RENDERER_COMMAND_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRACT,
  CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRACT,
  CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '../contract.js'
import { createContentSpaceCapabilityClient } from './capability-client.js'
import { collectContentSpaceProviderEnrollmentViews } from './provider-enrollment-view.js'

const ContentSpacePanel = lazy(() => import('./ContentSpacePanel.js').then((module) => ({
  default: module.ContentSpacePanel
})))

export type ContentSpaceRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ContentSpaceToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Folder>
export type ContentSpaceRendererContribution =
  | ContentSpaceRightPanelContribution
  | ContentSpaceToolbarActionContribution
  | DomainRendererCommandHandler
  | DomainRendererResourceNavigationValue

export function createContentSpaceRightPanelContribution(
  host: DomainRendererHost
): ContentSpaceRightPanelContribution {
  const client = createContentSpaceCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ className, onCollapse, session, activation }) => {
      const initialResource = findContentSpaceActivationResource(
        activation?.payload,
        session.resources
      )
      const enrollmentViews = collectContentSpaceProviderEnrollmentViews(host)
      return (
        <ContentSpacePanel
          client={client}
          fileTransfers={host.fileTransfers}
          enrollmentViews={enrollmentViews}
          className={className}
          onCollapse={onCollapse}
          initialResource={initialResource}
        />
      )
    }
  })
}

export function createContentSpaceCommand(host: DomainRendererHost): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined ? {} : {
          activation: {
            contributionId: CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
            revision: 1,
            payload
          }
        })
      })
    },
    isAvailable: ({ sessionId }) => Boolean(host.workbench && sessionId?.trim()),
    isActive: ({ activeSurface }) => activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createContentSpaceResourceNavigationContribution():
DomainRendererResourceNavigationValue {
  return Object.freeze({
    resolve: ({ resource }) => {
      if (![
        ARTIFACT_RESOURCE_KIND,
        CONTENT_CONTAINER_RESOURCE_KIND,
        CONTENT_FILE_RESOURCE_KIND
      ].includes(resource.resourceKind as typeof ARTIFACT_RESOURCE_KIND)) return null
      return Object.freeze({
        activation: Object.freeze({
          revision: 1,
          payload: Object.freeze({
            resourceKind: resource.resourceKind,
            resourceId: resource.resourceId
          })
        })
      })
    }
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ContentSpaceRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ContentSpaceRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createContentSpaceRightPanelContribution(host)
      },
      {
        ...CONTENT_SPACE_RENDERER_COMMAND_CONTRIBUTION,
        value: createContentSpaceCommand(host)
      },
      {
        ...CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: Folder })
      },
      {
        ...CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
        contract: CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
        value: createContentSpaceResourceNavigationContribution()
      }
    ]
  })
}

export function findContentSpaceActivationResource(
  payload: unknown,
  resources?: readonly DomainRendererSessionResource[]
): DomainRendererSessionResource | undefined {
  const parsed = contentSpaceActivationPayloadSchema.safeParse(payload)
  if (!parsed.success) return undefined
  const matches = (resources ?? []).filter((resource) =>
    resource.kind === parsed.data.resourceKind &&
    resource.resourceRef === parsed.data.resourceId
  )
  return matches.length === 1 ? matches[0] : undefined
}

const contentSpaceActivationPayloadSchema = z.object({
  resourceKind: z.enum([
    ARTIFACT_RESOURCE_KIND,
    CONTENT_CONTAINER_RESOURCE_KIND,
    CONTENT_FILE_RESOURCE_KIND
  ]),
  resourceId: z.string().trim().min(1).max(512)
}).strict()

export * from './provider-enrollment-view.js'
