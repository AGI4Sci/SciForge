import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import yaml from 'YAML_MODULE'
if (process.argv.includes('--version')) { console.log('0.2.0-rc.2'); process.exit() }
const patch = readFileSync(process.argv[process.argv.indexOf('--patch') + 1], 'utf8')
const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expr: value }) })])
const rows = yaml.load(patch, { schema })
const composed = new Map()
for (const row of rows) composed.set(row.id, { ...composed.get(row.id), ...row, config: { ...composed.get(row.id)?.config, ...row.config } })
if (process.argv.includes('--dump-config')) { process.stdout.write(JSON.stringify([...composed.values()])); process.exit() }
const resolve = v => v?.expr ? process.env[v.expr.replace('process.env.', '')] : v
const config = composed.get('llm-pi-ai')?.config.providers['sciforge-model-router']
const acp = composed.get('acp').config
for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line)
  try {
    let result = {}
    if (msg.method === 'initialize') result = { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp' }, agentCapabilities: {} }
    else if (msg.method === 'session/new') {
      if (!config || acp.provider !== 'sciforge-model-router' || resolve(config.models[0].id) !== resolve(acp.model)) throw Error('missing_model_route')
      if (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) throw Error('upstream_env_leak')
      const response = await fetch(resolve(config.baseURL) + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env[config.apiKeyEnv], 'Content-Type': 'application/json' }, body: JSON.stringify({ model: resolve(acp.model), fixturePid: process.pid, messages: [{ role: 'user', content: 'fixture-protocol' }] }) })
      const body = await response.json()
      if (!response.ok || body.choices[0].message.content !== 'fixture-response') throw Error('route_failed')
      result = { sessionId: 'fixture-' + Date.now() }
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  } catch (e) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } }) + '\n') }
}
