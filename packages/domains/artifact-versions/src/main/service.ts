import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk/contract'
import {
  artifactV1Schema,
  artifactVersionAccessPolicyV1Schema,
  artifactVersionBundleImportInputV1Schema,
  artifactVersionBundleImportReceiptV1Schema,
  artifactVersionBundleV1Schema,
  artifactVersionBundleVerificationV1Schema,
  artifactVersionBundleVerifyInputV1Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionCommitReceiptV1Schema,
  artifactVersionCompareInputV1Schema,
  artifactVersionCompareV1Schema,
  artifactVersionEventListInputV1Schema,
  artifactVersionEventListV1Schema,
  artifactVersionLifecycleEventV1Schema,
  artifactVersionListInputV1Schema,
  artifactVersionListV1Schema,
  artifactVersionLocationV1Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeReceiptV1Schema,
  artifactVersionObserveInputV1Schema,
  artifactVersionReadInputV1Schema,
  artifactVersionReadV1Schema,
  artifactVersionRefreshInputV1Schema,
  artifactVersionRefreshV1Schema,
  artifactVersionRestoreAsNewInputV1Schema,
  artifactVersionV1Schema,
  type ArtifactV1,
  type ArtifactVersionBundleImportInputV1,
  type ArtifactVersionBundleImportReceiptV1,
  type ArtifactVersionBundleExportInputV1,
  type ArtifactVersionBundleReceiptV1,
  type ArtifactVersionBundleV1,
  type ArtifactVersionBundleVerificationV1,
  type ArtifactVersionBundleVerifyInputV1,
  type ArtifactVersionCommitCandidateV1,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitReceiptV1,
  type ArtifactVersionCompareInputV1,
  type ArtifactVersionCompareV1,
  type ArtifactVersionDependencyRefV1,
  type ArtifactVersionEventListInputV1,
  type ArtifactVersionEventListV1,
  type ArtifactVersionIssueV1,
  type ArtifactVersionLifecycleEventV1,
  type ArtifactVersionListInputV1,
  type ArtifactVersionListV1,
  type ArtifactVersionLocationV1,
  type ArtifactVersionMaterializeInputV1,
  type ArtifactVersionMaterializeReceiptV1,
  type ArtifactVersionObserveInputV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadV1,
  type ArtifactVersionRefreshInputV1,
  type ArtifactVersionRefreshV1,
  type ArtifactVersionRefV1,
  type ArtifactVersionRestoreAsNewInputV1,
  type ArtifactVersionResultV1,
  type ArtifactVersionV1
} from '../contract.js'
import {
  DestinationExistsError,
  WorkspacePathError,
  atomicWriteSafeData,
  atomicWriteWorkspaceBytes,
  canonicalDirectory,
  readSafeDataBytes,
  readSafeDataText,
  readWorkspaceBytes,
  sha256,
  stableStringify
} from './safe-files.js'

const STORE_SCHEMA_VERSION = 1 as const
const INDEX_SEGMENTS = ['index.v1.json'] as const
const LEGACY_REGISTRY_SCHEMA_VERSION = 'artifact-registry.v1' as const
const LEGACY_MIGRATION_KEY = 'evidenceArtifactRegistryV1' as const

const idempotencyRecordSchema = z.object({
  operation: z.string().trim().min(1).max(128),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  value: domainPackageJsonValueSchema
}).strict()

const locationBindingSchema = artifactVersionLocationV1Schema.extend({
  lastObservedContentDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

const legacyMigrationRecordSchema = z.object({
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  migratedAt: z.iso.datetime({ offset: true }),
  artifactCount: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  snapshotCount: z.number().int().nonnegative()
}).strict()

const legacyArtifactSchema = z.object({
  artifactId: z.string().trim().startsWith('artifact:'),
  kind: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  createdAt: z.iso.datetime({ offset: true }),
  currentVersionId: z.string().trim().startsWith('artifact-version:'),
  accessPolicy: z.record(z.string(), z.unknown()).optional().default({})
}).passthrough()

const legacyArtifactVersionSchema = z.object({
  versionId: z.string().trim().startsWith('artifact-version:'),
  artifactId: z.string().trim().startsWith('artifact:'),
  locator: z.string().trim().min(1).max(8_192),
  contentDigest: z.string().trim().nullable().optional(),
  version: z.string().nullable().optional(),
  size: z.number().int().nonnegative().nullable().optional(),
  mediaType: z.string().trim().nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }),
  availability: z.enum(['available', 'moved', 'missing', 'remote', 'restricted']),
  retention: z.enum(['reference', 'cached_excerpt', 'snapshot']),
  historicalLocators: z.array(z.string().trim().min(1).max(8_192)).optional().default([]),
  rebindCandidates: z.array(z.string().trim().min(1).max(8_192)).optional().default([]),
  supersedes: z.string().trim().startsWith('artifact-version:').nullable().optional()
}).passthrough()

const legacyRegistrySchema = z.object({
  schemaVersion: z.literal(LEGACY_REGISTRY_SCHEMA_VERSION),
  artifacts: z.array(legacyArtifactSchema),
  artifactVersions: z.array(legacyArtifactVersionSchema),
  sourceAnchors: z.array(z.unknown()).optional().default([])
}).passthrough()

const storeIndexSchema = z.object({
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  workspaceKey: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().nonnegative(),
  nextVersionSequence: z.number().int().positive(),
  nextEventSequence: z.number().int().positive(),
  artifacts: z.array(artifactV1Schema),
  versions: z.array(artifactVersionV1Schema),
  events: z.array(artifactVersionLifecycleEventV1Schema),
  locations: z.array(locationBindingSchema),
  idempotency: z.record(z.string(), idempotencyRecordSchema),
  migrations: z.object({
    [LEGACY_MIGRATION_KEY]: legacyMigrationRecordSchema.optional()
  }).strict().default({})
}).strict()

type StoreIndex = z.infer<typeof storeIndexSchema>
type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>
type LocationBinding = z.infer<typeof locationBindingSchema>
type LegacyArtifact = z.infer<typeof legacyArtifactSchema>
type LegacyArtifactVersion = z.infer<typeof legacyArtifactVersionSchema>
type PreparedLegacySource = Readonly<{
  bytes?: Uint8Array
  referenceLocator: string
  local: boolean
  location?: Readonly<{
    activeLocator: string
    historicalLocators: readonly string[]
    sourceAvailability: 'available' | 'missing'
  }>
}>
type PreparedLegacyVersion = Readonly<{
  version: ArtifactVersionV1
  bytes?: Uint8Array
  location?: LocationBinding
}>

type Clock = () => Date
type IdFactory = () => string

export type ArtifactVersionServiceOptions = Readonly<{
  userDataDir: string
  now?: Clock
  id?: IdFactory
}>

export type ArtifactVersionAccessContext = Readonly<{
  audience: 'ui' | 'agent' | 'system'
  callerId: string
}>

export class ArtifactVersionService {
  readonly #userDataDir: string
  readonly #now: Clock
  readonly #id: IdFactory
  readonly #stores = new Map<string, Promise<ArtifactVersionWorkspaceStore>>()

  constructor(options: ArtifactVersionServiceOptions) {
    this.#userDataDir = options.userDataDir
    this.#now = options.now ?? (() => new Date())
    this.#id = options.id ?? randomUUID
  }

