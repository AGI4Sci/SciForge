import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  BIOLOGY_ROOM_MAX_ANNOTATIONS,
  BIOLOGY_ROOM_MAX_ASSETS,
  BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET,
  BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES,
  BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES,
  BIOLOGY_ROOM_SCHEMA_VERSION,
  biologyRoomApplyInputSchema,
  biologyRoomAssetInputSchema,
  biologyRoomCreateInputSchema,
  biologyRoomEventSchema,
  biologyRoomFormatFromPath,
  biologyRoomHistoryInputSchema,
  biologyRoomListInputSchema,
  biologyRoomManifestSchema,
  biologyRoomModalityForFormat,
  biologyRoomObserveInputSchema,
  biologyRoomOpenOrCreateInputSchema,
  biologyRoomRefreshInputSchema,
  biologyRoomTargetSchema,
  normalizeBiologyRoomRelativePath,
  type BiologyAnnotation,
  type BiologyContig,
  type BiologyRoomActor,
  type BiologyRoomApplyInput,
  type BiologyRoomApplyResult,
  type BiologyRoomAsset,
  type BiologyRoomAssetInput,
  type BiologyRoomCreateInput,
  type BiologyRoomEvent,
  type BiologyRoomFormat,
  type BiologyRoomHistoryInput,
  type BiologyRoomHistoryResult,
  type BiologyRoomIndexFingerprint,
  type BiologyRoomListInput,
  type BiologyRoomManifest,
  type BiologyRoomMutationOperation,
  type BiologyRoomObserveInput,
  type BiologyRoomObserveResult,
  type BiologyRoomOpenOrCreateInput,
  type BiologyRoomOpenOrCreateResult,
  type BiologyRoomRefreshInput,
  type BiologyRoomSelection,
  type BiologyRoomSummary,
  type BiologyRoomTarget,
  type BiologyRoomTrackReferenceCompatibility
} from '../../shared/biology-room'
import {
  canonicalPath,
  ensureSafeWorkspaceDirectory,
  expandHomePath,
  pathExists,
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  writeSafeWorkspaceFile
} from './workspace-paths'

const BIOLOGY_ROOMS_DIRECTORY = '.sciforge/biology/rooms'
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_EVENT_LOG_BYTES = 32 * 1024 * 1024
const MAX_INDEX_TEXT_BYTES = 16 * 1024 * 1024
const MAX_INDEX_BINARY_BYTES = 64 * 1024 * 1024
const MAX_TRANSACTION_JOURNAL_BYTES = 96 * 1024 * 1024
const MAX_CONTIG_EXAMPLES_IN_WARNING = 5
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const ROOM_LOCK_WAIT_MS = 15_000
const ROOM_LOCK_STALE_MS = 5 * 60_000

type ParsedAssetInput = ReturnType<typeof biologyRoomAssetInputSchema.parse>

type PreparedAssetInput = ParsedAssetInput & {
  id: string
  format: BiologyRoomFormat
  referenceAssetId?: string
  asReference: boolean
}

type PreparedAssets = {
  assets: BiologyRoomAsset[]
  updatedExistingAssets: BiologyRoomAsset[]
  warnings: string[]
}

export type BiologyRoomPersistenceFaultPoint =
  | 'afterJournal'
  | 'afterRevision'
  | 'afterEventLog'
  | 'beforeCanonicalManifest'

export type BiologyRoomServiceOptions = {
  /** Test seam for deterministic storage-failure and recovery coverage. */
  persistenceFaultInjector?: (point: BiologyRoomPersistenceFaultPoint) => Promise<void> | void
  /** Test seam for exercising the on-disk read-size invariant without huge fixtures. */
  maxManifestBytes?: number
}

type BiologyRoomTransactionJournal = {
  schemaVersion: 1
  transactionId: string
  roomId: string
  previousRevision: number
  nextRevision: number
  previousEventsExisted: boolean
  previousEventsText: string
  manifest: BiologyRoomManifest
  event: BiologyRoomEvent
  createdAt: string
}

export class BiologyRoomConflictError extends Error {
  readonly code = 'biology_room_revision_conflict'

  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number
  ) {
    super(`Biology Room revision conflict: expected ${expectedRevision}, current ${currentRevision}.`)
    this.name = 'BiologyRoomConflictError'
  }
}

export class BiologyRoomNotFoundError extends Error {
  readonly code = 'biology_room_not_found'

  constructor(readonly roomId: string) {
    super(`Biology Room not found: ${roomId}`)
    this.name = 'BiologyRoomNotFoundError'
  }
}

