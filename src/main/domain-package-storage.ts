import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  DomainMainProviderCredentialError,
  domainMainPackageSecretKeySchema,
  domainMainPackageSettingsSnapshotSchema,
  domainMainProviderCredentialAccessSchema,
  domainMainProviderCredentialBindingSchema,
  type DomainMainPackageSecretStoreHost,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialAccess,
  type DomainMainProviderCredentialBinding,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainRuntimeContributionOwner } from '@sciforge/domain-sdk/host'
import {
  principalAssuranceSchema,
  principalAuthoritySchema,
  principalSubjectSchema,
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { z } from 'zod'
import type { ManagedSecretRedactionRegistry } from './managed-secret-redaction'
import { redactExactSensitiveValues } from '../shared/secret-redaction'

export type PackageEncryptionState = 'available' | 'unavailable' | 'insecure'

export type PackageEncryption = Readonly<{
  state: () => PackageEncryptionState
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}>

type ElectronSafeStorageLike = Readonly<{
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
  getSelectedStorageBackend?: () => string
}>

export type DomainPackageStorage = Readonly<{
  settings: DomainMainPackageSettingsHost
  secrets: DomainMainPackageSecretStoreHost
}>

export type DomainPackageStorageFactory = Readonly<{
  forOwner: (owner: DomainRuntimeContributionOwner) => DomainPackageStorage
}>

const APPROVED_LINUX_SECRET_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6'
])

/** Converts Electron safeStorage into an explicit fail-closed platform policy. */
export function createPlatformPackageEncryption(input: Readonly<{
  safeStorage: ElectronSafeStorageLike
  platform?: NodeJS.Platform
}>): PackageEncryption {
  const platform = input.platform ?? process.platform
  return Object.freeze({
    state: () => {
      try {
        if (!input.safeStorage.isEncryptionAvailable()) return 'unavailable'
        if (platform === 'darwin' || platform === 'win32') return 'available'
        if (platform !== 'linux') return 'unavailable'
        const backend = input.safeStorage.getSelectedStorageBackend?.()
        return backend && APPROVED_LINUX_SECRET_BACKENDS.has(backend)
          ? 'available'
          : 'insecure'
      } catch {
        return 'unavailable'
      }
    },
    encryptString: (value) => input.safeStorage.encryptString(value),
    decryptString: (value) => input.safeStorage.decryptString(value)
  })
}

type SettingsFile = Readonly<{
  revision: number
  value: DomainPackageJsonValue | null
}>

type SecretsFile = Readonly<{
  version: 1
  encrypted: Readonly<Record<string, string>>
}>

const storedProviderCredentialSchema = z.object({
  version: z.literal(1),
  nodeId: z.string().min(1).max(256),
  principal: z.object({
    authority: principalAuthoritySchema,
    subject: principalSubjectSchema,
    assurance: principalAssuranceSchema
  }).strict(),
  binding: domainMainProviderCredentialBindingSchema,
  secret: z.string().min(1).max(1_000_000)
}).strict()

type StoredProviderCredential = z.infer<typeof storedProviderCredentialSchema>

