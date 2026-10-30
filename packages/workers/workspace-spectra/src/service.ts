import {
  type WorkspaceSpectraAnnotateRangeInput,
  type WorkspaceSpectraAnnotateRangeResult,
  type WorkspaceSpectraExportPeakListInput,
  type WorkspaceSpectraExportPeakListResult,
  workspaceSpectraSelectPeaksByRangeInputSchema,
  workspaceSpectraPreviewInputSchema,
  type WorkspaceSpectraPreviewInput,
  type WorkspaceSpectraPreviewResult,
  type WorkspaceSpectraPeakSelectionResult,
  type WorkspaceSpectraSelectPeaksByRangeInput
} from './contract.js'
import { annotateRange, createWorkspaceSpectraPreview, exportPeakList, selectPeaksByRange } from './workspace-spectra-engine.js'

export class WorkspaceSpectraService {
  preview(input: WorkspaceSpectraPreviewInput): WorkspaceSpectraPreviewResult {
    return createWorkspaceSpectraPreview(workspaceSpectraPreviewInputSchema.parse(input))
  }

  annotateRange(input: WorkspaceSpectraAnnotateRangeInput): WorkspaceSpectraAnnotateRangeResult {
    return annotateRange(input)
  }

  selectPeaksByRange(input: WorkspaceSpectraSelectPeaksByRangeInput): WorkspaceSpectraPeakSelectionResult {
    return selectPeaksByRange(workspaceSpectraSelectPeaksByRangeInputSchema.parse(input))
  }

  exportPeakList(input: WorkspaceSpectraExportPeakListInput): WorkspaceSpectraExportPeakListResult {
    return exportPeakList(input)
  }
}

export function createWorkspaceSpectraService(): WorkspaceSpectraService {
  return new WorkspaceSpectraService()
}
