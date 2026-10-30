import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { getDocument, type TextContentItem } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {
  WorkspacePdfRenameSuggestionPayload,
  WorkspacePdfRenameSuggestionResult
} from '../../shared/workspace-file'
import { pdfTitleFileName as sharedPdfTitleFileName } from '../../shared/pdf-rename'
import { resolveTargetPathWithinWorkspace } from '@sciforge/domain-sdk/node/workspace-paths'


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

type PdfMetadata = {
  info?: Record<string, unknown>
  metadata?: { get?: (key: string) => unknown } | null
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

export const pdfTitleFileName = sharedPdfTitleFileName

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
    const fileInfo = await stat(pdfPath)
    if (!fileInfo.isFile()) return { ok: false, message: 'The selected PDF is not a file.' }

    const loadingTask = getDocument({
      url: pdfPath,
      disableAutoFetch: true,
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false
    })
    const pdf = await loadingTask.promise
    try {
      let metadataTitle: string | null = null
      let metadata: PdfMetadata | null = null
      try {
        metadata = await pdf.getMetadata() as unknown as PdfMetadata
        metadataTitle = usablePdfTitle(
          stringMetadataValue(metadata.info?.['Title']) ||
            stringMetadataValue(metadata.metadata?.get?.('dc:title')),
          payload.path.split(/[\\/]/u).at(-1) ?? ''
        )
      } catch {
        metadataTitle = null
      }

      let firstPageText = ''
      let inferredTitle: string | null = null
      try {
        const firstPage = await pdf.getPage(1)
        try {
          const viewport = firstPage.getViewport({ scale: 1 })
          const content = await firstPage.getTextContent()
          firstPageText = content.items.map((item) => item.str ?? '').join(' ')
          inferredTitle = inferPdfTitleFromFirstPage(content.items, viewport.height)
        } finally {
          firstPage.cleanup()
        }
      } catch {
        firstPageText = ''
      }

      const info = metadata?.info ?? {}
      const sourceText = [
        payload.path,
        metadataTitle ?? '',
        firstPageText,
        stringMetadataValue(info['Subject']),
        stringMetadataValue(info['Keywords']),
        stringMetadataValue(info['Author'])
      ].filter(Boolean).join('\n')
      const publicationDate = info['PublicationDate'] ?? info['publicationDate'] ?? info['Date'] ?? info['CreationDate']
      const renameContext = {
        sourceText,
        publicationDate,
        fallbackDate: (info['ModDate'] ?? info['CreationDate'] ?? fileInfo.mtimeMs) as string | number
      }
      if (metadataTitle) {
        return {
          ok: true,
          title: metadataTitle,
          suggestedName: pdfTitleFileName(metadataTitle, renameContext),
          source: 'metadata'
        }
      }
      if (!inferredTitle) {
        return { ok: false, message: 'No reliable paper title was found in this PDF.' }
      }
      return {
        ok: true,
        title: inferredTitle,
        suggestedName: pdfTitleFileName(inferredTitle, renameContext),
        source: 'first-page'
      }
    } finally {
      await pdf.destroy().catch(() => undefined)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
