import { lazy, type ReactElement } from 'react'
import { FileEdit } from 'lucide-react'
import type {
  DomainRendererCommandHandler,
  DomainRendererCommandInvocation,
  DomainRendererWorkbenchRightPanelRenderContext,
  DomainRendererWorkbenchRightPanelValue,
  DomainRendererWorkbenchToolbarActionValue
} from '@sciforge/domain-sdk/renderer-contributions'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  CHANGE_INSPECTOR_RENDERER_COMMAND_CONTRIBUTION,
  CHANGE_INSPECTOR_RENDERER_I18N_CONTRIBUTION,
  CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRACT,
  CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRACT,
  CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  createChangeInspectorCapabilityClient
} from './change-inspector-capability-client.js'
import {
  changeInspectorI18nResourceContribution,
  type ChangeInspectorI18nResourceContribution
} from './change-inspector-messages.js'

const ChangeInspectorPanel = lazy(() =>
  import('./ChangeInspectorPanel.js').then((module) => ({
    default: module.ChangeInspectorPanel
  }))
)

export type ChangeInspectorRendererContribution =
  | DomainRendererCommandHandler
  | DomainRendererWorkbenchRightPanelValue<ReactElement>
  | DomainRendererWorkbenchToolbarActionValue<typeof FileEdit>
  | ChangeInspectorI18nResourceContribution

export function createChangeInspectorCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: (invocation) => {
      if (!invocation.sessionId) return
      host.workbench?.openRightPanel({
        contributionId: CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId: invocation.sessionId
      })
    },
    isAvailable: (invocation) =>
      Boolean(invocation.sessionId && invocation.workspaceRoot && (
        invocation.runtimeId || hasSessionChangeResource(invocation)
      )),
    isActive: (invocation) =>
      invocation.activeSurface?.kind === 'right-panel' &&
      invocation.activeSurface.contributionId ===
        CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createChangeInspectorRightPanel(
  host: DomainRendererHost
): DomainRendererWorkbenchRightPanelValue<ReactElement> {
  const client = createChangeInspectorCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: (context: DomainRendererWorkbenchRightPanelRenderContext) => (
      <ChangeInspectorPanel
        active={context.active}
        className={context.className}
        client={client}
        onCollapse={context.onCollapse}
        session={context.session}
      />
    )
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ChangeInspectorRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ChangeInspectorRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...CHANGE_INSPECTOR_RENDERER_COMMAND_CONTRIBUTION,
        value: createChangeInspectorCommand(host)
      },
      {
        ...CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createChangeInspectorRightPanel(host)
      },
      {
        ...CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: FileEdit })
      },
      {
        ...CHANGE_INSPECTOR_RENDERER_I18N_CONTRIBUTION,
        value: changeInspectorI18nResourceContribution
      }
    ]
  })
}

function hasSessionChangeResource(
  invocation: DomainRendererCommandInvocation
): boolean {
  return invocation.resources?.some((resource) =>
    resource.kind === 'agent-session-changes'
  ) ?? false
}
