import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type {
  WorkspaceObservation,
  WorkspacePreviewPluginManifest,
  WorkspaceStructuredSelection
} from '@sciforge/domain-sdk/workspace-preview'
import {
  decodeLifeScienceSelection,
  decodeLifeScienceWorkspaceObservation,
  encodeLifeScienceEditOperation,
  type LifeScienceWorkspacePreviewKind
} from '../wire'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from '../contract.js'
import {
  domainPackageDefinition,
  LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS,
  LIFE_SCIENCE_PREVIEW_RENDERER_LIFECYCLE_CONTRIBUTIONS
} from '../definition.js'
import { BioimagingWorkspaceViewer } from './BioimagingWorkspaceViewer'
import { MolecularWorkspaceViewer } from './MolecularWorkspaceViewer'
import { OmicsWorkspaceViewer } from './OmicsWorkspaceViewer'
import { SequenceWorkspaceViewer } from './SequenceWorkspaceViewer'
import { SpectraWorkspaceViewer } from './SpectraWorkspaceViewer'
import {
  BIOIMAGING_WORKSPACE_PREVIEW_ACTIONS,
  MOLECULAR_WORKSPACE_PREVIEW_ACTIONS,
  OMICS_WORKSPACE_PREVIEW_ACTIONS,
  SEQUENCE_WORKSPACE_PREVIEW_ACTIONS,
  SPECTRA_WORKSPACE_PREVIEW_ACTIONS
} from './actions'
import type {
  LifeScienceRendererContributionValue,
  LifeScienceRendererWorkspacePreviewContribution,
  WorkspacePreviewInspectorSection,
  WorkspacePreviewPluginRendererInput
} from './contribution-types'
import {
  buildBioimagingSection,
  buildBioimagingSelectionSection,
  buildMolecularSection,
  buildMolecularSelectionSection,
  buildOmicsSection,
  buildOmicsSelectionSection,
  buildSequenceSection,
  buildSequenceSelectionSection,
  buildSpectraSection,
  buildSpectraSelectionSection
} from './inspector'
import { scheduleMolecularMolstarPrewarm } from './molecular-prewarm'

export function createDomainRendererEntry(
  _host: DomainRendererHost
): TrustedRendererDomainPackageEntry<LifeScienceRendererContributionValue> {
  const contractsById = new Map(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => [
      contract.contributionId,
      contract.manifest
    ])
  )

  const previewContributions = LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS.map((declaration) => {
    const manifest = contractsById.get(declaration.id)
    if (!manifest) {
      throw new Error(`Life Science Preview renderer ${declaration.id} has no canonical manifest.`)
    }
    return {
      ...declaration,
      contract: manifest,
      value: rendererContributionFor(manifest)
    }
  })
  const lifecycleContributions = LIFE_SCIENCE_PREVIEW_RENDERER_LIFECYCLE_CONTRIBUTIONS.map((declaration) => ({
    ...declaration,
    value: Object.freeze({ activate: scheduleMolecularMolstarPrewarm })
  }))

  return defineTrustedRendererDomainPackageEntry<LifeScienceRendererContributionValue>({
    definition: domainPackageDefinition,
    contributions: [...previewContributions, ...lifecycleContributions]
  })
}

