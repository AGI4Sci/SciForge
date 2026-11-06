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
 *   node scripts/packaged-market-security.mjs --app <app> --keyring <test keyring> [--index <local generated index>]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

const appIndexPath = flag('index') ? resolve(flag('index')) : join(appPath, 'Contents/Resources/market/index.json')
const shippedIndex = JSON.parse(await readFile(appIndexPath, 'utf8'))
const shippedArtifacts = join(dirname(appIndexPath), 'artifacts')
if (!shippedIndex.plugins?.length) throw new Error('Security acceptance needs a non-empty catalogue; generate the neutral self-test and pass --index <path>.')

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

// Market IPC forwards ordinary Error messages (custom ExtensionStoreError codes
// do not survive Electron IPC). Match the production messages from
// dsh-plugin-market.ts / dsh-plugin-signature.ts after removing only IPC wrappers.
const PHASE_SECURITY = String.raw`(async () => {
  const market = window.sciforge.market
  const expected = %%EXPECTED%%
  const packageName = %%PACKAGE_NAME%%
  const readEntry = async () => {
    const view = await market.list()
    if (view?.error || !Array.isArray(view?.plugins)) throw new Error('market listing failed: ' + JSON.stringify(view))
    const entry = view.plugins.find((p) => p.name === packageName)
    if (!entry || !entry.tools?.length || !Array.isArray(entry.capabilities) || entry.capabilities.length !== entry.tools.length || entry.tools.some((tool) => !entry.capabilities.some((c) => c.id === tool.id))) throw new Error('expected catalogue entry/capabilities missing: ' + packageName)
    return entry
  }
  const requireClean = (entry) => {
    if (entry.installed !== false || entry.enabled !== false || entry.capabilities.some((c) => c.registered !== false)) throw new Error('installation or capability residue: ' + JSON.stringify(entry))
  }
  const plugin = await readEntry()
  requireClean(plugin)
  let failure
  try {
    await market.install({ packageName: plugin.name, approvalSnapshot: plugin.approvalSnapshot, approvedPorts: plugin.ports, approvedToolNames: plugin.tools.map((t) => t.name) })
  } catch (error) { failure = error }
  // Re-read even on unexpected failures: a rejection alone says nothing about
  // partial installation or live capability registrations.
  const after = await readEntry()
  if (failure) {
    requireClean(after)
    const message = String(failure?.message ?? failure)
      .replace(/^Error invoking remote method 'market:install': (?:Error|ExtensionStoreError): /, '')
      .replace(/^(?:Error|ExtensionStoreError): /, '')
    const matches = expected.reason === 'digest_mismatch'
      ? message === expected.message
      : expected.reason === 'unknown_signing_key' && /^DSH plugin signature uses unknown publisher key [a-z0-9][a-z0-9._-]*\.$/.test(message)
    if (!matches) throw new Error('unexpected installation rejection: ' + message)
    return JSON.stringify({ refused: true, where: 'install', reason: expected.reason, message, plugin: plugin.name, installed: after.installed, enabled: after.enabled, registered: after.capabilities.filter((c) => c.registered).map((c) => c.id) })
  }
  if (expected.reason !== 'healthy') throw new Error('hostile artifact installation succeeded')
  if (after.installed !== true || after.enabled !== true || after.capabilities.some((c) => c.registered !== true)) throw new Error('healthy installation did not become active: ' + JSON.stringify(after))
  return JSON.stringify({ refused: false, plugin: plugin.name, installed: after.installed, enabled: after.enabled, registered: after.capabilities.map((c) => c.id) })
})()`

async function runCase(label, { index, withKeyring, expected }) {
  const profile = join(workDir, `profile-${label}`)
  await rm(profile, { recursive: true, force: true })
  await mkdir(join(profile, 'extensions'), { recursive: true })
  if (withKeyring) await cp(keyring, join(profile, 'extensions', 'dsh-publisher-keys.json'))

  const child = spawn(join(appPath, 'Contents/MacOS/SciForge'), [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCIFORGE_MARKET_INDEX: index, SCIFORGE_DSH_PUBLISHER_KEYS_FILE: join(profile, 'extensions', 'dsh-publisher-keys.json') }
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

    const outcome = await evaluate(port, PHASE_SECURITY
      .replace('%%EXPECTED%%', JSON.stringify(expected))
      .replace('%%PACKAGE_NAME%%', JSON.stringify(shippedIndex.plugins[0].name)))
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
  const tamperedOutcome = await runCase('tampered', { index: join(tampered, 'index.json'), withKeyring: true, expected: { reason: 'digest_mismatch', message: `The downloaded artifact digest ${createHash('sha256').update(mutated).digest('hex')} does not match the published digest ${shippedIndex.plugins[0].artifact.sha256}.` } })
  if (!tamperedOutcome.refused || tamperedOutcome.installed) {
    throw new Error(`a tampered artifact was not refused cleanly: ${JSON.stringify(tamperedOutcome)}`)
  }
  record('内容被篡改的制品被拒绝', tamperedOutcome)

  // 2. intact artifact, but the host trusts no publisher at all → signature check
  //    must stop it (fail closed, nothing installed).
  const unknownKeyOutcome = await runCase('unknown-key', { index: appIndexPath, withKeyring: false, expected: { reason: 'unknown_signing_key' } })
  if (!unknownKeyOutcome.refused || unknownKeyOutcome.installed) {
    throw new Error(`an untrusted publisher was not refused cleanly: ${JSON.stringify(unknownKeyOutcome)}`)
  }
  record('宿主不信任任何发布者时被拒绝', unknownKeyOutcome)

  // 3. control: same entry point, configured catalogue, test keyring → installs, so the
  //    two refusals above are about the hostile input and not a broken path.
  const healthyOutcome = await runCase('healthy', { index: appIndexPath, withKeyring: true, expected: { reason: 'healthy' } })
  if (healthyOutcome.refused || !healthyOutcome.installed) {
    throw new Error(`the configured catalogue could not be installed: ${JSON.stringify(healthyOutcome)}`)
  }
  record('同一入口对未篡改制品正常工作', healthyOutcome)

  await writeFile(join(workDir, 'report.json'), `${JSON.stringify({ ok: true, steps }, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: join(workDir, 'report.json'), steps: steps.length })}\n`)
} catch (error) {
  await writeFile(join(workDir, 'report.json'), `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`).catch(() => undefined)
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}