import { describe, expect, it, vi } from 'vitest'
import {
  getCachedMarkdownWorkspaceImage,
  loadCachedMarkdownWorkspaceImage,
  markdownWorkspaceImageCacheKey,
  type WriteMarkdownWorkspaceImageLoadResult
} from './write-markdown-image-cache'

const DATA_URL = 'data:image/png;base64,aW1n'

describe('write Markdown image cache', () => {
  it('deduplicates concurrent workspace image reads and retains the resolved image', async () => {
    let finishLoad: ((result: WriteMarkdownWorkspaceImageLoadResult) => void) | undefined
    const loadWorkspaceImage = vi.fn(() => new Promise<WriteMarkdownWorkspaceImageLoadResult>((resolve) => {
      finishLoad = resolve
    }))
    const cacheKey = markdownWorkspaceImageCacheKey('/workspace/cache-one', '/workspace/cache-one/chart.png')
    const input = {
      cacheKey,
      path: '/workspace/cache-one/chart.png',
      workspaceRoot: '/workspace/cache-one',
      loadWorkspaceImage
    }

    const firstLoad = loadCachedMarkdownWorkspaceImage(input)
    const secondLoad = loadCachedMarkdownWorkspaceImage(input)
    finishLoad?.({ ok: true, dataUrl: DATA_URL })

    await expect(firstLoad).resolves.toBe(DATA_URL)
    await expect(secondLoad).resolves.toBe(DATA_URL)
    expect(loadWorkspaceImage).toHaveBeenCalledTimes(1)
    expect(getCachedMarkdownWorkspaceImage(cacheKey)).toBe(DATA_URL)
  })

  it('keeps the last visible image when a background refresh fails', async () => {
    const cacheKey = markdownWorkspaceImageCacheKey('/workspace/cache-two', '/workspace/cache-two/chart.png')
    await loadCachedMarkdownWorkspaceImage({
      cacheKey,
      path: '/workspace/cache-two/chart.png',
      workspaceRoot: '/workspace/cache-two',
      loadWorkspaceImage: vi.fn(async () => ({ ok: true as const, dataUrl: DATA_URL }))
    })

    await expect(loadCachedMarkdownWorkspaceImage({
      cacheKey,
      path: '/workspace/cache-two/chart.png',
      workspaceRoot: '/workspace/cache-two',
      loadWorkspaceImage: vi.fn(async () => ({ ok: false as const, message: 'temporary failure' }))
    })).resolves.toBe(DATA_URL)
    expect(getCachedMarkdownWorkspaceImage(cacheKey)).toBe(DATA_URL)
  })

  it('does not cache unsafe image payloads', async () => {
    const cacheKey = markdownWorkspaceImageCacheKey('/workspace/cache-three', '/workspace/cache-three/chart.png')

    await expect(loadCachedMarkdownWorkspaceImage({
      cacheKey,
      path: '/workspace/cache-three/chart.png',
      workspaceRoot: '/workspace/cache-three',
      loadWorkspaceImage: vi.fn(async () => ({
        ok: true as const,
        dataUrl: 'data:text/html;base64,PGgxPm5vPC9oMT4='
      }))
    })).resolves.toBeNull()
    expect(getCachedMarkdownWorkspaceImage(cacheKey)).toBeUndefined()
  })
})