  async commit(
    workspaceRoot: string,
    input: ArtifactVersionCommitInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCommitReceiptV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionCommitInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).commit(parsed, { access })
    })
  }

  async observe(
    workspaceRoot: string,
    input: ArtifactVersionObserveInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCommitReceiptV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionObserveInputV1Schema.parse(input)
      const store = await this.#store(workspaceRoot)
      if (parsed.artifactId) {
        await store.assertCurrentAccess(parsed.artifactId, access)
      }
      const source = await readWorkspaceBytes(workspaceRoot, parsed.path)
      const digest = sha256(source.bytes)
      const content = parsed.retention === 'snapshot'
        ? {
            mode: 'snapshot' as const,
            dataBase64: Buffer.from(source.bytes).toString('base64'),
            ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {})
          }
        : {
            mode: 'reference' as const,
            locator: `workspace:${source.relativePath}`,
            contentDigest: digest,
            byteLength: source.bytes.byteLength,
            ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {}),
            availability: 'available' as const
          }
      const commitInput = artifactVersionCommitInputV1Schema.parse({
        idempotencyKey: parsed.idempotencyKey,
        candidates: [{
          candidateId: parsed.candidateId,
          ...(parsed.artifactId ? { artifactId: parsed.artifactId } : {}),
          expectedCurrentVersionId: parsed.expectedCurrentVersionId,
          kind: parsed.kind,
          ...(parsed.label ? { label: parsed.label } : {}),
          intent: 'observe',
          content,
          ...(parsed.dependencies ? { dependencies: parsed.dependencies } : {}),
          ...(parsed.accessPolicy ? { accessPolicy: parsed.accessPolicy } : {}),
          metadata: {
            ...(parsed.metadata ?? {}),
            observedWorkspacePath: source.relativePath
          }
        }]
      })
      if (parsed.artifactId) {
        const current = await store.current(parsed.artifactId)
        if (current.version.storage.contentDigest === digest) {
          return store.observeExisting(parsed, source.relativePath, digest, access)
        }
      }
      return store.commit(commitInput, {
        idempotencyOperation: 'observe',
        idempotencyRequest: parsed,
        sourceLocator: source.relativePath,
        access
      })
    })
  }

  async read(
    workspaceRoot: string,
    input: ArtifactVersionReadInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionReadV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionReadInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).read(parsed, access)
    })
  }

  async list(
    workspaceRoot: string,
    input: ArtifactVersionListInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionListV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionListInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).list(parsed, access)
    })
  }

  async materialize(
    workspaceRoot: string,
    input: ArtifactVersionMaterializeInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionMaterializeReceiptV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionMaterializeInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).materialize(parsed, access)
    })
  }

  async restoreAsNew(
    workspaceRoot: string,
    input: ArtifactVersionRestoreAsNewInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCommitReceiptV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionRestoreAsNewInputV1Schema.parse(input)
      const store = await this.#store(workspaceRoot)
      const source = await store.inspect(parsed.sourceVersionId, access)
      await store.assertCurrentAccess(parsed.artifactId, access)
      if (source.artifact.artifactId !== parsed.artifactId) {
        throw domainError(
          'version-not-found',
          'The restore source does not belong to the requested artifact.'
        )
      }
      const content = source.version.storage.mode === 'snapshot'
        ? {
            mode: 'snapshot' as const,
            dataBase64: Buffer.from(source.bytes).toString('base64'),
            ...(source.version.storage.mediaType
              ? { mediaType: source.version.storage.mediaType }
              : {})
          }
        : {
            ...source.version.storage,
            mode: 'reference' as const
          }
      const commitInput = artifactVersionCommitInputV1Schema.parse({
        idempotencyKey: parsed.idempotencyKey,
        candidates: [{
          candidateId: `restore:${parsed.sourceVersionId}`,
          artifactId: parsed.artifactId,
          expectedCurrentVersionId: parsed.expectedCurrentVersionId,
          kind: source.artifact.kind,
          label: parsed.label ?? source.artifact.label,
          intent: 'restore',
          content,
          dependencies: [{
            role: 'restored-from',
            required: true,
            target: { kind: 'version', ref: source.ref }
          }],
          accessPolicy: parsed.accessPolicy ?? source.version.accessPolicy,
          metadata: {
            ...(parsed.metadata ?? {}),
            restoredFromVersionId: parsed.sourceVersionId
          }
        }]
      })
      return store.commit(commitInput, { access })
    })
  }

  async compare(
    workspaceRoot: string,
    input: ArtifactVersionCompareInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCompareV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionCompareInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).compare(parsed, access)
    })
  }

  async exportBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleExportInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleReceiptV1>> {
    return this.#attempt(async () => {
      const { artifactVersionBundleExportInputV1Schema } = await import('../contract.js')
      const parsed = artifactVersionBundleExportInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).exportBundle(parsed, access)
    })
  }

  async verifyBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleVerifyInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleVerificationV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionBundleVerifyInputV1Schema.parse(input)
      const file = await readWorkspaceBytes(workspaceRoot, parsed.bundlePath)
      return verifyBundleBytes(file.bytes).verification
    })
  }

  async importBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleImportInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleImportReceiptV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionBundleImportInputV1Schema.parse(input)
      const file = await readWorkspaceBytes(workspaceRoot, parsed.bundlePath)
      const verified = verifyBundleBytes(file.bytes)
      if (!verified.bundle || !verified.verification.valid) {
        throw domainError('bundle-invalid', 'The bundle failed integrity validation.', {
          issues: verified.verification.issues
        })
      }
      return (await this.#store(workspaceRoot)).importBundle(parsed, verified.bundle, access)
    })
  }

  async listEvents(
    workspaceRoot: string,
    input: ArtifactVersionEventListInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionEventListV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionEventListInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).listEvents(parsed, access)
    })
  }

  async refresh(
    workspaceRoot: string,
    input: ArtifactVersionRefreshInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionResultV1<ArtifactVersionRefreshV1>> {
    return this.#attempt(async () => {
      const parsed = artifactVersionRefreshInputV1Schema.parse(input)
      return (await this.#store(workspaceRoot)).refresh(parsed, access)
    })
  }

  async #store(workspaceRoot: string): Promise<ArtifactVersionWorkspaceStore> {
    const canonical = await canonicalDirectory(workspaceRoot, 'Workspace root')
    let store = this.#stores.get(canonical)
    if (!store) {
      store = ArtifactVersionWorkspaceStore.open({
        userDataDir: this.#userDataDir,
        workspaceRoot: canonical,
        now: this.#now,
        id: this.#id
      })
      this.#stores.set(canonical, store)
    }
    return store
  }

  async #attempt<T>(operation: () => Promise<T>): Promise<ArtifactVersionResultV1<T>> {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, issue: issueFrom(error) }
    }
  }
}

type WorkspaceStoreOptions = Readonly<{
  userDataDir: string
  workspaceRoot: string
  now: Clock
  id: IdFactory
}>

type CommitOptions = Readonly<{
  idempotencyOperation?: 'commit' | 'observe'
  idempotencyRequest?: unknown
  sourceLocator?: string
  access: ArtifactVersionAccessContext
}>

const DEFAULT_ACCESS_POLICY = Object.freeze({
  visibility: 'workspace' as const,
  principals: Object.freeze([]) as readonly string[],
  allowExport: true
})

class ArtifactVersionWorkspaceStore {
  readonly #dataRoot: string
  readonly #workspaceRoot: string
  readonly #workspaceKey: string
  readonly #now: Clock
  readonly #id: IdFactory
  #queue: Promise<void> = Promise.resolve()

  private constructor(options: WorkspaceStoreOptions & Readonly<{ dataRoot: string }>) {
    this.#dataRoot = options.dataRoot
    this.#workspaceRoot = options.workspaceRoot
    this.#workspaceKey = sha256(options.workspaceRoot)
    this.#now = options.now
    this.#id = options.id
  }

  static async open(options: WorkspaceStoreOptions): Promise<ArtifactVersionWorkspaceStore> {
    const dataRoot = await canonicalDirectory(
      options.userDataDir,
      'Artifact Versions user data directory'
    )
    return new ArtifactVersionWorkspaceStore({ ...options, dataRoot })
  }

