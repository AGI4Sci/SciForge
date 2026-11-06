import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { domainPackageDefinition } from './definition.js'
import {
  createDomainMainEntry as createWorkbenchMainEntry,
  type BiologyRoomMainContribution
} from './workbench/capabilities.js'
import {
  createDomainMainEntry as createPreviewMainEntry,
  type LifeSciencePreviewMainContribution
} from './preview/main/index.js'

/**
 * Merged main-process entry.
 *
 * Two internal submodules contribute to one package entry:
 *   - workbench: capability factory (`biology-room.*`, 8 capabilities) + capability eval
 *   - preview:   six `main.workspace-preview-plugin` providers
 *
 * The returned contribution list must match the manifest exactly; the SDK
 * validates the declarations, the Host matches values by kind and id.
 */
export type BiologyWorkbenchMainContribution =
  | BiologyRoomMainContribution
  | LifeSciencePreviewMainContribution

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<BiologyWorkbenchMainContribution> {
  const workbench = createWorkbenchMainEntry(host)
  const preview = createPreviewMainEntry(host)

  return {
    definition: domainPackageDefinition,
    contributions: [
      ...workbench.contributions,
      ...preview.contributions
    ]
  }
}

export {
  createBiologyRoomCapabilityFactory,
  BiologyRoomService
} from './workbench/capabilities.js'
export type {
  BiologyRoomCapabilityFactory,
  BiologyRoomCapabilityHandlerContext,
  BiologyRoomCapabilityOptions,
  BiologyRoomCapabilityResourceRegistration,
  BiologyRoomServicePort
} from './workbench/capabilities.js'
export {
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE,
  createLifeScienceWorkspacePreviewProvider
} from './preview/backend/providers.js'