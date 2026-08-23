import { createHash, randomBytes } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'

import {
  OPENCONTENT_CLI_ADMITTED_COMMANDS,
  openContentCliInvocationSchema,
  openContentCliConnectionMaterialSchema,
  OPENCONTENT_CLI_MAX_STDERR_BYTES,
  OPENCONTENT_CLI_MAX_STDOUT_BYTES,
  OPENCONTENT_CLI_RUNNER_PROTOCOL,
  type OpenContentCliCommand,
  type OpenContentCliProcessPort,
  type OpenContentCliProcessRequest
} from './cli-runner.js'
import {
  DOCFLOW_COMMAND_RESULT_PROTOCOL,
  DOCFLOW_NATIVE_DOCUMENT_COMMANDS,
  type DocflowCommand,
  type DocflowDataFile
} from '../supplier-docflow-protocol.js'
import {
  OPENCONTENT_CLI_RESULT_PROTOCOL,
  openContentExtendedCommandSuccessSchema,
  type OpenContentExtendedDataFile
} from '../supplier-extended-operation-protocol.js'
import {
  isOpenContentSupplierMutationCommand,
  type OpenContentSupplierInvocation
} from '../main-contract.js'
import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR,
  type OpenContentSkillRuntimeFileIntegrity,
  type OpenContentSkillRuntimeFileRole
} from './bundled-assets.js'
import {
  OpenContentRuntimeSnapshotIntegrityError,
  materializeVerifiedOpenContentRuntimeSnapshot,
  readVerifiedOpenContentRuntimeSnapshot,
  verifiedOpenContentRuntimeFile
} from './verified-runtime-snapshot.internal.js'

const MANAGED_TOKEN_TTL_MS = 10 * 60 * 1_000
const MAX_MANAGED_TOKEN_ENTRIES = 2_048
const MAX_MANAGED_TOKEN_BYTES = 64 * 1024 * 1024
const MAX_MANAGED_JSON_BYTES = 16 * 1024 * 1024
const MAX_TRANSFER_BYTES = 1024 * 1024 * 1024
const TRANSFER_CHUNK_BYTES = 1024 * 1024
const MAX_SENSITIVE_DECODE_ROUNDS = 2
const INVOCATION_CLEANUP_ATTEMPTS = 3
const SENSITIVE_CACHE_OUTPUT_MARKERS = Object.freeze([
  '.token_cache.json',
  '.auth_public_key_cache.json',
  'tokenCacheFile',
  'authPublicKeyCacheFile'
])
const OPENCONTENT_CLI_SOURCE_PATCH_PROTOCOL =
  'sciforge-opencontent-cli-source-patch:v1' as const
const openContentCliSourcePatchSchema = z.object({
  protocol: z.literal(OPENCONTENT_CLI_SOURCE_PATCH_PROTOCOL),
  target: z.literal('cli/bin/oc.js'),
  needle: z.string().min(1).max(4_096),
  replacement: z.string().min(1).max(4_096)
}).strict().superRefine((value, context) => {
  if (value.needle === value.replacement) {
    context.addIssue({
      code: 'custom',
      path: ['replacement'],
      message: 'The fixed source patch must change its target.'
    })
  }
}).readonly()
type OpenContentCliSourcePatch = z.infer<typeof openContentCliSourcePatchSchema>

const admittedCommands = new Set<string>(OPENCONTENT_CLI_ADMITTED_COMMANDS)
const nativeDocumentCommands = new Set<string>(DOCFLOW_NATIVE_DOCUMENT_COMMANDS)

const FORBIDDEN_CALLER_ARGUMENT_KEY_FRAGMENTS = Object.freeze([
  'accesskey',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'encryptionkey',
  'header',
  'password',
  'path',
  'privatekey',
  'secret',
  'session',
  'signingkey',
  'token'
])

const FORBIDDEN_CALLER_ARGUMENT_KEYS = new Set([
  'args',
  'argv',
  'auth',
  'command',
  'cwd',
  'detached',
  'entrypoint',
  'env',
  'environment',
  'executable',
  'execargv',
  'execpath',
  'gid',
  'killsignal',
  'nodeoptions',
  'operationsfile',
  'planfile',
  'selectorfile',
  'shell',
  'signal',
  'stdio',
  'templatefile',
  'uid',
  'windowshide',
  'workingdirectory'
])

const SCRUBBED_RESULT_PATH_KEYS = new Set([
  'editPlanTemplateFile',
  'filePath',
  'filePaths',
  'operationsFile',
  'outputPath',
  'planFile',
  'selectorFile',
  'snapshotPath',
  'templateFile'
])

type ManagedRole = 'probe-template'
type ManagedEntry = Readonly<{
  role: ManagedRole
  name: string
  mediaType: 'application/json'
  bytes: Uint8Array
  expiresAt: number
}>

type ManagedStore = {
  readonly entries: Map<string, ManagedEntry>
  retainedBytes: number
  readonly maxEntries: number
  readonly maxBytes: number
}

type DestinationFile = Extract<
  DocflowDataFile | OpenContentExtendedDataFile,
  { role: 'destination'; encoding: 'managed-stream' }
>

type SourceFile = Extract<
  OpenContentExtendedDataFile,
  { role: 'source'; encoding: 'managed-stream' }
>

type NodeOpenContentCliProcessPortInternalOptions = Readonly<{
  /** Fixed, trusted snapshot entrypoint. Packaged apps must inject their resolved resource path. */
  trustedEntrypoint: string
  /** Fixed Host-provided Node-capable executable. Never taken from an invocation. */
  executablePath?: string
  /** Electron production hosts set this so their executable behaves as Node. */
  electronRunAsNode?: boolean
  /** Trusted test/host root under which per-invocation private directories are created. */
  temporaryRoot?: string
  /** Package-private cleanup seam. Production uses bounded recursive removal. */
  removeInvocationRoot?: (path: string) => Promise<void>
  /** Immutable expected bytes. The public wrapper always injects the package-owned descriptor. */
  trustedSnapshotIntegrity: readonly OpenContentSkillRuntimeFileIntegrity[]
  /** Package-private race seam invoked after verified reads and before private writes. */
  afterSnapshotRead?: () => void | Promise<void>
  /** Package-private test seam. Values may only tighten the fixed production ceilings. */
  managedTokenLimits?: Readonly<{
    maxEntries: number
    maxBytes: number
  }>
  now?: () => number
}>

interface NodeOpenContentCliProcessPort extends OpenContentCliProcessPort {
  /** Removes in-memory, unexpired probe/plan material. */
  dispose(): void
}

