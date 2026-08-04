import React, { lazy, type ReactElement } from 'react'
import { Network } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createEvidenceDagCapabilityClient } from './evidence-dag-capability-client'
import {
  evidenceDagI18nResourceContribution,
  type EvidenceDagI18nResourceContribution
} from './evidence-dag-messages'

const EvidenceDagPanel = lazy(() =>
  import('./EvidenceDagPanel').then((module) => ({
    default: module.EvidenceDagPanel
  }))
)

export type EvidenceDagRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type EvidenceDagToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Network>

export type EvidenceDagRendererContribution =
  | EvidenceDagRightPanelContribution
  | DomainRendererCommandHandler
  | EvidenceDagToolbarActionContribution
  | EvidenceDagI18nResourceContribution

export function createEvidenceDagRightPanelContribution(
  host: DomainRendererHost
): EvidenceDagRightPanelContribution {
  const client = createEvidenceDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, ...context }) => (
      <EvidenceDagPanel
        {...context}
        {...(activation
          ? {
              activation: {
                contributionId: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                ...activation
              }
            }
          : {})}
        client={client}
        workspacePreview={host.workspacePreview}
      />
    )
  })
}

export function createEvidenceDagCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return createOpenRightPanelCommand(host, EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
}

export function createEvidenceDagToolbarActionContribution():
EvidenceDagToolbarActionContribution {
  return Object.freeze({ icon: Network })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<EvidenceDagRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<EvidenceDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createEvidenceDagRightPanelContribution(host)
      },
      {
        ...EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION,
        value: createEvidenceDagCommand(host)
      },
      {
        ...EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createEvidenceDagToolbarActionContribution()
      },
      {
        ...EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
        value: evidenceDagI18nResourceContribution
      }
    ]
  })
}

function createOpenRightPanelCommand(
  host: DomainRendererHost,
  contributionId: string
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId,
        sessionId,
        ...(payload === undefined ? {} : {
          activation: { contributionId, revision: 1, payload }
        })
      })
    },
    isAvailable: () => Boolean(host.workbench),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === contributionId
  })
}
