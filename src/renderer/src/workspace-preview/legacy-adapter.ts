import type {
  WorkspaceFileReadResult,
  WorkspaceHtmlPreviewResult,
  WorkspaceImageReadResult
} from '@shared/workspace-file'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS,
  fileNameFromPreviewPath,
  workspaceObservationSchema,
  type WorkspaceObservation,
  type WorkspacePreviewModality,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import {
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID
} from './registry'

export type LegacyWorkspacePreviewAdapterInput = {
  result: WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult
  workspaceRoot?: string
  selectionOverride?: WorkspaceStructuredSelection
  annotations?: WorkspaceObservation['annotations']
}

export function createLegacyWorkspaceObservation(
  input: LegacyWorkspacePreviewAdapterInput
): WorkspaceObservation | null {
  if (!input.result.ok) return null
  const route = legacyRouteForResult(input.result)
  const path = input.result.path

  return workspaceObservationSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      ...('mimeType' in input.result && input.result.mimeType ? { mimeType: input.result.mimeType } : {}),
      ...('size' in input.result ? { size: input.result.size } : {}),
      ...('mtimeMs' in input.result ? { mtimeMs: input.result.mtimeMs } : {})
    },
    view: {
      pluginId: route.pluginId,
      modality: route.modality,
      mode: 'preview',
      title: fileNameFromPreviewPath(path)
    },
    ...(input.selectionOverride ? { selection: input.selectionOverride } : legacySelectionForResult(input.result)),
    ...legacyVisibleTextForResult(input.result),
    ...legacyOutlineForResult(input.result),
    ...legacyAnnotationsForInput(input),
    actions: legacyActionsForResult(input.result, route.pluginId)
  })
}

function legacyRouteForResult(
  result: Extract<WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult, { ok: true }>
): { pluginId: string; modality: WorkspacePreviewModality } {
  if ('dataUrl' in result) {
    return { pluginId: IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'image' }
  }
  if ('url' in result) {
    return { pluginId: HTML_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'document' }
  }
  if (result.kind === 'pdf') {
    return { pluginId: PDF_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'document' }
  }
  if (result.kind === 'docx') {
    return { pluginId: DOCX_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'document' }
  }
  if (isMarkdownPath(result.path)) {
    return { pluginId: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'document' }
  }
  if (isHtmlPath(result.path)) {
    return { pluginId: HTML_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'document' }
  }
  return { pluginId: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID, modality: 'text' }
}

function legacyVisibleTextForResult(
  result: Extract<WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult, { ok: true }>
): Pick<WorkspaceObservation, 'visibleText'> {
  if ('content' in result && result.content) {
    return { visibleText: result.content.slice(0, WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS) }
  }
  if ('url' in result) {
    return { visibleText: `HTML preview URL: ${result.url}` }
  }
  return {}
}

function legacyOutlineForResult(
  result: Extract<WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult, { ok: true }>
): Pick<WorkspaceObservation, 'outline'> {
  if (!('kind' in result) || result.kind !== 'docx') return {}
  const outline = result.paragraphs
    .filter((paragraph) => paragraph.text.trim())
    .slice(0, 1000)
    .map((paragraph) => ({
      id: paragraph.id,
      title: paragraph.text.trim().slice(0, 512),
      level: headingLevelFromDocxStyle(paragraph.style),
      page: undefined
    }))
  return outline.length ? { outline } : {}
}

function legacySelectionForResult(
  result: Extract<WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult, { ok: true }>
): Pick<WorkspaceObservation, 'selection'> {
  if (!('line' in result) || !result.line || !result.column) return {}
  return {
    selection: {
      kind: 'text',
      ranges: [{
        startLine: result.line,
        startColumn: result.column,
        endLine: result.line,
        endColumn: result.column
      }]
    }
  }
}

function legacyAnnotationsForInput(
  input: LegacyWorkspacePreviewAdapterInput
): Pick<WorkspaceObservation, 'annotations'> {
  const annotations = input.annotations?.slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
  return annotations?.length ? { annotations } : {}
}

function legacyActionsForResult(
  result: Extract<WorkspaceFileReadResult | WorkspaceImageReadResult | WorkspaceHtmlPreviewResult, { ok: true }>,
  pluginId: string
): string[] {
  const actions = ['observe']
  if ('kind' in result && (result.kind === 'text' || result.kind === 'docx' || result.kind === 'pdf')) {
    actions.push('select')
  }
  if ('kind' in result && result.kind === 'text' && !result.truncated) {
    actions.push('applyEdit', 'save')
  }
  if (pluginId === PDF_WORKSPACE_PREVIEW_PLUGIN_ID || pluginId === DOCX_WORKSPACE_PREVIEW_PLUGIN_ID) {
    actions.push('annotation.upsert')
  }
  if (pluginId === MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID) actions.push('export:html')
  return [...new Set(actions)]
}

function headingLevelFromDocxStyle(style: string | undefined): number | undefined {
  if (!style) return undefined
  const match = /heading\s*(\d+)/i.exec(style)
  const level = match?.[1] ? Number.parseInt(match[1], 10) : undefined
  return level && level >= 1 && level <= 12 ? level : undefined
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path)
}

function isHtmlPath(path: string): boolean {
  return /\.(html|htm)$/i.test(path)
}
