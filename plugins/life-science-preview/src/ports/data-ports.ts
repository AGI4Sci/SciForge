/**
 * Data-service port types for the life-science-preview core.
 *
 * This file is the ONLY place the core's type surface touches the five
 * workspace-* service packages (type-only imports — erased at runtime). The
 * seventeen one-shot synchronous pure functions from the interface-requirements
 * inventory (lsp-interface-requirements-20261016.md §缺口②) are grouped per
 * package; the real adapter fills them with the zod-only self-contained pure
 * services that ride with the plugin, tests fill them with fakes, and both
 * produce identical outputs (tests/parity.test.ts).
 */
import type {
  WorkspaceMolecularPreviewInput,
  WorkspaceMolecularPreviewResult,
  WorkspaceMolecularWorkbenchInput,
  WorkspaceMolecularWorkbenchResult
} from '@sciforge/workspace-molecular/contract'
import type {
  WorkspaceSequencePreviewInput,
  WorkspaceSequencePreviewResult,
  WorkspaceSequenceRegionSelectionInput,
  WorkspaceSequenceRegionSelectionResult,
  WorkspaceSequenceSearchInput,
  WorkspaceSequenceSearchResult
} from '@sciforge/workspace-sequence/contract'
import type {
  WorkspaceOmicsDatasetSelectionInput,
  WorkspaceOmicsDatasetSelectionResult,
  WorkspaceOmicsPreviewInput,
  WorkspaceOmicsPreviewResult
} from '@sciforge/workspace-omics/contract'
import type {
  WorkspaceBioimagingChannelSelectionInput,
  WorkspaceBioimagingChannelSelectionResult,
  WorkspaceBioimagingPreviewInput,
  WorkspaceBioimagingPreviewResult,
  WorkspaceBioimagingRegionAnnotationInput,
  WorkspaceBioimagingRegionAnnotationResult,
  WorkspaceBioimagingRegionSelectionInput,
  WorkspaceBioimagingRegionSelectionResult,
  WorkspaceBioimagingRoiSetExportInput,
  WorkspaceBioimagingRoiSetExportResult,
  WorkspaceBioimagingThumbnailDecodeInput,
  WorkspaceBioimagingThumbnailDecodeResult,
  WorkspaceBioimagingTileDecodeInput,
  WorkspaceBioimagingTileDecodeResult
} from '@sciforge/workspace-bioimaging/contract'
import type {
  WorkspaceSpectraAnnotateRangeInput,
  WorkspaceSpectraAnnotateRangeResult,
  WorkspaceSpectraExportPeakListInput,
  WorkspaceSpectraExportPeakListResult,
  WorkspaceSpectraPeakSelectionResult,
  WorkspaceSpectraPreviewInput,
  WorkspaceSpectraPreviewResult,
  WorkspaceSpectraSelectPeaksByRangeInput
} from '@sciforge/workspace-spectra/contract'
import type { WorkspaceFileReadPorts, WorkspaceFileWritePorts } from './file-ports.js'

export type MolecularDataPorts = Readonly<{
  preview(input: WorkspaceMolecularPreviewInput): WorkspaceMolecularPreviewResult
  workbench(input: WorkspaceMolecularWorkbenchInput): WorkspaceMolecularWorkbenchResult
}>

export type SequenceDataPorts = Readonly<{
  preview(input: WorkspaceSequencePreviewInput): WorkspaceSequencePreviewResult
  selectRegion(input: WorkspaceSequenceRegionSelectionInput): WorkspaceSequenceRegionSelectionResult
  search(input: WorkspaceSequenceSearchInput): WorkspaceSequenceSearchResult
}>

export type OmicsDataPorts = Readonly<{
  preview(input: WorkspaceOmicsPreviewInput): WorkspaceOmicsPreviewResult
  selectDataset(input: WorkspaceOmicsDatasetSelectionInput): WorkspaceOmicsDatasetSelectionResult
}>

export type BioimagingDataPorts = Readonly<{
  preview(input: WorkspaceBioimagingPreviewInput): WorkspaceBioimagingPreviewResult
  decodeTile(input: WorkspaceBioimagingTileDecodeInput): WorkspaceBioimagingTileDecodeResult
  decodeThumbnail(input: WorkspaceBioimagingThumbnailDecodeInput): WorkspaceBioimagingThumbnailDecodeResult
  selectRegion(input: WorkspaceBioimagingRegionSelectionInput): WorkspaceBioimagingRegionSelectionResult
  selectChannels(input: WorkspaceBioimagingChannelSelectionInput): WorkspaceBioimagingChannelSelectionResult
  annotateRegion(input: WorkspaceBioimagingRegionAnnotationInput): WorkspaceBioimagingRegionAnnotationResult
  exportRoiSet(input: WorkspaceBioimagingRoiSetExportInput): WorkspaceBioimagingRoiSetExportResult
}>

export type SpectraDataPorts = Readonly<{
  preview(input: WorkspaceSpectraPreviewInput): WorkspaceSpectraPreviewResult
  selectPeaksByRange(input: WorkspaceSpectraSelectPeaksByRangeInput): WorkspaceSpectraPeakSelectionResult
  annotateRange(input: WorkspaceSpectraAnnotateRangeInput): WorkspaceSpectraAnnotateRangeResult
  exportPeakList(input: WorkspaceSpectraExportPeakListInput): WorkspaceSpectraExportPeakListResult
}>

export type LifeScienceDataPorts = Readonly<{
  molecular: MolecularDataPorts
  sequence: SequenceDataPorts
  omics: OmicsDataPorts
  bioimaging: BioimagingDataPorts
  spectra: SpectraDataPorts
}>

export type LifeSciencePorts = Readonly<{
  files: WorkspaceFileReadPorts
  writes: WorkspaceFileWritePorts
  data: LifeScienceDataPorts
}>
