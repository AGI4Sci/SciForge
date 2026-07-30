import { normalizeSafeEmbeddedMediaUrl } from '@shared/external-url-policy'

export type WriteMarkdownWorkspaceImageLoadResult = {
  ok: true
  dataUrl: string
} | {
  ok: false
  message?: string
}

export type WriteMarkdownWorkspaceImageLoader = (input: {
  path: string
  workspaceRoot: string
}) => Promise<WriteMarkdownWorkspaceImageLoadResult>

type CachedMarkdownImage = {
  dataUrl?: string
  pending?: Promise<string | null>
}

const MAX_CACHED_MARKDOWN_IMAGES = 24
const markdownImageCache = new Map<string, CachedMarkdownImage>()

export function markdownWorkspaceImageCacheKey(workspaceRoot: string, path: string): string {
  return `${workspaceRoot}\n${path}`
}

export function getCachedMarkdownWorkspaceImage(cacheKey: string): string | undefined {
  return markdownImageCache.get(cacheKey)?.dataUrl
}

export function loadCachedMarkdownWorkspaceImage(input: {
  cacheKey: string
  path: string
  workspaceRoot: string
  loadWorkspaceImage: WriteMarkdownWorkspaceImageLoader
}): Promise<string | null> {
  const cached = markdownImageCache.get(input.cacheKey)
  if (cached?.pending) return cached.pending

  const previousDataUrl = cached?.dataUrl
  const pending = input.loadWorkspaceImage({
    path: input.path,
    workspaceRoot: input.workspaceRoot
  }).then((result) => {
    const dataUrl = result.ok
      ? normalizeSafeEmbeddedMediaUrl(result.dataUrl) ?? previousDataUrl ?? null
      : previousDataUrl ?? null
    markdownImageCache.set(input.cacheKey, dataUrl ? { dataUrl } : {})
    trimMarkdownImageCache()
    return dataUrl
  }).catch(() => {
    if (previousDataUrl) {
      markdownImageCache.set(input.cacheKey, { dataUrl: previousDataUrl })
    } else {
      markdownImageCache.delete(input.cacheKey)
    }
    return previousDataUrl ?? null
  })

  markdownImageCache.set(input.cacheKey, {
    ...(previousDataUrl ? { dataUrl: previousDataUrl } : {}),
    pending
  })
  trimMarkdownImageCache()
  return pending
}

function trimMarkdownImageCache(): void {
  while (markdownImageCache.size > MAX_CACHED_MARKDOWN_IMAGES) {
    const oldestKey = markdownImageCache.keys().next().value
    if (typeof oldestKey !== 'string') return
    markdownImageCache.delete(oldestKey)
  }
}
