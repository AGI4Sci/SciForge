/**
 * Packaged plugin-market acceptance, end to end and repeatable.
 *
 * What it proves, on a locally built (unsigned) macOS bundle:
 *   1. the packaged app starts from its own bundle with an isolated profile;
 *   2. the in-app market reads the catalogue that ships inside the app;
 *   3. installing a plugin through the real UI teaches the user how to use it;
 *   4. a neutral self-test capability returns its declared payload;
 *   5. disabling removes the capability, re-enabling restores it;
 *   6. after a real restart the plugins are still installed and usable;
 *   7. uninstalling removes them, and another restart loads nothing;
 *   8. approvals cannot be widened past what the artifact declares.
 *
 * A packaged build has no development bridge (it is gated on !app.isPackaged), so
 * the window is driven over the Chromium DevTools protocol and every call goes
 * through the app's own preload surface — the same calls its buttons make.
 *
 * Generate the neutral, temporary catalogue with:
 *   node --import tsx scripts/dsh-plugin-market-selftest.mjs --key-dir <keys>
 *
 * Usage:
 *   node scripts/packaged-market-acceptance.mjs \
 *     --app dist/mac-arm64/SciForge.app \
 *     --keyring <repo-external test keyring json> \
 *     --index .tmp/market-work/selftest/market/index.json \
 *     [--profile <dir>] [--port 9333] [--fresh] [--json]
 *
 * Nothing here needs production credentials: the trust configuration is an
 * explicitly isolated test keyring, and the profile lives outside the repository.
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveMarketWorkDir } from './market-work-dir.mjs'

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : (process.argv[index + 1] ?? 'true')
}
const has = (name) => process.argv.includes(`--${name}`)

const appPath = resolve(flag('app') ?? 'dist/mac-arm64/SciForge.app')
const keyring = flag('keyring')
const profile = resolve(flag('profile') ?? '/tmp/sciforge-packaged-acceptance')
const port = Number(flag('port') ?? '9333')
const jsonOnly = has('json')
// Optional: drive the same acceptance against a remote catalogue URL instead of the
// one bundled in the app. Used to prove the network download path (progress bytes,
// size guard, digest check) really runs, not just the local file read.
const indexArgument = flag('index')
const indexUrl = indexArgument && !/^https?:\/\//.test(indexArgument) ? resolve(indexArgument) : indexArgument
if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`)
if (!keyring || !existsSync(keyring)) throw new Error('--keyring must point at an existing repository-external test keyring')

const workDir = resolveMarketWorkDir()
const evidenceDir = join(workDir, 'packaged-acceptance')
await mkdir(evidenceDir, { recursive: true })

const steps = []
const record = (step, detail) => {
  steps.push({ step, ok: true, detail })
  if (!jsonOnly) console.log(`  ✓ ${step} — ${JSON.stringify(detail).slice(0, 220)}`)
}

/** ---------- app lifecycle ---------- */
let child
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function launch(reason) {
  child = spawn(join(appPath, 'Contents/MacOS/SciForge'), [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: indexUrl ? { ...process.env, SCIFORGE_MARKET_INDEX: indexUrl } : process.env
  })
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(500)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      if (targets.some((entry) => entry.type === 'page' && String(entry.title).includes('SciForge'))) {
        await sleep(3000)
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
  await sleep(1500)
}

/** ---------- CDP ---------- */
async function evaluate(expression) {
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
      expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 300_000
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  } finally {
    socket.close()
  }
}

