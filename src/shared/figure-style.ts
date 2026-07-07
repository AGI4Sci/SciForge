export type * from '../../packages/workers/scientific-plotting/src/types'

import type {
  FigureStyleApplyPlan,
  FigureStyleExtractDiagnostics,
  FigureStyleExtractResult,
  FigureStyleSourceType,
  FigureStyleSpec,
  ScientificPlottingPrepareReferenceRequest,
  ScientificPlottingPrepareReferenceResult
} from '../../packages/workers/scientific-plotting/src/types'

export type FigureStyleExtractReferenceRequest =
  ScientificPlottingPrepareReferenceRequest & {
    notes?: string
  }

export type FigureStyleExtractReferenceResult =
  | {
      ok: true
      sourcePath: string
      sourceType: 'image'
      preparedReference?: Extract<ScientificPlottingPrepareReferenceResult, { ok: true }>
      extraction: Extract<FigureStyleExtractResult, { ok: true }>
    }
  | {
      ok: false
      message: string
      sourcePath?: string
      sourceType?: FigureStyleSourceType
      preparedReference?: ScientificPlottingPrepareReferenceResult
      extraction?: FigureStyleExtractResult
    }

export type FigureStyleSaveSpecRequest = {
  workspaceRoot: string
  path?: string
  spec: FigureStyleSpec
  applyPlan: FigureStyleApplyPlan
  diagnostics: FigureStyleExtractDiagnostics
}

export type FigureStyleSaveSpecResult =
  | {
      ok: true
      path: string
      savedAt: string
    }
  | { ok: false; message: string }
