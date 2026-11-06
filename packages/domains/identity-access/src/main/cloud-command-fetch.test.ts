import { describe, expect, it, vi } from 'vitest'
import { fetchCloudCommand } from './cloud-command-fetch.js'

const url = 'https://cloud.example.test/v1/commands'
const timeout = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
})
const request = (signal = new AbortController().signal) => ({
  method: 'POST', signal, headers: { 'idempotency-key': 'same-operation' },
  body: JSON.stringify({ requestId: 'req_ConnectRetry0001', idempotencyKey: 'same-operation' })
})

describe('authenticated Cloud command connection recovery', () => {
  it('retries a connect timeout once with the identical request and idempotency key', async () => {
    const response = new Response('{}')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response)
    const init = request()
    await expect(fetchCloudCommand(fetchImpl, url, init)).resolves.toBe(response)
    expect(fetchImpl.mock.calls).toEqual([[url, init], [url, init]])
    expect(fetchImpl.mock.calls[0]![1]).toBe(fetchImpl.mock.calls[1]![1])
  })

  it('stops after two connect timeouts and preserves the typed timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(timeout())
    await expect(fetchCloudCommand(fetchImpl, url, request())).rejects.toMatchObject({ code: 'cloud_timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each(['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET'])('does not replay an uncertain %s outcome', async code => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('network failure'), { code }) })
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error)
    await expect(fetchCloudCommand(fetchImpl, url, request())).rejects.toBe(error)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 409, 500])('leaves HTTP %s to the existing auth/business handling', async status => {
    const response = new Response('{}', { status })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expect(fetchCloudCommand(fetchImpl, url, request())).resolves.toBe(response)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not start a request whose authority or deadline has already expired', async () => {
    const controller = new AbortController()
    const reason = new Error('authority changed')
    controller.abort(reason)
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(fetchCloudCommand(fetchImpl, url, request(controller.signal))).rejects.toBe(reason)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not retry after caller cancellation or authority invalidation', async () => {
    const controller = new AbortController()
    const reason = new Error('authority changed')
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(reason)
      throw timeout()
    })
    await expect(fetchCloudCommand(fetchImpl, url, request(controller.signal))).rejects.toBe(reason)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
