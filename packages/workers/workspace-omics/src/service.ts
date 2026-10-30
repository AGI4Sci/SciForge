import {
  WORKSPACE_OMICS_FORMAT_CAPABILITIES,
  workspaceOmicsDatasetSelectionInputSchema,
  workspaceOmicsPreviewInputSchema,
  type WorkspaceOmicsDatasetSelectionInput,
  type WorkspaceOmicsDatasetSelectionResult,
  type WorkspaceOmicsFormatCapability,
  type WorkspaceOmicsPreviewInput,
  type WorkspaceOmicsPreviewResult
} from './contract.js'
import { createWorkspaceOmicsPreview, selectWorkspaceOmicsDataset } from './workspace-omics-engine.js'

export class WorkspaceOmicsService {
  preview(input: WorkspaceOmicsPreviewInput): WorkspaceOmicsPreviewResult {
    return createWorkspaceOmicsPreview(workspaceOmicsPreviewInputSchema.parse(input))
  }

  selectDataset(input: WorkspaceOmicsDatasetSelectionInput): WorkspaceOmicsDatasetSelectionResult {
    return selectWorkspaceOmicsDataset(workspaceOmicsDatasetSelectionInputSchema.parse(input))
  }

  capabilities(): WorkspaceOmicsFormatCapability[] {
    return WORKSPACE_OMICS_FORMAT_CAPABILITIES.map((capability) => ({
      ...capability,
      extensions: [...capability.extensions]
    }))
  }
}

export function createWorkspaceOmicsService(): WorkspaceOmicsService {
  return new WorkspaceOmicsService()
}
