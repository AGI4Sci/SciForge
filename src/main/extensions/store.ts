import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  domainPackageModuleIdSchema,
  domainPackageNameSchema,
  domainPackagePublisherIdSchema,
  domainPackageRequestedPermissionSchema,
  domainPackageVersionSchema,
  sandboxedDomainPackageEntrypointSchema
} from '@sciforge/domain-sdk'
import { z } from 'zod'
import { canonicalJson, type CanonicalJsonValue } from './canonical-json'
import { ExtensionStoreError, extensionErrorMessage } from './errors'
import {
  type ExtensionArtifactLimits,
  type ExtensionArtifactSource,
  type InstalledExtensionPackage,
  type InstalledExtensionStatus,
  type InstalledExtensionVersion,
  type TrustedOfficialPublisherKeyring,
  type VerifiedExtensionArtifact
} from './types'
import { ExtensionArtifactVerifier } from './verifier'

const STORE_SCHEMA_VERSION = 1
const STORE_DIRECTORY_NAME = 'extensions'
const REGISTRY_FILE_NAME = 'registry.json'
const PACKAGES_DIRECTORY_NAME = 'packages'
const STAGING_DIRECTORY_NAME = '.staging'
const TRASH_DIRECTORY_NAME = '.trash'
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/

const signerSchema = z.object({
  publisherId: z.string().regex(SAFE_IDENTIFIER_PATTERN),
  keyId: z.string().regex(SAFE_IDENTIFIER_PATTERN),
  trust: z.literal('official'),
  algorithm: z.literal('ed25519')
}).strict()

const executionSecuritySchema = z.object({
  trust: z.literal('official'),
  codeIsolation: z.literal('extension-host'),
  rendererIsolation: z.literal('sandboxed-webview'),
  capabilityAccess: z.literal('brokered'),
  thirdPartyReady: z.literal(true)
}).strict()

const runtimeMetadataSchema = z.object({
  kind: z.literal('sandboxed-runtime'),
  requestedPermissions: z.array(domainPackageRequestedPermissionSchema).max(1_000),
  entrypoints: z.array(sandboxedDomainPackageEntrypointSchema).min(1).max(2)
}).strict()

const installedVersionSchema = z.object({
  version: domainPackageVersionSchema,
  installedAt: z.iso.datetime({ offset: true }),
  integritySha256: z.string().regex(/^[a-f0-9]{64}$/),
  signer: signerSchema,
  executionSecurity: executionSecuritySchema,
  runtime: runtimeMetadataSchema
}).strict()

const installedPackageSchema = z.object({
  packageName: domainPackageNameSchema,
  moduleId: domainPackageModuleIdSchema,
  publisherId: domainPackagePublisherIdSchema,
  publisherDisplayName: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160),
  enabled: z.boolean(),
  activeVersion: domainPackageVersionSchema,
  versions: z.array(installedVersionSchema).min(1).max(1_000)
}).strict().superRefine((record, context) => {
  const versions = new Set<string>()
  for (const [index, version] of record.versions.entries()) {
    if (versions.has(version.version)) {
      context.addIssue({
        code: 'custom',
        path: ['versions', index, 'version'],
        message: `Duplicate installed version ${version.version}.`
      })
    }
    versions.add(version.version)
    if (
      version.signer.publisherId !== record.publisherId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['versions', index, 'signer', 'publisherId'],
        message: 'Installed version signer does not match package publisher.'
      })
    }
  }
  if (!versions.has(record.activeVersion)) {
    context.addIssue({
      code: 'custom',
      path: ['activeVersion'],
      message: 'Active extension version is not installed.'
    })
  }
})

const registrySchema = z.object({
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  packages: z.array(installedPackageSchema).max(10_000)
}).strict().superRefine((registry, context) => {
  const packageNames = new Set<string>()
  const moduleIds = new Set<string>()
  for (const [index, record] of registry.packages.entries()) {
    if (packageNames.has(record.packageName)) {
      context.addIssue({
        code: 'custom',
        path: ['packages', index, 'packageName'],
        message: `Duplicate installed package ${record.packageName}.`
      })
    }
    if (moduleIds.has(record.moduleId)) {
      context.addIssue({
        code: 'custom',
        path: ['packages', index, 'moduleId'],
        message: `Duplicate installed module ${record.moduleId}.`
      })
    }
    packageNames.add(record.packageName)
    moduleIds.add(record.moduleId)
  }
})

