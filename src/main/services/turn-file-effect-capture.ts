import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

import type {
  DomainTurnFileEffectIssueV1,
  DomainTurnFileEffectsV1
} from '@sciforge/domain-sdk/host'

export const TURN_FILE_CAPTURE_LIMITS = Object.freeze({
  maxDirectoryEntries: 50_000,
  maxFiles: 20_000,
  maxEffects: 256,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalSnapshotBytes: 16 * 1024 * 1024,
  delayedCaptureMs: 30_000
})

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.sciforge',
  '.sciforge-e2e',
  '.codex-runtime',
  '.claude-code-runtime',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  'target',
  '__pycache__'
])

const SENSITIVE_DIRECTORY_NAMES = new Set([
  '.aws',
  '.azure',
  '.docker',
  '.gnupg',
  '.kube',
  '.ssh',
  'credential',
  'credentials',
  'private-key',
  'private-keys',
  'private_key',
  'private_keys',
  'secret',
  'secrets'
])

const SENSITIVE_FILE_EXTENSIONS = new Set([
  '.jks',
  '.kdbx',
  '.key',
  '.keystore',
  '.p12',
  '.p8',
  '.pfx',
  '.pem',
  '.ppk'
])

const SENSITIVE_EXACT_FILE_NAMES = new Set([
  '_netrc',
  '.authinfo',
  '.envrc',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'netrc',
  'secrets',
  'secrets.json'
])

export type TurnFileMetadataV1 = Readonly<{
  path: string
  dev: string
  ino: string
  size: number
  mtimeNs: string
  ctimeNs: string
}>

export type TurnFileCaptureIssueV1 = Readonly<{
  code: string
  blocking: true
  message: string
  path?: string
}>

export type TurnFileBaselineV1 = Readonly<{
  contractVersion: 1
  capture: 'host-before-turn-metadata'
  capturedAt: string
  digest: string
  files: readonly TurnFileMetadataV1[]
  issues: readonly TurnFileCaptureIssueV1[]
}>

type CaptureClock = () => Date

export type ExactWorkspaceFileReadHooks = Readonly<{
  /** Test seam for proving containment remains valid across path resolution and open. */
  afterInitialRealpath?: (value: Readonly<{
    workspaceRoot: string
    workspaceRelativePath: string
    absolutePath: string
    resolvedPath: string
  }>) => void | Promise<void>
}>

export async function captureTurnFileBaseline(
  workspaceRoot: string,
  now: CaptureClock = () => new Date()
): Promise<TurnFileBaselineV1> {
  const capturedAt = now().toISOString()
  const scan = await scanWorkspaceMetadata(workspaceRoot)
  const body = {
    contractVersion: 1 as const,
    capture: 'host-before-turn-metadata' as const,
    capturedAt,
    files: scan.files,
    issues: scan.issues
  }
  return Object.freeze({
    ...body,
    digest: sha256(canonicalJson(body))
  })
}

