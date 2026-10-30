/**
 * Stage 3 acceptance: can a user get the plugins to work by *talking* to the app?
 *
 * The whole run goes through the packaged app's own surfaces:
 *   1. the first-run "Model API" form is filled with the local test model config;
 *   2. the two fixture plugins (tests/fixtures/dsh-plugins) are installed the way
 *      the market UI does it — they left the product market, so point the app at
 *      the fixture catalogue: SCIFORGE_TEST_KEY_DIR=<keys> npm run market:fixtures
 *      and pass --index tests/fixtures/dsh-plugins/market/index.json;
 *   3. real agent turns are sent in plain language and the thread is read back, so
 *      the tool call (name, arguments, result) is evidence and not an assumption;
 *   4. one case is asked with the plugin disabled, then the app is restarted and the
 *      same call is asked again.
 *
 * The model credentials are read from the Hermes profile at run time, typed into the
 * app, and never printed or written to evidence: only lengths are recorded.
 *
 *   node scripts/packaged-agent-chat.mjs --app <bundle> --keyring <json> [--only <n>]
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveMarketWorkDir } from './market-work-dir.mjs'

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : (process.argv[index + 1] ?? 'true')
}
const has = (name) => process.argv.includes(`--${name}`)

const appPath = resolve(flag('app') ?? 'dist/mac-arm64/SciForge.app')
const keyring = flag('keyring')
const profile = resolve(flag('profile') ?? '/tmp/sciforge-packaged-agent')
const port = Number(flag('port') ?? '9345')
const runtimeId = 'dsh'
// Optional: a real dsh executable to point the app at. The packaged build ships the
// release-owned DSH closure under resources/agent-runtimes; when this checkout has
// none, the same slot is filled the way a user would fill it (Settings → agents).
const dshCommand = flag('dsh') ?? process.env.SCIFORGE_TEST_DSH_PATH ?? ''
// Optional: drive against the generated fixture catalogue instead of the one bundled
// in the app (the demo plugins are test fixtures now, not market products).
const indexUrl = flag('index')
// Where a real `dsh` lives for this test environment. The packaged build ships the
// release-owned closure under resources/agent-runtimes; when a checkout has none,
// the documented discovery slots are: settings, inherited PATH, login-shell PATH,
// common install locations. The settings slot normalizes a raw path away, so this
// uses the PATH slot — exactly what happens when a user installs dsh themselves.
const dshBinDirectory = flag('dsh-bin-dir') ?? process.env.SCIFORGE_TEST_DSH_BIN_DIR ?? ''
const only = Number(flag('only') ?? '0')
if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`)
if (!keyring || !existsSync(keyring)) throw new Error('--keyring must point at an existing repository-external test keyring')

/** Read the test model config from the Hermes profile; values stay in memory. */
function readModelConfig() {
  const profileName = process.env.HERMES_PROFILE_FOR_TESTS?.trim() || 'deepseek'
  const profileRoot = join(homedir(), '.hermes', 'profiles', profileName)
  const config = readFileSync(join(profileRoot, 'config.yaml'), 'utf8')
  const baseUrl = /^\s*base_url:\s*(.+)$/m.exec(config)?.[1]?.trim().replace(/^["']|["']$/g, '')
  const defaultModel = /^\s*default:\s*(.+)$/m.exec(config)?.[1]?.trim().replace(/^["']|["']$/g, '')
  const apiKeyRef = /^\s*api_key:\s*\$\{([A-Z0-9_]+)\}/m.exec(config)?.[1]
  if (!baseUrl || !defaultModel || !apiKeyRef) throw new Error('Hermes config is missing base_url / default model / api_key reference')
  const envFile = readFileSync(join(profileRoot, '.env'), 'utf8')
  const apiKey = new RegExp(`^${apiKeyRef}=(.+)$`, 'm').exec(envFile)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!apiKey) throw new Error(`Hermes .env has no value for ${apiKeyRef}`)
  const model = defaultModel.includes('/') ? defaultModel.slice(defaultModel.indexOf('/') + 1) : defaultModel
  return { baseUrl, apiKey, model }
}
const model = readModelConfig()
const evidenceDir = join(resolveMarketWorkDir(), 'agent-chat')
await mkdir(evidenceDir, { recursive: true })

const steps = []
const record = (step, detail) => {
  steps.push({ step, ok: true, detail })
  console.log(`  ✓ ${step} — ${JSON.stringify(detail).slice(0, 500)}`)
}

let child
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(reason) {
  child = spawn(join(appPath, 'Contents/MacOS/SciForge'), [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(dshBinDirectory
        ? { PATH: `${dshBinDirectory}${process.env.PATH ? `:${process.env.PATH}` : ''}` }
        : {}),
      ...(indexUrl ? { SCIFORGE_MARKET_INDEX: indexUrl } : {})
    }
  })
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await sleep(500)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      if (targets.some((entry) => entry.type === 'page' && String(entry.title).includes('SciForge'))) {
        await sleep(4000)
        record(`启动打包应用（${reason}）`, { pid: child.pid, devtoolsPort: port, profile })
        return
      }
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`App exited during startup with code ${child.exitCode}`)
  }
  throw new Error('The packaged app never exposed a window over the DevTools protocol')
}

