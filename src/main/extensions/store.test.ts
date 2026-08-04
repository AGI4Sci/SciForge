import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionStoreError } from './errors'
import {
  createSignedTestArtifact,
  writeArtifactDirectory
} from './test-helpers'
import { SignedExtensionStore } from './store'

const temporaryPaths: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryPaths.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('SignedExtensionStore', () => {
  it('atomically installs, persists, verifies status, disables, and uninstalls an extension', async () => {
    const fixture = await createStoreFixture()
    const artifactPath = await fixture.artifact('1.0.0')

    const installed = await fixture.store.install({ kind: 'directory', path: artifactPath })
    expect(installed.health).toBe('ready')
    expect(installed.package.activeVersion).toBe('1.0.0')
    expect(installed.active.runtime.kind).toBe('sandboxed-runtime')
    expect(installed.active.executionSecurity).toMatchObject({
      trust: 'official',
      codeIsolation: 'extension-host',
      rendererIsolation: 'sandboxed-webview',
      capabilityAccess: 'brokered',
      thirdPartyReady: true
    })
    expect(await readFile(join(installed.installPath, 'dist/main.mjs'), 'utf8')).toContain('activate')

    await expectErrorCode(
      fixture.store.install({ kind: 'directory', path: artifactPath }),
      'duplicate_extension'
    )

    const disabled = await fixture.store.setEnabled('@sciforge/domain-test-extension', false)
    expect(disabled.enabled).toBe(false)
    const reopened = fixture.reopen()
    expect((await reopened.list())[0]?.enabled).toBe(false)
    expect((await reopened.status('@sciforge/domain-test-extension'))?.health).toBe('ready')

    expect(await reopened.uninstall('@sciforge/domain-test-extension')).toBe(true)
    expect(await reopened.list()).toEqual([])
    expect(await reopened.uninstall('@sciforge/domain-test-extension')).toBe(false)
  })

  it('retains prior signed versions and rolls back by an atomic registry change', async () => {
    const fixture = await createStoreFixture()
    await fixture.store.install({ kind: 'directory', path: await fixture.artifact('1.0.0') })
    await fixture.store.install({ kind: 'directory', path: await fixture.artifact('1.1.0') })

    expect((await fixture.store.status('@sciforge/domain-test-extension'))?.active.version).toBe('1.1.0')
    const rolledBack = await fixture.store.rollback('@sciforge/domain-test-extension')
    expect(rolledBack.active.version).toBe('1.0.0')
    expect(rolledBack.package.versions.map((entry) => entry.version)).toEqual(['1.0.0', '1.1.0'])

    expect(await fixture.store.uninstall('@sciforge/domain-test-extension', '1.0.0')).toBe(true)
    expect((await fixture.store.status('@sciforge/domain-test-extension'))?.active.version).toBe('1.1.0')
  })

  it('reports on-disk tampering without activating corrupted content', async () => {
    const fixture = await createStoreFixture()
    const installed = await fixture.store.install({
      kind: 'directory',
      path: await fixture.artifact('1.0.0')
    })
    await writeFile(join(installed.installPath, 'dist/main.mjs'), 'export const tampered = true\n')

    const status = await fixture.store.status('@sciforge/domain-test-extension')
    expect(status?.health).toBe('corrupt')
    expect(status?.issue).toContain('digest does not match')
  })

  it('rejects a conflicting package identity that attempts to claim an installed module', async () => {
    const fixture = await createStoreFixture()
    await fixture.store.install({ kind: 'directory', path: await fixture.artifact('1.0.0') })
    const conflictPath = join(fixture.rootPath, 'conflict')
    await writeArtifactDirectory(conflictPath, createSignedTestArtifact({
      privateKey: fixture.privateKey,
      packageName: '@sciforge/domain-conflict',
      moduleId: 'sciforge.test-extension'
    }))

    await expectErrorCode(
      fixture.store.install({ kind: 'directory', path: conflictPath }),
      'conflicting_identity'
    )
  })

  it('rejects package and module identities reserved by the application bundle', async () => {
    const fixture = await createStoreFixture({
      packageNames: ['@sciforge/domain-test-extension'],
      moduleIds: []
    })

    await expectErrorCode(
      fixture.store.install({ kind: 'directory', path: await fixture.artifact('1.0.0') }),
      'conflicting_identity'
    )
    expect(await fixture.store.list()).toEqual([])
  })

  it('serializes concurrent installs so only one duplicate identity can commit', async () => {
    const fixture = await createStoreFixture()
    const artifactPath = await fixture.artifact('1.0.0')
    const outcomes = await Promise.allSettled([
      fixture.store.install({ kind: 'directory', path: artifactPath }),
      fixture.store.install({ kind: 'directory', path: artifactPath })
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'duplicate_extension'
    })
    expect(await fixture.store.list()).toHaveLength(1)
  })
})

async function createStoreFixture(
  reservedIdentities?: Readonly<{
    packageNames?: readonly string[]
    moduleIds?: readonly string[]
  }>
) {
  const rootPath = await mkdtemp(join(tmpdir(), 'sciforge-extension-store-'))
  temporaryPaths.push(rootPath)
  const keys = generateKeyPairSync('ed25519')
  const options = {
    userDataPath: join(rootPath, 'user-data'),
    hostApiVersion: '1.0.0',
    trustedKeys: [{
      keyId: 'official-test-key',
      publisherId: 'sciforge',
      publicKey: keys.publicKey
    }] as const,
    ...(reservedIdentities ? { reservedIdentities } : {}),
    now: () => new Date('2026-07-27T00:00:00.000Z')
  }
  return {
    rootPath,
    privateKey: keys.privateKey,
    store: new SignedExtensionStore(options),
    reopen: () => new SignedExtensionStore(options),
    artifact: async (version: string) => {
      const artifactPath = join(rootPath, `artifact-${version}`)
      await writeArtifactDirectory(artifactPath, createSignedTestArtifact({
        privateKey: keys.privateKey,
        version
      }))
      return artifactPath
    }
  }
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