export function createDomainPackageStorageFactory(input: Readonly<{
  userDataDir: string
  encryption: PackageEncryption
  getDeviceId: () => string
  currentPrincipal: () => PrincipalSnapshot | undefined
  secretRedaction?: ManagedSecretRedactionRegistry
  atomicWrite?: (path: string, value: unknown) => Promise<void>
}>): DomainPackageStorageFactory {
  const root = join(input.userDataDir, 'domain-package-storage')
  const stores = new Map<string, DomainPackageStorage>()
  const operationTails = new Map<string, Promise<void>>()

  const serialize = async <T>(
    key: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    signal?.throwIfAborted()
    const previous = (operationTails.get(key) ?? Promise.resolve())
      .catch(() => undefined)
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    operationTails.set(key, tail)
    void tail.then(() => {
      if (operationTails.get(key) === tail) operationTails.delete(key)
    })
    try {
      await waitForStorageTurn(previous, signal)
      signal?.throwIfAborted()
      return await operation()
    } finally {
      release()
    }
  }

  return Object.freeze({
    forOwner: (owner) => {
      const ownerKey = packageOwnerKey(owner)
      const existing = stores.get(ownerKey)
      if (existing) return existing
      const packageRoot = join(root, ownerKey)
      const settingsPath = join(packageRoot, 'settings.json')
      const secretsPath = join(packageRoot, 'secrets.enc.json')
      const settingsLock = `${ownerKey}:settings`
      const secretsLock = `${ownerKey}:secrets`

      const providerCredentials: DomainMainProviderCredentialStoreHost = Object.freeze({
        status: (rawAccess, options) => serialize(secretsLock, async () => {
          options?.signal?.throwIfAborted()
          const context = providerCredentialContext(input, rawAccess, ownerKey)
          requireProviderEncryption(input.encryption)
          const file = await readProviderSecrets(secretsPath)
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          const encrypted = file.encrypted[context.key]
          if (encrypted === undefined) return Object.freeze({ state: 'absent' as const })
          readProviderCredential(input.encryption, encrypted, context)
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          return Object.freeze({ state: 'available' as const, recordVersion: 1 as const })
        }, options?.signal),
        replace: (rawAccess, secret, options) => serialize(secretsLock, async () => {
          options?.signal?.throwIfAborted()
          const context = providerCredentialContext(input, rawAccess, ownerKey)
          if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1_000_000) {
            throw new TypeError('Provider credential values must be non-empty bounded strings.')
          }
          requireProviderEncryption(input.encryption)
          assertCurrentProviderPrincipal(input, context.principal)
          const file = await readProviderSecrets(secretsPath)
          const record = storedProviderCredentialSchema.parse({
            version: 1,
            nodeId: context.nodeId,
            principal: stablePrincipalIdentity(context.principal),
            binding: context.binding,
            secret
          })
          const encryptedValue = encryptProviderCredential(input.encryption, record)
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          await (input.atomicWrite ?? writeJsonFile)(secretsPath, {
            version: 1,
            encrypted: { ...file.encrypted, [context.key]: encryptedValue }
          } satisfies SecretsFile)
        }, options?.signal),
        use: (rawAccess, operation, options) => serialize(secretsLock, async () => {
          options?.signal?.throwIfAborted()
          if (typeof operation !== 'function') throw new TypeError('Credential use requires an operation.')
          const context = providerCredentialContext(input, rawAccess, ownerKey)
          requireProviderEncryption(input.encryption)
          const file = await readProviderSecrets(secretsPath)
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          const encrypted = file.encrypted[context.key]
          if (encrypted === undefined) throw providerCredentialError('credential_unavailable')
          const record = readProviderCredential(input.encryption, encrypted, context)
          assertCurrentProviderPrincipal(input, context.principal)
          input.secretRedaction?.activate({ recordId: context.redactionId, secret: record.secret })
          try {
            const result = await (async () => {
              try {
                return await operation(record.secret)
              } catch (error) {
                throw sanitizeProviderCredentialOperationFailure(error, record.secret)
              }
            })()
            assertCurrentProviderPrincipal(input, context.principal)
            options?.signal?.throwIfAborted()
            return result
          } finally {
            input.secretRedaction?.release({
              recordId: context.redactionId,
              secret: record.secret
            })
          }
        }, options?.signal),
        remove: (rawAccess, options) => serialize(secretsLock, async () => {
          options?.signal?.throwIfAborted()
          const context = providerCredentialContext(input, rawAccess, ownerKey)
          requireProviderEncryption(input.encryption)
          const file = await readProviderSecrets(secretsPath)
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          const priorEncrypted = file.encrypted[context.key]
          if (priorEncrypted === undefined) return
          const encrypted = { ...file.encrypted }
          delete encrypted[context.key]
          assertCurrentProviderPrincipal(input, context.principal)
          options?.signal?.throwIfAborted()
          await (input.atomicWrite ?? writeJsonFile)(
            secretsPath,
            { version: 1, encrypted } satisfies SecretsFile
          )
        }, options?.signal)
      })

      const settings: DomainMainPackageSettingsHost = Object.freeze({
        read: () => serialize(settingsLock, () => readSettings(settingsPath)),
        write: (value, expectedRevision) => serialize(settingsLock, async () => {
          const current = await readSettings(settingsPath)
          assertExpectedRevision(current.revision, expectedRevision)
          const next = domainMainPackageSettingsSnapshotSchema.parse({
            revision: current.revision + 1,
            value
          })
          await writeJsonFile(settingsPath, next)
          return next
        }),
        clear: (expectedRevision) => serialize(settingsLock, async () => {
          const current = await readSettings(settingsPath)
          assertExpectedRevision(current.revision, expectedRevision)
          const next = domainMainPackageSettingsSnapshotSchema.parse({
            revision: current.revision + 1,
            value: null
          })
          await writeJsonFile(settingsPath, next)
          return next
        })
      })

      const secrets: DomainMainPackageSecretStoreHost = Object.freeze({
        has: (rawKey) => serialize(secretsLock, async () => {
          const key = domainMainPackageSecretKeySchema.parse(rawKey)
          const file = await readSecrets(secretsPath)
          return Object.hasOwn(file.encrypted, key)
        }),
        read: (rawKey) => serialize(secretsLock, async () => {
          const key = domainMainPackageSecretKeySchema.parse(rawKey)
          const file = await readSecrets(secretsPath)
          const encrypted = file.encrypted[key]
          if (encrypted === undefined) return null
          requireEncryption(input.encryption)
          return input.encryption.decryptString(Buffer.from(encrypted, 'base64'))
        }),
        write: (rawKey, value) => serialize(secretsLock, async () => {
          const key = domainMainPackageSecretKeySchema.parse(rawKey)
          if (typeof value !== 'string' || value.length === 0 || value.length > 1_000_000) {
            throw new TypeError('Package secret values must be non-empty bounded strings.')
          }
          requireEncryption(input.encryption)
          const file = await readSecrets(secretsPath)
          const encryptedValue = input.encryption.encryptString(value).toString('base64')
          await writeJsonFile(secretsPath, {
            version: 1,
            encrypted: { ...file.encrypted, [key]: encryptedValue }
          } satisfies SecretsFile)
        }),
        remove: (rawKey) => serialize(secretsLock, async () => {
          const key = domainMainPackageSecretKeySchema.parse(rawKey)
          const file = await readSecrets(secretsPath)
          if (!Object.hasOwn(file.encrypted, key)) return
          const encrypted = { ...file.encrypted }
          delete encrypted[key]
          await writeJsonFile(secretsPath, { version: 1, encrypted } satisfies SecretsFile)
        }),
        providerCredentials
      })

      const created = Object.freeze({ settings, secrets })
      stores.set(ownerKey, created)
      return created
    }
  })
}