export async function captureTurnFileEffects(
  workspaceRoot: string,
  baseline: TurnFileBaselineV1,
  terminalOccurredAt: string,
  now: CaptureClock = () => new Date()
): Promise<DomainTurnFileEffectsV1> {
  const terminalCapturedAt = now().toISOString()
  const current = await scanWorkspaceMetadata(workspaceRoot)
  const issues: DomainTurnFileEffectIssueV1[] = [
    ...baseline.issues,
    ...current.issues
  ]
  const terminalDelay = Date.parse(terminalCapturedAt) - Date.parse(terminalOccurredAt)
  if (Number.isFinite(terminalDelay) && terminalDelay > TURN_FILE_CAPTURE_LIMITS.delayedCaptureMs) {
    issues.push({
      code: 'terminal-capture-delayed',
      blocking: true,
      message: 'Workspace bytes were frozen after a delayed/restarted terminal observation; the snapshots remain exact, but may not represent the provider completion instant.'
    })
  }

  const before = new Map(baseline.files.map((item) => [item.path, item]))
  const after = new Map(current.files.map((item) => [item.path, item]))
  const candidates = [
    ...current.files
      .filter((item) => !sameMetadata(before.get(item.path), item))
      .map((item) => ({
        kind: before.has(item.path) ? 'modified' as const : 'created' as const,
        metadata: item
      })),
    ...baseline.files
      .filter((item) => !after.has(item.path))
      .map((item) => ({ kind: 'deleted' as const, metadata: item }))
  ].sort((left, right) => left.metadata.path.localeCompare(right.metadata.path))

  if (candidates.length > TURN_FILE_CAPTURE_LIMITS.maxEffects) {
    issues.push({
      code: 'file-effect-count-overflow',
      blocking: true,
      message: `The turn changed ${candidates.length} files; only the first ${TURN_FILE_CAPTURE_LIMITS.maxEffects} bounded effects were captured.`
    })
  }

  let totalSnapshotBytes = 0
  const effects: DomainTurnFileEffectsV1['effects'][number][] = []
  for (const candidate of candidates.slice(0, TURN_FILE_CAPTURE_LIMITS.maxEffects)) {
    // This policy intentionally runs before deletion projection, byte limits,
    // realpath, open, hashing, or Base64 encoding. A matching path may be
    // represented by metadata in the short-lived pre-turn baseline, but its
    // content never enters a turn intent, the durable outbox, or Artifact CAS.
    if (isSensitiveWorkspacePath(candidate.metadata.path)) {
      issues.push({
        code: 'sensitive-file-quarantined',
        blocking: true,
        message: 'A changed file matched the Host sensitive-path policy; its content was not read or recorded.',
        path: candidate.metadata.path
      })
      continue
    }
    if (candidate.kind === 'deleted') {
      effects.push(Object.freeze({
        contractVersion: 1,
        kind: 'deleted',
        path: candidate.metadata.path,
        baselineFingerprint: sha256(canonicalJson(candidate.metadata)),
        byteLength: candidate.metadata.size
      }))
      continue
    }
    if (candidate.metadata.size > TURN_FILE_CAPTURE_LIMITS.maxFileBytes) {
      issues.push({
        code: 'file-effect-byte-limit',
        blocking: true,
        message: `Changed file exceeds the ${TURN_FILE_CAPTURE_LIMITS.maxFileBytes}-byte per-file snapshot limit.`,
        path: candidate.metadata.path
      })
      continue
    }
    if (
      totalSnapshotBytes + candidate.metadata.size >
      TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes
    ) {
      issues.push({
        code: 'file-effect-total-byte-limit',
        blocking: true,
        message: `Turn output snapshots exceed the ${TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes}-byte aggregate limit.`,
        path: candidate.metadata.path
      })
      continue
    }
    const frozen = await readExactChangedFile(workspaceRoot, candidate.metadata)
    if (!frozen.ok) {
      issues.push({
        code: 'file-effect-read-failed',
        blocking: true,
        message: frozen.message,
        path: candidate.metadata.path
      })
      continue
    }
    totalSnapshotBytes += frozen.bytes.byteLength
    effects.push(Object.freeze({
      contractVersion: 1,
      kind: candidate.kind,
      path: candidate.metadata.path,
      contentDigest: sha256(frozen.bytes),
      byteLength: frozen.bytes.byteLength,
      mediaType: mediaType(candidate.metadata.path),
      dataBase64: frozen.bytes.toString('base64')
    }))
  }

  return Object.freeze({
    contractVersion: 1,
    capture: 'host-turn-boundary',
    baselineDigest: baseline.digest,
    baselineCapturedAt: baseline.capturedAt,
    terminalCapturedAt,
    effects: Object.freeze(effects),
    issues: Object.freeze(dedupeIssues(issues))
  })
}

/**
 * Captures terminal bytes only for paths declared by authenticated executor
 * patches. No workspace traversal occurs, so unrelated files are never opened,
 * hashed, or Base64 encoded as a side effect of completing a chat turn.
 */
