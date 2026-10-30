export type FileReferenceTarget = {
  path: string
  line?: number
  column?: number
  kind?: 'file' | 'directory'
}

export type FileReferenceMatch = {
  start: number
  end: number
  text: string
  target: FileReferenceTarget
}

type HastNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export const FILE_REFERENCE_SCHEME = 'sciforge-file:'
export const LEGACY_FILE_REFERENCE_SCHEME = 'deepseek-file:'
export const FILE_REFERENCE_SCHEMES = [FILE_REFERENCE_SCHEME, LEGACY_FILE_REFERENCE_SCHEME] as const
const PATH_PREFIX_BOUNDARY = String.raw`(?<![\w@.~\/\\-])`

const EXTENSIONS = [
  'avif',
  'astro',
  'bash',
  'bmp',
  'c',
  'csv',
  'cc',
  'cjs',
  'cpp',
  'cs',
  'css',
  'dart',
  'docx?',
  'env',
  'fasta',
  'fa',
  'fish',
  'gif',
  'go',
  'gz',
  'h',
  'hpp',
  'html?',
  'ipynb',
  'ini',
  'java',
  'jpe?g',
  'jsx?',
  'json',
  'jsonl',
  'kt',
  'less',
  'lock',
  'mdx?',
  'mjs',
  'mol2',
  'pdb',
  'pdf',
  'php',
  'png',
  'pptx?',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sdf',
  'sql',
  'svelte',
  'swift',
  'tar',
  'tsv',
  'toml',
  'tsx?',
  'txt',
  'vue',
  'webp',
  'xlsx?',
  'ya?ml',
  'zip',
  'xml',
  'zsh'
].join('|')

const PATH_CHARS = String.raw`[\p{L}\p{N}_@.()+=[\]{} $,;!%#~\/\\-]`
const FILE_NAME_CHARS = String.raw`[\p{L}\p{N}_@()+=[\]{}!%#~-]`
const PATH_END = String.raw`(?=$|[\s(),.;:!?\]\u3001\u3002\uff0c\uff1b\uff1a\uff08\uff09]|#L)`
const EXACT_PATH_CHARS = new RegExp(String.raw`^${PATH_CHARS}+$`, 'u')
const FILE_EXTENSION_AT_END = new RegExp(String.raw`\.(?:${EXTENSIONS})$`, 'iu')
const PATH_WITH_SEPARATOR = new RegExp(
  String.raw`${PATH_PREFIX_BOUNDARY}(?:~|\/|\.{1,2}\/|[A-Za-z]:[\\/]|[\w@.-]+[\\/])${PATH_CHARS}*?\.(?:${EXTENSIONS})${PATH_END}`,
  'giu'
)
const BASENAME_FILE = new RegExp(
  String.raw`${PATH_PREFIX_BOUNDARY}${FILE_NAME_CHARS}+?\.(?:${EXTENSIONS})${PATH_END}`,
  'giu'
)
const DIRECTORY_WITH_SEPARATOR = new RegExp(
  String.raw`${PATH_PREFIX_BOUNDARY}(?:~|\/|\.{1,2}\/|[A-Za-z]:[\\/]|[\p{L}\p{N}_@.-]+[\\/])${PATH_CHARS}*?[\/\\](?=$|[\s),.;:!?\]\u3001\u3002\uff0c\uff1b\uff1a\uff09])`,
  'giu'
)
const LINE_SUFFIX = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L\d+)?|\s*[（(](?:line|lines)\s+(\d+)[）)]|\s*[（(]第\s*(\d+)\s*行[）)]|\s+line\s+(\d+)|\s+第\s*(\d+)\s*行)/iy
const EXACT_LINE_SUFFIX = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L\d+)?|\s*[（(](?:line|lines)\s+(\d+)[）)]|\s*[（(]第\s*(\d+)\s*行[）)]|\s+line\s+(\d+)|\s+第\s*(\d+)\s*行)$/iu
const TRAILING_PUNCTUATION = /[.,;!?，。；：、]+$/
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const BLOCKED_PARENTS = new Set(['a', 'code', 'pre', 'script', 'style', 'textarea'])

function lineFromSuffix(match: RegExpExecArray): { line?: number; column?: number } {
  const lineText = match[1] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7]
  const columnText = match[2]
  const line = lineText ? Number.parseInt(lineText, 10) : undefined
  const column = columnText ? Number.parseInt(columnText, 10) : undefined
  return {
    ...(line && Number.isFinite(line) && line > 0 ? { line } : {}),
    ...(column && Number.isFinite(column) && column > 0 ? { column } : {})
  }
}

function tokenBefore(text: string, index: number): string {
  const prefix = text.slice(0, index)
  const tokenStart = Math.max(
    prefix.lastIndexOf(' '),
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('\t'),
    prefix.lastIndexOf('('),
    prefix.lastIndexOf('['),
    prefix.lastIndexOf('{')
  )
  return prefix.slice(tokenStart + 1)
}

function isProbablyUrl(text: string, index: number): boolean {
  const prefix = text.slice(0, index).trimEnd()
  return tokenBefore(text, index).includes('://') || /[A-Za-z][A-Za-z0-9+.-]*:$/.test(prefix)
}

function trimPathMatch(raw: string, kind: FileReferenceTarget['kind']): string {
  const trimmed = raw.replace(TRAILING_PUNCTUATION, '')
  if (kind === 'directory') return trimmed.replace(/[\\/]+$/g, '')
  return trimmed
}