async function waitForStorageTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!signal) {
    await previous
    return
  }
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = (): void => {
      finish(() => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    void previous.then(() => finish(resolve))
  })
}

function sanitizeProviderCredentialOperationFailure(
  error: unknown,
  secret: string
): Error {
  const rawMessage = typeof error === 'string'
    ? error
    : ownStringField(error, 'message')
  const message = redactExactSensitiveValues(
    rawMessage ?? 'Provider credential operation failed.',
    [secret]
  ).slice(0, 256)
  const rawName = ownStringField(error, 'name') ?? plainErrorName(error) ??
    'ProviderCredentialOperationError'
  const redactedName = redactExactSensitiveValues(rawName, [secret])
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(redactedName)
    ? redactedName
    : 'ProviderCredentialOperationError'
  const failure = new Error(message || 'Provider credential operation failed.')
  failure.name = name
  const rawCode = ownStringField(error, 'code')
  if (rawCode) {
    const code = redactExactSensitiveValues(rawCode, [secret])
    if (/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(code)) {
      Object.defineProperty(failure, 'code', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: code
      })
    }
  }
  return failure
}

function ownStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined
  } catch {
    return undefined
  }
}

function plainErrorName(value: unknown): 'Error' | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return Object.getPrototypeOf(value) === Error.prototype ? 'Error' : undefined
  } catch {
    return undefined
  }
}

