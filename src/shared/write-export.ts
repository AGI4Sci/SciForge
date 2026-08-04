import type { AgentRuntimeId } from './agent-runtime-contract'

export const WRITE_EXPORT_FORMATS = ['html', 'pdf', 'doc', 'docx', 'tex'] as const

export type WriteExportFormat = (typeof WRITE_EXPORT_FORMATS)[number]

export type WriteExportPayload = {
  path: string
  workspaceRoot?: string
  format: WriteExportFormat
  content: string
  runtimeId?: AgentRuntimeId
  threadId?: string
  overrideConfirmed?: boolean
}

export type WriteExportResult =
  | {
      ok: true
      path: string
      format: WriteExportFormat
      exportedAt: string
    }
  | {
      ok: false
      canceled: true
      message?: string
    }
  | {
      ok: false
      canceled: false
      message: string
    }
