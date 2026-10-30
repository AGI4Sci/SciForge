import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteAppDataJsonAtPath, atomicWriteAppDataTextAtPath } from '../../services/app-data-store'
import type { AgentRuntimeToolDefinition } from '../agent-runtime/agent-tool-surface'

/**
 * Host-provided Pi extension source, written into the host-managed storage
 * root at runtime and loaded explicitly with `-e` next to `--no-extensions`.
 *
 * Wire-verified behavior against @earendil-works/pi-coding-agent@1.4.0:
 * - Registering the `/mcp` command replaces pi's built-in MCP support for the
 *   session: pi then never reads mcp.json and never connects user-configured
 *   servers (verified: a decoy user mcp.json server was never spawned).
 * - Tools registered synchronously at extension load, together with an exact
 *   `--tools <names>` list, are the only tools the model can call; late
 *   registration after session_start does NOT activate for the first prompt.
 * - The extension performs plain MCP `tools/call` POSTs against the host's
 *   per-thread session endpoint; tool authority lives entirely at that
 *   endpoint (410 while no turn lease is bound).
 */
const PI_HOST_EXTENSION_SOURCE = `// SciForge host extension for Pi. GENERATED FILE - do not edit.
import { readFileSync } from 'node:fs'

export default function sciforgePiHost(pi) {
  const url = process.env.SCIFORGE_PI_MCP_URL
  const authorization = process.env.SCIFORGE_PI_MCP_AUTH
  const manifestPath = process.env.SCIFORGE_PI_TOOL_MANIFEST
  if (!url || !authorization || !manifestPath) {
    throw new Error('SciForge Pi host extension requires SCIFORGE_PI_MCP_URL, SCIFORGE_PI_MCP_AUTH and SCIFORGE_PI_TOOL_MANIFEST.')
  }
  // Replacing the built-in MCP support: pi does not read mcp.json and does
  // not connect user-configured servers for this session (verified on 1.4.0).
  pi.registerCommand('mcp', {
    description: 'MCP servers are managed by the SciForge host for this session.',
    handler: async () => {}
  })
  pi.on('mcp_servers_change', () => {})

  let nextId = 0
  const callTool = async (name, args) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'host-' + (++nextId),
        method: 'tools/call',
        params: { name, arguments: args }
      })
    })
    if (!res.ok) throw new Error('host endpoint ' + res.status)
    const msg = JSON.parse(await res.text())
    if (msg.error) throw new Error('host endpoint error ' + msg.error.code + ': ' + msg.error.message)
    return msg.result
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const tool of manifest.tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
      execute: async (_id, params) => {
        try {
          const result = await callTool(tool.name, params)
          const content = Array.isArray(result && result.content) ? result.content : []
          return {
            content: content.length ? content : [{ type: 'text', text: JSON.stringify(result ?? null) }],
            details: undefined,
            ...(result && result.isError ? { isError: true } : {})
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: 'Host tool unavailable: ' + (error instanceof Error ? error.message : String(error)) }],
            details: undefined,
            isError: true
          }
        }
      }
    })
  }
}
`

export const PI_HOST_EXTENSION_FILENAME = 'sciforge-pi-host.mjs'

/**
 * (Re)write the host extension into the host-managed directory and return its
 * absolute path. Always overwritten so a SciForge update replaces stale
 * generated code; the directory is private to the host (userData/pi-runtime).
 */
export async function ensurePiHostExtension(hostDir: string): Promise<string> {
  await mkdir(hostDir, { recursive: true })
  const path = join(hostDir, PI_HOST_EXTENSION_FILENAME)
  await atomicWriteAppDataTextAtPath(path, PI_HOST_EXTENSION_SOURCE)
  return path
}

/**
 * Snapshot the Host tool surface into the manifest the extension registers
 * at load. Written on every spawn so the registered set and the `--tools`
 * list always come from the same surface snapshot.
 */
export async function writePiToolManifest(
  hostDir: string,
  threadId: string,
  tools: readonly AgentRuntimeToolDefinition[]
): Promise<string> {
  await mkdir(hostDir, { recursive: true })
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const path = join(hostDir, `tools-${safe}.json`)
  const manifest = {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }
  await atomicWriteAppDataJsonAtPath(path, manifest)
  return path
}
