/**
 * Publisher trust for DSH artifacts. The tests that matter are the ones where a
 * plausible-looking artifact is refused, so most cases below are refusals.
 * Keys are generated inside the test itself: no fixture key, no production key.
 */
import { describe, expect, it } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from './canonical-json'
import { ExtensionStoreError } from './errors'
import {
  DSH_PUBLISHER_KEYRING_ENV,
  loadDshPublisherKeyring,
  parseDshPluginSignature,
  resolveDshPublisherKeyringPath,
  verifyDshPluginSignature,
  type DshPublisherKeyring
} from './dsh-plugin-signature'

const manifestBytes = Buffer.from(canonicalJson({ packageName: '@sciforge/plugin-demo', version: '1.0.0' }))

type TestKey = Readonly<{ keyId: string; publisherId: string; privateKeyPem: string; publicKeyPem: string }>

function makeKey(keyId: string, publisherId: string, algorithm: 'ed25519' | 'rsa' = 'ed25519'): TestKey {
  const { privateKey, publicKey } = algorithm === 'ed25519'
    ? generateKeyPairSync('ed25519')
    : generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    keyId,
    publisherId,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

async function keyringFrom(...keys: readonly TestKey[]): Promise<DshPublisherKeyring> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-keyring-'))
  const path = join(directory, 'dsh-publisher-keys.json')
  await writeFile(path, JSON.stringify({
    version: 1,
    keys: keys.map((key) => ({ keyId: key.keyId, publisherId: key.publisherId, publicKey: key.publicKeyPem }))
  }))
  return loadDshPublisherKeyring(path)
}

function sign(key: TestKey, overrides: Partial<{ keyId: string; publisherId: string }> = {}): Buffer {
  return Buffer.from(canonicalJson({
    version: 1,
    algorithm: 'ed25519',
    keyId: overrides.keyId ?? key.keyId,
    publisherId: overrides.publisherId ?? key.publisherId,
    signature: signEd25519(null, manifestBytes, createPrivateKey(key.privateKeyPem)).toString('base64')
  }))
}

describe('resolveDshPublisherKeyringPath', () => {
  it('prefers the explicit override', () => {
    expect(resolveDshPublisherKeyringPath('/profile', { [DSH_PUBLISHER_KEYRING_ENV]: '/elsewhere/keys.json' }))
      .toBe('/elsewhere/keys.json')
  })

  it('falls back to the profile default', () => {
    expect(resolveDshPublisherKeyringPath('/profile', {}))
      .toBe('/profile/extensions/dsh-publisher-keys.json')
  })
})

describe('loadDshPublisherKeyring', () => {
  it('treats a missing keyring as trusting nobody', async () => {
    const keyring = await loadDshPublisherKeyring(join(await mkdtemp(join(tmpdir(), 'dsh-keys-')), 'absent.json'))
    expect(keyring.keys.size).toBe(0)
  })

  it('rejects a malformed keyring instead of ignoring it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-keys-'))
    const path = join(directory, 'keys.json')
    await writeFile(path, JSON.stringify({ version: 1, keys: [{ keyId: 'k', publisherId: 'p', publicKey: '' }] }))
    await expect(loadDshPublisherKeyring(path)).rejects.toThrow(ExtensionStoreError)
  })

  it('refuses a key that is not Ed25519', async () => {
    const rsa = makeKey('rsa-key', 'publisher-a', 'rsa')
    await expect(keyringFrom(rsa)).rejects.toThrow(/must be an Ed25519 public key/)
  })

  it('refuses a keyring with a duplicate key id', async () => {
    const key = makeKey('duplicate', 'publisher-a')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-keys-'))
    const path = join(directory, 'keys.json')
    await writeFile(path, JSON.stringify({
      version: 1,
      keys: [
        { keyId: key.keyId, publisherId: key.publisherId, publicKey: key.publicKeyPem },
        { keyId: key.keyId, publisherId: key.publisherId, publicKey: key.publicKeyPem }
      ]
    }))
    await expect(loadDshPublisherKeyring(path)).rejects.toThrow(/duplicate key/)
  })
})

describe('verifyDshPluginSignature', () => {
  it('trusts a signature made by a key the host holds', async () => {
    const key = makeKey('official-key-1', 'sciforge')
    const keyring = await keyringFrom(key)
    expect(verifyDshPluginSignature({ manifestBytes, signatureBytes: sign(key), keyring }))
      .toEqual({ keyId: 'official-key-1', publisherId: 'sciforge' })
  })

  it('refuses an artifact that carries no signature', async () => {
    const keyring = await keyringFrom(makeKey('official-key-1', 'sciforge'))
    expect(() => verifyDshPluginSignature({ manifestBytes, signatureBytes: undefined, keyring }))
      .toThrow(/not signed/)
  })

  it('refuses a signature file that is not canonical JSON', () => {
    const padded = Buffer.from(`${JSON.stringify({
      version: 1,
      algorithm: 'ed25519',
      keyId: 'official-key-1',
      publisherId: 'sciforge',
      signature: 'AAAA'
    }, null, 2)}`)
    expect(() => parseDshPluginSignature(padded)).toThrow(/canonical JSON/)
  })

  it('refuses a signature whose key is not in the host keyring', async () => {
    const trusted = makeKey('official-key-1', 'sciforge')
    const foreign = makeKey('foreign-key', 'someone-else')
    const keyring = await keyringFrom(trusted)
    let caught: unknown
    try {
      verifyDshPluginSignature({ manifestBytes, signatureBytes: sign(foreign), keyring })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExtensionStoreError)
    expect((caught as ExtensionStoreError).code).toBe('unknown_signing_key')
  })

  it('refuses a signature that relabels itself with another publisher id', async () => {
    const trusted = makeKey('official-key-1', 'sciforge')
    const keyring = await keyringFrom(trusted)
    let caught: unknown
    try {
      verifyDshPluginSignature({
        manifestBytes,
        signatureBytes: sign(trusted, { publisherId: 'someone-else' }),
        keyring
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExtensionStoreError)
    expect((caught as ExtensionStoreError).code).toBe('publisher_mismatch')
  })

  it('refuses a signature whose bytes were changed', async () => {
    const key = makeKey('official-key-1', 'sciforge')
    const keyring = await keyringFrom(key)
    const original = JSON.parse(sign(key).toString('utf8')) as { signature: string }
    const tampered = Buffer.from(original.signature, 'base64')
    tampered[0] ^= 0xff
    const signatureBytes = Buffer.from(canonicalJson({ ...original, signature: tampered.toString('base64') }))
    let caught: unknown
    try {
      verifyDshPluginSignature({ manifestBytes, signatureBytes, keyring })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExtensionStoreError)
    expect((caught as ExtensionStoreError).code).toBe('invalid_signature')
  })

  it('refuses a valid signature once the manifest bytes change', async () => {
    const key = makeKey('official-key-1', 'sciforge')
    const keyring = await keyringFrom(key)
    const signatureBytes = sign(key)
    const altered = Buffer.from(canonicalJson({ packageName: '@sciforge/plugin-demo', version: '1.0.1' }))
    expect(() => verifyDshPluginSignature({ manifestBytes: altered, signatureBytes, keyring }))
      .toThrow(/does not match the artifact bytes/)
  })
})