/** ---------- phases (run inside the window) ---------- */
// Broker → typed IPC envelope → preload preserves code/category/message.
// See capabilities/broker.ts and shared/capability-transport-error.ts.
const PHASE_CONTRACT = String.raw`
  const requireCatalogue = (view) => {
    if (view?.error || !Array.isArray(view?.plugins) || view.plugins.length !== 1) fail('expected one healthy self-test catalogue: ' + JSON.stringify(view))
    const plugin = view.plugins[0]
    if (!plugin.tools.some((tool) => tool.id === 'market-selftest.ping')) fail('self-test capability missing from catalogue')
    return plugin
  }
  const requirePing = (output, plugin) => {
    if (output?.ok !== true || output.capability !== 'market-selftest.ping' || output.plugin !== plugin.name) fail('self-test payload mismatch: ' + JSON.stringify(output))
  }
  const requireUnregistered = async (actionId, input) => {
    try { await call(actionId, input) } catch (error) {
      if (error?.code === 'unknown_capability' && error.category === 'rejected' && error.message === 'Capability ' + actionId + ' is not registered.') return
      throw error
    }
    fail(actionId + ': expected unknown_capability rejection')
  }
  const requireNoRegistration = (plugin) => {
    if (!Array.isArray(plugin.capabilities) || !plugin.capabilities.some((c) => c.id === 'market-selftest.ping') || plugin.capabilities.some((c) => c.registered !== false)) fail('capability registration remains or is missing: ' + JSON.stringify(plugin))
  }
`
const PHASE_INSTALL = String.raw`(async () => {
  const steps = []
  try {
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
  const step = (name, detail) => steps.push({ step: name, ok: true, detail })
  const fail = (message) => { throw new Error(message) }
  ${PHASE_CONTRACT}
  const market = window.sciforge.market

  // Open the real surface: dismiss a first-run dialog if it is up, then go to
  // Extensions → Market, which is where a user installs from.
  const dismiss = [...document.querySelectorAll('button')].find((b) => /^Close$/i.test(b.innerText.trim()))
  if (dismiss) { dismiss.click(); await new Promise((r) => setTimeout(r, 600)) }
  const nav = [...document.querySelectorAll('button, a')].find((el) => el.innerText.trim() === 'Extensions')
  if (!nav) fail('Extensions entry not found in the sidebar')
  nav.click()
  await new Promise((r) => setTimeout(r, 1200))
  const marketTab = [...document.querySelectorAll('[role="tab"], button')].find((el) => el.innerText.trim() === 'Market')
  if (!marketTab) fail('Market tab not found in the extension center')
  marketTab.click()
  await new Promise((r) => setTimeout(r, 2500))
  step('进入扩展中心 → 市场', { tab: 'Market' })

  const view = await market.list()
  if (view.error) fail('market list error: ' + view.error)
  const source = String(view.source?.location ?? view.source ?? '')
  // The runner substitutes %%CATALOGUE_SOURCE%% before this phase runs: either the
  // configured catalogue URL, or 'file' when the app should read its bundled one.
  const expected = '%%CATALOGUE_SOURCE%%'
  if (expected === 'file') {
    if (!source.includes('.app/Contents/Resources/market')) fail('catalogue did not come from the packaged app: ' + source)
  } else if (source !== expected) {
    fail('catalogue did not come from the configured URL: ' + source)
  }
  if (view.plugins.length !== 1) fail('expected one neutral self-test plugin, saw ' + view.plugins.length)
  step(expected === 'file' ? '打包版读自带市场索引' : '打包版读远端市场索引（环境配置的 URL）', { source, installable: view.plugins.map((p) => p.name + '@' + p.version), notInstallable: (view.notInstallable ?? []).length })

  const probe = requireCatalogue(view)
  if (!probe.tools.some((tool) => tool.id === 'market-selftest.ping')) fail('generate the neutral self-test catalogue first')

  const clickByText = (test, description) => {
    const target = [...document.querySelectorAll('button')].find((b) => test(b.innerText.trim()))
    if (!target) fail('button not found: ' + description)
    target.click()
  }
  const cardOf = (name) => [...document.querySelectorAll('article')].find((card) => card.innerText.includes(name))

  if (probe.installed) await market.uninstall({ packageName: probe.name })
  const card = cardOf(probe.name)
  if (!card) fail('self-test card missing from the market panel')
  const installButton = [...card.querySelectorAll('button')].find((b) => /Install/i.test(b.innerText))
  if (!installButton) fail('no install button on the self-test card')
  installButton.click()
  await new Promise((r) => setTimeout(r, 400))
  const confirmation = [...document.querySelectorAll('div, section')].map((el) => el.innerText || '').find((t) => t.includes('Approve and install')) ?? ''
  for (const tool of probe.tools) if (!confirmation.includes(tool.id)) fail('install confirmation did not list ' + tool.id)
  step('安装前展示声明的权限', { tools: probe.tools.map((t) => t.id) })
  clickByText((t) => /Approve and install/i.test(t), 'Approve and install')
  // Sample right away: a 5 KB artifact finishes in well under a second, so a slow
  // poll would only ever see the last phase. The phases and byte counts are real.
  const tightSamples = []
  const tightDeadline = Date.now() + 3000
  while (Date.now() < tightDeadline) {
    const progress = await market.progress({ packageName: probe.name }).catch(() => null)
    if (progress) {
      const sample = { phase: progress.phase, bytesReceived: progress.bytesReceived, bytesTotal: progress.bytesTotal }
      const last = tightSamples[tightSamples.length - 1]
      if (!last || JSON.stringify(last) !== JSON.stringify(sample)) tightSamples.push(sample)
    }
    if (progress?.phase === 'done' || progress?.phase === 'failed') break
    await new Promise((r) => setTimeout(r, 50))
  }
  step('安装进度（密集采样：阶段与字节）', { samples: tightSamples.slice(0, 12), phases: [...new Set(tightSamples.map((s) => s.phase))] })
  const progressSamples = []
  const sampleProgress = async () => {
    const progress = await market.progress({ packageName: probe.name }).catch(() => null)
    if (progress) progressSamples.push({ phase: progress.phase, bytesReceived: progress.bytesReceived, bytesTotal: progress.bytesTotal })
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((r) => setTimeout(r, 400))
    await sampleProgress()
    const entry = (await market.list()).plugins.find((p) => p.name === probe.name)
    if (entry?.installed && entry.enabled) break
    if (attempt === 59) fail('self-test plugin never reached installed+enabled through the UI')
  }
  await sampleProgress()
  const distinctSamples = progressSamples.filter((sample, position) =>
    position === 0 || JSON.stringify(sample) !== JSON.stringify(progressSamples[position - 1]))
  step('安装过程中的阶段与下载字节', { samples: distinctSamples.slice(0, 12) })
  const after = await market.list()
  const entry = after.plugins.find((p) => p.name === probe.name)
  step('通过界面安装并启用', { packageName: entry.name, installed: entry.installed, enabled: entry.enabled, registered: entry.capabilities.filter((c) => c.registered).map((c) => c.id) })

  // The card re-renders after install; give the panel a moment instead of asserting
  // on the first frame (a slow render must not look like a missing feature).
  let panel = document.querySelector('#extension-center-market-panel')
  let panelText = panel ? panel.innerText.replace(/\s+/g, ' ') : ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (/How to use it|如何使用/.test(panelText) && probe.tools.some((t) => panelText.includes(t.id))) break
    await new Promise((r) => setTimeout(r, 500))
    panel = document.querySelector('#extension-center-market-panel')
    panelText = panel ? panel.innerText.replace(/\s+/g, ' ') : ''
  }
  if (!/How to use it|如何使用/.test(panelText) || !probe.tools.some((t) => panelText.includes(t.id))) {
    fail('installed card does not explain how to use it | panel=' + (panel ? panelText.slice(0, 400) : 'MISSING #extension-center-market-panel')
      + ' | marketViewVisible=' + Boolean([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Market')))
  }
  step('已安装卡片给出使用入口', { showsCapabilityIds: true })

  let widened = false
  try {
    await market.install({ packageName: probe.name, approvalSnapshot: probe.approvalSnapshot, approvedPorts: probe.ports, approvedToolNames: [...probe.tools.map((t) => t.name), 'extra.tool'] })
  } catch (error) {
    const declared = probe.tools.map((t) => t.name).sort()
    const approved = [...new Set([...declared, 'extra.tool'])].sort()
    const expected = 'Approving ' + approved.join(', ') + ' does not match what ' + probe.name + ' declares (' + declared.join(', ') + ').'
    const message = String(error?.message ?? error).replace(/^Error invoking remote method 'market:install': Error: /, '').replace(/^Error: /, '')
    if (message !== expected) throw error
    widened = true
  }
  if (!widened) fail('the app accepted an approval list the artifact does not declare')
  step('拒绝与声明不符的授权列表', { refused: true })

  const call = async (actionId, input) => (await window.sciforge.capabilities.invoke({
    transportRequestId: uuid(), request: { actionId, invocationId: 'inv-' + uuid(), input }
  })).output

  const output = await call('market-selftest.ping', {})
  requirePing(output, probe)
  step('真实调用中性自检能力', { output })

  await market.setEnabled({ packageName: probe.name, enabled: false })
  const disabled = requireCatalogue(await market.list())
  if (disabled.installed !== true || disabled.enabled !== false) fail('plugin not disabled')
  requireNoRegistration(disabled)
  await requireUnregistered('market-selftest.ping', {})
  step('禁用后不可调用', { refused: true })

  await market.setEnabled({ packageName: probe.name, enabled: true })
  const again = await call('market-selftest.ping', {})
  requirePing(again, probe)
  if (JSON.stringify(again) !== JSON.stringify(output)) fail('re-enabled plugin payload mismatch')
  step('重新启用后恢复可用', { sameAsBefore: JSON.stringify(again) === JSON.stringify(output) })

  return JSON.stringify({ ok: true, phase: 'install-and-use', steps })
  } catch (error) { return JSON.stringify({ ok: false, error: String(error && error.message || error), steps }) }
})()`