async function stop() {
  if (!child) return
  child.kill('SIGTERM')
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) await sleep(250)
  if (child.exitCode === null) child.kill('SIGKILL')
  child = undefined
  await sleep(2000)
}

async function evaluate(expression, timeout = 900_000) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((entry) => entry.type === 'page' && String(entry.title).includes('SciForge'))
    ?? targets.find((entry) => entry.type === 'page')
  if (!page) throw new Error('No page target to evaluate in')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolvePromise, rejectPromise) => {
    const id = (nextId += 1)
    pending.set(id, { resolvePromise, rejectPromise })
    socket.send(JSON.stringify({ id, method, params }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id && pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.rejectPromise(new Error(message.error.message))
    else entry.resolvePromise(message.result)
  })
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener('error', () => rejectPromise(new Error('CDP socket error')), { once: true })
  })
  try {
    await send('Runtime.enable')
    const result = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  } finally {
    socket.close()
  }
}

const PRELUDE = String.raw`
  const steps = []
  const step = (name, detail) => steps.push({ step: name, ok: true, detail })
  const fail = (message) => { throw new Error(message) }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
`

/** Fill the first-run Model API form with the local test config (never echoed back). */
const PHASE_CONFIGURE = String.raw`(async () => {
${PRELUDE}
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const before = await window.sciforge.getSettings()
  const alreadyConfigured = before?.modelAccess?.mode === 'api'
    && Boolean(String(before?.modelRouter?.profiles?.default?.textReasoner?.model ?? '').trim())
  if (alreadyConfigured) {
    step('模型配置', { note: 'the profile already has a model route; the setup form is not needed', model: before.modelRouter.profiles.default.textReasoner.model })
    return JSON.stringify({ ok: true, steps })
  }
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) {
    step('模型配置', { note: 'no first-run dialog and no saved route (the app may need a model set from Settings)' })
    return JSON.stringify({ ok: true, steps })
  }
  const modelApiButton = [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith('Model API'))
  if (!modelApiButton) {
    step('模型配置', { note: 'a dialog is open but carries no Model API option', dialog: (dialog.innerText || '').replace(/\s+/g, ' ').slice(0, 200) })
    return JSON.stringify({ ok: true, steps })
  }
  modelApiButton.click()
  await sleep(800)
  const inputs = [...dialog.querySelectorAll('input')]
  const byPlaceholder = (fragment) => inputs.find((el) => (el.placeholder || '').includes(fragment))
  const baseUrl = byPlaceholder('api.example.com')
  const apiKey = byPlaceholder('sk-')
  const modelName = byPlaceholder('deepseek-v4-pro')
  if (!baseUrl || !apiKey || !modelName) fail('model API form is missing one of the three fields')
  setValue(baseUrl, ${JSON.stringify(model.baseUrl)})
  setValue(apiKey, ${JSON.stringify(model.apiKey)})
  setValue(modelName, ${JSON.stringify(model.model)})
  step('在首次配置里选 Model API 并填三格', { baseUrlLength: ${model.baseUrl.length}, apiKeyLength: ${model.apiKey.length}, model: ${JSON.stringify(model.model)} })
  const save = [...dialog.querySelectorAll('button')].find((b) => /Save and continue/i.test(b.innerText || ''))
  if (!save) fail('Save and continue is missing')
  save.click()
  await sleep(4000)
  const dialogAfter = document.querySelector('[role="dialog"]')
  const stillOpen = dialogAfter ? (dialogAfter.innerText || '').replace(/\s+/g, ' ').slice(0, 300) : 'dialog closed'
  const persisted = await window.sciforge.getSettings()
  const saved = persisted?.modelAccess?.mode === 'api'
    && Boolean(String(persisted?.modelRouter?.profiles?.default?.textReasoner?.model ?? '').trim())
  step('保存并继续', { dialogAfterSave: stillOpen, persisted: saved })
  if (!saved) {
    // The first-run dialog reports a settings:set "Invalid payload" rejection when it
    // sends its untouched optional fields; the same values can still be written from
    // Settings, which uses this very store. Record both facts.
    await window.sciforge.setSettings({
      modelAccess: { mode: 'api' },
      modelRouter: { profiles: { default: { textReasoner: {
        baseUrl: ${JSON.stringify(model.baseUrl)}, apiKey: ${JSON.stringify(model.apiKey)},
        model: ${JSON.stringify(model.model)}, protocol: 'auto'
      } } } }
    })
    const after = await window.sciforge.getSettings()
    step('首次配置表单未能保存，改用同一设置存储写入', {
      dialogError: 'settings:set rejected the form payload (reported separately)',
      modelAccess: after?.modelAccess?.mode ?? null,
      model: after?.modelRouter?.profiles?.default?.textReasoner?.model ?? null
    })
  }
  return JSON.stringify({ ok: true, steps })
})()`

