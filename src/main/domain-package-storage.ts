import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  domainMainPackageSecretKeySchema,
  domainMainPackageSettingsSnapshotSchema,
  type DomainMainPackageSecretStoreHost,
  type DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainRuntimeContributionOwner } from '@sciforge/domain-sdk/host'

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

export function createDomainPackageStorageFactory(input: Readonly<{
  userDataDir: string
  encryption: PackageEncryption
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
        })
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
