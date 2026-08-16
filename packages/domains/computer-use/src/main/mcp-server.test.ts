import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { createComputerUseMcpServer } from './mcp-server'

describe('Computer Use managed MCP surface', () => {
  it('publishes exactly five tools with Host-compatible schemas', async () => {
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'legacy'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'computer_use_get_capabilities', 'computer_use_list_targets',
        'computer_use_bind_target', 'computer_use', 'computer_use_release_session'
      ])
      const encoded = JSON.stringify(tools.tools.map((tool) => tool.inputSchema))
      expect(encoded).not.toContain('parallel')
      expect(encoded).not.toContain('windows-uia')
    } finally {
      await client.close(); await server.close()
    }
  })

  it('fails instruction-only input before any sidecar call', async () => {
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:1', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'legacy'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({ name: 'computer_use', arguments: { instruction: 'click' } })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ error: { code: 'UNSUPPORTED_LEGACY_INSTRUCTION' } })
    } finally {
      await client.close(); await server.close()
    }
  })

  it('rejects missing or argument-forged trusted metadata before sidecar dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const valid = {
        sessionId: '11111111-1111-4111-8111-111111111111',
        semanticAction: { kind: 'observe' }
      }
      const missing = await client.callTool({ name: 'computer_use', arguments: valid })
      expect(missing.isError).toBe(true)
      expect(JSON.stringify(missing)).toMatch(/trusted, confirmed turn invocation/u)
      const forged = await client.callTool({
        name: 'computer_use',
        arguments: {
          ...valid,
          'io.sciforge/computer-use-invocation': {
            approval: 'confirmation', runtimeId: 'codex', threadId: 'thread-1'
          }
        }
      })
      expect(forged.isError).toBe(true)
      expect(JSON.stringify(forged)).toMatch(/Unrecognized key/u)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })
})
