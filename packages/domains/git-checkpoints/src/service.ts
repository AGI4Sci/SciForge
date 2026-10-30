import { constants, type Stats } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'
import {
  gitCheckpointCreateInputSchema,
  gitCheckpointListInputSchema,
  gitCheckpointPreviewSchema,
  gitCheckpointRestoreInputSchema,
  gitCheckpointRestoreSchema,
  gitCheckpointSchema,
  type GitCheckpoint,
  type GitCheckpointCreateInput,
  type GitCheckpointListInput,
  type GitCheckpointPreview,
  type GitCheckpointRestore,
  type GitCheckpointRestoreInput,
  type GitCheckpointResult
} from './contract.js'

const captureResultSchema = z.object({
  snapshotId: z.string().trim().min(1).max(1_024),
  provider: z.string().trim().min(1).max(128),
  revision: z.string().trim().min(1).max(512),
  changeSummary: z.string().max(100_000)
}).strict()

const previewResultSchema = z.object({
  patch: z.string().max(1_000_000),
  truncated: z.boolean()
}).strict()

const metadataSchema = gitCheckpointSchema.extend({
  snapshotId: z.string().trim().min(1).max(1_024)
}).strict()

type GitCheckpointMetadata = z.infer<typeof metadataSchema>

export type GitCheckpointVcsPort = Readonly<{
  capture(input: Readonly<{
    workspaceRoot: string
    snapshotName: string
  }>): Promise<z.infer<typeof captureResultSchema>>
  preview(input: Readonly<{
    workspaceRoot: string
    snapshotId: string
  }>): Promise<z.infer<typeof previewResultSchema>>
  restore(input: Readonly<{
    workspaceRoot: string
    snapshotId: string
  }>): Promise<void>
}>

export type GitCheckpointServiceOptions = Readonly<{
  userDataDir: string
  vcs: GitCheckpointVcsPort
  now?: () => Date
  createId?: () => string
}>

export class GitCheckpointService {
  readonly #userDataDir: string
  readonly #vcs: GitCheckpointVcsPort
  readonly #now: () => Date
  readonly #createId: () => string
  #queue: Promise<void> = Promise.resolve()

