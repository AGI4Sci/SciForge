import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import {
  createDomainPackageStorageFactory,
  createPlatformPackageEncryption
} from './domain-package-storage'
import { ManagedSecretRedactionRegistry } from './managed-secret-redaction'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })))
})

async function fixture(currentPrincipal?: () => PrincipalSnapshot | undefined) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-domain-storage-'))
  temporaryDirectories.push(userDataDir)
  const encryption = {
    currentState: 'available' as 'available' | 'unavailable' | 'insecure',
    state() {
      return this.currentState
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
    factory: createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal: currentPrincipal ?? (() => undefined),
      secretRedaction: new ManagedSecretRedactionRegistry()
    })
  }
}

const principalA: PrincipalSnapshot = {
  authority: 'sciforge.local-account',
  subject: 'local-account-a',
  assurance: 'local-selection',
  deviceId: 'test-device',
  identityVersion: 1
}

const accessA = Object.freeze({
  binding: Object.freeze({
    providerInstanceRef: 'opencontent.demo',
    connectionId: 'connection-a'
  }),
  expectedPrincipal: principalA
})

async function storedSecretsPath(userDataDir: string): Promise<string> {
  const root = join(userDataDir, 'domain-package-storage')
  const [owner] = await readdir(root)
  if (!owner) throw new Error('Expected an owner-scoped storage directory.')
  return join(root, owner, 'secrets.enc.json')
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

  it('restores owner-scoped generic package secrets in a separate process', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-identity-secrets-process-'))
    temporaryDirectories.push(userDataDir)

    const written = await runIdentitySecretsProcess('write', userDataDir)
    const restored = await runIdentitySecretsProcess('read', userDataDir)

    expect(written).toMatchObject({ ok: true, mode: 'write' })
    expect(restored).toMatchObject({ ok: true, mode: 'read' })
    expect(restored.pid).not.toBe(written.pid)
    const encrypted = await readFile(await storedSecretsPath(userDataDir), 'utf8')
    expect(encrypted).not.toContain('fixture-primary-secret-cross-process')
    expect(encrypted).not.toContain('fixture-secondary-secret-cross-process')
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    const { factory, encryption } = await fixture()
    encryption.currentState = 'unavailable'
    const storage = factory.forOwner({ moduleId: 'example.secrets', moduleVersion: '1.0.0' })

    await expect(storage.secrets.write('device.credential', 'fixture-value')).rejects.toThrow(
      'encryption is unavailable'
    )
  })

  it('uses a provider credential only for the current principal binding', async () => {
    let currentPrincipal: PrincipalSnapshot | undefined = principalA
    const { factory } = await fixture(() => currentPrincipal)
    const storage = factory.forOwner({
      moduleId: 'example.opencontent-connector',
      moduleVersion: '1.0.0'
    })
    const credentials = storage.secrets.providerCredentials!
    await credentials.replace(accessA, 'opaque-token')
    await expect(credentials.use(accessA, async (secret) => secret.length)).resolves.toBe(12)

    const principalB: PrincipalSnapshot = {
      ...currentPrincipal,
      subject: 'local-account-b',
      identityVersion: 2
    }
    currentPrincipal = principalB
    await expect(credentials.status(accessA)).rejects.toMatchObject({
      code: 'credential_binding_mismatch'
    })
    const accessB = { ...accessA, expectedPrincipal: principalB }
    await expect(credentials.status(accessB)).resolves.toEqual({ state: 'absent' })
    await expect(credentials.use(accessB, async () => undefined)).rejects.toMatchObject({
      code: 'credential_unavailable'
    })

    const renewedPrincipalA: PrincipalSnapshot = {
      ...currentPrincipal,
      subject: 'local-account-a',
      identityVersion: 3
    }
    currentPrincipal = renewedPrincipalA
    await expect(credentials.use(accessA, async () => undefined)).rejects.toMatchObject({
      code: 'credential_binding_mismatch'
    })
    await expect(credentials.use({
      ...accessA,
      expectedPrincipal: renewedPrincipalA
    }, async (secret) => secret.length)).resolves.toBe(12)
  })

  it('does not commit an expected Principal credential into a Principal that wins the storage lock', async () => {
    let currentPrincipal: PrincipalSnapshot | undefined = principalA
    const { factory } = await fixture(() => currentPrincipal)
    const credentials = factory.forOwner({
      moduleId: 'example.principal-lock-race',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!
    await credentials.replace(accessA, 'principal-a-token')

    let releaseUse!: () => void
    let markUseStarted!: () => void
    const useGate = new Promise<void>((resolve) => { releaseUse = resolve })
    const useStarted = new Promise<void>((resolve) => { markUseStarted = resolve })
    const activeUse = credentials.use(accessA, async () => {
      markUseStarted()
      await useGate
    })
    await useStarted
    const queuedReplace = credentials.replace(accessA, 'must-not-bind-to-principal-b')
    const principalB = Object.freeze({
      ...principalA,
      subject: 'local-account-b',
      identityVersion: 2
    })
    currentPrincipal = principalB
    releaseUse()

    await expect(activeUse).rejects.toMatchObject({ code: 'credential_binding_mismatch' })
    await expect(queuedReplace).rejects.toMatchObject({ code: 'credential_binding_mismatch' })
    await expect(credentials.status({
      ...accessA,
      expectedPrincipal: principalB
    })).resolves.toEqual({ state: 'absent' })
  })

  it('persists one atomic credential across replace, restart, remove, and restart', async () => {
    const currentPrincipal = () => principalA
    const { userDataDir, encryption, factory } = await fixture(currentPrincipal)
    const owner = { moduleId: 'example.lifecycle', moduleVersion: '1.0.0' }
    const first = factory.forOwner(owner).secrets.providerCredentials!
    await first.replace(accessA, 'first-opaque-value')

    const restarted = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal
    }).forOwner({ ...owner, moduleVersion: '2.0.0' }).secrets.providerCredentials!
    await expect(restarted.use(accessA, (secret) => secret)).resolves.toBe('first-opaque-value')
    await restarted.replace(accessA, 'second-opaque-value')

    const afterReplace = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal
    }).forOwner(owner).secrets.providerCredentials!
    await expect(afterReplace.use(accessA, (secret) => secret)).resolves.toBe('second-opaque-value')
    await afterReplace.remove(accessA)

    const afterRemove = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal
    }).forOwner(owner).secrets.providerCredentials!
    await expect(afterRemove.status(accessA)).resolves.toEqual({ state: 'absent' })
    await expect(afterRemove.use(accessA, () => undefined)).rejects.toMatchObject({
      code: 'credential_unavailable'
    })
  })

  it('fails closed for absent, wrong-node, and mismatched expected principals', async () => {
    let current: PrincipalSnapshot | undefined
    const { factory } = await fixture(() => current)
    const credentials = factory.forOwner({
      moduleId: 'example.negative-principal',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!

    await expect(credentials.status(accessA)).rejects.toMatchObject({ code: 'principal_unavailable' })
    current = { ...principalA, deviceId: 'other-device' }
    await expect(credentials.status(accessA)).rejects.toMatchObject({
      code: 'principal_device_mismatch'
    })
    current = principalA
    await expect(credentials.status({
      ...accessA,
      expectedPrincipal: { ...principalA, assurance: 'cloud-authenticated' }
    })).rejects.toMatchObject({ code: 'credential_binding_mismatch' })
  })

  it('does not enumerate another principal, binding, node, or package owner', async () => {
    let current: PrincipalSnapshot | undefined = principalA
    const { userDataDir, encryption, factory } = await fixture(() => current)
    const owner = { moduleId: 'example.owner-a', moduleVersion: '1.0.0' }
    const credentials = factory.forOwner(owner).secrets.providerCredentials!
    await credentials.replace(accessA, 'owner-a-secret')

    await expect(credentials.status({
      ...accessA,
      binding: { ...accessA.binding, providerInstanceRef: 'opencontent.other' }
    })).resolves.toEqual({ state: 'absent' })
    await expect(credentials.status({
      ...accessA,
      binding: { ...accessA.binding, connectionId: 'connection-b' }
    })).resolves.toEqual({ state: 'absent' })
    current = { ...principalA, subject: 'local-account-b', identityVersion: 2 }
    await expect(credentials.status({
      ...accessA,
      expectedPrincipal: current
    })).resolves.toEqual({ state: 'absent' })

    current = principalA
    const otherOwner = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal: () => current
    }).forOwner({ moduleId: 'example.owner-b', moduleVersion: '1.0.0' })
      .secrets.providerCredentials!
    await expect(otherOwner.status(accessA)).resolves.toEqual({ state: 'absent' })
  })

  it('rejects a Principal lease change during bounded secret use', async () => {
    let current: PrincipalSnapshot | undefined = principalA
    const { factory } = await fixture(() => current)
    const credentials = factory.forOwner({
      moduleId: 'example.lease-change',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!
    await credentials.replace(accessA, 'lease-secret')
    await expect(credentials.use(accessA, () => {
      current = { ...principalA, identityVersion: 2 }
      return 'must-not-return'
    })).rejects.toMatchObject({ code: 'credential_binding_mismatch' })
  })

  it('fails closed for insecure, corrupt, and undecryptable secure storage', async () => {
    const { factory, encryption, userDataDir } = await fixture(() => principalA)
    const credentials = factory.forOwner({
      moduleId: 'example.failure-states',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!

    encryption.currentState = 'unavailable'
    await expect(credentials.status(accessA)).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
    await expect(credentials.remove(accessA)).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
    encryption.currentState = 'insecure'
    await expect(credentials.replace(accessA, 'never-written')).rejects.toMatchObject({
      code: 'secure_storage_insecure'
    })
    encryption.currentState = 'available'
    await credentials.replace(accessA, 'opaque-canary')
    const secretsPath = await storedSecretsPath(userDataDir)
    const validEnvelope = await readFile(secretsPath, 'utf8')
    await writeFile(secretsPath, '{"version":1,"encrypted":[]}', 'utf8')
    await expect(credentials.status(accessA)).rejects.toMatchObject({
      code: 'secure_storage_corrupt'
    })

    await writeFile(secretsPath, validEnvelope, 'utf8')
    const decryptingFactory = createDomainPackageStorageFactory({
      userDataDir,
      encryption: {
        ...encryption,
        decryptString: () => { throw new Error('keychain locked') }
      },
      getDeviceId: () => 'test-device',
      currentPrincipal: () => principalA
    })
    const decryptingCredentials = decryptingFactory.forOwner({
      moduleId: 'example.failure-states',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!
    await expect(decryptingCredentials.status(accessA)).rejects.toMatchObject({
      code: 'secure_storage_undecryptable'
    })
  })

  it('keeps the prior committed state after interrupted replace or delete', async () => {
    const currentPrincipal = () => principalA
    const { userDataDir, encryption, factory } = await fixture(currentPrincipal)
    const owner = { moduleId: 'example.interrupted', moduleVersion: '1.0.0' }
    await factory.forOwner(owner).secrets.providerCredentials!
      .replace(accessA, 'committed-before-interruption')
    const interrupted = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal,
      atomicWrite: async () => { throw new Error('simulated interruption') }
    }).forOwner(owner).secrets.providerCredentials!

    await expect(interrupted.replace(accessA, 'partial-replacement')).rejects.toThrow(
      'simulated interruption'
    )
    await expect(interrupted.remove(accessA)).rejects.toThrow('simulated interruption')
    const restarted = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal
    }).forOwner(owner).secrets.providerCredentials!
    await expect(restarted.use(accessA, (secret) => secret)).resolves
      .toBe('committed-before-interruption')
  })

  it('does not commit queued provider mutations after their signal aborts', async () => {
    const { factory } = await fixture(() => principalA)
    const credentials = factory.forOwner({
      moduleId: 'example.aborted-mutation',
      moduleVersion: '1.0.0'
    }).secrets.providerCredentials!
    await credentials.replace(accessA, 'committed-token')

    const holdLock = async (): Promise<() => void> => {
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const active = new Promise<void>((resolve) => { started = resolve })
      const use = credentials.use(accessA, async () => {
        started()
        await gate
      })
      await active
      return () => {
        release()
        void use
      }
    }

    const releaseReplaceLock = await holdLock()
    const replaceController = new AbortController()
    const replace = credentials.replace(
      accessA,
      'must-not-commit',
      { signal: replaceController.signal }
    )
    let replaceSettled = false
    let replaceFailure: unknown
    void replace.then(
      () => { replaceSettled = true },
      (error: unknown) => {
        replaceSettled = true
        replaceFailure = error
      }
    )
    replaceController.abort(new Error('replace aborted before commit'))
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    try {
      expect(replaceSettled).toBe(true)
      expect(replaceFailure).toMatchObject({ message: 'replace aborted before commit' })
    } finally {
      releaseReplaceLock()
    }
    await expect(replace).rejects.toThrow('replace aborted before commit')
    await expect(credentials.use(accessA, (secret) => secret)).resolves.toBe('committed-token')

    const releaseRemoveLock = await holdLock()
    const removeController = new AbortController()
    const remove = credentials.remove(accessA, { signal: removeController.signal })
    let removeSettled = false
    let removeFailure: unknown
    void remove.then(
      () => { removeSettled = true },
      (error: unknown) => {
        removeSettled = true
        removeFailure = error
      }
    )
    removeController.abort(new Error('remove aborted before commit'))
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    try {
      expect(removeSettled).toBe(true)
      expect(removeFailure).toMatchObject({ message: 'remove aborted before commit' })
    } finally {
      releaseRemoveLock()
    }
    await expect(remove).rejects.toThrow('remove aborted before commit')
    await expect(credentials.use(accessA, (secret) => secret)).resolves.toBe('committed-token')
  })

  it('finishes an atomic provider mutation once commit dispatch has started', async () => {
    const currentPrincipal = () => principalA
    const { userDataDir, encryption, factory } = await fixture(currentPrincipal)
    const owner = { moduleId: 'example.commit-boundary', moduleVersion: '1.0.0' }
    await factory.forOwner(owner).secrets.providerCredentials!
      .replace(accessA, 'before-commit-boundary')
    let markWriteStarted!: () => void
    let releaseWrite!: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const credentials = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal,
      atomicWrite: async (path, value) => {
        markWriteStarted()
        await writeGate
        await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
      }
    }).forOwner(owner).secrets.providerCredentials!
    const controller = new AbortController()
    const replace = credentials.replace(
      accessA,
      'after-commit-boundary',
      { signal: controller.signal }
    )
    await writeStarted
    controller.abort(new Error('abort arrived after commit dispatch'))
    releaseWrite()

    await expect(replace).resolves.toBeUndefined()
    const restarted = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal
    }).forOwner(owner).secrets.providerCredentials!
    await expect(restarted.use(accessA, (secret) => secret)).resolves
      .toBe('after-commit-boundary')
  })

  it('keeps non-use provider credential operations free of retained plaintext', async () => {
    const registry = new ManagedSecretRedactionRegistry()
    const { userDataDir, encryption } = await fixture(() => principalA)
    const credentials = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal: () => principalA,
      secretRedaction: registry
    }).forOwner({ moduleId: 'example.redaction', moduleVersion: '1.0.0' })
      .secrets.providerCredentials!
    const first = 'opaque-canary-alpha-9d22'
    const second = 'opaque-canary-beta-17c4'
    await credentials.replace(accessA, first)
    expect(registry.values()).toEqual([])
    await expect(credentials.status(accessA)).resolves.toEqual({
      state: 'available',
      recordVersion: 1
    })
    expect(registry.values()).toEqual([])
    await credentials.replace(accessA, second)
    expect(registry.values()).toEqual([])
    expect(await readFile(await storedSecretsPath(userDataDir), 'utf8')).not.toContain(first)
    expect(await readFile(await storedSecretsPath(userDataDir), 'utf8')).not.toContain(second)
    await credentials.remove(accessA)
    expect(registry.values()).toEqual([])
  })

  it('registers provider credential plaintext only for the bounded use callback', async () => {
    const registry = new ManagedSecretRedactionRegistry()
    const { userDataDir, encryption } = await fixture(() => principalA)
    const credentials = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal: () => principalA,
      secretRedaction: registry
    }).forOwner({ moduleId: 'example.bounded-redaction', moduleVersion: '1.0.0' })
      .secrets.providerCredentials!
    const secret = 'opaque-use-canary-32b1'
    await credentials.replace(accessA, secret)

    await expect(credentials.use(accessA, (value) => {
      expect(value).toBe(secret)
      expect(registry.values()).toEqual([secret])
      return 'used'
    })).resolves.toBe('used')
    expect(registry.values()).toEqual([])

    const safeFailure = new Error('bounded use failed')
    const outwardFailure = await credentials.use(accessA, () => {
      expect(registry.values()).toEqual([secret])
      throw safeFailure
    }).catch((error: unknown) => error)
    expect(outwardFailure).not.toBe(safeFailure)
    expect(outwardFailure).toMatchObject({ name: 'Error', message: 'bounded use failed' })
    expect(registry.values()).toEqual([])
  })

  it('scrubs callback failures before releasing the provider credential redaction lease', async () => {
    class FixtureProviderError extends Error {
      readonly code = 'provider_unavailable'
      readonly detail: Readonly<{ url: string }>
      readonly #capturedSecret: string

      constructor(secret: string) {
        super(`Provider echoed ${secret}`)
        this.name = 'FixtureProviderError'
        this.#capturedSecret = secret
        this.detail = Object.freeze({ url: `https://provider.invalid/failure?value=${secret}` })
      }

      get leakedFromPrototype(): string {
        return this.#capturedSecret
      }

      revealFromPrototype(): string {
        return this.#capturedSecret
      }
    }

    const registry = new ManagedSecretRedactionRegistry()
    const { userDataDir, encryption } = await fixture(() => principalA)
    const credentials = createDomainPackageStorageFactory({
      userDataDir,
      encryption,
      getDeviceId: () => 'test-device',
      currentPrincipal: () => principalA,
      secretRedaction: registry
    }).forOwner({ moduleId: 'example.redacted-failure', moduleVersion: '1.0.0' })
      .secrets.providerCredentials!
    const secret = 'opaque-error-canary-7c14'
    await credentials.replace(accessA, secret)

    let failure: unknown
    try {
      await credentials.use(accessA, (value) => {
        throw new FixtureProviderError(value)
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(FixtureProviderError)
    expect(failure).toMatchObject({ code: 'provider_unavailable' })
    expect(typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, 'leakedFromPrototype')
      : undefined).toBeUndefined()
    expect(typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, 'revealFromPrototype')
      : undefined).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(String(failure)).not.toContain(secret)
    expect(failure instanceof Error ? failure.stack : '').not.toContain(secret)
    expect(registry.values()).toEqual([])
  })

  it('approves only supported platform secure-storage backends', () => {
    const safeStorage = {
      available: true,
      backend: 'gnome_libsecret',
      isEncryptionAvailable() { return this.available },
      getSelectedStorageBackend() { return this.backend },
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString()
    }
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'darwin' }).state())
      .toBe('available')
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'win32' }).state())
      .toBe('available')
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'linux' }).state())
      .toBe('available')
    safeStorage.backend = 'basic_text'
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'linux' }).state())
      .toBe('insecure')
    safeStorage.available = false
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'win32' }).state())
      .toBe('unavailable')
    safeStorage.available = true
    expect(createPlatformPackageEncryption({ safeStorage, platform: 'freebsd' }).state())
      .toBe('unavailable')
  })
})

async function runIdentitySecretsProcess(
  mode: 'write' | 'read',
  userDataDir: string
): Promise<{ ok: true; mode: string; pid: number }> {
  const fixturePath = resolve('scripts/fixtures/package-secrets-process.mjs')
  const child = spawn(process.execPath, ['--import', 'tsx', fixturePath, mode, userDataDir], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdout: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.resume()
  const outcome = await new Promise<{ exitCode: number | null; timedOut: boolean }>((resolveExit, reject) => {
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 10_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      resolveExit({ exitCode, timedOut })
    })
  })
  if (outcome.timedOut) {
    throw new Error(`Identity secrets ${mode} process timed out after 10000ms.`)
  }
  if (outcome.exitCode !== 0) {
    throw new Error(`Identity secrets ${mode} process failed with exit code ${outcome.exitCode}.`)
  }
  return JSON.parse(Buffer.concat(stdout).toString()) as { ok: true; mode: string; pid: number }
}