type OpenContentCliProcessErrorCode =
  | 'invalid-input'
  | 'blocked-by-contract'
  | 'provider-contract-violation'
  | 'outcome-unknown'
  | 'cancelled'

export class OpenContentCliProcessError extends Error {
  readonly code: OpenContentCliProcessErrorCode
  readonly retry = 'never' as const
  readonly attemptCount = 1 as const
  readonly dispatched: boolean
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean

  constructor(input: Readonly<{
    code: OpenContentCliProcessErrorCode
    message: string
    dispatched: boolean
    stdoutTruncated?: boolean
    stderrTruncated?: boolean
  }>) {
    super(input.message.slice(0, 256))
    this.name = 'OpenContentCliProcessError'
    this.code = input.code
    this.dispatched = input.dispatched
    this.stdoutTruncated = input.stdoutTruncated ?? false
    this.stderrTruncated = input.stderrTruncated ?? false
  }
}

/**
 * The production implementation of the single privileged CLI process seam.
 * Every invocation executes a private copy of the pinned snapshot so its own
 * caches, failure snapshots, and generated plan files cannot touch app assets.
 */
export function createNodeOpenContentCliProcessPortInternal(
  options: NodeOpenContentCliProcessPortInternalOptions
): NodeOpenContentCliProcessPort {
  const trustedEntrypoint = fixedFile(
    options.trustedEntrypoint,
    'OpenContent CLI entrypoint'
  )
  const executablePath = fixedFile(
    options.executablePath ?? process.execPath,
    'Node executable'
  )
  const snapshot = validateSnapshot(
    trustedEntrypoint,
    options.trustedSnapshotIntegrity
  )
  const temporaryRoot = options.temporaryRoot === undefined
    ? tmpdir()
    : fixedDirectory(options.temporaryRoot, 'OpenContent CLI temporary root')
  const removeInvocationRoot = options.removeInvocationRoot ?? (async (path: string) => {
    await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 })
  })
  const now = options.now ?? Date.now
  const maxManagedEntries = options.managedTokenLimits?.maxEntries ?? MAX_MANAGED_TOKEN_ENTRIES
  const maxManagedBytes = options.managedTokenLimits?.maxBytes ?? MAX_MANAGED_TOKEN_BYTES
  if (!Number.isInteger(maxManagedEntries) ||
      maxManagedEntries < 1 ||
      maxManagedEntries > MAX_MANAGED_TOKEN_ENTRIES ||
      !Number.isSafeInteger(maxManagedBytes) ||
      maxManagedBytes < 1 ||
      maxManagedBytes > MAX_MANAGED_TOKEN_BYTES) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The managed DocFlow token limits are invalid.',
      dispatched: false
    })
  }
  const managed: ManagedStore = {
    entries: new Map<string, ManagedEntry>(),
    retainedBytes: 0,
    maxEntries: maxManagedEntries,
    maxBytes: maxManagedBytes
  }

  return Object.freeze({
    async run(rawRequest: OpenContentCliProcessRequest): Promise<unknown> {
      purgeExpired(managed, now())
      const invocation = openContentCliInvocationSchema.parse(rawRequest.invocation)
      assertRequest(rawRequest, invocation, trustedEntrypoint)
      assertActive(rawRequest.signal, rawRequest.deadlineAt, now())

      let invocationRoot: string | undefined
      let dispatched = false
      let principalRevalidationFailed = false
      try {
        invocationRoot = await mkdtemp(join(temporaryRoot, 'sciforge-opencontent-'))
        const runtime = await copyPrivateRuntime(
          snapshot,
          invocationRoot,
          options.afterSnapshotRead
        )
        const materialized = await materializeInvocation({
          invocation,
          invocationRoot,
          managed,
          now,
          signal: rawRequest.signal,
          deadlineAt: rawRequest.deadlineAt
        })
        try {
          await rawRequest.assertPrincipalCurrent()
        } catch (error) {
          principalRevalidationFailed = true
          throw error
        }
        assertActive(rawRequest.signal, rawRequest.deadlineAt, now())

        const execution = await executeOnce({
          executablePath,
          entrypoint: runtime.entrypoint,
          command: invocation.command,
          argsJson: JSON.stringify(materialized.args),
          cwd: invocationRoot,
          connectionMaterial: rawRequest.connectionMaterial,
          electronRunAsNode: options.electronRunAsNode ?? false,
          deadlineAt: rawRequest.deadlineAt,
          signal: rawRequest.signal,
          now,
          stdoutLimit: rawRequest.limits.stdoutBytes,
          stderrLimit: rawRequest.limits.stderrBytes
        })
        dispatched = execution.dispatched

        if (execution.termination !== undefined) {
          throw uncertainExecutionError(invocation.command, execution)
        }
        if (execution.exitCode !== 0) {
          throw uncertainExecutionError(invocation.command, execution)
        }

        const parsed = parseSingleJson(execution.stdout, invocation.command)
        if (!nativeDocumentCommands.has(invocation.command)) {
          validateRawExtendedSupplierResponse(invocation, parsed)
        }
        const captured = await captureOutputs({
          invocation,
          parsed,
          invocationRoot,
          materialized,
          managed,
          now,
          signal: rawRequest.signal,
          deadlineAt: rawRequest.deadlineAt,
          runnerOwnedPaths: Object.freeze([executablePath, temporaryRoot]),
          sensitive: Object.freeze({
            site: rawRequest.connectionMaterial.site,
            systemUserToken: rawRequest.connectionMaterial.systemUserToken
          })
        })
        return buildResult(invocation, captured)
      } catch (error) {
        if (principalRevalidationFailed) throw error
        if (error instanceof OpenContentCliProcessError) throw error
        const mutationOutcomeUnknown = dispatched &&
          isOpenContentSupplierMutationCommand(invocation.command)
        throw new OpenContentCliProcessError({
          code: mutationOutcomeUnknown ? 'outcome-unknown' : 'provider-contract-violation',
          message: mutationOutcomeUnknown
            ? 'The OpenContent write outcome is unknown and will not be retried.'
            : 'The private OpenContent CLI invocation could not be completed.',
          dispatched
        })
      } finally {
        if (invocationRoot !== undefined) {
          await removePrivateInvocationRoot({
            path: invocationRoot,
            command: invocation.command,
            dispatched,
            remove: removeInvocationRoot
          })
        }
      }
    },
    dispose(): void {
      clearManaged(managed)
    }
  })
}

