import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { getDocument, type TextContentItem } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {
  WorkspacePdfRenameSuggestionPayload,
  WorkspacePdfRenameSuggestionResult
} from '../../shared/workspace-file'
import { resolveTargetPathWithinWorkspace } from '@sciforge/domain-sdk/node/workspace-paths'

const MAX_PDF_RENAME_BYTES = 64 * 1024 * 1024
const MAX_PDF_TITLE_LENGTH = 180
const WINDOWS_RESERVED_FILE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

type PositionedText = {
  text: string
  x: number
  y: number
  fontSize: number
}

type TextLine = {
  text: string
  y: number
  fontSize: number
}

function stringMetadataValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeTitle(value: string): string {
  const withoutControlCharacters = [...value.normalize('NFKC')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127 || /\p{Cf}/u.test(character) ? ' ' : character
    })
    .join('')
  return withoutControlCharacters
    .replace(/\s+/gu, ' ')
    .replace(/\.pdf$/iu, '')
    .trim()
}

export function usablePdfTitle(value: string, currentName = ''): string | null {
  const title = normalizeTitle(value)
  if (title.length < 6) return null
  const comparable = title.toLocaleLowerCase()
  const currentStem = currentName.replace(/\.pdf$/iu, '').trim().toLocaleLowerCase()
  if (currentStem && comparable === currentStem) return null
  if (/^(untitled|document|microsoft word|pdf|article|paper|arxiv)$/iu.test(title)) return null
  if (/^\d{4}\.\d{4,5}(v\d+)?$/iu.test(title)) return null
  return title
}

export function pdfTitleFileName(title: string): string {
  const cleaned = normalizeTitle(title)
    .replace(/[\\/]+/gu, ' - ')
    .replace(/[:*?"<>|]+/gu, ' - ')
    .replace(/\s+-\s+(?:-\s+)+/gu, ' - ')
    .replace(/\s+/gu, ' ')
    .replace(/(?:\s+-)?[. ]+$/gu, '')
    .trim()
  const truncated = [...cleaned].slice(0, MAX_PDF_TITLE_LENGTH).join('').replace(/(?:\s+-)?[. ]+$/gu, '')
  const portableStem = WINDOWS_RESERVED_FILE_STEM.test(truncated) ? `${truncated} paper` : truncated
  return `${portableStem || 'paper'}.pdf`
}

function positionedText(item: TextContentItem): PositionedText | null {
  const text = normalizeTitle(item.str ?? '')
  const transform = item.transform
  if (!text || !transform || transform.length < 6) return null
  const fontSize = Math.max(
    Math.abs(transform[0] ?? 0),
    Math.abs(transform[3] ?? 0),
    Math.abs(item.height ?? 0)
  )
  if (!Number.isFinite(fontSize) || fontSize <= 0) return null
  return {
    text,
    x: transform[4] ?? 0,
    y: transform[5] ?? 0,
    fontSize
  }
}

function textLines(items: TextContentItem[]): TextLine[] {
  const positioned = items.map(positionedText).filter((item): item is PositionedText => Boolean(item))
    .sort((left, right) => right.y - left.y || left.x - right.x)
  const lines: Array<{ items: PositionedText[]; y: number }> = []
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, item.fontSize * 0.18))
    if (line) {
      line.items.push(item)
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length
    } else {
      lines.push({ items: [item], y: item.y })
    }
  }
  return lines
    .map((line) => {
      const ordered = [...line.items].sort((left, right) => left.x - right.x)
      return {
        text: normalizeTitle(ordered.map((item) => item.text).join(' ')),
        y: line.y,
        fontSize: Math.max(...ordered.map((item) => item.fontSize))
      }
    })
    .sort((left, right) => right.y - left.y)
}

function titleLikeLine(line: TextLine): boolean {
  if (line.text.length < 4) return false
  return !(
    /^(arxiv|preprint|doi\b|https?:|www\.|proceedings\b|journal\b|volume\b|vol\.)/iu.test(line.text) ||
    /(?:@|©|all rights reserved)/iu.test(line.text)
  )
}

export function inferPdfTitleFromFirstPage(items: TextContentItem[], pageHeight: number): string | null {
  const candidates = textLines(items)
    .filter((line) => line.y >= pageHeight * 0.42)
    .filter(titleLikeLine)
  if (candidates.length === 0) return null
  const largestFont = Math.max(...candidates.map((line) => line.fontSize))
  const titleLines = candidates
    .filter((line) => line.fontSize >= largestFont * 0.82)
    .slice(0, 4)
  if (titleLines.length === 0) return null
  return usablePdfTitle(titleLines.map((line) => line.text).join(' '))
}

export async function suggestWorkspacePdfName(
  payload: WorkspacePdfRenameSuggestionPayload
): Promise<WorkspacePdfRenameSuggestionResult> {
  try {
    const pdfPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    if (extname(pdfPath).toLocaleLowerCase() !== '.pdf') {
      return { ok: false, message: 'Automatic paper naming is only available for PDF files.' }
    }
    const info = await stat(pdfPath)
    if (!info.isFile()) return { ok: false, message: 'The selected PDF is not a file.' }
    if (info.size > MAX_PDF_RENAME_BYTES) {
      return { ok: false, message: 'This PDF is too large to inspect automatically.' }
    }

    const loadingTask = getDocument({
      data: new Uint8Array(await readFile(pdfPath)),
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false
    })
    const pdf = await loadingTask.promise
    try {
      let metadataTitle: string | null = null
      try {
        const metadata = await pdf.getMetadata()
        metadataTitle = usablePdfTitle(
          stringMetadataValue(metadata.info?.['Title']) ||
            stringMetadataValue(metadata.metadata?.get?.('dc:title')),
          payload.path.split(/[\\/]/u).at(-1) ?? ''
        )
      } catch {
        metadataTitle = null
      }
      if (metadataTitle) {
        return {
          ok: true,
          title: metadataTitle,
          suggestedName: pdfTitleFileName(metadataTitle),
          source: 'metadata'
        }
      }

      const firstPage = await pdf.getPage(1)
      try {
        const viewport = firstPage.getViewport({ scale: 1 })
        const content = await firstPage.getTextContent()
        const inferredTitle = inferPdfTitleFromFirstPage(content.items, viewport.height)
        if (!inferredTitle) {
          return { ok: false, message: 'No reliable paper title was found in this PDF.' }
        }
        return {
          ok: true,
          title: inferredTitle,
          suggestedName: pdfTitleFileName(inferredTitle),
          source: 'first-page'
        }
      } finally {
        firstPage.cleanup()
      }
    } finally {
      await pdf.destroy().catch(() => undefined)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
