export const WORKSPACE_PREVIEW_ASSET_SCHEME = 'sciforge-preview'

export function workspacePreviewAssetSourceUrl(sessionId: string): string | null {
  const normalized = sessionId.trim()
  if (!normalized || normalized.length > 256 || normalized.includes('\0')) return null
  return `${WORKSPACE_PREVIEW_ASSET_SCHEME}://asset/${encodeURIComponent(normalized)}`
}

export function workspacePreviewSessionIdFromAssetUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${WORKSPACE_PREVIEW_ASSET_SCHEME}:` || url.hostname !== 'asset') return null
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 1) return null
  try {
    const sessionId = decodeURIComponent(segments[0] ?? '').trim()
    if (!sessionId || sessionId.length > 256 || sessionId.includes('\0')) return null
    return sessionId
  } catch {
    return null
  }
}