export class BiologyRoomService {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly options: BiologyRoomServiceOptions = {}) {}

  async create(input: BiologyRoomCreateInput): Promise<BiologyRoomManifest> {
    const parsed = biologyRoomCreateInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    const roomId = parsed.roomId ?? `biology-${Date.now()}-${randomUUID().slice(0, 12)}`
    return this.enqueue(`${workspaceRoot}:room:${roomId}`, () => withRoomFileLock(workspaceRoot, roomId, async () => {
      await recoverRoomTransaction(workspaceRoot, roomId)
      if (await roomExists(workspaceRoot, roomId)) {
        throw new Error(`Biology Room already exists: ${roomId}`)
      }

      const now = new Date().toISOString()
      const prepared = await prepareAssets(workspaceRoot, parsed.assets, [], now)
      const manifest = biologyRoomManifestSchema.parse({
        schemaVersion: BIOLOGY_ROOM_SCHEMA_VERSION,
        roomId,
        title: parsed.title,
        revision: 1,
        assets: prepared.assets,
        ...(prepared.assets[0] ? { activeAssetId: prepared.assets[0].id } : {}),
        viewerStates: {},
        annotations: [],
        createdAt: now,
        updatedAt: now
      })
      assertManifestInvariants(manifest)

      const event: BiologyRoomEvent = {
        eventId: `event-${randomUUID()}`,
        roomId,
        fromRevision: 0,
        toRevision: 1,
        actor: parsed.actor ?? { kind: 'system' },
        operations: [{
          type: 'create',
          title: parsed.title,
          assets: prepared.assets.map(assetToAuditInput)
        }],
        timestamp: now
      }
      await persistRoom(workspaceRoot, manifest, event, this.options)
      return cloneManifest(manifest)
    }))
  }

  async openOrCreate(input: BiologyRoomOpenOrCreateInput): Promise<BiologyRoomOpenOrCreateResult> {
    const parsed = biologyRoomOpenOrCreateInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    const source = await resolveSourceFile(workspaceRoot, parsed.path)

    return this.enqueue(`${workspaceRoot}:open:${source.relativePath}`, async () => {
      if (parsed.expectedSha256) {
        const fingerprint = await fingerprintFile(source.absolutePath)
        if (fingerprint.sha256 !== parsed.expectedSha256) {
          throw new Error(`Biology Room integrity mismatch for ${source.relativePath}.`)
        }
      }
      const manifests = await listManifests(workspaceRoot)
      const existing = manifests.find((manifest) =>
        manifest.assets.some((asset) => asset.path === source.relativePath)
      )
      if (existing) return { created: false, manifest: cloneManifest(existing) }

      const pathDigest = createHash('sha256').update(source.relativePath).digest('hex').slice(0, 12)
      const stem = basename(source.relativePath)
        .replace(/\.[^.]+(?:\.gz)?$/i, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 60) || 'asset'
      const baseRoomId = `biology-${stem}-${pathDigest}`
      let roomId = baseRoomId
      let suffix = 2
      while (await roomExists(workspaceRoot, roomId)) {
        const occupied = await loadRoomUnlocked(workspaceRoot, roomId).catch(() => null)
        if (occupied?.assets.some((asset) => asset.path === source.relativePath)) {
          return { created: false, manifest: cloneManifest(occupied) }
        }
        roomId = `${baseRoomId}-${suffix}`
        suffix += 1
      }

      const manifest = await this.create({
        workspaceRoot,
        roomId,
        title: parsed.title ?? `Biology: ${basename(source.relativePath)}`,
        assets: [{
          path: source.relativePath,
          ...(parsed.format ? { format: parsed.format } : {}),
          ...(parsed.expectedSha256 ? { expectedSha256: parsed.expectedSha256 } : {}),
          ...(parsed.asReference !== undefined ? { asReference: parsed.asReference } : {}),
          indexPaths: parsed.indexPaths,
          ...(parsed.referenceAssetId ? { referenceAssetId: parsed.referenceAssetId } : {})
        }],
        ...(parsed.actor ? { actor: parsed.actor } : {})
      })
      return { created: true, manifest }
    })
  }

  async load(input: BiologyRoomTarget): Promise<BiologyRoomManifest> {
    const parsed = biologyRoomTargetSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    return this.enqueue(`${workspaceRoot}:room:${parsed.roomId}`, () =>
      withRoomFileLock(workspaceRoot, parsed.roomId, async () => {
        await recoverRoomTransaction(workspaceRoot, parsed.roomId)
        return cloneManifest(await loadRoomUnlocked(workspaceRoot, parsed.roomId))
      })
    )
  }

  async list(input: BiologyRoomListInput): Promise<BiologyRoomSummary[]> {
    const parsed = biologyRoomListInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    const manifests = await listManifests(workspaceRoot)
    return manifests
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.roomId.localeCompare(b.roomId))
      .slice(0, parsed.limit)
      .map((manifest) => ({
        roomId: manifest.roomId,
        title: manifest.title,
        revision: manifest.revision,
        assetCount: manifest.assets.length,
        annotationCount: manifest.annotations.length,
        ...(manifest.activeAssetId ? { activeAssetId: manifest.activeAssetId } : {}),
        updatedAt: manifest.updatedAt
      }))
  }

  async observe(input: BiologyRoomObserveInput): Promise<BiologyRoomObserveResult> {
    const parsed = biologyRoomObserveInputSchema.parse(input)
    const manifest = await this.load({ workspaceRoot: parsed.workspaceRoot, roomId: parsed.roomId })
    let contigsTruncated = false
    const assets = manifest.assets.slice(0, parsed.assetLimit).map((asset) => {
      if (!asset.contigs || asset.contigs.length <= parsed.contigLimit) return asset
      contigsTruncated = true
      return {
        ...asset,
        contigs: asset.contigs.slice(0, parsed.contigLimit),
        contigsTruncated: true
      }
    })
    const trackVisibility = manifest.viewerStates.genome?.trackVisibility ?? {}
    const visibleTrackIds = manifest.assets
      .filter((asset) => isTrack(asset) && asset.referenceAssetId && trackVisibility[asset.id] !== false)
      .map((asset) => asset.id)

    return {
      schemaVersion: BIOLOGY_ROOM_SCHEMA_VERSION,
      roomId: manifest.roomId,
      title: manifest.title,
      revision: manifest.revision,
      ...(manifest.activeAssetId ? { activeAssetId: manifest.activeAssetId } : {}),
      ...(manifest.selection ? { selection: manifest.selection } : {}),
      viewerStates: manifest.viewerStates,
      assets,
      annotations: manifest.annotations.slice(0, parsed.annotationLimit),
      visibleTrackIds,
      truncated: {
        assets: manifest.assets.length > parsed.assetLimit,
        annotations: manifest.annotations.length > parsed.annotationLimit,
        contigs: contigsTruncated
      },
      updatedAt: manifest.updatedAt
    }
  }

  async refresh(input: BiologyRoomRefreshInput): Promise<BiologyRoomApplyResult> {
    const parsed = biologyRoomRefreshInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    return this.enqueue(`${workspaceRoot}:room:${parsed.roomId}`, () => withRoomFileLock(workspaceRoot, parsed.roomId, async () => {
      await recoverRoomTransaction(workspaceRoot, parsed.roomId)
      const current = await loadRoomUnlocked(workspaceRoot, parsed.roomId)
      const now = new Date().toISOString()
      const reconciliation = await reconcileManifestSources(workspaceRoot, current, now)
      const next = reconciliation.manifest
      const warnings = reconciliation.warnings
      const changedAssetIds = reconciliation.changedAssetIds
      const orphanedAnnotationIds = reconciliation.orphanedAnnotationIds

      assertManifestInvariants(next)
      const changed = !sameRoomState(current, next)
      const revision = changed ? current.revision + 1 : current.revision
      if (changed) {
        next.revision = revision
        next.updatedAt = now
        const manifest = biologyRoomManifestSchema.parse(next)
        const event: BiologyRoomEvent = {
          eventId: `event-${randomUUID()}`,
          roomId: current.roomId,
          fromRevision: current.revision,
          toRevision: revision,
          actor: parsed.actor ?? { kind: 'system' },
          operations: [{ type: 'refreshAssets', assetIds: changedAssetIds, orphanedAnnotationIds }],
          timestamp: now
        }
        await persistRoom(workspaceRoot, manifest, event, this.options)
      }
      const manifest = biologyRoomManifestSchema.parse(next)
      return {
        dryRun: false,
        changed,
        previousRevision: current.revision,
        revision,
        manifest: cloneManifest(manifest),
        warnings
      }
    }))
  }

  async history(input: BiologyRoomHistoryInput): Promise<BiologyRoomHistoryResult> {
    const parsed = biologyRoomHistoryInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    return this.enqueue(`${workspaceRoot}:room:${parsed.roomId}`, () =>
      withRoomFileLock(workspaceRoot, parsed.roomId, async () => {
        await recoverRoomTransaction(workspaceRoot, parsed.roomId)
        const current = await loadRoomUnlocked(workspaceRoot, parsed.roomId)
        const events = await readRoomEvents(workspaceRoot, parsed.roomId)
        const eventByRevision = new Map(events.map((event) => [event.toRevision, event]))
        const upperBound = Math.min(parsed.beforeRevision ? parsed.beforeRevision - 1 : current.revision, current.revision)
        const entries: BiologyRoomHistoryResult['entries'] = []
        for (let revision = upperBound; revision >= 1 && entries.length < parsed.limit; revision -= 1) {
          const snapshot = await loadRevision(workspaceRoot, parsed.roomId, revision).catch(() => null)
          if (!snapshot) continue
          const event = eventByRevision.get(revision)
          entries.push({
            revision,
            updatedAt: snapshot.updatedAt,
            ...(event ? { event } : {})
          })
        }
        const oldestIncluded = entries.at(-1)?.revision ?? upperBound + 1
        return {
          roomId: current.roomId,
          currentRevision: current.revision,
          entries,
          truncated: oldestIncluded > 1
        }
      })
    )
  }

  async apply(input: BiologyRoomApplyInput): Promise<BiologyRoomApplyResult> {
    const parsed = biologyRoomApplyInputSchema.parse(input)
    const workspaceRoot = await resolveWorkspaceRoot(parsed.workspaceRoot)
    return this.enqueue(`${workspaceRoot}:room:${parsed.roomId}`, () => withRoomFileLock(workspaceRoot, parsed.roomId, async () => {
      await recoverRoomTransaction(workspaceRoot, parsed.roomId)
      const current = await loadRoomUnlocked(workspaceRoot, parsed.roomId)
      if (current.revision !== parsed.baseRevision) {
        throw new BiologyRoomConflictError(parsed.baseRevision, current.revision)
      }
      if (parsed.operations.some((operation) => operation.type === 'restoreRevision') && parsed.operations.length !== 1) {
        throw new Error('restoreRevision must be the only operation in an apply request.')
      }

      const warnings: string[] = []
      const effectiveOperations: BiologyRoomEvent['operations'] = []
      let next = cloneManifest(current)
      for (const operation of parsed.operations) {
        if (operation.type === 'restoreRevision') {
          next = await restoreRevision(workspaceRoot, current, operation.revision, warnings)
        } else {
          next = await applyOperation(workspaceRoot, next, operation, parsed.actor, warnings)
        }
        effectiveOperations.push(effectiveOperationForAudit(operation, next))
      }
      assertManifestInvariants(next)

      const changed = !sameRoomState(current, next)
      const nextRevision = changed ? current.revision + 1 : current.revision
      if (changed) {
        next.revision = nextRevision
        next.updatedAt = new Date().toISOString()
      }
      const manifest = biologyRoomManifestSchema.parse(next)

      if (changed && !parsed.dryRun) {
        const event: BiologyRoomEvent = {
          eventId: `event-${randomUUID()}`,
          roomId: current.roomId,
          fromRevision: current.revision,
          toRevision: nextRevision,
          actor: parsed.actor ?? { kind: 'system' },
          operations: effectiveOperations,
          timestamp: manifest.updatedAt
        }
        await persistRoom(workspaceRoot, manifest, event, this.options)
      }

      return {
        dryRun: parsed.dryRun,
        changed,
        previousRevision: current.revision,
        revision: nextRevision,
        manifest: cloneManifest(manifest),
        warnings
      }
    }))
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.then(() => undefined, () => undefined)
    this.queues.set(key, tail)
    return run.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
  }
}

async function resolveWorkspaceRoot(raw: string): Promise<string> {
  const root = await canonicalPath(resolve(expandHomePath(raw.trim())))
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('Biology Room workspace root must be a directory.')
  return root
}

function roomDirectoryRelative(roomId: string): string {
  return `${BIOLOGY_ROOMS_DIRECTORY}/${roomId}`
}

function roomManifestRelative(roomId: string): string {
  return `${roomDirectoryRelative(roomId)}/room.json`
}

function roomRevisionRelative(roomId: string, revision: number): string {
  return `${roomDirectoryRelative(roomId)}/revisions/${revision}.json`
}

function roomEventsRelative(roomId: string): string {
  return `${roomDirectoryRelative(roomId)}/events.ndjson`
}

function roomTransactionRelative(roomId: string): string {
  return `${roomDirectoryRelative(roomId)}/transaction.json`
}

function roomLockRelative(roomId: string): string {
  return `${roomDirectoryRelative(roomId)}/.write.lock`
}

async function withRoomFileLock<T>(
  workspaceRoot: string,
  roomId: string,
  task: () => Promise<T>
): Promise<T> {
  await ensureSafeWorkspaceDirectory(roomDirectoryRelative(roomId), workspaceRoot)
  const target = await resolveSafeWorkspaceWriteTarget(roomLockRelative(roomId), workspaceRoot, {
    createParentDirectories: false
  })
  const token = randomUUID()
  const deadline = Date.now() + ROOM_LOCK_WAIT_MS
  let handle: Awaited<ReturnType<typeof open>> | null = null

  while (!handle) {
    try {
      const candidate = await open(
        target.path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600
      )
      try {
        await candidate.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), 'utf8')
        handle = candidate
      } catch (error) {
        await candidate.close().catch(() => undefined)
        await rm(target.path, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (!isErrnoCode(error, 'EEXIST')) throw error
      if (await reapAbandonedRoomLock(target.path)) continue
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the Biology Room write lock: ${roomId}`)
      }
      await waitForRoomLock(25 + Math.floor(Math.random() * 50))
    }
  }

  try {
    return await task()
  } finally {
    await handle.close().catch(() => undefined)
    await removeOwnedRoomLock(target.path, token)
  }
}

async function reapAbandonedRoomLock(path: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch (error) {
    return isErrnoCode(error, 'ENOENT')
  }
  const record = await readRoomLockRecord(path)
  const pid = typeof record?.pid === 'number' && Number.isInteger(record.pid) ? record.pid : null
  const oldEnough = Date.now() - info.mtimeMs > ROOM_LOCK_STALE_MS
  if ((pid !== null && processIsAlive(pid)) || (pid === null && !oldEnough)) return false
  await rm(path, { force: true })
  return true
}

async function readRoomLockRecord(path: string): Promise<Record<string, unknown> | null> {
  try {
    const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
    try {
      const parsed = JSON.parse(await handle.readFile('utf8')) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isErrnoCode(error, 'EPERM')
  }
}

async function removeOwnedRoomLock(path: string, token: string): Promise<void> {
  const record = await readRoomLockRecord(path)
  if (record?.token === token) await rm(path, { force: true })
}

function waitForRoomLock(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    String((error as { code?: unknown }).code) === code
}

async function roomExists(workspaceRoot: string, roomId: string): Promise<boolean> {
  const candidate = join(workspaceRoot, roomManifestRelative(roomId))
  if (!(await pathExists(candidate))) return false
  await resolveOpenTargetPath(roomManifestRelative(roomId), workspaceRoot, { allowBasenameFallback: false })
  return true
}

async function loadRoomUnlocked(workspaceRoot: string, roomId: string): Promise<BiologyRoomManifest> {
  let path: string
  try {
    path = await resolveOpenTargetPath(roomManifestRelative(roomId), workspaceRoot, {
      allowBasenameFallback: false
    })
  } catch (error) {
    if (!(await pathExists(join(workspaceRoot, roomManifestRelative(roomId))))) {
      throw new BiologyRoomNotFoundError(roomId)
    }
    throw error
  }
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Biology Room manifest must be a regular file.')
  if (info.size > MAX_MANIFEST_BYTES) throw new Error('Biology Room manifest is too large.')
  return biologyRoomManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

async function loadRevision(
  workspaceRoot: string,
  roomId: string,
  revision: number
): Promise<BiologyRoomManifest> {
  let path: string
  try {
    path = await resolveOpenTargetPath(roomRevisionRelative(roomId, revision), workspaceRoot, {
      allowBasenameFallback: false
    })
  } catch {
    throw new Error(`Biology Room revision not found: ${revision}`)
  }
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Biology Room revision is invalid: ${revision}`)
  }
  return biologyRoomManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

async function listManifests(workspaceRoot: string): Promise<BiologyRoomManifest[]> {
  const rawDirectory = join(workspaceRoot, BIOLOGY_ROOMS_DIRECTORY)
  if (!(await pathExists(rawDirectory))) return []
  const directory = await resolveOpenTargetPath(BIOLOGY_ROOMS_DIRECTORY, workspaceRoot, {
    allowBasenameFallback: false
  })
  const entries = await readdir(directory, { withFileTypes: true })
  const manifests: BiologyRoomManifest[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) continue
    const manifest = await loadRoomUnlocked(workspaceRoot, entry.name).catch(() => null)
    if (manifest) manifests.push(manifest)
  }
  return manifests
}