  commit(
    input: ArtifactVersionCommitInputV1,
    options: CommitOptions
  ): Promise<ArtifactVersionCommitReceiptV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const access = options.access
      const operation = options.idempotencyOperation ?? 'commit'
      const requestDigest = sha256(stableStringify(options.idempotencyRequest ?? input))
      const replay = this.#idempotentReplay(
        index,
        operation,
        input.idempotencyKey,
        requestDigest,
        artifactVersionCommitReceiptV1Schema
      )
      if (replay) {
        for (const item of replay.versions) {
          assertVersionAccess(requiredVersion(index, item.version.versionId), access)
        }
        return { ...replay, idempotentReplay: true }
      }

      validateCandidateGraph(input.candidates)
      const artifacts = new Map(index.artifacts.map((artifact) => [artifact.artifactId, artifact]))
      const versions = new Map(index.versions.map((version) => [version.versionId, version]))
      const now = this.#now().toISOString()
      const transactionId = `artifact-commit:${this.#id()}`
      const planned = new Map<string, PlannedCommit>()

      for (const candidate of input.candidates) {
        const existing = candidate.artifactId
          ? artifacts.get(candidate.artifactId)
          : undefined
        if (candidate.artifactId && !existing) {
          throw domainError(
            'artifact-not-found',
            `Artifact not found: ${candidate.artifactId}`,
            { artifactId: candidate.artifactId }
          )
        }
        if (existing) {
          assertVersionAccess(requiredVersion(index, existing.currentVersionId), access)
        }
        if (existing && existing.currentVersionId !== candidate.expectedCurrentVersionId) {
          throw domainError('stale-base', 'The artifact current version has changed.', {
            artifactId: existing.artifactId,
            expectedCurrentVersionId: candidate.expectedCurrentVersionId,
            actualCurrentVersionId: existing.currentVersionId
          })
        }
        if (existing && existing.kind !== candidate.kind) {
          throw domainError('invalid-input', 'Artifact kind is immutable.', {
            artifactId: existing.artifactId,
            expectedKind: existing.kind,
            receivedKind: candidate.kind
          })
        }
        const artifactId = existing?.artifactId ?? `artifact:${this.#id()}`
        const versionId = `artifact-version:${this.#id()}`
        const storage = commitStorage(candidate)
        const artifact: ArtifactV1 = existing
          ? artifactV1Schema.parse({
              ...existing,
              ...(candidate.label ? { label: candidate.label } : {}),
              updatedAt: now,
              currentVersionId: versionId,
              versionCount: existing.versionCount + 1
            })
          : artifactV1Schema.parse({
              artifactId,
              kind: candidate.kind,
              ...(candidate.label ? { label: candidate.label } : {}),
              createdAt: now,
              updatedAt: now,
              currentVersionId: versionId,
              versionCount: 1
            })
        const version = artifactVersionV1Schema.parse({
          schemaVersion: 1,
          versionId,
          artifactId,
          ...(existing ? { parentVersionId: existing.currentVersionId } : {}),
          sequence: index.nextVersionSequence++,
          transactionId,
          createdAt: now,
          intent: candidate.intent,
          storage,
          dependencies: [],
          accessPolicy: candidate.accessPolicy ?? (
            existing
              ? requiredVersion(index, existing.currentVersionId).accessPolicy
              : DEFAULT_ACCESS_POLICY
          ),
          metadata: candidate.metadata ?? {}
        })
        planned.set(candidate.candidateId, {
          candidate,
          artifact,
          version,
          ref: versionRef(version)
        })
      }

      for (const item of planned.values()) {
        item.version.dependencies = (item.candidate.dependencies ?? []).map((dependency) => {
          const target = dependency.target.kind === 'candidate'
            ? planned.get(dependency.target.candidateId)?.ref
            : validatedDependencyRef(dependency.target.ref, versions, access)
          if (!target) {
            throw domainError(
              'invalid-dependency',
              `Unknown candidate dependency: ${
                dependency.target.kind === 'candidate'
                  ? dependency.target.candidateId
                  : dependency.target.ref.versionId
              }`
            )
          }
          return {
            role: dependency.role,
            target,
            required: dependency.required ?? true
          }
        })
        artifactVersionV1Schema.parse(item.version)
      }

      for (const item of planned.values()) {
        if (item.version.storage.mode !== 'snapshot') continue
        const bytes = Buffer.from(item.candidate.content.mode === 'snapshot'
          ? item.candidate.content.dataBase64
          : '', 'base64')
        await this.#writeObject(item.version.storage.contentDigest, bytes)
      }

      const committedEvents: ArtifactVersionLifecycleEventV1[] = []
      for (const item of planned.values()) {
        const previous = item.version.parentVersionId
        artifacts.set(item.artifact.artifactId, item.artifact)
        versions.set(item.version.versionId, item.version)
        if (!previous) {
          committedEvents.push(this.#event(index, {
            type: 'artifact-created',
            artifactId: item.artifact.artifactId,
            versionId: item.version.versionId,
            transactionId,
            createdAt: now,
            detail: { candidateId: item.candidate.candidateId }
          }))
        }
        committedEvents.push(this.#event(index, {
          type: 'version-committed',
          artifactId: item.artifact.artifactId,
          versionId: item.version.versionId,
          ...(previous ? { previousVersionId: previous } : {}),
          transactionId,
          createdAt: now,
          detail: {
            candidateId: item.candidate.candidateId,
            contentDigest: item.version.storage.contentDigest,
            intent: item.version.intent
          }
        }))
        if (previous) {
          committedEvents.push(this.#event(index, {
            type: 'current-changed',
            artifactId: item.artifact.artifactId,
            versionId: item.version.versionId,
            previousVersionId: previous,
            transactionId,
            createdAt: now,
            detail: {}
          }))
          if (item.candidate.intent === 'observe') {
            committedEvents.push(this.#event(index, {
              type: 'artifact-content-changed',
              artifactId: item.artifact.artifactId,
              versionId: item.version.versionId,
              previousVersionId: previous,
              transactionId,
              createdAt: now,
              detail: {
                previousContentDigest: versions.get(previous)?.storage.contentDigest ?? '',
                contentDigest: item.version.storage.contentDigest,
                ...(options.sourceLocator
                  ? { locator: `workspace:${options.sourceLocator}` }
                  : {})
              }
            }))
          }
        }
        if (item.candidate.intent === 'observe' && options.sourceLocator) {
          index.locations.push(locationBindingSchema.parse({
            artifactId: item.artifact.artifactId,
            versionId: item.version.versionId,
            activeLocator: `workspace:${options.sourceLocator}`,
            historicalLocators: [],
            sourceAvailability: 'available',
            observedAt: now,
            lastObservedContentDigest: item.version.storage.contentDigest
          }))
        }
      }
      index.artifacts = [...artifacts.values()]
      index.versions = [...versions.values()]
      index.events.push(...committedEvents)
      const receipt = artifactVersionCommitReceiptV1Schema.parse({
        transactionId,
        committedAt: now,
        idempotentReplay: false,
        versions: [...planned.entries()].map(([candidateId, item]) => ({
          candidateId,
          artifact: item.artifact,
          version: item.version,
          ref: item.ref
        })),
        events: committedEvents
      })
      this.#remember(index, operation, input.idempotencyKey, requestDigest, receipt)
      await this.#save(index)
      return receipt
    })
  }

  read(
    input: ArtifactVersionReadInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionReadV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const version = requiredVersion(index, input.versionId)
      assertVersionAccess(version, access)
      const bytes = await this.#readVersionBytes(index, version)
      const maximum = input.maxBytes ?? 64 * 1024 * 1024
      if (bytes.byteLength > maximum) {
        throw domainError('content-unavailable', 'Artifact content exceeds maxBytes.', {
          versionId: version.versionId,
          byteLength: bytes.byteLength,
          maxBytes: maximum
        })
      }
      const projectedVersion = projectVersionForAccess(index, version, access)
      return artifactVersionReadV1Schema.parse({
        artifact: projectArtifactForAccess(
          index,
          requiredArtifact(index, version.artifactId),
          access
        ),
        version: projectedVersion,
        ref: versionRef(projectedVersion, locationFor(index, version.versionId)),
        dataBase64: Buffer.from(bytes).toString('base64')
      })
    })
  }

  list(
    input: ArtifactVersionListInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionListV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const artifacts = new Map(index.artifacts.map((artifact) => [artifact.artifactId, artifact]))
      if (input.artifactId && !artifacts.has(input.artifactId)) {
        throw domainError('artifact-not-found', `Artifact not found: ${input.artifactId}`)
      }
      const limit = input.limit ?? 100
      const candidates = index.versions
        .filter((version) => !input.artifactId || version.artifactId === input.artifactId)
        .filter((version) => !input.beforeSequence || version.sequence < input.beforeSequence)
        .filter((version) => canAccessVersion(version, access))
        .sort((left, right) => right.sequence - left.sequence)
      const page = candidates.slice(0, limit)
      return artifactVersionListV1Schema.parse({
        items: page.map((version) => {
          const projectedVersion = projectVersionForAccess(index, version, access)
          return {
            artifact: projectArtifactForAccess(
              index,
              artifacts.get(version.artifactId)!,
              access
            ),
            version: projectedVersion,
            ref: versionRef(projectedVersion, locationFor(index, version.versionId))
          }
        }),
        ...(candidates.length > limit && page.length
          ? { nextBeforeSequence: page.at(-1)!.sequence }
          : {})
      })
    })
  }

  current(artifactId: string): Promise<Readonly<{
    artifact: ArtifactV1
    version: ArtifactVersionV1
    ref: ArtifactVersionRefV1
  }>> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const artifact = requiredArtifact(index, artifactId)
      const version = requiredVersion(index, artifact.currentVersionId)
      return {
        artifact,
        version,
        ref: versionRef(version, locationFor(index, version.versionId))
      }
    })
  }

  assertCurrentAccess(
    artifactId: string,
    access: ArtifactVersionAccessContext
  ): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const artifact = requiredArtifact(index, artifactId)
      assertVersionAccess(requiredVersion(index, artifact.currentVersionId), access)
    })
  }

  observeExisting(
    input: ArtifactVersionObserveInputV1,
    sourcePath: string,
    contentDigest: string,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionCommitReceiptV1> {
    return this.#enqueue(async () => {
      if (!input.artifactId) {
        throw domainError('invalid-input', 'Existing observation requires an artifactId.')
      }
      const index = await this.#load()
      const requestDigest = sha256(stableStringify(input))
      const replay = this.#idempotentReplay(
        index,
        'observe',
        input.idempotencyKey,
        requestDigest,
        artifactVersionCommitReceiptV1Schema
      )
      const artifact = requiredArtifact(index, input.artifactId)
      const version = requiredVersion(index, artifact.currentVersionId)
      assertVersionAccess(version, access)
      if (replay) return { ...replay, idempotentReplay: true }
      if (artifact.currentVersionId !== input.expectedCurrentVersionId) {
        throw domainError('stale-base', 'The artifact current version has changed.', {
          artifactId: artifact.artifactId,
          expectedCurrentVersionId: input.expectedCurrentVersionId,
          actualCurrentVersionId: artifact.currentVersionId
        })
      }
      if (version.storage.contentDigest !== contentDigest) {
        throw domainError('stale-base', 'Observed content no longer matches the current version.', {
          artifactId: artifact.artifactId,
          currentVersionId: version.versionId,
          currentContentDigest: version.storage.contentDigest,
          observedContentDigest: contentDigest
        })
      }
      if (
        input.accessPolicy &&
        stableStringify(input.accessPolicy) !== stableStringify(version.accessPolicy)
      ) {
        throw domainError(
          'invalid-input',
          'A passive unchanged observation cannot alter accessPolicy; use an explicit save.'
        )
      }
      const now = this.#now().toISOString()
      const transactionId = `artifact-commit:${this.#id()}`
      const activeLocator = `workspace:${sourcePath}`
      let location = index.locations.find((candidate) =>
        candidate.versionId === version.versionId
      )
      const events: ArtifactVersionLifecycleEventV1[] = []
      if (!location) {
        location = locationBindingSchema.parse({
          artifactId: artifact.artifactId,
          versionId: version.versionId,
          activeLocator,
          historicalLocators: [],
          sourceAvailability: 'available',
          observedAt: now,
          lastObservedContentDigest: contentDigest
        })
        index.locations.push(location)
      } else {
        if (location.activeLocator !== activeLocator) {
          if (!location.historicalLocators.includes(location.activeLocator)) {
            location.historicalLocators.push(location.activeLocator)
          }
          const previousLocator = location.activeLocator
          location.activeLocator = activeLocator
          events.push(this.#event(index, {
            type: 'artifact-moved',
            artifactId: artifact.artifactId,
            versionId: version.versionId,
            transactionId,
            createdAt: now,
            detail: { previousLocator, locator: activeLocator }
          }))
        }
        if (location.sourceAvailability === 'missing') {
          events.push(this.#event(index, {
            type: 'artifact-restored',
            artifactId: artifact.artifactId,
            versionId: version.versionId,
            transactionId,
            createdAt: now,
            detail: { locator: activeLocator }
          }))
        }
        location.sourceAvailability = 'available'
        location.observedAt = now
        location.lastObservedContentDigest = contentDigest
      }
      if (input.label && input.label !== artifact.label) {
        artifact.label = input.label
        artifact.updatedAt = now
      }
      const receipt = artifactVersionCommitReceiptV1Schema.parse({
        transactionId,
        committedAt: now,
        idempotentReplay: false,
        versions: [{
          candidateId: input.candidateId,
          artifact,
          version,
          ref: versionRef(version, location)
        }],
        events
      })
      index.events.push(...events)
      this.#remember(index, 'observe', input.idempotencyKey, requestDigest, receipt)
      await this.#save(index)
      return receipt
    })
  }

  inspect(
    versionId: string,
    access: ArtifactVersionAccessContext
  ): Promise<Readonly<{
    artifact: ArtifactV1
    version: ArtifactVersionV1
    ref: ArtifactVersionRefV1
    bytes: Uint8Array
  }>> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const version = requiredVersion(index, versionId)
      assertVersionAccess(version, access)
      const artifact = requiredArtifact(index, version.artifactId)
      return {
        artifact,
        version,
        ref: versionRef(version, locationFor(index, version.versionId)),
        bytes: await this.#readVersionBytes(index, version)
      }
    })
  }

  materialize(
    input: ArtifactVersionMaterializeInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionMaterializeReceiptV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const requestDigest = sha256(stableStringify(input))
      const version = requiredVersion(index, input.versionId)
      assertVersionAccess(version, access)
      const replay = this.#idempotentReplay(
        index,
        'materialize',
        input.idempotencyKey,
        requestDigest,
        artifactVersionMaterializeReceiptV1Schema
      )
      if (replay) return { ...replay, idempotentReplay: true }
      const bytes = await this.#readVersionBytes(index, version)
      let destinationPath: string
      try {
        destinationPath = await atomicWriteWorkspaceBytes(
          this.#workspaceRoot,
          input.destinationPath,
          bytes,
          input.overwrite ?? false
        )
      } catch (error) {
        if (!(error instanceof DestinationExistsError)) throw error
        const existing = await readWorkspaceBytes(this.#workspaceRoot, input.destinationPath)
        if (sha256(existing.bytes) !== version.storage.contentDigest) throw error
        destinationPath = existing.relativePath
      }
      const event = this.#event(index, {
        type: 'materialized',
        artifactId: version.artifactId,
        versionId: version.versionId,
        createdAt: this.#now().toISOString(),
        detail: { destinationPath }
      })
      index.events.push(event)
      const receipt = artifactVersionMaterializeReceiptV1Schema.parse({
        version: versionRef(version, locationFor(index, version.versionId)),
        destinationPath,
        byteLength: bytes.byteLength,
        contentDigest: version.storage.contentDigest,
        event,
        idempotentReplay: false
      })
      this.#remember(index, 'materialize', input.idempotencyKey, requestDigest, receipt)
      await this.#save(index)
      return receipt
    })
  }

  compare(
    input: ArtifactVersionCompareInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionCompareV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const from = requiredVersion(index, input.fromVersionId)
      const to = requiredVersion(index, input.toVersionId)
      assertVersionAccess(from, access)
      assertVersionAccess(to, access)
      const fromDeps = new Map(from.dependencies
        .filter((dependency) => dependencyIsAccessible(index, dependency, access))
        .map((dependency) => [
        dependencyKey(dependency),
        dependency
      ]))
      const toDeps = new Map(to.dependencies
        .filter((dependency) => dependencyIsAccessible(index, dependency, access))
        .map((dependency) => [
        dependencyKey(dependency),
        dependency
      ]))
      const previewLimit = input.textPreviewMaxBytes ?? 64 * 1024
      let textPreview: { from: string; to: string; truncated: boolean } | undefined
      if (previewLimit > 0 && isTextVersion(from) && isTextVersion(to)) {
        try {
          const [fromBytes, toBytes] = await Promise.all([
            this.#readVersionBytes(index, from),
            this.#readVersionBytes(index, to)
          ])
          textPreview = {
            from: Buffer.from(fromBytes.slice(0, previewLimit)).toString('utf8'),
            to: Buffer.from(toBytes.slice(0, previewLimit)).toString('utf8'),
            truncated: fromBytes.byteLength > previewLimit || toBytes.byteLength > previewLimit
          }
        } catch {
          // Metadata comparison remains useful when referenced bytes are unavailable.
        }
      }
      return artifactVersionCompareV1Schema.parse({
        from: versionRef(from, locationFor(index, from.versionId)),
        to: versionRef(to, locationFor(index, to.versionId)),
        sameContent: from.storage.contentDigest === to.storage.contentDigest,
        byteLengthDelta: to.storage.byteLength - from.storage.byteLength,
        mediaTypeChanged: from.storage.mediaType !== to.storage.mediaType,
        metadataChanged: stableStringify(from.metadata) !== stableStringify(to.metadata),
        addedDependencies: [...toDeps]
          .filter(([key]) => !fromDeps.has(key))
          .map(([, dependency]) => dependency),
        removedDependencies: [...fromDeps]
          .filter(([key]) => !toDeps.has(key))
          .map(([, dependency]) => dependency),
        ...(textPreview ? { textPreview } : {})
      })
    })
  }

  exportBundle(
    input: ArtifactVersionBundleExportInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionBundleReceiptV1> {
    return this.#enqueue(async () => {
      const { artifactVersionBundleReceiptV1Schema } = await import('../contract.js')
      const index = await this.#load()
      const requestDigest = sha256(stableStringify(input))
      const artifactMap = new Map(index.artifacts.map((artifact) => [artifact.artifactId, artifact]))
      const versionMap = new Map(index.versions.map((version) => [version.versionId, version]))
      const selectedVersionIds = new Set<string>()
      for (const artifactId of input.artifactIds ?? []) {
        if (!artifactMap.has(artifactId)) {
          throw domainError('artifact-not-found', `Artifact not found: ${artifactId}`)
        }
        index.versions
          .filter((version) => version.artifactId === artifactId)
          .forEach((version) => selectedVersionIds.add(version.versionId))
      }
      for (const versionId of input.versionIds ?? []) {
        selectedVersionIds.add(requiredVersion(index, versionId).versionId)
      }
      const pending = [...selectedVersionIds]
      while (pending.length) {
        const versionId = pending.pop()!
        const version = requiredVersion(index, versionId)
        if (version.parentVersionId && !selectedVersionIds.has(version.parentVersionId)) {
          requiredVersion(index, version.parentVersionId)
          selectedVersionIds.add(version.parentVersionId)
          pending.push(version.parentVersionId)
        }
        for (const dependency of version.dependencies) {
          if (selectedVersionIds.has(dependency.target.versionId)) continue
          requiredVersion(index, dependency.target.versionId)
          selectedVersionIds.add(dependency.target.versionId)
          pending.push(dependency.target.versionId)
        }
      }
      const versions = index.versions
        .filter((version) => selectedVersionIds.has(version.versionId))
        .sort((left, right) => left.sequence - right.sequence)
      for (const version of versions) assertVersionAccess(version, access)
      const blocked = versions.filter((version) => !version.accessPolicy.allowExport)
      if (blocked.length) {
        throw domainError(
          'export-not-allowed',
          'One or more selected artifact versions do not permit export.'
        )
      }
      const replay = this.#idempotentReplay(
        index,
        'bundle-export',
        input.idempotencyKey,
        requestDigest,
        artifactVersionBundleReceiptV1Schema
      )
      if (replay) return { ...replay, idempotentReplay: true }
      const versionsByArtifact = new Map<string, ArtifactVersionV1[]>()
      for (const version of versions) {
        const items = versionsByArtifact.get(version.artifactId) ?? []
        items.push(version)
        versionsByArtifact.set(version.artifactId, items)
      }
      const artifacts = [...versionsByArtifact.entries()]
        .map(([artifactId, selectedVersions]) => {
          const artifact = artifactMap.get(artifactId)
          if (!artifact) throw domainError('artifact-not-found', `Artifact not found: ${artifactId}`)
          const current = [...selectedVersions].sort((left, right) => right.sequence - left.sequence)[0]!
          return artifactV1Schema.parse({
            ...artifact,
            currentVersionId: current.versionId,
            versionCount: selectedVersions.length,
            updatedAt: current.createdAt
          })
        })
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
      const objects = []
      const seenObjects = new Set<string>()
      for (const version of versions) {
        if (version.storage.mode !== 'snapshot' || seenObjects.has(version.storage.contentDigest)) {
          continue
        }
        seenObjects.add(version.storage.contentDigest)
        const bytes = await this.#readObject(version.storage.contentDigest)
        objects.push({
          contentDigest: version.storage.contentDigest,
          byteLength: bytes.byteLength,
          dataBase64: Buffer.from(bytes).toString('base64')
        })
      }
      const bundleBase = {
        schemaVersion: 1 as const,
        createdAt: this.#now().toISOString(),
        artifacts,
        versions,
        objects
      }
      const bundle = artifactVersionBundleV1Schema.parse({
        ...bundleBase,
        bundleDigest: sha256(stableStringify(bundleBase))
      })
      const bytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
      let path: string
      try {
        path = await atomicWriteWorkspaceBytes(
          this.#workspaceRoot,
          input.destinationPath,
          bytes,
          input.overwrite ?? false
        )
      } catch (error) {
        if (!(error instanceof DestinationExistsError)) throw error
        const existing = await readWorkspaceBytes(this.#workspaceRoot, input.destinationPath)
        const verified = verifyBundleBytes(existing.bytes)
        if (verified.bundle?.bundleDigest !== bundle.bundleDigest) throw error
        path = existing.relativePath
      }
      const receipt = artifactVersionBundleReceiptV1Schema.parse({
        bundleDigest: bundle.bundleDigest,
        path,
        artifactCount: artifacts.length,
        versionCount: versions.length,
        objectCount: objects.length,
        idempotentReplay: false
      })
      this.#remember(index, 'bundle-export', input.idempotencyKey, requestDigest, receipt)
      await this.#save(index)
      return receipt
    })
  }

  importBundle(
    input: ArtifactVersionBundleImportInputV1,
    bundle: ArtifactVersionBundleV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionBundleImportReceiptV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const requestDigest = sha256(stableStringify({ input, bundleDigest: bundle.bundleDigest }))
      const existingArtifacts = new Map(index.artifacts.map((artifact) => [artifact.artifactId, artifact]))
      const existingVersions = new Map(index.versions.map((version) => [version.versionId, version]))
      const replay = this.#idempotentReplay(
        index,
        'bundle-import',
        input.idempotencyKey,
        requestDigest,
        artifactVersionBundleImportReceiptV1Schema
      )
      if (replay) {
        for (const versionId of Object.values(replay.versionIdMap)) {
          const version = existingVersions.get(versionId)
          if (version) assertVersionAccess(version, access)
        }
        return { ...replay, idempotentReplay: true }
      }
      const policy = input.conflictPolicy ?? 'reject'
      const artifactIdMap: Record<string, string> = {}
      const versionIdMap: Record<string, string> = {}
      for (const artifact of bundle.artifacts) {
        artifactIdMap[artifact.artifactId] = policy === 'fork'
          ? `artifact:${this.#id()}`
          : artifact.artifactId
      }
      for (const version of bundle.versions) {
        versionIdMap[version.versionId] = policy === 'fork'
          ? `artifact-version:${this.#id()}`
          : version.versionId
      }
      if (policy === 'reject') {
        for (const artifact of bundle.artifacts) {
          const existing = existingArtifacts.get(artifact.artifactId)
          if (existing) {
            assertVersionAccess(requiredVersion(index, existing.currentVersionId), access)
          }
          if (existing && stableStringify(existing) !== stableStringify(artifact)) {
            throw domainError('bundle-invalid', 'Bundle artifact conflicts with local state.', {
              artifactId: artifact.artifactId
            })
          }
        }
        for (const version of bundle.versions) {
          const existing = existingVersions.get(version.versionId)
          if (existing) assertVersionAccess(existing, access)
          if (existing && stableVersionIdentity(existing) !== stableVersionIdentity(version)) {
            throw domainError('bundle-invalid', 'Bundle version conflicts with local state.', {
              versionId: version.versionId
            })
          }
        }
      }
      for (const object of bundle.objects) {
        await this.#writeObject(object.contentDigest, Buffer.from(object.dataBase64, 'base64'))
      }
      const importedArtifacts: ArtifactV1[] = []
      const importedVersions: ArtifactVersionV1[] = []
      for (const artifact of bundle.artifacts) {
        const mappedId = artifactIdMap[artifact.artifactId]!
        if (policy === 'reject' && existingArtifacts.has(mappedId)) continue
        const mapped = artifactV1Schema.parse({
          ...artifact,
          artifactId: mappedId,
          currentVersionId: versionIdMap[artifact.currentVersionId],
          ...(policy === 'fork' && artifact.label
            ? { label: `${artifact.label} (imported)` }
            : {})
        })
        importedArtifacts.push(mapped)
        existingArtifacts.set(mapped.artifactId, mapped)
      }
      for (const version of bundle.versions) {
        const mappedId = versionIdMap[version.versionId]!
        if (policy === 'reject' && existingVersions.has(mappedId)) continue
        const mapped = artifactVersionV1Schema.parse({
          ...version,
          versionId: mappedId,
          artifactId: artifactIdMap[version.artifactId],
          ...(version.parentVersionId
            ? { parentVersionId: versionIdMap[version.parentVersionId] }
            : {}),
          sequence: index.nextVersionSequence++,
          intent: policy === 'fork' ? 'import' : version.intent,
          dependencies: version.dependencies.map((dependency) => ({
            ...dependency,
            target: {
              ...dependency.target,
              artifactId: artifactIdMap[dependency.target.artifactId] ?? dependency.target.artifactId,
              versionId: versionIdMap[dependency.target.versionId] ?? dependency.target.versionId
            }
          })),
          metadata: policy === 'fork'
            ? {
                ...version.metadata,
                importedFromBundleDigest: bundle.bundleDigest,
                importedOriginalVersionId: version.versionId
              }
            : version.metadata
        })
        importedVersions.push(mapped)
        existingVersions.set(mapped.versionId, mapped)
      }
      index.artifacts = [...existingArtifacts.values()]
      index.versions = [...existingVersions.values()]
      const events = importedArtifacts.map((artifact) => this.#event(index, {
        type: 'bundle-imported',
        artifactId: artifact.artifactId,
        versionId: artifact.currentVersionId,
        createdAt: this.#now().toISOString(),
        detail: { bundleDigest: bundle.bundleDigest, conflictPolicy: policy }
      }))
      index.events.push(...events)
      const receipt = artifactVersionBundleImportReceiptV1Schema.parse({
        bundleDigest: bundle.bundleDigest,
        artifactIdMap,
        versionIdMap,
        importedArtifactCount: importedArtifacts.length,
        importedVersionCount: importedVersions.length,
        events,
        idempotentReplay: false
      })
      this.#remember(index, 'bundle-import', input.idempotencyKey, requestDigest, receipt)
      await this.#save(index)
      return receipt
    })
  }

  listEvents(
    input: ArtifactVersionEventListInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionEventListV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      const after = input.afterSequence ?? 0
      const limit = input.limit ?? 250
      const candidates = index.events
        .filter((event) => event.sequence > after)
        .sort((left, right) => left.sequence - right.sequence)
      const events = candidates
        .filter((event) => {
          const version = index.versions.find((item) => item.versionId === event.versionId)
          return Boolean(version && canAccessVersion(version, access))
        })
        .slice(0, limit)
        .map((event) => projectEventForAccess(index, event, access))
      return artifactVersionEventListV1Schema.parse({
        events,
        lastSequence: events.at(-1)?.sequence ?? candidates.at(-1)?.sequence ?? after
      })
    })
  }

  refresh(
    input: ArtifactVersionRefreshInputV1,
    access: ArtifactVersionAccessContext
  ): Promise<ArtifactVersionRefreshV1> {
    return this.#enqueue(async () => {
      const index = await this.#load()
      if (input.artifactId) {
        const artifact = requiredArtifact(index, input.artifactId)
        assertVersionAccess(requiredVersion(index, artifact.currentVersionId), access)
      }
      const artifacts = new Map(index.artifacts.map((artifact) => [artifact.artifactId, artifact]))
      const versions = new Map(index.versions.map((version) => [version.versionId, version]))
      const locations = index.locations.filter((location) => {
        if (input.artifactId && location.artifactId !== input.artifactId) return false
        return artifacts.get(location.artifactId)?.currentVersionId === location.versionId &&
          canAccessVersion(versions.get(location.versionId), access)
      })
      const events: ArtifactVersionLifecycleEventV1[] = []
      for (const location of locations) {
        const version = versions.get(location.versionId)
        if (!version) continue
        const now = this.#now().toISOString()
        try {
          const observed = await readWorkspaceBytes(
            this.#workspaceRoot,
            location.activeLocator.slice('workspace:'.length)
          )
          const digest = sha256(observed.bytes)
          if (location.sourceAvailability === 'missing') {
            events.push(this.#event(index, {
              type: 'artifact-restored',
              artifactId: location.artifactId,
              versionId: location.versionId,
              createdAt: now,
              detail: { locator: location.activeLocator, contentDigest: digest }
            }))
          }
          if (
            digest !== version.storage.contentDigest &&
            digest !== location.lastObservedContentDigest
          ) {
            events.push(this.#event(index, {
              type: 'artifact-content-changed',
              artifactId: location.artifactId,
              versionId: location.versionId,
              createdAt: now,
              detail: {
                locator: location.activeLocator,
                previousContentDigest: version.storage.contentDigest,
                contentDigest: digest
              }
            }))
          }
          location.sourceAvailability = 'available'
          location.lastObservedContentDigest = digest
          location.observedAt = now
        } catch (error) {
          if (!isMissingPathError(error)) throw error
          if (location.sourceAvailability !== 'missing') {
            events.push(this.#event(index, {
              type: 'artifact-missing',
              artifactId: location.artifactId,
              versionId: location.versionId,
              createdAt: now,
              detail: { locator: location.activeLocator }
            }))
          }
          location.sourceAvailability = 'missing'
          location.observedAt = now
        }
      }
      index.events.push(...events)
      await this.#save(index)
      return artifactVersionRefreshV1Schema.parse({
        checked: locations.length,
        locations: locations.map((location) => ({
          artifactId: location.artifactId,
          versionId: location.versionId,
          activeLocator: location.activeLocator,
          historicalLocators: location.historicalLocators,
          sourceAvailability: location.sourceAvailability,
          observedAt: location.observedAt
        })),
        events
      })
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }

  async #load(): Promise<StoreIndex> {
    let index: StoreIndex
    try {
      const raw = await readSafeDataText(this.#workspaceDataRoot(), INDEX_SEGMENTS)
      index = storeIndexSchema.parse(JSON.parse(raw))
      if (index.workspaceKey !== this.#workspaceKey) {
        throw new Error('Artifact Versions index workspace key mismatch.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      index = this.#emptyIndex()
    }
    if (
      index.artifacts.length === 0 &&
      index.versions.length === 0 &&
      !index.migrations[LEGACY_MIGRATION_KEY]
    ) {
      const migrated = await this.#migrateLegacyRegistry(index)
      if (migrated) await this.#save(index)
    }
    return index
  }

  #emptyIndex(): StoreIndex {
    return storeIndexSchema.parse({
      schemaVersion: STORE_SCHEMA_VERSION,
      workspaceKey: this.#workspaceKey,
      revision: 0,
      nextVersionSequence: 1,
      nextEventSequence: 1,
      artifacts: [],
      versions: [],
      events: [],
      locations: [],
      idempotency: {},
      migrations: {}
    })
  }

  async #migrateLegacyRegistry(index: StoreIndex): Promise<boolean> {
    const segments = legacyRegistrySegments(this.#workspaceRoot)
    let raw: string
    try {
      raw = await readSafeDataText(this.#dataRoot, segments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }

    let legacy: z.infer<typeof legacyRegistrySchema>
    try {
      legacy = legacyRegistrySchema.parse(JSON.parse(raw))
    } catch (error) {
      throw domainError(
        'content-unavailable',
        'Legacy Evidence Artifact Registry migration failed closed: the registry is invalid.',
        { reason: messageOf(error) }
      )
    }
    validateLegacyRegistryGraph(legacy.artifacts, legacy.artifactVersions)

    const sourceDigest = sha256(raw)
    const prepared: PreparedLegacyVersion[] = []
    for (const [position, item] of legacy.artifactVersions.entries()) {
      const digest = normalizeLegacyDigest(item)
      const source = await this.#prepareLegacySource(item, digest)
      const byteLength = source.bytes?.byteLength ?? item.size
      if (byteLength === null || byteLength === undefined) {
        throw legacyMigrationFailure(
          item,
          'byteLength is absent and no digest-verified local bytes are available'
        )
      }
      if (source.bytes && item.size !== null && item.size !== undefined && item.size !== byteLength) {
        throw legacyMigrationFailure(
          item,
          `recorded size ${item.size} does not match verified byteLength ${byteLength}`,
          'content-mismatch'
        )
      }
      const artifact = legacy.artifacts.find((candidate) =>
        candidate.artifactId === item.artifactId
      )!
      const accessPolicy = legacyAccessPolicy(artifact, item)
      const mediaType = validMediaType(item.mediaType) ? item.mediaType ?? undefined : undefined
      const storage = source.bytes
        ? {
            mode: 'snapshot' as const,
            contentDigest: digest,
            byteLength,
            ...(mediaType ? { mediaType } : {})
          }
        : {
            mode: 'reference' as const,
            locator: source.referenceLocator,
            contentDigest: digest,
            byteLength,
            ...(mediaType ? { mediaType } : {}),
            availability: legacyReferenceAvailability(item, source.local)
          }
      const version = artifactVersionV1Schema.parse({
        schemaVersion: 1,
        versionId: item.versionId,
        artifactId: item.artifactId,
        ...(item.supersedes ? { parentVersionId: item.supersedes } : {}),
        sequence: position + 1,
        transactionId: `artifact-commit:legacy-registry:${sha256(
          `${sourceDigest}\0${item.versionId}`
        ).slice(0, 24)}`,
        createdAt: item.observedAt,
        intent: 'observe',
        storage,
        dependencies: [],
        accessPolicy,
        metadata: {
          migratedFrom: LEGACY_REGISTRY_SCHEMA_VERSION,
          legacyLocator: item.locator,
          legacyHistoricalLocators: item.historicalLocators,
          legacyRebindCandidates: item.rebindCandidates,
          legacyAvailability: item.availability,
          legacyRetention: item.retention,
          ...(item.version ? { legacyVersion: item.version } : {}),
          ...(item.mediaType && !mediaType ? { legacyMediaType: item.mediaType } : {}),
          ...(Object.keys(artifact.accessPolicy).length > 0
            ? { legacyAccessPolicy: artifact.accessPolicy }
            : {})
        }
      })
      prepared.push({
        version,
        ...(source.bytes ? { bytes: source.bytes } : {}),
        ...(source.location ? {
          location: locationBindingSchema.parse({
            artifactId: item.artifactId,
            versionId: item.versionId,
            activeLocator: source.location.activeLocator,
            historicalLocators: source.location.historicalLocators,
            sourceAvailability: source.location.sourceAvailability,
            observedAt: item.observedAt,
            lastObservedContentDigest: digest
          })
        } : {})
      })
    }

    for (const item of prepared) {
      if (item.bytes) await this.#writeObject(item.version.storage.contentDigest, item.bytes)
    }

    const versions = new Map(prepared.map((item) => [item.version.versionId, item.version]))
    index.artifacts = legacy.artifacts.map((item) => {
      const history = prepared.filter((candidate) =>
        candidate.version.artifactId === item.artifactId
      )
      const current = versions.get(item.currentVersionId)!
      return artifactV1Schema.parse({
        artifactId: item.artifactId,
        kind: item.kind,
        createdAt: item.createdAt,
        updatedAt: current.createdAt,
        currentVersionId: item.currentVersionId,
        versionCount: history.length
      })
    })
    index.versions = prepared.map((item) => item.version)
    index.locations = prepared.flatMap((item) => item.location ? [item.location] : [])
    index.nextVersionSequence = prepared.length + 1
    index.migrations[LEGACY_MIGRATION_KEY] = legacyMigrationRecordSchema.parse({
      sourceDigest,
      migratedAt: this.#now().toISOString(),
      artifactCount: index.artifacts.length,
      versionCount: index.versions.length,
      snapshotCount: prepared.filter((item) => item.bytes).length
    })
    return true
  }

  async #prepareLegacySource(
    item: LegacyArtifactVersion,
    digest: string
  ): Promise<PreparedLegacySource> {
    const active = legacyLocator(this.#workspaceRoot, item.locator)
    const candidates = uniqueStrings([
      item.locator,
      ...item.historicalLocators,
      ...item.rebindCandidates
    ]).map((locator) => legacyLocator(this.#workspaceRoot, locator))
    for (const candidate of candidates) {
      if (!candidate.localPath) continue
      try {
        const source = await readWorkspaceBytes(this.#workspaceRoot, candidate.localPath)
        if (sha256(source.bytes) !== digest) continue
        const verifiedLocator = `workspace:${source.relativePath}`
        return {
          bytes: source.bytes,
          referenceLocator: verifiedLocator,
          local: true,
          location: {
            activeLocator: verifiedLocator,
            historicalLocators: uniqueStrings([
              active.referenceLocator,
              ...candidates.map((value) => value.referenceLocator)
            ]).filter((locator) => locator !== verifiedLocator),
            sourceAvailability: 'available'
          }
        }
      } catch (error) {
        if (error instanceof WorkspacePathError) {
          throw legacyMigrationFailure(
            item,
            `locator escapes the workspace: ${candidate.original}`
          )
        }
        if (!isUnavailableLegacyPathError(error)) throw error
      }
    }
    return {
      referenceLocator: active.referenceLocator,
      local: Boolean(active.localPath),
      ...(active.localPath ? {
        location: {
          activeLocator: active.referenceLocator,
          historicalLocators: uniqueStrings(item.historicalLocators.map((locator) =>
            legacyLocator(this.#workspaceRoot, locator).referenceLocator
          )).filter((locator) => locator !== active.referenceLocator),
          sourceAvailability: 'missing' as const
        }
      } : {})
    }
  }

  async #save(index: StoreIndex): Promise<void> {
    index.revision += 1
    const parsed = storeIndexSchema.parse(index)
    await atomicWriteSafeData(
      this.#workspaceDataRoot(),
      INDEX_SEGMENTS,
      `${JSON.stringify(parsed, null, 2)}\n`,
      { replace: true }
    )
  }

  #workspaceDataRoot(): string {
    return `${this.#dataRoot}/artifact-versions/workspaces/${this.#workspaceKey}`
  }

  #objectSegments(digest: string): readonly string[] {
    return ['objects', 'sha256', digest.slice(0, 2), digest]
  }

  async #writeObject(digest: string, bytes: Uint8Array): Promise<void> {
    if (sha256(bytes) !== digest) {
      throw domainError('content-mismatch', 'Snapshot bytes do not match their digest.', {
        contentDigest: digest
      })
    }
    try {
      const existing = await this.#readObject(digest)
      if (existing.byteLength !== bytes.byteLength) {
        throw domainError('content-mismatch', 'Existing snapshot object has the wrong length.', {
          contentDigest: digest
        })
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await atomicWriteSafeData(
        this.#workspaceDataRoot(),
        this.#objectSegments(digest),
        bytes,
        { replace: false }
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await this.#readObject(digest)
    }
  }

  async #readObject(digest: string): Promise<Uint8Array> {
    const bytes = await readSafeDataBytes(this.#workspaceDataRoot(), this.#objectSegments(digest))
    if (sha256(bytes) !== digest) {
      throw domainError('content-mismatch', 'Snapshot object failed digest verification.', {
        contentDigest: digest
      })
    }
    return bytes
  }

  async #readVersionBytes(
    index: StoreIndex,
    version: ArtifactVersionV1
  ): Promise<Uint8Array> {
    const bytes = version.storage.mode === 'snapshot'
      ? await this.#readObject(version.storage.contentDigest)
      : await this.#readReference(index, version)
    if (
      bytes.byteLength !== version.storage.byteLength ||
      sha256(bytes) !== version.storage.contentDigest
    ) {
      throw domainError('content-mismatch', 'Artifact bytes failed integrity verification.', {
        versionId: version.versionId,
        expectedDigest: version.storage.contentDigest,
        actualDigest: sha256(bytes)
      })
    }
    return bytes
  }

  async #readReference(index: StoreIndex, version: ArtifactVersionV1): Promise<Uint8Array> {
    const locator = locationFor(index, version.versionId)?.activeLocator ?? (
      version.storage.mode === 'reference' ? version.storage.locator : ''
    )
    if (version.storage.mode !== 'reference' || !locator.startsWith('workspace:')) {
      throw domainError('content-unavailable', 'Referenced artifact bytes are not locally readable.', {
        versionId: version.versionId
      })
    }
    try {
      return (await readWorkspaceBytes(
        this.#workspaceRoot,
        locator.slice('workspace:'.length)
      )).bytes
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error
      throw domainError('content-unavailable', 'Referenced artifact bytes are unavailable.', {
        versionId: version.versionId
      })
    }
  }

  #event(
    index: StoreIndex,
    input: Omit<ArtifactVersionLifecycleEventV1, 'schemaVersion' | 'eventId' | 'sequence'>
  ): ArtifactVersionLifecycleEventV1 {
    return artifactVersionLifecycleEventV1Schema.parse({
      schemaVersion: 1,
      eventId: `artifact-event:${this.#id()}`,
      sequence: index.nextEventSequence++,
      ...input
    })
  }

  #idempotentReplay<T>(
    index: StoreIndex,
    operation: string,
    key: string,
    requestDigest: string,
    schema: z.ZodType<T>
  ): T | null {
    const record = index.idempotency[idempotencySlot(operation, key)]
    if (!record) return null
    if (record.operation !== operation || record.requestDigest !== requestDigest) {
      throw domainError('idempotency-conflict', 'Idempotency key was reused for different input.', {
        operation,
        idempotencyKey: key
      })
    }
    return schema.parse(record.value)
  }

  #remember(
    index: StoreIndex,
    operation: string,
    key: string,
    requestDigest: string,
    value: unknown
  ): void {
    index.idempotency[idempotencySlot(operation, key)] = idempotencyRecordSchema.parse({
      operation,
      requestDigest,
      value
    }) as IdempotencyRecord
  }
}

