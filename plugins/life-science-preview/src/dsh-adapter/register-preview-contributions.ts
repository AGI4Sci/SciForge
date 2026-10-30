/**
 * Workspace-preview slot registration for the named-runner contract
 * (SDK workspace-preview contribution channel, gap-1b; see
 * packages/plugin-sdk/src/workspace-preview-channel.ts and PR-A).
 *
 * The plugin entry re-exports getWorkspacePreviewProviders(); the runner
 * caches the returned slots at activation and the Host invokes them during
 * rendering over the sciforge-preview.v1 wire. Governance binding:
 * - slotId === manifest.id for every slot (layer-1 contract check on the Host
 *   matches these ids against sciforge.adapter.json previewSlots);
 * - artifactKinds lists exactly what prepareArtifact may produce (bioimaging
 *   tile/thumbnail only — the sole byte-bearing slot, matching the trusted
 *   domain backend);
 * - bytes travel as base64 on the wire (runner-encoded); this module deals
 *   exclusively in in-process Uint8Array results.
 */
import type { WorkspacePreviewArtifactKind } from '@sciforge/plugin-sdk'
import type { LifeSciencePorts } from '../ports/index.js'
import {
  createLifeScienceWorkspacePreviewContributions,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from './contributions.js'
import { MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/workspace-preview'
import { createRealDataPorts } from './data-services.js'
import { createNodeFilePorts } from './node-file-ports.js'

function createPorts(): LifeSciencePorts {
  const nodePorts = createNodeFilePorts()
  return {
    files: nodePorts.read,
    writes: nodePorts.write,
    data: createRealDataPorts()
  }
}

export type LifeSciencePreviewSlot = Readonly<{
  slotId: string
  artifactKinds: readonly WorkspacePreviewArtifactKind[]
  manifest: unknown
  provider: unknown
}>

const SLOT_ARTIFACT_KINDS: Readonly<Record<string, readonly WorkspacePreviewArtifactKind[]>> = Object.freeze({
  molecular: Object.freeze([]),
  'sequence-genomics': Object.freeze([]),
  'biology-index-transport': Object.freeze([]),
  'omics-matrix': Object.freeze([]),
  bioimaging: Object.freeze(['tile', 'thumbnail'] as const),
  'proteomics-spectra': Object.freeze([])
})

/**
 * Named-runner export: the six workspace-preview slot contributions. Called
 * once at activation; every slot carries its frozen canonical manifest and a
 * provider whose five callbacks dispatch into the ported core behind the
 * plugin's node:fs file ports and real pure data services.
 */
export function getWorkspacePreviewProviders(): LifeSciencePreviewSlot[] {
  const contributions = createLifeScienceWorkspacePreviewContributions(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => ({ id: contract.contributionId })),
    MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
    'main',
    createPorts()
  )
  return contributions.map((contribution) => {
    const artifactKinds = SLOT_ARTIFACT_KINDS[contribution.value.manifest.id]
    if (!artifactKinds) {
      throw new Error(`Life Science Preview slot ${contribution.value.manifest.id} has no artifact-kind declaration.`)
    }
    return Object.freeze({
      slotId: contribution.value.manifest.id,
      artifactKinds,
      manifest: contribution.value.manifest,
      provider: contribution.value.provider
    })
  })
}
