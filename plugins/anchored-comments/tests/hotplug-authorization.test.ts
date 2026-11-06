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
import { CapabilityBroker } from '../../../src/main/capabilities/broker.js'
import {
  activationStateOf,
  anchoredCommentIds,
  createHarness,
  DSH_RUNTIME_VERSION,
  PACKAGE_NAME
} from './harness.js'

test('no approved contract: activation is refused and nothing is registered', { timeout: 120_000 }, async () => {
  const harness = await createHarness({ approved: false })
  try {
    await assert.rejects(
      harness.service.setEnabled(PACKAGE_NAME, true),
      /approved adapter contract/i
    )
    assert.deepEqual(anchoredCommentIds(harness.registry), [])
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
    assert.deepEqual(anchoredCommentIds(harness.registry), [])
    assert.notEqual(await activationStateOf(harness), 'active')
  } finally {
    await harness.dispose()
  }
})

test('manifest ports are not grants: missing visual authorization refuses Host callbacks', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    const contract = harness.contracts.get(PACKAGE_NAME)!
    harness.contracts.set(PACKAGE_NAME, {
      ...contract,
      dshAuthorization: { ...contract.dshAuthorization!, ports: [] }
    })
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const broker = new CapabilityBroker(harness.registry)
    await assert.rejects(broker.invokeOrdinarySession({
      audience: 'agent', callerId: 'denied-port-fixture', workspaceId: harness.workspaceRoot
    }, {
      actionId: 'anchored-comments.capture', invocationId: 'denied-enumeration',
      input: { action: 'enumerate', workspaceRoot: harness.workspaceRoot }
    }, { runtimeId: 'test-runtime', threadId: 'test-thread' }), /visual port authorization is missing/i)
  } finally { await harness.dispose() }
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
    assert.deepEqual(anchoredCommentIds(registry), [])
  } finally {
    await second?.dispose().catch(() => undefined)
    await rm(harness.root, { recursive: true, force: true })
  }
})