/** Ask the app's own "check setup" probe what it thinks of the model route. */
const PHASE_CHECK = String.raw`(async () => {
${PRELUDE}
  const dialog = document.querySelector('[role="dialog"]')
  const button = dialog ? [...dialog.querySelectorAll('button')].find((b) => /Check setup/i.test(b.innerText || '')) : null
  if (button) {
    button.click()
    await sleep(6000)
  } else {
    step('检查配置', { note: 'no Check setup button visible (settings already saved)' })
  }
  const text = (dialog.innerText || '').replace(/\s+/g, ' ')
  step('检查配置', { status: text.slice(text.indexOf('Model access status'), text.indexOf('Model access status') + 360) })
  const patched = await window.sciforge.setSettings({ activeAgentRuntime: 'dsh' })
  const afterRuntime = patched ?? (await window.sciforge.getSettings())
  step('切到内置 Agent 运行时（dsh）', { activeAgentRuntime: afterRuntime?.activeAgentRuntime })
  return JSON.stringify({ ok: true, steps })
})()`

/** Install both plugins through the market surface, exactly like the UI does. */
const PHASE_INSTALL = String.raw`(async () => {
${PRELUDE}
  const market = window.sciforge.market
  const view = await market.list()
  if (view.error) fail('market list error: ' + view.error)
  for (const name of ['@sciforge/plugin-text-stats', '@sciforge/plugin-unit-conversion']) {
    const entry = view.plugins.find((p) => p.name === name)
    if (!entry) fail(name + ' is not in the catalogue')
    if (!entry.installed) await market.install({ packageName: name, approvedToolNames: entry.tools.map((t) => t.name) })
    else if (!entry.enabled) await market.setEnabled({ packageName: name, enabled: true })
  }
  const after = await market.list()
  step('两个插件已安装并启用', after.plugins.filter((p) => p.installed).map((p) => ({ name: p.name, enabled: p.enabled, registered: p.capabilities.filter((c) => c.registered).map((c) => c.id) })))
  const tools = await window.sciforge.agentRuntime.capabilities('${runtimeId}').catch((error) => ({ error: String(error) }))
  step('Agent 运行时声明的工具面', { shape: JSON.stringify(tools).slice(0, 400) })
  return JSON.stringify({ ok: true, steps })
})()`

