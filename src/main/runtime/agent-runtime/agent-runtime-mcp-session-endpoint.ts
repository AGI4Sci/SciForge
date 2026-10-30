import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import type { AgentRuntimeMcpToolLease } from './agent-runtime-mcp-tool-lease'

/** ACP mounts MCP once. This address belongs to one trusted ACP session, NOT
 * to a tool authority. Each HTTP exchange captures a distinct immutable Host
 * turn lease; idle, revoked and in-flight old exchanges never borrow a new one.
 * Admission requires the runtime's prompt/cancel quiescence barrier. ACP has no
 * turn IDs in MCP requests, so this is not isolation from a malicious ACP peer.
 */
export async function createAgentRuntimeMcpSessionEndpoint() {
  let target: AgentRuntimeMcpToolLease | undefined
  const secret = `Bearer ${randomBytes(32).toString('hex')}`
  let address: URL
  const http = createServer((incoming, outgoing) => {
    const authorization = incoming.headers.authorization ?? ''
    if (Buffer.byteLength(authorization) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(authorization), Buffer.from(secret))) { outgoing.writeHead(401).end(); return }
    if (incoming.headers.origin || incoming.headers.host !== address.host || incoming.url !== '/mcp') { outgoing.writeHead(403).end(); return }
    const captured = target
    if (!captured) { outgoing.writeHead(410).end(); return }
    const upstream = httpRequest(captured.config.url, { method: incoming.method, headers: {
      ...incoming.headers, host: new URL(captured.config.url).host,
      authorization: captured.config.headers.find(h => h.name === 'Authorization')!.value
    } }, response => {
      if (target !== captured) { response.destroy(); outgoing.writeHead(410).end(); return }
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(410); outgoing.end() })
    outgoing.on('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', () => { http.off('error', reject); resolve() }) })
  const bound = http.address()
  if (!bound || typeof bound === 'string') { http.close(); throw new Error('Host MCP session endpoint did not bind.') }
  address = new URL(`http://127.0.0.1:${bound.port}/mcp`)
  return {
    config: { type: 'http' as const, name: 'sciforge_runtime_tools', url: address.href, headers: [{ name: 'Authorization', value: secret }] },
    bind(lease: AgentRuntimeMcpToolLease) { if (target) throw new Error('runtime_busy'); target = lease },
    unbind(lease?: AgentRuntimeMcpToolLease) { if (target === lease) target = undefined },
    async close() { target = undefined; await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections() }) }
  }
}
