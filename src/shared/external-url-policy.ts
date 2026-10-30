export const SAFE_EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const
export const MACOS_SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
export const SAFE_EMBEDDED_MEDIA_PROTOCOLS = ['http:', 'https:', 'data:', 'blob:'] as const
export const SAFE_REMOTE_EMBEDDED_MEDIA_PROTOCOLS = ['http:', 'https:'] as const
export const SAFE_EMBEDDED_MEDIA_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon'
] as const
export const SAFE_EMBEDDED_MEDIA_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico'
] as const

const SAFE_EXTERNAL_PROTOCOL_SET = new Set<string>(SAFE_EXTERNAL_PROTOCOLS)
const SAFE_SYSTEM_SETTINGS_URL_SET = new Set<string>([
  MACOS_SCREEN_RECORDING_SETTINGS_URL
])
const SAFE_EMBEDDED_MEDIA_PROTOCOL_SET = new Set<string>(SAFE_EMBEDDED_MEDIA_PROTOCOLS)
const SAFE_REMOTE_EMBEDDED_MEDIA_PROTOCOL_SET = new Set<string>(SAFE_REMOTE_EMBEDDED_MEDIA_PROTOCOLS)
const SAFE_EMBEDDED_MEDIA_MIME_TYPE_SET = new Set<string>(SAFE_EMBEDDED_MEDIA_MIME_TYPES)

type EmbeddedMediaUrlPolicy = {
  allowedProtocols?: ReadonlySet<string>
  allowedMimeTypes?: ReadonlySet<string>
  requireDataUrlBase64?: boolean
}

export function normalizeSafeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return SAFE_EXTERNAL_PROTOCOL_SET.has(parsed.protocol) ? trimmed : null
  } catch {
    return null
  }
}

export function isSafeExternalUrl(value: string | null | undefined): boolean {
  return normalizeSafeExternalUrl(value) !== null
}

export function normalizeSafeSystemSettingsUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && SAFE_SYSTEM_SETTINGS_URL_SET.has(trimmed) ? trimmed : null
}

export function isSafeSystemSettingsUrl(value: string | null | undefined): boolean {
  return normalizeSafeSystemSettingsUrl(value) !== null
}

export function normalizeEmbeddedMediaMimeType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().split(';', 1)[0]?.trim()
  return normalized && SAFE_EMBEDDED_MEDIA_MIME_TYPE_SET.has(normalized) ? normalized : null
}

export function isSafeEmbeddedMediaMimeType(value: string | null | undefined): boolean {
  return normalizeEmbeddedMediaMimeType(value) !== null
}

function dataUrlMetadata(value: string): { mimeType: string | null; base64: boolean } | null {
  if (!value.toLowerCase().startsWith('data:')) return null
  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) return null
  const metadata = value.slice('data:'.length, commaIndex)
  const parts = metadata.split(';').map((part) => part.trim()).filter(Boolean)
  const mimeType = normalizeEmbeddedMediaMimeType(parts[0])
  const base64 = parts.slice(1).some((part) => part.toLowerCase() === 'base64')
  return { mimeType, base64 }
}

export function normalizeSafeEmbeddedMediaUrl(
  value: string | null | undefined,
  policy: EmbeddedMediaUrlPolicy = {}
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const allowedProtocols = policy.allowedProtocols ?? SAFE_EMBEDDED_MEDIA_PROTOCOL_SET
  const allowedMimeTypes = policy.allowedMimeTypes ?? SAFE_EMBEDDED_MEDIA_MIME_TYPE_SET
  const requireDataUrlBase64 = policy.requireDataUrlBase64 ?? true

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (!allowedProtocols.has(protocol)) return null
    if (protocol !== 'data:') return trimmed

    const metadata = dataUrlMetadata(trimmed)
    if (!metadata?.mimeType) return null
    if (!allowedMimeTypes.has(metadata.mimeType)) return null
    if (requireDataUrlBase64 && !metadata.base64) return null
    return trimmed
  } catch {
    return null
  }
}

export function normalizeSafeRemoteEmbeddedMediaUrl(value: string | null | undefined): string | null {
  return normalizeSafeEmbeddedMediaUrl(value, {
    allowedProtocols: SAFE_REMOTE_EMBEDDED_MEDIA_PROTOCOL_SET
  })
}

export function isSafeEmbeddedMediaUrl(value: string | null | undefined): boolean {
  return normalizeSafeEmbeddedMediaUrl(value) !== null
}

export function hasSafeEmbeddedMediaExtension(value: string | null | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return false
  let pathname = trimmed
  try {
    pathname = new URL(trimmed).pathname
  } catch {
    pathname = trimmed.split(/[?#]/, 1)[0] ?? ''
  }
  const lower = pathname.toLowerCase()
  return SAFE_EMBEDDED_MEDIA_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
