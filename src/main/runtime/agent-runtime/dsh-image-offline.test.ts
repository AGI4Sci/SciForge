import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, realpath, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDshHostRuntimeAdapter } from './dsh-agent-runtime-adapter'
import { withBoundedToolResults } from './model-visible-tool-result'
import { createDiscoveredDshDeployment } from '@sciforge/dsh-runtime'
import type { AppSettingsV1 } from '../../../shared/app-settings-types'

// Opt-in installed official CLI, fresh scratch state, loopback-only deterministic
// HTTP fixture. No live provider, GUI, normal DSH profile or credential store.
const cli = process.env.SCIFORGE_TEST_OFFICIAL_DSH_CLI
const evidenceDir = resolve(process.cwd(), '../evidence/audit-fixes-20261103-1704')
it.skipIf(!cli).each([true, false])('official derived ACP image declaration=%s preserves image_url or explicitly refuses image input', async imageEnabled => {
  await access(cli!)
  const root = await mkdtemp(join(await realpath(tmpdir()), 'dsh-image-offline-'))
  const requests: Array<Record<string, any>> = []
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII='
  const bytes = Buffer.from(data, 'base64')
  let calls = 0
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body); requests.push(request)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const name = request.tools?.[0]?.function?.name
    const delta = calls++ === 0
      ? { tool_calls: [{ index: 0, id: 'call_image', type: 'function', function: { name, arguments: '{}' } }] }
      : { content: 'offline fixture complete' }
    res.write(`data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', created: 1, model: 'offline-alias', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', created: 1, model: 'offline-alias', choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const image = { mimeType: 'image/png', dataUrl: `data:image/png;base64,${data}`, digest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 2, height: 2 }
  const toolSurface = withBoundedToolResults({
    tools: () => [{ name: 'inspect_image', type: 'function', description: 'Return offline image', inputSchema: { type: 'object', properties: {} } }],
    assertPrincipalLease() {}, call: async () => ({ tool: 'inspect_image', value: image })
  }, async () => 'offline-artifact')
  const adapter = createDshHostRuntimeAdapter({ executable: resolve(cli!), stateDirectory: join(root, 'state'), safetyPatch: 'derived', defaultAcpRoute: null,
    verifyDeployment: createDiscoveredDshDeployment(false).verifyDeployment,
    modelRouter: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'offline-fixture-only', model: 'offline-alias', inputModalities: imageEnabled ? ['text', 'image'] : ['text'] },
    requestTimeoutMs: 15000, promptTimeoutMs: 30000, toolSurface })
  const context = { settings: {} as AppSettingsV1 }
  const abort = new AbortController()
  try {
    const thread = await adapter.startThread(context, { runtimeId: 'dsh', workspace: root })
    const events: unknown[] = []
    const finished = (async () => { for await (const event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, signal: abort.signal })) {
      events.push(event)
      if (event.kind === 'turn_lifecycle' && event.state !== 'running') return event
    } })()
    await adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'Offline deterministic fixture' })
    const end = await finished
    const rawBodies = JSON.stringify(requests)
    if (imageEnabled) {
      expect(end).toMatchObject({ state: 'completed' })
      expect(requests).toHaveLength(2)
      const parts = requests[1].messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
      expect(parts).toContainEqual(expect.objectContaining({ type: 'image_url', image_url: expect.objectContaining({ url: `data:image/png;base64,${data}` }) }))
      expect(JSON.stringify(requests[1])).toContain('mcp-content-only')
    } else {
      expect(end).toMatchObject({ state: 'completed' })
      expect(requests).toHaveLength(2)
      expect(JSON.stringify(requests[1])).toContain('unsupported_model_image_input')
      expect(JSON.stringify(requests[1])).not.toContain('data:image/')
      expect(JSON.stringify(requests[1])).not.toContain('"status":"attached"')
    }
    // Exact body hashes and structure, no auth headers or raw base64 persisted.
    const redact = (value: unknown): unknown => typeof value === 'string' && value.startsWith('data:image/')
      ? { dataUrlOmitted: true, sha256: createHash('sha256').update(Buffer.from(value.split(',')[1], 'base64')).digest('hex') }
      : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, member]) => [key, redact(member)])) : value
    await writeFile(join(evidenceDir, `image-official-body-${imageEnabled ? 'vision' : 'text-only'}.json`), JSON.stringify({
      offline: true, paidModelCalled: false, officialCli: cli, officialVersion: '0.2.1-rc.4', safetyPatch: 'derived',
      input: imageEnabled ? ['text', 'image'] : ['text'], originalPngSha256: image.digest,
      exactRequestBodiesSha256: createHash('sha256').update(rawBodies).digest('hex'),
      finalState: end, requestCount: requests.length, bodies: redact(requests),
      note: 'Loopback deterministic HTTP fixture, no real model; image is unchanged in this fixture. Production router may derive thumbnails separately.'
    }, null, 2) + '\n')
  } finally {
    abort.abort(); await adapter.close()
    await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections() })
    if (root.startsWith(join(await realpath(tmpdir()), 'dsh-image-offline-'))) await rm(root, { recursive: true, force: true })
  }
}, 60000)