function legacyRegistrySegments(workspaceRoot: string): readonly string[] {
  const identity = stableStringify({
    projectRoot: workspaceRoot,
    workspaceRoot
  })
  const scopeKey = `workspace:${sha256(identity)}`
  const slug = scopeKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'scope'
  const safeKey = `${slug}-${sha256(scopeKey).slice(0, 12)}`
  return ['evidence-dag', 'threads', 'artifact-registries', `${safeKey}.json`]
}

function validateLegacyRegistryGraph(
  artifacts: readonly LegacyArtifact[],
  versions: readonly LegacyArtifactVersion[]
): void {
  const artifactIds = new Set<string>()
  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.artifactId)) {
      throw legacyRegistryGraphFailure(`duplicate artifactId ${artifact.artifactId}`)
    }
    artifactIds.add(artifact.artifactId)
  }
  const versionIds = new Set<string>()
  const positions = new Map<string, number>()
  for (const [position, version] of versions.entries()) {
    if (versionIds.has(version.versionId)) {
      throw legacyRegistryGraphFailure(`duplicate versionId ${version.versionId}`)
    }
    if (!artifactIds.has(version.artifactId)) {
      throw legacyRegistryGraphFailure(
        `version ${version.versionId} references unknown artifact ${version.artifactId}`
      )
    }
    versionIds.add(version.versionId)
    positions.set(version.versionId, position)
  }
  for (const artifact of artifacts) {
    const history = versions.filter((version) => version.artifactId === artifact.artifactId)
    if (history.length === 0) {
      throw legacyRegistryGraphFailure(`artifact ${artifact.artifactId} has no versions`)
    }
    const byId = new Map(history.map((version) => [version.versionId, version]))
    if (!byId.has(artifact.currentVersionId)) {
      throw legacyRegistryGraphFailure(
        `artifact ${artifact.artifactId} currentVersionId is absent or belongs to another artifact`
      )
    }
    const children = new Map<string, LegacyArtifactVersion>()
    const roots: LegacyArtifactVersion[] = []
    for (const version of history) {
      if (!version.supersedes) {
        roots.push(version)
        continue
      }
      const parent = byId.get(version.supersedes)
      if (!parent) {
        throw legacyRegistryGraphFailure(
          `version ${version.versionId} supersedes an absent or cross-artifact version`
        )
      }
      if (children.has(parent.versionId)) {
        throw legacyRegistryGraphFailure(
          `artifact ${artifact.artifactId} has a branched version history`
        )
      }
      if (positions.get(parent.versionId)! >= positions.get(version.versionId)!) {
        throw legacyRegistryGraphFailure(
          `version ${version.versionId} appears before its superseded parent`
        )
      }
      children.set(parent.versionId, version)
    }
    if (roots.length !== 1) {
      throw legacyRegistryGraphFailure(
        `artifact ${artifact.artifactId} must have exactly one version-history root`
      )
    }
    const visited = new Set<string>()
    let cursor: LegacyArtifactVersion | undefined = roots[0]
    while (cursor) {
      if (visited.has(cursor.versionId)) {
        throw legacyRegistryGraphFailure(`artifact ${artifact.artifactId} history contains a cycle`)
      }
      visited.add(cursor.versionId)
      cursor = children.get(cursor.versionId)
    }
    if (visited.size !== history.length) {
      throw legacyRegistryGraphFailure(
        `artifact ${artifact.artifactId} contains a disconnected version history`
      )
    }
    const current = byId.get(artifact.currentVersionId)!
    if (children.has(current.versionId)) {
      throw legacyRegistryGraphFailure(
        `artifact ${artifact.artifactId} currentVersionId is not the history tip`
      )
    }
  }
}

