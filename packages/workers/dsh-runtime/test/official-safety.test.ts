import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { DSH_COMMAND_EXECUTION_ENTRY_IDS, DSH_DEFAULT_ACP_ROUTE, DSH_DISABLED_ENTRY_IDS, DSH_SAFETY_PATCH, createDiscoveredDshDeployment, createDshDerivedSafetyPatch, createDshSafetyPatch, dshDisabledEntryIds, validateDshComposedConfig, validateDshDerivedComposedConfig } from '../src/deployment.js'

const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', {kind:'scalar', construct: value => ({ __jsExpr: value })})])
const original = yaml.load(readFileSync(new URL('./fixtures/official-acp/default-acp.yml', import.meta.url), 'utf8'), {schema}) as Record<string, any>[]
function compose() {
  const rows = structuredClone(original)
  for (const patch of JSON.parse(DSH_SAFETY_PATCH)) {
    const row = rows.find(row => row.id === patch.id)
    assert.ok(row, `Safety overlay must address a real official row: ${patch.id}`)
    Object.assign(row, patch)
  }
  return rows
}
test('official ACP safety overlay addresses real owners and disables every builtin tool and telemetry', () => {
  const rows = compose()
  for (const row of rows) {
    if (/^@deepseek-ai\/dsh-tool-/.test(row.name) || ['otel', 'session-telemetry-otel'].includes(row.id)) assert.equal(row.disabled, true, row.id)
  }
  assert.doesNotThrow(() => validateDshComposedConfig(yaml.dump(rows)))
})
test('validator rejects a reenabled official builtin tool before launch', () => {
  const rows = compose()
  rows.find(row => row.id === 'tool-fs')!.disabled = false
  assert.throws(() => validateDshComposedConfig(yaml.dump(rows)), /runtime_config_unsafe/)
})

test('discovered deployment approval enforces the composed-config safety invariants', async () => {
  const { verifyDeployment } = createDiscoveredDshDeployment()
  // Discovered targets compose with the patch derived from the install's own dump.
  const composeDerived = () => {
    const rows = structuredClone(original)
    for (const patch of JSON.parse(createDshDerivedSafetyPatch(yaml.dump(original), null))) {
      const row = rows.find(row => row.id === patch.id)
      assert.ok(row, `Derived overlay must address a real official row: ${patch.id}`)
      Object.assign(row, patch)
    }
    return rows
  }
  // Families the static list misses (web/subagent) are shut off by derivation.
  assert.equal(composeDerived().find(row => row.id === 'web')!.disabled, true)
  assert.equal(composeDerived().find(row => row.id === 'subagent-spawn-in-process')!.disabled, true)
  await verifyDeployment({ version: '0.2.0-rc.2', configDigest: '0'.repeat(64), composedConfig: yaml.dump(composeDerived()), executable: '/usr/local/bin/dsh' })
  // Discovered installs are version-agnostic; safety invariants are the boundary.
  await verifyDeployment({ version: '9.9.9', configDigest: '0'.repeat(64), composedConfig: yaml.dump(composeDerived()), executable: '/usr/local/bin/dsh' })
  const unsafe = composeDerived()
  unsafe.find(row => row.id === 'tool-bash')!.disabled = false
  await assert.rejects(() => verifyDeployment({ version: '0.2.0-rc.2', configDigest: '0'.repeat(64), composedConfig: yaml.dump(unsafe), executable: '/usr/local/bin/dsh' }), /runtime_config_unsafe/)
  // The static composition leaves the newer families enabled; discovered approval rejects it.
  await assert.rejects(() => verifyDeployment({ version: '0.2.0-rc.2', configDigest: '0'.repeat(64), composedConfig: yaml.dump(compose()), executable: '/usr/local/bin/dsh' }), /runtime_config_unsafe/)
})

