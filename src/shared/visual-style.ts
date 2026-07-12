export type * from '../../packages/workers/scientific-plotting/src/types'

import type {
  VisualStyleExtractDiagnostics,
  VisualStyleProfile
} from '../../packages/workers/scientific-plotting/src/types'

export type VisualStyleSaveProfileRequest = {
  workspaceRoot: string
  path?: string
  profile: VisualStyleProfile
  diagnostics: VisualStyleExtractDiagnostics
}

export type VisualStyleSaveProfileResult =
  | { ok: true; path: string; savedAt: string }
  | { ok: false; message: string }
