import type { ElementType, ReactElement } from 'react'

import type {
  DomainRendererContribution,
  DomainRendererHost
} from '@sciforge/domain-sdk/host'
import {
  RENDERER_EXTENSION_CONTRIBUTION_KIND,
  WORKBENCH_WORKSPACE_SECTION_LOCATION,
  domainRendererWorkbenchWorkspaceSectionContractSchema,
  isDomainRendererWorkbenchWorkspaceSectionValue,
  type DomainRendererWorkbenchWorkspaceSectionContract,
  type DomainRendererWorkbenchWorkspaceSectionRenderContext
} from '@sciforge/domain-sdk/renderer'

export const SCIFORGE_COLLABORATION_CENTER_WORKSPACE_ID =
  'sciforge.collaboration-center' as const

export type ProjectCoordinatorWorkspaceSection =
  DomainRendererWorkbenchWorkspaceSectionContract & Readonly<{
    contributionId: string
    ownerId: string
    icon?: ElementType
    render: (
      context: DomainRendererWorkbenchWorkspaceSectionRenderContext
    ) => ReactElement
  }>

export function collectProjectCoordinatorWorkspaceSections(
  host: Pick<DomainRendererHost, 'contributions'>
): readonly ProjectCoordinatorWorkspaceSection[] {
  const sections: ProjectCoordinatorWorkspaceSection[] = []
  const claimed = new Set<string>()
  for (const contribution of host.contributions?.list(
    RENDERER_EXTENSION_CONTRIBUTION_KIND
  ) ?? []) {
    if (!isWorkspaceSectionCandidate(contribution)) continue
    const contract = domainRendererWorkbenchWorkspaceSectionContractSchema.safeParse(
      contribution.contract
    )
    if (!contract.success) {
      throw new TypeError(
        `Workspace section ${contribution.owner.moduleId}/${contribution.id} has an invalid contract.`
      )
    }
    if (contract.data.workspaceId !== SCIFORGE_COLLABORATION_CENTER_WORKSPACE_ID) {
      continue
    }
    if (!isDomainRendererWorkbenchWorkspaceSectionValue(contribution.value)) {
      throw new TypeError(
        `Workspace section ${contribution.owner.moduleId}/${contribution.id} has an invalid renderer.`
      )
    }
    const claim = `${contract.data.placement}:\u0000${contract.data.sectionId}`
    if (claimed.has(claim)) {
      throw new TypeError(
        `Workspace section ${contract.data.placement}/${contract.data.sectionId} is duplicated.`
      )
    }
    claimed.add(claim)
    const value = contribution.value
    sections.push(Object.freeze({
      ...contract.data,
      contributionId: contribution.id,
      ownerId: contribution.owner.moduleId,
      ...(value.icon ? { icon: value.icon as ElementType } : {}),
      render: (context) => value.render(context) as ReactElement
    }))
  }
  return Object.freeze(sections.sort((left, right) => (
    left.order - right.order ||
    left.sectionId.localeCompare(right.sectionId) ||
    left.ownerId.localeCompare(right.ownerId)
  )))
}

function isWorkspaceSectionCandidate(
  contribution: DomainRendererContribution
): boolean {
  return contribution.kind === RENDERER_EXTENSION_CONTRIBUTION_KIND &&
    isRecord(contribution.contract) &&
    contribution.contract.location === WORKBENCH_WORKSPACE_SECTION_LOCATION
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
