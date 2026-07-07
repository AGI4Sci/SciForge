import type {
  FigureStyleApplyPlan,
  FigureStyleExtractDiagnostics,
  FigureStyleExtractResult,
  FigureStyleSpec
} from './figure-style'

export type FigureStyleCropBoxDraft = {
  x: string
  y: string
  width: string
  height: string
}

export type FigureStyleSpecPayload = {
  spec: FigureStyleSpec
  applyPlan: FigureStyleApplyPlan
  diagnostics: FigureStyleExtractDiagnostics
}

export const DEFAULT_FIGURE_STYLE_CROP_BOX_DRAFT: FigureStyleCropBoxDraft = {
  x: '0',
  y: '0',
  width: '1',
  height: '1'
}

export const FIGURE_STYLE_IMAGE_SOURCE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp'
])

export function fileNameFromFigureStylePath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

export function normalizeFigureStylePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
}

export function extensionFromFigureStylePath(path: string): string {
  const name = fileNameFromFigureStylePath(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function inferFigureStyleSourceType(path: string): 'image' | 'pdf' {
  return extensionFromFigureStylePath(path) === '.pdf' ? 'pdf' : 'image'
}

export function workspaceRelativeFigurePath(filePath: string, workspaceRoot: string): string | null {
  const normalizedFile = normalizeFigureStylePath(filePath)
  if (!normalizedFile) return null
  if (!normalizedFile.startsWith('/') && !/^[A-Za-z]:\//.test(normalizedFile)) return normalizedFile

  const normalizedRoot = normalizeFigureStylePath(workspaceRoot)
  if (!normalizedRoot) return null
  const rootWithSlash = `${normalizedRoot}/`
  const fileForCompare = normalizedFile.toLowerCase()
  const rootForCompare = rootWithSlash.toLowerCase()
  if (!fileForCompare.startsWith(rootForCompare)) return null
  return normalizedFile.slice(rootWithSlash.length)
}

function safeArtifactSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return normalized || fallback
}

export function buildFigureStyleArtifactPath(spec: FigureStyleSpec, now = new Date()): string {
  const stamp = now.toISOString().replace(/[^0-9A-Za-z]+/g, '').slice(0, 15)
  const sourceName = safeArtifactSegment(
    spec.source.figureId || fileNameFromFigureStylePath(spec.source.path).replace(/\.[^.]+$/g, ''),
    'reference-style'
  )
  return `.sciforge/figure-styles/${stamp}-${sourceName}.json`
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

export function normalizeRatioCropBoxDraft(
  draft: FigureStyleCropBoxDraft
): { unit: 'ratio'; x: number; y: number; width: number; height: number } | null {
  const x = clampRatio(Number(draft.x), 0)
  const y = clampRatio(Number(draft.y), 0)
  const maxWidth = Math.max(0.01, 1 - x)
  const maxHeight = Math.max(0.01, 1 - y)
  const width = Math.min(maxWidth, Math.max(0.01, Number(draft.width)))
  const height = Math.min(maxHeight, Math.max(0.01, Number(draft.height)))
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { unit: 'ratio', x, y, width, height }
}

export function figureStyleSpecPayload(
  result: Extract<FigureStyleExtractResult, { ok: true }>
): FigureStyleSpecPayload {
  return {
    spec: result.spec,
    applyPlan: result.applyPlan,
    diagnostics: result.diagnostics
  }
}

export function serializeFigureStyleSpecPayload(payload: FigureStyleSpecPayload): string {
  return `${JSON.stringify({
    spec: payload.spec,
    applyPlan: payload.applyPlan,
    diagnostics: payload.diagnostics
  }, null, 2)}\n`
}
