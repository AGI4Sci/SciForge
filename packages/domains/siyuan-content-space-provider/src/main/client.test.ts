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
})
