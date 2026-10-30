import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createAgentRuntimeMcpToolLease } from './agent-runtime-mcp-tool-lease'
import type { AgentRuntimeToolSurface } from './agent-tool-surface'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

const context = Object.freeze({ requestId: 'request', runtimeId: 'dsh', threadId: 'thread', turnId: 'turn', workspaceId: 'workspace' })
const definition = { type: 'function' as const, name: 'sciforge_discover', description: 'Discover authorized operations', inputSchema: { type: 'object' as const, properties: {} } }
function surface(): AgentRuntimeToolSurface {
  return {
    tools: () => [definition],
    assertPrincipalLease: vi.fn(),
    call: vi.fn(async (request) => ({ tool: request.name, value: { operations: [] } })),
    abortTurn: vi.fn(() => 1)
  }
}
async function connect(lease: Awaited<ReturnType<typeof createAgentRuntimeMcpToolLease>>) {
  const client = new Client({ name: 'test-runtime', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(lease.config.url), {
    requestInit: { headers: Object.fromEntries(lease.config.headers.map(({ name, value }) => [name, value])) }
  })
  await client.connect(transport)
  cleanup.push(() => client.close())
  return client
}

describe('canonical per-turn MCP tool lease', () => {
  it('publishes and invokes only canonical tools with host-captured identity and a live signal', async () => {
    const tools = surface()
    const assertCurrent = vi.fn()
    const lease = await createAgentRuntimeMcpToolLease({ surface: tools, context, signal: new AbortController().signal, assertCurrent })
    cleanup.push(() => lease.close())
    const client = await connect(lease)
    expect((await client.listTools()).tools).toEqual([expect.objectContaining({ name: definition.name })])
    const response = await client.callTool({ name: definition.name, arguments: { runtimeId: 'codex', threadId: 'forged' } })
    expect(response.isError).not.toBe(true)
    expect(tools.call).toHaveBeenCalledWith({
      name: definition.name,
      arguments: { runtimeId: 'codex', threadId: 'forged' },
      context: expect.objectContaining({ ...context, requestId: expect.anything() })
    }, { signal: expect.any(AbortSignal) })
    expect(assertCurrent).toHaveBeenCalled()
    expect(tools.assertPrincipalLease).toHaveBeenCalledWith(expect.objectContaining(context))
    await expect(client.callTool({ name: 'raw_managed_write', arguments: {} })).resolves.toMatchObject({ isError: true })
    expect(tools.call).toHaveBeenCalledTimes(1)
  })

  it('requires bearer authority and rejects cross-origin browser traffic', async () => {
    const lease = await createAgentRuntimeMcpToolLease({ surface: surface(), context, signal: new AbortController().signal, assertCurrent() {} })
    cleanup.push(() => lease.close())
    expect((await fetch(lease.config.url)).status).toBe(401)
    const headers = Object.fromEntries(lease.config.headers.map(({ name, value }) => [name, value]))
    expect((await fetch(lease.config.url, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status).toBe(403)
  })

  it('rejects non-ASCII bearer bytes without disrupting subsequent authorized requests', async () => {
    const tools = surface()
    const lease = await createAgentRuntimeMcpToolLease({ surface: tools, context, signal: new AbortController().signal, assertCurrent() {} })
    cleanup.push(() => lease.close())
    const expected = lease.config.headers[0].value
    const malformed = `Bearer é${'a'.repeat(expected.length - 8)}`
    expect(malformed.length).toBe(expected.length)
    expect(Buffer.byteLength(malformed)).not.toBe(Buffer.byteLength(expected))
    const response = await fetch(lease.config.url, { headers: { Authorization: malformed }, signal: AbortSignal.timeout(1500) })
    expect(response.status).toBe(401)
    expect(tools.call).not.toHaveBeenCalled()
    const client = await connect(lease)
    expect((await client.listTools()).tools).toEqual([expect.objectContaining({ name: definition.name })])
    expect((await client.callTool({ name: definition.name, arguments: {} })).isError).not.toBe(true)
    expect(tools.call).toHaveBeenCalledTimes(1)
  })

  it('revalidates authority before discovery and execution and redacts private errors', async () => {
    let current = true
    const tools = surface()
    const lease = await createAgentRuntimeMcpToolLease({ surface: tools, context, signal: new AbortController().signal, assertCurrent() {
      if (!current) throw new Error('/private/secret/bearer-token stale principal')
    } })
    cleanup.push(() => lease.close())
    const client = await connect(lease)
    current = false
    await expect(client.listTools()).rejects.toThrow()
    const denied = await client.callTool({ name: definition.name, arguments: {} })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).not.toContain('/private/secret')
    expect(tools.call).not.toHaveBeenCalled()
  })

  it('revokes endpoint and pending canonical calls when the turn ends, idempotently', async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    const tools: AgentRuntimeToolSurface = { ...surface(), call: vi.fn<AgentRuntimeToolSurface['call']>(async (_request, options) => {
      capturedSignal = options?.signal
      return await new Promise<Awaited<ReturnType<AgentRuntimeToolSurface['call']>>>((resolve) => options?.signal?.addEventListener('abort', () => resolve({ tool: definition.name, value: null }), { once: true }))
    }) }
    const lease = await createAgentRuntimeMcpToolLease({ surface: tools, context, signal: controller.signal, assertCurrent() {} })
    cleanup.push(() => lease.close())
    const client = await connect(lease)
    const pending = client.callTool({ name: definition.name, arguments: {} }).catch(() => undefined)
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    controller.abort('turn interrupted')
    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    await lease.close()
    await lease.close()
    expect(tools.abortTurn).toHaveBeenCalledTimes(1)
    expect(tools.abortTurn).toHaveBeenCalledWith(context, expect.any(String))
    await pending
    await expect(fetch(lease.config.url)).rejects.toThrow()
  })
})
