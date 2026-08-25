import assert from 'node:assert/strict'
import { createDomainPackageStorageFactory } from '../../src/main/domain-package-storage.ts'

const [mode, userDataDir] = process.argv.slice(2)
if ((mode !== 'write' && mode !== 'read') || !userDataDir) {
  throw new Error('Usage: package-secrets-process.mjs <write|read> <user-data-dir>')
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
  moduleId: 'cross-process-secret-fixture',
  moduleVersion: mode === 'write' ? '1.0.0' : '2.0.0'
}
const secrets = createDomainPackageStorageFactory({
  userDataDir,
  encryption,
  getDeviceId: () => 'cross-process-device',
  currentPrincipal: () => undefined
}).forOwner(owner).secrets

if (mode === 'write') {
  await secrets.write('fixture.primary', 'fixture-primary-secret-cross-process')
  await secrets.write('fixture.secondary', JSON.stringify({
    version: 1,
    value: 'fixture-secondary-secret-cross-process'
  }))
} else {
  assert.equal(
    await secrets.read('fixture.primary'),
    'fixture-primary-secret-cross-process'
  )
  assert.deepEqual(JSON.parse(await secrets.read('fixture.secondary') ?? 'null'), {
    version: 1,
    value: 'fixture-secondary-secret-cross-process'
  })
}

process.stdout.write(JSON.stringify({ ok: true, mode, pid: process.pid }))