function assertRequest(
  request: OpenContentCliProcessRequest,
  invocation: OpenContentSupplierInvocation,
  trustedEntrypoint: string
): void {
  if (request.protocol !== OPENCONTENT_CLI_RUNNER_PROTOCOL ||
      request.limits.stdoutBytes !== OPENCONTENT_CLI_MAX_STDOUT_BYTES ||
      request.limits.stderrBytes !== OPENCONTENT_CLI_MAX_STDERR_BYTES ||
      !Number.isFinite(Date.parse(request.deadlineAt))) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The OpenContent CLI process request violates its fixed contract.',
      dispatched: false
    })
  }
  openContentCliConnectionMaterialSchema.parse(request.connectionMaterial)
  if (!admittedCommands.has(invocation.command)) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The requested OpenContent CLI command is not admitted.',
      dispatched: false
    })
  }
  let requestedEntrypoint: string
  try {
    requestedEntrypoint = realpathSync(request.entrypoint)
  } catch {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The requested OpenContent CLI entrypoint is not trusted.',
      dispatched: false
    })
  }
  if (requestedEntrypoint !== trustedEntrypoint) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The requested OpenContent CLI entrypoint is not trusted.',
      dispatched: false
    })
  }
  assertSupplierArgumentsAreUnprivileged(invocation.args)
}

function assertSupplierArgumentsAreUnprivileged(args: Record<string, unknown>): void {
  const pending: unknown[] = [args]
  while (pending.length > 0) {
    const candidate = pending.pop()
    if (Array.isArray(candidate)) {
      pending.push(...candidate)
      continue
    }
    if (typeof candidate !== 'object' || candidate === null) continue
    for (const [key, value] of Object.entries(candidate)) {
      const normalizedKey = key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '')
      if (
        FORBIDDEN_CALLER_ARGUMENT_KEYS.has(normalizedKey) ||
        FORBIDDEN_CALLER_ARGUMENT_KEY_FRAGMENTS.some((fragment) =>
          normalizedKey.includes(fragment)
        )
      ) {
        throw new OpenContentCliProcessError({
          code: 'invalid-input',
          message: 'Supplier arguments may contain only unprivileged business data.',
          dispatched: false
        })
      }
      pending.push(value)
    }
  }
}

function assertActive(signal: AbortSignal, deadlineAt: string, now: number): void {
  if (signal.aborted || Date.parse(deadlineAt) <= now) {
    throw new OpenContentCliProcessError({
      code: 'cancelled',
      message: 'The OpenContent CLI invocation was cancelled before dispatch.',
      dispatched: false
    })
  }
}

function fixedFile(path: string, label: string): string {
  if (!isAbsolute(path)) throw new TypeError(`${label} must be absolute.`)
  try {
    const canonical = realpathSync(path)
    if (!statSync(canonical).isFile()) throw new TypeError('not a file')
    return canonical
  } catch {
    throw new TypeError(`${label} is unavailable.`)
  }
}

function fixedDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) throw new TypeError(`${label} must be absolute.`)
  try {
    const canonical = realpathSync(path)
    if (!statSync(canonical).isDirectory()) throw new TypeError('not a directory')
    return canonical
  } catch {
    throw new TypeError(`${label} is unavailable.`)
  }
}

type Snapshot = Readonly<{
  root: string
  trustedRuntimeFiles: readonly OpenContentSkillRuntimeFileIntegrity[]
}>

function validateSnapshot(
  entrypoint: string,
  trustedSnapshotIntegrity: readonly OpenContentSkillRuntimeFileIntegrity[]
): Snapshot {
  const root = resolve(dirname(entrypoint), '..', '..')
  const expectedEntrypoint = fixedFile(join(root, 'cli', 'bin', 'oc.js'), 'OpenContent CLI entrypoint')
  if (expectedEntrypoint !== entrypoint) {
    throw new TypeError('OpenContent CLI entrypoint has an invalid snapshot layout.')
  }
  const docflowEntrypoint = fixedFile(
    join(root, 'cli', 'docflow', 'docflow-node.cjs'),
    'OpenContent DocFlow entrypoint'
  )
  const docflowProbeHelper = fixedFile(
    join(root, 'scripts', 'docflow-probe-compact.cjs'),
    'OpenContent structural DocFlow probe helper'
  )
  const packageJson = fixedFile(join(root, 'package.json'), 'OpenContent snapshot package manifest')
  const singleAttemptPatch = fixedFile(
    join(
      root,
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliSingleAttemptPatchRelativePath
    ),
    'OpenContent CLI single-attempt patch'
  )
  const expectedPaths = new Map<OpenContentSkillRuntimeFileRole, string>([
    ['cli-entrypoint', OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliEntrypointRelativePath],
    ['docflow-entrypoint', OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.docflowEntrypointRelativePath],
    ['docflow-probe-helper', OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.docflowProbeHelperRelativePath],
    ['package-manifest', OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packageJsonRelativePath],
    [
      'cli-single-attempt-patch',
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliSingleAttemptPatchRelativePath
    ]
  ])
  const trustedRuntimeFiles = new Map<
    OpenContentSkillRuntimeFileRole,
    OpenContentSkillRuntimeFileIntegrity
  >()
  for (const file of trustedSnapshotIntegrity) {
    if (expectedPaths.get(file.role) !== file.relativePath ||
      trustedRuntimeFiles.has(file.role) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size) || file.size < 1) {
      throw new TypeError('OpenContent snapshot integrity descriptor is invalid.')
    }
    trustedRuntimeFiles.set(file.role, Object.freeze({ ...file }))
  }
  if (trustedRuntimeFiles.size !== expectedPaths.size) {
    throw new TypeError('OpenContent snapshot integrity descriptor is incomplete.')
  }
  return Object.freeze({
    root,
    trustedRuntimeFiles: Object.freeze([...trustedRuntimeFiles.values()])
  })
}

async function copyPrivateRuntime(
  snapshot: Snapshot,
  invocationRoot: string,
  afterSnapshotRead?: () => void | Promise<void>
): Promise<Readonly<{
  root: string
  entrypoint: string
}>> {
  try {
    const verified = await readVerifiedOpenContentRuntimeSnapshot({
      root: snapshot.root,
      trustedRuntimeFiles: snapshot.trustedRuntimeFiles
    })
    await afterSnapshotRead?.()
    const source = verifiedOpenContentRuntimeFile(verified, 'cli-entrypoint').toString('utf8')
    const sourcePatch = loadFixedSourcePatch(
      verifiedOpenContentRuntimeFile(verified, 'cli-single-attempt-patch')
    )
    const patchedSource = applyFixedSingleMatchPatch(source, sourcePatch)
    return await materializeVerifiedOpenContentRuntimeSnapshot({
      destinationRoot: join(invocationRoot, 'runtime'),
      snapshot: verified,
      cliEntrypointBytes: Buffer.from(patchedSource, 'utf8')
    })
  } catch (error) {
    if (error instanceof OpenContentCliProcessError) throw error
    if (!(error instanceof OpenContentRuntimeSnapshotIntegrityError)) throw error
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The pinned OpenContent CLI snapshot integrity check failed.',
      dispatched: false
    })
  }
}