const PHASE_RESTART = String.raw`(async () => {
  const steps = []
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
  const step = (name, detail) => steps.push({ step: name, ok: true, detail })
  const fail = (message) => { throw new Error(message) }
  ${PHASE_CONTRACT}
  const call = async (actionId, input) => (await window.sciforge.capabilities.invoke({
    transportRequestId: uuid(), request: { actionId, invocationId: 'inv-' + uuid(), input }
  })).output
  const view = await window.sciforge.market.list()
  const probe = requireCatalogue(view)
  for (const plugin of view.plugins) {
    if (plugin.installed !== true || plugin.enabled !== true) fail(plugin.name + ': not installed+enabled after restart')
  }
  step('重启后仍是已安装且已启用', view.plugins.map((p) => ({ name: p.name, installed: p.installed, enabled: p.enabled })))
  const registered = view.plugins.map((p) => ({ name: p.name, registered: p.capabilities.filter((c) => c.registered).map((c) => c.id) }))
  if (registered.some((entry) => entry.registered.length === 0)) fail('capabilities not registered after restart')
  step('重启后能力仍然登记', registered)
  const output = await call('market-selftest.ping', {})
  requirePing(output, probe)
  step('重启后中性自检能力仍可调用', { output })
  return JSON.stringify({ ok: true, phase: 'restart', steps })
})()`

