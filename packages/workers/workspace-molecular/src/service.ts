import {
  workspaceMolecularDistanceMeasurementInputSchema,
  workspaceMolecularPreviewInputSchema,
  workspaceMolecularSelectionInputSchema,
  type WorkspaceMolecularDistanceMeasurementInput,
  type WorkspaceMolecularDistanceMeasurementResult,
  type WorkspaceMolecularPreviewInput,
  type WorkspaceMolecularPreviewResult,
  type WorkspaceMolecularSelectionInput,
  type WorkspaceMolecularSelectionResult
} from './contract.js'
import {
  createWorkspaceMolecularPreview,
  measureWorkspaceMolecularDistance,
  selectWorkspaceMolecular
} from './workspace-molecular-engine.js'

export class WorkspaceMolecularService {
  preview(input: WorkspaceMolecularPreviewInput): WorkspaceMolecularPreviewResult {
    const normalizedInput = workspaceMolecularPreviewInputSchema.parse(input)
    return createWorkspaceMolecularPreview(normalizedInput)
  }

  select(input: WorkspaceMolecularSelectionInput): WorkspaceMolecularSelectionResult {
    return selectWorkspaceMolecular(workspaceMolecularSelectionInputSchema.parse(input))
  }

  measureDistance(input: WorkspaceMolecularDistanceMeasurementInput): WorkspaceMolecularDistanceMeasurementResult {
    return measureWorkspaceMolecularDistance(workspaceMolecularDistanceMeasurementInputSchema.parse(input))
  }
}

export function createWorkspaceMolecularService(): WorkspaceMolecularService {
  return new WorkspaceMolecularService()
}