function rendererContributionFor(
  manifest: WorkspacePreviewPluginManifest
): LifeScienceRendererWorkspacePreviewContribution {
  switch (manifest.id) {
    case 'molecular':
      return Object.freeze({
        manifest,
        actions: MOLECULAR_WORKSPACE_PREVIEW_ACTIONS,
        selectionKind: 'domain',
        inspectSelection: (selection) => inspectSelectionFor('molecular', selection),
        inspectObservation: (observation) => decodeLifeScienceWorkspaceObservation(observation)?.molecular
          ? [buildMolecularSection(decodeLifeScienceWorkspaceObservation(observation)!.molecular!)]
          : [],
        render: ({ context, observation, asset, transport, applyEdit }) => (
          <MolecularWorkspaceViewer
            observation={decodeLifeScienceWorkspaceObservation(observation)}
            asset={asset}
            assetStatus={context.assetStatus}
            assetError={context.assetError}
            sourceUrl={transport.sourceUrl}
            readRange={transport.readRange}
            onApplyEdit={(operation) => applyEdit(encodeLifeScienceEditOperation(operation))}
            className="h-full min-h-0 pr-20"
          />
        )
      })
    case 'sequence-genomics':
      return Object.freeze({
        manifest,
        actions: SEQUENCE_WORKSPACE_PREVIEW_ACTIONS,
        selectionKind: 'domain',
        inspectSelection: (selection) => inspectSelectionFor('sequence', selection),
        inspectObservation: (observation) => decodeLifeScienceWorkspaceObservation(observation)?.sequence
          ? [buildSequenceSection(decodeLifeScienceWorkspaceObservation(observation)!.sequence!)]
          : [],
        render: ({ observation, applyEdit }) => (
          <SequenceWorkspaceViewer
            observation={decodeLifeScienceWorkspaceObservation(observation)}
            onSetSelection={(operation) => applyEdit(encodeLifeScienceEditOperation(operation))}
            className="h-full min-h-0 pr-20"
          />
        )
      })
    case 'omics-matrix':
      return Object.freeze({
        manifest,
        actions: OMICS_WORKSPACE_PREVIEW_ACTIONS,
        selectionKind: 'domain',
        inspectSelection: (selection) => inspectSelectionFor('omics', selection),
        inspectObservation: (observation) => decodeLifeScienceWorkspaceObservation(observation)?.omics
          ? [buildOmicsSection(decodeLifeScienceWorkspaceObservation(observation)!.omics!)]
          : [],
        render: ({ observation }) => (
          <OmicsWorkspaceViewer observation={decodeLifeScienceWorkspaceObservation(observation)} className="h-full min-h-0 pr-20" />
        )
      })
    case 'bioimaging':
      return Object.freeze({
        manifest,
        actions: BIOIMAGING_WORKSPACE_PREVIEW_ACTIONS,
        selectionKind: 'domain',
        inspectSelection: (selection) => inspectSelectionFor('bioimaging', selection),
        inspectObservation: (observation) => decodeLifeScienceWorkspaceObservation(observation)?.bioimaging
          ? [buildBioimagingSection(decodeLifeScienceWorkspaceObservation(observation)!.bioimaging!)]
          : [],
        render: ({ observation, transport }) => (
          <BioimagingWorkspaceViewer
            observation={decodeLifeScienceWorkspaceObservation(observation)}
            transport={transport}
            className="h-full min-h-0 pr-20"
          />
        )
      })
    case 'proteomics-spectra':
      return Object.freeze({
        manifest,
        actions: SPECTRA_WORKSPACE_PREVIEW_ACTIONS,
        selectionKind: 'domain',
        inspectSelection: (selection) => inspectSelectionFor('spectra', selection),
        inspectObservation: (observation) => decodeLifeScienceWorkspaceObservation(observation)?.spectra
          ? [buildSpectraSection(decodeLifeScienceWorkspaceObservation(observation)!.spectra!)]
          : [],
        render: ({ observation }) => (
          <SpectraWorkspaceViewer observation={decodeLifeScienceWorkspaceObservation(observation)} className="h-full min-h-0 pr-20" />
        )
      })
    case 'biology-index-transport':
      return Object.freeze({
        manifest,
        inspectObservation: buildIndexTransportInspector,
        render: (input) => <BiologyIndexTransportSummary {...input} />
      })
    default:
      throw new Error(`Life Science Preview renderer has no implementation for ${manifest.id}.`)
  }
}

function inspectSelectionFor(
  kind: LifeScienceWorkspacePreviewKind,
  wireSelection: WorkspaceStructuredSelection
): WorkspacePreviewInspectorSection {
  const selection = decodeLifeScienceSelection(wireSelection)
  if (selection?.kind !== kind) {
    return {
      id: 'selection',
      title: 'Selection',
      summary: 'Unsupported domain selection',
      rows: [{ id: 'kind', label: 'Kind', value: wireSelection.kind }]
    }
  }
  switch (selection.kind) {
    case 'molecular': return buildMolecularSelectionSection(selection)
    case 'sequence': return buildSequenceSelectionSection(selection)
    case 'omics': return buildOmicsSelectionSection(selection)
    case 'bioimaging': return buildBioimagingSelectionSection(selection)
    case 'spectra': return buildSpectraSelectionSection(selection)
  }
}

function buildIndexTransportInspector(
  observation: WorkspaceObservation
): readonly WorkspacePreviewInspectorSection[] {
  return [{
    id: 'biology-index-transport',
    title: 'Biology Index Transport',
    summary: 'Index metadata transport',
    rows: [
      { id: 'path', label: 'Path', value: observation.file.path },
      { id: 'plugin', label: 'Plugin', value: observation.view.pluginId }
    ]
  }]
}

function BiologyIndexTransportSummary({
  observation
}: WorkspacePreviewPluginRendererInput): ReactElement {
  return (
    <section className="flex h-full min-h-0 flex-col justify-center gap-2 p-6" data-biology-index-transport>
      <strong>Biology index transport</strong>
      <p className="text-sm text-ds-text-muted">
        {observation
          ? `Index metadata is available for ${observation.file.path}.`
          : 'Open a biology index file to inspect its transport metadata.'}
      </p>
    </section>
  )
}

export {
  BioimagingWorkspaceViewer,
  MolecularWorkspaceViewer,
  OmicsWorkspaceViewer,
  SequenceWorkspaceViewer,
  SpectraWorkspaceViewer
}
