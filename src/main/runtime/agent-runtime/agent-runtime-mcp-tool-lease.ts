import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentRuntimeToolCallContext, AgentRuntimeToolSurface } from './agent-tool-surface'
import { agentRuntimeToolModelContent, modelVisibleAgentRuntimeToolFailure } from './agent-tool-surface'

export type AgentRuntimeMcpToolLeaseOptions = Readonly<{
  surface: AgentRuntimeToolSurface
  /** Captured by the Host, never decoded from MCP arguments or client metadata. */
  context: AgentRuntimeToolCallContext & { threadId: string; turnId: string }
  signal: AbortSignal
  assertCurrent(): void
}>

export type AgentRuntimeMcpToolLease = Readonly<{
  config: Readonly<{
    type: 'http'
    name: string
    url: string
    headers: readonly Readonly<{ name: string; value: string }>[]
  }>
  close(): Promise<void>
}>

/**
 * Protocol-only translation of the canonical Host tool surface for external
 * runtimes. Managed MCP servers remain behind the Broker; none are forwarded.
 * Each endpoint is one exact turn lease, with no mutable "current turn" slot.
 */
export async function createAgentRuntimeMcpToolLease(
  options: AgentRuntimeMcpToolLeaseOptions
): Promise<AgentRuntimeMcpToolLease> {
  const context = Object.freeze({ ...options.context })
  const controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const secret = `Bearer ${randomBytes(32).toString('hex')}`
  const protocols = new Set<Server>()
  let closing: Promise<void> | undefined
  let sequence = 0
  const assertCurrent = (): void => {
    signal.throwIfAborted()
    options.assertCurrent()
    // Discovery has the same Principal boundary as invocation.
    if (!options.surface.assertPrincipalLease) throw new Error('Missing Host Principal verifier.')
    options.surface.assertPrincipalLease(context)
  }
  assertCurrent()
  const http = createServer(async (request, response) => {
    const received = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(secret)
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      response.writeHead(401).end()
      return
    }
    if (request.headers.origin || request.headers.host !== address.host || request.url !== '/mcp') {
      response.writeHead(403).end()
      return
    }
    if (signal.aborted) { response.writeHead(410).end(); return }
    // Stateless MCP: a protocol instance per HTTP exchange, not a shared
    // multi-client session that could outlive or rebind the turn authority.
    const protocol = new Server({ name: 'sciforge_runtime_tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    protocols.add(protocol)
    protocol.setRequestHandler(ListToolsRequestSchema, async () => {
      try { assertCurrent() } catch { throw new Error('Host tool authority is no longer current.') }
      return { tools: options.surface.tools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
    })
    protocol.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try { assertCurrent() } catch {
        return { isError: true, content: [{ type: 'text' as const, text: 'Host tool authority is no longer current.' }] }
      }
      const definition = options.surface.tools().find((tool) => tool.name === request.params.name)
      if (!definition) return { isError: true, content: [{ type: 'text' as const, text: 'Unknown Host tool.' }] }
      const callSignal = AbortSignal.any([signal, extra.signal])
      try {
        const result = await options.surface.call({
          name: definition.name,
          arguments: request.params.arguments,
          context: { ...context, requestId: extra.requestId, callId: `${context.turnId}:${++sequence}` }
        }, { signal: callSignal })
        assertCurrent()
        return { content: [{ type: 'text' as const, text: agentRuntimeToolModelContent(result) ?? JSON.stringify(result.value) ?? 'null' }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: signal.aborted
          ? 'Host tool authority has been revoked.'
          : modelVisibleAgentRuntimeToolFailure(definition.name, error) }] }
      }
    })
    response.on('close', () => { protocols.delete(protocol); void protocol.close().catch(() => {}) })
    try {
      await protocol.connect(transport)
      await transport.handleRequest(request, response)
    } catch {
      if (!response.headersSent) response.writeHead(500).end()
      else response.end()
      protocols.delete(protocol)
      await protocol.close().catch(() => {})
    }
  })
  // The callback cannot execute until listen has completed and address is set.
  let address: URL
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => { http.off('error', reject); resolve() })
  })
  const bound = http.address()
  if (!bound || typeof bound === 'string') { http.close(); throw new Error('Host MCP endpoint did not bind.') }
  address = new URL(`http://127.0.0.1:${bound.port}/mcp`)
  const close = (): Promise<void> => {
    if (closing) return closing
    controller.abort('Host tool lease revoked.')
    options.signal.removeEventListener('abort', onAbort)
    options.surface.abortTurn?.(context, 'Host tool lease revoked.')
    closing = (async () => {
      await Promise.allSettled([...protocols].map((protocol) => protocol.close()))
      await new Promise<void>((resolve) => { http.close(() => resolve()); http.closeAllConnections() })
    })()
    return closing
  }
  const onAbort = (): void => { void close() }
  options.signal.addEventListener('abort', onAbort, { once: true })
  if (options.signal.aborted) await close()
  return { config: { type: 'http', name: 'sciforge_runtime_tools', url: address.href, headers: [{ name: 'Authorization', value: secret }] }, close }
}
