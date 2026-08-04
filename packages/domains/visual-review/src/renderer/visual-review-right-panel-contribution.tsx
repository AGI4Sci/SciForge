import { lazy, type ReactElement } from 'react'
import { Palette } from 'lucide-react'
import type {
  DomainRendererHost,
  DomainRendererWorkbenchRightPanelValue
} from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_I18N_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  VISUAL_REVIEW_PANEL_CONTRIBUTION_ID,
  visualReviewActivationSchema,
  type VisualReviewActivation
} from '../contract.js'
import { createVisualReviewCapabilityClient } from './capability-client.js'
import {
  visualReviewI18nResourceContribution,
  type VisualReviewI18nResourceContribution
} from './messages.js'

const VisualReviewPanel = lazy(() =>
  import('./VisualReviewPanel.js').then((module) => ({
    default: module.VisualReviewPanel
  }))
)

export type VisualReviewRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type VisualReviewToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Palette>

export type VisualReviewRendererContribution =
  | VisualReviewRightPanelContribution
  | DomainRendererCommandHandler
  | VisualReviewToolbarActionContribution
  | VisualReviewI18nResourceContribution

export function createVisualReviewRightPanelContribution(
  host: DomainRendererHost
): VisualReviewRightPanelContribution {
  if (!host.workbench) {
    throw new Error('Visual Review requires the renderer workbench host contract.')
  }
  const client = createVisualReviewCapabilityClient(host.capabilityInvoker)
  const workbench = host.workbench
  return Object.freeze({
    render: ({ className, onCollapse, activation, session }) => {
      const payload = activation
        ? visualReviewActivationSchema.parse(activation.payload)
        : undefined
      return (
        <VisualReviewPanel
          workspaceRoot={session.workspaceRoot ?? ''}
          sessionId={session.id}
          documentId={payload?.documentId ?? ''}
          refreshKey={payload?.refreshKey}
          className={className}
          onCollapse={onCollapse}
          client={client}
          workbench={workbench}
        />
      )
    }
  })
}

export function createVisualReviewCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  const client = createVisualReviewCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    execute: async ({ sessionId, workspaceRoot, payload }) => {
      if (!sessionId || !workspaceRoot || !host.workbench) return
      let activationPayload = payload
      if (activationPayload === undefined) {
        if (!host.workspace) return
        const selected = await host.workspace.pickFile({
          title: 'Open image for Visual Review',
          defaultPath: workspaceRoot,
          filters: [{
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg']
          }]
        })
        if (selected.canceled || !selected.path) return
        activationPayload = {
          documentId: documentIdForPath(sessionId, selected.path),
          artifact: {
            kind: 'image',
            sourcePath: selected.path
          },
          refreshKey: Date.now()
        }
      }
      const activation = visualReviewActivationSchema.parse(activationPayload)
      const opened = await client.open({
        documentId: activation.documentId,
        ...(activation.artifact ? { artifact: activation.artifact } : {})
      }, workspaceRoot)
      const nextActivation: VisualReviewActivation = {
        documentId: opened.document.documentId,
        refreshKey: activation.refreshKey ?? Date.now()
      }
      host.workbench.openRightPanel({
        contributionId: VISUAL_REVIEW_PANEL_CONTRIBUTION_ID,
        sessionId,
        activation: {
          contributionId: VISUAL_REVIEW_PANEL_CONTRIBUTION_ID,
          revision: 1,
          payload: nextActivation
        }
      })
    },
    isAvailable: ({ sessionId, workspaceRoot }) =>
      Boolean(host.workbench && sessionId && workspaceRoot),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === VISUAL_REVIEW_PANEL_CONTRIBUTION_ID
  })
}

function documentIdForPath(sessionId: string, path: string): string {
  const normalized = `${sessionId}:${path.replace(/\\/g, '/')}`
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `visual-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createVisualReviewToolbarActionContribution():
VisualReviewToolbarActionContribution {
  return Object.freeze({ icon: Palette })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<VisualReviewRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<VisualReviewRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createVisualReviewRightPanelContribution(host)
      },
      {
        ...VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION,
        value: createVisualReviewCommand(host)
      },
      {
        ...VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createVisualReviewToolbarActionContribution()
      },
      {
        ...VISUAL_REVIEW_RENDERER_I18N_CONTRIBUTION,
        value: visualReviewI18nResourceContribution
      }
    ]
  })
}
