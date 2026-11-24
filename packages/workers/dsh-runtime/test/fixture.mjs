import { createInterface } from 'node:readline'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const parsePatchRows = text => {
  try { return JSON.parse(text) } catch {
    const yaml = require('js-yaml')
    const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ __jsExpr: value }) })])
    return yaml.load(text, { schema })
  }
}
const args = process.argv.slice(2)
if (args.includes('--fixture-prefix-check') && args.filter(arg => arg === '--fixture-prefix-check').length !== 1) process.exit(3)
const barrierFile = args[args.indexOf('--barrier-file') + 1]
const releaseFile = args[args.indexOf('--release-file') + 1]
const waitAtBarrier = async name => {
  if (!barrierFile || !releaseFile || !args.includes(`--barrier-${name}`)) return
  writeFileSync(barrierFile, name)
  while (!existsSync(releaseFile)) await new Promise(resolve => setTimeout(resolve, 5))
}
const fixtureVersion = args.find(arg => arg.startsWith('--fixture-version='))?.split('=')[1]
if (args.includes('--version')) { console.log(fixtureVersion ?? '0.2.0-rc.2'); process.exit(0) }
if (args.includes('--dump-config')) {
  if (args.includes('--unsafe-config')) { console.log(JSON.stringify([{ id: 'shell', name: '@deepseek/tool-shell', disabled: false }])); process.exit(0) }
  // Simulate an install's own default config merged under the Host patch, so
  // tests can prove the patch does not force release-audited route values.
  const defaults = [
    { id: 'acp', config: { provider: 'stock-provider', model: 'stock-model' } },
    { id: 'approval', config: { policy: 'never' } },
    { id: 'session-telemetry-otel', disabled: false }
  ]
  if (args.includes('--fixture-minimal')) defaults.push(
    { id: 'prompt', name: '@deepseek-ai/dsh-system-prompt', config: { personaPrefix: 'SHARED SECRET', personaSuffix: 'SECRET' } },
    { id: 'instructions', name: '@deepseek-ai/dsh-agent-instructions' }
  )
  // Entries a newer release may introduce (all enabled by default upstream).
  if (args.includes('--fixture-new-tools')) defaults.push(
    { id: 'tool-working-directory', name: '@deepseek-ai/dsh-tool-working-directory' },
    { id: 'web', name: '@deepseek-ai/dsh-web' },
    { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek' },
    { id: 'subagent-spawn-in-process', name: '@deepseek-ai/dsh-subagent-spawn-in-process' }
  )
  const patchIndex = args.indexOf('--patch')
  if (patchIndex < 0) { process.stdout.write(JSON.stringify(defaults)); process.exit(0) }
  const patchText = readFileSync(args[patchIndex + 1], 'utf8')
  if (!args.includes('--fixture-defaults')) { process.stdout.write(patchText); process.exit(0) }
  const rows = new Map()
  const merge = row => { if (row && typeof row.id === 'string') rows.set(row.id, { ...rows.get(row.id), ...row, config: { ...rows.get(row.id)?.config, ...row.config } }) }
  for (const row of defaults) merge(row)
  for (const row of parsePatchRows(patchText)) {
    if (row.insert) { for (const inserted of row.insert) merge(inserted) }
    else merge(row)
  }
  process.stdout.write(JSON.stringify([...rows.values()]))
  process.exit(0)
}
const patchRows = args.includes('--patch') ? parsePatchRows(readFileSync(args[args.indexOf('--patch') + 1], 'utf8')).flatMap(row => row.insert ?? [row]) : []
const policyRow = patchRows.find(row => row.id === 'sciforge-permission-policy')
let onAgentCreated
if (policyRow) {
  const plugin = await import(policyRow.name)
  let current = process.env.DSH_PERMISSION_MODE
  plugin.apply({
    on: (event, hook, options) => { if (event === 'agent/created' && options?.global) onAgentCreated = hook },
    permissionPresets: { resolve: name => ({ sandbox: name }), set: (_session, name) => { current = name }, current: () => current },
    sandboxPolicy: { resolve: () => ({ mode: current }) }
  }, policyRow.config)
}
const acknowledgeSession = id => {
  const agent = { session: { id } }
  if (!args.includes('--skip-policy-hook')) onAgentCreated?.({ agent })
}
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const reply = (id, result) => send({ id, result })
const update = (sessionId, update) => send({ method: 'session/update', params: { sessionId, update } })
let nextSession = 0
const pending = new Map()
const mounted = new Map()
process.on('SIGTERM', () => { if (!args.includes('--ignore-sigterm')) setTimeout(() => process.exit(0), 90) })
createInterface({ input: process.stdin }).on('line', async line => {
  const msg = JSON.parse(line)
  if (!msg.method) {
    const entry = pending.get(msg.id)
    if (entry) {
      pending.delete(msg.id)
      update(entry.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(msg.result) } })
      reply(entry.id, { stopReason: 'end_turn' })
    }
    return
  }
  const p = msg.params
  switch (msg.method) {
    case 'initialize': reply(msg.id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' }, agentCapabilities: { mcpCapabilities: { http: true }, sessionCapabilities: { list: {}, resume: {}, close: {} } } }); break
    case 'session/new': { const id = `session-${++nextSession}`; mounted.set(id, p.mcpServers); acknowledgeSession(id); reply(msg.id, { sessionId: id }); break }
    case 'session/list': reply(msg.id, { sessions: [{ sessionId: 'saved-session', cwd: process.cwd() }] }); break
    case 'session/resume': { await waitAtBarrier('resume'); mounted.set(p.sessionId, p.mcpServers); acknowledgeSession(p.sessionId); reply(msg.id, {}); break }
    case 'session/close': mounted.delete(p.sessionId); reply(msg.id, {}); break
    case 'session/prompt': {
      const text = p.prompt[0].text
      if (args.includes('--require-mounted') && !mounted.get(p.sessionId)?.length) { send({ id: msg.id, error: { code: -32602, message: 'MCP not mounted in this process' } }); break }
      if (text.includes('structured-edits')) {
        // Standard ACP shape, deliberately split across cumulative updates.
        const diff = { type: 'diff', path: process.cwd() + '/test.txt', oldText: 'before\n', newText: 'after\n' + 'large detail\n'.repeat(3000) }
        update('foreign-session', { sessionUpdate: 'tool_call', toolCallId: 'foreign', kind: 'edit', status: 'completed', content: [diff] })
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'orphan', kind: 'edit', status: 'completed', content: [diff] })
        update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'native-edit', kind: 'edit', status: 'in_progress', content: [diff] })
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'native-edit', status: 'completed' })
        update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'text-spoof', kind: 'other', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify({ changes: [{ path: diff.path, diff: '@@ -1 +1 @@\n-before\n+after' }] }) } }] })
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      if (text === 'tools' || text === 'large-tools') {
        update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'host-call', title: 'Host gateway', status: 'pending' })
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'host-call', status: 'in_progress' })
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'host-call', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: text === 'large-tools' ? JSON.stringify({ source: '报告😀'.repeat(10000), tail: 'recoverable' }) : '{"operations":["op_read"]}' } }] })
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      if (text === 'slow') await new Promise(resolve => setTimeout(resolve, 600))
      // Keeps the runtime visibly active for well over a second so an idle
      // prompt budget (maximum silence) must not expire while it streams.
      if (text === 'slowstream') {
        for (let index = 0; index < 12; index++) {
          update(p.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'stream', content: { type: 'text', text: `chunk-${index}` } })
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      // Complete silence for longer than the idle budget, then a late answer.
      if (text === 'silent') {
        await new Promise(resolve => setTimeout(resolve, 1500))
        update(p.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'late', content: { type: 'text', text: 'late' } })
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      // Steady progress that belongs to a different session: it must not be
      // mistaken for activity on the prompt that is waiting.
      if (text === 'otherstream') {
        for (let index = 0; index < 8; index++) {
          update('other-session', { sessionUpdate: 'agent_message_chunk', messageId: 'other', content: { type: 'text', text: `other-${index}` } })
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      if (text === 'badreply') { send({ id: msg.id }); break }
      if (text === 'hang') break
      if (text === 'cancelbarrier') { pending.set(`cancel-${msg.id}`, { id: msg.id, sessionId: p.sessionId }); break }
      if (text === 'malformed') { process.stdout.write('not json\n'); break }
      if (text === 'env') {
        update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify({ env: process.env, pid: process.pid, cwd: process.cwd() }) } })
        reply(msg.id, { stopReason: 'end_turn' }); break
      }
      if (text === 'crash') { process.exit(17) }
      if (text === 'toolhold') update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'inflight', title: 'Host pending', status: 'in_progress' })
      if (text === 'hold' || text === 'approval' || text === 'toolhold') {
        const id = `permission-${msg.id}`
        pending.set(id, { id: msg.id, sessionId: p.sessionId })
        send({ id, method: 'session/request_permission', params: { sessionId: p.sessionId, toolCall: { toolCallId: 'call-1' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Once' }, { optionId: 'no', kind: 'reject_once', name: 'No' }] } })
        break
      }
      update(p.sessionId, { sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: { type: 'text', text: 'thinking' } })
      update(p.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hello' } })
      reply(msg.id, { stopReason: 'end_turn' })
      break
    }
    case 'session/cancel': {
      await waitAtBarrier('cancel')
      for (const [key, entry] of pending) if (entry.sessionId === p.sessionId) {
        setTimeout(() => { update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LATE' } }); reply(entry.id, { stopReason: 'end_turn' }); pending.delete(key) }, 40)
      }
      break
    }
    default: send({ id: msg.id, error: { code: -32601, message: 'unknown method' } })
  }
})
