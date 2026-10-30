import { join } from 'node:path'
import type { WorkspaceFileTarget } from '../../shared/workspace-file'
import { getWriteAssistService, resetWriteAssistService } from './write-assist-worker-service'

export type WritePdfTextPage = {
  page: number
  text: string
  charStart: number
  charEnd: number
}

export type WritePdfTextResult =
  | {
      ok: true
      path: string
      size: number
      mtimeMs: number
      pageCount: number
      pages: WritePdfTextPage[]
      hasText: boolean
      truncated: boolean
    }
  | {
      ok: false
      message: string
    }

export async function readWritePdfText(payload: WorkspaceFileTarget): Promise<WritePdfTextResult> {
  const result = await getWriteAssistService().extractPdfText({
    workspaceRoot: payload.workspaceRoot,
    path: payload.path
  })

  if (!result.ok) {
    return {
      ok: false,
      message: result.error.reason
    }
  }

  return {
    ok: true,
    path: join(result.workspaceRoot, result.relativePath),
    size: result.size,
    mtimeMs: result.mtimeMs,
    pageCount: result.pageCount,
    pages: result.pages.map((page) => ({
      page: page.page,
      text: page.text ?? '',
      charStart: page.charStart,
      charEnd: page.charEnd
    })),
    hasText: result.hasText,
    truncated: result.truncated
  }
}

export function clearWritePdfTextCache(): void {
  resetWriteAssistService()
}