test('the default safety patch stays byte-identical and the default route is injectable', () => {
  // The packaged pin digests the composition of these exact bytes.
  assert.equal(createDshSafetyPatch(), DSH_SAFETY_PATCH)
  assert.equal(createDshSafetyPatch(undefined), DSH_SAFETY_PATCH)
  const custom = JSON.parse(createDshSafetyPatch({ provider: 'p', model: 'm' })) as Record<string, any>[]
  assert.deepEqual(custom.find(row => row.id === 'acp')?.config, { provider: 'p', model: 'm' })
  const stock = JSON.parse(createDshSafetyPatch(null)) as Record<string, any>[]
  assert.equal(stock.find(row => row.id === 'acp'), undefined)
  assert.equal(stock.find(row => row.id === 'approval')?.config?.policy, 'ask')
  for (const id of DSH_DISABLED_ENTRY_IDS) assert.equal(stock.find(row => row.id === id)?.disabled, true, id)
})

test('derived validation enforces invariants version-agnostically', () => {
  const safe = [
    { id: 'acp', config: { provider: 'p', model: 'm' } },
    { id: 'approval', config: { policy: 'ask' } },
    { id: 'web', name: '@deepseek-ai/dsh-web', disabled: true },
    { id: 'tool-working-directory', name: '@deepseek-ai/dsh-tool-working-directory', disabled: true }
  ]
  assert.doesNotThrow(() => validateDshDerivedComposedConfig(yaml.dump(safe)))
  // New web/subagent families must never survive enabled.
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([...safe.slice(0, 2), { id: 'web', name: '@deepseek-ai/dsh-web' }])), /runtime_config_unsafe/)
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([...safe.slice(0, 2), { id: 'subagent-spawn-in-process', name: '@deepseek-ai/dsh-subagent-spawn-in-process' }])), /runtime_config_unsafe/)
  // A statically listed id that still exists must stay disabled.
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([...safe, { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])), /runtime_config_unsafe/)
  // approval/acp invariants.
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump(safe.slice(0, 1))), /runtime_config_unsafe/)
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([{ id: 'acp' }, { id: 'approval', config: { policy: 'never' } }])), /runtime_config_unsafe/)
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([{ id: 'acp', disabled: true }, { id: 'approval', config: { policy: 'ask' } }])), /runtime_config_unsafe/)
  // Telemetry entries, when present, must be disabled; absent is acceptable.
  assert.throws(() => validateDshDerivedComposedConfig(yaml.dump([...safe, { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel' }])), /runtime_config_unsafe/)
  // An expression-disabled dangerous entry is not statically known to be off.
  const expression = [
    '- id: plugin-manager',
    "  name: '@deepseek-ai/dsh-plugin-manager'",
    "  disabled: !!js '!ctx.get(\"profileContext\")'",
    '- id: acp',
    '- id: approval',
    '  config:',
    '    policy: ask'
  ].join('\n')
  assert.throws(() => validateDshDerivedComposedConfig(expression), /runtime_config_unsafe/)
})
test('derived patch disables only entries the install actually registers', () => {
  const dump = yaml.dump([
    { id: 'acp', config: { provider: 'stock', model: 'stock-m' } },
    { id: 'approval', config: { policy: 'never' } },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    { id: 'web', name: '@deepseek-ai/dsh-web' },
    { id: 'subagent-fork-in-process', name: '@deepseek-ai/dsh-subagent-fork-in-process' }
  ])
  const rows = JSON.parse(createDshDerivedSafetyPatch(dump, null)) as Record<string, any>[]
  const ids = rows.map(row => row.id)
  for (const id of ['tool-bash', 'web', 'subagent-fork-in-process']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('tool-ralph'), 'removed entries must never be patched')
  assert.ok(!ids.includes('acp'), 'null route keeps the install default')
  assert.equal(rows.find(row => row.id === 'approval')?.config?.policy, 'ask')
  const withRoute = JSON.parse(createDshDerivedSafetyPatch(dump)) as Record<string, any>[]
  assert.deepEqual(withRoute.find(row => row.id === 'acp')?.config, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.throws(() => createDshDerivedSafetyPatch('not: an: entries: array', null), /runtime_deployment_unapproved/)
})

test('the command-execution switch lifts exactly the shell tools and nothing else', () => {
  // Fail-closed default: the audited bytes are the packaged pin identity.
  assert.equal(createDshSafetyPatch(), DSH_SAFETY_PATCH)
  assert.equal(createDshSafetyPatch(undefined, false), DSH_SAFETY_PATCH)
  const enabled = JSON.parse(createDshSafetyPatch(undefined, true)) as Record<string, any>[]
  const ids = enabled.map(row => row.id)
  for (const id of DSH_COMMAND_EXECUTION_ENTRY_IDS) assert.ok(!ids.includes(id), `${id} must not be disabled by the enabled patch`)
  for (const id of DSH_DISABLED_ENTRY_IDS) {
    if (DSH_COMMAND_EXECUTION_ENTRY_IDS.includes(id)) continue
    assert.equal(enabled.find(row => row.id === id)?.disabled, true, `${id} must stay disabled`)
  }
  // The switch never touches the approval policy or the ACP owner.
  assert.deepEqual(enabled.find(row => row.id === 'approval'), { id: 'approval', config: { policy: 'ask' } })
  assert.deepEqual(enabled.find(row => row.id === 'acp'), { id: 'acp', config: { provider: DSH_DEFAULT_ACP_ROUTE.provider, model: DSH_DEFAULT_ACP_ROUTE.model } })
  assert.equal(dshDisabledEntryIds(false).length - dshDisabledEntryIds(true).length, DSH_COMMAND_EXECUTION_ENTRY_IDS.length)
  for (const id of DSH_COMMAND_EXECUTION_ENTRY_IDS) assert.ok(dshDisabledEntryIds(false).includes(id) && !dshDisabledEntryIds(true).includes(id), id)
})

test('an enabled shell composition is approved only under the mode that asked for it', () => {
  const compose = (patch: string) => {
    const rows = structuredClone(original)
    for (const row of JSON.parse(patch) as Record<string, any>[]) {
      const target = rows.find(candidate => candidate.id === row.id)
      assert.ok(target, `overlay must address a real official row: ${row.id}`)
      Object.assign(target, row)
    }
    return rows
  }
  const enabled = compose(createDshSafetyPatch(undefined, true))
  // The base composition owns the shell rows now, so the overlay leaves them on.
  assert.notEqual(enabled.find(row => row.id === 'tool-bash')!.disabled, true)
  assert.doesNotThrow(() => validateDshComposedConfig(yaml.dump(enabled), true))
  // The same bytes are unsafe without the switch: enablement is never implied.
  assert.throws(() => validateDshComposedConfig(yaml.dump(enabled)), /runtime_config_unsafe/)
  // No other family is weakened by asking for the shell.
  const widened = compose(createDshSafetyPatch(undefined, true))
  widened.find(row => row.id === 'tool-fs')!.disabled = false
  assert.throws(() => validateDshComposedConfig(yaml.dump(widened), true), /runtime_config_unsafe/)
})

test('the derived overlay and the discovered approval both follow the switch', async () => {
  const dump = yaml.dump(original)
  const derivedEnabled = JSON.parse(createDshDerivedSafetyPatch(dump, null, true)) as Record<string, any>[]
  const ids = derivedEnabled.map(row => row.id)
  for (const id of DSH_COMMAND_EXECUTION_ENTRY_IDS) assert.ok(!ids.includes(id), id)
  for (const id of ['tool-fs', 'tool-web', 'subagent-spawn-in-process']) assert.ok(ids.includes(id), `${id} must stay disabled`)
  assert.ok(!ids.includes('acp'), 'null route still keeps the install default')
  const rows = structuredClone(original)
  for (const row of derivedEnabled) {
    const target = rows.find(candidate => candidate.id === row.id)
    assert.ok(target)
    Object.assign(target, row)
  }
  const approved = { version: '9.9.9', configDigest: '0'.repeat(64), composedConfig: yaml.dump(rows), executable: '/usr/local/bin/dsh' }
  await createDiscoveredDshDeployment(true).verifyDeployment(approved)
  // The same composition is rejected when the switch was not asked for.
  await assert.rejects(() => createDiscoveredDshDeployment().verifyDeployment(approved), /runtime_config_unsafe/)
})
