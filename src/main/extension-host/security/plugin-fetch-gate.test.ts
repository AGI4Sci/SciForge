import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginFetchGate } from './plugin-fetch-gate'

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

async function startLocalServer(): Promise<number> {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('pong')
  })
  await new Promise<void>((resolvePromise) => server!.listen(0, '127.0.0.1', resolvePromise))
  return (server!.address() as { port: number }).port
}

describe('createPluginFetchGate', () => {
  it('performs a real request for an allow-listed domain', async () => {
    const port = await startLocalServer()
    const gate = createPluginFetchGate(['localhost'])
    const result = await gate(`http://localhost:${port}/ping`)
    expect(result).toEqual({ status: 200, body: 'pong' })
  })

  it('rejects a domain that is not allow-listed, before making any request', async () => {
    const port = await startLocalServer()
    let hits = 0
    server!.on('request', () => {
      hits += 1
    })
    const gate = createPluginFetchGate([]) // nothing allowed
    await expect(gate(`http://localhost:${port}/ping`)).rejects.toThrow(/not allow-listed/)
    expect(hits).toBe(0)
  })
})
