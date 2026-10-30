import {
  workspaceTabularDeleteColumnsInputSchema,
  workspaceTabularDeleteRowsInputSchema,
  workspaceTabularInsertColumnsInputSchema,
  workspaceTabularPreviewInputSchema,
  workspaceTabularXlsxPreviewInputSchema,
  type WorkspaceTabularDeleteColumnsInput,
  type WorkspaceTabularDeleteRowsInput,
  type WorkspaceTabularInsertColumnsInput,
  type WorkspaceTabularInsertRowsInput,
  type WorkspaceTabularPreviewInput,
  type WorkspaceTabularPreviewResult,
  type WorkspaceTabularQueryInput,
  type WorkspaceTabularQueryResult,
  type WorkspaceTabularSelectionSummary,
  type WorkspaceTabularSelectionSummaryInput,
  type WorkspaceTabularUpdateCellInput,
  type WorkspaceTabularXlsxPreviewInput
} from './contract.js'
import {
  createWorkspaceTabularPreview,
  createWorkspaceTabularXlsxPreview,
  deleteWorkspaceTabularColumns,
  deleteWorkspaceTabularRows,
  insertWorkspaceTabularColumns,
  insertWorkspaceTabularRows,
  queryWorkspaceTabularPreviewRows,
  summarizeWorkspaceTabularSelection,
  updateWorkspaceTabularCell
} from './workspace-tabular-engine.js'

export class WorkspaceTabularService {
  preview(input: WorkspaceTabularPreviewInput): WorkspaceTabularPreviewResult {
    return createWorkspaceTabularPreview(workspaceTabularPreviewInputSchema.parse(input))
  }

  previewXlsx(input: WorkspaceTabularXlsxPreviewInput): Promise<WorkspaceTabularPreviewResult> {
    return createWorkspaceTabularXlsxPreview(workspaceTabularXlsxPreviewInputSchema.parse(input))
  }

  updateCell(input: WorkspaceTabularUpdateCellInput): unknown[][] {
    return updateWorkspaceTabularCell(input)
  }

  insertRows(input: WorkspaceTabularInsertRowsInput): unknown[][] {
    return insertWorkspaceTabularRows(input)
  }

  insertColumns(input: WorkspaceTabularInsertColumnsInput): unknown[][] {
    return insertWorkspaceTabularColumns(workspaceTabularInsertColumnsInputSchema.parse(input))
  }

  deleteRows(input: WorkspaceTabularDeleteRowsInput): unknown[][] {
    return deleteWorkspaceTabularRows(workspaceTabularDeleteRowsInputSchema.parse(input))
  }

  deleteColumns(input: WorkspaceTabularDeleteColumnsInput): unknown[][] {
    return deleteWorkspaceTabularColumns(workspaceTabularDeleteColumnsInputSchema.parse(input))
  }

  queryPreviewRows(input: WorkspaceTabularQueryInput): WorkspaceTabularQueryResult {
    return queryWorkspaceTabularPreviewRows(input)
  }

  summarizeSelection(input: WorkspaceTabularSelectionSummaryInput): WorkspaceTabularSelectionSummary {
    return summarizeWorkspaceTabularSelection(input)
  }
}

export function createWorkspaceTabularService(): WorkspaceTabularService {
  return new WorkspaceTabularService()
}