type Registry = z.infer<typeof registrySchema>

export type SignedExtensionStoreOptions = Readonly<{
  userDataPath: string
  hostApiVersion: string
  trustedKeys: TrustedOfficialPublisherKeyring
  reservedIdentities?: Readonly<{
    packageNames?: readonly string[]
    moduleIds?: readonly string[]
  }>
  limits?: Partial<ExtensionArtifactLimits>
  now?: () => Date
}>

export class SignedExtensionStore {
  readonly rootPath: string
  readonly #verifier: ExtensionArtifactVerifier
  readonly #now: () => Date
  readonly #reservedPackageNames: ReadonlySet<string>
  readonly #reservedModuleIds: ReadonlySet<string>
  #queue: Promise<void> = Promise.resolve()

  constructor(options: SignedExtensionStoreOptions) {
    if (!isAbsolute(options.userDataPath)) {
      throw new ExtensionStoreError(
        'invalid_source',
        'The extension store userData path must be absolute.'
      )
    }
    this.rootPath = join(resolve(options.userDataPath), STORE_DIRECTORY_NAME)
    this.#verifier = new ExtensionArtifactVerifier({
      hostApiVersion: options.hostApiVersion,
      trustedKeys: options.trustedKeys,
      limits: options.limits
    })
    this.#reservedPackageNames = new Set(
      (options.reservedIdentities?.packageNames ?? []).map((packageName) =>
        domainPackageNameSchema.parse(packageName)
      )
    )
    this.#reservedModuleIds = new Set(
      (options.reservedIdentities?.moduleIds ?? []).map((moduleId) =>
        domainPackageModuleIdSchema.parse(moduleId)
      )
    )
    this.#now = options.now ?? (() => new Date())
  }

  async verify(source: ExtensionArtifactSource): Promise<VerifiedExtensionArtifact> {
    return this.#verifier.verify(source)
  }

  async install(source: ExtensionArtifactSource): Promise<InstalledExtensionStatus> {
    const verified = await this.#verifier.verify(source)
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      assertInstallIdentityAvailable(
        registry,
        verified,
        this.#reservedPackageNames,
        this.#reservedModuleIds
      )

      const packageName = verified.definition.packageName
      const moduleId = verified.definition.module.id
      const version = verified.definition.module.version
      const publisherId = verified.signer.publisherId
      const finalPath = this.#versionPath(packageName, version)
      if (await pathExists(finalPath)) {
        throw new ExtensionStoreError(
          'duplicate_extension',
          `Extension ${packageName}@${version} already exists in the install store.`
        )
      }

      const stageRoot = join(this.rootPath, STAGING_DIRECTORY_NAME, randomUUID())
      const stagedPayloadPath = join(stageRoot, 'payload')
      await mkdir(stagedPayloadPath, { recursive: true, mode: 0o700 })
      let installed = false
      try {
        await writeVerifiedArtifact(stagedPayloadPath, verified.files)
        const packageVersionParent = join(finalPath, '..')
        await ensureRealDirectory(packageVersionParent)
        await rename(stagedPayloadPath, finalPath)
        installed = true

        const installedVersion = installedVersionFrom(verified, this.#now())
        const existingIndex = registry.packages.findIndex(
          (record) => record.packageName === packageName
        )
        const nextPackage: InstalledExtensionPackage = existingIndex < 0
          ? {
              packageName,
              moduleId,
              publisherId,
              publisherDisplayName: verified.definition.publisher.displayName,
              displayName: verified.definition.module.displayName,
              enabled: true,
              activeVersion: version,
              versions: [installedVersion]
            }
          : {
              ...registry.packages[existingIndex]!,
              publisherDisplayName: verified.definition.publisher.displayName,
              displayName: verified.definition.module.displayName,
              activeVersion: version,
              versions: [...registry.packages[existingIndex]!.versions, installedVersion]
            }
        const packages = [...registry.packages]
        const nextRegistryPackage = installedPackageSchema.parse(nextPackage)
        if (existingIndex < 0) packages.push(nextRegistryPackage)
        else packages[existingIndex] = nextRegistryPackage
        const nextRegistry = nextRegistryRevision(registry, packages)
        await this.#writeRegistry(nextRegistry)
        return statusFor(nextPackage, installedVersion, finalPath, 'ready')
      } catch (error) {
        if (installed) await rm(finalPath, { recursive: true, force: true }).catch(() => undefined)
        throw error
      } finally {
        await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }

  async list(): Promise<readonly InstalledExtensionPackage[]> {
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      return freezePackages(registry.packages)
    })
  }

  async status(packageName: string): Promise<InstalledExtensionStatus | null> {
    const normalizedName = domainPackageNameSchema.parse(packageName)
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      const record = registry.packages.find((entry) => entry.packageName === normalizedName)
      if (!record) return null
      const active = record.versions.find((version) => version.version === record.activeVersion)!
      const installPath = this.#versionPath(record.packageName, active.version)
      try {
        const stats = await lstat(installPath)
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          return statusFor(record, active, installPath, 'missing', 'Install path is not a real directory.')
        }
      } catch (error) {
        return statusFor(record, active, installPath, 'missing', extensionErrorMessage(error))
      }
      try {
        const verified = await this.#verifier.verify({ kind: 'directory', path: installPath })
        if (verified.integritySha256 !== active.integritySha256) {
          return statusFor(
            record,
            active,
            installPath,
            'corrupt',
            'Installed integrity manifest differs from the registry.'
          )
        }
      } catch (error) {
        return statusFor(record, active, installPath, 'corrupt', extensionErrorMessage(error))
      }
      return statusFor(record, active, installPath, 'ready')
    })
  }

  async setEnabled(
    packageName: string,
    enabled: boolean
  ): Promise<InstalledExtensionPackage> {
    const normalizedName = domainPackageNameSchema.parse(packageName)
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      const index = registry.packages.findIndex((entry) => entry.packageName === normalizedName)
      if (index < 0) throw extensionNotFound(normalizedName)
      const updated: InstalledExtensionPackage = {
        ...registry.packages[index]!,
        enabled
      }
      const packages = [...registry.packages]
      packages[index] = installedPackageSchema.parse(updated)
      await this.#writeRegistry(nextRegistryRevision(registry, packages))
      return freezePackage(updated)
    })
  }

  async rollback(
    packageName: string,
    targetVersion?: string
  ): Promise<InstalledExtensionStatus> {
    const normalizedName = domainPackageNameSchema.parse(packageName)
    const normalizedTarget = targetVersion === undefined
      ? undefined
      : domainPackageVersionSchema.parse(targetVersion)
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      const index = registry.packages.findIndex((entry) => entry.packageName === normalizedName)
      if (index < 0) throw extensionNotFound(normalizedName)
      const current = registry.packages[index]!
      const candidates = current.versions.filter(
        (version) => version.version !== current.activeVersion
      )
      const target = normalizedTarget === undefined
        ? candidates.at(-1)
        : candidates.find((version) => version.version === normalizedTarget)
      if (!target) {
        throw new ExtensionStoreError(
          'rollback_unavailable',
          normalizedTarget
            ? `Extension ${normalizedName} cannot roll back to unavailable version ${normalizedTarget}.`
            : `Extension ${normalizedName} has no previous version to roll back to.`
        )
      }
      const installPath = this.#versionPath(normalizedName, target.version)
      const health = await verifyInstalledPath(this.#verifier, installPath, target.integritySha256)
      if (health !== null) {
        throw new ExtensionStoreError(
          'rollback_unavailable',
          `Extension ${normalizedName}@${target.version} cannot be activated: ${health}`
        )
      }
      const updated: InstalledExtensionPackage = {
        ...current,
        activeVersion: target.version
      }
      const packages = [...registry.packages]
      packages[index] = installedPackageSchema.parse(updated)
      await this.#writeRegistry(nextRegistryRevision(registry, packages))
      return statusFor(updated, target, installPath, 'ready')
    })
  }

  async uninstall(packageName: string, version?: string): Promise<boolean> {
    const normalizedName = domainPackageNameSchema.parse(packageName)
    const normalizedVersion = version === undefined
      ? undefined
      : domainPackageVersionSchema.parse(version)
    return this.#enqueue(async () => {
      await this.#ensureLayout()
      const registry = await this.#readRegistry()
      const index = registry.packages.findIndex((entry) => entry.packageName === normalizedName)
      if (index < 0) return false
      const current = registry.packages[index]!
      const versionRecord = normalizedVersion === undefined
        ? undefined
        : current.versions.find((entry) => entry.version === normalizedVersion)
      if (normalizedVersion !== undefined && !versionRecord) return false

      const removalPath = normalizedVersion === undefined
        ? this.#packagePath(normalizedName)
        : this.#versionPath(normalizedName, normalizedVersion)
      const trashPath = join(this.rootPath, TRASH_DIRECTORY_NAME, randomUUID())
      let moved = false
      if (await pathExists(removalPath)) {
        await rename(removalPath, trashPath)
        moved = true
      }

      const packages = [...registry.packages]
      if (normalizedVersion === undefined || current.versions.length === 1) {
        packages.splice(index, 1)
      } else {
        const versions = current.versions.filter((entry) => entry.version !== normalizedVersion)
        const activeVersion = current.activeVersion === normalizedVersion
          ? versions.at(-1)!.version
          : current.activeVersion
        packages[index] = { ...current, activeVersion, versions }
      }

      try {
        await this.#writeRegistry(nextRegistryRevision(registry, packages))
      } catch (error) {
        if (moved) await rename(trashPath, removalPath).catch(() => undefined)
        throw error
      }
      if (moved) await rm(trashPath, { recursive: true, force: true }).catch(() => undefined)
      return true
    })
  }

  #enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const run = this.#queue.then(operation, operation)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }

  async #ensureLayout(): Promise<void> {
    await ensureRealDirectory(this.rootPath)
    await ensureRealDirectory(join(this.rootPath, PACKAGES_DIRECTORY_NAME))
    await ensureRealDirectory(join(this.rootPath, STAGING_DIRECTORY_NAME))
    await ensureRealDirectory(join(this.rootPath, TRASH_DIRECTORY_NAME))
  }

  async #readRegistry(): Promise<Registry> {
    const path = join(this.rootPath, REGISTRY_FILE_NAME)
    let bytes: Buffer
    try {
      const stats = await lstat(path)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new ExtensionStoreError(
          'corrupt_registry',
          'Extension registry must be a regular file.'
        )
      }
      bytes = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: STORE_SCHEMA_VERSION, revision: 0, packages: [] }
      }
      if (error instanceof ExtensionStoreError) throw error
      throw new ExtensionStoreError(
        'corrupt_registry',
        `Could not read extension registry: ${extensionErrorMessage(error)}`,
        { cause: error }
      )
    }
    try {
      return registrySchema.parse(JSON.parse(bytes.toString('utf8')))
    } catch (error) {
      throw new ExtensionStoreError(
        'corrupt_registry',
        `Extension registry is invalid: ${extensionErrorMessage(error)}`,
        { cause: error }
      )
    }
  }

  async #writeRegistry(registry: Registry): Promise<void> {
    const validated = registrySchema.parse(registry)
    const targetPath = join(this.rootPath, REGISTRY_FILE_NAME)
    const temporaryPath = join(
      this.rootPath,
      `${REGISTRY_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`
    )
    const contents = `${canonicalJson(validated as CanonicalJsonValue)}\n`
    let handle
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, targetPath)
      await syncDirectory(this.rootPath)
    } finally {
      await handle?.close().catch(() => undefined)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  #packagePath(packageName: string): string {
    return confinedJoin(
      join(this.rootPath, PACKAGES_DIRECTORY_NAME),
      Buffer.from(packageName, 'utf8').toString('base64url')
    )
  }

  #versionPath(packageName: string, version: string): string {
    return confinedJoin(this.#packagePath(packageName), version)
  }
}

