import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudSpaceEnsureRequestSchema, cloudSpaceSchema, cloudSpaceSessionGrantSchema } from './index.js'
const spaceId = 'spc_' + '1'.repeat(32)
const grant = { spaceId, editorUrl: 'https://space.notes.test/', bootstrapUrl: 'https://space.notes.test/_sciforge/session', bootstrapCode: 'x'.repeat(43), expiresAt: '2026-11-10T00:00:00Z' }
test('main-only grants reject credentials, cross-origin bootstrap and legacy project scope', () => {
  assert.deepEqual(cloudSpaceSessionGrantSchema.parse(grant), grant)
  for (const change of [{ bootstrapUrl: 'https://other.notes.test/_sciforge/session' }, { bootstrapUrl: grant.bootstrapUrl + '?code=secret' }, { editorUrl: 'https://user:secret@space.notes.test/' }, { bootstrapUrl: 'https://space.notes.test/arbitrary' }, { projectId: 'prj_old' }, { spaceId: 'prj_old' }]) {
    assert.equal(cloudSpaceSessionGrantSchema.safeParse({ ...grant, ...change }).success, false)
  }
})
test('personal ownership comes from authority and cannot be supplied during ensure', () => {
  assert.equal(cloudSpaceEnsureRequestSchema.safeParse({ scope: { kind: 'personal' } }).success, true)
  assert.equal(cloudSpaceEnsureRequestSchema.safeParse({ scope: { kind: 'project', projectId: 'prj_one' }, retryFailed: true }).success, true)
  for (const scope of [{ kind: 'personal', ownerUserId: 'victim' }, { kind: 'project' }, { kind: 'project', projectId: 'prj_one', ownerUserId: 'victim' }]) {
    assert.equal(cloudSpaceEnsureRequestSchema.safeParse({ scope }).success, false)
  }
})
test('public metadata excludes kernel addresses, credentials and diagnostics', () => {
  const space = { spaceId, scope: { kind: 'personal', ownerUserId: 'user' }, status: 'ready', revision: 1, createdAt: grant.expiresAt, updatedAt: grant.expiresAt }
  assert.deepEqual(cloudSpaceSchema.parse(space), space)
  for (const extra of [{ upstreamUrl: 'http://private:6806' }, { upstreamToken: 'secret' }, { failure: { code: 'provision_failed', retryable: true, detail: 'secret' } }]) {
    assert.equal(cloudSpaceSchema.safeParse({ ...space, ...extra }).success, false)
  }
})
