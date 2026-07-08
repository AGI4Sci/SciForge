import {
  workspaceDeckPptxPreviewInputSchema,
  workspaceDeckPreviewInputSchema,
  workspaceDeckSlideSelectionInputSchema,
  workspaceDeckTextSelectionInputSchema,
  workspaceDeckPptxTextElementUpdateInputSchema,
  type WorkspaceDeckPptxPreviewInput,
  type WorkspaceDeckPreviewInput,
  type WorkspaceDeckPreviewResult,
  type WorkspaceDeckSlideSelectionInput,
  type WorkspaceDeckSlideSelectionResult,
  type WorkspaceDeckPptxTextElementUpdateInput,
  type WorkspaceDeckPptxTextElementUpdateResult,
  type WorkspaceDeckTextSelectionInput,
  type WorkspaceDeckTextSelectionResult
} from './contract.js'
import {
  createWorkspaceDeckPptxPreview,
  createWorkspaceDeckPreview,
  selectWorkspaceDeckSlide,
  selectWorkspaceDeckText,
  updateWorkspaceDeckPptxTextElement
} from './workspace-deck-engine.js'

export class WorkspaceDeckService {
  preview(input: WorkspaceDeckPreviewInput): WorkspaceDeckPreviewResult {
    return createWorkspaceDeckPreview(workspaceDeckPreviewInputSchema.parse(input))
  }

  previewPptx(input: WorkspaceDeckPptxPreviewInput): Promise<WorkspaceDeckPreviewResult> {
    return createWorkspaceDeckPptxPreview(workspaceDeckPptxPreviewInputSchema.parse(input))
  }

  updatePptxTextElement(input: WorkspaceDeckPptxTextElementUpdateInput): Promise<WorkspaceDeckPptxTextElementUpdateResult> {
    return updateWorkspaceDeckPptxTextElement(workspaceDeckPptxTextElementUpdateInputSchema.parse(input))
  }

  selectSlide(input: WorkspaceDeckSlideSelectionInput): WorkspaceDeckSlideSelectionResult {
    return selectWorkspaceDeckSlide(workspaceDeckSlideSelectionInputSchema.parse(input))
  }

  selectText(input: WorkspaceDeckTextSelectionInput): WorkspaceDeckTextSelectionResult {
    return selectWorkspaceDeckText(workspaceDeckTextSelectionInputSchema.parse(input))
  }
}

export function createWorkspaceDeckService(): WorkspaceDeckService {
  return new WorkspaceDeckService()
}