function loadFixedSourcePatch(bytes: Uint8Array): OpenContentCliSourcePatch {
  try {
    return Object.freeze(openContentCliSourcePatchSchema.parse(
      JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    ))
  } catch {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The pinned OpenContent CLI source patch is invalid.',
      dispatched: false
    })
  }
}

function applyFixedSingleMatchPatch(
  source: string,
  patch: OpenContentCliSourcePatch
): string {
  const matchAt = source.indexOf(patch.needle)
  if (matchAt < 0 || source.indexOf(patch.needle, matchAt + patch.needle.length) >= 0) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The pinned OpenContent CLI auth-retry guard no longer matches.',
      dispatched: false
    })
  }
  const prefix = source.slice(0, matchAt)
  const suffix = source.slice(matchAt + patch.needle.length)
  const patchedSource = `${prefix}${patch.replacement}${suffix}`
  if (patchedSource.slice(0, matchAt) !== prefix ||
      patchedSource.slice(matchAt, matchAt + patch.replacement.length) !== patch.replacement ||
      patchedSource.slice(matchAt + patch.replacement.length) !== suffix ||
      patchedSource.includes(patch.needle)) {
    throw new OpenContentCliProcessError({
      code: 'blocked-by-contract',
      message: 'The pinned OpenContent CLI auth-retry guard could not be applied.',
      dispatched: false
    })
  }
  return patchedSource
}

type MaterializedInvocation = Readonly<{
  args: Record<string, unknown>
  planOutput?: string
  destination?: Readonly<{ file: DestinationFile; outputPath: string }>
  knownPaths: readonly string[]
}>

async function materializeInvocation(input: Readonly<{
  invocation: OpenContentSupplierInvocation
  invocationRoot: string
  managed: ManagedStore
  now: () => number
  signal: AbortSignal
  deadlineAt: string
}>): Promise<MaterializedInvocation> {
  const args = JSON.parse(JSON.stringify(input.invocation.args)) as Record<string, unknown>
  normalizeDocflowArgs(input.invocation.command, args)
  const inputsRoot = join(input.invocationRoot, 'inputs')
  const outputsRoot = join(input.invocationRoot, 'outputs')
  await mkdir(inputsRoot, { recursive: true, mode: 0o700 })
  await mkdir(outputsRoot, { recursive: true, mode: 0o700 })

  const knownPaths: string[] = []
  let destination: MaterializedInvocation['destination']
  for (const [index, rawFile] of input.invocation.dataFiles.entries()) {
    assertActive(input.signal, input.deadlineAt, input.now())
    const file = rawFile as DocflowDataFile | OpenContentExtendedDataFile
    if (file.encoding === 'managed-stream' && file.role === 'destination') {
      const outputPath = join(outputsRoot, `${index}-${file.name}`)
      args.outputPath = outputPath
      destination = Object.freeze({ file: file as DestinationFile, outputPath })
      knownPaths.push(outputPath)
      continue
    }

    const name = 'name' in file ? file.name : `${file.role}.json`
    const path = join(inputsRoot, `${index}-${name}`)
    if (file.encoding === 'managed') {
      const entry = consumeManaged(input.managed, file.token, file.role, input.now())
      await writeFile(path, entry.bytes, { flag: 'wx', mode: 0o600 })
    } else if (file.encoding === 'managed-stream' && file.role === 'source') {
      await materializeSource(file as SourceFile, path, input)
    } else {
      const bytes = inlineBytes(file as Exclude<DocflowDataFile, { encoding: 'managed' | 'managed-stream' }>)
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    }
    knownPaths.push(path)
    mapInputRole(args, input.invocation.command, file.role, path)
  }

  let planOutput: string | undefined
  if (input.invocation.command === 'docflow-plan') {
    planOutput = join(outputsRoot, 'document-plan.json')
    args.planFile = planOutput
    knownPaths.push(planOutput)
  }

  return Object.freeze({
    args,
    ...(planOutput === undefined ? {} : { planOutput }),
    ...(destination === undefined ? {} : { destination }),
    knownPaths: Object.freeze(knownPaths)
  })
}

function normalizeDocflowArgs(command: string, args: Record<string, unknown>): void {
  if (!nativeDocumentCommands.has(command)) return
  if (Array.isArray(args.references)) {
    args.referencesJson = JSON.stringify(args.references.map((item) => {
      const reference = item as Record<string, unknown>
      return {
        FileId: reference.fileId,
        ...(reference.systemId === undefined ? {} : { SysId: reference.systemId }),
        ...(reference.description === undefined ? {} : { Content: reference.description })
      }
    }))
    delete args.references
  }
  if (args.target !== undefined) {
    args.target = JSON.stringify(args.target)
  }
  if (args.targets !== undefined) args.targets = JSON.stringify(args.targets)
  if (Array.isArray(args.include)) args.include = args.include.join(',')
  delete args.baseHash

  if (command === 'docflow-image-upload') delete args.source
  if (command === 'docflow-comment-list' && args.status === 'open') args.status = 'normal'
}

function mapInputRole(
  args: Record<string, unknown>,
  command: OpenContentCliCommand,
  role: string,
  path: string
): void {
  switch (role) {
    case 'content':
    case 'image':
      args.filePath = path
      return
    case 'source':
      if (command === 'upload') args.filePaths = path
      else args.filePath = path
      return
    case 'operations':
      args.operationsFile = path
      return
    case 'probe-template':
      args.templateFile = path
      return
    default:
      throw new OpenContentCliProcessError({
        code: 'invalid-input',
        message: 'The data-file role is not supported by this command.',
        dispatched: false
      })
  }
}

function inlineBytes(
  file: Exclude<DocflowDataFile, { encoding: 'managed' | 'managed-stream' }>
): Uint8Array {
  switch (file.encoding) {
    case 'utf8': return Buffer.from(file.content, 'utf8')
    case 'json': return Buffer.from(JSON.stringify(file.content), 'utf8')
    case 'base64': return Buffer.from(file.content, 'base64')
  }
}