async function readRoomEvents(workspaceRoot: string, roomId: string): Promise<BiologyRoomEvent[]> {
  const rawPath = join(workspaceRoot, roomEventsRelative(roomId))
  if (!(await pathExists(rawPath))) return []
  const path = await resolveOpenTargetPath(roomEventsRelative(roomId), workspaceRoot, {
    allowBasenameFallback: false
  })
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Biology Room event log must be a regular file.')
  if (info.size > MAX_EVENT_LOG_BYTES) throw new Error('Biology Room event log is too large.')
  const events: BiologyRoomEvent[] = []
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = biologyRoomEventSchema.safeParse(JSON.parse(line) as unknown)
      if (parsed.success) events.push(parsed.data)
    } catch {
      // A malformed audit line must not hide otherwise valid revision history.
    }
  }
  return events
}

async function persistRoom(
  workspaceRoot: string,
  manifest: BiologyRoomManifest,
  event: BiologyRoomEvent,
  options: BiologyRoomServiceOptions = {}
): Promise<void> {
  const maxManifestBytes = options.maxManifestBytes ?? MAX_MANIFEST_BYTES
  const serializedManifestBytes = Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  if (serializedManifestBytes > maxManifestBytes) {
    throw new Error(
      `Biology Room manifest would exceed the readable limit of ${maxManifestBytes} bytes.`
    )
  }
  await ensureSafeWorkspaceDirectory(roomDirectoryRelative(manifest.roomId), workspaceRoot)
  await ensureSafeWorkspaceDirectory(`${roomDirectoryRelative(manifest.roomId)}/revisions`, workspaceRoot)
  const previousEvents = await readRoomEventLogText(workspaceRoot, manifest.roomId)
  const journal: BiologyRoomTransactionJournal = {
    schemaVersion: 1,
    transactionId: randomUUID(),
    roomId: manifest.roomId,
    previousRevision: event.fromRevision,
    nextRevision: event.toRevision,
    previousEventsExisted: previousEvents.existed,
    previousEventsText: previousEvents.text,
    manifest,
    event,
    createdAt: new Date().toISOString()
  }
  const eventPrefix = previousEvents.text && !previousEvents.text.endsWith('\n')
    ? `${previousEvents.text}\n`
    : previousEvents.text
  const nextEventsText = `${eventPrefix}${JSON.stringify(event)}\n`
  if (Buffer.byteLength(nextEventsText, 'utf8') > MAX_EVENT_LOG_BYTES) {
    throw new Error('Biology Room event log is too large.')
  }
  if (Buffer.byteLength(`${JSON.stringify(journal, null, 2)}\n`, 'utf8') > MAX_TRANSACTION_JOURNAL_BYTES) {
    throw new Error('Biology Room transaction journal would be too large to recover safely.')
  }

  await atomicWriteWorkspaceJson(roomTransactionRelative(manifest.roomId), workspaceRoot, journal)
  await options.persistenceFaultInjector?.('afterJournal')
  await atomicWriteWorkspaceJson(
    roomRevisionRelative(manifest.roomId, manifest.revision),
    workspaceRoot,
    manifest,
    { exclusive: true }
  )
  await options.persistenceFaultInjector?.('afterRevision')
  await atomicWriteWorkspaceText(roomEventsRelative(manifest.roomId), workspaceRoot, nextEventsText)
  await options.persistenceFaultInjector?.('afterEventLog')
  await options.persistenceFaultInjector?.('beforeCanonicalManifest')
  // The canonical manifest is the commit marker and must always be written last.
  await atomicWriteWorkspaceJson(roomManifestRelative(manifest.roomId), workspaceRoot, manifest)
  // Failure to remove a committed journal is recoverable and must not turn a
  // successful commit into an error response.
  await removeWorkspaceFile(roomTransactionRelative(manifest.roomId), workspaceRoot).catch(() => undefined)
}

async function recoverRoomTransaction(workspaceRoot: string, roomId: string): Promise<void> {
  const journalPath = join(workspaceRoot, roomTransactionRelative(roomId))
  if (!(await pathExists(journalPath))) return
  const resolved = await resolveOpenTargetPath(roomTransactionRelative(roomId), workspaceRoot, {
    allowBasenameFallback: false
  })
  const info = await stat(resolved)
  if (!info.isFile() || info.size > MAX_TRANSACTION_JOURNAL_BYTES) {
    throw new Error(`Biology Room transaction journal is invalid: ${roomId}`)
  }
  const journal = parseRoomTransactionJournal(JSON.parse(await readFile(resolved, 'utf8')) as unknown, roomId)
  const canonical = await loadRoomUnlocked(workspaceRoot, roomId).catch((error) =>
    error instanceof BiologyRoomNotFoundError ? null : Promise.reject(error)
  )

  if (canonical && canonical.revision >= journal.nextRevision) {
    if (canonical.revision === journal.nextRevision) {
      const revisionPath = join(workspaceRoot, roomRevisionRelative(roomId, journal.nextRevision))
      if (!(await pathExists(revisionPath))) {
        await atomicWriteWorkspaceJson(
          roomRevisionRelative(roomId, journal.nextRevision),
          workspaceRoot,
          journal.manifest,
          { exclusive: true }
        )
      }
      const prefix = journal.previousEventsText && !journal.previousEventsText.endsWith('\n')
        ? `${journal.previousEventsText}\n`
        : journal.previousEventsText
      await atomicWriteWorkspaceText(
        roomEventsRelative(roomId),
        workspaceRoot,
        `${prefix}${JSON.stringify(journal.event)}\n`
      )
    }
    await removeWorkspaceFile(roomTransactionRelative(roomId), workspaceRoot)
    return
  }

  if (canonical && canonical.revision !== journal.previousRevision) {
    throw new Error(
      `Biology Room transaction cannot be recovered: expected revision ${journal.previousRevision}, current ${canonical.revision}.`
    )
  }

  if (journal.previousEventsExisted) {
    await atomicWriteWorkspaceText(roomEventsRelative(roomId), workspaceRoot, journal.previousEventsText)
  } else {
    await removeWorkspaceFile(roomEventsRelative(roomId), workspaceRoot).catch(() => undefined)
  }
  await removeWorkspaceFile(roomRevisionRelative(roomId, journal.nextRevision), workspaceRoot).catch(() => undefined)
  await removeWorkspaceFile(roomTransactionRelative(roomId), workspaceRoot)
}

