import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type {
  WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'
import type {
  VersionControlCreateReferenceInput,
  VersionControlCreateReferenceOutput,
  VersionControlCreateSnapshotInput,
  VersionControlDiffInput,
  VersionControlListSnapshotsInput,
  VersionControlListSnapshotsOutput,
  VersionControlReadFileInput,
  VersionControlReadFileOutput,
  VersionControlRestoreInput,
  VersionControlRestoreOutput,
  VersionControlSnapshot,
  VersionControlStatusOutput,
  VersionControlTextOutput
} from '@sciforge/domain-sdk/version-control'
import { VERSION_CONTROL_LIMITS } from '@sciforge/domain-sdk/version-control'
import { resolveGitCwd } from './git-service'

const execFileAsync = promisify(execFile)
const SNAPSHOT_REF_PREFIX = 'refs/sciforge/snapshots/'
const REFERENCE_REF_PREFIX = 'refs/sciforge/references/'
const SNAPSHOT_SUBJECT_PREFIX = 'sciforge-snapshot:'
const DEFAULT_TEXT_LIMIT = 256_000
const MAX_SNAPSHOT_SUBJECT_CHARACTERS = 64_000
const MAX_STATUS_BUFFER_BYTES = 64 * 1024 * 1024

export type VersionControlWorkspaceSession = Readonly<{
  resourceId: string
  ownerId: string
  ownerAudience: 'ui' | 'agent' | 'system'
  workspaceId: string
  workspaceRoot: string
  repositoryRoot: string
  workspaceLocator?: WorkspaceLocator
}>

type VersionControlChange = VersionControlStatusOutput['changes'][number]

type SnapshotSubject = Readonly<{
  label?: string
  metadata?: VersionControlCreateSnapshotInput['metadata']
  state?: Readonly<{
    baseHead?: string
    baseTree: string
    indexTree: string
    worktreeTree: string
    revision: string
  }>
}>

type GitResult = Readonly<{
  ok: boolean
  stdout: string
  stderr: string
}>

export class VersionControlWorkspaceService {
  readonly #sessions = new Map<string, VersionControlWorkspaceSession>()
  readonly #sessionsByOwnerWorkspace = new Map<string, VersionControlWorkspaceSession>()
  readonly #revisionTrees = new Map<string, string>()
  readonly #mutationQueues = new Map<string, Promise<void>>()

  async open(
    ownerId: string,
    ownerAudience: 'ui' | 'agent' | 'system',
    workspaceRoot: string,
    workspaceLocator?: WorkspaceLocator
  ): Promise<VersionControlWorkspaceSession> {
    if (workspaceLocator) {
      throw new Error('Remote version-control workspaces require the workspace placement router.')
    }
    const normalizedOwner = ownerId.trim()
    const normalizedWorkspace = workspaceRoot.trim()
    if (!normalizedOwner) throw new Error('Version-control workspace requires an owner.')
    if (!normalizedWorkspace) throw new Error('Version-control workspace requires a path.')

    const workspace = await realpath(normalizedWorkspace)
    if (!(await stat(workspace)).isDirectory()) {
      throw new Error('Version-control workspace must be a directory.')
    }
    const gitCwd = await resolveGitCwd(workspace)
    if (!gitCwd) throw new Error('The workspace is not inside a Git repository.')
    const repositoryRoot = await realpath(
      (await runGit(gitCwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    )
    assertPathInside(repositoryRoot, workspace, 'Workspace')
    const ownerWorkspaceKey = `${ownerAudience}\0${normalizedOwner}\0${normalizedWorkspace}`
    const existing = this.#sessionsByOwnerWorkspace.get(ownerWorkspaceKey)
    if (
      existing &&
      existing.workspaceRoot === workspace &&
      existing.repositoryRoot === repositoryRoot
    ) return existing

    const session = Object.freeze({
      resourceId: `version-control-${randomUUID()}`,
      ownerId: normalizedOwner,
      ownerAudience,
      workspaceId: normalizedWorkspace,
      workspaceRoot: workspace,
      repositoryRoot
    })
    this.#sessions.set(session.resourceId, session)
    this.#sessionsByOwnerWorkspace.set(ownerWorkspaceKey, session)
    return session
  }

  requireSession(
    ownerId: string,
    ownerAudience: 'ui' | 'agent' | 'system',
    resourceId: string,
    workspaceRoot: string
  ): VersionControlWorkspaceSession {
    const session = this.#sessions.get(resourceId)
    if (
      !session ||
      session.ownerId !== ownerId ||
      session.ownerAudience !== ownerAudience ||
      session.workspaceId !== workspaceRoot
    ) {
      throw new Error('Version-control workspace is unavailable to this caller.')
    }
    return session
  }

  async status(session: VersionControlWorkspaceSession): Promise<VersionControlStatusOutput> {
    const captured = await this.#captureState(session)
    const parsed = parsePorcelainStatus(captured.status)
    const changes = parsed.changes.map((change) => ({
      ...change,
      path: toWorkspaceRelativeStatusPath(session, change.path),
      ...(change.previousPath
        ? { previousPath: toWorkspaceRelativeStatusPath(session, change.previousPath) }
        : {})
    }))
    return {
      revision: captured.revision,
      clean: changes.length === 0,
      changes,
      truncated: parsed.truncated
    }
  }

  async revision(session: VersionControlWorkspaceSession): Promise<string> {
    return (await this.#captureState(session)).revision
  }

  async assertRevision(
    session: VersionControlWorkspaceSession,
    expectedRevision: string
  ): Promise<void> {
    const actual = await this.revision(session)
    if (actual !== expectedRevision) {
      throw Object.assign(new Error('The version-control workspace revision is stale.'), {
        code: 'revision_conflict',
        expectedRevision,
        actualRevision: actual
      })
    }
  }

  async createSnapshot(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateSnapshotInput,
    expectedRevision: string
  ): Promise<VersionControlSnapshot> {
    return this.#enqueueMutation(
      session,
      () => this.#createSnapshot(session, input, expectedRevision)
    )
  }

  async #createSnapshot(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateSnapshotInput,
    expectedRevision: string
  ): Promise<VersionControlSnapshot> {
    const captured = await this.#captureState(session)
    assertMatchingRevision(captured.revision, expectedRevision)
    const tree = captured.tree
    const indexTree = (
      await runGit(session.repositoryRoot, ['write-tree'], { timeout: 30_000 })
    ).stdout.trim()
    const subject = encodeSnapshotSubject(input, {
      ...(captured.head ? { baseHead: captured.head } : {}),
      baseTree: captured.baseTree,
      indexTree,
      worktreeTree: captured.tree,
      revision: captured.revision
    })
    const commit = (
      await runGit(
        session.repositoryRoot,
        ['commit-tree', tree, ...(captured.head ? ['-p', captured.head] : []), '-m', subject],
        {
          timeout: 30_000,
          env: {
            GIT_AUTHOR_NAME: 'SciForge',
            GIT_AUTHOR_EMAIL: 'sciforge@localhost',
            GIT_COMMITTER_NAME: 'SciForge',
            GIT_COMMITTER_EMAIL: 'sciforge@localhost'
          }
        }
      )
    ).stdout.trim()
    const ref = `${SNAPSHOT_REF_PREFIX}${Date.now()}-${randomUUID()}`
    await runGit(session.repositoryRoot, ['update-ref', ref, commit, ''])
    const createdAt = (
      await runGit(session.repositoryRoot, ['show', '-s', '--format=%cI', commit])
    ).stdout.trim()
    return {
      id: commit,
      revision: captured.revision,
      createdAt,
      ...(input.label ? { label: input.label } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
    }
  }

  async createReference(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateReferenceInput,
    expectedRevision: string
  ): Promise<VersionControlCreateReferenceOutput> {
    return this.#enqueueMutation(
      session,
      () => this.#createReference(session, input, expectedRevision)
    )
  }

  async #createReference(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateReferenceInput,
    expectedRevision: string
  ): Promise<VersionControlCreateReferenceOutput> {
    const captured = await this.#captureState(session)
    assertMatchingRevision(captured.revision, expectedRevision)
    const target = await resolveObjectish(session.repositoryRoot, input.target)
    const encodedName = createHash('sha256').update(input.name, 'utf8').digest('hex')
    const ref = `${REFERENCE_REF_PREFIX}${encodedName}`
    await runGit(
      session.repositoryRoot,
      ['update-ref', ref, target, ...(input.force ? [] : [''])],
      { timeout: 10_000 }
    )
    return { name: input.name, target }
  }

  async listSnapshots(
    session: VersionControlWorkspaceSession,
    input: VersionControlListSnapshotsInput
  ): Promise<VersionControlListSnapshotsOutput> {
    const result = await runGit(session.repositoryRoot, [
      'for-each-ref',
      '--sort=-refname',
      '--format=%(refname)%00%(objectname)%00%(creatordate:iso-strict)%00%(subject)',
      SNAPSHOT_REF_PREFIX
    ])
    const entries = result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseSnapshotRef)
    const cursorRef = input.cursor ? decodeCursor(input.cursor) : undefined
    const start = cursorRef
      ? Math.max(0, entries.findIndex((entry) => entry.ref === cursorRef) + 1)
      : 0
    if (cursorRef && !entries.some((entry) => entry.ref === cursorRef)) {
      throw new Error('Version-control snapshot cursor is no longer valid.')
    }
    const limit = input.limit ?? 100
    const page = entries.slice(start, start + limit)
    const snapshots = await Promise.all(page.map(async (entry): Promise<VersionControlSnapshot> => ({
      id: entry.commit,
      revision: entry.subject.state?.revision ?? (
        await runGit(session.repositoryRoot, ['show', '-s', '--format=%T', entry.commit])
      ).stdout.trim(),
      createdAt: entry.createdAt,
      ...(entry.subject.label ? { label: entry.subject.label } : {}),
      ...(entry.subject.metadata !== undefined ? { metadata: entry.subject.metadata } : {})
    })))
    const hasMore = start + page.length < entries.length
    return {
      snapshots,
      ...(hasMore && page.length > 0
        ? { nextCursor: encodeCursor(page[page.length - 1].ref) }
        : {})
    }
  }

  async diff(
    session: VersionControlWorkspaceSession,
    input: VersionControlDiffInput
  ): Promise<VersionControlTextOutput> {
    const from = await this.#resolveTreeish(session, input.from)
    const to = input.to
      ? await this.#resolveTreeish(session, input.to)
      : (await this.#captureState(session)).tree
    const paths = normalizeWorkspacePaths(input.paths)
    const result = await runGit(session.workspaceRoot, [
      'diff',
      '--binary',
      '--no-ext-diff',
      '--relative',
      from,
      to,
      '--',
      ...(paths.length > 0 ? paths : ['.'])
    ], { maxBuffer: VERSION_CONTROL_LIMITS.maxTextCharacters * 4 })
    return boundedText(result.stdout, input.maxCharacters)
  }

  async readFile(
    session: VersionControlWorkspaceSession,
    input: VersionControlReadFileInput
  ): Promise<VersionControlReadFileOutput> {
    const revision = await this.#resolveTreeish(session, input.revision)
    const path = normalizeWorkspacePath(input.path)
    const repositoryPath = toRepositoryPath(session, path)
    const result = await runGit(
      session.repositoryRoot,
      ['show', `${revision}:${repositoryPath}`],
      { maxBuffer: VERSION_CONTROL_LIMITS.maxTextCharacters * 4 }
    )
    const bounded = boundedText(result.stdout, input.maxCharacters)
    return { content: bounded.text, truncated: bounded.truncated }
  }

  async restore(
    session: VersionControlWorkspaceSession,
    input: VersionControlRestoreInput,
    expectedRevision: string
  ): Promise<VersionControlRestoreOutput> {
    return this.#enqueueMutation(
      session,
      () => this.#restore(session, input, expectedRevision)
    )
  }

  async #restore(
    session: VersionControlWorkspaceSession,
    input: VersionControlRestoreInput,
    expectedRevision: string
  ): Promise<VersionControlRestoreOutput> {
    const captured = await this.#captureState(session)
    assertMatchingRevision(captured.revision, expectedRevision)
    const targetObject = await resolveObjectish(session.repositoryRoot, input.target)
    const snapshotState = await readSnapshotState(session.repositoryRoot, targetObject)
    if (snapshotState?.revision === captured.revision) {
      return { ok: true, revision: captured.revision }
    }
    const target = snapshotState?.worktreeTree ??
      await this.#resolveTreeish(session, input.target)
    if (input.paths !== undefined && input.paths.length === 0) {
      throw new Error('Version-control restore paths cannot be empty.')
    }
    const paths = normalizeWorkspacePaths(input.paths)
    if (input.paths === undefined) {
      if (snapshotState) {
        await this.#restoreSnapshotState(session, snapshotState)
      } else {
        await runGit(
          session.workspaceRoot,
          ['restore', '--source', target, '--staged', '--worktree', '--', '.'],
          { timeout: 30_000 }
        )
        await runGit(session.workspaceRoot, ['clean', '-fd', '--', '.'], { timeout: 30_000 })
      }
    } else {
      await this.#restorePaths(session, target, paths)
    }
    return { ok: true, revision: await this.revision(session) }
  }

  async #restoreSnapshotState(
    session: VersionControlWorkspaceSession,
    state: NonNullable<SnapshotSubject['state']>
  ): Promise<void> {
    const currentHead = await resolveOptionalHead(session.repositoryRoot)
    if (currentHead !== state.baseHead) {
      throw new Error(
        'The Git HEAD changed after this snapshot; restore was blocked to preserve index semantics.'
      )
    }
    await Promise.all([
      resolveTreeish(session.repositoryRoot, state.baseTree),
      resolveTreeish(session.repositoryRoot, state.indexTree),
      resolveTreeish(session.repositoryRoot, state.worktreeTree)
    ])
    await runGit(
      session.workspaceRoot,
      ['restore', '--source', state.baseTree, '--staged', '--worktree', '--', '.'],
      { timeout: 30_000 }
    )
    await runGit(session.workspaceRoot, ['clean', '-fd', '--', '.'], { timeout: 30_000 })
    await runGit(
      session.workspaceRoot,
      ['restore', '--source', state.indexTree, '--staged', '--', '.'],
      { timeout: 30_000 }
    )
    await runGit(
      session.workspaceRoot,
      ['restore', '--source', state.worktreeTree, '--worktree', '--', '.'],
      { timeout: 30_000 }
    )
  }

  async #restorePaths(
    session: VersionControlWorkspaceSession,
    target: string,
    paths: readonly string[]
  ): Promise<void> {
    const present: string[] = []
    const absent: string[] = []
    for (const path of paths) {
      const repositoryPath = toRepositoryPath(session, path)
      const exists = await runGit(
        session.repositoryRoot,
        ['cat-file', '-e', `${target}:${repositoryPath}`],
        { allowFailure: true }
      )
      ;(exists.ok ? present : absent).push(path)
    }
    if (present.length > 0) {
      await runGit(
        session.workspaceRoot,
        ['restore', '--source', target, '--staged', '--worktree', '--', ...present],
        { timeout: 30_000 }
      )
    }
    if (absent.length > 0) {
      await runGit(
        session.workspaceRoot,
        ['rm', '-r', '-f', '--ignore-unmatch', '--', ...absent],
        { timeout: 30_000 }
      )
    }
    await runGit(session.workspaceRoot, ['clean', '-fd', '--', ...paths], { timeout: 30_000 })
  }

  async #captureState(session: VersionControlWorkspaceSession): Promise<{
    tree: string
    baseTree: string
    head?: string
    revision: string
    status: string
  }> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'sciforge-version-control-'))
    const indexPath = join(temporaryRoot, 'index')
    try {
      const head = await resolveOptionalHead(session.repositoryRoot)
      await runGit(
        session.repositoryRoot,
        ['read-tree', ...(head ? [head] : ['--empty'])],
        { env: { GIT_INDEX_FILE: indexPath } }
      )
      const baseTree = (
        await runGit(session.repositoryRoot, ['write-tree'], {
          env: { GIT_INDEX_FILE: indexPath }
        })
      ).stdout.trim()
      await runGit(
        session.workspaceRoot,
        ['add', '-A', '--', '.'],
        { timeout: 30_000, env: { GIT_INDEX_FILE: indexPath } }
      )
      const tree = (
        await runGit(session.repositoryRoot, ['write-tree'], {
          env: { GIT_INDEX_FILE: indexPath }
        })
      ).stdout.trim()
      const [status, indexEntries] = await Promise.all([
        runGit(session.workspaceRoot, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          '.'
        ], { maxBuffer: MAX_STATUS_BUFFER_BYTES }),
        runGit(
          session.workspaceRoot,
          ['ls-files', '--stage', '-z', '--', '.'],
          { maxBuffer: MAX_STATUS_BUFFER_BYTES }
        )
      ])
      const revision = `vc1:${createHash('sha256')
        .update(head ?? '<unborn>')
        .update('\0')
        .update(tree)
        .update('\0')
        .update(indexEntries.stdout)
        .update('\0')
        .update(status.stdout)
        .digest('hex')}`
      this.#revisionTrees.set(`${session.resourceId}\0${revision}`, tree)
      if (this.#revisionTrees.size > 2_048) {
        const oldest = this.#revisionTrees.keys().next().value
        if (oldest) this.#revisionTrees.delete(oldest)
      }
      return {
        tree,
        baseTree,
        ...(head ? { head } : {}),
        revision,
        status: status.stdout
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }

  async #resolveTreeish(
    session: VersionControlWorkspaceSession,
    revision: string
  ): Promise<string> {
    const rememberedTree = this.#revisionTrees.get(`${session.resourceId}\0${revision}`)
    if (rememberedTree) return rememberedTree
    return resolveTreeish(session.repositoryRoot, revision)
  }

  async #enqueueMutation<Result>(
    session: VersionControlWorkspaceSession,
    operation: () => Promise<Result>
  ): Promise<Result> {
    const previous = this.#mutationQueues.get(session.resourceId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveQueue) => {
      release = resolveQueue
    })
    this.#mutationQueues.set(session.resourceId, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#mutationQueues.get(session.resourceId) === current) {
        this.#mutationQueues.delete(session.resourceId)
      }
    }
  }
}