async function materializeSource(
  file: SourceFile,
  path: string,
  context: Readonly<{ signal: AbortSignal; deadlineAt: string; now: () => number }>
): Promise<void> {
  if (file.size > MAX_TRANSFER_BYTES) {
    throw new OpenContentCliProcessError({
      code: 'invalid-input',
      message: 'The managed upload exceeds the transfer limit.',
      dispatched: false
    })
  }
  const handle = await open(path, 'wx', 0o600)
  let offset = 0
  try {
    while (offset < file.size) {
      assertActive(context.signal, context.deadlineAt, context.now())
      const requested = Math.min(TRANSFER_CHUNK_BYTES, file.size - offset)
      const chunk = await file.read({ offset, length: requested })
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > requested) {
        throw new OpenContentCliProcessError({
          code: 'invalid-input',
          message: 'The managed upload source returned an invalid chunk.',
          dispatched: false
        })
      }
      let written = 0
      while (written < chunk.byteLength) {
        const result = await handle.write(
          chunk,
          written,
          chunk.byteLength - written,
          null
        )
        if (result.bytesWritten <= 0) {
          throw new OpenContentCliProcessError({
            code: 'invalid-input',
            message: 'The managed upload source could not be materialized.',
            dispatched: false
          })
        }
        written += result.bytesWritten
      }
      offset += chunk.byteLength
    }
  } finally {
    await handle.close()
  }
}

type ExecutionTermination = 'aborted' | 'deadline' | 'stdout-limit' | 'stderr-limit' | 'spawn-error'
type ExecutionResult = Readonly<{
  exitCode: number | null
  stdout: Uint8Array
  stderr: Uint8Array
  stdoutTruncated: boolean
  stderrTruncated: boolean
  dispatched: boolean
  termination?: ExecutionTermination
}>

async function executeOnce(input: Readonly<{
  executablePath: string
  entrypoint: string
  command: string
  argsJson: string
  cwd: string
  connectionMaterial: Readonly<{ site: string; systemUserToken: string }>
  electronRunAsNode: boolean
  deadlineAt: string
  signal: AbortSignal
  now: () => number
  stdoutLimit: number
  stderrLimit: number
}>): Promise<ExecutionResult> {
  return new Promise((resolvePromise) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let dispatched = false
    let termination: ExecutionTermination | undefined

    const environment: NodeJS.ProcessEnv = {
      OPENCONTENT_SITE: input.connectionMaterial.site,
      SYSTEM_USER_TOKEN: input.connectionMaterial.systemUserToken,
      ...(input.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
    const child = spawn(input.executablePath, [
      input.entrypoint,
      '--json',
      input.command,
      input.argsJson
    ], {
      cwd: input.cwd,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    const terminate = (reason: ExecutionTermination) => {
      if (termination !== undefined) return
      termination = reason
      child.kill('SIGKILL')
    }
    const onAbort = () => terminate('aborted')
    input.signal.addEventListener('abort', onAbort, { once: true })
    const remaining = Math.max(0, Date.parse(input.deadlineAt) - input.now())
    const timer = setTimeout(() => terminate('deadline'), Math.min(remaining, 2_147_483_647))

    child.once('spawn', () => { dispatched = true })
    child.once('error', () => { termination = termination ?? 'spawn-error' })
    child.stdout?.on('data', (raw: Buffer) => {
      const remainingBytes = input.stdoutLimit - stdoutBytes
      if (raw.byteLength > remainingBytes) {
        if (remainingBytes > 0) stdoutChunks.push(raw.subarray(0, remainingBytes))
        stdoutBytes += Math.max(0, remainingBytes)
        stdoutTruncated = true
        terminate('stdout-limit')
        return
      }
      stdoutChunks.push(raw)
      stdoutBytes += raw.byteLength
    })
    child.stderr?.on('data', (raw: Buffer) => {
      const remainingBytes = input.stderrLimit - stderrBytes
      if (raw.byteLength > remainingBytes) {
        if (remainingBytes > 0) stderrChunks.push(raw.subarray(0, remainingBytes))
        stderrBytes += Math.max(0, remainingBytes)
        stderrTruncated = true
        terminate('stderr-limit')
        return
      }
      stderrChunks.push(raw)
      stderrBytes += raw.byteLength
    })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      input.signal.removeEventListener('abort', onAbort)
      resolvePromise(Object.freeze({
        exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        stdoutTruncated,
        stderrTruncated,
        dispatched,
        ...(termination === undefined ? {} : { termination })
      }))
    })
  })
}

async function removePrivateInvocationRoot(input: Readonly<{
  path: string
  command: OpenContentCliCommand
  dispatched: boolean
  remove: (path: string) => Promise<void>
}>): Promise<void> {
  for (let attempt = 0; attempt < INVOCATION_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await input.remove(input.path)
      return
    } catch {
      // Retry only this fixed Host-owned path. Never expose the path or underlying error.
    }
  }
  const mutationOutcomeUnknown = input.dispatched &&
    isOpenContentSupplierMutationCommand(input.command)
  throw new OpenContentCliProcessError({
    code: mutationOutcomeUnknown ? 'outcome-unknown' : 'provider-contract-violation',
    message: mutationOutcomeUnknown
      ? 'The OpenContent write outcome is unknown and will not be retried.'
      : 'The private OpenContent invocation could not be cleaned up safely.',
    dispatched: input.dispatched
  })
}

function uncertainExecutionError(
  command: OpenContentCliCommand,
  execution: ExecutionResult
): OpenContentCliProcessError {
  const mutation = isOpenContentSupplierMutationCommand(command) && execution.dispatched
  const cancelled = execution.termination === 'aborted' || execution.termination === 'deadline'
  return new OpenContentCliProcessError({
    code: mutation ? 'outcome-unknown' : cancelled ? 'cancelled' : 'provider-contract-violation',
    message: mutation
      ? 'The OpenContent write outcome is unknown and will not be retried.'
      : cancelled
        ? 'The OpenContent CLI invocation was cancelled.'
        : 'The OpenContent CLI subprocess did not return a valid result.',
    dispatched: execution.dispatched,
    stdoutTruncated: execution.stdoutTruncated,
    stderrTruncated: execution.stderrTruncated
  })
}

function parseSingleJson(bytes: Uint8Array, command: OpenContentCliCommand): unknown {
  const text = Buffer.from(bytes).toString('utf8')
  if (text.trim() === '') {
    throw protocolError(command, 'The OpenContent CLI returned no JSON result.')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw protocolError(command, 'The OpenContent CLI returned invalid JSON.')
  }
}

function protocolError(command: OpenContentCliCommand, message: string): OpenContentCliProcessError {
  return new OpenContentCliProcessError({
    code: isOpenContentSupplierMutationCommand(command)
      ? 'outcome-unknown'
      : 'provider-contract-violation',
    message,
    dispatched: true
  })
}

