import { describe, expect, it, vi } from 'vitest'
import { SiYuanClient, SiYuanError } from './client.js'

describe('SiYuanClient', () => {
  it('sends the original document precondition for each body write and preserves a definitive conflict', async () => {
    const bodies: unknown[] = []
    const client = new SiYuanClient({ baseUrl: 'https://notes.test', fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ code: -1, msg: 'document_changed', data: null })
    } })
    const id = '20261030140949-abcdefg'
    const expectedDocument = { id, kramdown: 'Original snapshot with attributes\n' }
    for (const write of [
      () => client.appendMarkdown(id, 'New', undefined, expectedDocument),
      () => client.replaceMarkdown(id, 'New', undefined, expectedDocument),
      () => client.updateBlocks([{ id, markdown: 'New' }], undefined, expectedDocument)
    ]) await expect(write()).rejects.toMatchObject({ code: 'document_changed', retryable: false })
    expect(bodies).toHaveLength(3)
    for (const body of bodies) expect(body).toMatchObject({ expectedDocument })
  })

  it('retries a transient read once and stops on persistent failure or cancellation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      const client = new SiYuanClient({ baseUrl: 'https://remote.test' })
      fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ code: 0, data: '3.8.6' }))
      await expect(client.version()).resolves.toBe('3.8.6')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      fetchMock.mockReset().mockRejectedValue(new Error('offline'))
      await expect(client.version()).rejects.toMatchObject({ code: 'provider_unavailable' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      fetchMock.mockClear()
      await expect(client.version(AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { fetchMock.mockRestore() }
  })

  it.each([401, 403])('does not retry denied reads (HTTP %s)', async (status) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }))
    try {
      await expect(new SiYuanClient({ baseUrl: 'https://remote.test' }).version()).rejects.toMatchObject({ code: 'unauthorized' })
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally { fetchMock.mockRestore() }
  })

  it('bounds a stalled read to two deadlines and a stalled write to one uncertain attempt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init!.signal!
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    try {
      const client = new SiYuanClient({ baseUrl: 'https://remote.test', timeoutMs: 10 })
      await expect(client.version()).rejects.toMatchObject({ code: 'provider_unavailable' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      fetchMock.mockClear()
      await expect(client.createDocument({ notebook: '20261009184641-d7qcu5k', path: '/test', markdown: 'text' }))
        .rejects.toMatchObject({ code: 'outcome_unknown' })
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally { fetchMock.mockRestore() }
  })
  it('validates envelopes and keeps the token out of errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ code: 3, msg: 'bad token', data: null }), { status: 200 }
    ))
    const client = new SiYuanClient({ baseUrl: 'http://example.test', token: 'secret-token' })
    await expect(client.version()).rejects.toMatchObject({ code: 'api_error' })
    await expect(client.version()).rejects.not.toThrow('secret-token')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Token secret-token' }
    })
    fetchMock.mockRestore()
  })

  it('does not retry a write after a transport failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    const client = new SiYuanClient({ baseUrl: 'http://example.test', token: 'token' })
    await expect(client.createDocument({
      notebook: '20261009184641-d7qcu5k', path: '/test', markdown: 'x'
    })).rejects.toBeInstanceOf(SiYuanError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('keeps a quote inside the search term from ending the SQL literal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: [{ id: '20261030140949-abcdefg', box: '20261029151725-tmcqisz',
        hpath: '/SciForge/实验记录', updated: '20261030140949' }]
    }), { status: 200 }))
    const client = new SiYuanClient({ baseUrl: 'http://example.test' })
    await expect(client.searchDocuments({ query: "x'; DROP TABLE blocks; --", limit: 3 }))
      .resolves.toHaveLength(1)
    const statement = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { stmt: string }
    expect(statement.stmt).toContain("LIKE '%x''; DROP TABLE blocks; --%' ESCAPE '\\'")
    expect(statement.stmt).toContain('LIMIT 3')
    fetchMock.mockRestore()
  })

  it('escapes the LIKE wildcards so a percent sign stays literal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: []
    }), { status: 200 }))
    const client = new SiYuanClient({ baseUrl: 'http://example.test' })
    await client.searchDocuments({ query: '50%_off', limit: 10 })
    const statement = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { stmt: string }
    expect(statement.stmt).toContain("LIKE '%50\\%\\_off%'")
    fetchMock.mockRestore()
  })

  it('reports a missing document id as document_not_found', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: []
    }), { status: 200 }))
    const client = new SiYuanClient({ baseUrl: 'http://example.test' })
    await expect(client.documentMetadata('20261030140949-abcdefg'))
      .rejects.toMatchObject({ code: 'document_not_found' })
    fetchMock.mockRestore()
  })

  it('exports clean Markdown instead of kramdown block attributes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { id: '20261030140949-abcdefg', kramdown: '# 结论\n{: id="20261030140949-abcdefg" updated="20261030140949"}\n' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: '/SciForge/实验记录' })))
    const client = new SiYuanClient({ baseUrl: 'http://example.test' })
    await expect(client.exportDocumentMarkdown('20261030140949-abcdefg'))
      .resolves.toEqual({ path: '/SciForge/实验记录', markdown: '# 结论\n', updated: '20261030140949', raw: '# 结论\n{: id="20261030140949-abcdefg" updated="20261030140949"}\n', conditionalWriteVersion: undefined })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://example.test/api/block/getBlockKramdown')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      id: '20261030140949-abcdefg'
    })
    fetchMock.mockRestore()
  })
})
