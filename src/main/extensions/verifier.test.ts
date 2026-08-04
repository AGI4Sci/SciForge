import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readExtensionArtifact } from './artifact-reader'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import { ExtensionStoreError } from './errors'
import {
  createSignedTestArtifact,
  writeArtifactDirectory,
  zipArtifact
} from './test-helpers'
import {
  EXTENSION_INTEGRITY_PATH,
  EXTENSION_SIGNATURE_PATH
} from './types'
import { ExtensionArtifactVerifier } from './verifier'

const temporaryPaths: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryPaths.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('ExtensionArtifactVerifier', () => {
  it('verifies a complete official Ed25519-signed ZIP artifact', async () => {
    const keys = generateKeyPairSync('ed25519')
    const files = createSignedTestArtifact({ privateKey: keys.privateKey })
    const verifier = createVerifier(keys.publicKey)

    const verified = await verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(files)
    })

    expect(verified.definition.kind).toBe('sandboxed-runtime')
    expect(verified.definition.packageName).toBe('@sciforge/domain-test-extension')
    expect(verified.signer).toEqual({
      publisherId: 'sciforge',
      keyId: 'official-test-key',
      trust: 'official',
      algorithm: 'ed25519'
    })
    expect(verified.files.get('dist/main.mjs')?.toString()).toContain('activate')
  })

  it('rejects unsigned, unknown-key, publisher-mismatched, and tampered artifacts', async () => {
    const keys = generateKeyPairSync('ed25519')
    const verifier = createVerifier(keys.publicKey)

    const unsigned = createSignedTestArtifact({ privateKey: keys.privateKey })
    unsigned.delete(EXTENSION_SIGNATURE_PATH)
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(unsigned)
    }), 'invalid_signature')

    const unknownKey = createSignedTestArtifact({
      privateKey: keys.privateKey,
      keyId: 'unknown-key'
    })
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(unknownKey)
    }), 'unknown_signing_key')

    const wrongPublisher = createSignedTestArtifact({
      privateKey: keys.privateKey,
      publisherId: 'other-publisher'
    })
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(wrongPublisher)
    }), 'publisher_mismatch')

    const tampered = createSignedTestArtifact({ privateKey: keys.privateKey })
    tampered.set('dist/main.mjs', Buffer.from('export const compromised = true\n'))
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(tampered)
    }), 'invalid_integrity_manifest')
  })

  it('requires canonical integrity JSON even when the detached signature is valid', async () => {
    const keys = generateKeyPairSync('ed25519')
    const files = createSignedTestArtifact({ privateKey: keys.privateKey })
    const parsed = JSON.parse(files.get(EXTENSION_INTEGRITY_PATH)!.toString('utf8'))
    const nonCanonical = Buffer.from(JSON.stringify(parsed, null, 2))
    files.set(EXTENSION_INTEGRITY_PATH, nonCanonical)
    files.set(EXTENSION_SIGNATURE_PATH, Buffer.from(JSON.stringify({
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId: 'official-test-key',
      signature: sign(null, nonCanonical, keys.privateKey).toString('base64')
    })))

    await expectErrorCode(createVerifier(keys.publicKey).verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(files)
    }), 'invalid_integrity_manifest')
  })

  it('rejects incompatible host APIs and install lifecycle scripts', async () => {
    const keys = generateKeyPairSync('ed25519')
    const verifier = createVerifier(keys.publicKey)
    const incompatible = createSignedTestArtifact({
      privateKey: keys.privateKey,
      hostMinimum: '2.0.0',
      hostMaximumExclusive: '3.0.0'
    })
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(incompatible)
    }), 'incompatible_host_api')

    const scripted = createSignedTestArtifact({
      privateKey: keys.privateKey,
      packageScripts: { postinstall: 'node install.js' }
    })
    await expectErrorCode(verifier.verify({
      kind: 'zip-bytes',
      bytes: await zipArtifact(scripted)
    }), 'install_scripts_forbidden')
  })

  it('rejects directory symlinks and ZIP traversal or symlink entries', async () => {
    const rootPath = await temporaryDirectory()
    await writeFile(join(rootPath, 'outside.txt'), 'outside')
    const artifactPath = join(rootPath, 'artifact')
    await writeArtifactDirectory(artifactPath, new Map([
      ['payload.txt', Buffer.from('safe')]
    ]))
    await symlink(join(rootPath, 'outside.txt'), join(artifactPath, 'link.txt'))
    await expectErrorCode(
      readExtensionArtifact({ kind: 'directory', path: artifactPath }),
      'unsafe_artifact'
    )

    const traversalZip = new JSZip()
    traversalZip.file('../escape.txt', 'escape')
    await expectErrorCode(readExtensionArtifact({
      kind: 'zip-bytes',
      bytes: await traversalZip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    }), 'unsafe_artifact')

    const symlinkZip = new JSZip()
    symlinkZip.file('link', 'target', { unixPermissions: 0o120777 })
    await expectErrorCode(readExtensionArtifact({
      kind: 'zip-bytes',
      bytes: await symlinkZip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    }), 'unsafe_artifact')
  })

  it('rejects artifacts beyond configured compressed or unpacked limits', async () => {
    const zip = new JSZip()
    zip.file('payload.bin', Buffer.alloc(2_048, 1))
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      platform: 'UNIX',
      compression: 'STORE'
    })
    await expectErrorCode(readExtensionArtifact(
      { kind: 'zip-bytes', bytes },
      { maxArchiveBytes: 512 }
    ), 'artifact_too_large')
    await expectErrorCode(readExtensionArtifact(
      { kind: 'zip-bytes', bytes },
      { maxArchiveBytes: 8_192, maxUnpackedBytes: 1_024 }
    ), 'artifact_too_large')
  })
})

function createVerifier(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']) {
  return new ExtensionArtifactVerifier({
    hostApiVersion: '1.0.0',
    trustedKeys: [{
      keyId: 'official-test-key',
      publisherId: 'sciforge',
      publicKey
    }]
  })
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'sciforge-extension-verifier-'))
  temporaryPaths.push(path)
  return path
}

async function expectErrorCode(
  promise: Promise<unknown>,
  code: ExtensionStoreError['code']
): Promise<void> {
  try {
    await promise
    throw new Error(`Expected extension error ${code}.`)
  } catch (error) {
    expect(error).toBeInstanceOf(ExtensionStoreError)
    expect((error as ExtensionStoreError).code).toBe(code)
  }
}
