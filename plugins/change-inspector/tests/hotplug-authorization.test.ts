/**
 * E4 — authorization is fail-closed: no contract, a mismatched version, or a
 * revoked contract keeps the plugin inactive and the registry empty.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins.js'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry.js'
import {
  activationStateOf,
  changeInspectorIds,
  createHarness,
  DSH_RUNTIME_VERSION,
  PACKAGE_NAME,
  invokeHarness
} from './harness.js'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'

test('no approved contract: activation is refused and nothing is registered', { timeout: 120_000 }, async () => {
  const harness = await createHarness({ approved: false })
  try {
    await assert.rejects(
      harness.service.setEnabled(PACKAGE_NAME, true),
      /approved adapter contract/i
    )
    assert.deepEqual(changeInspectorIds(harness.registry), [])
    assert.notEqual(await activationStateOf(harness), 'active')
  } finally {
    await harness.dispose()
  }
})

test('contract for a different version: activation is refused', { timeout: 120_000 }, async () => {
  const harness = await createHarness({ contractVersion: '9.9.9' })
  try {
    await assert.rejects(
      harness.service.setEnabled(PACKAGE_NAME, true),
      /exact package version/i
    )
    assert.deepEqual(changeInspectorIds(harness.registry), [])
    assert.notEqual(await activationStateOf(harness), 'active')
  } finally {
    await harness.dispose()
  }
})

test('fresh Host restart reopens a trustworthy Session without plugin-config records', { timeout: 120_000 }, async () => {
  const first = await createHarness()
  let second: Awaited<ReturnType<typeof createHarness>> | undefined
  try {
    await first.service.setEnabled(PACKAGE_NAME, true)
    const before = (await invokeHarness(first, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output
    await first.service.dispose()
    second = await createHarness({ userDataRoot: join(first.root, 'data') })
    await second.service.setEnabled(PACKAGE_NAME, true)
    const after = (await invokeHarness(second, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output
    assert.deepEqual(after, before)
    assert.deepEqual(second.snapshotReads, [second.ordinarySession])
  } finally {
    await second?.dispose()
    await first.dispose()
  }
})

test('revoking the contract disables the plugin on the next host start', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  let second: DevelopmentExternalPluginService | undefined
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await activationStateOf(harness), 'active')
    await harness.service.dispose()

    // Fresh profile (no persisted enablement), same plugin root, authorization gone.
    second = new DevelopmentExternalPluginService({
      root: harness.pluginsRoot,
      userDataPath: join(harness.root, 'data-without-contracts'),
      hostApiVersion: '1.0.0',
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      adapterContracts: new Map(),
      allowedPermissionIds: new Set()
    })
    const registry = new CapabilityRegistry()
    await second.initialize()
    await second.attachCapabilityRegistry(registry)

    await assert.rejects(
      second.setEnabled(PACKAGE_NAME, true),
      /approved adapter contract/i
    )
    assert.deepEqual(changeInspectorIds(registry), [])
  } finally {
    await second?.dispose().catch(() => undefined)
    await rm(harness.root, { recursive: true, force: true })
  }
})