function collectMatches(
  text: string,
  regex: RegExp,
  requireLineSuffix: boolean,
  kind: FileReferenceTarget['kind']
): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = []
  regex.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const matched = match[0]
    if (!matched || isProbablyUrl(text, match.index)) continue

    const displayText = matched.replace(TRAILING_PUNCTUATION, '')
    const displayEnd = match.index + displayText.length
    const path = trimPathMatch(matched, kind)
    const pathEnd = kind === 'directory' ? displayEnd : match.index + path.length
    LINE_SUFFIX.lastIndex = pathEnd
    const suffix = LINE_SUFFIX.exec(text)
    const lineInfo = suffix ? lineFromSuffix(suffix) : {}
    if (requireLineSuffix && !lineInfo.line) continue

    const end = suffix ? suffix.index + suffix[0].length : pathEnd
    matches.push({
      start: match.index,
      end,
      text: text.slice(match.index, end),
      target: {
        path,
        ...lineInfo,
        ...(kind ? { kind } : {})
      }
    })
  }

  return matches
}

function mergeMatches(matches: FileReferenceMatch[]): FileReferenceMatch[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: FileReferenceMatch[] = []
  let lastEnd = -1
  for (const match of sorted) {
    if (match.start < lastEnd) continue
    merged.push(match)
    lastEnd = match.end
  }
  return merged
}

export function findFileReferences(text: string): FileReferenceMatch[] {
  if (!text.trim()) return []
  return mergeMatches([
    ...collectMatches(text, PATH_WITH_SEPARATOR, false, 'file'),
    ...collectMatches(text, BASENAME_FILE, false, 'file'),
    ...collectMatches(text, DIRECTORY_WITH_SEPARATOR, false, 'directory')
  ])
}

/**
 * Parses a complete inline-code value as a workspace path.
 *
 * Prose linkification stays deliberately conservative because spaces can also
 * separate ordinary words. Inline code already provides an exact boundary, so
 * it can safely support filenames and leading directory segments with spaces,
 * as well as extensionless nested paths. Existence is still checked by the
 * workspace resolver before the reference becomes interactive.
 */
export function parseExactFileReference(text: string): FileReferenceTarget | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes('\n') || URL_SCHEME.test(trimmed)) return null

  const detected = findFileReferences(trimmed)
  if (detected.length === 1 && detected[0].start === 0 && detected[0].end === trimmed.length) {
    return detected[0].target
  }

  const suffix = EXACT_LINE_SUFFIX.exec(trimmed)
  const rawPath = suffix ? trimmed.slice(0, suffix.index) : trimmed
  const hasTrailingSeparator = /[\\/]$/.test(rawPath)
  const path = hasTrailingSeparator ? rawPath.replace(/[\\/]+$/g, '') : rawPath
  const hasPathSeparator = /[\\/]/.test(path)
  const hasKnownFileExtension = FILE_EXTENSION_AT_END.test(path)

  if (
    !path ||
    !EXACT_PATH_CHARS.test(path) ||
    (!hasTrailingSeparator && !hasPathSeparator && !hasKnownFileExtension)
  ) {
    return null
  }

  return {
    path,
    ...(suffix ? lineFromSuffix(suffix) : {}),
    ...(hasTrailingSeparator
      ? { kind: 'directory' as const }
      : hasKnownFileExtension
        ? { kind: 'file' as const }
        : {})
  }
}

export function createFileReferenceHref(target: FileReferenceTarget): string {
  const params = new URLSearchParams({ path: target.path })
  if (target.line) params.set('line', String(target.line))
  if (target.column) params.set('column', String(target.column))
  if (target.kind) params.set('kind', target.kind)
  return `${FILE_REFERENCE_SCHEME}//open?${params.toString()}`
}

export function parseFileReferenceHref(href: string | undefined): FileReferenceTarget | null {
  if (!isFileReferenceHref(href)) return null
  try {
    const url = new URL(href)
    const path = url.searchParams.get('path')?.trim()
    if (!path) return null
    const line = Number.parseInt(url.searchParams.get('line') ?? '', 10)
    const column = Number.parseInt(url.searchParams.get('column') ?? '', 10)
    const kind = url.searchParams.get('kind')
    return {
      path,
      ...(Number.isFinite(line) && line > 0 ? { line } : {}),
      ...(Number.isFinite(column) && column > 0 ? { column } : {}),
      ...(kind === 'file' || kind === 'directory' ? { kind } : {})
    }
  } catch {
    return null
  }
}

export function isFileReferenceHref(href: string | undefined): href is string {
  return typeof href === 'string' && FILE_REFERENCE_SCHEMES.some((scheme) => href.startsWith(scheme))
}

function linkifyTextNode(node: HastNode): HastNode[] {
  const text = node.value ?? ''
  const matches = findFileReferences(text)
  if (matches.length === 0) return [node]

  const next: HastNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      next.push({ type: 'text', value: text.slice(cursor, match.start) })
    }
    next.push({
      type: 'element',
      tagName: 'a',
      properties: {
        href: createFileReferenceHref(match.target),
        className: ['ds-file-reference-link'],
        title: match.target.line
          ? `${match.target.path}:${match.target.line}`
          : match.target.path
      },
      children: [{ type: 'text', value: match.text }]
    })
    cursor = match.end
  }
  if (cursor < text.length) {
    next.push({ type: 'text', value: text.slice(cursor) })
  }
  return next
}

function visit(node: HastNode, blocked: boolean): void {
  const children = node.children
  if (!children?.length) return

  const nextBlocked = blocked || (node.tagName ? BLOCKED_PARENTS.has(node.tagName) : false)
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!nextBlocked && child.type === 'text') {
      const replacement = linkifyTextNode(child)
      if (replacement.length !== 1 || replacement[0] !== child) {
        children.splice(index, 1, ...replacement)
        index += replacement.length - 1
      }
      continue
    }
    visit(child, nextBlocked)
  }
}

export function rehypeFileReferences() {
  return (tree: HastNode): void => visit(tree, false)
}
