import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createBgcDiscoveryMcpServer } from './mcp-server.js'
import type { BgcDiscoveryService } from './service.js'

test('exposes BGC tools with network-aware safety annotations', async (t) => {
  const service = {
    status: async () => ({}),
    plan: async () => ({}),
    resourceStatus: async () => ({}),
    registerResource: async () => ({}),
    downloadResource: async () => ({}),
    runPipeline: async () => ({})
  } as unknown as BgcDiscoveryService
  const server = createBgcDiscoveryMcpServer(service)
  const client = new Client({ name: 'bgc-discovery-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const tools = await client.listTools()
  const download = tools.tools.find((tool) => tool.name === 'bgc_download_resource')
  const status = tools.tools.find((tool) => tool.name === 'bgc_status')

  assert.ok(download)
  assert.equal(download.annotations?.readOnlyHint, false)
  assert.equal(download.annotations?.openWorldHint, true)
  assert.ok(status)
  assert.equal(status.annotations?.readOnlyHint, true)
  assert.equal(status.annotations?.openWorldHint, false)
})
