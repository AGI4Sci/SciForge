import { lazy, type ReactElement } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchBottomPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  TERMINAL_RENDERER_BOTTOM_PANEL_CONTRACT,
  TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION,
  TERMINAL_RENDERER_COMMAND_CONTRIBUTION,
  TERMINAL_RENDERER_I18N_CONTRIBUTION,
  TERMINAL_RENDERER_LIFECYCLE_CONTRIBUTION,
  TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRACT,
  TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import {
  createTerminalCapabilityClient,
  type TerminalCapabilityClient
} from './terminal-capability-client'
import {
  terminalI18nResourceContribution,
  type TerminalI18nResourceContribution
} from './terminal-messages'

const TerminalPanel = lazy(() =>
  import('./TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)

export type TerminalBottomPanelContribution =
  DomainRendererWorkbenchBottomPanelValue<ReactElement>

export type TerminalToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof TerminalSquare>

export type TerminalRendererLifecycleContribution = Readonly<{
  activate: () => () => void
}>

type TerminalRendererContribution =
  | DomainRendererCommandHandler
  | TerminalBottomPanelContribution
  | TerminalToolbarActionContribution
  | TerminalI18nResourceContribution
  | TerminalRendererLifecycleContribution

export function createTerminalBottomPanelContribution(
  client: TerminalCapabilityClient
): TerminalBottomPanelContribution {
  return Object.freeze({
    render: ({ className, height, onCollapse, session }) => (
      <TerminalPanel
        client={client}
        className={className}
        height={height}
        onCollapse={onCollapse}
        workspaceRoot={session.workspaceRoot ?? ''}
      />
    )
  })
}

export function createTerminalCommand(host: DomainRendererHost): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench?.openBottomPanel) return
      host.workbench.openBottomPanel({
        contributionId: TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined
          ? {}
          : { activation: { revision: 1, payload } })
      })
    },
    isAvailable: ({ sessionId, workspaceRoot }) =>
      Boolean(sessionId && workspaceRoot && host.workbench?.openBottomPanel),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'bottom-panel' &&
      activeSurface.contributionId === TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION.id
  })
}

export function createTerminalToolbarActionContribution():
TerminalToolbarActionContribution {
  return Object.freeze({ icon: TerminalSquare })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<TerminalRendererContribution> {
  const client = createTerminalCapabilityClient(host.capabilityInvoker)
  return defineTrustedRendererDomainPackageEntry<TerminalRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...TERMINAL_RENDERER_COMMAND_CONTRIBUTION,
        value: createTerminalCommand(host)
      },
      {
        ...TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION,
        contract: TERMINAL_RENDERER_BOTTOM_PANEL_CONTRACT,
        value: createTerminalBottomPanelContribution(client)
      },
      {
        ...TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createTerminalToolbarActionContribution()
      },
      {
        ...TERMINAL_RENDERER_I18N_CONTRIBUTION,
        value: terminalI18nResourceContribution
      },
      {
        ...TERMINAL_RENDERER_LIFECYCLE_CONTRIBUTION,
        value: Object.freeze({
          activate: () => () => {
            void client.disposeAll('Terminal package deactivated.')
          }
        })
      }
    ]
  })
}
