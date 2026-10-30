import {
  workspaceSequenceRegionSelectionInputSchema,
  workspaceSequencePreviewInputSchema,
  workspaceSequenceSearchInputSchema,
  type WorkspaceSequencePreviewInput,
  type WorkspaceSequencePreviewResult,
  type WorkspaceSequenceRegionSelectionInput,
  type WorkspaceSequenceRegionSelectionResult,
  type WorkspaceSequenceSearchInput,
  type WorkspaceSequenceSearchResult
} from './contract.js'
import {
  createWorkspaceSequencePreview,
  searchWorkspaceSequencePreview,
  selectWorkspaceSequenceRegion
} from './workspace-sequence-engine.js'

export class WorkspaceSequenceService {
  preview(input: WorkspaceSequencePreviewInput): WorkspaceSequencePreviewResult {
    return createWorkspaceSequencePreview(workspaceSequencePreviewInputSchema.parse(input))
  }

  selectRegion(input: WorkspaceSequenceRegionSelectionInput): WorkspaceSequenceRegionSelectionResult {
    return selectWorkspaceSequenceRegion(workspaceSequenceRegionSelectionInputSchema.parse(input))
  }

  search(input: WorkspaceSequenceSearchInput): WorkspaceSequenceSearchResult {
    return searchWorkspaceSequencePreview(workspaceSequenceSearchInputSchema.parse(input))
  }
}

export function createWorkspaceSequenceService(): WorkspaceSequenceService {
  return new WorkspaceSequenceService()
}
