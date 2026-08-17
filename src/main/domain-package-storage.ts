import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  DomainMainProviderCredentialError,
  domainMainPackageSecretKeySchema,
  domainMainPackageSettingsSnapshotSchema,
  domainMainProviderCredentialBindingSchema,
  type DomainMainPackageSecretStoreHost,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialBinding,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainRuntimeContributionOwner } from '@sciforge/domain-sdk/host'
import {
  principalAssuranceSchema,
  principalAuthoritySchema,
  principalSubjectSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { z } from 'zod'

type PackageEncryption = Readonly<{
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}>

export type DomainPackageStorage = Readonly<{
  settings: DomainMainPackageSettingsHost
  secrets: DomainMainPackageSecretStoreHost
}>

export type DomainPackageStorageFactory = Readonly<{
  forOwner: (owner: DomainRuntimeContributionOwner) => DomainPackageStorage
}>

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
}>): DomainPackageStorageFactory {
  const root = join(input.userDataDir, 'domain-package-storage')
  const stores = new Map<string, DomainPackageStorage>()
  const operationTails = new Map<string, Promise<void>>()

  const serialize = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = operationTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    operationTails.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (operationTails.get(key) === tail) operationTails.delete(key)
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
        has: (rawBinding) => serialize(secretsLock, async () => {
          const context = providerCredentialContext(input, rawBinding)
          const file = await readSecrets(secretsPath)
          const encrypted = file.encrypted[context.key]
          if (encrypted === undefined) return false
          readProviderCredential(input.encryption, encrypted, context)
          return true
        }),
        write: (rawBinding, secret) => serialize(secretsLock, async () => {
          const context = providerCredentialContext(input, rawBinding)
          if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1_000_000) {
            throw new TypeError('Provider credential values must be non-empty bounded strings.')
          }
          requireEncryption(input.encryption)
          assertCurrentProviderPrincipal(input, context.principal)
          const file = await readSecrets(secretsPath)
          const record = storedProviderCredentialSchema.parse({
            version: 1,
            nodeId: context.nodeId,
            principal: stablePrincipalIdentity(context.principal),
            binding: context.binding,
            secret
          })
          const encryptedValue = input.encryption
            .encryptString(JSON.stringify(record))
            .toString('base64')
          assertCurrentProviderPrincipal(input, context.principal)
          await writeJsonFile(secretsPath, {
            version: 1,
            encrypted: { ...file.encrypted, [context.key]: encryptedValue }
          } satisfies SecretsFile)
        }),
        use: (rawBinding, operation) => serialize(secretsLock, async () => {
          if (typeof operation !== 'function') throw new TypeError('Credential use requires an operation.')
          const context = providerCredentialContext(input, rawBinding)
          const file = await readSecrets(secretsPath)
          const encrypted = file.encrypted[context.key]
          if (encrypted === undefined) throw providerCredentialError('credential_unavailable')
          const record = readProviderCredential(input.encryption, encrypted, context)
          assertCurrentProviderPrincipal(input, context.principal)
          return operation(record.secret)
        }),
        remove: (rawBinding) => serialize(secretsLock, async () => {
          const context = providerCredentialContext(input, rawBinding)
          const file = await readSecrets(secretsPath)
          if (!Object.hasOwn(file.encrypted, context.key)) return
          const encrypted = { ...file.encrypted }
          delete encrypted[context.key]
          assertCurrentProviderPrincipal(input, context.principal)
          await writeJsonFile(secretsPath, { version: 1, encrypted } satisfies SecretsFile)
        })
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
  nodeId: string
  principal: PrincipalSnapshot
  binding: DomainMainProviderCredentialBinding
}>

function providerCredentialContext(
  input: Readonly<{
    getDeviceId: () => string
    currentPrincipal: () => PrincipalSnapshot | undefined
  }>,
  rawBinding: DomainMainProviderCredentialBinding
): ProviderCredentialContext {
  const principal = input.currentPrincipal()
  if (!principal) throw providerCredentialError('principal_unavailable')
  const nodeId = input.getDeviceId().trim()
  if (!nodeId || principal.deviceId !== nodeId) {
    throw providerCredentialError('principal_device_mismatch')
  }
  const binding = domainMainProviderCredentialBindingSchema.parse(rawBinding)
  const digest = createHash('sha256')
    .update(JSON.stringify({
      nodeId,
      principal: stablePrincipalIdentity(principal),
      binding
    }))
    .digest('hex')
  return Object.freeze({
    key: domainMainPackageSecretKeySchema.parse(`provider.${digest}`),
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
    current.deviceId !== captured.deviceId
  ) {
    throw providerCredentialError('credential_binding_mismatch')
  }
}

function readProviderCredential(
  encryption: PackageEncryption,
  encrypted: string,
  context: ProviderCredentialContext
): StoredProviderCredential {
  requireEncryption(encryption)
  const record = storedProviderCredentialSchema.parse(JSON.parse(
    encryption.decryptString(Buffer.from(encrypted, 'base64'))
  ))
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

function providerCredentialError(
  code: ConstructorParameters<typeof DomainMainProviderCredentialError>[0]
): DomainMainProviderCredentialError {
  const messages = {
    principal_unavailable: 'A current Host principal is required for provider credentials.',
    principal_device_mismatch: 'The current Host principal does not belong to this execution node.',
    credential_unavailable: 'No provider credential is available for the current binding.',
    credential_binding_mismatch: 'The provider credential binding does not match the current Host context.'
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

function assertExpectedRevision(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new TypeError('Expected settings revision must be a non-negative safe integer.')
  }
  if (actual !== expected) {
    throw new Error(`Domain package settings revision conflict: expected ${expected}, current ${actual}.`)
  }
}

function requireEncryption(encryption: PackageEncryption): void {
  if (!encryption.isEncryptionAvailable()) {
    throw new Error('Operating-system secret encryption is unavailable.')
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700).catch(() => undefined)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  await chmod(temporaryPath, 0o600).catch(() => undefined)
  await rename(temporaryPath, path)
  await chmod(path, 0o600).catch(() => undefined)
}
