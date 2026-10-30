const MAX_PDF_TITLE_LENGTH = 180
const WINDOWS_RESERVED_FILE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

export type PdfRenameContext = {
  sourceText?: string
  publicationDate?: unknown
  fallbackDate?: Date | number | string
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

function yearMonthFromText(value: string): string | null {
  const text = value.normalize('NFKC')
  const separated = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/u)
  if (separated) return `${separated[1]}${separated[2].padStart(2, '0')}`
  const compact = text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])\b/u)
  if (compact) return `${compact[1]}${compact[2]}`
  const arxiv = text.match(/\b(?:19|20)?(\d{2})(\d{2})\.\d{4,5}(?:v\d+)?\b/iu)
  if (!arxiv) return null
  const year = Number(arxiv[1])
  const month = Number(arxiv[2])
  return month >= 1 && month <= 12 ? `${year >= 90 ? 19 : 20}${arxiv[1]}${arxiv[2]}` : null
}

function yearMonthFromDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null
  if (typeof value === 'string') {
    const pdfDate = value.match(/(?:D:)?((?:19|20)\d{2})(0[1-9]|1[0-2])/u)
    if (pdfDate) return `${pdfDate[1]}${pdfDate[2]}`
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function publicationStatus(sourceText: string): string | null {
  const venuePatterns: Array<[RegExp, string]> = [
    // Life-science and biomedical journals. More specific sub-journals must
    // precede their parent titles so the generated prefix keeps that detail.
    [/\bnature\s+biotechnology\b/iu, 'Nature-Biotechnology'],
    [/\bnature\s+methods\b/iu, 'Nature-Methods'],
    [/\bnature\s+genetics\b/iu, 'Nature-Genetics'],
    [/\bnature\s+medicine\b/iu, 'Nature-Medicine'],
    [/\bnature\s+neuroscience\b/iu, 'Nature-Neuroscience'],
    [/\bnature\s+cell biology\b/iu, 'Nature-Cell-Biology'],
    [/\bnature\s+biomedical engineering\b/iu, 'Nature-Biomedical-Engineering'],
    [/\bnature\s+catalysis\b/iu, 'Nature-Catalysis'],
    [/\bnature\s+chemistry\b/iu, 'Nature-Chemistry'],
    [/\bnature\s+physics\b/iu, 'Nature-Physics'],
    [/\bnature\s+plants\b/iu, 'Nature-Plants'],
    [/\bnature\s+ecology\s*&\s*evolution\b/iu, 'Nature-Ecology-and-Evolution'],
    [/\bnature\s+machine intelligence\b/iu, 'Nature-Machine-Intelligence'],
    [/\bnature\s+communications\b/iu, 'Nature-Communications'],
    [/\bnature\s+microbiology\b/iu, 'Nature-Microbiology'],
    [/\bnature\s+structural\s*&\s*molecular biology\b/iu, 'Nature-Structural-and-Molecular-Biology'],
    [/\b(?:nature)\b/iu, 'Nature'],
    [/\bcell systems\b/iu, 'Cell-Systems'],
    [/\bcell reports\b/iu, 'Cell-Reports'],
    [/\bmolecular cell\b/iu, 'Molecular-Cell'],
    [/\bcancer cell\b/iu, 'Cancer-Cell'],
    [/\bimmunity\b/iu, 'Immunity'],
    [/\bneuron\b/iu, 'Neuron'],
    [/\bdevelopmental cell\b/iu, 'Developmental-Cell'],
    [/\btrends in (?:cell biology|biochemical sciences|genetics|cancer|immunology)\b/iu, 'Trends'],
    [/\bcell\b/iu, 'Cell'],
    [/\bscience advances\b/iu, 'Science-Advances'],
    [/\bscience translational medicine\b/iu, 'Science-Translational-Medicine'],
    [/\bscience\b/iu, 'Science'],
    [/\b(?:proceedings of the national academy of sciences|pnas)\b/iu, 'PNAS'],
    [/\bgenome biology\b/iu, 'Genome-Biology'],
    [/\bgenome research\b/iu, 'Genome-Research'],
    [/\bnucleic acids research\b/iu, 'Nucleic-Acids-Research'],
    [/\b(?:molecular biology and evolution|mbe)\b/iu, 'Molecular-Biology-and-Evolution'],
    [/\b(?:the embo journal|embo journal)\b/iu, 'EMBO-Journal'],
    [/\bembo reports\b/iu, 'EMBO-Reports'],
    [/\belife\b/iu, 'eLife'],
    [/\b(?:annual review of .*|annual reviews?)\b/iu, 'Annual-Review'],
    [/\bnew england journal of medicine\b/iu, 'NEJM'],
    [/\b(?:the lancet|lancet)\b/iu, 'Lancet'],
    [/\b(?:jama|journal of the american medical association)\b/iu, 'JAMA'],
    [/\bbmj\b/iu, 'BMJ'],
    [/\b(?:journal of clinical investigation|jci)\b/iu, 'JCI'],
    [/\bblood\b/iu, 'Blood'],
    [/\bcirculation\b/iu, 'Circulation'],
    [/\b(?:international conference on machine learning|icml)\b/iu, 'ICML'],
    [/\b(?:international conference on learning representations|iclr)\b/iu, 'ICLR'],
    [/\b(?:neurips|nips|neurips)\b/iu, 'NeurIPS'],
    [/\b(?:aaai)\b/iu, 'AAAI'],
    [/\b(?:ijcai)\b/iu, 'IJCAI'],
    [/\b(?:acl)\b/iu, 'ACL'],
    [/\b(?:emnlp)\b/iu, 'EMNLP'],
    [/\b(?:cvpr)\b/iu, 'CVPR'],
    [/\b(?:eccv)\b/iu, 'ECCV'],
    [/\b(?:iccv)\b/iu, 'ICCV'],
    [/\b(?:kdd)\b/iu, 'KDD'],
    [/\b(?:sigmod)\b/iu, 'SIGMOD'],
    [/\b(?:arxiv|ar\s*-?\s*xiv|preprint)\b/iu, 'Arxiv']
  ]
  const explicitVenue = venuePatterns.find(([pattern]) => pattern.test(sourceText))?.[1]
  if (explicitVenue) return explicitVenue
  if (/\b(?:19|20)?\d{2}\d{2}\.\d{4,5}(?:v\d+)?\b/iu.test(sourceText)) return 'Arxiv'
  return null
}

export function pdfPublicationPrefix(context: PdfRenameContext = {}): string {
  const sourceText = context.sourceText ?? ''
  const yearMonth = yearMonthFromText(sourceText) ??
    yearMonthFromDate(context.publicationDate) ??
    yearMonthFromDate(context.fallbackDate) ??
    yearMonthFromDate(new Date())!
  const status = publicationStatus(sourceText)
  return status ? `${yearMonth}-${status}` : yearMonth
}

export function sanitizePdfTitleFileName(title: string): string {
  const cleaned = normalizeTitle(title)
    .replace(/[\\/]+/gu, ' - ')
    .replace(/[:*?"<>|]+/gu, ' - ')
    .replace(/\s+-\s+(?:-\s+)+/gu, ' - ')
    .replace(/\s+/gu, ' ')
    .replace(/(?:\s+-)?[. ]+$/gu, '')
    .trim()
  const truncated = [...cleaned].slice(0, MAX_PDF_TITLE_LENGTH).join('').replace(/(?:\s+-)?[. ]+$/gu, '')
  return WINDOWS_RESERVED_FILE_STEM.test(truncated) ? `${truncated} paper` : (truncated || 'paper')
}

export function pdfTitleFileName(title: string, context?: PdfRenameContext): string {
  const stem = sanitizePdfTitleFileName(title)
  return `${context ? `${pdfPublicationPrefix(context)}-` : ''}${stem}.pdf`
}
