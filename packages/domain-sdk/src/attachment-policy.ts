const IMAGE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp'
] as const

const IMAGE_ATTACHMENT_EXTENSION_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
}

const SCIENTIFIC_ATTACHMENT_EXTENSION_TYPES: Readonly<Record<string, string>> = {
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.parquet': 'application/vnd.apache.parquet', '.md': 'text/markdown', '.markdown': 'text/markdown'
}

const SCIENTIFIC_ATTACHMENT_EXTENSION_VALUES = [
  '.csv',
  '.tsv',
  '.json',
  '.xlsx',
  '.parquet',
  '.txt',
  '.md',
  '.markdown',
  '.fasta',
  '.fa',
  '.faa',
  '.fna',
  '.ffn',
  '.frn',
  '.fastq',
  '.fq',
  '.smi',
  '.smiles',
  '.mol',
  '.mol2',
  '.sdf',
  '.mgf',
  '.pdb',
  '.cif',
  '.gb',
  '.gbk',
  '.gff',
  '.gff3',
  '.gtf',
  '.vcf',
  '.bed',
  '.nwk',
  '.seq'
] as const

const WEB_DOCUMENT_MIME_TYPES = [
  'text/html',
  'multipart/related',
  'application/x-mimearchive'
] as const

const HTML_ATTACHMENT_EXTENSION_VALUES = ['.html', '.htm'] as const
const MHTML_ATTACHMENT_EXTENSION_VALUES = ['.mhtml', '.mht'] as const

export const WORKSPACE_ATTACHMENT_ACCEPT = [
  ...IMAGE_ATTACHMENT_MIME_TYPES,
  ...Object.keys(IMAGE_ATTACHMENT_EXTENSION_TYPES),
  'application/pdf',
  '.pdf',
  ...SCIENTIFIC_ATTACHMENT_EXTENSION_VALUES,
  ...WEB_DOCUMENT_MIME_TYPES,
  ...HTML_ATTACHMENT_EXTENSION_VALUES,
  ...MHTML_ATTACHMENT_EXTENSION_VALUES
].join(',')

const SCIENTIFIC_ATTACHMENT_EXTENSIONS = new Set<string>(SCIENTIFIC_ATTACHMENT_EXTENSION_VALUES)

const HTML_ATTACHMENT_EXTENSIONS = new Set<string>(HTML_ATTACHMENT_EXTENSION_VALUES)
const MHTML_ATTACHMENT_EXTENSIONS = new Set<string>(MHTML_ATTACHMENT_EXTENSION_VALUES)

export type WorkspaceAttachmentKind = 'pdf' | 'scientific' | 'image' | 'web-document' | 'unsupported'

export type WorkspaceWebDocumentMetadata = Readonly<{
  kind: 'file' | 'text'
  mimeType: 'multipart/related' | 'text/html'
}>

function fileExtension(name: string): string {
  const normalized = name.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
  const separator = normalized.lastIndexOf('.')
  return separator >= 0 ? normalized.slice(separator) : ''
}

export function workspaceWebDocumentMetadata(
  file: Readonly<{ name: string; type?: string }>
): WorkspaceWebDocumentMetadata | null {
  const extension = fileExtension(file.name)
  if (HTML_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { kind: 'text', mimeType: 'text/html' }
  }
  if (MHTML_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { kind: 'file', mimeType: 'multipart/related' }
  }
  if (extension) return null
  const mimeType = file.type?.trim().toLowerCase()
  if (mimeType === 'text/html') return { kind: 'text', mimeType: 'text/html' }
  if (mimeType === 'multipart/related' || mimeType === 'application/x-mimearchive') {
    return { kind: 'file', mimeType: 'multipart/related' }
  }
  return null
}

export function workspaceAttachmentKind(
  file: Readonly<{ name: string; type?: string }>
): WorkspaceAttachmentKind {
  const extension = fileExtension(file.name)
  if (file.type?.trim().toLowerCase() === 'application/pdf' || extension === '.pdf') return 'pdf'
  if (SCIENTIFIC_ATTACHMENT_EXTENSIONS.has(extension)) return 'scientific'
  if (IMAGE_ATTACHMENT_EXTENSION_TYPES[extension] || file.type?.trim().toLowerCase().startsWith('image/')) return 'image'
  if (workspaceWebDocumentMetadata(file)) return 'web-document'
  return 'unsupported'
}

/** Largest supported local workspace attachment. Remote workspace transport has separate limits. */
export const WORKSPACE_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024

export function workspaceAttachmentMaxBytes(kind: WorkspaceAttachmentKind): number {
  if (kind === 'scientific') return WORKSPACE_ATTACHMENT_MAX_BYTES
  if (kind === 'image') return 32 * 1024 * 1024
  if (kind === 'pdf' || kind === 'web-document') return 64 * 1024 * 1024
  return 0
}

export function workspaceAttachmentMediaType(file: Readonly<{ name: string; type?: string }>): string {
  const kind = workspaceAttachmentKind(file)
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'web-document') return workspaceWebDocumentMetadata(file)?.mimeType ?? 'application/octet-stream'
  const browserType = file.type?.trim().toLowerCase()
  if (kind === 'image') return IMAGE_ATTACHMENT_EXTENSION_TYPES[fileExtension(file.name)] || browserType || 'image/png'
  if (kind === 'scientific') return SCIENTIFIC_ATTACHMENT_EXTENSION_TYPES[fileExtension(file.name)] ||
    (browserType && !browserType.startsWith('image/') ? browserType : 'text/plain')
  return browserType || 'application/octet-stream'
}

/** User-facing basename for files imported by the canonical Session attachment writer. */
export function workspaceAttachmentDisplayName(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/')
  const basename = normalized.split('/').pop() || relativePath
  if (!/^\.sciforge\/uploads\/[^/]+\//u.test(normalized)) return basename
  return /^\d{8}T\d{6}-[A-Za-z0-9]{8}-(.+)$/u.exec(basename)?.[1] ?? basename
}

/** Canonical Session attachment directory shared by import and workspace consumers. */
export function workspaceAttachmentSessionDirectory(threadId: string | null): string {
  const owner = (threadId ?? 'draft').trim().replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '').slice(0, 80) || 'draft'
  if (owner === '.' || owner === '..') throw new Error('Attachment Session identifier does not resolve to a safe directory.')
  return `.sciforge/uploads/${owner}`
}