function assertInstallIdentityAvailable(
  registry: Registry,
  verified: VerifiedExtensionArtifact,
  reservedPackageNames: ReadonlySet<string>,
  reservedModuleIds: ReadonlySet<string>
): void {
  const packageName = verified.definition.packageName
  const moduleId = verified.definition.module.id
  const version = verified.definition.module.version
  const publisherId = verified.signer.publisherId
  if (reservedPackageNames.has(packageName)) {
    throw new ExtensionStoreError(
      'conflicting_identity',
      `Extension package ${packageName} is reserved by the application bundle.`
    )
  }
  if (reservedModuleIds.has(moduleId)) {
    throw new ExtensionStoreError(
      'conflicting_identity',
      `Extension module ${moduleId} is reserved by the application bundle.`
    )
  }
  const samePackage = registry.packages.find((entry) => entry.packageName === packageName)
  if (samePackage) {
    if (samePackage.moduleId !== moduleId || samePackage.publisherId !== publisherId) {
      throw new ExtensionStoreError(
        'conflicting_identity',
        `Extension package ${packageName} conflicts with its installed module or publisher identity.`
      )
    }
    if (samePackage.versions.some((entry) => entry.version === version)) {
      throw new ExtensionStoreError(
        'duplicate_extension',
        `Extension ${packageName}@${version} is already installed.`
      )
    }
  }
  const sameModule = registry.packages.find((entry) => entry.moduleId === moduleId)
  if (sameModule && sameModule.packageName !== packageName) {
    throw new ExtensionStoreError(
      'conflicting_identity',
      `Extension module ${moduleId} is already owned by ${sameModule.packageName}.`
    )
  }
}

