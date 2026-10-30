// Controlled subprocess, not DSH/model acceptance. ACP close/resume semantics
// mirror official packages/acp/acp/src/index.ts and session.ts.
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('0.2.0-rc.2'); process.exit(0) }
if (args.includes('--dump-config')) { process.stdout.write(readFileSync(args[args.indexOf('--patch') + 1], 'utf8')); process.exit(0) }
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const reply = (id, result) => send({ id, result })
const sessions = new Map()
const clients = new Map()
let held
const trace = value => appendFileSync('trace.jsonl', JSON.stringify({ pid: process.pid, ...value }) + '\n')
const disk = id => join(process.cwd(), `${id}.json`)
async function dispatch(msg) {
 trace({ method: msg.method, id: msg.id })
 switch (msg.method) {
 case 'initialize': reply(msg.id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp' }, agentCapabilities: { mcpCapabilities: { http: true }, sessionCapabilities: args.includes('--no-resume') ? { close: {} } : { resume: {}, close: {} } } }); return
 case 'session/new': {
  const id = 'persistent-session'; const s = { history: [], servers: msg.params.mcpServers }; sessions.set(id, s)
  writeFileSync(disk(id), JSON.stringify(s)); reply(msg.id, { sessionId: id }); return
 }
 case 'session/resume': {
  const id = msg.params.sessionId
  if (sessions.has(id) || !existsSync(disk(id))) throw new Error('session active or missing')
  const s = JSON.parse(readFileSync(disk(id))); s.servers = msg.params.mcpServers; sessions.set(id, s)
  const config = s.servers[0]
  if (config) {
   const client = new Client({ name: 'persistent-acp-fixture', version: '1' })
   await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: Object.fromEntries(config.headers.map(h => [h.name, h.value])) } }))
   await client.listTools()
   clients.set(id, client); trace({ clientConnected: true })
  }
  reply(msg.id, {}); return
 }
 case 'session/close': {
  const s = sessions.get(msg.params.sessionId); if (!s) throw new Error('unknown session')
  await clients.get(msg.params.sessionId)?.close(); clients.delete(msg.params.sessionId)
  writeFileSync(disk(msg.params.sessionId), JSON.stringify(s)); sessions.delete(msg.params.sessionId); reply(msg.id, {}); return
 }
 case 'session/prompt': {
  const s = sessions.get(msg.params.sessionId); if (!s) throw new Error('unknown session')
  const text = msg.params.prompt[0].text
  if (text === 'cancel-hold') { held = msg; return }
  const config = s.servers[0]; if (!config) throw new Error('MCP missing')
  const client = clients.get(msg.params.sessionId)
   await client.listTools()
   const found = await client.callTool({ name: 'sciforge_discover', arguments: {} })
   const operationRef = found.content.find(c => c.type === 'text').text.match(/op_[A-Za-z0-9_-]{20,}/u)?.[0]
   if (!operationRef) throw new Error('operation missing')
   if (text === 'cancel-tool') held = msg
   const result = await client.callTool({ name: 'sciforge_invoke', arguments: { operationRef, input: { value: text } } })
   if (result.isError) throw new Error(JSON.stringify(result))
   if (text === 'after-cancel') while (!existsSync(join(process.cwd(), 'release-after-cancel'))) await new Promise(resolve => setTimeout(resolve, 5))
   s.history.push(text)
   trace({ completed: text, history: s.history, endpoint: config.url })
   send({ method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(s.history) } } } })
   reply(msg.id, { stopReason: 'end_turn' })
  return
 }
 case 'session/cancel': {
  if (!held) return
  const old = held; held = undefined
  // Response is a quiescence barrier. A duplicate old response after later prompt
  // must not finish that new turn (JSON-RPC IDs remain distinct).
  reply(old.id, { stopReason: 'cancelled' })
  setTimeout(() => { trace({ lateResponse: old.id }); reply(old.id, { stopReason: 'end_turn' }) }, 50)
  return
 }
 default: throw new Error('unsupported method')
 }
}
createInterface({ input: process.stdin }).on('line', line => {
 const msg = JSON.parse(line)
 void dispatch(msg).catch(error => { trace({ error: error.message }); send({ id: msg.id, error: { code: -32602, message: error.message } }) })
})
