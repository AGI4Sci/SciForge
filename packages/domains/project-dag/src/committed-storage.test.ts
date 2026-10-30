import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { projectDagSidecarConfig } from './sidecar.js'
import { evidenceDagStorageRoot } from '@sciforge/domain-evidence-dag/storage'

// The production Evidence worker owns this profile directory. Status metadata
// alone must not make a Project update appear wired to its immutable graph.
test('Project immutable reader uses the production Evidence storage owner by default', () => {
  const userDataDir = '/profile/isolated'
  const config = projectDagSidecarConfig({
    appRoot: '/repo', userDataDir, environment: {}
  }, { baseUrl: 'http://localhost/v1', apiKey: 'fixture', model: 'fixture' }, 'fixture')
  assert.equal(config.sessionDir, join(userDataDir, 'evidence-dag', 'python'))
  assert.equal(config.env.PDAG_SESSION_DIR, config.sessionDir)
  assert.equal(config.sessionDir, evidenceDagStorageRoot(userDataDir, {}))
})

test('explicit profile storage selection remains local and preserves Project override', () => {
  const environment = { EDAG_STORAGE_DIR: ' /evidence-owner ', PDAG_SESSION_DIR: '/project-reader' }
  assert.equal(evidenceDagStorageRoot('/profile', environment), '/evidence-owner')
  const config = projectDagSidecarConfig({ appRoot: '/repo', userDataDir: '/profile', environment },
    { baseUrl: 'http://localhost/v1', apiKey: 'fixture', model: 'fixture' }, 'fixture')
  assert.equal(config.sessionDir, '/project-reader')
})
