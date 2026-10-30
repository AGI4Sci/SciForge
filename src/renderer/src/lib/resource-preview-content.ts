export const RESOURCE_TEXT_PREVIEW_MAX_BYTES = 256 * 1024

type ResourcePreviewContentMetadata = Readonly<{ size: number; mimeType: string }>
export type ResourcePreviewContent = ResourcePreviewContentMetadata & (
  | Readonly<{ kind: 'pdf' | 'image' | 'unsupported' }>
  | Readonly<{ kind: 'text'; text: string; truncated: boolean }>
)

function isTextContent(mimeType: string): boolean {
  return mimeType.startsWith('text/') ||
    /^application\/(?:json|.+\+json|xml|.+\+xml|(?:x-)?yaml|(?:x-)?ndjson|javascript)$/u.test(mimeType)
}

/** All authorization, MIME metadata and byte reads use the canonical Broker URL transport. */
export async function loadResourcePreviewContent(
  sourceUrl: string,
  signal: AbortSignal,
  fetchContent: typeof fetch = fetch
): Promise<ResourcePreviewContent> {
  const head = await fetchContent(sourceUrl, { method: 'HEAD', signal })
  if (!head.ok) throw new Error('Resource preview authorization failed.')
  const rawSize = head.headers.get('content-length')
  const size = rawSize === null ? NaN : Number(rawSize)
  const mimeType = head.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!Number.isSafeInteger(size) || size < 0 || !mimeType) throw new Error('Resource preview metadata is unavailable.')
  if (mimeType === 'application/pdf' || mimeType === 'application/x-pdf') return { kind: 'pdf', size, mimeType: 'application/pdf' }
  if (mimeType.startsWith('image/')) return { kind: 'image', size, mimeType }
  if (!isTextContent(mimeType)) return { kind: 'unsupported', size, mimeType }
  const length = Math.min(size, RESOURCE_TEXT_PREVIEW_MAX_BYTES)
  if (length === 0) return { kind: 'text', size, mimeType, text: '', truncated: false }
  const response = await fetchContent(sourceUrl, { headers: { Range: `bytes=0-${length - 1}` }, signal })
  if (!response.ok || !response.body) throw new Error('Resource preview content is unavailable.')
  const advertisedLength = Number(response.headers.get('content-length'))
  if (advertisedLength > length || (response.status !== 206 && size > length)) {
    await response.body.cancel()
    throw new Error('Resource preview range exceeded its bound.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytesRead += part.value.byteLength
      if (bytesRead > length) {
        await reader.cancel()
        throw new Error('Resource preview range exceeded its bound.')
      }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
  } finally { reader.releaseLock() }
  if (bytesRead !== length) throw new Error('Resource preview ended before the requested range.')
  return { kind: 'text', size, mimeType, text, truncated: size > bytesRead }
}
