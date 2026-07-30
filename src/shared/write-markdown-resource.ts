import {
  normalizeSafeEmbeddedMediaUrl,
  normalizeSafeExternalUrl
} from './external-url-policy'

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function dirnamePortable(filePath: string): string {
  const normalized = normalizePath(filePath)
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return ''
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

function normalizeJoinedPath(pathname: string): string {
  const normalized = normalizePath(pathname)
  const prefix = normalized.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of normalized.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${prefix}${parts.join('/')}`
}

function decodePathname(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function isExplicitWriteResourceUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

export function resolveWriteMarkdownResource(
  src: string | undefined,
  filePath?: string | null
): string | undefined {
  const resolvedPath = resolveWriteMarkdownResourcePath(src, filePath)
  if (resolvedPath) return undefined
  if (!src?.trim()) return src
  return normalizeSafeEmbeddedMediaUrl(src) ?? undefined
}

export function resolveWriteMarkdownLinkResource(href: string | undefined): string | undefined {
  if (!href?.trim()) return href
  const value = href.trim()
  if (!isExplicitWriteResourceUrl(value)) return href
  return normalizeSafeExternalUrl(value) ?? undefined
}

export function transformWriteMarkdownMediaUrl(src: string): string {
  const value = src.trim()
  if (!value) return ''
  if (!isExplicitWriteResourceUrl(value)) return src
  return normalizeSafeEmbeddedMediaUrl(src) ?? ''
}

export function transformWriteMarkdownLinkUrl(href: string): string {
  return resolveWriteMarkdownLinkResource(href) ?? ''
}

export function resolveWriteMarkdownResourcePath(
  src: string | undefined,
  filePath?: string | null
): string | undefined {
  if (!src?.trim() || !filePath) return undefined
  const value = src.trim()
  if (isExplicitWriteResourceUrl(value) || value.startsWith('#')) return undefined
  const [pathname, suffix = ''] = value.split(/([?#].*)/, 2)
  const baseDir = dirnamePortable(filePath)
  if (!baseDir || suffix) return undefined
  const decodedPathname = decodePathname(pathname)
  const resolved = decodedPathname.startsWith('/')
    ? normalizeJoinedPath(decodedPathname)
    : normalizeJoinedPath(`${baseDir}/${decodedPathname}`)
  return resolved
}

export function resolveWriteMarkdownWorkspaceLinkPath(
  href: string | undefined,
  filePath?: string | null,
  workspaceRoot?: string | null
): string | undefined {
  const resolved = resolveWriteMarkdownResourcePath(href, filePath)
  const root = workspaceRoot?.trim()
  if (!resolved || !root) return undefined
  const normalizedRoot = normalizeJoinedPath(root)
  return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}/`)
    ? resolved
    : undefined
}