async function resolveOptionalHead(repositoryRoot: string): Promise<string | undefined> {
  const result = await runGit(
    repositoryRoot,
    ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'],
    { allowFailure: true }
  )
  return result.ok ? result.stdout.trim() : undefined
}

async function resolveTreeish(repositoryRoot: string, rawRevision: string): Promise<string> {
  const revision = rawRevision.trim()
  if (!revision || revision.includes('\0')) throw new Error('Invalid version-control revision.')
  const result = await runGit(
    repositoryRoot,
    ['rev-parse', '--verify', '--end-of-options', `${revision}^{tree}`],
    { allowFailure: true }
  )
  if (!result.ok) throw new Error(`Unknown version-control revision: ${revision}`)
  return result.stdout.trim()
}

async function resolveObjectish(repositoryRoot: string, rawRevision: string): Promise<string> {
  const revision = rawRevision.trim()
  if (!revision || revision.includes('\0')) throw new Error('Invalid version-control revision.')
  const result = await runGit(
    repositoryRoot,
    ['rev-parse', '--verify', '--end-of-options', `${revision}^{object}`],
    { allowFailure: true }
  )
  if (!result.ok) throw new Error(`Unknown version-control revision: ${revision}`)
  return result.stdout.trim()
}

function assertMatchingRevision(actualRevision: string, expectedRevision: string): void {
  if (actualRevision !== expectedRevision) {
    throw Object.assign(new Error('The version-control workspace revision is stale.'), {
      code: 'revision_conflict',
      expectedRevision,
      actualRevision
    })
  }
}