export async function captureDeclaredTurnFileEffects(
  workspaceRoot: string,
  declared: readonly Readonly<{ path: string; operation: 'add' | 'update' | 'delete' }>[],
  terminalOccurredAt: string,
  now: CaptureClock = () => new Date(),
  hooks?: ExactWorkspaceFileReadHooks
): Promise<DomainTurnFileEffectsV1> {
  const terminalCapturedAt = now().toISOString()
  const issues: DomainTurnFileEffectIssueV1[] = []
  const terminalDelay = Date.parse(terminalCapturedAt) - Date.parse(terminalOccurredAt)
  if (Number.isFinite(terminalDelay) && terminalDelay > TURN_FILE_CAPTURE_LIMITS.delayedCaptureMs) {
    issues.push({
      code: 'terminal-capture-delayed',
      blocking: true,
      message: 'Declared output bytes were captured after a delayed terminal observation.'
    })
  }
  const latestByPath = new Map<string, 'add' | 'update' | 'delete'>()
  for (const item of declared) latestByPath.set(item.path, item.operation)
  let totalSnapshotBytes = 0
  const effects: DomainTurnFileEffectsV1['effects'][number][] = []
  for (const [path, operation] of [...latestByPath].sort(([left], [right]) => left.localeCompare(right))) {
    if (isSensitiveWorkspacePath(path)) {
      issues.push({
        code: 'sensitive-file-quarantined', blocking: true,
        message: 'A declared path matched the Host sensitive-path policy; its content was not read or recorded.',
        path
      })
      continue
    }
    if (operation === 'delete') {
      const deletion = await verifyDeclaredDeletion(workspaceRoot, path)
      if (deletion === 'present') {
        issues.push({
          code: 'declared-delete-still-present', blocking: true,
          message: 'A declared delete path was still present at the terminal boundary.', path
        })
      } else if (deletion === 'unverifiable') {
        issues.push({
          code: 'declared-delete-unverifiable', blocking: true,
          message: 'Host could not safely verify a declared deletion.', path
        })
      }
      continue
    }
    const frozen = await readExactWorkspaceFileBytes(workspaceRoot, path, hooks)
    if (!frozen.ok) {
      issues.push({
        code: 'declared-file-read-failed', blocking: true,
        message: 'Host could not freeze a declared terminal output path.', path
      })
      continue
    }
    if (totalSnapshotBytes + frozen.bytes.byteLength > TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes) {
      issues.push({
        code: 'file-effect-total-byte-limit', blocking: true,
        message: `Declared output snapshots exceed the ${TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes}-byte aggregate limit.`,
        path
      })
      continue
    }
    totalSnapshotBytes += frozen.bytes.byteLength
    effects.push(Object.freeze({
      contractVersion: 1,
      kind: operation === 'add' ? 'created' : 'modified',
      path,
      contentDigest: sha256(frozen.bytes),
      byteLength: frozen.bytes.byteLength,
      mediaType: mediaType(path),
      dataBase64: frozen.bytes.toString('base64')
    }))
  }
  return Object.freeze({
    contractVersion: 1,
    capture: 'host-turn-boundary',
    baselineDigest: sha256(canonicalJson({ capture: 'declared-patch-paths', paths: [...latestByPath.keys()].sort() })),
    baselineCapturedAt: terminalOccurredAt,
    terminalCapturedAt,
    effects: Object.freeze(effects),
    issues: Object.freeze(dedupeIssues(issues))
  })
}

async function verifyDeclaredDeletion(
  workspaceRoot: string,
  workspaceRelativePath: string
): Promise<'deleted' | 'present' | 'unverifiable'> {
  if (isSensitiveWorkspacePath(workspaceRelativePath)) return 'unverifiable'
  const root = resolve(workspaceRoot)
  const absolute = resolve(root, ...portable(workspaceRelativePath).split('/'))
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return 'unverifiable'
  try {
    const stats = await lstat(absolute)
    return stats ? 'present' : 'unverifiable'
  } catch (error) {
    const code = errorCode(error)
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'deleted' : 'unverifiable'
  }
}

/**
 * Fail-closed path policy for common credential stores and private-key files.
 * It deliberately uses only normalized workspace-relative path components;
 * sensitive content is never opened to decide whether it is safe.
 */
export function isSensitiveWorkspacePath(workspaceRelativePath: string): boolean {
  const segments = workspaceRelativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLocaleLowerCase('en-US'))
  if (segments.length === 0) return true
  if (segments.slice(0, -1).some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment))) {
    return true
  }
  const basename = segments[segments.length - 1]!
  if (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    /(^|\.)env(?:\.|$)/u.test(basename) ||
    SENSITIVE_EXACT_FILE_NAMES.has(basename) ||
    SENSITIVE_FILE_EXTENSIONS.has(extname(basename))
  ) return true
  if (/(^|[._-])(credentials?|secrets?|private[._-]?keys?)([._-]|$)/u.test(basename)) {
    return true
  }
  return /^service[._-]?account(?:[._-]?key)?\.json$/u.test(basename)
}