function installedVersionFrom(
  verified: VerifiedExtensionArtifact,
  installedAt: Date
): InstalledExtensionVersion {
  if (!Number.isFinite(installedAt.getTime())) {
    throw new ExtensionStoreError('invalid_source', 'Extension install clock returned an invalid date.')
  }
  return Object.freeze({
    version: verified.definition.module.version,
    installedAt: installedAt.toISOString(),
    integritySha256: verified.integritySha256,
    signer: verified.signer,
    executionSecurity: Object.freeze({
      trust: 'official' as const,
      codeIsolation: 'extension-host' as const,
      rendererIsolation: 'sandboxed-webview' as const,
      capabilityAccess: 'brokered' as const,
      thirdPartyReady: true as const
    }),
    runtime: Object.freeze({
      kind: 'sandboxed-runtime' as const,
      requestedPermissions: verified.definition.requestedPermissions,
      entrypoints: verified.definition.entrypoints
    })
  })
}

async function writeVerifiedArtifact(
  rootPath: string,
  files: ReadonlyMap<string, Buffer>
): Promise<void> {
  for (const [artifactPath, bytes] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const targetPath = confinedJoin(rootPath, ...artifactPath.split('/'))
    await mkdir(join(targetPath, '..'), { recursive: true, mode: 0o700 })
    await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 })
  }
}