function parseRoomTransactionJournal(value: unknown, expectedRoomId: string): BiologyRoomTransactionJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Biology Room transaction journal is invalid: ${expectedRoomId}`)
  }
  const raw = value as Record<string, unknown>
  const manifest = biologyRoomManifestSchema.parse(raw.manifest)
  const event = biologyRoomEventSchema.parse(raw.event)
  if (
    raw.schemaVersion !== 1 ||
    raw.roomId !== expectedRoomId ||
    manifest.roomId !== expectedRoomId ||
    event.roomId !== expectedRoomId ||
    raw.transactionId === undefined ||
    typeof raw.transactionId !== 'string' ||
    typeof raw.previousEventsText !== 'string' ||
    typeof raw.previousEventsExisted !== 'boolean' ||
    raw.previousRevision !== event.fromRevision ||
    raw.nextRevision !== event.toRevision ||
    manifest.revision !== event.toRevision
  ) {
    throw new Error(`Biology Room transaction journal is invalid: ${expectedRoomId}`)
  }
  return {
    schemaVersion: 1,
    transactionId: raw.transactionId,
    roomId: expectedRoomId,
    previousRevision: event.fromRevision,
    nextRevision: event.toRevision,
    previousEventsExisted: raw.previousEventsExisted,
    previousEventsText: raw.previousEventsText,
    manifest,
    event,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : event.timestamp
  }
}

async function readRoomEventLogText(
  workspaceRoot: string,
  roomId: string
): Promise<{ existed: boolean; text: string }> {
  const rawPath = join(workspaceRoot, roomEventsRelative(roomId))
  if (!(await pathExists(rawPath))) return { existed: false, text: '' }
  const resolved = await resolveOpenTargetPath(roomEventsRelative(roomId), workspaceRoot, {
    allowBasenameFallback: false
  })
  const info = await stat(resolved)
  if (!info.isFile() || info.size > MAX_EVENT_LOG_BYTES) throw new Error('Biology Room event log is too large.')
  return { existed: true, text: await readFile(resolved, 'utf8') }
}

async function atomicWriteWorkspaceJson(
  relativePath: string,
  workspaceRoot: string,
  value: unknown,
  options: { exclusive?: boolean } = {}
): Promise<void> {
  return atomicWriteWorkspaceText(relativePath, workspaceRoot, `${JSON.stringify(value, null, 2)}\n`, options)
}

async function atomicWriteWorkspaceText(
  relativePath: string,
  workspaceRoot: string,
  content: string,
  options: { exclusive?: boolean } = {}
): Promise<void> {
  const target = await resolveSafeWorkspaceWriteTarget(relativePath, workspaceRoot, {
    createParentDirectories: true
  })
  const temporary = await resolveSafeWorkspaceWriteTarget(
    join(target.parentPath, `.${basename(target.path)}.${process.pid}.${randomUUID()}.tmp`),
    workspaceRoot,
    { createParentDirectories: false }
  )
  try {
    await writeSafeWorkspaceFile(temporary, content, {
      encoding: 'utf8',
      exclusive: true
    })
    await resolveSafeWorkspaceWriteTarget(target.path, workspaceRoot, {
      createParentDirectories: false
    })
    if (options.exclusive) {
      await link(temporary.path, target.path)
      await rm(temporary.path, { force: true })
    } else {
      await rename(temporary.path, target.path)
    }
  } catch (error) {
    await rm(temporary.path, { force: true }).catch(() => undefined)
    throw error
  }
}

async function removeWorkspaceFile(relativePath: string, workspaceRoot: string): Promise<void> {
  const target = await resolveSafeWorkspaceWriteTarget(relativePath, workspaceRoot, {
    createParentDirectories: false
  })
  await rm(target.path, { force: true })
}

async function resolveSourceFile(
  workspaceRoot: string,
  rawPath: string
): Promise<{ absolutePath: string; relativePath: string }> {
  const normalized = normalizeBiologyRoomRelativePath(rawPath)
  const absolutePath = await resolveOpenTargetPath(normalized, workspaceRoot, {
    allowBasenameFallback: false
  })
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error(`Biology Room source must be a regular file: ${normalized}`)
  const relativePath = normalizeBiologyRoomRelativePath(relative(workspaceRoot, absolutePath))
  if (relativePath.startsWith('.sciforge/biology/')) {
    throw new Error('Biology Room source files cannot be room metadata or cache files.')
  }
  return { absolutePath, relativePath }
}

async function prepareAssets(
  workspaceRoot: string,
  rawInputs: readonly BiologyRoomAssetInput[],
  existingAssets: readonly BiologyRoomAsset[],
  now: string
): Promise<PreparedAssets> {
  if (existingAssets.length + rawInputs.length > BIOLOGY_ROOM_MAX_ASSETS) {
    throw new Error(`A Biology Room may contain at most ${BIOLOGY_ROOM_MAX_ASSETS} assets.`)
  }
  const parsedInputs = rawInputs.map((input) => biologyRoomAssetInputSchema.parse(input))
  const occupiedIds = new Set(existingAssets.map((asset) => asset.id))
  const occupiedPaths = new Set(existingAssets.map((asset) => asset.path))
  const definitions: PreparedAssetInput[] = []

  for (const input of parsedInputs) {
    const format = input.format ?? biologyRoomFormatFromPath(input.path)
    const detected = biologyRoomFormatFromPath(input.path)
    if (!format || !detected) throw new Error(`Unsupported Biology Room format: ${input.path}`)
    if (format !== detected) {
      throw new Error(`Declared format ${format} does not match the file extension for ${input.path}.`)
    }
    if (input.path.toLowerCase().endsWith('.gz') && !['fasta', 'gff3', 'bed', 'vcf'].includes(format)) {
      throw new Error(`Compressed ${format} files are not supported in Biology Room.`)
    }
    const id = input.id ?? uniqueAssetId(input.path, occupiedIds)
    if (occupiedIds.has(id)) throw new Error(`Biology Room asset ID already exists: ${id}`)
    occupiedIds.add(id)
    definitions.push({
      ...input,
      id,
      format,
      asReference: input.asReference === true
    })
  }

  const allFasta = [
    ...existingAssets.filter((asset) => asset.format === 'fasta').map((asset) => ({
      id: asset.id,
      explicit: asset.modality === 'genome-reference'
    })),
    ...definitions.filter((definition) => definition.format === 'fasta').map((definition) => ({
      id: definition.id,
      explicit: definition.asReference
    }))
  ]
  const knownFormats = new Map<string, BiologyRoomFormat>([
    ...existingAssets.map((asset) => [asset.id, asset.format] as const),
    ...definitions.map((definition) => [definition.id, definition.format] as const)
  ])
  const promoteReferenceIds = new Set<string>()
  const linkExistingTracks = new Map<string, string>()

  const implicitReference = (): string | undefined => {
    const explicit = allFasta.filter((candidate) => candidate.explicit)
    if (explicit.length === 1) return explicit[0]!.id
    if (allFasta.length === 1) return allFasta[0]!.id
    return undefined
  }

  for (const definition of definitions) {
    if (!isTrackFormat(definition.format)) continue
    let referenceAssetId = definition.referenceAssetId
    if (!referenceAssetId) {
      referenceAssetId = implicitReference()
    }
    if (referenceAssetId && knownFormats.get(referenceAssetId) !== 'fasta') {
      throw new Error(`Genome track reference must identify a FASTA asset: ${referenceAssetId}`)
    }
    if (referenceAssetId) {
      definition.referenceAssetId = referenceAssetId
      promoteReferenceIds.add(referenceAssetId)
    }
  }

  const referenceForUnlinkedTracks = implicitReference()
  if (referenceForUnlinkedTracks) {
    for (const track of existingAssets.filter((asset) => isTrack(asset) && !asset.referenceAssetId)) {
      linkExistingTracks.set(track.id, referenceForUnlinkedTracks)
      promoteReferenceIds.add(referenceForUnlinkedTracks)
    }
  }

  for (const definition of definitions) {
    if (definition.format === 'fasta' && definition.asReference) promoteReferenceIds.add(definition.id)
  }

  const assets: BiologyRoomAsset[] = []
  for (const definition of definitions) {
    const asset = await materializeAsset(
      workspaceRoot,
      definition,
      now,
      promoteReferenceIds.has(definition.id)
    )
    if (occupiedPaths.has(asset.path)) throw new Error(`Biology Room asset already exists: ${asset.path}`)
    occupiedPaths.add(asset.path)
    assets.push(asset)
  }

  const combined = [
    ...existingAssets.map((asset) => ({
      ...asset,
      ...(promoteReferenceIds.has(asset.id) ? { modality: 'genome-reference' as const, updatedAt: now } : {}),
      ...(linkExistingTracks.has(asset.id) ? { referenceAssetId: linkExistingTracks.get(asset.id), updatedAt: now } : {})
    })),
    ...assets
  ]
  enforceTotalAssetSize(combined)
  const warnings = validateTrackContigs(combined, assets, { checkedAt: now })
  if (linkExistingTracks.size > 0) {
    warnings.push(...validateTrackContigs(
      combined,
      combined.filter((asset) => linkExistingTracks.has(asset.id)),
      { checkedAt: now }
    ))
  }
  return {
    assets,
    updatedExistingAssets: combined.slice(0, existingAssets.length),
    warnings
  }
}

function uniqueAssetId(path: string, occupied: Set<string>): string {
  const digest = createHash('sha256').update(path).digest('hex').slice(0, 12)
  const base = `asset-${digest}`
  let id = base
  let suffix = 2
  while (occupied.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

async function materializeAsset(
  workspaceRoot: string,
  definition: PreparedAssetInput,
  now: string,
  asReference: boolean
): Promise<BiologyRoomAsset> {
  const source = await resolveSourceFile(workspaceRoot, definition.path)
  const fingerprint = await fingerprintFile(source.absolutePath)
  if (definition.expectedSha256 && fingerprint.sha256 !== definition.expectedSha256) {
    throw new Error(`Biology Room integrity mismatch for ${source.relativePath}.`)
  }
  const requestedIndexPaths = definition.indexPaths.length > 0
    ? definition.indexPaths
    : await discoverAdjacentIndexPaths(workspaceRoot, source.relativePath, definition.format)
  const indexPaths: string[] = []
  const indexFingerprints: BiologyRoomIndexFingerprint[] = []
  for (const rawIndexPath of requestedIndexPaths) {
    const index = await resolveSourceFile(workspaceRoot, rawIndexPath)
    if (!indexPaths.includes(index.relativePath)) {
      indexPaths.push(index.relativePath)
      const indexFingerprint = await fingerprintFile(index.absolutePath)
      indexFingerprints.push({ path: index.relativePath, ...indexFingerprint })
    }
  }
  validateIndexCombination(source.relativePath, definition.format, indexPaths, fingerprint.sizeBytes)
  const indexContigs = await validateIndexFiles(workspaceRoot, indexPaths)
  const contigResult = await discoverContigs(
    workspaceRoot,
    source.absolutePath,
    source.relativePath,
    definition.format,
    indexPaths,
    indexContigs,
    fingerprint.sizeBytes
  )
  return {
    id: definition.id,
    path: source.relativePath,
    format: definition.format,
    modality: biologyRoomModalityForFormat(definition.format, { asReference }),
    sha256: fingerprint.sha256,
    sizeBytes: fingerprint.sizeBytes,
    mtimeMs: fingerprint.mtimeMs,
    indexPaths,
    indexFingerprints,
    readiness: 'ready',
    ...(definition.referenceAssetId ? { referenceAssetId: definition.referenceAssetId } : {}),
    ...(contigResult.contigs.length ? { contigs: contigResult.contigs } : {}),
    ...(contigResult.truncated ? { contigsTruncated: true } : {}),
    createdAt: now,
    updatedAt: now
  }
}

async function reconcileManifestSources(
  workspaceRoot: string,
  input: BiologyRoomManifest,
  now: string
): Promise<{
  manifest: BiologyRoomManifest
  warnings: string[]
  changedAssetIds: string[]
  orphanedAnnotationIds: string[]
}> {
  const manifest = cloneManifest(input)
  const warnings: string[] = []
  const changedAssetIds: string[] = []
  const sourceHashChangedIds = new Set<string>()

  for (let index = 0; index < manifest.assets.length; index += 1) {
    const asset = manifest.assets[index]!
    let reconciled: BiologyRoomAsset
    try {
      const refreshed = await materializeAsset(workspaceRoot, {
        id: asset.id,
        path: asset.path,
        format: asset.format,
        asReference: asset.modality === 'genome-reference',
        indexPaths: asset.indexPaths,
        ...(asset.referenceAssetId ? { referenceAssetId: asset.referenceAssetId } : {})
      }, now, asset.modality === 'genome-reference')
      reconciled = {
        ...refreshed,
        createdAt: asset.createdAt,
        ...(asset.referenceCompatibility ? { referenceCompatibility: asset.referenceCompatibility } : {})
      }
    } catch (error) {
      reconciled = await unavailableAssetState(workspaceRoot, asset, now, error)
      warnings.push(`${asset.path} could not be refreshed: ${reconciled.readinessError}`)
    }
    if (asset.sha256 !== reconciled.sha256) sourceHashChangedIds.add(asset.id)
    if (!sameAssetSource(asset, reconciled)) {
      manifest.assets[index] = reconciled
      changedAssetIds.push(asset.id)
    }
  }

  enforceTotalAssetSize(manifest.assets)
  const changedIds = new Set(changedAssetIds)
  const affectedTracks = manifest.assets.filter((asset) =>
    isTrack(asset) && (
      !asset.referenceCompatibility ||
      changedIds.has(asset.id) ||
      (asset.referenceAssetId ? changedIds.has(asset.referenceAssetId) : false)
    )
  )
  warnings.push(...validateTrackContigs(manifest.assets, affectedTracks, {
    rejectZeroMatches: false,
    checkedAt: now
  }))
  const previousAssetById = new Map(input.assets.map((asset) => [asset.id, asset]))
  for (const track of affectedTracks) {
    const previous = previousAssetById.get(track.id)
    if (previous && !sameAssetSource(previous, track) && !changedIds.has(track.id)) {
      changedIds.add(track.id)
      changedAssetIds.push(track.id)
    }
  }

  const unavailableAssetIds = new Set(
    manifest.assets.filter((asset) => asset.readiness && asset.readiness !== 'ready').map((asset) => asset.id)
  )
  if (manifest.selection) {
    try {
      if ([...unavailableAssetIds].some((assetId) => selectionUsesAsset(manifest.selection!, assetId))) {
        throw new Error('Selection source is unavailable.')
      }
      if (annotationNeedsConservativeOrphaning(manifest.selection, sourceHashChangedIds)) {
        throw new Error('Selection identity cannot be revalidated after its source changed.')
      }
      validateSelection(manifest, manifest.selection)
    } catch (error) {
      warnings.push(`Active selection was cleared after source refresh: ${error instanceof Error ? error.message : String(error)}`)
      delete manifest.selection
    }
  }

  const orphanedAnnotationIds: string[] = []
  manifest.annotations = manifest.annotations.map((annotation) => {
    try {
      if ([...unavailableAssetIds].some((assetId) => selectionUsesAsset(annotation.anchor, assetId))) {
        throw new Error('Annotation source is unavailable.')
      }
      if (annotationNeedsConservativeOrphaning(annotation.anchor, sourceHashChangedIds)) {
        throw new Error('Annotation identity cannot be revalidated after its source changed.')
      }
      validateSelection(manifest, annotation.anchor)
      return annotation.orphaned ? { ...annotation, orphaned: false, updatedAt: now } : annotation
    } catch {
      orphanedAnnotationIds.push(annotation.id)
      return annotation.orphaned ? annotation : { ...annotation, orphaned: true, updatedAt: now }
    }
  })
  assertManifestInvariants(manifest)
  return { manifest, warnings, changedAssetIds, orphanedAnnotationIds }
}

function annotationNeedsConservativeOrphaning(
  anchor: BiologyRoomSelection,
  sourceHashChangedIds: ReadonlySet<string>
): boolean {
  const changed = sourceHashChangedIds.has(anchor.assetId) ||
    (anchor.kind === 'genomic' && sourceHashChangedIds.has(anchor.referenceAssetId))
  if (!changed) return false
  if (anchor.kind === 'molecular') return true
  if (anchor.kind === 'genomic') return Boolean(anchor.featureId || anchor.variantId)
  return Boolean(anchor.featureIds?.length)
}

async function unavailableAssetState(
  workspaceRoot: string,
  asset: BiologyRoomAsset,
  now: string,
  error: unknown
): Promise<BiologyRoomAsset> {
  const sourceExists = await pathExists(join(workspaceRoot, asset.path))
  const readiness = sourceExists ? 'error' as const : 'missing' as const
  const message = (error instanceof Error ? error.message : String(error)).trim().slice(0, 2_000) ||
    'Biology Room source is unavailable.'
  let next: BiologyRoomAsset = {
    ...asset,
    readiness,
    readinessError: message,
    indexFingerprints: [],
    updatedAt: now
  }
  delete next.contigs
  delete next.contigsTruncated

  try {
    const source = await resolveSourceFile(workspaceRoot, asset.path)
    const fingerprint = await fingerprintFile(source.absolutePath)
    next = {
      ...next,
      path: source.relativePath,
      sha256: fingerprint.sha256,
      sizeBytes: fingerprint.sizeBytes,
      mtimeMs: fingerprint.mtimeMs
    }
  } catch {
    // The readiness state keeps historical fingerprint fields explicitly stale.
  }

  const requestedIndexes = asset.indexPaths.length
    ? asset.indexPaths
    : await discoverAdjacentIndexPaths(workspaceRoot, asset.path, asset.format).catch(() => [])
  const indexPaths: string[] = []
  const indexFingerprints: BiologyRoomIndexFingerprint[] = []
  for (const indexPath of requestedIndexes) {
    try {
      const resolved = await resolveSourceFile(workspaceRoot, indexPath)
      const fingerprint = await fingerprintFile(resolved.absolutePath)
      indexPaths.push(resolved.relativePath)
      indexFingerprints.push({ path: resolved.relativePath, ...fingerprint })
    } catch {
      indexPaths.push(indexPath)
    }
  }
  return { ...next, indexPaths, indexFingerprints }
}

async function discoverAdjacentIndexPaths(
  workspaceRoot: string,
  sourcePath: string,
  format: BiologyRoomFormat
): Promise<string[]> {
  const compressed = sourcePath.toLowerCase().endsWith('.gz')
  const extensions = format === 'fasta'
    ? ['.fai', ...(compressed ? ['.gzi'] : [])]
    : isTrackFormat(format) && compressed
      ? ['.tbi', '.csi']
      : []
  const found: string[] = []
  for (const extension of extensions) {
    const candidate = `${sourcePath}${extension}`
    if (await pathExists(join(workspaceRoot, candidate))) {
      // Resolve here as well as in materializeAsset so a companion symlink cannot
      // make auto-discovery cross the workspace boundary.
      await resolveSourceFile(workspaceRoot, candidate)
      found.push(candidate)
    }
  }
  return found
}

async function fingerprintFile(path: string): Promise<{ sha256: string; sizeBytes: number; mtimeMs: number }> {
  const before = await stat(path)
  if (!before.isFile()) throw new Error('Biology Room asset must be a regular file.')
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  const after = await stat(path)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('Biology Room asset changed while it was being fingerprinted.')
  }
  return { sha256: hash.digest('hex'), sizeBytes: after.size, mtimeMs: after.mtimeMs }
}

function validateIndexCombination(
  sourcePath: string,
  format: BiologyRoomFormat,
  indexPaths: readonly string[],
  sizeBytes: number
): void {
  const lowerSource = sourcePath.toLowerCase()
  const compressed = lowerSource.endsWith('.gz')
  const extensions = new Set(indexPaths.map(indexExtension))
  const allowed = format === 'fasta'
    ? new Set(['.fai', ...(compressed ? ['.gzi'] : [])])
    : isTrackFormat(format) && compressed
      ? new Set(['.tbi', '.csi'])
      : new Set<string>()

  for (const indexPath of indexPaths) {
    const extension = indexExtension(indexPath)
    if (!allowed.has(extension)) {
      throw new Error(`Unsupported index ${indexPath} for ${sourcePath}.`)
    }
    if (indexPath.toLowerCase() !== `${lowerSource}${extension}`) {
      throw new Error(`Index must use the standard adjacent path ${sourcePath}${extension}.`)
    }
  }
  if (format === 'fasta' && compressed && !(extensions.has('.fai') && extensions.has('.gzi'))) {
    throw new Error('Indexed bgzip FASTA requires both .fai and .gzi files.')
  }
  if (isTrackFormat(format) && compressed && !(extensions.has('.tbi') || extensions.has('.csi'))) {
    throw new Error('Indexed compressed genome tracks require a .tbi or .csi file.')
  }

  if (sizeBytes <= BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES) return
  const sufficientlyIndexed = format === 'fasta'
    ? extensions.has('.fai') && (!compressed || extensions.has('.gzi'))
    : isTrackFormat(format) && compressed && (extensions.has('.tbi') || extensions.has('.csi'))
  if (!sufficientlyIndexed) {
    throw new Error(
      `Unindexed Biology Room assets may not exceed ${BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES} bytes.`
    )
  }
}

async function validateIndexFiles(
  workspaceRoot: string,
  indexPaths: readonly string[]
): Promise<Map<string, BiologyContig[]>> {
  const contigsByIndex = new Map<string, BiologyContig[]>()
  for (const indexPath of indexPaths) {
    const absolutePath = await resolveOpenTargetPath(indexPath, workspaceRoot, { allowBasenameFallback: false })
    const info = await stat(absolutePath)
    if (!info.isFile() || info.size > MAX_INDEX_BINARY_BYTES) {
      throw new Error(`Biology Room index is invalid or too large: ${indexPath}`)
    }
    const extension = indexExtension(indexPath)
    if (extension === '.fai') {
      validateFaiText(await readBoundedText(absolutePath, MAX_INDEX_TEXT_BYTES), indexPath)
      continue
    }
    const bytes = await readFile(absolutePath)
    if (extension === '.gzi') {
      if (bytes.length < 8) throw new Error(`Invalid GZI index: ${indexPath}`)
      const entries = bytes.readBigUInt64LE(0)
      if (entries > BigInt(Number.MAX_SAFE_INTEGER) || bytes.length !== 8 + Number(entries) * 16) {
        throw new Error(`Invalid GZI index: ${indexPath}`)
      }
      continue
    }
    const decodedBytes = decodeTabixIndex(bytes, indexPath)
    const expectedMagic = extension === '.tbi' ? 'TBI\u0001' : extension === '.csi' ? 'CSI\u0001' : ''
    const minimumBytes = extension === '.tbi' ? 36 : extension === '.csi' ? 16 : Number.POSITIVE_INFINITY
    if (
      !expectedMagic ||
      decodedBytes.length < minimumBytes ||
      decodedBytes.subarray(0, 4).toString('latin1') !== expectedMagic
    ) {
      throw new Error(`Invalid ${extension.slice(1).toUpperCase() || 'biology'} index: ${indexPath}`)
    }
    const contigs = extension === '.tbi'
      ? contigsFromTbi(decodedBytes, indexPath)
      : contigsFromCsi(decodedBytes, indexPath)
    if (contigs.length) contigsByIndex.set(indexPath, contigs)
  }
  return contigsByIndex
}

function decodeTabixIndex(bytes: Buffer, path: string): Buffer {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_INDEX_BINARY_BYTES })
  } catch {
    throw new Error(`Invalid compressed biology index: ${path}`)
  }
}

function validateFaiText(text: string, path: string): void {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) throw new Error(`Invalid FAI index: ${path}`)
  for (const line of lines) {
    const fields = line.split('\t')
    const length = Number(fields[1])
    const offset = Number(fields[2])
    const lineBases = Number(fields[3])
    const lineWidth = Number(fields[4])
    if (
      fields.length < 5 ||
      !fields[0]?.trim() ||
      !Number.isSafeInteger(length) || length < 0 ||
      !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(lineBases) || lineBases <= 0 ||
      !Number.isSafeInteger(lineWidth) || lineWidth < lineBases
    ) {
      throw new Error(`Invalid FAI index: ${path}`)
    }
  }
}

function contigsFromTbi(bytes: Buffer, path: string): BiologyContig[] {
  const referenceCount = nonNegativeInt32(bytes, 4, path)
  const namesLength = nonNegativeInt32(bytes, 32, path)
  assertBufferRange(bytes, 36, namesLength, path)
  if (namesLength > 0 && bytes[36 + namesLength - 1] !== 0) throw new Error(`Invalid TBI index: ${path}`)
  const names = nullTerminatedNames(bytes.subarray(36, 36 + namesLength))
  if (names.length !== referenceCount || new Set(names).size !== names.length) {
    throw new Error(`Invalid TBI index: ${path}`)
  }
  let offset = 36 + namesLength
  for (let referenceIndex = 0; referenceIndex < referenceCount; referenceIndex += 1) {
    const binCount = nonNegativeInt32(bytes, offset, path)
    offset += 4
    for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
      assertBufferRange(bytes, offset, 8, path)
      const chunkCount = nonNegativeInt32(bytes, offset + 4, path)
      offset += 8
      assertBufferRange(bytes, offset, chunkCount * 16, path)
      offset += chunkCount * 16
    }
    const intervalCount = nonNegativeInt32(bytes, offset, path)
    offset += 4
    assertBufferRange(bytes, offset, intervalCount * 8, path)
    offset += intervalCount * 8
  }
  if (offset !== bytes.length && offset + 8 !== bytes.length) throw new Error(`Invalid TBI index: ${path}`)
  return names.slice(0, referenceCount).map((name) => ({ name }))
}

function contigsFromCsi(bytes: Buffer, path: string): BiologyContig[] {
  nonNegativeInt32(bytes, 4, path)
  nonNegativeInt32(bytes, 8, path)
  const auxiliaryLength = nonNegativeInt32(bytes, 12, path)
  assertBufferRange(bytes, 16, auxiliaryLength + 4, path)
  const auxiliary = bytes.subarray(16, 16 + auxiliaryLength)
  let names: string[] = []
  if (auxiliary.length >= 28) {
    const namesLength = nonNegativeInt32(auxiliary, 24, path)
    assertBufferRange(auxiliary, 28, namesLength, path)
    if (namesLength > 0 && auxiliary[28 + namesLength - 1] !== 0) {
      throw new Error(`Invalid CSI index: ${path}`)
    }
    names = nullTerminatedNames(auxiliary.subarray(28, 28 + namesLength))
  }
  let offset = 16 + auxiliaryLength
  const referenceCount = nonNegativeInt32(bytes, offset, path)
  offset += 4
  for (let referenceIndex = 0; referenceIndex < referenceCount; referenceIndex += 1) {
    const binCount = nonNegativeInt32(bytes, offset, path)
    offset += 4
    for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
      assertBufferRange(bytes, offset, 16, path)
      const chunkCount = nonNegativeInt32(bytes, offset + 12, path)
      offset += 16
      assertBufferRange(bytes, offset, chunkCount * 16, path)
      offset += chunkCount * 16
    }
  }
  if (offset !== bytes.length && offset + 8 !== bytes.length) throw new Error(`Invalid CSI index: ${path}`)
  if (names.length && (names.length !== referenceCount || new Set(names).size !== names.length)) {
    throw new Error(`Invalid CSI index: ${path}`)
  }
  return names.slice(0, referenceCount).map((name) => ({ name }))
}

function nonNegativeInt32(bytes: Buffer, offset: number, path: string): number {
  assertBufferRange(bytes, offset, 4, path)
  const value = bytes.readInt32LE(offset)
  if (value < 0) throw new Error(`Invalid indexed reference metadata: ${path}`)
  return value
}

function assertBufferRange(bytes: Buffer, offset: number, length: number, path: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
    offset > bytes.length || length > bytes.length - offset) {
    throw new Error(`Invalid indexed reference metadata: ${path}`)
  }
}

function nullTerminatedNames(bytes: Buffer): string[] {
  return bytes.toString('utf8').split('\0').map((name) => name.trim()).filter(Boolean)
}

function indexExtension(path: string): string {
  const lower = path.toLowerCase()
  for (const extension of ['.fai', '.gzi', '.tbi', '.csi']) {
    if (lower.endsWith(extension)) return extension
  }
  return ''
}

function enforceTotalAssetSize(assets: readonly BiologyRoomAsset[]): void {
  const total = assets.reduce(
    (sum, asset) => sum + (!asset.readiness || asset.readiness === 'ready' ? asset.sizeBytes : 0),
    0
  )
  if (total > BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES) {
    throw new Error(`Biology Room source assets may not exceed ${BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES} bytes total.`)
  }
}

async function discoverContigs(
  workspaceRoot: string,
  absolutePath: string,
  relativePath: string,
  format: BiologyRoomFormat,
  indexPaths: readonly string[],
  indexContigs: ReadonlyMap<string, BiologyContig[]>,
  sizeBytes: number
): Promise<{ contigs: BiologyContig[]; truncated: boolean }> {
  if (format === 'fasta') {
    const faiPath = indexPaths.find((path) => path.toLowerCase().endsWith('.fai'))
    if (faiPath) {
      const absoluteFai = await resolveOpenTargetPath(faiPath, workspaceRoot, { allowBasenameFallback: false })
      return parseFai(await readBoundedText(absoluteFai, MAX_INDEX_TEXT_BYTES))
    }
  }
  if (isTrackFormat(format)) {
    const indexed = indexPaths.flatMap((path) => indexContigs.get(path) ?? [])
    if (indexed.length) {
      return {
        contigs: indexed.slice(0, BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET),
        truncated: indexed.length > BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET
      }
    }
  }
  if (relativePath.toLowerCase().endsWith('.gz') || sizeBytes > BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES) {
    return { contigs: [], truncated: false }
  }
  const text = await readBoundedText(absolutePath, BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES + 1)
  if (format === 'fasta') return parseFasta(text)
  if (format === 'genbank') return parseGenBank(text)
  if (format === 'gff3' || format === 'bed' || format === 'vcf') return parseTrackContigs(text, format)
  return { contigs: [], truncated: false }
}

async function readBoundedText(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path)
  if (info.size > maxBytes) throw new Error(`Biology Room text metadata exceeds ${maxBytes} bytes.`)
  return readFile(path, 'utf8')
}

function parseFai(text: string): { contigs: BiologyContig[]; truncated: boolean } {
  const out: BiologyContig[] = []
  let truncated = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (out.length >= BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET) {
      truncated = true
      break
    }
    const fields = line.split('\t')
    const name = fields[0]?.trim()
    const length = Number(fields[1])
    if (!name) continue
    out.push({ name, ...(Number.isSafeInteger(length) && length >= 0 ? { length } : {}) })
  }
  return { contigs: out, truncated }
}

function parseFasta(text: string): { contigs: BiologyContig[]; truncated: boolean } {
  const out: BiologyContig[] = []
  let current: BiologyContig | null = null
  let truncated = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (out.length >= BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET) {
        truncated = true
        current = null
        continue
      }
      const name = line.slice(1).trim().split(/\s+/, 1)[0]
      if (!name) {
        current = null
        continue
      }
      current = { name, length: 0 }
      out.push(current)
    } else if (current) {
      current.length = (current.length ?? 0) + line.replace(/\s+/g, '').length
    }
  }
  return { contigs: out, truncated }
}

function parseGenBank(text: string): { contigs: BiologyContig[]; truncated: boolean } {
  const out: BiologyContig[] = []
  let truncated = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('LOCUS')) continue
    if (out.length >= BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET) {
      truncated = true
      break
    }
    const match = /^LOCUS\s+(\S+)\s+(\d+)\s+bp\b/i.exec(line)
    if (match) out.push({ name: match[1]!, length: Number(match[2]) })
  }
  return { contigs: out, truncated }
}

function parseTrackContigs(
  text: string,
  format: 'gff3' | 'bed' | 'vcf'
): { contigs: BiologyContig[]; truncated: boolean } {
  const contigs = new Map<string, number | undefined>()
  let truncated = false
  const add = (name: string, length?: number) => {
    if (!name || contigs.has(name)) return
    if (contigs.size >= BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET) {
      truncated = true
      return
    }
    contigs.set(name, length)
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    if (format === 'vcf' && line.startsWith('##contig=<')) {
      const id = /(?:^|,)ID=([^,>]+)/.exec(line.slice(10))?.[1]
      const lengthRaw = /(?:^|,)length=(\d+)/i.exec(line.slice(10))?.[1]
      if (id) add(id, lengthRaw ? Number(lengthRaw) : undefined)
      continue
    }
    if (line.startsWith('#')) continue
    const fields = line.split('\t')
    const name = fields[0]?.trim()
    if (!name) continue
    if (format === 'bed') {
      const end = Number(fields[2])
      add(name, Number.isSafeInteger(end) && end >= 0 ? end : undefined)
    } else {
      add(name)
    }
  }
  return {
    contigs: [...contigs].map(([name, length]) => ({ name, ...(length !== undefined ? { length } : {}) })),
    truncated
  }
}

function validateTrackContigs(
  allAssets: readonly BiologyRoomAsset[],
  newAssets: readonly BiologyRoomAsset[],
  options: { rejectZeroMatches?: boolean; checkedAt?: string } = {}
): string[] {
  const byId = new Map(allAssets.map((asset) => [asset.id, asset]))
  const warnings: string[] = []
  for (const track of newAssets.filter(isTrack)) {
    const checkedAt = options.checkedAt ?? track.updatedAt
    if (track.readiness && track.readiness !== 'ready') {
      const reason = `Contig compatibility was not verified because the track is ${track.readiness}.`
      setTrackReferenceCompatibility(track, {
        status: 'unverified',
        ...(track.referenceAssetId ? { referenceAssetId: track.referenceAssetId } : {}),
        trackSha256: track.sha256,
        unmatchedExamples: [],
        reason,
        checkedAt
      })
      warnings.push(`${track.path}: ${reason}`)
      continue
    }
    if (!track.referenceAssetId) {
      const reason = 'The track is waiting for a reference FASTA.'
      setTrackReferenceCompatibility(track, {
        status: 'unverified',
        trackSha256: track.sha256,
        unmatchedExamples: [],
        reason,
        checkedAt
      })
      warnings.push(`${track.path} is waiting for a reference FASTA.`)
      continue
    }
    const reference = track.referenceAssetId ? byId.get(track.referenceAssetId) : undefined
    if (!reference || reference.format !== 'fasta') {
      throw new Error(`Genome track ${track.id} has no valid FASTA reference.`)
    }
    if (reference.readiness && reference.readiness !== 'ready') {
      const reason = `Contig compatibility was not verified because reference ${reference.path} is ${reference.readiness}.`
      setTrackReferenceCompatibility(track, {
        status: 'unverified',
        referenceAssetId: reference.id,
        trackSha256: track.sha256,
        referenceSha256: reference.sha256,
        unmatchedExamples: [],
        reason,
        checkedAt
      })
      warnings.push(`${track.path}: ${reason}`)
      continue
    }
    if (!track.contigs?.length || !reference.contigs?.length) {
      const reason = 'Contig compatibility was not verified because contig metadata was unavailable.'
      setTrackReferenceCompatibility(track, {
        status: 'unverified',
        referenceAssetId: reference.id,
        trackSha256: track.sha256,
        referenceSha256: reference.sha256,
        unmatchedExamples: [],
        reason,
        checkedAt
      })
      warnings.push(`${track.path}: ${reason}`)
      continue
    }
    const referenceNames = new Set(reference.contigs.map((contig) => contig.name))
    const unmatched = track.contigs.filter((contig) => !referenceNames.has(contig.name))
    const matchCount = track.contigs.length - unmatched.length
    const unmatchedExamples = unmatched
      .slice(0, MAX_CONTIG_EXAMPLES_IN_WARNING)
      .map((contig) => contig.name)
    const metadataTruncated = Boolean(track.contigsTruncated || reference.contigsTruncated)
    const compatibilityStatus: BiologyRoomTrackReferenceCompatibility['status'] = metadataTruncated
      ? 'unverified'
      : matchCount === 0
        ? 'incompatible'
        : unmatched.length > 0
          ? 'partial'
          : 'compatible'
    setTrackReferenceCompatibility(track, {
      status: compatibilityStatus,
      referenceAssetId: reference.id,
      trackSha256: track.sha256,
      referenceSha256: reference.sha256,
      trackContigCount: track.contigs.length,
      referenceContigCount: reference.contigs.length,
      matchedContigCount: matchCount,
      unmatchedContigCount: unmatched.length,
      unmatchedExamples,
      ...(metadataTruncated
        ? { reason: 'Compatibility is incomplete because stored contig metadata was truncated.' }
        : {}),
      checkedAt
    })
    if (matchCount === 0 && !track.contigsTruncated && !reference.contigsTruncated) {
      if (options.rejectZeroMatches !== false) {
        throw new Error(`Genome track ${track.path} has no contig names matching ${reference.path}.`)
      }
      warnings.push(`Genome track ${track.path} has no contig names matching ${reference.path}.`)
      continue
    }
    if (unmatched.length > 0) {
      const examples = unmatchedExamples.join(', ')
      warnings.push(
        `${track.path}: ${unmatched.length} contig name(s) did not match ${reference.path}` +
        `${examples ? ` (${examples})` : ''}.`
      )
    }
  }
  return warnings
}

function setTrackReferenceCompatibility(
  track: BiologyRoomAsset,
  compatibility: BiologyRoomTrackReferenceCompatibility
): void {
  const comparable = (value: BiologyRoomTrackReferenceCompatibility | undefined) => value
    ? { ...value, checkedAt: '' }
    : undefined
  if (JSON.stringify(comparable(track.referenceCompatibility)) === JSON.stringify(comparable(compatibility))) {
    return
  }
  track.referenceCompatibility = compatibility
  track.updatedAt = compatibility.checkedAt
}

function isTrackFormat(format: BiologyRoomFormat): boolean {
  return format === 'gff3' || format === 'bed' || format === 'vcf'
}

function isTrack(asset: BiologyRoomAsset): boolean {
  return isTrackFormat(asset.format)
}

async function applyOperation(
  workspaceRoot: string,
  manifest: BiologyRoomManifest,
  operation: Exclude<BiologyRoomMutationOperation, { type: 'restoreRevision' }>,
  actor: BiologyRoomActor | undefined,
  warnings: string[]
): Promise<BiologyRoomManifest> {
  const next = cloneManifest(manifest)
  const now = new Date().toISOString()

  switch (operation.type) {
    case 'addAsset': {
      const prepared = await prepareAssets(workspaceRoot, [operation.asset], next.assets, now)
      next.assets = prepared.updatedExistingAssets
      next.assets.push(...prepared.assets)
      warnings.push(...prepared.warnings)
      if (!next.activeAssetId && prepared.assets[0]) next.activeAssetId = prepared.assets[0].id
      return next
    }
    case 'removeAsset': {
      const asset = requireAsset(next, operation.assetId)
      const dependentTrackIds = next.assets
        .filter((candidate) => candidate.referenceAssetId === asset.id)
        .map((candidate) => candidate.id)
      const dependentAnnotationIds = next.annotations
        .filter((annotation) => selectionUsesAsset(annotation.anchor, asset.id))
        .map((annotation) => annotation.id)
      const selectionDepends = next.selection ? selectionUsesAsset(next.selection, asset.id) : false
      if (!operation.cascade && (dependentTrackIds.length || dependentAnnotationIds.length || selectionDepends)) {
        throw new Error(`Asset ${asset.id} has dependent room state; remove it with cascade enabled.`)
      }
      const removedIds = new Set([asset.id, ...(operation.cascade ? dependentTrackIds : [])])
      next.assets = next.assets.filter((candidate) => !removedIds.has(candidate.id))
      next.annotations = next.annotations.filter((annotation) =>
        ![...removedIds].some((id) => selectionUsesAsset(annotation.anchor, id))
      )
      if (next.selection && [...removedIds].some((id) => selectionUsesAsset(next.selection!, id))) {
        delete next.selection
      }
      if (next.activeAssetId && removedIds.has(next.activeAssetId)) {
        const replacement = next.assets[0]?.id
        if (replacement) next.activeAssetId = replacement
        else delete next.activeAssetId
      }
      if (next.viewerStates.sequence && removedIds.has(next.viewerStates.sequence.assetId)) {
        delete next.viewerStates.sequence
      }
      if (next.viewerStates.molecular && removedIds.has(next.viewerStates.molecular.assetId)) {
        delete next.viewerStates.molecular
      }
      if (next.viewerStates.genome && removedIds.has(next.viewerStates.genome.referenceAssetId)) {
        delete next.viewerStates.genome
      } else if (next.viewerStates.genome) {
        for (const id of removedIds) delete next.viewerStates.genome.trackVisibility[id]
      }
      return next
    }
    case 'setActiveAsset': {
      if (operation.assetId) requireAsset(next, operation.assetId)
      if (operation.assetId) next.activeAssetId = operation.assetId
      else delete next.activeAssetId
      return next
    }
    case 'setSelection': {
      if (operation.selection) {
        validateSelection(next, operation.selection)
        next.selection = operation.selection
      } else {
        delete next.selection
      }
      return next
    }
    case 'setViewport': {
      if (operation.viewport.kind === 'sequence') {
        const asset = requireAsset(next, operation.viewport.state.assetId)
        if (asset.format !== 'fasta' && asset.format !== 'genbank') {
          throw new Error('Sequence viewport must identify a FASTA or GenBank asset.')
        }
        next.viewerStates.sequence = operation.viewport.state
      } else {
        const reference = requireAsset(next, operation.viewport.state.referenceAssetId)
        if (reference.format !== 'fasta') throw new Error('Genome viewport requires a FASTA reference.')
        for (const trackId of Object.keys(operation.viewport.state.trackVisibility)) {
          const track = requireAsset(next, trackId)
          if (!isTrack(track) || track.referenceAssetId !== reference.id) {
            throw new Error(`Track ${trackId} is not attached to reference ${reference.id}.`)
          }
        }
        next.viewerStates.genome = operation.viewport.state
      }
      return next
    }
    case 'setTrackVisibility': {
      const track = requireAsset(next, operation.trackAssetId)
      if (!isTrack(track) || !track.referenceAssetId) throw new Error('Track visibility requires a genome track asset.')
      if (!next.viewerStates.genome || next.viewerStates.genome.referenceAssetId !== track.referenceAssetId) {
        next.viewerStates.genome = {
          referenceAssetId: track.referenceAssetId,
          trackVisibility: {}
        }
      }
      next.viewerStates.genome.trackVisibility[track.id] = operation.visible
      return next
    }
    case 'setTrackReference': {
      const track = requireAsset(next, operation.trackAssetId)
      if (!isTrack(track)) throw new Error('Track reference assignment requires a genome track asset.')
      const reference = requireAsset(next, operation.referenceAssetId)
      if (reference.format !== 'fasta') throw new Error('Track reference assignment requires a FASTA asset.')
      const linkedTrack: BiologyRoomAsset = {
        ...track,
        referenceAssetId: reference.id,
        updatedAt: now
      }
      const promotedReference: BiologyRoomAsset = {
        ...reference,
        modality: 'genome-reference',
        updatedAt: now
      }
      const prospective = next.assets.map((asset) =>
        asset.id === linkedTrack.id ? linkedTrack : asset.id === promotedReference.id ? promotedReference : asset
      )
      warnings.push(...validateTrackContigs(prospective, [linkedTrack], { checkedAt: now }))
      next.assets = prospective
      if (next.viewerStates.genome && next.viewerStates.genome.referenceAssetId !== reference.id &&
        next.activeAssetId === track.id) {
        next.viewerStates.genome = {
          referenceAssetId: reference.id,
          trackVisibility: { [track.id]: true }
        }
      }
      return next
    }
    case 'setMolecularView': {
      const asset = requireAsset(next, operation.state.assetId)
      if (asset.modality !== 'structure') throw new Error('Molecular view requires a structure asset.')
      next.viewerStates.molecular = operation.state
      return next
    }
    case 'upsertAnnotation': {
      validateSelection(next, operation.annotation.anchor)
      const index = next.annotations.findIndex((annotation) => annotation.id === operation.annotation.id)
      const annotation: BiologyAnnotation = {
        ...operation.annotation,
        actor: actor ?? operation.annotation.actor,
        createdAt: index >= 0 ? next.annotations[index]!.createdAt : now,
        updatedAt: now
      }
      if (index >= 0) next.annotations[index] = annotation
      else {
        if (next.annotations.length >= BIOLOGY_ROOM_MAX_ANNOTATIONS) {
          throw new Error(`A Biology Room may contain at most ${BIOLOGY_ROOM_MAX_ANNOTATIONS} annotations.`)
        }
        next.annotations.push(annotation)
      }
      return next
    }
    case 'deleteAnnotation': {
      const index = next.annotations.findIndex((annotation) => annotation.id === operation.annotationId)
      if (index < 0) throw new Error(`Biology Room annotation not found: ${operation.annotationId}`)
      next.annotations.splice(index, 1)
      return next
    }
  }
}

function effectiveOperationForAudit(
  operation: BiologyRoomMutationOperation,
  manifest: BiologyRoomManifest
): BiologyRoomEvent['operations'][number] {
  if (operation.type === 'addAsset') {
    const asset = operation.asset.id
      ? manifest.assets.find((candidate) => candidate.id === operation.asset.id)
      : manifest.assets.find((candidate) => candidate.path === operation.asset.path)
    if (!asset) throw new Error(`Applied Biology Room asset not found: ${operation.asset.id ?? operation.asset.path}`)
    return { type: 'addAsset', asset: assetToAuditInput(asset) }
  }
  if (operation.type === 'upsertAnnotation') {
    const annotation = manifest.annotations.find((candidate) => candidate.id === operation.annotation.id)
    if (!annotation) throw new Error(`Applied Biology Room annotation not found: ${operation.annotation.id}`)
    return {
      type: 'upsertAnnotation',
      annotation: structuredClone(annotation)
    }
  }
  return structuredClone(operation)
}

function assetToAuditInput(asset: BiologyRoomAsset): BiologyRoomAssetInput {
  return {
    id: asset.id,
    path: asset.path,
    format: asset.format,
    ...(asset.modality === 'genome-reference' ? { asReference: true } : {}),
    indexPaths: [...asset.indexPaths],
    ...(asset.referenceAssetId ? { referenceAssetId: asset.referenceAssetId } : {})
  }
}

async function restoreRevision(
  workspaceRoot: string,
  current: BiologyRoomManifest,
  revision: number,
  warnings: string[]
): Promise<BiologyRoomManifest> {
  if (revision > current.revision) throw new Error('Cannot restore a future Biology Room revision.')
  const restored = await loadRevision(workspaceRoot, current.roomId, revision)
  const historicalState: BiologyRoomManifest = {
    ...cloneManifest(restored),
    roomId: current.roomId,
    revision: current.revision,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt
  }
  const reconciled = await reconcileManifestSources(workspaceRoot, historicalState, new Date().toISOString())
  warnings.push(...reconciled.warnings)
  return reconciled.manifest
}

function requireAsset(manifest: BiologyRoomManifest, assetId: string): BiologyRoomAsset {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error(`Biology Room asset not found: ${assetId}`)
  return asset
}

function validateSelection(manifest: BiologyRoomManifest, selection: BiologyRoomSelection): void {
  const asset = requireAsset(manifest, selection.assetId)
  if (asset.readiness && asset.readiness !== 'ready') {
    throw new Error(`Selection source is ${asset.readiness}: ${asset.path}`)
  }
  if (selection.kind === 'sequence') {
    if (asset.format !== 'fasta' && asset.format !== 'genbank') {
      throw new Error('Sequence selection requires a FASTA or GenBank asset.')
    }
    const contig = selection.sequenceId
      ? asset.contigs?.find((candidate) => candidate.name === selection.sequenceId)
      : asset.contigs?.length === 1
        ? asset.contigs[0]
        : undefined
    if (selection.sequenceId && asset.contigs?.length && !contig && !asset.contigsTruncated) {
      throw new Error(`Sequence record not found: ${selection.sequenceId}`)
    }
    if (contig?.length !== undefined && selection.ranges.some((range) => range.end > contig.length!)) {
      throw new Error(`Sequence selection exceeds contig ${contig.name}.`)
    }
    return
  }
  if (selection.kind === 'molecular') {
    if (asset.modality !== 'structure') throw new Error('Molecular selection requires a structure asset.')
    return
  }
  const reference = requireAsset(manifest, selection.referenceAssetId)
  if (reference.readiness && reference.readiness !== 'ready') {
    throw new Error(`Selection reference is ${reference.readiness}: ${reference.path}`)
  }
  if (reference.format !== 'fasta') throw new Error('Genomic selection requires a FASTA reference.')
  if (asset.id !== reference.id && asset.referenceAssetId !== reference.id) {
    throw new Error('Genomic selection asset is not attached to the selected reference.')
  }
  const contig = reference.contigs?.find((candidate) => candidate.name === selection.refName)
  if (reference.contigs?.length && !contig && !reference.contigsTruncated) {
    throw new Error(`Reference contig not found: ${selection.refName}`)
  }
  if (contig?.length !== undefined && selection.end > contig.length) {
    throw new Error(`Genomic selection exceeds contig ${selection.refName}.`)
  }
}

function selectionUsesAsset(selection: BiologyRoomSelection, assetId: string): boolean {
  return selection.assetId === assetId ||
    (selection.kind === 'genomic' && selection.referenceAssetId === assetId)
}

function assertManifestInvariants(manifest: BiologyRoomManifest): void {
  biologyRoomManifestSchema.parse(manifest)
  const assetIds = new Set<string>()
  const assetPaths = new Set<string>()
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.id)) throw new Error(`Duplicate Biology Room asset ID: ${asset.id}`)
    if (assetPaths.has(asset.path)) throw new Error(`Duplicate Biology Room asset path: ${asset.path}`)
    assetIds.add(asset.id)
    assetPaths.add(asset.path)
  }
  enforceTotalAssetSize(manifest.assets)
  if (manifest.activeAssetId) requireAsset(manifest, manifest.activeAssetId)
  if (manifest.selection) validateSelection(manifest, manifest.selection)
  for (const annotation of manifest.annotations) {
    if (!annotation.orphaned) validateSelection(manifest, annotation.anchor)
  }
  if (manifest.viewerStates.sequence) {
    const sequenceState = manifest.viewerStates.sequence
    const sequenceAsset = requireAsset(manifest, sequenceState.assetId)
    if (sequenceAsset.format !== 'fasta' && sequenceAsset.format !== 'genbank') {
      throw new Error('Sequence viewer state requires a FASTA or GenBank asset.')
    }
    if (sequenceState.sequenceId &&
      sequenceAsset.contigs?.length &&
      !sequenceAsset.contigsTruncated &&
      !sequenceAsset.contigs.some((contig) => contig.name === sequenceState.sequenceId)) {
      throw new Error(`Sequence viewer record not found: ${sequenceState.sequenceId}`)
    }
  }
  if (manifest.viewerStates.molecular) requireAsset(manifest, manifest.viewerStates.molecular.assetId)
  if (manifest.viewerStates.genome) {
    const reference = requireAsset(manifest, manifest.viewerStates.genome.referenceAssetId)
    if (reference.format !== 'fasta') throw new Error('Genome viewer reference must be FASTA.')
  }
  for (const track of manifest.assets.filter(isTrack)) {
    if (track.referenceAssetId && requireAsset(manifest, track.referenceAssetId).format !== 'fasta') {
      throw new Error(`Genome track ${track.id} requires a FASTA reference.`)
    }
    const compatibility = track.referenceCompatibility
    if (!compatibility) continue
    if (compatibility.trackSha256 !== track.sha256) {
      throw new Error(`Genome track ${track.id} compatibility fingerprint is stale.`)
    }
    if (compatibility.referenceAssetId !== track.referenceAssetId) {
      throw new Error(`Genome track ${track.id} compatibility reference is stale.`)
    }
    if (compatibility.referenceAssetId && compatibility.referenceSha256) {
      const reference = requireAsset(manifest, compatibility.referenceAssetId)
      if (compatibility.referenceSha256 !== reference.sha256) {
        throw new Error(`Genome track ${track.id} compatibility reference fingerprint is stale.`)
      }
    }
    if (compatibility.trackContigCount !== undefined &&
      compatibility.matchedContigCount !== undefined &&
      compatibility.unmatchedContigCount !== undefined &&
      compatibility.matchedContigCount + compatibility.unmatchedContigCount !== compatibility.trackContigCount) {
      throw new Error(`Genome track ${track.id} compatibility counts are inconsistent.`)
    }
  }
  for (const asset of manifest.assets.filter((candidate) => !isTrack(candidate))) {
    if (asset.referenceCompatibility) {
      throw new Error(`Only genome tracks may store reference compatibility: ${asset.id}`)
    }
  }
}

function sameRoomState(a: BiologyRoomManifest, b: BiologyRoomManifest): boolean {
  const comparable = (manifest: BiologyRoomManifest) => ({
    ...manifest,
    revision: 0,
    updatedAt: ''
  })
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
}

function sameAssetSource(a: BiologyRoomAsset, b: BiologyRoomAsset): boolean {
  const comparable = (asset: BiologyRoomAsset) => ({
    ...asset,
    createdAt: '',
    updatedAt: ''
  })
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
}

function cloneManifest(manifest: BiologyRoomManifest): BiologyRoomManifest {
  return structuredClone(manifest)
}