async function scanWorkspaceMetadata(workspaceRoot: string): Promise<Readonly<{
  files: readonly TurnFileMetadataV1[]
  issues: readonly TurnFileCaptureIssueV1[]
}>> {
  const root = resolve(workspaceRoot)
  const issues: TurnFileCaptureIssueV1[] = []
  const files: TurnFileMetadataV1[] = []
  const pending = ['']
  let directoryEntries = 0
  while (pending.length > 0) {
    const relativeDirectory = pending.pop()!
    const absoluteDirectory = relativeDirectory ? join(root, relativeDirectory) : root
    let entries
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true })
    } catch (error) {
      issues.push({
        code: 'workspace-scan-read-failed',
        blocking: true,
        message: `Host could not read a workspace directory: ${errorMessage(error)}`,
        ...(relativeDirectory ? { path: portable(relativeDirectory) } : {})
      })
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      directoryEntries += 1
      if (directoryEntries > TURN_FILE_CAPTURE_LIMITS.maxDirectoryEntries) {
        issues.push({
          code: 'workspace-scan-entry-overflow',
          blocking: true,
          message: `Workspace metadata scan exceeded ${TURN_FILE_CAPTURE_LIMITS.maxDirectoryEntries} directory entries.`
        })
        return frozenScan(files, issues)
      }
      const itemPath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name
      if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue
      let stats
      try {
        stats = await lstat(join(root, itemPath), { bigint: true })
      } catch (error) {
        issues.push({
          code: 'workspace-scan-stat-failed',
          blocking: true,
          message: `Host could not stat a workspace entry: ${errorMessage(error)}`,
          path: portable(itemPath)
        })
        continue
      }
      // Never follow symlinked files or directories into an untrusted tree.
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        pending.push(itemPath)
        continue
      }
      if (!stats.isFile()) continue
      if (files.length >= TURN_FILE_CAPTURE_LIMITS.maxFiles) {
        issues.push({
          code: 'workspace-scan-file-overflow',
          blocking: true,
          message: `Workspace metadata scan exceeded ${TURN_FILE_CAPTURE_LIMITS.maxFiles} regular files.`
        })
        return frozenScan(files, issues)
      }
      files.push(Object.freeze(metadata(portable(itemPath), stats)))
    }
  }
  return frozenScan(files, issues)
}

async function readExactChangedFile(
  workspaceRoot: string,
  expected: TurnFileMetadataV1
): Promise<Readonly<{ ok: true; bytes: Buffer } | { ok: false; message: string }>> {
  const frozen = await securelyReadExactWorkspaceFile(workspaceRoot, expected.path, undefined, expected)
  if (frozen.ok) return frozen
  return { ok: false, message: `Host could not freeze changed file bytes: ${frozen.code}.` }
}

export async function freezeExactWorkspaceFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  hooks?: ExactWorkspaceFileReadHooks
): Promise<Readonly<{
  ok: true
  contentDigest: string
  byteLength: number
  mediaType: string
} | {
  ok: false
  code: 'sensitive-path' | 'unsafe-path' | 'not-readable' | 'too-large' | 'changed-during-read'
}>> {
  const normalized = portable(workspaceRelativePath)
  if (isSensitiveWorkspacePath(normalized)) return { ok: false, code: 'sensitive-path' }
  const frozen = await securelyReadExactWorkspaceFile(workspaceRoot, normalized, hooks)
  if (!frozen.ok) return frozen
  return {
    ok: true,
    contentDigest: sha256(frozen.bytes),
    byteLength: frozen.bytes.byteLength,
    mediaType: mediaType(normalized)
  }
}

async function readExactWorkspaceFileBytes(
  workspaceRoot: string,
  workspaceRelativePath: string,
  hooks?: ExactWorkspaceFileReadHooks
): Promise<Readonly<{ ok: true; bytes: Buffer } | { ok: false }>> {
  if (isSensitiveWorkspacePath(workspaceRelativePath)) return { ok: false }
  const frozen = await securelyReadExactWorkspaceFile(workspaceRoot, workspaceRelativePath, hooks)
  return frozen.ok ? frozen : { ok: false }
}

type ExactWorkspaceFileReadFailureCode =
  | 'unsafe-path'
  | 'not-readable'
  | 'too-large'
  | 'changed-during-read'

async function securelyReadExactWorkspaceFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  hooks?: ExactWorkspaceFileReadHooks,
  expected?: TurnFileMetadataV1
): Promise<Readonly<
  | { ok: true; bytes: Buffer }
  | { ok: false; code: ExactWorkspaceFileReadFailureCode }