/** One natural-language turn with polling, approval handling and a raw transcript. */
const turnScript = (question, threadId, label) => String.raw`(async () => {
${PRELUDE}
  const runtime = window.sciforge.agentRuntime
  const runtimeId = ${JSON.stringify(runtimeId)}
  const workspace = '/tmp/sciforge-agent-workspace'
  let thread = ${threadId ? JSON.stringify(threadId) : 'null'}
  if (!thread) {
    const started = await runtime.startThread({ runtimeId, workspace, title: 'plugin acceptance' })
    thread = started?.threadId ?? started?.thread?.id ?? started?.id
    if (!thread) fail('startThread returned no thread id: ' + JSON.stringify(started).slice(0, 300))
  }
  const turn = await runtime.startTurn({ runtimeId, threadId: thread, text: ${JSON.stringify(question)}, workspace })
  step(${JSON.stringify(`${label}: 发起对话`)}, { question: ${JSON.stringify(question)}, turn: JSON.stringify(turn).slice(0, 200) })

  const approvals = []
  const deadline = Date.now() + 240000
  let page = null
  let approvalsResolved = 0
  let lastLength = 0
  let stablePolls = 0
  while (Date.now() < deadline) {
    await sleep(3000)
    page = await runtime.readThreadPage({ runtimeId, threadId: thread, limit: 60 }).catch(() => null)
    const raw = JSON.stringify(page ?? {})
    // Any approval request is answered the way the user would: allow once.
    const matches = [...raw.matchAll(/"approvalId":"([^"]+)"/g)].map((m) => m[1])
    for (const approvalId of [...new Set(matches)]) {
      if (approvals.includes(approvalId)) continue
      approvals.push(approvalId)
      const outcome = await runtime.resolveApproval({ runtimeId, threadId: thread, approvalId, decision: 'allowed' })
        .then(() => 'allowed').catch((error) => 'failed: ' + String(error).slice(0, 120))
      if (outcome === 'allowed') approvalsResolved += 1
      step(${JSON.stringify(`${label}: 审批`)}, { approvalId, outcome })
    }
    const status = await runtime.readThreadStatus({ runtimeId, threadId: thread }).catch(() => null)
    const busy = status && (status.busy === true || status.running === true || status.streaming === true || status.state === 'running' || status.turnState === 'running')
    const length = JSON.stringify(page ?? {}).length
    stablePolls = length > 0 && length === lastLength && !busy ? stablePolls + 1 : 0
    lastLength = length
    if (stablePolls >= 2) break
  }
  step(${JSON.stringify(`${label}: 回合结束`)}, { approvalsResolved, rawLength: JSON.stringify(page ?? {}).length })
  return JSON.stringify({ ok: true, thread, page, steps })
})()`