function packageOwnerKey(owner: DomainRuntimeContributionOwner): string {
  const moduleId = owner.moduleId.trim()
  const moduleVersion = owner.moduleVersion.trim()
  if (!moduleId || !moduleVersion) throw new TypeError('Domain package owner is incomplete.')
  const readable = moduleId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120)
  const digest = createHash('sha256')
    // A package upgrade keeps the same stable module ownership and must not
    // orphan its settings or device credentials merely because its version changed.
    .update(moduleId)
    .digest('hex')
    .slice(0, 16)
  return `${readable}-${digest}`
}

type ProviderCredentialContext = Readonly<{
  key: string
  redactionId: string
  nodeId: string
  principal: PrincipalSnapshot
  binding: DomainMainProviderCredentialBinding
}>

function providerCredentialContext(
  input: Readonly<{
    getDeviceId: () => string
    currentPrincipal: () => PrincipalSnapshot | undefined
  }>,
  rawAccess: DomainMainProviderCredentialAccess,
  ownerKey: string
): ProviderCredentialContext {
  const access = domainMainProviderCredentialAccessSchema.parse(rawAccess)
  const principal = input.currentPrincipal()
  if (!principal) throw providerCredentialError('principal_unavailable')
  const nodeId = input.getDeviceId().trim()
  if (!nodeId || principal.deviceId !== nodeId) {
    throw providerCredentialError('principal_device_mismatch')
  }
  if (!samePrincipalSnapshot(principal, access.expectedPrincipal)) {
    throw providerCredentialError('credential_binding_mismatch')
  }
  const binding = domainMainProviderCredentialBindingSchema.parse(access.binding)
  const digest = createHash('sha256')
    .update(JSON.stringify({
      nodeId,
      principal: stablePrincipalIdentity(principal),
      binding
    }))
    .digest('hex')
  return Object.freeze({
    key: domainMainPackageSecretKeySchema.parse(`provider.${digest}`),
    redactionId: `${ownerKey}:${digest}`,
    nodeId,
    principal,
    binding
  })
}

function stablePrincipalIdentity(principal: PrincipalSnapshot): StoredProviderCredential['principal'] {
  return Object.freeze({
    authority: principal.authority,
    subject: principal.subject,
    assurance: principal.assurance
  })
}

function assertCurrentProviderPrincipal(
  input: Readonly<{
    getDeviceId: () => string
    currentPrincipal: () => PrincipalSnapshot | undefined
  }>,
  captured: PrincipalSnapshot
): void {
  const current = input.currentPrincipal()
  if (!current) throw providerCredentialError('principal_unavailable')
  if (
    input.getDeviceId().trim() !== captured.deviceId ||
    current.authority !== captured.authority ||
    current.subject !== captured.subject ||
    current.assurance !== captured.assurance ||
    current.deviceId !== captured.deviceId ||
    current.identityVersion !== captured.identityVersion
  ) {
    throw providerCredentialError('credential_binding_mismatch')
  }
}

function readProviderCredential(
  encryption: PackageEncryption,
  encrypted: string,
  context: ProviderCredentialContext
): StoredProviderCredential {
  requireProviderEncryption(encryption)
  let plaintext: string
  try {
    plaintext = encryption.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    throw providerCredentialError('secure_storage_undecryptable')
  }
  let record: StoredProviderCredential
  try {
    record = storedProviderCredentialSchema.parse(JSON.parse(plaintext))
  } catch {
    throw providerCredentialError('secure_storage_corrupt')
  }
  if (
    record.nodeId !== context.nodeId ||
    record.principal.authority !== context.principal.authority ||
    record.principal.subject !== context.principal.subject ||
    record.principal.assurance !== context.principal.assurance ||
    record.binding.providerInstanceRef !== context.binding.providerInstanceRef ||
    record.binding.connectionId !== context.binding.connectionId
  ) {
    throw providerCredentialError('credential_binding_mismatch')
  }
  return record
}