function normalizeLegacyDigest(item: LegacyArtifactVersion): string {
  const match = /^(?:sha256:)?([a-f0-9]{64})$/i.exec(item.contentDigest ?? '')
  if (!match) {
    throw legacyMigrationFailure(
      item,
      'contentDigest is absent or is not a valid SHA-256 digest'
    )
  }
  return match[1]!.toLowerCase()
}

function legacyAccessPolicy(
  artifact: LegacyArtifact,
  version: LegacyArtifactVersion
): z.infer<typeof artifactVersionAccessPolicyV1Schema> {
  const explicit = artifactVersionAccessPolicyV1Schema.safeParse(artifact.accessPolicy)
  if (explicit.success) return explicit.data
  if (Object.keys(artifact.accessPolicy).length === 0 && version.availability !== 'restricted') {
    return {
      visibility: 'workspace',
      principals: [],
      allowExport: true
    }
  }
  return {
    visibility: 'restricted',
    principals: ['legacy:evidence-dag'],
    allowExport: false
  }
}

function legacyReferenceAvailability(
  item: LegacyArtifactVersion,
  local: boolean
): 'available' | 'missing' | 'remote' {
  if (local) return 'missing'
  if (item.availability === 'remote' || /^(?:https?|doi|swh|swhid):/i.test(item.locator)) {
    return 'remote'
  }
  if (item.availability === 'available' || item.availability === 'moved') return 'available'
  return 'missing'
}