type CapturedOutputs = Readonly<{
  json: unknown
  managedDataFiles: readonly Readonly<{
    role: ManagedRole
    token: string
    name: string
    mediaType: 'application/json'
  }>[]
}>

async function captureOutputs(input: Readonly<{
  invocation: OpenContentSupplierInvocation
  parsed: unknown
  invocationRoot: string
  materialized: MaterializedInvocation
  managed: ManagedStore
  now: () => number
  signal: AbortSignal
  deadlineAt: string
  runnerOwnedPaths: readonly string[]
  sensitive: Readonly<{ site: string; systemUserToken: string }>
}>): Promise<CapturedOutputs> {
  let json = input.parsed
  const managedDataFiles: Array<{
    role: ManagedRole
    token: string
    name: string
    mediaType: 'application/json'
  }> = []
  const parsedRecord = asRecord(input.parsed)

  const probeTemplateFile = input.invocation.command === 'docflow-probe' &&
      parsedRecord !== undefined && parsedRecord.success !== false
    ? pinnedProbeTemplateFile(input.invocation, parsedRecord)
    : undefined
  if (probeTemplateFile !== undefined) {
    const descriptor = await captureManagedPath(
      input.managed,
      input.invocationRoot,
      probeTemplateFile,
      'probe-template',
      'probe-template.json',
      input.now()
    )
    managedDataFiles.push(descriptor)
  }
  if (input.invocation.command === 'docflow-plan') {
    if (input.materialized.planOutput === undefined ||
        parsedRecord === undefined ||
        !isPinnedPlanResult(input.invocation, parsedRecord)) {
      throw protocolError(input.invocation.command, 'DocFlow did not produce an applicable plan.')
    }
    await validateDisposablePlan(
      input.invocationRoot,
      input.materialized.planOutput,
      input.invocation.command
    )
  }

  if (input.materialized.destination !== undefined) {
    assertActive(input.signal, input.deadlineAt, input.now())
    const delivered = await deliverOutput(
      input.materialized.destination,
      input.invocationRoot,
      parsedRecord,
      outputMediaType(input.invocation, parsedRecord),
      input
    )
    json = {
      ...(parsedRecord ?? {}),
      bytesWritten: delivered.bytesWritten,
      sha256: delivered.sha256,
      name: delivered.name,
      mediaType: delivered.mediaType
    }
  }

  return Object.freeze({
    json: scrubPaths(
      json,
      Object.freeze([
        ...input.materialized.knownPaths,
        ...input.runnerOwnedPaths
      ]),
      input.invocationRoot,
      input.sensitive,
      input.invocation.command
    ),
    managedDataFiles: Object.freeze(managedDataFiles)
  })
}

function pinnedProbeTemplateFile(
  invocation: OpenContentSupplierInvocation,
  output: Record<string, unknown>
): string | undefined {
  const args = asRecord(invocation.args)
  const probe = asRecord(output.probe)
  const capabilities = asRecord(probe?.capabilities)
  const truncation = asRecord(output.truncation)
  const matches = Array.isArray(probe?.matches) ? probe.matches : undefined
  const total = truncation?.total
  const returned = truncation?.returned
  const valid = output.success === true &&
    output.operation === 'probe' &&
    output.view === 'target' &&
    !Object.hasOwn(output, 'documentHash') &&
    !Object.hasOwn(output, 'capabilities') &&
    !Object.hasOwn(output, 'selection') &&
    typeof args?.fileId === 'string' &&
    output.fileId === args.fileId &&
    probe?.schemaVersion === 1 &&
    probe.fileId === args.fileId &&
    hashString(probe.documentHash) !== undefined &&
    typeof args.operation === 'string' &&
    capabilities?.requestedOperation === args.operation &&
    typeof capabilities.supported === 'boolean' &&
    matches !== undefined &&
    Number.isSafeInteger(total) &&
    typeof total === 'number' && total >= 0 &&
    Number.isSafeInteger(returned) &&
    typeof returned === 'number' && returned === matches.length &&
    total === returned &&
    truncation?.truncated === false
  if (!valid) {
    throw protocolError(
      invocation.command,
      'DocFlow returned an unbound or truncated probe result.'
    )
  }
  if (capabilities.supported === false) return undefined
  if (matches.length !== 1 || asRecord(matches[0]) === undefined ||
    typeof probe.editPlanTemplateFile !== 'string') {
    throw protocolError(
      invocation.command,
      'DocFlow did not return one unambiguous managed probe template.'
    )
  }
  return probe.editPlanTemplateFile
}

function isPinnedPlanResult(
  invocation: OpenContentSupplierInvocation,
  output: Record<string, unknown>
): boolean {
  const args = asRecord(invocation.args)
  const report = asRecord(output.report)
  const operationsFile = invocation.dataFiles.find((file) => file.role === 'operations')
  const operationsContent = operationsFile !== undefined &&
      operationsFile.encoding === 'json'
    ? asRecord(operationsFile.content)
    : undefined
  const operations = Array.isArray(operationsContent?.operations)
    ? operationsContent.operations
    : undefined
  return output.success === true &&
    output.operation === 'plan' &&
    !Object.hasOwn(output, 'canApply') &&
    !Object.hasOwn(output, 'baseDocumentHash') &&
    !Object.hasOwn(output, 'documentHash') &&
    typeof args?.fileId === 'string' &&
    output.fileId === args.fileId &&
    typeof output.operationId === 'string' &&
    output.operationId.trim().length > 0 &&
    operations !== undefined &&
    output.operationCount === operations.length &&
    report?.readOnly === true &&
    report.canApply === true &&
    report.baseDocumentHash === args.baseHash &&
    hashString(report.resultDocumentHash) !== undefined
}

async function captureManagedPath(
  managed: ManagedStore,
  invocationRoot: string,
  candidate: string,
  role: ManagedRole,
  name: string,
  now: number
): Promise<Readonly<{ role: ManagedRole; token: string; name: string; mediaType: 'application/json' }>> {
  purgeExpired(managed, now)
  const path = await confinedFile(invocationRoot, candidate)
  const info = await stat(path)
  if (info.size > MAX_MANAGED_JSON_BYTES) {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The managed DocFlow data exceeds its size limit.',
      dispatched: true
    })
  }
  const bytes = await readFile(path)
  try {
    JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The managed DocFlow data is not valid JSON.',
      dispatched: true
    })
  }
  const entry = Object.freeze({
    role,
    name,
    mediaType: 'application/json' as const,
    bytes,
    expiresAt: now + MANAGED_TOKEN_TTL_MS
  })
  const retainedBytes = managedEntryBytes(entry)
  if (managed.entries.size >= managed.maxEntries ||
      retainedBytes > managed.maxBytes - managed.retainedBytes) {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The managed DocFlow token capacity is exhausted.',
      dispatched: true
    })
  }
  const token = `ocdf_${randomBytes(32).toString('base64url')}`
  managed.entries.set(token, entry)
  managed.retainedBytes += retainedBytes
  return Object.freeze({ role, token, name, mediaType: 'application/json' })
}

