import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOfficialExtensionKeyring } from './official-keyring'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('loadOfficialExtensionKeyring', () => {
  it('returns an empty fail-closed keyring when the optional release resource is absent', async () => {
    const root = await temporaryDirectory()
    await expect(loadOfficialExtensionKeyring({
      appPath: root,
      resourcesPath: root,
      isPackaged: false
    })).resolves.toEqual({ keys: [], sourcePath: null })
  })

  it('loads strict host-owned Ed25519 public key configuration', async () => {
    const root = await temporaryDirectory()
    const keyringPath = join(root, 'official-keys.json')
    const { publicKey } = generateKeyPairSync('ed25519')
    await writeFile(keyringPath, JSON.stringify({
      schemaVersion: 1,
      keys: [{
        keyId: 'sciforge-release-test',
        publisherId: 'sciforge',
        algorithm: 'ed25519',
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
      }]
    }))

    const loaded = await loadOfficialExtensionKeyring({
      appPath: root,
      resourcesPath: root,
      isPackaged: false,
      explicitPath: keyringPath
    })

    expect(loaded.sourcePath).toBe(keyringPath)
    expect(loaded.keys).toEqual([expect.objectContaining({
      keyId: 'sciforge-release-test',
      publisherId: 'sciforge'
    })])
  })

  it('rejects a missing explicitly configured keyring', async () => {
    const root = await temporaryDirectory()
    await expect(loadOfficialExtensionKeyring({
      appPath: root,
      resourcesPath: root,
      isPackaged: false,
      explicitPath: join(root, 'missing.json')
    })).rejects.toThrow('does not exist')
  })

  it('rejects syntactically valid configuration containing a non-Ed25519 key', async () => {
    const root = await temporaryDirectory()
    const keyringPath = join(root, 'official-keys.json')
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    await writeFile(keyringPath, JSON.stringify({
      schemaVersion: 1,
      keys: [{
        keyId: 'wrong-algorithm',
        publisherId: 'sciforge',
        algorithm: 'ed25519',
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
      }]
    }))

    await expect(loadOfficialExtensionKeyring({
      appPath: root,
      resourcesPath: root,
      isPackaged: false,
      explicitPath: keyringPath
    })).rejects.toThrow('not a valid Ed25519 public key')
  })
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'sciforge-official-keyring-'))
  temporaryPaths.push(path)
  return path
}
