/**
 * Real data-port wiring: the five zod-only self-contained workspace-*
 * pure service packages fill the data ports (the "data plane rides with the
 * plugin" resolution of gap-2 — no host bridge is needed for these
 * one-shot synchronous pure computations; see
 * lsp-interface-requirements-20261016.md §缺口②).
 */
import { createWorkspaceBioimagingService } from '@sciforge/workspace-bioimaging/service'
import { createWorkspaceMolecularService } from '@sciforge/workspace-molecular/service'
import { createWorkspaceOmicsService } from '@sciforge/workspace-omics/service'
import { createWorkspaceSequenceService } from '@sciforge/workspace-sequence/service'
import { createWorkspaceSpectraService } from '@sciforge/workspace-spectra/service'
import type { LifeScienceDataPorts } from '../ports/index.js'

export function createRealDataPorts(): LifeScienceDataPorts {
  const molecular = createWorkspaceMolecularService()
  const sequence = createWorkspaceSequenceService()
  const omics = createWorkspaceOmicsService()
  const bioimaging = createWorkspaceBioimagingService()
  const spectra = createWorkspaceSpectraService()
  return {
    molecular: {
      preview: (input) => molecular.preview(input),
      workbench: (input) => molecular.workbench(input)
    },
    sequence: {
      preview: (input) => sequence.preview(input),
      selectRegion: (input) => sequence.selectRegion(input),
      search: (input) => sequence.search(input)
    },
    omics: {
      preview: (input) => omics.preview(input),
      selectDataset: (input) => omics.selectDataset(input)
    },
    bioimaging: {
      preview: (input) => bioimaging.preview(input),
      decodeTile: (input) => bioimaging.decodeTile(input),
      decodeThumbnail: (input) => bioimaging.decodeThumbnail(input),
      selectRegion: (input) => bioimaging.selectRegion(input),
      selectChannels: (input) => bioimaging.selectChannels(input),
      annotateRegion: (input) => bioimaging.annotateRegion(input),
      exportRoiSet: (input) => bioimaging.exportRoiSet(input)
    },
    spectra: {
      preview: (input) => spectra.preview(input),
      selectPeaksByRange: (input) => spectra.selectPeaksByRange(input),
      annotateRange: (input) => spectra.annotateRange(input),
      exportPeakList: (input) => spectra.exportPeakList(input)
    }
  }
}
