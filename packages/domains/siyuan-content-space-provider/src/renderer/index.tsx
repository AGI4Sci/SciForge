import type { CloudSpaceEnsureRequest } from '@sciforge/cloud-spaces-contracts'
import { projectCoordinatorWorkspaceReadContract } from '@sciforge/domain-collaboration/contract'
import type { z } from 'zod'
import type { ReactElement } from 'react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererWorkbenchMainAreaValue,
  type DomainRendererWorkbenchSettingsSectionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import { siyuanDocumentShareLookupContract, siyuanDocumentShareCreateContract, siyuanDocumentShareRevokeContract } from '../document-sharing-contract.js'
import type { DocumentSharingControls, DocumentShareLink } from './document-sharing.js'
import { domainPackageDefinition } from '../definition.js'
import {
  siyuanEditorContract,
  siyuanEditorDocumentContract, siyuanDocumentReferenceSchema, SIYUAN_DOCUMENT_RESOURCE_KIND,
  siyuanSpaceListContract, siyuanSpaceEnsureContract,
  siyuanEditorPresentContract,
  siyuanServiceConfigureContract,
  siyuanServiceStatusContract,
  siyuanServiceCheckContract,
  type SiYuanEditorViewport,
  type SiYuanServiceStatus,
  type SiYuanServiceConfigureRequest
} from '../editor-contract.js'
import { createEditorSessionStateStore } from './editor-session-state.js'
import { SiYuanEditorPage } from './editor-page.js'
import { createSiYuanEditorConfigurationStore } from './editor-configuration.js'
import { SiYuanSettingsSection } from './settings-section.js'
import { registerSiYuanVisibleContext } from './visible-context.js'
import { siYuanTranslations } from './locale.js'

type SiYuanMainAreaValue = DomainRendererWorkbenchMainAreaValue<ReactElement | null>
type SiYuanRendererValue = SiYuanMainAreaValue | SiYuanSettingsValue | typeof siYuanTranslations
type SiYuanSettingsValue = DomainRendererWorkbenchSettingsSectionValue<ReactElement | null>

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<SiYuanRendererValue> {
  const settings = createSiYuanEditorConfigurationStore()
  const sessionStates = createEditorSessionStateStore()
  const open = (input: Readonly<{ spaceId?: string; refresh?: boolean }> = {}) => host.capabilityInvoker.invoke(siyuanEditorContract, input)
  const spaces = () => host.capabilityInvoker.invoke(siyuanSpaceListContract, {}).then(result => result.spaces)
  const ensure = (input: CloudSpaceEnsureRequest) => host.capabilityInvoker.invoke(siyuanSpaceEnsureContract, input).then(result => result.space)
  const projects = async () => {
    const workspace = await host.capabilityInvoker.invoke(projectCoordinatorWorkspaceReadContract, {})
    if (workspace.connection.state !== 'ready') throw new Error(workspace.connection.state)
    const userId = workspace.connection.userId
    return workspace.projects.filter(view => view.project.ownerUserId === userId || view.memberships.some(member => member.userId === userId && member.state === 'active'))
      .map(view => ({ projectId: view.project.projectId, name: view.project.displayName, canCreate: view.project.ownerUserId === userId }))
  }
  const present = async (
    input: Readonly<{ url: string | null; sessionId?: string; reloadRevision?: number; viewport: SiYuanEditorViewport }>
  ): Promise<unknown> => host.capabilityInvoker.invoke(siyuanEditorPresentContract, input)
  // The token only ever travels into the main process; the page receives a
  // status document that says whether one is stored, never the value itself.
  const service = {
    status: (): Promise<SiYuanServiceStatus> =>
      host.capabilityInvoker.invoke(siyuanServiceStatusContract, {}),
    configure: (input: SiYuanServiceConfigureRequest): Promise<SiYuanServiceStatus> =>
      host.capabilityInvoker.invoke(siyuanServiceConfigureContract, input),
    check: () => host.capabilityInvoker.invoke(siyuanServiceCheckContract, {})
  }
  const sharing = createDocumentSharingControls(host)
  const visibleContext = (input: Parameters<typeof registerSiYuanVisibleContext>[1]) => registerSiYuanVisibleContext(host, input)
  const values: Record<string, SiYuanRendererValue> = {
    'siyuan-content-space.translations': siYuanTranslations,
    'siyuan-content-space.main-area': {
      render: (context) => <SiYuanEditorPage context={context} sessionStates={sessionStates} sharing={sharing} visibleContext={visibleContext} open={open} spaces={spaces} ensure={ensure} projects={projects} present={present} service={service} settings={settings} />
    },
    'siyuan-content-space.settings': {
      render: () => <SiYuanSettingsSection service={service} settings={settings} />
    }
  }
  return defineTrustedRendererDomainPackageEntry({
    definition: domainPackageDefinition,
    contributions: domainPackageDefinition.entrypoints
      .find((entry) => entry.process === 'renderer')!.contributions.map(declaration => {
        const value = values[declaration.id]
        if (!value) throw new Error('Unknown cloud notes renderer contribution: ' + declaration.id)
        const contract = domainPackageDefinition.contributionContracts[declaration.id]
        return { ...declaration, ...(contract ? { contract } : {}), value }
      })
  })
}

export function createDocumentSharingControls(host: DomainRendererHost): DocumentSharingControls {
  return {
    current: async (input, signal) => {
      const current = await host.capabilityInvoker.invoke(siyuanEditorDocumentContract, input, { signal })
      if (!current.document || signal.aborted) return null
      const resource = current.document.resource
      const document = await host.capabilityInvoker.observe({ resourceKind: SIYUAN_DOCUMENT_RESOURCE_KIND, stateSchema: siyuanDocumentReferenceSchema }, resource, { signal })
      const toLink = (result: z.infer<typeof siyuanDocumentShareLookupContract.outputSchema>): DocumentShareLink | null => result.share ? {
        id: result.share.shareId, permission: result.share.permission, revision: result.share.revision, revoked: result.share.status === 'revoked', url: result.shareUrl
      } : null
      return {
        title: document.state.title,
        list: async signal => {
          const link = toLink(await host.capabilityInvoker.invoke(siyuanDocumentShareLookupContract, {}, { resource, signal }))
          return link ? [link] : []
        },
        create: async (permission, signal) => {
          const link = toLink(await host.capabilityInvoker.invoke(siyuanDocumentShareCreateContract, { permission }, { resource, signal, approval: { mode: 'confirmation' } }))
          if (!link) throw new Error('share_unavailable')
          return link
        },
        revoke: async (link, signal) => {
          await host.capabilityInvoker.invoke(siyuanDocumentShareRevokeContract, { shareId: link.id, expectedRevision: link.revision }, { resource, signal, approval: { mode: 'confirmation' } })
        }
      }
    }
  }
}
