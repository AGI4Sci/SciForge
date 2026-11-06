import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Execute the actual renderer expressions without importing either CLI runner:
// importing would create profiles, mutate artifacts, and launch Electron.
const acceptance = await readFile(new URL('./packaged-market-acceptance.mjs', import.meta.url), 'utf8')
const security = await readFile(new URL('./packaged-market-security.mjs', import.meta.url), 'utf8')
const phases = vm.runInNewContext(acceptance.slice(acceptance.indexOf('const PHASE_CONTRACT'), acceptance.indexOf('/** ---------- run ---------- */')) + '\n;({ PHASE_INSTALL, PHASE_RESTART, PHASE_UNINSTALL, PHASE_AFTER_UNINSTALL_RESTART })')
const securityPhase = vm.runInNewContext(security.slice(security.indexOf('const PHASE_SECURITY'), security.indexOf('async function runCase')) + '\nPHASE_SECURITY')
const name = '@test/neutral'
const ping = { ok: true, capability: 'market-selftest.ping', plugin: name }
const plugin = (installed = true) => ({ name, installed, enabled: installed, tools: [{ id: ping.capability, name: 'ping' }], capabilities: [{ id: ping.capability, registered: installed }], approvalSnapshot: { packageName: name }, ports: [] })
const view = (entry = plugin()) => ({ plugins: [entry], error: null, source: { location: '/SciForge.app/Contents/Resources/market/index.json' } })
const missing = () => Object.assign(new Error('Capability market-selftest.ping is not registered.'), { code: 'unknown_capability', category: 'rejected' })
const execute = async (expression, market, invoke, extras = {}) => JSON.parse(await vm.runInNewContext(expression, { window: { sciforge: { market, capabilities: { invoke } } }, crypto: { randomUUID: () => 'uuid' }, ...extras }))
const assertFailure = async (promise) => {
  try { assert.equal((await promise).ok, false) } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error
  }
}

test('restart validates all three ping fields, including strict boolean success', async () => {
  for (const output of [{ ...ping, ok: 'true' }, { ...ping, ok: 1 }, { ...ping, plugin: 'other' }, { ok: true, capability: ping.capability }, { ...ping, capability: 'other' }]) {
    await assert.rejects(execute(phases.PHASE_RESTART, { list: async () => view() }, async () => ({ output })), /payload mismatch/)
  }
  assert.equal((await execute(phases.PHASE_RESTART, { list: async () => view() }, async () => ({ output: ping }))).ok, true)
  for (const bad of [{ error: 'offline', plugins: [] }, { plugins: [] }]) await assert.rejects(execute(phases.PHASE_RESTART, { list: async () => bad }), /healthy self-test catalogue/)
})

for (const phase of ['PHASE_UNINSTALL', 'PHASE_AFTER_UNINSTALL_RESTART']) {
  test(`${phase} accepts only the production unknown capability rejection`, async () => {
    const market = { list: async () => view(plugin(false)), uninstall: async () => {} }
    for (const error of [new Error('IPC unavailable'), Object.assign(new Error('wrong'), { code: 'unknown_capability', category: 'rejected' }), Object.assign(missing(), { category: 'failed' }), Object.assign(missing(), { code: 'permission_denied' })]) {
      await assert.rejects(execute(phases[phase], market, async () => { throw error }))
    }
    await assert.rejects(execute(phases[phase], market, async () => ({ output: { ok: false } })), /expected unknown_capability/)
    assert.equal((await execute(phases[phase], market, async () => { throw missing() })).ok, true)
    await assert.rejects(execute(phases[phase], { ...market, list: async () => view({ ...plugin(false), capabilities: [{ id: ping.capability, registered: true }] }) }, async () => { throw missing() }), /registration remains/)
  })
}

// Minimal UI harness drives the real install phase through installation, approval
// checks, ping, disable, and re-enable. No timers or browser/app are started.
const installHarness = (disabledInvoke) => {
  let installed = false
  let enabled = false
  const entry = () => ({ ...plugin(installed), enabled, capabilities: [{ id: ping.capability, registered: enabled }] })
  const button = (innerText, click = () => {}) => ({ innerText, click })
  const buttons = [button('Extensions'), button('Market'), button('Approve and install', () => { installed = enabled = true })]
  const card = { innerText: name, querySelectorAll: () => [button('Install')] }
  const document = {
    querySelector: () => ({ innerText: 'How to use it ' + ping.capability }),
    querySelectorAll: (selector) => selector === 'article' ? [card] : selector === 'div, section' ? [{ innerText: 'Approve and install ' + ping.capability }] : buttons
  }
  const market = {
    list: async () => view(entry()), progress: async () => ({ phase: 'done' }),
    install: async (request) => {
      assert.ok(request.approvalSnapshot)
      assert.deepEqual(Array.from(request.approvedPorts), [])
      throw new Error('Error invoking remote method \'market:install\': Error: Approving extra.tool, ping does not match what ' + name + ' declares (ping).')
    },
    setEnabled: async ({ enabled: next }) => { enabled = next }
  }
  return execute(phases.PHASE_INSTALL.replaceAll('%%CATALOGUE_SOURCE%%', 'file'), market, async () => enabled ? { output: ping } : disabledInvoke(), { document, setTimeout: (callback) => callback() })
}

