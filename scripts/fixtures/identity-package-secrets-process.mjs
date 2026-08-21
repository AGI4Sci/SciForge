import assert from 'node:assert/strict'
import { createDomainPackageStorageFactory } from '../../src/main/domain-package-storage.ts'
import { PackageDesktopIdentitySessionStore } from '../../packages/domains/identity-access/src/main/session-store.ts'

const [mode, userDataDir] = process.argv.slice(2)
if ((mode !== 'write' && mode !== 'read') || !userDataDir) {
  throw new Error('Usage: identity-package-secrets-process.mjs <write|read> <user-data-dir>')
}

const encryption = Object.freeze({
  state: () => 'available',
  encryptString: (value) => Buffer.from(`process-encrypted:${Buffer.from(value).toString('base64')}`),
  decryptString: (value) => Buffer.from(
    value.toString().replace(/^process-encrypted:/u, ''),
    'base64'
  ).toString()
})
const owner = {
  moduleId: 'identity-access',
  moduleVersion: mode === 'write' ? '1.0.0' : '2.0.0'
}
const secrets = createDomainPackageStorageFactory({
  userDataDir,
  encryption,
  getDeviceId: () => 'cross-process-device',
  currentPrincipal: () => undefined
}).forOwner(owner).secrets
const sessionStore = new PackageDesktopIdentitySessionStore(secrets)

if (mode === 'write') {
  await sessionStore.save({
    version: 1,
    issuer: 'https://login-test.sciforge.cn/realms/SciForge',
    clientId: 'sciforge-desktop',
    refreshToken: 'fixture-refresh-session-cross-process'
  })
  await secrets.write('device.key', JSON.stringify({
    version: 1,
    fixture: 'fixture-device-private-key-cross-process'
  }))
} else {
  const session = await sessionStore.load()
  const deviceKey = await secrets.read('device.key')
  assert.equal(session?.issuer, 'https://login-test.sciforge.cn/realms/SciForge')
  assert.equal(session?.clientId, 'sciforge-desktop')
  assert.equal(session?.refreshToken, 'fixture-refresh-session-cross-process')
  assert.deepEqual(JSON.parse(deviceKey ?? 'null'), {
    version: 1,
    fixture: 'fixture-device-private-key-cross-process'
  })
}

process.stdout.write(JSON.stringify({ ok: true, mode, pid: process.pid }))
