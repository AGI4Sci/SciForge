import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDomainPackageStorageFactory } from './domain-package-storage'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })))
})

async function fixture() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-domain-storage-'))
  temporaryDirectories.push(userDataDir)
  const encryption = {
    available: true,
    isEncryptionAvailable() {
      return this.available
    },
    encryptString(value: string) {
      return Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`)
    },
    decryptString(value: Buffer) {
      const encoded = value.toString().replace(/^encrypted:/, '')
      return Buffer.from(encoded, 'base64').toString()
    }
  }
  return {
    userDataDir,
    encryption,
    factory: createDomainPackageStorageFactory({ userDataDir, encryption })
  }
}

describe('domain package storage', () => {
  it('isolates package settings and enforces exact revision writes', async () => {
    const { factory } = await fixture()
    const first = factory.forOwner({ moduleId: 'example.first', moduleVersion: '1.0.0' })
    const second = factory.forOwner({ moduleId: 'example.second', moduleVersion: '1.0.0' })

    await expect(first.settings.read()).resolves.toEqual({ revision: 0, value: null })
    await expect(first.settings.write({ enabled: true }, 0)).resolves.toEqual({
      revision: 1,
      value: { enabled: true }
    })
    await expect(first.settings.write({ enabled: false }, 0)).rejects.toThrow('revision conflict')
    await expect(second.settings.read()).resolves.toEqual({ revision: 0, value: null })
    const upgraded = factory.forOwner({ moduleId: 'example.first', moduleVersion: '2.0.0' })
    await expect(upgraded.settings.read()).resolves.toEqual({
      revision: 1,
      value: { enabled: true }
    })
  })

  it('encrypts secret values, applies restrictive modes, and never offers enumeration', async () => {
    const { factory, userDataDir } = await fixture()
    const storage = factory.forOwner({ moduleId: 'example.secrets', moduleVersion: '1.0.0' })
    const sensitiveValue = 'fixture-sensitive-value'

    await storage.secrets.write('device.credential', sensitiveValue)
    await expect(storage.secrets.has('device.credential')).resolves.toBe(true)
    await expect(storage.secrets.read('device.credential')).resolves.toBe(sensitiveValue)
    expect('list' in storage.secrets).toBe(false)

    const files = await import('node:fs/promises').then(async ({ readdir }) => {
      const root = join(userDataDir, 'domain-package-storage')
      const [owner] = await readdir(root)
      const ownerRoot = join(root, owner!)
      return { ownerRoot, content: await readFile(join(ownerRoot, 'secrets.enc.json'), 'utf8') }
    })
    expect(files.content).not.toContain(sensitiveValue)
    expect((await stat(files.ownerRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(join(files.ownerRoot, 'secrets.enc.json'))).mode & 0o777).toBe(0o600)

    await storage.secrets.remove('device.credential')
    await expect(storage.secrets.read('device.credential')).resolves.toBeNull()
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    const { factory, encryption } = await fixture()
    encryption.available = false
    const storage = factory.forOwner({ moduleId: 'example.secrets', moduleVersion: '1.0.0' })

    await expect(storage.secrets.write('device.credential', 'fixture-value')).rejects.toThrow(
      'encryption is unavailable'
    )
  })
})
