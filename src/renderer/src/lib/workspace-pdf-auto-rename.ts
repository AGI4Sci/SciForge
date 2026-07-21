import type {
  WorkspaceFileReadResult,
  WorkspacePdfRenameSuggestionResult
} from '@shared/workspace-file'

const MAX_PDF_TITLE_LENGTH = 180
const WINDOWS_RESERVED_FILE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

function normalizePdfTitle(value: string): string {
  const withoutControlCharacters = [...value.normalize('NFKC')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127 || /\p{Cf}/u.test(character) ? ' ' : character
    })
    .join('')
  return withoutControlCharacters.replace(/\s+/gu, ' ').replace(/\.pdf$/iu, '').trim()
}

export function pdfMetadataTitleFileName(title: string): string {
  const cleaned = normalizePdfTitle(title)
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

function usableMetadataTitle(value: string, currentName: string): string | null {
  const title = normalizePdfTitle(value)
  if (title.length < 6) return null
  const currentStem = currentName.replace(/\.pdf$/iu, '').trim().toLocaleLowerCase()
  if (currentStem && title.toLocaleLowerCase() === currentStem) return null
  if (/^(untitled|document|microsoft word|pdf|article|paper|arxiv)$/iu.test(title)) return null
  if (/^\d{4}\.\d{4,5}(v\d+)?$/iu.test(title)) return null
  return title
}

function base64Bytes(value: string): Uint8Array {
  const decoded = globalThis.atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

export async function suggestPdfNameFromWorkspaceRead(
  result: WorkspaceFileReadResult,
  currentName: string
): Promise<WorkspacePdfRenameSuggestionResult> {
  if (!result.ok) return result
  if (result.kind !== 'pdf') {
    return { ok: false, message: 'Automatic paper naming is only available for PDF files.' }
  }
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.load(base64Bytes(result.dataBase64), { ignoreEncryption: true })
    const title = usableMetadataTitle(pdf.getTitle() ?? '', currentName)
    if (!title) {
      return { ok: false, message: 'No reliable paper title was found in this PDF.' }
    }
    return {
      ok: true,
      title,
      suggestedName: pdfMetadataTitleFileName(title),
      source: 'metadata'
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