  constructor(options: GitCheckpointServiceOptions) {
    this.#userDataDir = options.userDataDir
    this.#vcs = options.vcs
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async create(
    rawInput: GitCheckpointCreateInput
  ): Promise<GitCheckpointResult<GitCheckpoint>> {
    let input
    try {
      input = gitCheckpointCreateInputSchema.parse(rawInput)
    } catch (error) {
      return failure(error)
    }
    return this.#enqueue(async () => {
      const checkpointId = safeCheckpointId(
        `${phasePrefix(input.phase)}_${this.#now().getTime()}_${this.#createId()}`
      )
      try {
        const captured = captureResultSchema.parse(await this.#vcs.capture({
          workspaceRoot: input.workspaceRoot,
          snapshotName: checkpointId
        }))
        const checkpoint = metadataSchema.parse({
          checkpointId,
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          phase: input.phase,
          workspaceRoot: input.workspaceRoot,
          provider: captured.provider,
          revision: captured.revision,
          snapshotId: captured.snapshotId,
          createdAt: validNow(this.#now()).toISOString(),
          changeSummary: captured.changeSummary,
          status: 'available'
        })
        await this.#writeMetadata(checkpoint, true)
        return { ok: true, value: publicCheckpoint(checkpoint) }
      } catch (error) {
        return failure(error)
      }
    })
  }

  async list(
    rawInput: GitCheckpointListInput = {}
  ): Promise<GitCheckpointResult<readonly GitCheckpoint[]>> {
    let input
    try {
      input = gitCheckpointListInputSchema.parse(rawInput)
    } catch (error) {
      return failure(error)
    }
    return this.#enqueue(async () => {
      try {
        const root = await this.#checkpointRoot()
        const entries = await readdir(root, { withFileTypes: true })
        const checkpoints: GitCheckpoint[] = []
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const metadata = await this.#readMetadata(entry.name)
          if (!metadata) continue
          if (input.runtimeId && metadata.runtimeId !== input.runtimeId) continue
          if (input.threadId && metadata.threadId !== input.threadId) continue
          if (input.workspaceRoot && metadata.workspaceRoot !== input.workspaceRoot) continue
          checkpoints.push(publicCheckpoint(metadata))
        }
        checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        return { ok: true, value: Object.freeze(checkpoints) }
      } catch (error) {
        return failure(error)
      }
    })
  }

  async preview(
    checkpointId: string,
    expectedWorkspaceRoot?: string
  ): Promise<GitCheckpointResult<GitCheckpointPreview>> {
    let normalizedId
    try {
      normalizedId = safeCheckpointId(checkpointId)
    } catch (error) {
      return failure(error)
    }
    return this.#enqueue(async () => {
      const metadata = await this.#readMetadata(normalizedId)
      if (!metadata) return fail('not_found', `Git checkpoint not found: ${normalizedId}`)
      if (
        expectedWorkspaceRoot &&
        normalizeWorkspace(expectedWorkspaceRoot) !== normalizeWorkspace(metadata.workspaceRoot)
      ) {
        return fail('not_found', `Git checkpoint not found: ${normalizedId}`)
      }
      try {
        const preview = previewResultSchema.parse(await this.#vcs.preview({
          workspaceRoot: metadata.workspaceRoot,
          snapshotId: metadata.snapshotId
        }))
        return {
          ok: true,
          value: gitCheckpointPreviewSchema.parse({
            checkpoint: publicCheckpoint(metadata),
            ...preview
          })
        }
      } catch (error) {
        return failure(error)
      }
    })
  }

  async restore(
    rawInput: GitCheckpointRestoreInput,
    expectedWorkspaceRoot?: string
  ): Promise<GitCheckpointResult<GitCheckpointRestore>> {
    let input
    try {
      input = gitCheckpointRestoreInputSchema.parse(rawInput)
    } catch (error) {
      return failure(error)
    }
    return this.#enqueue(async () => {
      const metadata = await this.#readMetadata(input.checkpointId)
      if (!metadata) return fail('not_found', `Git checkpoint not found: ${input.checkpointId}`)
      if (
        expectedWorkspaceRoot &&
        normalizeWorkspace(expectedWorkspaceRoot) !== normalizeWorkspace(metadata.workspaceRoot)
      ) {
        return fail('not_found', `Git checkpoint not found: ${input.checkpointId}`)
      }

      const rescue = await this.#createRescue(metadata)
      if (!rescue.ok) {
        return fail(
          'rescue_failed',
          `Restore aborted because the rescue checkpoint could not be created: ${rescue.message}`,
          rescue.details
        )
      }

      try {
        await this.#vcs.restore({
          workspaceRoot: metadata.workspaceRoot,
          snapshotId: metadata.snapshotId
        })
        const restored = metadataSchema.parse({
          ...metadata,
          status: 'restored',
          restoreStatus: validNow(this.#now()).toISOString(),
          rescueCheckpointId: rescue.value.checkpointId
        })
        await this.#writeMetadata(restored, false)
        return {
          ok: true,
          value: gitCheckpointRestoreSchema.parse(publicCheckpoint(restored))
        }
      } catch (error) {
        const mapped = failure(error)
        const status = mapped.reason === 'dirty_worktree' || mapped.reason === 'branch_changed'
          ? 'blocked'
          : 'failed'
        await this.#writeMetadata(metadataSchema.parse({
          ...metadata,
          status,
          rescueCheckpointId: rescue.value.checkpointId
        }), false).catch(() => undefined)
        return fail(mapped.reason, mapped.message, {
          rescueCheckpointId: rescue.value.checkpointId,
          ...(mapped.details === undefined ? {} : { cause: mapped.details })
        })
      }
    })
  }

  async #createRescue(
    target: GitCheckpointMetadata
  ): Promise<GitCheckpointResult<GitCheckpoint>> {
    const checkpointId = safeCheckpointId(
      `rescue_${this.#now().getTime()}_${this.#createId()}`
    )
    try {
      const captured = captureResultSchema.parse(await this.#vcs.capture({
        workspaceRoot: target.workspaceRoot,
        snapshotName: checkpointId
      }))
      const checkpoint = metadataSchema.parse({
        checkpointId,
        runtimeId: target.runtimeId,
        threadId: `${target.threadId}:restore-rescue`,
        ...(target.turnId ? { turnId: target.turnId } : {}),
        phase: 'rescue',
        workspaceRoot: target.workspaceRoot,
        provider: captured.provider,
        revision: captured.revision,
        snapshotId: captured.snapshotId,
        createdAt: validNow(this.#now()).toISOString(),
        changeSummary: captured.changeSummary,
        status: 'available'
      })
      await this.#writeMetadata(checkpoint, true)
      return { ok: true, value: publicCheckpoint(checkpoint) }
    } catch (error) {
      return failure(error)
    }
  }

  #enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const run = this.#queue.then(operation, operation)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }

  async #checkpointRoot(): Promise<string> {
    const userDataInfo = await lstatIfExists(this.#userDataDir)
    if (!userDataInfo) await mkdir(this.#userDataDir, { recursive: true })
    const userDataReal = await realpath(this.#userDataDir)
    const domainsRoot = safeJoin(userDataReal, 'domain-data')
    await ensureRealDirectory(domainsRoot)
    const root = safeJoin(domainsRoot, 'git-checkpoints')
    await ensureRealDirectory(root)
    return realpath(root)
  }

  async #checkpointDirectory(checkpointId: string, create: boolean): Promise<string> {
    const root = await this.#checkpointRoot()
    const path = safeJoin(root, safeCheckpointId(checkpointId))
    const info = await lstatIfExists(path)
    if (!info && create) await mkdir(path)
    const updated = info ?? await lstat(path)
    if (updated.isSymbolicLink() || !updated.isDirectory()) {
      throw codedError('invalid_checkpoint_path', 'Checkpoint directory must be a real directory.')
    }
    const canonical = await realpath(path)
    if (!isPathInside(root, canonical)) {
      throw codedError('invalid_checkpoint_path', 'Checkpoint directory escaped package data.')
    }
    return canonical
  }

  async #readMetadata(checkpointId: string): Promise<GitCheckpointMetadata | null> {
    try {
      const directory = await this.#checkpointDirectory(checkpointId, false)
      const path = safeJoin(directory, 'metadata.json')
      const bytes = await readFileNoFollow(path, 'utf8')
      const metadata = metadataSchema.parse(JSON.parse(bytes))
      return metadata.checkpointId === checkpointId ? metadata : null
    } catch {
      return null
    }
  }

  async #writeMetadata(metadata: GitCheckpointMetadata, create: boolean): Promise<void> {
    const validated = metadataSchema.parse(metadata)
    const directory = await this.#checkpointDirectory(validated.checkpointId, create)
    const target = safeJoin(directory, 'metadata.json')
    const temporary = safeJoin(directory, `.metadata.${randomUUID()}.tmp`)
    try {
      await writeFileNoFollow(
        temporary,
        `${JSON.stringify(validated, null, 2)}\n`,
        true
      )
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

function publicCheckpoint(metadata: GitCheckpointMetadata): GitCheckpoint {
  const { snapshotId: _snapshotId, ...checkpoint } = metadata
  return gitCheckpointSchema.parse(checkpoint)
}

function phasePrefix(phase: GitCheckpointCreateInput['phase']): string {
  if (phase === 'before-turn') return 'before'
  if (phase === 'after-turn') return 'after'
  if (phase === 'rescue') return 'rescue'
  return 'manual'
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw codedError('invalid_clock', 'Git checkpoint clock returned an invalid date.')
  }
  return now
}