async function validateDisposablePlan(
  invocationRoot: string,
  candidate: string,
  command: OpenContentCliCommand
): Promise<void> {
  const path = await confinedFile(invocationRoot, candidate)
  const info = await stat(path)
  if (info.size > MAX_MANAGED_JSON_BYTES) {
    throw protocolError(command, 'The DocFlow plan exceeds its size limit.')
  }
  try {
    JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw protocolError(command, 'The DocFlow plan is not valid JSON.')
  }
}

async function deliverOutput(
  destination: Readonly<{ file: DestinationFile; outputPath: string }>,
  invocationRoot: string,
  parsedRecord: Record<string, unknown> | undefined,
  mediaType: string,
  context: Readonly<{ signal: AbortSignal; deadlineAt: string; now: () => number }>
): Promise<Readonly<{ bytesWritten: number; sha256: string; name: string; mediaType: string }>> {
  const childPath = typeof parsedRecord?.filePath === 'string'
    ? parsedRecord.filePath
    : destination.outputPath
  const outputPath = await confinedFile(invocationRoot, childPath)
  const info = await stat(outputPath)
  if (info.size > MAX_TRANSFER_BYTES) {
    throw new OpenContentCliProcessError({
      code: 'outcome-unknown',
      message: 'The OpenContent output exceeds the transfer limit.',
      dispatched: true
    })
  }
  const handle = await open(outputPath, 'r')
  const hash = createHash('sha256')
  let offset = 0
  try {
    while (offset < info.size) {
      assertActiveAfterDispatch(context.signal, context.deadlineAt, context.now())
      const length = Math.min(TRANSFER_CHUNK_BYTES, info.size - offset)
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (bytesRead <= 0) {
        throw new OpenContentCliProcessError({
          code: 'outcome-unknown',
          message: 'The OpenContent output could not be read completely.',
          dispatched: true
        })
      }
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      await destination.file.write(chunk)
      offset += bytesRead
    }
  } catch (error) {
    if (error instanceof OpenContentCliProcessError) throw error
    throw new OpenContentCliProcessError({
      code: 'outcome-unknown',
      message: 'The managed OpenContent output destination failed.',
      dispatched: true
    })
  } finally {
    await handle.close()
  }
  return Object.freeze({
    bytesWritten: offset,
    sha256: hash.digest('hex'),
    name: destination.file.name,
    mediaType
  })
}

function outputMediaType(
  invocation: OpenContentSupplierInvocation,
  parsedRecord: Record<string, unknown> | undefined
): string {
  const reported = [parsedRecord?.contentType, parsedRecord?.mediaType]
    .find((value): value is string => typeof value === 'string' &&
      /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/u.test(value))
    ?.split(';', 1)[0]
  if (invocation.command === 'docflow-export') {
    const format = (invocation.args as { format: 'docx' | 'pdf' | 'md' }).format
    return {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
      md: 'text/markdown'
    }[format]
  }
  if (invocation.command === 'docflow-image-download') {
    if (reported?.startsWith('image/')) return reported
    throw protocolError(invocation.command, 'DocFlow did not return a verified image media type.')
  }
  return reported ?? 'application/octet-stream'
}

function assertActiveAfterDispatch(signal: AbortSignal, deadlineAt: string, now: number): void {
  if (signal.aborted || Date.parse(deadlineAt) <= now) {
    throw new OpenContentCliProcessError({
      code: 'outcome-unknown',
      message: 'The output delivery was interrupted after dispatch.',
      dispatched: true
    })
  }
}

async function confinedFile(root: string, candidate: string): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The CLI returned an invalid managed file.',
      dispatched: true
    })
  }
  let canonical: string
  try {
    canonical = await realpath(candidate)
    const info = await stat(canonical)
    if (!info.isFile()) throw new TypeError('not a file')
  } catch {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The CLI did not produce its managed file.',
      dispatched: true
    })
  }
  const relation = relative(await realpath(root), canonical)
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new OpenContentCliProcessError({
      code: 'provider-contract-violation',
      message: 'The CLI managed file escaped its private directory.',
      dispatched: true
    })
  }
  return canonical
}

function buildResult(
  invocation: OpenContentSupplierInvocation,
  captured: CapturedOutputs
): unknown {
  const record = asRecord(captured.json)
  const structuredDeliveryItems = Array.isArray(record?.structuredDeliveryItems)
    ? record.structuredDeliveryItems
    : []
  if (nativeDocumentCommands.has(invocation.command)) {
    if (record === undefined) {
      throw protocolError(invocation.command, 'DocFlow returned a non-object JSON result.')
    }
    const businessFailure = docflowBusinessFailure(
      invocation.command as DocflowCommand,
      record
    )
    if (businessFailure !== undefined) {
      return Object.freeze({
        protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
        command: invocation.command as DocflowCommand,
        ok: false as const,
        error: businessFailure
      })
    }
    return Object.freeze({
      protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
      command: invocation.command as DocflowCommand,
      ok: true as const,
      json: record,
      structuredDeliveryItems: Object.freeze(structuredDeliveryItems),
      managedDataFiles: captured.managedDataFiles
    })
  }
  return openContentExtendedCommandSuccessSchema.parse({
    protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1 as const,
    outcome: 'succeeded' as const,
    json: captured.json
  })
}

function validateRawExtendedSupplierResponse(
  invocation: OpenContentSupplierInvocation,
  rawJson: unknown
): void {
  openContentExtendedCommandSuccessSchema.parse({
    protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1 as const,
    outcome: 'succeeded' as const,
    json: rawJson
  })
}

