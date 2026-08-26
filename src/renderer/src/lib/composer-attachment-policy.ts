const IMAGE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp'
] as const

const SCIENTIFIC_ATTACHMENT_EXTENSION_VALUES = [
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

export const COMPOSER_ATTACHMENT_ACCEPT = [
  ...IMAGE_ATTACHMENT_MIME_TYPES,
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

export type ComposerPickedAttachmentKind = 'pdf' | 'scientific' | 'image' | 'web-document' | 'unsupported'

export type ComposerWebDocumentMetadata = Readonly<{
  kind: 'file' | 'text'
  mimeType: 'multipart/related' | 'text/html'
}>

function fileExtension(name: string): string {
  const normalized = name.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
  const separator = normalized.lastIndexOf('.')
  return separator >= 0 ? normalized.slice(separator) : ''
}

export function composerWebDocumentMetadata(
  file: Pick<File, 'name'> & Partial<Pick<File, 'type'>>
): ComposerWebDocumentMetadata | null {
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

export function composerPickedAttachmentKind(
  file: Pick<File, 'name' | 'type'>
): ComposerPickedAttachmentKind {
  const extension = fileExtension(file.name)
  if (file.type.trim().toLowerCase() === 'application/pdf' || extension === '.pdf') return 'pdf'
  if (SCIENTIFIC_ATTACHMENT_EXTENSIONS.has(extension)) return 'scientific'
  if (file.type.trim().toLowerCase().startsWith('image/')) return 'image'
  if (composerWebDocumentMetadata(file)) return 'web-document'
  return 'unsupported'
}