async function verifyInstalledPath(
  verifier: ExtensionArtifactVerifier,
  installPath: string,
  expectedIntegrity: string
): Promise<string | null> {
  try {
    const stats = await lstat(installPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) return 'install path is not a real directory'
    const verified = await verifier.verify({ kind: 'directory', path: installPath })
    if (verified.integritySha256 !== expectedIntegrity) {
      return 'integrity manifest differs from the registry'
    }
    return null
  } catch (error) {
    return extensionErrorMessage(error)
  }
}

function nextRegistryRevision(
  registry: Registry,
  packages: readonly InstalledExtensionPackage[]
): Registry {
  return registrySchema.parse({
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: registry.revision + 1,
    packages
  })
}

function statusFor(
  record: InstalledExtensionPackage,
  active: InstalledExtensionVersion,
  installPath: string,
  health: InstalledExtensionStatus['health'],
  issue?: string
): InstalledExtensionStatus {
  return Object.freeze({
    package: freezePackage(record),
    active: Object.freeze({ ...active }),
    installPath,
    health,
    ...(issue ? { issue } : {})
  })
}

function freezePackages(
  records: readonly InstalledExtensionPackage[]
): readonly InstalledExtensionPackage[] {
  return Object.freeze(records.map(freezePackage))
}

function freezePackage(record: InstalledExtensionPackage): InstalledExtensionPackage {
  return Object.freeze({
    ...record,
    versions: Object.freeze(record.versions.map((version) => Object.freeze({
      ...version,
      signer: Object.freeze({ ...version.signer }),
      executionSecurity: Object.freeze({ ...version.executionSecurity }),
      runtime: Object.freeze({
        ...version.runtime,
        requestedPermissions: Object.freeze([...version.runtime.requestedPermissions]),
        entrypoints: Object.freeze([...version.runtime.entrypoints])
      })
    })))
  })
}

function extensionNotFound(packageName: string): ExtensionStoreError {
  return new ExtensionStoreError(
    'extension_not_found',
    `Extension ${packageName} is not installed.`
  )
}

async function ensureRealDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension store path must be a real directory: ${path}`
    )
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function confinedJoin(rootPath: string, ...segments: string[]): string {
  const resolvedRoot = resolve(rootPath)
  const target = resolve(resolvedRoot, ...segments)
  const confined = relative(resolvedRoot, target)
  if (
    confined === '' ||
    confined === '..' ||
    confined.startsWith(`..${sep}`) ||
    isAbsolute(confined)
  ) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension store target escapes its root: ${target}`
    )
  }
  return target
}

async function syncDirectory(path: string): Promise<void> {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is unavailable on some supported filesystems.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
