import type { BiologyRoomAsset } from '@shared/biology-room'

export type BiologyRoomAssetSource = {
  sourceUrl: string
  indexUrls?: ReadonlyArray<string> | Readonly<Record<string, string>>
}

export type BiologyRoomAssetSources = Readonly<Record<string, BiologyRoomAssetSource | undefined>>

export function isLocalBiologyAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'blob:' || url.protocol === 'data:' || url.protocol === 'file:') return true
    if (url.protocol === 'sciforge-resource:') return true
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function validateBiologyAssetSource(
  source: BiologyRoomAssetSource | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (!source?.sourceUrl) return { ok: false, reason: 'The host did not provide a source URL for this asset.' }
  if (!isLocalBiologyAssetUrl(source.sourceUrl)) {
    return { ok: false, reason: 'Biology viewers only accept host-issued local asset URLs.' }
  }
  const indexUrls = Array.isArray(source.indexUrls)
    ? source.indexUrls
    : Object.values((source.indexUrls ?? {}) as Readonly<Record<string, string>>)
  if (indexUrls.some((url) => !isLocalBiologyAssetUrl(url))) {
    return { ok: false, reason: 'Biology viewers only accept host-issued local index URLs.' }
  }
  return { ok: true }
}

export function resolveBiologyAssetIndexUrl(
  asset: BiologyRoomAsset,
  source: BiologyRoomAssetSource,
  suffix: '.fai' | '.gzi' | '.tbi' | '.csi'
): string | null {
  const indexPathIndex = asset.indexPaths.findIndex((path) => path.toLowerCase().endsWith(suffix))
  if (Array.isArray(source.indexUrls)) {
    if (indexPathIndex >= 0) return source.indexUrls[indexPathIndex] ?? null
    return null
  }
  const mapping = (source.indexUrls ?? {}) as Readonly<Record<string, string>>
  const indexPath = indexPathIndex >= 0 ? asset.indexPaths[indexPathIndex] : undefined
  if (indexPath && mapping[indexPath]) return mapping[indexPath]
  const basename = indexPath?.replaceAll('\\', '/').split('/').at(-1)
  if (basename && mapping[basename]) return mapping[basename]
  return mapping[suffix] ?? mapping[suffix.slice(1)] ?? null
}