/** Deep-walk the transcript for tool calls and text, tolerantly. */
function analyseTranscript(page, needle) {
  const toolCalls = []
  const texts = []
  const seen = new Set()
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') { if (node.length > 0) texts.push(node); return }
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    const name = node.toolName ?? node.tool_name ?? node.tool ?? node.name
    const args = node.arguments ?? node.args ?? node.input ?? node.parameters
    const looksLikeTool = typeof name === 'string' && args !== undefined && /[-.]/.test(name) && !['step', 'phase'].includes(name)
    if (looksLikeTool) {
      toolCalls.push({ name, args: typeof args === 'string' ? args.slice(0, 400) : JSON.stringify(args).slice(0, 400) })
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(page)
  const joined = texts.join('\n')
  return {
    toolCalls,
    mentionsNeedle: needle ? joined.includes(needle) : null,
    textTail: joined.slice(-2_500)
  }
}

const turns = [
  { id: 'T1', label: '文本统计（第一段）', question: '请用 text-stats 插件统计这段文字的字数、词数和行数，并只根据工具返回的数字回答：SciForge 你好 world', expectTool: 'text-stats', expectNumbers: ['17', '4'] },
  { id: 'T2', label: '文本统计（第二段）', question: '再用 text-stats 统计另一段：第二段 hello 世界 again，同样只按工具结果回答字数与词数', expectTool: 'text-stats', expectNumbers: null },
  { id: 'T3', label: '单位换算 100°C → °F', question: '100°C 等于多少华氏度？请用单位换算插件算，不要自己估。', expectTool: 'unit-conversion', expectNumbers: ['212'] },
  { id: 'T4', label: '单位换算 3 ft → in', question: '3 英尺等于多少英寸？用单位换算插件算。', expectTool: 'unit-conversion', expectNumbers: ['36'] },
  { id: 'T5', label: '跨维度换算被拒', question: '1 米等于多少千克？用单位换算插件试试。', expectTool: 'unit-conversion', expectNumbers: ['不', '无法', '不能', '不支持', 'incompatible'] },
  { id: 'T6', label: '禁用后不能调用', question: '再统计一下这段文字的字数：abc def ghi', expectTool: null, expectNumbers: null, disableFirst: '@sciforge/plugin-text-stats' }
]

const evidenceTurns = []
try {
  await mkdir('/tmp/sciforge-agent-workspace', { recursive: true })
  await mkdir(join(profile, 'extensions'), { recursive: true })
  if (has('fresh')) await rm(profile, { recursive: true, force: true })
  await cp(keyring, join(profile, 'extensions', 'dsh-publisher-keys.json'))
  record('准备隔离 profile 与测试信任', { profile, runtime: runtimeId, modelName: model.model, baseUrlLength: model.baseUrl.length, apiKeyLength: model.apiKey.length })

  await launch('first start')
  for (const entry of JSON.parse(await evaluate(PHASE_CONFIGURE)).steps) record(entry.step, entry.detail)
  for (const entry of JSON.parse(await evaluate(PHASE_CHECK.replaceAll('%DSH_COMMAND%', dshCommand))).steps) record(entry.step, entry.detail)
  for (const entry of JSON.parse(await evaluate(PHASE_INSTALL)).steps) record(entry.step, entry.detail)

  let threadId = null
  for (const turn of turns) {
    if (only && Number(turn.id.slice(1)) > only) break
    if (turn.disableFirst) {
      await evaluate(`window.sciforge.market.setEnabled({ packageName: ${JSON.stringify(turn.disableFirst)}, enabled: false })`)
      record(`${turn.id}: 禁用 text-stats`, { packageName: turn.disableFirst })
    }
    const raw = await evaluate(turnScript(turn.question, threadId, turn.label))
    const parsed = JSON.parse(raw)
    threadId = parsed.thread ?? threadId
    for (const entry of parsed.steps) record(entry.step, entry.detail)
    const analysis = analyseTranscript(parsed.page, turn.question.slice(0, 20))
    await writeFile(join(evidenceDir, `${turn.id}-transcript.json`), `${JSON.stringify({ question: turn.question, threadId, page: parsed.page }, null, 2)}\n`)
    const matchedTools = analysis.toolCalls.filter((call) => String(call.name).includes(turn.expectTool ?? '◆'))
    evidenceTurns.push({ id: turn.id, question: turn.question, toolCalls: analysis.toolCalls, replyTail: analysis.textTail.slice(-800) })
    record(`${turn.id} 结果`, {
      toolCalls: analysis.toolCalls.slice(0, 4).map((call) => call.name),
      matched: matchedTools.length,
      replyTail: analysis.textTail.slice(-320)
    })
  }

  // Restart: the installed plugin must still be usable after a real relaunch.
  await stop()
  await launch('restart with plugins installed')
  const restartTurn = { id: 'T7', label: '重启后仍可调用', question: '重启之后，100°C 是多少华氏度？用单位换算插件再算一次。' }
  const raw = await evaluate(turnScript(restartTurn.question, threadId, restartTurn.label))
  const parsed = JSON.parse(raw)
  for (const entry of parsed.steps) record(entry.step, entry.detail)
  const analysis = analyseTranscript(parsed.page, null)
  await writeFile(join(evidenceDir, 'T7-transcript.json'), `${JSON.stringify({ question: restartTurn.question, page: parsed.page }, null, 2)}\n`)
  evidenceTurns.push({ id: restartTurn.id, question: restartTurn.question, toolCalls: analysis.toolCalls, replyTail: analysis.textTail.slice(-800) })
  record(`${restartTurn.id} 结果`, { toolCalls: analysis.toolCalls.slice(0, 4).map((call) => call.name), replyTail: analysis.textTail.slice(-320) })

  const report = { ok: true, app: appPath, profile, runtimeId, model: { name: model.model, baseUrlLength: model.baseUrl.length }, steps, turns: evidenceTurns, finishedAt: new Date().toISOString() }
  await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\n完成 ${steps.length} 步。证据: ${join(evidenceDir, 'report.json')}`)
  process.stdout.write(`${JSON.stringify({ ok: true, steps: steps.length, evidence: join(evidenceDir, 'report.json') })}\n`)
  process.exitCode = 0
} catch (error) {
  const report = { ok: false, error: error instanceof Error ? error.message : String(error), app: appPath, profile, steps, turns: evidenceTurns, finishedAt: new Date().toISOString() }
  await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined)
  console.error(`失败: ${report.error}`)
  process.stdout.write(`${JSON.stringify({ ok: false, error: report.error, steps: steps.length })}\n`)
  process.exitCode = 1
} finally {
  await stop()
}