import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_MCP_TOOL_NAME,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  computerUseMcpEnabledTools
} from './computer-use-mcp-config'
import { createComputerUseMcpServer, runComputerUseMcpServerFromArgv } from './computer-use-mcp-server'
import { COMPUTER_USE_INVOCATION_META_KEY } from './services/computer-use-invocation-proof'

const openServers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()))
})

describe('computer-use MCP server', () => {
  it('does not expose tools until the GUI-Owl sidecar is configured', async () => {
    const mcpServer = createComputerUseMcpServer(null)
    const client = new Client({ name: 'computer-use-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([
        mcpServer.connect(serverTransport),
        client.connect(clientTransport)
      ])

      await expect(client.listTools()).rejects.toMatchObject({
        code: -32601
      })
    } finally {
      await client.close()
      await mcpServer.close()
    }
  })

  it('forwards one approved GUI task to the configured GUI-Owl HTTP sidecar', async () => {
    const requests: Array<{
      authorization: string | undefined
      invocationProof: string | undefined
      body: Record<string, unknown>
      path: string | undefined
    }> = []
    const sidecar = await startFakeSidecar(async (request, response) => {
      requests.push({
        authorization: request.headers.authorization,
        invocationProof: request.headers['x-sciforge-cua-invocation'] as string | undefined,
        body: await readJsonBody(request),
        path: request.url
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        ok: true,
        summary: 'GUI-Owl completed the desktop task',
        data: { status: 'agent_reported_done', stepCount: 2 }
      }))
    })

    const mcpServer = createComputerUseMcpServer({
      serviceUrl: sidecar.url,
      serviceToken: 'sidecar-token',
      timeoutMs: 5_000,
      invocationSecret: 'test-invocation-secret'
    })
    const client = new Client({ name: 'computer-use-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([
        mcpServer.connect(serverTransport),
        client.connect(clientTransport)
      ])

      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(computerUseMcpEnabledTools())
      const runTool = tools.tools.find((tool) => tool.name === COMPUTER_USE_MCP_TOOL_NAME)
      expect(runTool?.annotations).toMatchObject({
        title: 'Computer use',
        readOnlyHint: false,
        openWorldHint: true
      })

      const result = await client.callTool({
        name: COMPUTER_USE_MCP_TOOL_NAME,
        arguments: { instruction: 'open a browser and inspect an AI4AI paper' },
        _meta: trustedInvocationMeta('run-invocation-1')
      })

      expect(result.isError).toBeUndefined()
      expect(result.content).toEqual([{ type: 'text', text: 'GUI-Owl completed the desktop task' }])
      expect(result.structuredContent).toMatchObject({
        ok: true,
        data: { status: 'agent_reported_done', stepCount: 2 }
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        authorization: 'Bearer sidecar-token',
        path: '/computer-use/run',
        body: {
          instruction: 'open a browser and inspect an AI4AI paper',
          execute: true
        }
      })
      expect(requests[0]?.body).not.toHaveProperty('approve')
      expect(requests[0]?.invocationProof).toBeTruthy()
      expect(String(requests[0]?.body.requestId)).toMatch(/^mcp-cua-/)
    } finally {
      await client.close()
      await mcpServer.close()
    }
  })

  it('forwards protocol v2 session and target fields without weakening them', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sidecar = await startFakeSidecar(async (request, response) => {
      requests.push(await readJsonBody(request))
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        ok: false,
        error: { code: 'BACKEND_UNAVAILABLE', message: 'P2 is not connected' }
      }))
    })
    const mcpServer = createComputerUseMcpServer({
      serviceUrl: sidecar.url,
      serviceToken: '',
      timeoutMs: 5_000,
      invocationSecret: 'test-invocation-secret'
    })
    const client = new Client({ name: 'computer-use-v2-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({
        name: COMPUTER_USE_MCP_TOOL_NAME,
        arguments: {
          instruction: 'type in the selected page',
          sessionId: 'session-browser-1',
          target: {
            targetId: 'target-browser-1',
            kind: 'browser-page',
            locator: { cdpEndpoint: 'http://127.0.0.1:9222', cdpTargetId: 'page-1' }
          },
          requestedIsolation: 'host-app-scoped',
          allowDegraded: false
        },
        _meta: trustedInvocationMeta('run-invocation-2')
      })
      expect(result.isError).toBe(true)
      expect(requests[0]).toMatchObject({
        sessionId: 'session-browser-1',
        target: { targetId: 'target-browser-1', kind: 'browser-page' },
        requestedIsolation: 'host-app-scoped',
        allowDegraded: false,
        execute: true
      })
      expect(requests[0]).not.toHaveProperty('approve')
    } finally {
      await client.close()
      await mcpServer.close()
    }
  })

  it('ignores non GUI-Owl launch argv', async () => {
    expect(GUI_COMPUTER_USE_MCP_SERVER_NAME).toBe('gui_owl_computer_use')
    await expect(runComputerUseMcpServerFromArgv(['node', 'entry.js'])).resolves.toBe(false)
  })

  it('fails closed when a mutation lacks trusted invocation metadata', async () => {
    const sidecar = await startFakeSidecar(async (_request, response) => {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end('{}')
    })
    const mcpServer = createComputerUseMcpServer({
      serviceUrl: sidecar.url,
      serviceToken: 'sidecar-token',
      timeoutMs: 5_000,
      invocationSecret: 'test-invocation-secret'
    })
    const client = new Client({ name: 'computer-use-proof-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({
        name: COMPUTER_USE_MCP_TOOL_NAME,
        arguments: { instruction: 'must not run' }
      })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        error: { code: 'APPROVAL_PROOF_REQUIRED' }
      })
    } finally {
      await client.close()
      await mcpServer.close()
    }
  })
})

function trustedInvocationMeta(invocationId: string): Record<string, unknown> {
  return {
    [COMPUTER_USE_INVOCATION_META_KEY]: {
      requestId: `runtime-${invocationId}`,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      actionId: 'managed-mcp.computer-use',
      invocationId,
      approval: 'confirmation'
    }
  }
}

async function startFakeSidecar(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error) => {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: String(error) }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const wrapped = {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
  openServers.push(wrapped)
  return wrapped
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}
