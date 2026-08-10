import { lazy, type ReactElement } from 'react'
import { Repeat2 } from 'lucide-react'
import type {
  DomainRendererHost
} from '@sciforge/domain-sdk/host'
import type {
  DomainRendererCommandHandler,
  DomainRendererCommandInvocation,
  DomainRendererWorkbenchRightPanelValue,
  DomainRendererWorkbenchToolbarActionValue
} from '@sciforge/domain-sdk/renderer-contributions'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_I18N_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRACT,
  WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRACT,
  WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createCreateLoopCapabilityClient } from './capability-client.js'
import { CreateLoopRuntimeProvider } from './runtime-bridge.js'
import {
  createLoopI18nResourceContribution,
  type CreateLoopI18nResourceContribution
} from './messages.js'
import {
  CREATE_LOOP_RESOURCE_PROVIDER_KIND,
  CREATE_LOOP_RESOURCE_PALETTE_LOCATION,
  isCreateLoopResourceProvider,
  type CreateLoopResourceProvider
} from '../resource-provider.js'

const WorkflowView = lazy(() =>
  import('./workflow/WorkflowView.js').then((module) => ({
    default: module.WorkflowView
  }))
)

export type CreateLoopRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type CreateLoopCommandContribution = DomainRendererCommandHandler

export type CreateLoopToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Repeat2>

type CreateLoopRendererContribution =
  | CreateLoopRightPanelContribution
  | CreateLoopCommandContribution
  | CreateLoopToolbarActionContribution
  | CreateLoopI18nResourceContribution

export function createCreateLoopRightPanelContribution(
  host: DomainRendererHost
): CreateLoopRightPanelContribution {
  const client = createCreateLoopCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ active, className, onCollapse, session }) => {
      const resourceProviders = collectCreateLoopResourceProviders(host)
      return (
        <div className={className} data-active={active ? 'true' : 'false'}>
          <CreateLoopRuntimeProvider
            client={client}
            resourceProviders={resourceProviders}
            workspaceRoot={session.workspaceRoot ?? ''}
          >
            <WorkflowView onCollapse={onCollapse} />
          </CreateLoopRuntimeProvider>
        </div>
      )
    }
  })
}

export function collectCreateLoopResourceProviders(
  host: DomainRendererHost
): readonly CreateLoopResourceProvider[] {
  return Object.freeze(
    (host.contributions?.list(CREATE_LOOP_RESOURCE_PROVIDER_KIND) ?? [])
      .filter((contribution) => {
        const contract = contribution.contract
        return Boolean(
          contract && typeof contract === 'object' && !Array.isArray(contract) &&
          contract.location === CREATE_LOOP_RESOURCE_PALETTE_LOCATION
        )
      })
      .map((contribution) => contribution.value)
      .filter(isCreateLoopResourceProvider)
  )
}

export function createCreateLoopCommandContribution(
  host: DomainRendererHost
): CreateLoopCommandContribution {
  return Object.freeze({
    execute: (context: DomainRendererCommandInvocation) => {
      if (!context.sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId: context.sessionId
      })
    },
    isAvailable: (context) =>
      Boolean(context.sessionId && context.workspaceRoot && host.workbench),
    isActive: (context) =>
      context.activeSurface?.kind === 'right-panel' &&
      context.activeSurface.contributionId ===
        WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createCreateLoopToolbarActionContribution():
CreateLoopToolbarActionContribution {
  return Object.freeze({ icon: Repeat2 })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<CreateLoopRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<CreateLoopRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
        value: createCreateLoopCommandContribution(host)
      },
      {
        ...WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createCreateLoopRightPanelContribution(host)
      },
      {
        ...WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createCreateLoopToolbarActionContribution()
      },
      {
        ...WORKFLOW_AUTOMATION_RENDERER_I18N_CONTRIBUTION,
        value: createLoopI18nResourceContribution
      }
    ]
  })
}

export * from './capability-client.js'
export * from './messages.js'
export * from './runtime-bridge.js'
export * from './workflow/WorkflowView.js'
