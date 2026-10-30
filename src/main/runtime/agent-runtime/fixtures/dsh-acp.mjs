// Controlled ACP protocol fixture; never a real DSH/model acceptance claim.
// The shell flow executes a real /bin/sh command under the real approval
// round-trip, so tests can prove execution and land real output on disk.
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('0.2.0-rc.2'); process.exit(0) }
if (args.includes('--dump-config')) {
  process.stdout.write(readFileSync(args[args.indexOf('--patch') + 1], 'utf8'))
  process.exit(0)
}
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const reply = (id, result) => send({ id, result })
const update = (sessionId, body) => send({ method: 'session/update', params: { sessionId, update: body } })
let nextSession = 0
const pending = new Map()
const sessions = new Map()
const runShell = (cwd, marker) => {
  // A real shell command in the session workspace, exactly as an enabled
  // tool-bash call would run under the DSH sandbox.
  execFileSync('/bin/sh', ['-c', `printf '%s' ${JSON.stringify(marker)} > ${JSON.stringify(join(cwd, 'dsh-shell-proof.txt'))}`])
  return readFileSync(join(cwd, 'dsh-shell-proof.txt'), 'utf8')
}
createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line)
  if (!msg.method) {
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (entry.kind === 'shell') {
      const outcome = msg.result?.outcome
      const allowed = outcome?.outcome === 'selected' && typeof outcome.optionId === 'string' && entry.allowOptionIds.includes(outcome.optionId)
      if (allowed) {
        const output = runShell(entry.cwd, entry.marker)
        update(entry.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: entry.toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: output } }] })
        update(entry.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `shell ran: ${output}` } })
      } else {
        update(entry.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: entry.toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'denied' } }] })
        update(entry.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'shell denied' } })
      }
      reply(entry.id, { stopReason: 'end_turn' })
      return
    }
    reply(entry.id, { stopReason: 'end_turn' })
    return
  }
  switch (msg.method) {
    case 'initialize': reply(msg.id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' }, agentCapabilities: { mcpCapabilities: { http: true }, sessionCapabilities: { list: {}, resume: {}, close: {} } } }); break
    case 'session/new': { const id = `session-${++nextSession}`; sessions.set(id, msg.params.cwd); reply(msg.id, { sessionId: id }); break }
    case 'session/list': reply(msg.id, { sessions: [] }); break
    case 'session/resume': if (typeof msg.params.cwd === 'string') sessions.set(msg.params.sessionId, msg.params.cwd); reply(msg.id, {}); break
    case 'session/close': reply(msg.id, {}); break
    case 'session/prompt': {
      const text = msg.params.prompt[0].text
      const sessionId = msg.params.sessionId
      if (text === 'hang') break
      if (text === 'approval') {
        const id = `permission-${msg.id}`
        pending.set(id, { kind: 'approval', id: msg.id })
        send({ id, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'call-1' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Once' }, { optionId: 'no', kind: 'reject_once', name: 'No' }] } })
        break
      }
      if (text === 'shell' || text.startsWith('shell:')) {
        // ACP announces the tool call and its kind before asking permission; the
        // permission request carries the same id, as a real ACP agent does.
        const marker = text.startsWith('shell:') ? text.slice('shell:'.length) : 'shell-ok'
        const toolCallId = 'call-shell-1'
        update(sessionId, { sessionUpdate: 'tool_call', toolCallId, title: 'Run shell command', kind: 'execute', status: 'pending' })
        const id = `permission-${msg.id}`
        pending.set(id, { kind: 'shell', id: msg.id, sessionId, cwd: sessions.get(sessionId) ?? process.cwd(), toolCallId, marker, allowOptionIds: ['yes'] })
        send({ id, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId, kind: 'execute', title: 'Run shell command' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Once' }, { optionId: 'no', kind: 'reject_once', name: 'No' }] } })
        break
      }
      if (args.includes('--history-updates')) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture answer one' } })
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' + two' } })
      }
      reply(msg.id, { stopReason: 'end_turn' }); break
    }
    case 'session/cancel': break
    default: send({ id: msg.id, error: { code: -32601, message: 'unknown method' } })
  }
})