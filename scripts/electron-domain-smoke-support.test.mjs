import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IDENTITY_SMOKE_CAPABILITY_IDS,
  REQUIRED_CAPABILITY_IDS,
  createIdentitySmokeInvocationId,
  parseSmokeCliOptions,
  validateSmokeResult
} from './electron-domain-smoke-support.mjs'

test('Electron smoke requires the local identity capability set', () => {
  assert.deepEqual(IDENTITY_SMOKE_CAPABILITY_IDS, [
    'identity.local.inspect',
    'identity.local.list-accounts',
    'identity.local.create-account',
    'identity.local.select-account',
    'identity.local.rename-account',
    'identity.local.exit-account',
    'identity.local.dismiss-first-prompt',
    'identity.local.backup-and-reset'
  ])
  assert.equal(REQUIRED_CAPABILITY_IDS.includes('identity.local.create-account'), true)
  assert.equal(REQUIRED_CAPABILITY_IDS.some((id) => id.startsWith('identity.remote.')), false)
})

test('smoke CLI accepts only local executable and timeout options', () => {
  const options = parseSmokeCliOptions([
    '--repository-root', '/tmp/sciforge',
    '--timeout-ms', '1000',
    '--executable', '/tmp/SciForge'
  ])
  assert.equal(options.repositoryRoot, '/tmp/sciforge')
  assert.equal(options.timeoutMs, 1000)
  assert.equal(options.executablePath, '/tmp/SciForge')
  assert.throws(() => parseSmokeCliOptions(['--unexpected-option', 'https://example.test']), /Unknown Electron smoke option/u)
})

test('smoke validates local identity and retained capability paths', () => {
  const result = {
    readiness: 'ready',
    identityActionId: 'identity.local.create-account',
    identityAccountUsername: 'electron_smoke',
    paperRadarActionId: 'paper-radar.status',
    workspacePreviewActionId: 'workspace-preview.list',
    workspacePreviewPluginId: 'markdown',
    workspacePreviewReleased: true,
    artifactVersionsActionId: 'artifact-versions.list',
    evidenceDagActionId: 'evidence-dag.view',
    scientificPlottingActionId: 'scientific-plotting.status',
    visualReviewActionId: 'visual-review.open',
    datasetLoopCreated: true,
    datasetLoopWorkflowCount: 2,
    previewPluginCount: 1,
    platform: 'linux',
    nativeVisual: {
      toolNames: ['sciforge_look', 'sciforge_capture'],
      cropped: true,
      nativeImageBindingValidated: true,
      proofChainValidated: true,
      datasetLoopCapabilitiesDiscoverable: true,
      unavailableRouteFailedVisibly: true
    },
    codexPreToolUseHook: {
      denied: true,
      reason: 'sciforge_hook_deny_challenge:fixture'
    },
    url: 'file:///tmp/out/renderer/index.html'
  }
  assert.doesNotThrow(() => validateSmokeResult(result, {}))
  assert.throws(() => validateSmokeResult({ ...result, identityActionId: 'identity.remote.login' }, {}), /Identity account creation/u)
})

test('identity smoke invocation IDs remain unique and UUID-shaped', () => {
  assert.equal(
    createIdentitySmokeInvocationId(() => '123e4567-e89b-42d3-a456-426614174000'),
    'electron-smoke-identity-create-123e4567-e89b-42d3-a456-426614174000'
  )
})