function safeCheckpointId(raw: string): string {
  const value = raw.trim()
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(value)) {
    throw codedError('invalid_checkpoint_id', 'Invalid Git checkpoint ID.')
  }
  return value
}

function failure(error: unknown): Extract<GitCheckpointResult<never>, { ok: false }> {
  const code = errorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'dirty_worktree' || /working tree.*changes/i.test(message)) {
    return fail('dirty_worktree', message)
  }
  if (code === 'branch_changed' || /branch.*differs/i.test(message)) {
    return fail('branch_changed', message)
  }
  if (code === 'not_git_repo' || /not a git repository/i.test(message)) {
    return fail('not_git_repo', 'The selected workspace is not a Git repository.')
  }
  if (code === 'git_unavailable' || /spawn git|ENOENT/i.test(message)) {
    return fail('git_unavailable', 'Git is not available.')
  }
  return fail(code || 'error', message)
}

function fail(
  reason: string,
  message: string,
  details?: unknown
): Extract<GitCheckpointResult<never>, { ok: false }> {
  const parsedDetails = toJsonDetail(details)
  return Object.freeze({
    ok: false,
    reason,
    message,
    ...(parsedDetails === undefined ? {} : { details: parsedDetails })
  })
}

function toJsonDetail(value: unknown): DomainPackageJsonValue | undefined {
  if (value === undefined) return undefined
  const parsed = domainPackageJsonValueSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (value instanceof Error) {
    return Object.freeze({
      name: value.name,
      message: value.message,
      ...(errorCode(value) ? { code: errorCode(value) } : {})
    })
  }
  return String(value)
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

async function ensureRealDirectory(path: string): Promise<void> {
  const info = await lstatIfExists(path)
  if (!info) await mkdir(path)
  const updated = info ?? await lstat(path)
  if (updated.isSymbolicLink() || !updated.isDirectory()) {
    throw codedError('invalid_checkpoint_path', 'Checkpoint data path must be a real directory.')
  }
}

async function readFileNoFollow(path: string, encoding: 'utf8'): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    return handle.readFile({ encoding })
  } finally {
    await handle.close()
  }
}

async function writeFileNoFollow(
  path: string,
  content: string,
  exclusive: boolean
): Promise<void> {
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    (exclusive ? constants.O_EXCL : constants.O_TRUNC) |
    (constants.O_NOFOLLOW ?? 0)
  const handle = await open(path, flags, 0o600)
  try {
    await handle.writeFile(content, 'utf8')
  } finally {
    await handle.close()
  }
}

async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

function safeJoin(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments)
  if (!isPathInside(root, target)) {
    throw codedError('invalid_checkpoint_path', 'Checkpoint path escaped package data.')
  }
  return target
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath === '' ||
    (
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath)
    )
}

function normalizeWorkspace(value: string): string {
  return resolve(value.trim())
}