function docflowBusinessFailure(
  command: DocflowCommand,
  record: Record<string, unknown>
): Readonly<{
  code: string
  message: string
  stage: 'validation' | 'dispatch' | 'read' | 'write' | 'publish' | 'verify' | 'transport'
  dispatched: true
  expectedHash?: string
  actualHash?: string
}> | undefined {
  const numericResult = typeof record.result === 'number' ? record.result : undefined
  if (record.success !== false && record.ok !== false &&
      (numericResult === undefined || numericResult === 0)) {
    return undefined
  }
  const errorRecord = asRecord(record.error)
  const rawCode = firstString(
    record.code,
    record.errorCode,
    errorRecord?.code,
    numericResult === undefined ? undefined : String(numericResult)
  ) ?? 'OPENCONTENT_PROVIDER_ERROR'
  const code = rawCode.trim().slice(0, 128) || 'OPENCONTENT_PROVIDER_ERROR'
  const message = (firstString(
    record.message,
    record.msg,
    typeof record.error === 'string' ? record.error : undefined,
    errorRecord?.message
  ) ?? 'OpenContent rejected the command.').trim().slice(0, 512)
  const upperCode = code.toUpperCase()
  const suppliedStage = record.stage
  const stage = suppliedStage === 'validation' || suppliedStage === 'dispatch' ||
    suppliedStage === 'read' || suppliedStage === 'write' || suppliedStage === 'publish' ||
    suppliedStage === 'verify' || suppliedStage === 'transport'
    ? suppliedStage
    : upperCode.includes('POSTCOMMIT') || upperCode.includes('VERIFY')
      ? 'verify'
      : upperCode.includes('INVALID') || upperCode === '400'
        ? 'validation'
        : /AUTH|UNAUTHORIZED|NOT_FOUND|PERMISSION/u.test(upperCode)
          ? 'read'
          : isOpenContentSupplierMutationCommand(command)
            ? 'write'
            : 'read'
  const expectedHash = hashString(record.expectedHash ?? errorRecord?.expectedHash)
  const actualHash = hashString(record.actualHash ?? errorRecord?.actualHash)
  return Object.freeze({
    code,
    message,
    stage,
    dispatched: true as const,
    ...(expectedHash === undefined ? {} : { expectedHash }),
    ...(actualHash === undefined ? {} : { actualHash })
  })
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function hashString(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function scrubPaths(
  value: unknown,
  knownPaths: readonly string[],
  invocationRoot: string,
  sensitive: Readonly<{ site: string; systemUserToken: string }>,
  command: OpenContentCliCommand,
  objectPath: readonly string[] = []
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubPaths(
      item,
      knownPaths,
      invocationRoot,
      sensitive,
      command,
      objectPath
    ))
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (containsSensitiveOutputMaterial(key, knownPaths, invocationRoot, sensitive)) {
        throw protocolError(command, 'The OpenContent CLI returned a sensitive object key.')
      }
      if (!SCRUBBED_RESULT_PATH_KEYS.has(key) &&
          !/(?:authorization|cookie|password|secret|systemUserToken|token)$/iu.test(key)) {
        output[key] = scrubPaths(
          item,
          knownPaths,
          invocationRoot,
          sensitive,
          command,
          [...objectPath, key]
        )
      }
    }
    return output
  }
  if (typeof value === 'string') {
    const variants = decodedSensitiveVariants(value)
    if (variants.some((variant) => variant.includes(sensitive.systemUserToken))) {
      return '[redacted]'
    }
    if (variants.some(containsSensitiveCacheMarker)) {
      return '[managed-local-data]'
    }
    if (variants.some((variant) =>
      variant.includes(invocationRoot) || knownPaths.some((path) => variant.includes(path)))) {
      return '[managed-local-data]'
    }
    if (value.includes(sensitive.site)) {
      if (isStructuredDeliveryAccessUrl(objectPath)) {
        return 'https://redacted-provider.invalid/'
      }
      return value.replaceAll(sensitive.site, '[redacted-provider-site]')
    }
    if (variants.some((variant) => variant.includes(sensitive.site))) {
      return '[redacted-provider-site]'
    }
    return value
  }
  return value
}

function isStructuredDeliveryAccessUrl(objectPath: readonly string[]): boolean {
  return objectPath.length >= 3 &&
    objectPath.at(-3) === 'structuredDeliveryItems' &&
    objectPath.at(-2) === 'payload' &&
    objectPath.at(-1) === 'accessUrl'
}

function containsSensitiveOutputMaterial(
  value: string,
  knownPaths: readonly string[],
  invocationRoot: string,
  sensitive: Readonly<{ site: string; systemUserToken: string }>
): boolean {
  return decodedSensitiveVariants(value).some((variant) =>
    variant.includes(sensitive.systemUserToken) ||
    variant.includes(sensitive.site) ||
    variant.includes(invocationRoot) ||
    knownPaths.some((path) => variant.includes(path)) ||
    containsSensitiveCacheMarker(variant))
}

function decodedSensitiveVariants(value: string): readonly string[] {
  const variants = new Set<string>([value])
  let frontier = [value]
  for (let round = 0; round < MAX_SENSITIVE_DECODE_ROUNDS; round += 1) {
    const next: string[] = []
    for (const candidate of frontier) {
      for (const encoded of [candidate, candidate.replaceAll('+', ' ')]) {
        try {
          const decoded = decodeURIComponent(encoded)
          if (!variants.has(decoded)) {
            variants.add(decoded)
            next.push(decoded)
          }
        } catch {
          // Malformed percent escapes are treated as opaque text.
        }
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return Object.freeze([...variants])
}

function containsSensitiveCacheMarker(value: string): boolean {
  const folded = value.toLocaleLowerCase('en-US')
  return SENSITIVE_CACHE_OUTPUT_MARKERS.some((marker) =>
    folded.includes(marker.toLocaleLowerCase('en-US')))
}

function consumeManaged(
  managed: ManagedStore,
  token: string,
  role: ManagedRole,
  now: number
): ManagedEntry {
  const entry = deleteManagedEntry(managed, token)
  if (entry === undefined || entry.expiresAt <= now || entry.role !== role) {
    throw new OpenContentCliProcessError({
      code: 'invalid-input',
      message: 'The managed DocFlow token is invalid, expired, or already consumed.',
      dispatched: false
    })
  }
  return entry
}

function purgeExpired(managed: ManagedStore, now: number): void {
  for (const [token, entry] of managed.entries) {
    if (entry.expiresAt <= now) deleteManagedEntry(managed, token)
  }
}

function deleteManagedEntry(managed: ManagedStore, token: string): ManagedEntry | undefined {
  const entry = managed.entries.get(token)
  if (entry === undefined || !managed.entries.delete(token)) return undefined
  managed.retainedBytes -= managedEntryBytes(entry)
  return entry
}

function clearManaged(managed: ManagedStore): void {
  managed.entries.clear()
  managed.retainedBytes = 0
}

function managedEntryBytes(entry: ManagedEntry): number {
  return entry.bytes.byteLength
}