const PHASE_UNINSTALL = String.raw`(async () => {
  const steps = []
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
  const step = (name, detail) => steps.push({ step: name, ok: true, detail })
  const fail = (message) => { throw new Error(message) }
  ${PHASE_CONTRACT}
  const market = window.sciforge.market
  const call = async (actionId, input) => (await window.sciforge.capabilities.invoke({
    transportRequestId: uuid(), request: { actionId, invocationId: 'inv-' + uuid(), input }
  })).output
  const before = await market.list()
  requireCatalogue(before)
  for (const plugin of before.plugins) await market.uninstall({ packageName: plugin.name })
  const after = await market.list()
  requireCatalogue(after)
  for (const plugin of after.plugins) {
    if (plugin.installed !== false) fail(plugin.name + ': still installed after uninstall')
    requireNoRegistration(plugin)
  }
  step('卸载后市场显示未安装', after.plugins.map((p) => ({ name: p.name, installed: p.installed })))
  for (const [actionId, input] of [['market-selftest.ping', {}]]) {
    await requireUnregistered(actionId, input)
    step('卸载后不可调用 ' + actionId, { refused: true })
  }
  return JSON.stringify({ ok: true, phase: 'uninstall', steps })
})()`

const PHASE_AFTER_UNINSTALL_RESTART = String.raw`(async () => {
  const steps = []
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
  const step = (name, detail) => steps.push({ step: name, ok: true, detail })
  const fail = (message) => { throw new Error(message) }
  ${PHASE_CONTRACT}
  const view = await window.sciforge.market.list()
  requireCatalogue(view)
  for (const plugin of view.plugins) {
    if (plugin.installed !== false) fail(plugin.name + ': came back after uninstall + restart')
    requireNoRegistration(plugin)
  }
  step('再次重启后没有残留加载', view.plugins.map((p) => ({ name: p.name, installed: p.installed })))
  const call = async (actionId, input) => (await window.sciforge.capabilities.invoke({
    transportRequestId: uuid(), request: { actionId, invocationId: 'inv-' + uuid(), input }
  })).output
  await requireUnregistered('market-selftest.ping', {})
  step('再次重启后能力仍未登记', { refused: true })
  return JSON.stringify({ ok: true, phase: 'after-uninstall-restart', steps })
})()`

