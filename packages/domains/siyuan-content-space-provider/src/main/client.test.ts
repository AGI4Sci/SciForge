import { describe, expect, it, vi } from 'vitest'
import { SiYuanClient, SiYuanError } from './client.js'

describe('SiYuanClient', () => {
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { hPath: '/SciForge/实验记录', content: '# 结论\n' }
    }), { status: 200 }))
    const client = new SiYuanClient({ baseUrl: 'http://example.test' })
    await expect(client.exportDocumentMarkdown('20261030140949-abcdefg'))
      .resolves.toEqual({ path: '/SciForge/实验记录', markdown: '# 结论\n' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://example.test/api/export/exportMdContent')
    fetchMock.mockRestore()
  })
})