function validMediaType(value: string | null | undefined): value is string {
  return Boolean(
    value && value.length <= 256 && /^[^\s/]+\/[^\s/]+$/.test(value)
  )
}

function legacyLocator(
  workspaceRoot: string,
  locator: string
): Readonly<{ original: string; referenceLocator: string; localPath?: string }> {
  if (/^(?:https?|doi|swh|swhid|runtime|trace):/i.test(locator) || locator.startsWith('citation:')) {
    return { original: locator, referenceLocator: locator }
  }
  const candidate = isAbsolute(locator) ? resolve(locator) : resolve(workspaceRoot, locator)
  const child = relative(workspaceRoot, candidate)
  if (child === '..' || child.startsWith(`..${sep}`) || child === '') {
    throw domainError(
      'content-unavailable',
      'Legacy Evidence Artifact Registry migration failed closed: a local locator is outside the workspace.',
      { locator }
    )
  }
  const workspacePath = child.split(sep).join('/')
  return {
    original: locator,
    referenceLocator: `workspace:${workspacePath}`,
    localPath: candidate
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function legacyMigrationFailure(
  item: LegacyArtifactVersion,
  reason: string,
  code: ArtifactVersionIssueV1['code'] = 'content-unavailable'
): ArtifactVersionDomainError {
  return domainError(
    code,
    `Legacy Evidence Artifact Registry migration failed closed for ${item.versionId}: ${reason}.`,
    {
      artifactId: item.artifactId,
      versionId: item.versionId,
      reason
    }
  )
}

function legacyRegistryGraphFailure(reason: string): ArtifactVersionDomainError {
  return domainError(
    'content-mismatch',
    `Legacy Evidence Artifact Registry migration failed closed: ${reason}.`,
    { reason }
  )
}

function isUnavailableLegacyPathError(error: unknown): boolean {
  return ['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException)?.code ?? '')
}

type PlannedCommit = {
  candidate: ArtifactVersionCommitCandidateV1
  artifact: ArtifactV1
  version: ArtifactVersionV1
  ref: ArtifactVersionRefV1
}

function commitStorage(candidate: ArtifactVersionCommitCandidateV1): ArtifactVersionV1['storage'] {
  if (candidate.content.mode === 'snapshot') {
    const bytes = Buffer.from(candidate.content.dataBase64, 'base64')
    return {
      mode: 'snapshot',
      contentDigest: sha256(bytes),
      byteLength: bytes.byteLength,
      ...(candidate.content.mediaType ? { mediaType: candidate.content.mediaType } : {})
    }
  }
  return {
    mode: 'reference',
    locator: candidate.content.locator,
    contentDigest: candidate.content.contentDigest,
    byteLength: candidate.content.byteLength,
    ...(candidate.content.mediaType ? { mediaType: candidate.content.mediaType } : {}),
    availability: candidate.content.availability ?? (
      /^(?:https?|s3):/.test(candidate.content.locator) ? 'remote' : 'available'
    )
  }
}

function versionRef(
  version: ArtifactVersionV1,
  location?: LocationBinding
): ArtifactVersionRefV1 {
  return {
    artifactId: version.artifactId,
    versionId: version.versionId,
    contentDigest: version.storage.contentDigest,
    byteLength: version.storage.byteLength,
    ...(version.storage.mediaType ? { mediaType: version.storage.mediaType } : {}),
    availability: version.storage.mode === 'snapshot'
      ? 'available'
      : location
        ? location.sourceAvailability
        : version.storage.availability,
    retention: version.storage.mode,
    accessPolicy: version.accessPolicy
  }
}

function canAccessVersion(
  version: ArtifactVersionV1 | undefined,
  access: ArtifactVersionAccessContext
): boolean {
  if (!version) return false
  // `system` is issued by the host capability broker to trusted domain-to-domain
  // invocations. It deliberately bypasses principals so Evidence and other
  // workspace services can process restricted lineage without impersonating a user.
  if (access.audience === 'system') return true
  if (version.accessPolicy.visibility !== 'restricted') return true
  return version.accessPolicy.principals.includes(access.callerId)
}

function assertVersionAccess(
  version: ArtifactVersionV1,
  access: ArtifactVersionAccessContext
): void {
  if (canAccessVersion(version, access)) return
  throw domainError(
    'access-restricted',
    'The requested artifact version is not available to this caller.'
  )
}

function dependencyIsAccessible(
  index: StoreIndex,
  dependency: ArtifactVersionDependencyRefV1,
  access: ArtifactVersionAccessContext
): boolean {
  return canAccessVersion(
    index.versions.find((version) => version.versionId === dependency.target.versionId),
    access
  )
}

function projectVersionForAccess(
  index: StoreIndex,
  version: ArtifactVersionV1,
  access: ArtifactVersionAccessContext
): ArtifactVersionV1 {
  const parentIsVisible = !version.parentVersionId || canAccessVersion(
    index.versions.find((item) => item.versionId === version.parentVersionId),
    access
  )
  const dependencies = version.dependencies.filter((dependency) =>
    dependencyIsAccessible(index, dependency, access)
  )
  if (parentIsVisible && dependencies.length === version.dependencies.length) return version
  const { parentVersionId: _parentVersionId, ...withoutParent } = version
  return artifactVersionV1Schema.parse({
    ...withoutParent,
    ...(parentIsVisible && version.parentVersionId
      ? { parentVersionId: version.parentVersionId }
      : {}),
    dependencies
  })
}

function projectArtifactForAccess(
  index: StoreIndex,
  artifact: ArtifactV1,
  access: ArtifactVersionAccessContext
): ArtifactV1 {
  const current = requiredVersion(index, artifact.currentVersionId)
  if (canAccessVersion(current, access)) return artifact
  const visible = index.versions
    .filter((version) => version.artifactId === artifact.artifactId)
    .filter((version) => canAccessVersion(version, access))
    .sort((left, right) => right.sequence - left.sequence)
  const latestVisible = visible[0]
  if (!latestVisible) {
    throw domainError(
      'access-restricted',
      'The requested artifact version is not available to this caller.'
    )
  }
  return artifactV1Schema.parse({
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    createdAt: artifact.createdAt,
    updatedAt: latestVisible.createdAt,
    currentVersionId: latestVisible.versionId,
    versionCount: visible.length
  })
}

function projectEventForAccess(
  index: StoreIndex,
  event: ArtifactVersionLifecycleEventV1,
  access: ArtifactVersionAccessContext
): ArtifactVersionLifecycleEventV1 {
  const previousIsVisible = !event.previousVersionId || canAccessVersion(
    index.versions.find((version) => version.versionId === event.previousVersionId),
    access
  )
  if (previousIsVisible) return event
  const {
    previousVersionId: _previousVersionId,
    detail,
    ...withoutPreviousVersion
  } = event
  const {
    previousContentDigest: _previousContentDigest,
    previousLocator: _previousLocator,
    ...safeDetail
  } = detail
  return artifactVersionLifecycleEventV1Schema.parse({
    ...withoutPreviousVersion,
    detail: safeDetail
  })
}

function locationFor(index: StoreIndex, versionId: string): LocationBinding | undefined {
  return index.locations.find((location) => location.versionId === versionId)
}

function validatedDependencyRef(
  ref: ArtifactVersionRefV1,
  versions: ReadonlyMap<string, ArtifactVersionV1>,
  access: ArtifactVersionAccessContext
): ArtifactVersionRefV1 {
  const version = versions.get(ref.versionId)
  if (!version) {
    throw domainError('invalid-dependency', `Dependency version not found: ${ref.versionId}`)
  }
  assertVersionAccess(version, access)
  const canonical = versionRef(version)
  if (
    canonical.artifactId !== ref.artifactId ||
    canonical.contentDigest !== ref.contentDigest ||
    canonical.byteLength !== ref.byteLength ||
    canonical.mediaType !== ref.mediaType ||
    canonical.retention !== ref.retention ||
    stableStringify(canonical.accessPolicy) !== stableStringify(ref.accessPolicy)
  ) {
    throw domainError('invalid-dependency', 'Dependency reference does not match stored version.', {
      versionId: ref.versionId
    })
  }
  return canonical
}

function validateCandidateGraph(candidates: readonly ArtifactVersionCommitCandidateV1[]): void {
  const ids = new Set(candidates.map((candidate) => candidate.candidateId))
  const edges = new Map(candidates.map((candidate) => [
    candidate.candidateId,
    (candidate.dependencies ?? [])
      .filter((dependency) => dependency.target.kind === 'candidate')
      .map((dependency) => (dependency.target as { candidateId: string }).candidateId)
  ]))
  for (const [source, targets] of edges) {
    for (const target of targets) {
      if (!ids.has(target)) {
        throw domainError('invalid-dependency', `Unknown candidate dependency: ${target}`)
      }
      if (source === target) {
        throw domainError('invalid-dependency', `Candidate cannot depend on itself: ${source}`)
      }
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (candidateId: string): void => {
    if (visited.has(candidateId)) return
    if (visiting.has(candidateId)) {
      throw domainError('invalid-dependency', 'Candidate dependencies must be acyclic.', {
        candidateId
      })
    }
    visiting.add(candidateId)
    for (const target of edges.get(candidateId) ?? []) visit(target)
    visiting.delete(candidateId)
    visited.add(candidateId)
  }
  for (const candidateId of ids) visit(candidateId)
}

function requiredArtifact(index: StoreIndex, artifactId: string): ArtifactV1 {
  const artifact = index.artifacts.find((candidate) => candidate.artifactId === artifactId)
  if (!artifact) throw domainError('artifact-not-found', `Artifact not found: ${artifactId}`)
  return artifact
}

function requiredVersion(index: StoreIndex, versionId: string): ArtifactVersionV1 {
  const version = index.versions.find((candidate) => candidate.versionId === versionId)
  if (!version) throw domainError('version-not-found', `Artifact version not found: ${versionId}`)
  return version
}

function dependencyKey(dependency: ArtifactVersionDependencyRefV1): string {
  return stableStringify(dependency)
}

function isTextVersion(version: ArtifactVersionV1): boolean {
  const mediaType = version.storage.mediaType
  return Boolean(
    mediaType?.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType?.endsWith('+json')
  )
}

function idempotencySlot(operation: string, key: string): string {
  return sha256(`${operation}\0${key}`)
}

function stableVersionIdentity(version: ArtifactVersionV1): string {
  return stableStringify({
    schemaVersion: version.schemaVersion,
    versionId: version.versionId,
    artifactId: version.artifactId,
    parentVersionId: version.parentVersionId,
    transactionId: version.transactionId,
    createdAt: version.createdAt,
    intent: version.intent,
    storage: version.storage,
    dependencies: version.dependencies,
    accessPolicy: version.accessPolicy,
    metadata: version.metadata
  })
}

function verifyBundleBytes(bytes: Uint8Array): Readonly<{
  bundle?: ArtifactVersionBundleV1
  verification: ArtifactVersionBundleVerificationV1
}> {
  const issues: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    return {
      verification: artifactVersionBundleVerificationV1Schema.parse({
        valid: false,
        artifactCount: 0,
        versionCount: 0,
        objectCount: 0,
        issues: [`Bundle is not valid JSON: ${messageOf(error)}`]
      })
    }
  }
  const parsed = artifactVersionBundleV1Schema.safeParse(raw)
  if (!parsed.success) {
    return {
      verification: artifactVersionBundleVerificationV1Schema.parse({
        valid: false,
        artifactCount: 0,
        versionCount: 0,
        objectCount: 0,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      })
    }
  }
  const bundle = parsed.data
  const { bundleDigest, ...base } = bundle
  if (sha256(stableStringify(base)) !== bundleDigest) {
    issues.push('Bundle manifest digest mismatch.')
  }
  const artifactIds = new Set<string>()
  const versionMap = new Map<string, ArtifactVersionV1>()
  const objectMap = new Map<string, Uint8Array>()
  for (const artifact of bundle.artifacts) {
    if (artifactIds.has(artifact.artifactId)) issues.push(`Duplicate artifact: ${artifact.artifactId}`)
    artifactIds.add(artifact.artifactId)
  }
  for (const version of bundle.versions) {
    if (versionMap.has(version.versionId)) issues.push(`Duplicate version: ${version.versionId}`)
    versionMap.set(version.versionId, version)
    if (!artifactIds.has(version.artifactId)) {
      issues.push(`Version references missing artifact: ${version.versionId}`)
    }
  }
  for (const object of bundle.objects) {
    const objectBytes = Buffer.from(object.dataBase64, 'base64')
    if (objectMap.has(object.contentDigest)) {
      issues.push(`Duplicate object: ${object.contentDigest}`)
    }
    objectMap.set(object.contentDigest, objectBytes)
    if (objectBytes.byteLength !== object.byteLength || sha256(objectBytes) !== object.contentDigest) {
      issues.push(`Object integrity mismatch: ${object.contentDigest}`)
    }
  }
  for (const artifact of bundle.artifacts) {
    const current = versionMap.get(artifact.currentVersionId)
    if (!current || current.artifactId !== artifact.artifactId) {
      issues.push(`Artifact current version is missing: ${artifact.artifactId}`)
    }
    const count = bundle.versions.filter((version) => version.artifactId === artifact.artifactId).length
    if (count !== artifact.versionCount) {
      issues.push(`Artifact version count mismatch: ${artifact.artifactId}`)
    }
  }
  for (const version of bundle.versions) {
    if (version.parentVersionId) {
      const parent = versionMap.get(version.parentVersionId)
      if (!parent || parent.artifactId !== version.artifactId) {
        issues.push(`Version parent is missing or belongs to another artifact: ${version.versionId}`)
      }
    }
    if (
      version.storage.mode === 'snapshot' &&
      !objectMap.has(version.storage.contentDigest)
    ) {
      issues.push(`Snapshot object is missing: ${version.storage.contentDigest}`)
    }
    for (const dependency of version.dependencies) {
      const target = versionMap.get(dependency.target.versionId)
      if (!target || target.artifactId !== dependency.target.artifactId) {
        issues.push(`Dependency target is missing: ${dependency.target.versionId}`)
        continue
      }
      if (stableStringify(versionRef(target)) !== stableStringify(dependency.target)) {
        issues.push(`Dependency target reference mismatch: ${dependency.target.versionId}`)
      }
    }
  }
  validateBundleGraph(bundle, versionMap, issues)
  return {
    bundle,
    verification: artifactVersionBundleVerificationV1Schema.parse({
      valid: issues.length === 0,
      bundleDigest,
      artifactCount: bundle.artifacts.length,
      versionCount: bundle.versions.length,
      objectCount: bundle.objects.length,
      issues
    })
  }
}

function validateBundleGraph(
  bundle: ArtifactVersionBundleV1,
  versionMap: ReadonlyMap<string, ArtifactVersionV1>,
  issues: string[]
): void {
  const versionsByArtifact = new Map<string, ArtifactVersionV1[]>()
  const sequenceOwners = new Map<number, string>()
  for (const version of bundle.versions) {
    const sequenceOwner = sequenceOwners.get(version.sequence)
    if (sequenceOwner && sequenceOwner !== version.versionId) {
      issues.push(
        `Duplicate version sequence ${version.sequence}: ${sequenceOwner}, ${version.versionId}`
      )
    } else {
      sequenceOwners.set(version.sequence, version.versionId)
    }
    const history = versionsByArtifact.get(version.artifactId) ?? []
    history.push(version)
    versionsByArtifact.set(version.artifactId, history)
  }

  for (const artifact of bundle.artifacts) {
    const history = versionsByArtifact.get(artifact.artifactId) ?? []
    if (!history.length) continue
    const roots = history.filter((version) => !version.parentVersionId)
    if (roots.length !== 1) {
      issues.push(`Artifact history must have exactly one root: ${artifact.artifactId}`)
    }
    const childByParent = new Map<string, ArtifactVersionV1>()
    for (const version of history) {
      if (!version.parentVersionId) continue
      const parent = versionMap.get(version.parentVersionId)
      if (!parent || parent.artifactId !== artifact.artifactId) continue
      const existingChild = childByParent.get(parent.versionId)
      if (existingChild && existingChild.versionId !== version.versionId) {
        issues.push(`Artifact history branches at version: ${parent.versionId}`)
      } else {
        childByParent.set(parent.versionId, version)
      }
      if (parent.sequence >= version.sequence) {
        issues.push(`Artifact history sequence is not increasing: ${version.versionId}`)
      }
    }
    const current = versionMap.get(artifact.currentVersionId)
    if (current && childByParent.has(current.versionId)) {
      issues.push(`Artifact current version is not the history tip: ${artifact.artifactId}`)
    }
    if (roots.length === 1) {
      const visited = new Set<string>()
      let cursor: ArtifactVersionV1 | undefined = roots[0]
      while (cursor && !visited.has(cursor.versionId)) {
        visited.add(cursor.versionId)
        cursor = childByParent.get(cursor.versionId)
      }
      if (visited.size !== history.length) {
        issues.push(`Artifact history is disconnected or cyclic: ${artifact.artifactId}`)
      }
      if (!visited.has(artifact.currentVersionId)) {
        issues.push(`Artifact current version is outside its history: ${artifact.artifactId}`)
      }
    }
  }

  const edges = new Map<string, string[]>()
  for (const version of bundle.versions) {
    edges.set(version.versionId, [
      ...(version.parentVersionId ? [version.parentVersionId] : []),
      ...version.dependencies.map((dependency) => dependency.target.versionId)
    ].filter((versionId) => versionMap.has(versionId)))
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const reported = new Set<string>()
  const visit = (versionId: string): void => {
    if (visited.has(versionId)) return
    if (visiting.has(versionId)) {
      if (!reported.has(versionId)) {
        issues.push(`Artifact version graph contains a cycle involving: ${versionId}`)
        reported.add(versionId)
      }
      return
    }
    visiting.add(versionId)
    for (const target of edges.get(versionId) ?? []) visit(target)
    visiting.delete(versionId)
    visited.add(versionId)
  }
  for (const versionId of edges.keys()) visit(versionId)
}

class ArtifactVersionDomainError extends Error {
  constructor(
    readonly code: ArtifactVersionIssueV1['code'],
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
  }
}

function domainError(
  code: ArtifactVersionIssueV1['code'],
  message: string,
  details?: Record<string, unknown>
): ArtifactVersionDomainError {
  return new ArtifactVersionDomainError(code, message, details)
}

function issueFrom(error: unknown): ArtifactVersionIssueV1 {
  if (error instanceof ArtifactVersionDomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details as ArtifactVersionIssueV1['details'] } : {})
    }
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid-input',
      message: 'Artifact Versions input or stored data failed validation.',
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      }
    }
  }
  if (error instanceof WorkspacePathError) {
    return { code: 'path-outside-workspace', message: error.message }
  }
  if (error instanceof DestinationExistsError) {
    return { code: 'destination-exists', message: error.message }
  }
  return { code: 'io-failure', message: messageOf(error) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