/** ---------- run ---------- */
async function runPhase(label, expression) {
  const raw = await evaluate(expression)
  const parsed = JSON.parse(raw)
  if (parsed.ok === false) {
    for (const entry of parsed.steps ?? []) record(`${label}: ${entry.step}`, entry.detail)
    throw new Error(`${label} failed: ${parsed.error}`)
  }
  if (!parsed.ok) throw new Error(`${label} failed: ${JSON.stringify(parsed)}`)
  for (const entry of parsed.steps) record(`${label}: ${entry.step}`, entry.detail)
}

try {
  if (has('fresh')) await rm(profile, { recursive: true, force: true })
  await mkdir(join(profile, 'extensions'), { recursive: true })
  await cp(keyring, join(profile, 'extensions', 'dsh-publisher-keys.json'))
  record('准备隔离 profile 与测试信任', { profile, keyring: keyring.split('/').pop(), fresh: has('fresh') })

  await launch('first start')
  await runPhase('安装与使用', PHASE_INSTALL.replaceAll('%%CATALOGUE_SOURCE%%', indexUrl ?? 'file'))

  await stop()
  await launch('restart with plugins installed')
  await runPhase('重启后', PHASE_RESTART)

  await runPhase('卸载', PHASE_UNINSTALL)
  await stop()
  await launch('restart after uninstall')
  await runPhase('卸载后重启', PHASE_AFTER_UNINSTALL_RESTART)

  const report = { ok: true, app: appPath, profile, index: indexUrl ?? 'bundled-with-app', steps, finishedAt: new Date().toISOString() }
  await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (!jsonOnly) console.log(`\n全部通过（${steps.length} 步）。证据: ${join(evidenceDir, 'report.json')}`)
  process.stdout.write(`${JSON.stringify({ ok: true, steps: steps.length, evidence: join(evidenceDir, 'report.json') })}\n`)
  process.exitCode = 0
} catch (error) {
  const report = { ok: false, error: error instanceof Error ? error.message : String(error), app: appPath, steps, finishedAt: new Date().toISOString() }
  await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined)
  console.error(`失败: ${report.error}`)
  process.stdout.write(`${JSON.stringify({ ok: false, error: report.error, steps: steps.length, evidence: join(evidenceDir, 'report.json') })}\n`)
  process.exitCode = 1
} finally {
  await stop()
}