import { describe, expect, it, vi } from 'vitest'
import { loadResourcePreviewContent, RESOURCE_TEXT_PREVIEW_MAX_BYTES } from './resource-preview-content'

const source = 'sciforge-resource://content?access=exact'
const signal = () => new AbortController().signal
function headers(size: number, mimeType: string) { return { 'content-length': String(size), 'content-type': mimeType } }

describe('Broker URL resource preview content', () => {
  it.each(['application/pdf', 'image/png'])('checks authority before giving %s to the existing viewer', async mimeType => {
    const fetchContent = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { headers: headers(42, mimeType) }))
    expect(await loadResourcePreviewContent(source, signal(), fetchContent)).toEqual({ kind: mimeType === 'application/pdf' ? 'pdf' : 'image', size: 42, mimeType })
    expect(fetchContent).toHaveBeenCalledExactlyOnceWith(source, { method: 'HEAD', signal: expect.any(AbortSignal) })
  })
  it('reads text through the same URL using a bounded HTTP range', async () => {
    const fetchContent = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { headers: headers(3, 'text/csv') }))
      .mockResolvedValueOnce(new Response('a,b', { status: 206, headers: { 'content-length': '3' } }))
    expect(await loadResourcePreviewContent(source, signal(), fetchContent)).toEqual({ kind: 'text', size: 3, mimeType: 'text/csv', text: 'a,b', truncated: false })
    expect(fetchContent).toHaveBeenLastCalledWith(source, { headers: { Range: 'bytes=0-2' }, signal: expect.any(AbortSignal) })
  })
  it('never reads beyond the first 256 KiB and reports truncation', async () => {
    const fetchContent = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { headers: headers(100 * 1024 * 1024, 'application/json') }))
      .mockResolvedValueOnce(new Response('x'.repeat(RESOURCE_TEXT_PREVIEW_MAX_BYTES), { status: 206, headers: { 'content-length': String(RESOURCE_TEXT_PREVIEW_MAX_BYTES) } }))
    const result = await loadResourcePreviewContent(source, signal(), fetchContent)
    expect(result.kind).toBe('text')
    if (result.kind === 'text') { expect(result.text.length).toBe(RESOURCE_TEXT_PREVIEW_MAX_BYTES); expect(result.truncated).toBe(true) }
    expect(fetchContent).toHaveBeenLastCalledWith(source, { headers: { Range: `bytes=0-${RESOURCE_TEXT_PREVIEW_MAX_BYTES - 1}` }, signal: expect.any(AbortSignal) })
  })
  it('refuses a transport that ignores a bounded range', async () => {
    const fetchContent = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { headers: headers(RESOURCE_TEXT_PREVIEW_MAX_BYTES + 1, 'text/plain') }))
      .mockResolvedValueOnce(new Response('ignored range', { status: 200 }))
    await expect(loadResourcePreviewContent(source, signal(), fetchContent)).rejects.toThrow('bound')
  })
  it('does not read bytes when authorization fails or the content is unsupported', async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }))
    await expect(loadResourcePreviewContent(source, signal(), denied)).rejects.toThrow('authorization')
    expect(denied).toHaveBeenCalledOnce()
    const unsupported = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { headers: headers(42, 'application/vnd.apache.parquet') }))
    expect(await loadResourcePreviewContent(source, signal(), unsupported)).toEqual({ kind: 'unsupported', mimeType: 'application/vnd.apache.parquet', size: 42 })
    expect(unsupported).toHaveBeenCalledOnce()
  })
})