function encryptProviderCredential(
  encryption: PackageEncryption,
  record: StoredProviderCredential
): string {
  requireProviderEncryption(encryption)
  try {
    return encryption.encryptString(JSON.stringify(record)).toString('base64')
  } catch {
    throw providerCredentialError('secure_storage_unavailable')
  }
}

function providerCredentialError(
  code: ConstructorParameters<typeof DomainMainProviderCredentialError>[0]
): DomainMainProviderCredentialError {
  const messages = {
    principal_unavailable: 'A current Host principal is required for provider credentials.',
    principal_device_mismatch: 'The current Host principal does not belong to this execution node.',
    credential_unavailable: 'No provider credential is available for the current binding.',
    credential_binding_mismatch: 'The provider credential binding does not match the current Host context.',
    secure_storage_unavailable: 'The operating-system secure storage service is unavailable.',
    secure_storage_insecure: 'The operating-system secure storage backend is not approved.',
    secure_storage_corrupt: 'The provider credential record is corrupt.',
    secure_storage_undecryptable: 'The provider credential record cannot be decrypted.'
  } as const
  return new DomainMainProviderCredentialError(code, messages[code])
}

async function readSettings(path: string): Promise<SettingsFile> {
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (raw === null) return Object.freeze({ revision: 0, value: null })
  return Object.freeze(domainMainPackageSettingsSnapshotSchema.parse(JSON.parse(raw)))
}

async function readSecrets(path: string): Promise<SecretsFile> {
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (raw === null) return Object.freeze({ version: 1, encrypted: Object.freeze({}) })
  const parsed = JSON.parse(raw) as Partial<SecretsFile>
  if (
    parsed.version !== 1 ||
    !parsed.encrypted ||
    typeof parsed.encrypted !== 'object' ||
    Array.isArray(parsed.encrypted) ||
    Object.values(parsed.encrypted).some((value) => typeof value !== 'string')
  ) {
    throw new Error('Domain package secret store is corrupt.')
  }
  return Object.freeze({ version: 1, encrypted: Object.freeze({ ...parsed.encrypted }) })
}

async function readProviderSecrets(path: string): Promise<SecretsFile> {
  try {
    return await readSecrets(path)
  } catch (error) {
    if (error instanceof SyntaxError || (
      error instanceof Error && error.message === 'Domain package secret store is corrupt.'
    )) {
      throw providerCredentialError('secure_storage_corrupt')
    }
    throw providerCredentialError('secure_storage_unavailable')
  }
}

function assertExpectedRevision(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new TypeError('Expected settings revision must be a non-negative safe integer.')
  }
  if (actual !== expected) {
    throw new Error(`Domain package settings revision conflict: expected ${expected}, current ${actual}.`)
  }
}

function requireEncryption(encryption: PackageEncryption): void {
  const state = encryption.state()
  if (state !== 'available') {
    throw new Error('Operating-system secret encryption is unavailable.')
  }
}

function requireProviderEncryption(encryption: PackageEncryption): void {
  let state: PackageEncryptionState
  try {
    state = encryption.state()
  } catch {
    throw providerCredentialError('secure_storage_unavailable')
  }
  if (state === 'unavailable') throw providerCredentialError('secure_storage_unavailable')
  if (state === 'insecure') throw providerCredentialError('secure_storage_insecure')
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700).catch(() => undefined)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temporaryPath, 0o600).catch(() => undefined)
    await rename(temporaryPath, path)
    await chmod(path, 0o600).catch(() => undefined)
    const directory = await open(dirname(path), 'r').catch(() => null)
    if (directory) {
      try {
        await directory.sync().catch(() => undefined)
      } finally {
        await directory.close()
      }
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