test('disable rejects transport failures and false outputs, and accepts expected refusal with healthy re-enable', async () => {
  for (const invoke of [async () => { throw new Error('transport disconnected') }, async () => ({ output: { ok: false } }), async () => { throw Object.assign(missing(), { code: 'permission_denied' }) }]) await assertFailure(installHarness(invoke))
  assert.equal((await installHarness(async () => { throw missing() })).ok, true)
})

const digestMessage = 'The downloaded artifact digest ' + 'b'.repeat(64) + ' does not match the published digest ' + 'a'.repeat(64) + '.'
const securityExpression = (reason, message = digestMessage) => securityPhase.replace('%%EXPECTED%%', JSON.stringify({ reason, message })).replace('%%PACKAGE_NAME%%', JSON.stringify(name))
const securityRun = (reason, market) => execute(securityExpression(reason), market)
const refusedMarket = (message, after = plugin(false)) => {
  let reads = 0
  const market = {
    list: async () => view(++reads === 1 ? plugin(false) : after),
    install: async (request) => {
      assert.ok(request.approvalSnapshot)
      assert.deepEqual(Array.from(request.approvedPorts), [])
      throw new Error(message)
    }
  }
  return { market, reads: () => reads }
}

test('security does not accept listing failures, empty lists, or unrelated install failures', async () => {
  for (const list of [async () => { throw new Error('offline') }, async () => ({ plugins: [], error: 'bad index' }), async () => ({ plugins: [], error: null })]) {
    await assert.rejects(securityRun('unknown_signing_key', { list, install: async () => { throw new Error('must not install') } }))
  }
  for (const message of ['IPC unavailable', 'invalid approvalSnapshot', 'DSH plugin artifact is not signed by a publisher.', 'DSH plugin signature for publisher test does not match the artifact bytes.', 'DSH plugin signature uses unknown publisher key key. extra']) {
    const fixture = refusedMarket(message)
    await assert.rejects(securityRun('unknown_signing_key', fixture.market), /unexpected installation rejection/)
    assert.equal(fixture.reads(), 2)
  }
})

test('security requires exact expected digest/signature reason and rechecks clean state', async () => {
  for (const [reason, message] of [['digest_mismatch', digestMessage], ['unknown_signing_key', "Error invoking remote method 'market:install': ExtensionStoreError: DSH plugin signature uses unknown publisher key test-key."]]) {
    const fixture = refusedMarket(message)
    const result = await securityRun(reason, fixture.market)
    assert.equal(result.refused, true)
    assert.equal(result.installed, false)
    assert.equal(result.enabled, false)
    assert.deepEqual(result.registered, [])
    assert.equal(fixture.reads(), 2)
    for (const after of [plugin(true), { ...plugin(false), capabilities: [{ id: ping.capability, registered: true }] }, { ...plugin(false), capabilities: [] }]) {
      await assert.rejects(securityRun(reason, refusedMarket(message, after).market), /residue|missing/)
    }
    let reads = 0
    await assert.rejects(securityRun(reason, { list: async () => { if (++reads === 2) throw new Error('recheck failed'); return view(plugin(false)) }, install: fixture.market.install }), /recheck failed/)
  }
  await assert.rejects(securityRun('digest_mismatch', refusedMarket('The downloaded artifact digest ' + 'c'.repeat(64) + ' does not match the published digest ' + 'a'.repeat(64) + '.').market), /unexpected/)
})

test('security healthy control requires actual install and capability activation', async () => {
  let reads = 0
  const market = { list: async () => view(plugin(++reads > 1)), install: async () => {} }
  assert.equal((await securityRun('healthy', market)).installed, true)
  for (const after of [plugin(false), { ...plugin(true), capabilities: [{ id: ping.capability, registered: false }] }]) {
    reads = 0
    await assert.rejects(securityRun('healthy', { ...market, list: async () => view(++reads === 1 ? plugin(false) : after) }), /did not become active/)
  }
  await assert.rejects(securityRun('healthy', refusedMarket(digestMessage).market), /unexpected installation rejection/)
  reads = 0
  await assert.rejects(securityRun('digest_mismatch', market), /hostile artifact installation succeeded/)
})