>> {
  const root = resolve(workspaceRoot)
  const absolute = resolve(root, ...portable(workspaceRelativePath).split('/'))
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return { ok: false, code: 'unsafe-path' }
  let handle
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(absolute)])
    const realRelative = relative(rootReal, fileReal)
    if (!containedRelativePath(realRelative)) return { ok: false, code: 'unsafe-path' }
    const resolvedBeforeOpen = await lstat(absolute, { bigint: true })
    if (!resolvedBeforeOpen.isFile() || resolvedBeforeOpen.isSymbolicLink()) {
      return { ok: false, code: 'not-readable' }
    }
    const initial = metadata(workspaceRelativePath, resolvedBeforeOpen)
    if (expected && !sameMetadata(expected, initial)) {
      return { ok: false, code: 'changed-during-read' }
    }
    if (resolvedBeforeOpen.size > BigInt(TURN_FILE_CAPTURE_LIMITS.maxFileBytes)) {
      return { ok: false, code: 'too-large' }
    }
    await hooks?.afterInitialRealpath?.({
      workspaceRoot: root,
      workspaceRelativePath,
      absolutePath: absolute,
      resolvedPath: fileReal
    })
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || !sameMetadata(initial, metadata(workspaceRelativePath, before))) {
      return { ok: false, code: 'changed-during-read' }
    }
    if (!await openedPathStillContained(rootReal, absolute, workspaceRelativePath, before)) {
      return { ok: false, code: 'unsafe-path' }
    }
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (
      !sameMetadata(initial, metadata(workspaceRelativePath, after)) ||
      bytes.byteLength !== Number(before.size)
    ) return { ok: false, code: 'changed-during-read' }
    if (!await openedPathStillContained(rootReal, absolute, workspaceRelativePath, after)) {
      return { ok: false, code: 'unsafe-path' }
    }
    return { ok: true, bytes }
  } catch {
    return { ok: false, code: 'not-readable' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function openedPathStillContained(
  rootReal: string,
  absolute: string,
  workspaceRelativePath: string,
  descriptorStats: BigIntStats
): Promise<boolean> {
  const [currentReal, currentPathStats] = await Promise.all([
    realpath(absolute),
    lstat(absolute, { bigint: true })
  ])
  if (!containedRelativePath(relative(rootReal, currentReal))) return false
  if (!currentPathStats.isFile() || currentPathStats.isSymbolicLink()) return false
  return sameMetadata(
    metadata(workspaceRelativePath, descriptorStats),
    metadata(workspaceRelativePath, currentPathStats)
  )
}

function containedRelativePath(value: string): boolean {
  return Boolean(value) && value !== '..' && !value.startsWith(`..${sep}`)
}

function metadata(
  path: string,
  stats: Readonly<{
    dev: bigint
    ino: bigint
    size: bigint
    mtimeNs: bigint
    ctimeNs: bigint
  }>
): TurnFileMetadataV1 {
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Workspace file size is outside the safe integer range.')
  return {
    path,
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size,
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  }
}

function sameMetadata(left: TurnFileMetadataV1 | undefined, right: TurnFileMetadataV1): boolean {
  return Boolean(left) &&
    left!.dev === right.dev &&
    left!.ino === right.ino &&
    left!.size === right.size &&
    left!.mtimeNs === right.mtimeNs &&
    left!.ctimeNs === right.ctimeNs
}

function frozenScan(
  files: TurnFileMetadataV1[],
  issues: TurnFileCaptureIssueV1[]
): Readonly<{ files: readonly TurnFileMetadataV1[]; issues: readonly TurnFileCaptureIssueV1[] }> {
  return Object.freeze({
    files: Object.freeze([...files].sort((left, right) => left.path.localeCompare(right.path))),
    issues: Object.freeze(dedupeIssues(issues))
  })
}

function dedupeIssues<T extends TurnFileCaptureIssueV1>(values: readonly T[]): T[] {
  const byKey = new Map(values.map((item) => [
    `${item.code}\0${item.path ?? ''}\0${item.message}`,
    item
  ]))
  return [...byKey.values()]
}

function portable(value: string): string {
  return value.split(sep).join('/')
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.csv': return 'text/csv'
    case '.json': return 'application/json'
    case '.md': return 'text/markdown'
    case '.txt': return 'text/plain'
    case '.ts': return 'text/typescript'
    case '.js': case '.mjs': case '.cjs': return 'text/javascript'
    case '.py': return 'text/x-python'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
