import {
  workspaceMolecularPreviewInputSchema,
  workspaceMolecularWorkbenchInputSchema,
  type WorkspaceMolecularPreviewInput,
  type WorkspaceMolecularPreviewResult,
  type WorkspaceMolecularWorkbenchInput,
  type WorkspaceMolecularWorkbenchResult
} from './contract.js'
import {
  createWorkspaceMolecularPreview,
  updateWorkspaceMolecularWorkbench
} from './workspace-molecular-engine.js'

export class WorkspaceMolecularService {
  preview(input: WorkspaceMolecularPreviewInput): WorkspaceMolecularPreviewResult {
    const normalizedInput = workspaceMolecularPreviewInputSchema.parse(input)
    return createWorkspaceMolecularPreview(normalizedInput)
  }

  workbench(input: WorkspaceMolecularWorkbenchInput): WorkspaceMolecularWorkbenchResult {
    return updateWorkspaceMolecularWorkbench(workspaceMolecularWorkbenchInputSchema.parse(input))
  }
}

export function createWorkspaceMolecularService(): WorkspaceMolecularService {
  return new WorkspaceMolecularService()
}
