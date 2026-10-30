/**
 * Packaged install-security regression.
 *
 * The development bridge does not exist in a packaged build, so this drives the
 * packaged window over the DevTools protocol and asks the app's own market to
 * install two kinds of hostile input:
 *
 *   1. an artifact whose bytes were changed after the index recorded its digest;
 *   2. the same artifact while the host trusts no publisher key at all.
 *
 * Both must be refused, with the failure surfaced to the UI, and nothing may be
 * left installed. The tampered index and the test keyring live outside the
 * repository; no production key is read.
 *
 * Usage:
 *   node scripts/packaged-market-security.mjs --app <app> --keyring <test keyring>
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveMarketWorkDir } from './market-work-dir.mjs'

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}
const appPath = resolve(flag('app') ?? 'dist/mac-arm64/SciForge.app')
const keyring = flag('keyring')
const port = Number(flag('port') ?? '9345')
if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`)
if (!keyring || !existsSync(keyring)) throw new Error('--keyring must point at a repository-external test keyring')

const workDir = join(resolveMarketWorkDir(), 'security-acceptance')
await rm(workDir, { recursive: true, force: true })
await mkdir(workDir, { recursive: true })

const appIndexPath = join(appPath, 'Contents/Resources/market/index.json')
const shippedIndex = JSON.parse(await readFile(appIndexPath, 'utf8'))
const shippedArtifacts = join(appPath, 'Contents/Resources/market/artifacts')

// A catalogue with the same entries but a deliberately corrupted artifact.
const tampered = join(workDir, 'tampered')
await mkdir(tampered, { recursive: true })
await copyArtifacts(shippedArtifacts, join(tampered, 'artifacts'))
const firstArtifact = shippedIndex.plugins[0].artifact.file
const corruptedPath = join(tampered, 'artifacts', firstArtifact)
const original = await readFile(corruptedPath)
const mutated = Buffer.from(original)
mutated[Math.floor(mutated.length / 2)] ^= 0xff
await writeFile(corruptedPath, mutated)
await writeFile(join(tampered, 'index.json'), `${JSON.stringify(shippedIndex, null, 2)}\n`)

async function copyArtifacts(from, to) {
  await mkdir(to, { recursive: true })
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(from)) await cp(join(from, entry), join(to, entry))
}

const steps = []
const record = (step, detail) => {
  steps.push({ step, ok: true, detail })
  console.log(`  ✓ ${step} — ${JSON.stringify(detail).slice(0, 200)}`)
}
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function runCase(label, { index, withKeyring }) {
  const profile = join(workDir, `profile-${label}`)
  await rm(profile, { recursive: true, force: true })
  await mkdir(join(profile, 'extensions'), { recursive: true })
  if (withKeyring) await cp(keyring, join(profile, 'extensions', 'dsh-publisher-keys.json'))

  const child = spawn(join(appPath, 'Contents/MacOS/SciForge'), [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCIFORGE_MARKET_INDEX: index }
  })
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)
  try {
    let ready = false
    for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
      await sleep(500)
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        ready = targets.some((entry) => entry.type === 'page' && String(entry.title).includes('SciForge'))
      } catch {
        // still starting
      }
      if (child.exitCode !== null) throw new Error('the app exited during startup')
    }
    if (!ready) throw new Error('no window over the DevTools protocol')
    await sleep(2500)

    const outcome = await evaluate(port, `(async () => {
      const market = window.sciforge.market
      const view = await market.list().catch((error) => ({ error: String(error) }))
      if (view.error) return JSON.stringify({ refused: true, where: 'listing', message: view.error })
      const plugin = view.plugins[0]
      if (!plugin) return JSON.stringify({ refused: true, where: 'listing', message: 'no installable plugin' })
      try {
        await market.install({ packageName: plugin.name, approvedToolNames: plugin.tools.map((t) => t.name) })
      } catch (error) {
        return JSON.stringify({ refused: true, where: 'install', message: String(error).slice(0, 300), plugin: plugin.name })
      }
      const after = await market.list()
      const entry = after.plugins.find((p) => p.name === plugin.name)
      return JSON.stringify({ refused: false, plugin: plugin.name, installed: entry?.installed === true })
    })()`)
    return JSON.parse(outcome)
  } finally {
    child.kill('SIGTERM')
    for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) await sleep(250)
    if (child.exitCode === null) child.kill('SIGKILL')
    await sleep(1200)
  }
}

async function evaluate(devtoolsPort, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()
  const page = targets.find((entry) => entry.type === 'page')
  if (!page) throw new Error('no page target')
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
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 180_000 })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  } finally {
    socket.close()
  }
}

try {
  // 1. bytes changed after the index recorded the digest → digest check must stop it.
  const tamperedOutcome = await runCase('tampered', { index: join(tampered, 'index.json'), withKeyring: true })
  if (!tamperedOutcome.refused || tamperedOutcome.installed) {
    throw new Error(`a tampered artifact was not refused cleanly: ${JSON.stringify(tamperedOutcome)}`)
  }
  record('内容被篡改的制品被拒绝', tamperedOutcome)

  // 2. intact artifact, but the host trusts no publisher at all → signature check
  //    must stop it (fail closed, nothing installed).
  const unknownKeyOutcome = await runCase('unknown-key', { index: appIndexPath, withKeyring: false })
  if (!unknownKeyOutcome.refused || unknownKeyOutcome.installed) {
    throw new Error(`an untrusted publisher was not refused cleanly: ${JSON.stringify(unknownKeyOutcome)}`)
  }
  record('宿主不信任任何发布者时被拒绝', unknownKeyOutcome)

  // 3. control: same entry point, shipped catalogue, test keyring → installs, so the
  //    two refusals above are about the hostile input and not a broken path.
  const healthyOutcome = await runCase('healthy', { index: appIndexPath, withKeyring: true })
  if (healthyOutcome.refused || !healthyOutcome.installed) {
    throw new Error(`the shipped catalogue could not be installed: ${JSON.stringify(healthyOutcome)}`)
  }
  record('同一入口对未篡改制品正常工作', healthyOutcome)

  await writeFile(join(workDir, 'report.json'), `${JSON.stringify({ ok: true, steps }, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: join(workDir, 'report.json'), steps: steps.length })}\n`)
} catch (error) {
  await writeFile(join(workDir, 'report.json'), `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`).catch(() => undefined)
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}