function normalizeWorkspacePaths(rawPaths: readonly string[] | undefined): string[] {
  if (!rawPaths) return []
  return [...new Set(rawPaths.map(normalizeWorkspacePath))]
}

function normalizeWorkspacePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\0') || isAbsolute(rawPath)) {
    throw new Error('Version-control paths must be relative to the workspace.')
  }
  const path = normalize(rawPath)
  if (path === '.' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error('Version-control paths must stay inside the workspace.')
  }
  return path
}

function toRepositoryPath(
  session: VersionControlWorkspaceSession,
  workspacePath: string
): string {
  const prefix = relative(session.repositoryRoot, session.workspaceRoot)
  return prefix ? join(prefix, workspacePath) : workspacePath
}

function toWorkspaceRelativeStatusPath(
  session: VersionControlWorkspaceSession,
  repositoryPath: string
): string {
  const prefix = relative(session.repositoryRoot, session.workspaceRoot)
    .split(sep)
    .join('/')
  if (!prefix) return repositoryPath
  const scopedPrefix = `${prefix}/`
  if (!repositoryPath.startsWith(scopedPrefix)) {
    throw new Error('Git returned a status path outside the workspace.')
  }
  return repositoryPath.slice(scopedPrefix.length)
}

function assertPathInside(root: string, path: string, label: string): void {
  const pathFromRoot = relative(root, path)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must stay inside the Git repository.`)
  }
}

function parsePorcelainStatus(raw: string): {
  changes: VersionControlChange[]
  truncated: boolean
} {
  const fields = raw.split('\0')
  const changes: VersionControlChange[] = []
  for (let index = 0; index < fields.length;) {
    const entry = fields[index++]
    if (!entry) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    const renamedOrCopied = code.includes('R') || code.includes('C')
    const previousPath = renamedOrCopied ? fields[index++] : undefined
    changes.push({
      path,
      status: mapStatus(code),
      ...(previousPath ? { previousPath } : {})
    })
    if (changes.length === VERSION_CONTROL_LIMITS.maxResultItems) {
      return { changes, truncated: index < fields.length - 1 }
    }
  }
  return { changes, truncated: false }
}

function mapStatus(code: string): VersionControlChange['status'] {
  if (
    code.includes('U') ||
    code === 'AA' ||
    code === 'DD'
  ) return 'conflicted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code === '??') return 'untracked'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

function encodeSnapshotSubject(
  input: VersionControlCreateSnapshotInput,
  state: NonNullable<SnapshotSubject['state']>
): string {
  const payload: SnapshotSubject = {
    ...(input.label ? { label: input.label } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    state
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const subject = `${SNAPSHOT_SUBJECT_PREFIX}${encoded}`
  if (subject.length > MAX_SNAPSHOT_SUBJECT_CHARACTERS) {
    throw new Error('Version-control snapshot metadata is too large.')
  }
  return subject
}

async function readSnapshotState(
  repositoryRoot: string,
  revision: string
): Promise<SnapshotSubject['state'] | undefined> {
  const type = await runGit(
    repositoryRoot,
    ['cat-file', '-t', revision],
    { allowFailure: true }
  )
  if (!type.ok || type.stdout.trim() !== 'commit') return undefined
  const subject = (
    await runGit(repositoryRoot, ['show', '-s', '--format=%s', revision])
  ).stdout.trim()
  if (!subject.startsWith(SNAPSHOT_SUBJECT_PREFIX)) return undefined
  return parseEncodedSnapshotSubject(subject).state
}

function parseSnapshotRef(line: string): {
  ref: string
  commit: string
  createdAt: string
  subject: SnapshotSubject
} {
  const [ref, commit, createdAt, rawSubject] = line.split('\0')
  if (!ref || !commit || !createdAt || !rawSubject?.startsWith(SNAPSHOT_SUBJECT_PREFIX)) {
    throw new Error('Invalid SciForge snapshot reference.')
  }
  const subject = parseEncodedSnapshotSubject(rawSubject)
  return { ref, commit, createdAt, subject }
}

function parseEncodedSnapshotSubject(rawSubject: string): SnapshotSubject {
  if (!rawSubject.startsWith(SNAPSHOT_SUBJECT_PREFIX)) {
    throw new Error('Invalid SciForge snapshot metadata.')
  }
  return JSON.parse(
    Buffer.from(rawSubject.slice(SNAPSHOT_SUBJECT_PREFIX.length), 'base64url').toString('utf8')
  ) as SnapshotSubject
}

function encodeCursor(ref: string): string {
  return Buffer.from(ref, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  const ref = Buffer.from(cursor, 'base64url').toString('utf8')
  if (!ref.startsWith(SNAPSHOT_REF_PREFIX)) {
    throw new Error('Invalid version-control snapshot cursor.')
  }
  return ref
}

function boundedText(raw: string, requestedLimit: number | undefined): VersionControlTextOutput {
  const maxCharacters = Math.min(
    VERSION_CONTROL_LIMITS.maxTextCharacters,
    requestedLimit ?? DEFAULT_TEXT_LIMIT
  )
  return {
    text: raw.slice(0, maxCharacters),
    truncated: raw.length > maxCharacters
  }
}

async function runGit(
  cwd: string,
  args: readonly string[],
  options: Readonly<{
    timeout?: number
    maxBuffer?: number
    env?: Readonly<Record<string, string>>
    allowFailure?: boolean
  }> = {}
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout: options.timeout ?? 10_000,
      maxBuffer: options.maxBuffer ?? VERSION_CONTROL_LIMITS.maxTextCharacters * 2,
      env: {
        ...process.env,
        LC_ALL: 'C',
        LANG: 'C',
        ...options.env
      }
    })
    return { ok: true, stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    if (options.allowFailure) {
      const stderr = (error as { stderr?: unknown }).stderr
      return {
        ok: false,
        stdout: String((error as { stdout?: unknown }).stdout ?? ''),
        stderr: String(stderr || (error instanceof Error ? error.message : error))
      }
    }
    throw error
  }
}
