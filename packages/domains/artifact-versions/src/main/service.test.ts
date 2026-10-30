import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cp,
  copyFile,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitInputV2,
  type ArtifactVersionCommitReceiptV1
} from '../contract.js'
import {
  ArtifactVersionService,
  type ArtifactVersionAccessContext
} from './service.js'
import { readVerifiedRegularFileRange } from './safe-files.js'

const SYSTEM_ACCESS: ArtifactVersionAccessContext = Object.freeze({
  audience: 'system',
  callerId: 'artifact-versions:test'
})
type AccessControlledMethod =
  | 'commit'
  | 'commitV2'
  | 'stageBegin'
  | 'stageAppend'
  | 'stageSeal'
  | 'stageAbort'
  | 'observe'
  | 'read'
  | 'readRange'
  | 'describe'
  | 'list'
  | 'materialize'
  | 'restoreAsNew'
  | 'compare'
  | 'exportBundle'
  | 'importBundle'
  | 'listEvents'
  | 'refresh'

type OptionalLastArgument<T> = T extends (
  ...args: [...infer Prefix, infer Last]
) => infer Result
  ? (...args: [...Prefix, Last?]) => Result
  : T

type TrustedTestService = Omit<ArtifactVersionService, AccessControlledMethod> & {
  [Key in AccessControlledMethod]: OptionalLastArgument<ArtifactVersionService[Key]>
}

const ACCESS_CONTROLLED_METHODS = new Set<PropertyKey>([
  'commit',
  'commitV2',
  'stageBegin',
  'stageAppend',
  'stageSeal',
  'stageAbort',
  'observe',
  'read',
  'readRange',
  'describe',
  'list',
  'materialize',
  'restoreAsNew',
  'compare',
  'exportBundle',
  'importBundle',
  'listEvents',
  'refresh'
])

function trustedTestService(service: ArtifactVersionService): TrustedTestService {
  return new Proxy(service, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (!ACCESS_CONTROLLED_METHODS.has(property)) return value.bind(target)
      return (...args: unknown[]) => value.call(
        target,
        ...(args.length >= 3 ? args : [...args, SYSTEM_ACCESS])
      )
    }
  }) as TrustedTestService
}

type Fixture = {
  root: string
  userDataDir: string
  workspace: string
  service: TrustedTestService
}

async function fixture(
  name: string,
  options: Omit<ConstructorParameters<typeof ArtifactVersionService>[0], 'userDataDir'> = {}
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), `artifact-versions-${name}-`))
  const userDataDir = join(root, 'user-data')
  const workspace = join(root, 'workspace')
  await mkdir(userDataDir)
  await mkdir(workspace)
  return {
    root,
    userDataDir,
    workspace,
    service: trustedTestService(new ArtifactVersionService({ userDataDir, ...options }))
  }
}

async function cleanup(value: Fixture): Promise<void> {
  await rm(value.root, { recursive: true, force: true })
}

function snapshot(text: string, mediaType = 'text/plain') {
  return {
    mode: 'snapshot' as const,
    dataBase64: Buffer.from(text).toString('base64'),
    mediaType
  }
}

function valueOf<T>(result: { ok: true; value: T } | { ok: false; issue: unknown }): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  return (result as { ok: true; value: T }).value
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

test('verified ranged reads hash once per stable file identity and remain linear', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-range-linear-'))
  try {
    const path = join(root, 'large-object')
    const bytes = Buffer.alloc(12 * 1024 * 1024)
    bytes.fill(17, 0, 4 * 1024 * 1024)
    bytes.fill(33, 4 * 1024 * 1024, 8 * 1024 * 1024)
    bytes.fill(49, 8 * 1024 * 1024)
    await writeFile(path, bytes)
    const expectedDigest = createHash('sha256').update(bytes).digest('hex')
    let verifiedIdentity: string | undefined
    const ranges: Buffer[] = []
    const fullVerifications: boolean[] = []
    for (let offset = 0; offset < bytes.byteLength; offset += 4 * 1024 * 1024) {
      const range = await readVerifiedRegularFileRange(path, {
        expectedDigest,
        expectedByteLength: bytes.byteLength,
        offset,
        length: 4 * 1024 * 1024,
        ...(verifiedIdentity ? { verifiedIdentity } : {})
      })
      verifiedIdentity = range.verifiedIdentity
      ranges.push(Buffer.from(range.bytes))
      fullVerifications.push(range.fullVerification)
    }
    assert.deepEqual(fullVerifications, [true, false, false])
    assert.equal(
      createHash('sha256').update(Buffer.concat(ranges)).digest('hex'),
      expectedDigest
    )

    const handle = await open(path, 'r+')
    await handle.write(Buffer.from([99]), 0, 1, bytes.byteLength - 1)
    await handle.close()
    await assert.rejects(
      readVerifiedRegularFileRange(path, {
        expectedDigest,
        expectedByteLength: bytes.byteLength,
        offset: 0,
        length: 16,
        verifiedIdentity
      }),
      { code: 'EINTEGRITY' }
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function legacyRegistryPath(f: Fixture): Promise<string> {
  const workspace = await realpath(f.workspace)
  const identity = JSON.stringify({ projectRoot: workspace, workspaceRoot: workspace })
  const scopeKey = `workspace:${digest(identity)}`
  const slug = scopeKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'scope'
  const safeKey = `${slug}-${digest(scopeKey).slice(0, 12)}`
  const directory = join(
    f.userDataDir,
    'evidence-dag',
    'threads',
    'artifact-registries'
  )
  await mkdir(directory, { recursive: true })
  return join(directory, `${safeKey}.json`)
}

async function artifactVersionIndexPath(f: Fixture): Promise<string> {
  const workspaceKey = digest(await realpath(f.workspace))
  return join(
    f.userDataDir,
    'artifact-versions',
    'workspaces',
    workspaceKey,
    'index.v1.json'
  )
}

async function writeSingleLegacySnapshot(
  f: Fixture,
  bytes: string
): Promise<Readonly<{ registryPath: string; objectPath: string }>> {
  const relativePath = 'legacy-result.txt'
  await writeFile(join(f.workspace, relativePath), bytes)
  const registryPath = await legacyRegistryPath(f)
  const artifactId = 'artifact:legacy-capacity'
  const versionId = 'artifact-version:legacy-capacity-v1'
  const legacy = {
    schemaVersion: 'artifact-registry.v1',
    artifacts: [{
      artifactId,
      kind: 'dataset',
      createdAt: '2026-01-01T00:00:00Z',
      currentVersionId: versionId,
      accessPolicy: {}
    }],
    artifactVersions: [{
      versionId,
      artifactId,
      locator: relativePath,
      contentDigest: `sha256:${digest(bytes)}`,
      version: 'v1',
      size: Buffer.byteLength(bytes),
      mediaType: 'text/plain',
      observedAt: '2026-01-01T00:00:00Z',
      availability: 'available',
      retention: 'snapshot',
      historicalLocators: [],
      rebindCandidates: [],
      supersedes: null
    }],
    sourceAnchors: []
  }
  await writeFile(registryPath, `${JSON.stringify(legacy, null, 2)}\n`)
  const workspaceKey = digest(await realpath(f.workspace))
  return {
    registryPath,
    objectPath: join(
      f.userDataDir,
      'artifact-versions',
      'workspaces',
      workspaceKey,
      'objects',
      'sha256',
      digest(bytes).slice(0, 2),
      digest(bytes)
    )
  }
}

test('reports typed 80% capacity warnings without rejecting reads', async () => {
  const f = await fixture('capacity-warning', {
    maxIndexBytes: 8 * 1024,
    maxCasBytes: 10,
    maxActiveStagingBytes: 10
  })
  try {
    valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'capacity-warning-commit',
      candidates: [{
        candidateId: 'capacity-warning',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('12345678')
      }]
    }))
    const usage = valueOf(await f.service.usage(f.workspace))
    assert.equal(usage.cas.usedBytes, 8)
    assert.equal(usage.cas.limitBytes, 10)
    assert.ok(usage.warnings.some((warning) => warning.dimension === 'cas'))
  } finally {
    await cleanup(f)
  }
})

test('CAS hard cap rejects before creating an object or replacing the index', async () => {
  const f = await fixture('capacity-cas-zero-write', {
    maxIndexBytes: 8 * 1024,
    maxCasBytes: 4,
    maxActiveStagingBytes: 1024
  })
  try {
    const indexPath = await artifactVersionIndexPath(f)
    const failed = await f.service.commit(f.workspace, {
      idempotencyKey: 'capacity-cas-failure',
      candidates: [{
        candidateId: 'too-large',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('12345')
      }]
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.ok ? '' : failed.issue.details?.dimension, 'cas')
    await assert.rejects(readFile(indexPath), { code: 'ENOENT' })
    const workspaceKey = digest(await realpath(f.workspace))
    const objectPath = join(
      f.userDataDir,
      'artifact-versions',
      'workspaces',
      workspaceKey,
      'objects',
      'sha256',
      digest('12345').slice(0, 2),
      digest('12345')
    )
    await assert.rejects(readFile(objectPath), { code: 'ENOENT' })
  } finally {
    await cleanup(f)
  }
})

test('active staging hard cap rejects an append before growing staged bytes', async () => {
  const f = await fixture('capacity-stage-zero-write', {
    maxIndexBytes: 8 * 1024,
    maxCasBytes: 1024,
    maxActiveStagingBytes: 4
  })
  try {
    const begun = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'capacity-stage-begin'
    }))
    const bytes = Buffer.from('12345')
    const failed = await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest('12345'),
      dataBase64: bytes.toString('base64')
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.ok ? '' : failed.issue.details?.dimension, 'active-staging')
    const usage = valueOf(await f.service.usage(f.workspace))
    assert.equal(usage.activeStaging.usedBytes, 0)
  } finally {
    await cleanup(f)
  }
})

test('index hard cap rejects before object creation and preserves the last durable index', async () => {
  const f = await fixture('capacity-index-zero-write', {
    maxIndexBytes: 500,
    maxCasBytes: 1024,
    maxActiveStagingBytes: 1024
  })
  try {
    const failed = await f.service.commit(f.workspace, {
      idempotencyKey: 'capacity-index-failure',
      candidates: [{
        candidateId: 'index-too-large',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('x')
      }]
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.ok ? '' : failed.issue.details?.dimension, 'index')
    await assert.rejects(readFile(await artifactVersionIndexPath(f)), { code: 'ENOENT' })
  } finally {
    await cleanup(f)
  }
})

test('legacy migration preflights CAS and index capacity before writing any immutable state', async () => {
  for (const [dimension, budgets] of [
    ['cas', { maxIndexBytes: 8 * 1024, maxCasBytes: 4, maxActiveStagingBytes: 1024 }],
    ['index', { maxIndexBytes: 500, maxCasBytes: 1024, maxActiveStagingBytes: 1024 }]
  ] as const) {
    const f = await fixture(`legacy-capacity-${dimension}`, budgets)
    try {
      const before = await writeSingleLegacySnapshot(f, '12345')
      const originalRegistry = await readFile(before.registryPath, 'utf8')
      const failed = await f.service.list(f.workspace, {})
      assert.equal(failed.ok, false)
      assert.equal(failed.ok ? '' : failed.issue.details?.dimension, dimension)
      await assert.rejects(readFile(await artifactVersionIndexPath(f)), { code: 'ENOENT' })
      await assert.rejects(readFile(before.objectPath), { code: 'ENOENT' })
      assert.equal(await readFile(before.registryPath, 'utf8'), originalRegistry)
    } finally {
      await cleanup(f)
    }
  }
})

test('atomically commits snapshot candidates with pinned intra-batch dependencies', async () => {
  const f = await fixture('atomic')
  try {
    const input: ArtifactVersionCommitInputV1 = {
      idempotencyKey: 'plot-run:atomic:1',
      candidates: [
        {
          candidateId: 'normalized-data',
          expectedCurrentVersionId: null,
          kind: 'dataset',
          label: 'Normalized data',
          intent: 'rerun',
          content: snapshot('x,y\n1,2\n', 'text/csv')
        },
        {
          candidateId: 'figure',
          expectedCurrentVersionId: null,
          kind: 'figure',
          label: 'Figure 1',
          intent: 'rerun',
          content: snapshot('<svg/>', 'image/svg+xml'),
          dependencies: [{
            role: 'input-data',
            target: { kind: 'candidate', candidateId: 'normalized-data' }
          }]
        }
      ]
    }
    const receipt = valueOf(await f.service.commit(f.workspace, input))
    assert.equal(receipt.versions.length, 2)
    const data = receipt.versions.find((item) => item.candidateId === 'normalized-data')!
    const figure = receipt.versions.find((item) => item.candidateId === 'figure')!
    assert.equal(figure.version.dependencies[0]?.target.versionId, data.version.versionId)
    assert.equal(figure.version.dependencies[0]?.target.contentDigest, data.ref.contentDigest)

    const read = valueOf(await f.service.read(f.workspace, {
      versionId: figure.version.versionId
    }))
    assert.equal(Buffer.from(read.dataBase64, 'base64').toString(), '<svg/>')

    const replay = valueOf(await f.service.commit(f.workspace, input))
    assert.equal(replay.idempotentReplay, true)
    assert.equal(replay.transactionId, receipt.transactionId)

    const restarted = trustedTestService(
      new ArtifactVersionService({ userDataDir: f.userDataDir })
    )
    const history = valueOf(await restarted.list(f.workspace, { limit: 10 }))
    assert.equal(history.items.length, 2)
    const events = valueOf(await restarted.listEvents(f.workspace, {}))
    assert.equal(events.events.length, 4)
    assert.deepEqual(events.events.map((event) => event.sequence), [1, 2, 3, 4])
  } finally {
    await cleanup(f)
  }
})

test('identity-selection grant allows atomic deterministic identities and other callers cannot', async () => {
  const f = await fixture('deterministic-identities')
  const requestedArtifactId = `artifact:${digest('workspace-output:figures/result.svg')}`
  const requestedVersionId = `artifact-version:${digest('operation-1:figures/result.svg')}`
  const input: ArtifactVersionCommitInputV2 = {
    idempotencyKey: 'research-checkpoint:atomic-identities:1',
    candidates: [{
      candidateId: 'figure',
      requestedArtifactId,
      requestedVersionId,
      expectedCurrentVersionId: null,
      kind: 'research-output',
      intent: 'save',
      content: snapshot('<svg/>', 'image/svg+xml')
    }]
  }
  try {
    for (const access of [
      { audience: 'ui' as const, callerId: 'window:1' },
      { audience: 'agent' as const, callerId: 'codex:thread-1' },
      { audience: 'system' as const, callerId: 'domain-runtime:another-owner' }
    ]) {
      const denied = await f.service.commitV2(f.workspace, input, access)
      assert.equal(denied.ok, false)
      if (!denied.ok) assert.equal(denied.issue.code, 'access-restricted')
    }
    assert.equal(valueOf(await f.service.list(f.workspace, {})).items.length, 0)
    const owner = {
      audience: 'system' as const,
      callerId: 'domain-runtime:granted-package',
      capabilityGrants: [ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities]
    }
    const committed = valueOf(await f.service.commitV2(f.workspace, input, owner))
    assert.equal(committed.versions[0]?.ref.artifactId, requestedArtifactId)
    assert.equal(committed.versions[0]?.ref.versionId, requestedVersionId)
    const replay = valueOf(await f.service.commitV2(f.workspace, input, owner))
    assert.equal(replay.idempotentReplay, true)
    assert.equal(replay.versions[0]?.ref.versionId, requestedVersionId)
    const restarted = new ArtifactVersionService({ userDataDir: f.userDataDir })
    const restartedReplay = valueOf(await restarted.commitV2(f.workspace, input, owner))
    assert.equal(restartedReplay.idempotentReplay, true)
    assert.equal(restartedReplay.transactionId, committed.transactionId)
    assert.equal(restartedReplay.versions[0]?.ref.versionId, requestedVersionId)
    const collision = await f.service.commit(f.workspace, {
      idempotencyKey: 'research-checkpoint:atomic-identities:collision',
      candidates: [{
        ...input.candidates[0]!,
        requestedVersionId: `artifact-version:${digest('operation-2:figures/result.svg')}`,
        content: snapshot('<svg>different</svg>', 'image/svg+xml')
      }]
    }, owner)
    assert.equal(collision.ok, false)
    if (!collision.ok) assert.equal(collision.issue.code, 'stale-base')
    assert.equal(valueOf(await f.service.list(f.workspace, {})).items.length, 1)
  } finally {
    await cleanup(f)
  }
})

test('stages sequential chunks, seals exact bytes, commits once, and supports exact projections', async () => {
  const f = await fixture('staged-object')
  const outsider = { audience: 'agent' as const, callerId: 'untrusted:producer' }
  try {
    const content = Buffer.from('first chunk\nsecond chunk\n')
    const first = content.subarray(0, 12)
    const second = content.subarray(12)
    const begun = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:begin',
      expectedByteLength: content.byteLength,
      mediaType: 'text/plain'
    }))
    assert.equal(begun.nextOffset, 0)
    assert.equal(begun.maxChunkBytes, 4 * 1024 * 1024)
    const replayedBegin = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:begin',
      expectedByteLength: content.byteLength,
      mediaType: 'text/plain'
    }))
    assert.equal(replayedBegin.stageToken, begun.stageToken)
    assert.equal(replayedBegin.idempotentReplay, true)

    const firstAppend = valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest(first.toString()),
      dataBase64: first.toString('base64')
    }))
    assert.equal(firstAppend.nextOffset, first.byteLength)
    const replayedAppend = valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest(first.toString()),
      dataBase64: first.toString('base64')
    }))
    assert.equal(replayedAppend.idempotentReplay, true)
    valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: first.byteLength,
      chunkDigest: digest(second.toString()),
      dataBase64: second.toString('base64')
    }))
    const sealed = valueOf(await f.service.stageSeal(f.workspace, {
      stageToken: begun.stageToken,
      contentDigest: digest(content.toString()),
      byteLength: content.byteLength
    }))
    assert.equal(sealed.contentDigest, digest(content.toString()))
    assert.equal('path' in sealed, false)

    const denied = await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:denied',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    }, outsider)
    assert.equal(denied.ok, false)
    if (!denied.ok) assert.equal(denied.issue.code, 'access-restricted')

    const committed = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:commit',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    }))
    const output = committed.versions[0]!
    assert.equal(output.ref.contentDigest, sealed.contentDigest)
    assert.equal(output.version.storage.mode, 'snapshot')
    const deniedReplay = await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:commit',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    }, outsider)
    assert.equal(deniedReplay.ok, false)
    if (!deniedReplay.ok) assert.equal(deniedReplay.issue.code, 'access-restricted')

    const range = valueOf(await f.service.readRange(f.workspace, {
      versionId: output.version.versionId,
      offset: first.byteLength,
      length: 6
    }))
    assert.equal(Buffer.from(range.dataBase64, 'base64').toString(), 'second')
    assert.equal(range.totalByteLength, content.byteLength)
    assert.equal(range.eof, false)
    const described = valueOf(await f.service.describe(f.workspace, {
      versionId: output.version.versionId
    }))
    assert.equal(described.artifactOrdinal, 1)
    assert.equal(described.isCurrent, true)
    const listed = valueOf(await f.service.list(f.workspace, {
      artifactId: output.artifact.artifactId,
      kind: 'dataset',
      retention: 'snapshot',
      availability: 'available',
      currentOnly: true,
      limit: 1
    }))
    assert.equal(listed.items[0]?.artifactOrdinal, 1)
    assert.equal(listed.items[0]?.isCurrent, true)

    const consumed = await f.service.stageSeal(f.workspace, {
      stageToken: begun.stageToken,
      contentDigest: sealed.contentDigest,
      byteLength: sealed.byteLength
    })
    assert.equal(consumed.ok, false)
    if (!consumed.ok) assert.equal(consumed.issue.code, 'staged-object-invalid')
    const replayedCommit = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:commit',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    }))
    assert.equal(replayedCommit.idempotentReplay, true)
    const restagedBegin = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:recovery-restage',
      expectedByteLength: content.byteLength,
      mediaType: 'text/plain'
    }))
    valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: restagedBegin.stageToken,
      offset: 0,
      chunkDigest: digest(content.toString()),
      dataBase64: content.toString('base64')
    }))
    const restaged = valueOf(await f.service.stageSeal(f.workspace, {
      stageToken: restagedBegin.stageToken,
      contentDigest: digest(content.toString()),
      byteLength: content.byteLength
    }))
    const recoveredReplay = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:commit',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: restaged }
      }]
    }))
    assert.equal(recoveredReplay.idempotentReplay, true)
    assert.equal(recoveredReplay.transactionId, committed.transactionId)
    assert.equal(valueOf(await f.service.stageAbort(f.workspace, {
      stageToken: restaged.stageToken
    })).aborted, true)

    const changed = Buffer.from(content)
    changed[changed.byteLength - 1] = changed[changed.byteLength - 1]! ^ 1
    const changedBegin = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:changed-restage',
      expectedByteLength: changed.byteLength,
      mediaType: 'text/plain'
    }))
    valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: changedBegin.stageToken,
      offset: 0,
      chunkDigest: createHash('sha256').update(changed).digest('hex'),
      dataBase64: changed.toString('base64')
    }))
    const changedStage = valueOf(await f.service.stageSeal(f.workspace, {
      stageToken: changedBegin.stageToken,
      contentDigest: createHash('sha256').update(changed).digest('hex'),
      byteLength: changed.byteLength
    }))
    const changedConflict = await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:sequential:commit',
      candidates: [{
        candidateId: 'output',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: changedStage }
      }]
    })
    assert.equal(changedConflict.ok, false)
    if (!changedConflict.ok) assert.equal(changedConflict.issue.code, 'idempotency-conflict')
    assert.equal(valueOf(await f.service.stageAbort(f.workspace, {
      stageToken: changedStage.stageToken
    })).aborted, true)
    const consumedBegin = await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:begin',
      expectedByteLength: content.byteLength,
      mediaType: 'text/plain'
    })
    assert.equal(consumedBegin.ok, false)
    if (!consumedBegin.ok) assert.equal(consumedBegin.issue.code, 'idempotency-conflict')

    const disposable = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:sequential:abort'
    }))
    assert.equal(valueOf(await f.service.stageAbort(f.workspace, {
      stageToken: disposable.stageToken
    })).aborted, true)
    assert.equal(valueOf(await f.service.stageAbort(f.workspace, {
      stageToken: disposable.stageToken
    })).aborted, false)
  } finally {
    await cleanup(f)
  }
})

test('fails staged chunks closed on offset, digest, caller, seal, and stale target mismatches', async () => {
  const f = await fixture('staged-failures')
  const otherSystem = { audience: 'system' as const, callerId: 'other:system' }
  try {
    const begun = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:failures:begin',
      expectedByteLength: 4
    }))
    const denied = await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest('data'),
      dataBase64: Buffer.from('data').toString('base64')
    }, otherSystem)
    assert.equal(denied.ok, false)
    if (!denied.ok) assert.equal(denied.issue.code, 'access-restricted')

    const tampered = await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest('xxxx'),
      dataBase64: Buffer.from('data').toString('base64')
    })
    assert.equal(tampered.ok, false)
    if (!tampered.ok) assert.equal(tampered.issue.code, 'content-mismatch')
    const gapped = await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 1,
      chunkDigest: digest('data'),
      dataBase64: Buffer.from('data').toString('base64')
    })
    assert.equal(gapped.ok, false)
    if (!gapped.ok) assert.equal(gapped.issue.code, 'staged-object-invalid')
    valueOf(await f.service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest('data'),
      dataBase64: Buffer.from('data').toString('base64')
    }))
    const badSeal = await f.service.stageSeal(f.workspace, {
      stageToken: begun.stageToken,
      contentDigest: digest('else'),
      byteLength: 4
    })
    assert.equal(badSeal.ok, false)
    if (!badSeal.ok) assert.equal(badSeal.issue.code, 'content-mismatch')
    const sealed = valueOf(await f.service.stageSeal(f.workspace, {
      stageToken: begun.stageToken,
      contentDigest: digest('data'),
      byteLength: 4
    }))
    const alteredRef = await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:failures:altered-ref',
      candidates: [{
        candidateId: 'altered',
        expectedCurrentVersionId: null,
        kind: 'diagnostic',
        intent: 'save',
        content: {
          mode: 'staged-object',
          stagedObject: { ...sealed, byteLength: sealed.byteLength + 1 }
        }
      }]
    })
    assert.equal(alteredRef.ok, false)
    if (!alteredRef.ok) assert.equal(alteredRef.issue.code, 'staged-object-invalid')

    const initial = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:failures:initial',
      candidates: [{
        candidateId: 'initial',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('v1')
      }]
    })).versions[0]!
    const current = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:failures:advance',
      candidates: [{
        candidateId: 'advance',
        artifactId: initial.artifact.artifactId,
        expectedCurrentVersionId: initial.version.versionId,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('v2')
      }]
    })).versions[0]!
    const stale = await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:failures:stale',
      candidates: [{
        candidateId: 'stale-output',
        artifactId: initial.artifact.artifactId,
        expectedCurrentVersionId: initial.version.versionId,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.issue.code, 'stale-base')
    const quarantine = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stage:failures:quarantine',
      candidates: [{
        candidateId: 'diagnostic',
        expectedCurrentVersionId: null,
        kind: 'diagnostic',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed },
        metadata: { intendedVersionId: current.version.versionId }
      }]
    }))
    assert.equal(quarantine.versions[0]?.ref.contentDigest, digest('data'))
  } finally {
    await cleanup(f)
  }
})

test('expires abandoned stages and sweeps only old unreferenced CAS objects', async () => {
  const f = await fixture('staged-expiry-gc')
  let now = new Date('2026-08-06T00:00:00.000Z')
  const service = trustedTestService(new ArtifactVersionService({
    userDataDir: f.userDataDir,
    now: () => now
  }))
  try {
    const begun = valueOf(await service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:expiry:begin',
      expectedByteLength: 4
    }))
    now = new Date('2026-08-06T02:00:00.000Z')
    const expired = await service.stageAppend(f.workspace, {
      stageToken: begun.stageToken,
      offset: 0,
      chunkDigest: digest('data'),
      dataBase64: Buffer.from('data').toString('base64')
    })
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.equal(expired.issue.code, 'staged-object-expired')
    const restarted = valueOf(await service.stageBegin(f.workspace, {
      idempotencyKey: 'stage:expiry:begin',
      expectedByteLength: 4
    }))
    assert.equal(restarted.stageToken, begun.stageToken)
    assert.equal(restarted.idempotentReplay, false)

    const orphanBytes = Buffer.from('orphan')
    const orphanDigest = digest(orphanBytes.toString())
    const workspaceKey = digest(await realpath(f.workspace))
    const orphanPath = join(
      f.userDataDir,
      'artifact-versions',
      'workspaces',
      workspaceKey,
      'objects',
      'sha256',
      orphanDigest.slice(0, 2),
      orphanDigest
    )
    await mkdir(dirname(orphanPath), { recursive: true })
    await writeFile(orphanPath, orphanBytes)
    await utimes(orphanPath, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'))
    now = new Date('2026-08-14T02:00:00.000Z')
    const collector = trustedTestService(new ArtifactVersionService({
      userDataDir: f.userDataDir,
      now: () => now
    }))
    valueOf(await collector.list(f.workspace, {}))
    await assert.rejects(readFile(orphanPath), { code: 'ENOENT' })
  } finally {
    await cleanup(f)
  }
})

test('rejects stale multi-candidate batches without exposing partial versions', async () => {
  const f = await fixture('stale')
  try {
    const initial = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'stale:initial:1',
      candidates: [{
        candidateId: 'data',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('v1')
      }]
    }))
    const artifact = initial.versions[0]!.artifact
    const rejected = await f.service.commit(f.workspace, {
      idempotencyKey: 'stale:batch:1',
      candidates: [
        {
          candidateId: 'bad-update',
          artifactId: artifact.artifactId,
          expectedCurrentVersionId: 'artifact-version:not-current',
          kind: artifact.kind,
          intent: 'save',
          content: snapshot('v2')
        },
        {
          candidateId: 'must-not-appear',
          expectedCurrentVersionId: null,
          kind: 'figure',
          intent: 'save',
          content: snapshot('figure')
        }
      ]
    })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.issue.code, 'stale-base')
    assert.equal(valueOf(await f.service.list(f.workspace, {})).items.length, 1)

    const conflict = await f.service.commit(f.workspace, {
      idempotencyKey: 'stale:initial:1',
      candidates: [{
        candidateId: 'different',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('different')
      }]
    })
    assert.equal(conflict.ok, false)
    if (!conflict.ok) assert.equal(conflict.issue.code, 'idempotency-conflict')
  } finally {
    await cleanup(f)
  }
})

test('deterministic requested identities keep a concurrent stale batch at zero commits', async () => {
  const f = await fixture('deterministic-stale-batch')
  const owner = {
    audience: 'system' as const,
    callerId: 'domain-runtime:granted-package',
    capabilityGrants: [ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities]
  }
  const outputArtifactId = `artifact:${digest('workspace-output:outputs/data.csv')}`
  const outputV1Id = `artifact-version:${digest('operation-1:outputs/data.csv')}`
  try {
    const first = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'deterministic-stale:initial',
      candidates: [{
        candidateId: 'output-v1',
        requestedArtifactId: outputArtifactId,
        requestedVersionId: outputV1Id,
        expectedCurrentVersionId: null,
        kind: 'research-output',
        intent: 'save',
        content: snapshot('v1')
      }]
    }, owner))
    const rejected = await f.service.commit(f.workspace, {
      idempotencyKey: 'deterministic-stale:batch',
      candidates: [
        {
          candidateId: 'output-stale',
          artifactId: outputArtifactId,
          requestedVersionId: `artifact-version:${digest('operation-stale:outputs/data.csv')}`,
          expectedCurrentVersionId: 'artifact-version:not-current',
          kind: 'research-output',
          intent: 'save',
          content: snapshot('stale')
        },
        {
          candidateId: 'checkpoint-must-not-appear',
          expectedCurrentVersionId: null,
          kind: 'research-checkpoint',
          intent: 'save',
          content: snapshot('checkpoint')
        }
      ]
    }, owner)
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.issue.code, 'stale-base')
    const listed = valueOf(await f.service.list(f.workspace, { limit: 10 }, owner))
    assert.equal(listed.items.length, 1)
    assert.equal(listed.items[0]?.ref.versionId, first.versions[0]?.ref.versionId)
  } finally {
    await cleanup(f)
  }
})

test('pages exact artifact history with artifact-local ordinals and filters', async () => {
  const f = await fixture('describe-pagination')
  try {
    const first = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'pagination:commit:v1',
      candidates: [{
        candidateId: 'v1',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('v1')
      }]
    })).versions[0]!
    const second = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'pagination:commit:v2',
      candidates: [{
        candidateId: 'v2',
        artifactId: first.artifact.artifactId,
        expectedCurrentVersionId: first.version.versionId,
        kind: 'dataset',
        intent: 'rerun',
        content: snapshot('v2')
      }]
    })).versions[0]!
    const third = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'pagination:commit:v3',
      candidates: [{
        candidateId: 'v3',
        artifactId: first.artifact.artifactId,
        expectedCurrentVersionId: second.version.versionId,
        kind: 'dataset',
        intent: 'publish',
        content: snapshot('v3')
      }]
    })).versions[0]!
    const firstPage = valueOf(await f.service.list(f.workspace, {
      artifactId: first.artifact.artifactId,
      limit: 2
    }))
    assert.deepEqual(
      firstPage.items.map((item) => [item.version.versionId, item.artifactOrdinal, item.isCurrent]),
      [
        [third.version.versionId, 3, true],
        [second.version.versionId, 2, false]
      ]
    )
    assert.ok(firstPage.nextBeforeSequence)
    const nextPage = valueOf(await f.service.list(f.workspace, {
      artifactId: first.artifact.artifactId,
      beforeSequence: firstPage.nextBeforeSequence,
      limit: 2
    }))
    assert.deepEqual(nextPage.items.map((item) => item.artifactOrdinal), [1])
    const reruns = valueOf(await f.service.list(f.workspace, {
      artifactId: first.artifact.artifactId,
      intent: 'rerun'
    }))
    assert.deepEqual(reruns.items.map((item) => item.version.versionId), [second.version.versionId])
    const described = valueOf(await f.service.describe(f.workspace, {
      versionId: second.version.versionId
    }))
    assert.equal(described.artifactOrdinal, 2)
    assert.equal(described.isCurrent, false)
  } finally {
    await cleanup(f)
  }
})

test('artifact-local ordinals stay absolute when earlier history is restricted', async () => {
  const f = await fixture('absolute-ordinal-access')
  const owner = { audience: 'agent' as const, callerId: 'researcher:owner' }
  const outsider = { audience: 'ui' as const, callerId: 'window:outsider' }
  try {
    const restricted = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'ordinal:restricted:v1',
      candidates: [{
        candidateId: 'v1',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('restricted-v1'),
        accessPolicy: {
          visibility: 'restricted',
          principals: [owner.callerId],
          allowExport: true
        }
      }]
    }, owner)).versions[0]!
    const published = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'ordinal:public:v2',
      candidates: [{
        candidateId: 'v2',
        artifactId: restricted.artifact.artifactId,
        expectedCurrentVersionId: restricted.version.versionId,
        kind: 'dataset',
        intent: 'publish',
        content: snapshot('public-v2'),
        accessPolicy: {
          visibility: 'public',
          principals: [],
          allowExport: true
        }
      }]
    }, owner)).versions[0]!
    const outsiderDescription = valueOf(await f.service.describe(f.workspace, {
      versionId: published.version.versionId
    }, outsider))
    assert.equal(outsiderDescription.artifactOrdinal, 2)
    const outsiderHistory = valueOf(await f.service.list(f.workspace, {
      artifactId: published.artifact.artifactId
    }, outsider))
    assert.deepEqual(
      outsiderHistory.items.map((item) => [item.version.versionId, item.artifactOrdinal]),
      [[published.version.versionId, 2]]
    )
    const ownerHistory = valueOf(await f.service.list(f.workspace, {
      artifactId: published.artifact.artifactId
    }, owner))
    assert.deepEqual(ownerHistory.items.map((item) => item.artifactOrdinal), [2, 1])
  } finally {
    await cleanup(f)
  }
})

test('enforces version access policies before reads, writes, restore, comparison, and export', async () => {
  const f = await fixture('access-policy')
  const owner = { audience: 'agent' as const, callerId: 'researcher:owner' }
  const outsider = { audience: 'ui' as const, callerId: 'window:outsider' }
  const system = { audience: 'system' as const, callerId: 'domain:evidence-dag' }
  try {
    const initial = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'access:public-v1',
      candidates: [{
        candidateId: 'dataset-v1',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        label: 'Public label',
        intent: 'save',
        content: snapshot('public-v1'),
        accessPolicy: {
          visibility: 'workspace',
          principals: [],
          allowExport: true
        }
      }]
    }, owner))
    const publicVersion = initial.versions[0]!
    const restricted = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'access:restricted-v2',
      candidates: [{
        candidateId: 'dataset-v2',
        artifactId: publicVersion.artifact.artifactId,
        expectedCurrentVersionId: publicVersion.version.versionId,
        kind: 'dataset',
        label: 'Restricted current label',
        intent: 'save',
        content: snapshot('restricted-v2'),
        accessPolicy: {
          visibility: 'restricted',
          principals: [owner.callerId],
          allowExport: true
        }
      }]
    }, owner))
    const restrictedVersion = restricted.versions[0]!

    const deniedRead = await f.service.read(f.workspace, {
      versionId: restrictedVersion.version.versionId
    }, outsider)
    assert.equal(deniedRead.ok, false)
    if (!deniedRead.ok) {
      assert.equal(deniedRead.issue.code, 'access-restricted')
      assert.equal(deniedRead.issue.details, undefined)
      assert.equal(deniedRead.issue.message.includes(restrictedVersion.version.versionId), false)
    }

    const outsiderHistory = valueOf(await f.service.list(f.workspace, {
      artifactId: publicVersion.artifact.artifactId
    }, outsider))
    assert.equal(outsiderHistory.items.length, 1)
    assert.equal(outsiderHistory.items[0]?.version.versionId, publicVersion.version.versionId)
    assert.equal(
      outsiderHistory.items[0]?.artifact.currentVersionId,
      publicVersion.version.versionId
    )
    assert.equal(outsiderHistory.items[0]?.artifact.versionCount, 1)
    assert.equal(outsiderHistory.items[0]?.artifact.label, undefined)

    const outsiderPublicRead = valueOf(await f.service.read(f.workspace, {
      versionId: publicVersion.version.versionId
    }, outsider))
    assert.equal(outsiderPublicRead.artifact.currentVersionId, publicVersion.version.versionId)
    assert.equal(outsiderPublicRead.artifact.label, undefined)

    assert.equal(valueOf(await f.service.list(f.workspace, {}, owner)).items.length, 2)
    const systemRead = valueOf(await f.service.read(f.workspace, {
      versionId: restrictedVersion.version.versionId
    }, system))
    assert.equal(Buffer.from(systemRead.dataBase64, 'base64').toString(), 'restricted-v2')

    const deniedMaterialize = await f.service.materialize(f.workspace, {
      idempotencyKey: 'access:materialize-denied',
      versionId: restrictedVersion.version.versionId,
      destinationPath: 'private-copy.txt'
    }, outsider)
    assert.equal(deniedMaterialize.ok, false)
    if (!deniedMaterialize.ok) assert.equal(deniedMaterialize.issue.code, 'access-restricted')
    await assert.rejects(readFile(join(f.workspace, 'private-copy.txt')))

    const deniedRestore = await f.service.restoreAsNew(f.workspace, {
      idempotencyKey: 'access:restore-denied',
      artifactId: restrictedVersion.artifact.artifactId,
      sourceVersionId: publicVersion.version.versionId,
      expectedCurrentVersionId: restrictedVersion.version.versionId
    }, outsider)
    assert.equal(deniedRestore.ok, false)
    if (!deniedRestore.ok) assert.equal(deniedRestore.issue.code, 'access-restricted')

    const deniedCompare = await f.service.compare(f.workspace, {
      fromVersionId: publicVersion.version.versionId,
      toVersionId: restrictedVersion.version.versionId
    }, outsider)
    assert.equal(deniedCompare.ok, false)
    if (!deniedCompare.ok) assert.equal(deniedCompare.issue.code, 'access-restricted')

    const deniedOverwrite = await f.service.commit(f.workspace, {
      idempotencyKey: 'access:overwrite-denied',
      candidates: [{
        candidateId: 'overwrite',
        artifactId: restrictedVersion.artifact.artifactId,
        expectedCurrentVersionId: restrictedVersion.version.versionId,
        kind: 'dataset',
        intent: 'save',
        content: snapshot('unauthorized-overwrite')
      }]
    }, outsider)
    assert.equal(deniedOverwrite.ok, false)
    if (!deniedOverwrite.ok) assert.equal(deniedOverwrite.issue.code, 'access-restricted')

    const deniedDependency = await f.service.commit(f.workspace, {
      idempotencyKey: 'access:dependency-denied',
      candidates: [{
        candidateId: 'derived',
        expectedCurrentVersionId: null,
        kind: 'figure',
        intent: 'save',
        content: snapshot('derived'),
        dependencies: [{
          role: 'input',
          target: { kind: 'version', ref: restrictedVersion.ref }
        }]
      }]
    }, outsider)
    assert.equal(deniedDependency.ok, false)
    if (!deniedDependency.ok) assert.equal(deniedDependency.issue.code, 'access-restricted')

    const deniedObserve = await f.service.observe(f.workspace, {
      idempotencyKey: 'access:observe-denied',
      candidateId: 'observe',
      artifactId: restrictedVersion.artifact.artifactId,
      expectedCurrentVersionId: restrictedVersion.version.versionId,
      kind: 'dataset',
      path: 'does-not-exist.txt',
      retention: 'snapshot'
    }, outsider)
    assert.equal(deniedObserve.ok, false)
    if (!deniedObserve.ok) assert.equal(deniedObserve.issue.code, 'access-restricted')

    const deniedExport = await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'access:export-denied',
      versionIds: [restrictedVersion.version.versionId],
      destinationPath: 'restricted.bundle.json'
    }, outsider)
    assert.equal(deniedExport.ok, false)
    if (!deniedExport.ok) assert.equal(deniedExport.issue.code, 'access-restricted')
    await assert.rejects(readFile(join(f.workspace, 'restricted.bundle.json')))

    assert.equal(valueOf(await f.service.list(f.workspace, {}, system)).items.length, 2)
  } finally {
    await cleanup(f)
  }
})

test('bundle export rejects allowExport=false anywhere in the exact closure before writing', async () => {
  const f = await fixture('access-export-closure')
  const caller = { audience: 'agent' as const, callerId: 'researcher:owner' }
  try {
    const committed = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'access:export-closure:commit',
      candidates: [
        {
          candidateId: 'source',
          expectedCurrentVersionId: null,
          kind: 'dataset',
          intent: 'save',
          content: snapshot('source'),
          accessPolicy: {
            visibility: 'workspace',
            principals: [],
            allowExport: false
          }
        },
        {
          candidateId: 'figure',
          expectedCurrentVersionId: null,
          kind: 'figure',
          intent: 'save',
          content: snapshot('figure'),
          dependencies: [{
            role: 'input',
            target: { kind: 'candidate', candidateId: 'source' }
          }],
          accessPolicy: {
            visibility: 'public',
            principals: [],
            allowExport: true
          }
        }
      ]
    }, caller))
    const figure = committed.versions.find((item) => item.candidateId === 'figure')!
    const denied = await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'access:export-closure:denied',
      versionIds: [figure.version.versionId],
      destinationPath: 'exports/figure.bundle.json'
    }, caller)
    assert.equal(denied.ok, false)
    if (!denied.ok) {
      assert.equal(denied.issue.code, 'export-not-allowed')
      assert.equal(denied.issue.details, undefined)
    }
    await assert.rejects(readFile(join(f.workspace, 'exports/figure.bundle.json')))
  } finally {
    await cleanup(f)
  }
})

test('observes, materializes, restores as new, and compares verified bytes', async () => {
  const f = await fixture('restore')
  try {
    await writeFile(join(f.workspace, 'measurements.csv'), 'sample,value\na,3\n')
    const observed = valueOf(await f.service.observe(f.workspace, {
      idempotencyKey: 'observe:measurements:1',
      candidateId: 'measurements',
      expectedCurrentVersionId: null,
      kind: 'dataset',
      label: 'Measurements',
      path: 'measurements.csv',
      retention: 'snapshot',
      mediaType: 'text/csv'
    }))
    const original = observed.versions[0]!
    const materialized = valueOf(await f.service.materialize(f.workspace, {
      idempotencyKey: 'materialize:measurements:1',
      versionId: original.version.versionId,
      destinationPath: 'restored/measurements.csv'
    }))
    assert.equal(materialized.destinationPath, 'restored/measurements.csv')
    assert.equal(await readFile(join(f.workspace, materialized.destinationPath), 'utf8'), 'sample,value\na,3\n')

    const restored = valueOf(await f.service.restoreAsNew(f.workspace, {
      idempotencyKey: 'restore:measurements:1',
      artifactId: original.artifact.artifactId,
      sourceVersionId: original.version.versionId,
      expectedCurrentVersionId: original.version.versionId
    }))
    const current = restored.versions[0]!
    assert.equal(current.version.parentVersionId, original.version.versionId)
    assert.equal(current.version.dependencies[0]?.role, 'restored-from')
    const comparison = valueOf(await f.service.compare(f.workspace, {
      fromVersionId: original.version.versionId,
      toVersionId: current.version.versionId
    }))
    assert.equal(comparison.sameContent, true)
    assert.equal(comparison.addedDependencies[0]?.role, 'restored-from')
    assert.equal(comparison.textPreview?.from, comparison.textPreview?.to)
  } finally {
    await cleanup(f)
  }
})

test('deduplicates passive observations and reports move, change, missing, and restore lifecycle', async () => {
  const f = await fixture('lifecycle')
  try {
    const originalText = 'sample,value\na,3\n'
    await writeFile(join(f.workspace, 'source.csv'), originalText)
    const observed = valueOf(await f.service.observe(f.workspace, {
      idempotencyKey: 'lifecycle:observe:1',
      candidateId: 'source',
      expectedCurrentVersionId: null,
      kind: 'dataset',
      path: 'source.csv',
      retention: 'reference',
      mediaType: 'text/csv',
      accessPolicy: {
        visibility: 'restricted',
        principals: ['research-team'],
        allowExport: true
      }
    }))
    const first = observed.versions[0]!
    assert.equal(first.ref.accessPolicy.visibility, 'restricted')

    const unchanged = valueOf(await f.service.observe(f.workspace, {
      idempotencyKey: 'lifecycle:observe:unchanged',
      candidateId: 'source-again',
      artifactId: first.artifact.artifactId,
      expectedCurrentVersionId: first.version.versionId,
      kind: 'dataset',
      path: 'source.csv',
      retention: 'reference',
      mediaType: 'text/csv'
    }))
    assert.equal(unchanged.versions[0]!.version.versionId, first.version.versionId)
    assert.deepEqual(unchanged.events, [])
    assert.equal(valueOf(await f.service.list(f.workspace, {})).items.length, 1)

    await rename(join(f.workspace, 'source.csv'), join(f.workspace, 'moved.csv'))
    const moved = valueOf(await f.service.observe(f.workspace, {
      idempotencyKey: 'lifecycle:observe:moved',
      candidateId: 'source-moved',
      artifactId: first.artifact.artifactId,
      expectedCurrentVersionId: first.version.versionId,
      kind: 'dataset',
      path: 'moved.csv',
      retention: 'reference',
      mediaType: 'text/csv'
    }))
    assert.equal(moved.versions[0]!.version.versionId, first.version.versionId)
    assert.equal(moved.events[0]?.type, 'artifact-moved')
    assert.equal(valueOf(await f.service.list(f.workspace, {})).items.length, 1)

    await unlink(join(f.workspace, 'moved.csv'))
    const missing = valueOf(await f.service.refresh(f.workspace, {
      artifactId: first.artifact.artifactId
    }))
    assert.equal(missing.events[0]?.type, 'artifact-missing')
    const missingHistory = valueOf(await f.service.list(f.workspace, {
      artifactId: first.artifact.artifactId
    }))
    assert.equal(missingHistory.items[0]?.ref.availability, 'missing')
    assert.deepEqual(missingHistory.items[0]?.version.storage, {
      mode: 'reference',
      locator: 'workspace:source.csv',
      contentDigest: first.ref.contentDigest,
      byteLength: Buffer.byteLength(originalText),
      mediaType: 'text/csv',
      availability: 'available'
    })

    await writeFile(join(f.workspace, 'moved.csv'), originalText)
    const restored = valueOf(await f.service.refresh(f.workspace, {
      artifactId: first.artifact.artifactId
    }))
    assert.equal(restored.events[0]?.type, 'artifact-restored')

    const changedText = 'sample,value\na,5\n'
    await writeFile(join(f.workspace, 'moved.csv'), changedText)
    const changed = valueOf(await f.service.observe(f.workspace, {
      idempotencyKey: 'lifecycle:observe:changed',
      candidateId: 'source-v2',
      artifactId: first.artifact.artifactId,
      expectedCurrentVersionId: first.version.versionId,
      kind: 'dataset',
      path: 'moved.csv',
      retention: 'reference',
      mediaType: 'text/csv'
    }))
    const second = changed.versions[0]!
    assert.notEqual(second.version.versionId, first.version.versionId)
    assert.ok(changed.events.some((event) => event.type === 'artifact-content-changed'))

    const published = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'lifecycle:publish:same-bytes',
      candidates: [{
        candidateId: 'published',
        artifactId: first.artifact.artifactId,
        expectedCurrentVersionId: second.version.versionId,
        kind: 'dataset',
        intent: 'publish',
        content: snapshot(changedText, 'text/csv'),
        accessPolicy: {
          visibility: 'public',
          principals: [],
          allowExport: true
        }
      }]
    }))
    assert.notEqual(published.versions[0]!.version.versionId, second.version.versionId)
    assert.equal(published.versions[0]!.ref.contentDigest, second.ref.contentDigest)
    assert.equal(published.versions[0]!.ref.accessPolicy.visibility, 'public')
    assert.equal(
      valueOf(await f.service.list(f.workspace, { artifactId: first.artifact.artifactId })).items.length,
      3
    )
  } finally {
    await cleanup(f)
  }
})

test('exports, verifies, imports, and detects tampered content-addressed bundles', async () => {
  const f = await fixture('bundle')
  try {
    const committed: ArtifactVersionCommitReceiptV1 = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'bundle:commit:1',
      candidates: [{
        candidateId: 'report',
        expectedCurrentVersionId: null,
        kind: 'report',
        intent: 'save',
        content: snapshot('# Result\n42\n', 'text/markdown')
      }]
    }))
    const exported = valueOf(await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'bundle:export:1',
      versionIds: [committed.versions[0]!.version.versionId],
      destinationPath: 'exports/result.artifact-bundle.json'
    }))
    const verified = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: exported.path
    }))
    assert.equal(verified.valid, true)

    const targetWorkspace = join(f.root, 'target-workspace')
    await mkdir(targetWorkspace)
    await copyFile(
      join(f.workspace, exported.path),
      join(targetWorkspace, 'result.artifact-bundle.json')
    )
    const imported = valueOf(await f.service.importBundle(targetWorkspace, {
      idempotencyKey: 'bundle:import:1',
      bundlePath: 'result.artifact-bundle.json'
    }))
    assert.equal(imported.importedArtifactCount, 1)
    assert.equal(imported.importedVersionCount, 1)
    const importedRead = valueOf(await f.service.read(targetWorkspace, {
      versionId: committed.versions[0]!.version.versionId
    }))
    assert.equal(Buffer.from(importedRead.dataBase64, 'base64').toString(), '# Result\n42\n')

    const tampered = JSON.parse(await readFile(join(f.workspace, exported.path), 'utf8'))
    tampered.objects[0].dataBase64 = Buffer.from('tampered').toString('base64')
    await writeFile(join(f.workspace, 'exports/tampered.json'), JSON.stringify(tampered))
    const invalid = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: 'exports/tampered.json'
    }))
    assert.equal(invalid.valid, false)
    assert.ok(invalid.issues.some((issue) => issue.includes('integrity')))
  } finally {
    await cleanup(f)
  }
})

test('streams an object larger than the V1 limit through Bundle V2 without base64 buffering', async () => {
  const f = await fixture('bundle-v2-large')
  try {
    const chunkSize = 4 * 1024 * 1024
    const byteLength = 128 * 1024 * 1024 + 1
    const fullHash = createHash('sha256')
    const begun = valueOf(await f.service.stageBegin(f.workspace, {
      idempotencyKey: 'bundle:v2:large:stage',
      expectedByteLength: byteLength,
      mediaType: 'application/octet-stream'
    }))
    let offset = 0
    while (offset < byteLength) {
      const length = Math.min(chunkSize, byteLength - offset)
      const chunk = Buffer.alloc(length, offset / chunkSize % 251)
      fullHash.update(chunk)
      valueOf(await f.service.stageAppend(f.workspace, {
        stageToken: begun.stageToken,
        offset,
        chunkDigest: createHash('sha256').update(chunk).digest('hex'),
        dataBase64: chunk.toString('base64')
      }))
      offset += length
    }
    const contentDigest = fullHash.digest('hex')
    const sealed = valueOf(await f.service.stageSeal(f.workspace, {
      stageToken: begun.stageToken,
      contentDigest,
      byteLength
    }))
    const committed = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'bundle:v2:large:commit',
      candidates: [{
        candidateId: 'large-object',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        intent: 'save',
        content: { mode: 'staged-object', stagedObject: sealed }
      }]
    })).versions[0]!

    const exported = valueOf(await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'bundle:v2:large:export',
      versionIds: [committed.version.versionId],
      destinationPath: 'exports/large.artifact-bundle',
      format: 'v2-directory' as const
    }))
    assert.equal('format' in exported ? exported.format : undefined, 'v2-directory')
    const replayedExport = valueOf(await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'bundle:v2:large:export',
      versionIds: [committed.version.versionId],
      destinationPath: 'exports/large.artifact-bundle',
      format: 'v2-directory' as const
    }))
    assert.equal(replayedExport.idempotentReplay, true)
    const manifest = JSON.parse(await readFile(
      join(f.workspace, exported.path, 'manifest.json'),
      'utf8'
    ))
    assert.equal(manifest.schemaVersion, 2)
    assert.equal(manifest.objects[0].dataBase64, undefined)
    assert.equal(manifest.objects[0].byteLength, byteLength)
    const verified = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: exported.path
    }))
    assert.equal(verified.valid, true, JSON.stringify(verified.issues))
    assert.equal(verified.format, 'v2-directory')

    const targetWorkspace = join(f.root, 'large-target-workspace')
    await mkdir(targetWorkspace)
    await cp(
      join(f.workspace, exported.path),
      join(targetWorkspace, 'large.artifact-bundle'),
      { recursive: true }
    )
    const imported = valueOf(await f.service.importBundle(targetWorkspace, {
      idempotencyKey: 'bundle:v2:large:import',
      bundlePath: 'large.artifact-bundle'
    }))
    assert.equal(imported.importedVersionCount, 1)
    const replayedImport = valueOf(await f.service.importBundle(targetWorkspace, {
      idempotencyKey: 'bundle:v2:large:import',
      bundlePath: 'large.artifact-bundle'
    }))
    assert.equal(replayedImport.idempotentReplay, true)
    const exact = valueOf(await f.service.describe(targetWorkspace, {
      versionId: committed.version.versionId
    }))
    assert.equal(exact.ref.contentDigest, contentDigest)
    assert.equal(exact.ref.byteLength, byteLength)
    const firstRange = valueOf(await f.service.readRange(targetWorkspace, {
      versionId: committed.version.versionId,
      offset: 0,
      length: 16
    }))
    assert.deepEqual(Buffer.from(firstRange.dataBase64, 'base64'), Buffer.alloc(16, 0))

    const objectPath = join(
      f.workspace,
      exported.path,
      'objects',
      'sha256',
      contentDigest.slice(0, 2),
      contentDigest
    )
    const handle = await open(objectPath, 'r+')
    await handle.write(Buffer.from([255]), 0, 1, 0)
    await handle.close()
    const tampered = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: exported.path
    }))
    assert.equal(tampered.valid, false)
    assert.ok(tampered.issues.some((issue) => issue.includes('integrity')))

    await rm(objectPath)
    const outsideObject = join(f.workspace, 'outside-object')
    await writeFile(outsideObject, 'not the bundle object')
    await symlink(outsideObject, objectPath)
    const traversed = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: exported.path
    }))
    assert.equal(traversed.valid, false)
    assert.ok(traversed.issues.some((issue) => issue.includes('unsafe')))
  } finally {
    await cleanup(f)
  }
})

test('exports an old version with only its exact recursive dependency and parent closure', async () => {
  const f = await fixture('bundle-exact-old-version')
  try {
    const first = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'bundle:exact:commit:v1',
      candidates: [
        {
          candidateId: 'data-v1',
          expectedCurrentVersionId: null,
          kind: 'dataset',
          intent: 'save',
          content: snapshot('sample,value\na,1\n', 'text/csv')
        },
        {
          candidateId: 'stats-v1',
          expectedCurrentVersionId: null,
          kind: 'statistical-result',
          intent: 'save',
          content: snapshot('{"mean":1}', 'application/json'),
          dependencies: [{
            role: 'input-data',
            target: { kind: 'candidate', candidateId: 'data-v1' }
          }]
        },
        {
          candidateId: 'figure-v1',
          expectedCurrentVersionId: null,
          kind: 'figure',
          intent: 'save',
          content: snapshot('figure-v1', 'image/png'),
          dependencies: [{
            role: 'statistical-result',
            target: { kind: 'candidate', candidateId: 'stats-v1' }
          }]
        }
      ]
    }))
    const dataV1 = first.versions.find((item) => item.candidateId === 'data-v1')!
    const statsV1 = first.versions.find((item) => item.candidateId === 'stats-v1')!
    const figureV1 = first.versions.find((item) => item.candidateId === 'figure-v1')!

    const second = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'bundle:exact:commit:figure-v2',
      candidates: [{
        candidateId: 'figure-v2',
        artifactId: figureV1.artifact.artifactId,
        expectedCurrentVersionId: figureV1.version.versionId,
        kind: 'figure',
        intent: 'save',
        content: snapshot('figure-v2', 'image/png'),
        dependencies: [{
          role: 'statistical-result',
          target: { kind: 'version', ref: statsV1.ref }
        }]
      }]
    }))
    const figureV2 = second.versions[0]!

    const latest = valueOf(await f.service.commit(f.workspace, {
      idempotencyKey: 'bundle:exact:commit:v3',
      candidates: [
        {
          candidateId: 'data-v2',
          artifactId: dataV1.artifact.artifactId,
          expectedCurrentVersionId: dataV1.version.versionId,
          kind: 'dataset',
          intent: 'save',
          content: snapshot('sample,value\na,2\n', 'text/csv')
        },
        {
          candidateId: 'stats-v2',
          artifactId: statsV1.artifact.artifactId,
          expectedCurrentVersionId: statsV1.version.versionId,
          kind: 'statistical-result',
          intent: 'save',
          content: snapshot('{"mean":2}', 'application/json'),
          dependencies: [{
            role: 'input-data',
            target: { kind: 'candidate', candidateId: 'data-v2' }
          }]
        },
        {
          candidateId: 'figure-v3',
          artifactId: figureV1.artifact.artifactId,
          expectedCurrentVersionId: figureV2.version.versionId,
          kind: 'figure',
          intent: 'save',
          content: snapshot('figure-v3', 'image/png'),
          dependencies: [{
            role: 'statistical-result',
            target: { kind: 'candidate', candidateId: 'stats-v2' }
          }]
        }
      ]
    }))
    const dataV2 = latest.versions.find((item) => item.candidateId === 'data-v2')!
    const statsV2 = latest.versions.find((item) => item.candidateId === 'stats-v2')!
    const figureV3 = latest.versions.find((item) => item.candidateId === 'figure-v3')!

    const exported = valueOf(await f.service.exportBundle(f.workspace, {
      idempotencyKey: 'bundle:exact:export:old-figure',
      versionIds: [figureV2.version.versionId],
      destinationPath: 'exports/old-figure.artifact-bundle.json'
    }))
    assert.equal(exported.artifactCount, 3)
    assert.equal(exported.versionCount, 4)
    assert.equal(exported.objectCount, 4)

    const verified = valueOf(await f.service.verifyBundle(f.workspace, {
      bundlePath: exported.path
    }))
    assert.equal(verified.valid, true, JSON.stringify(verified.issues))

    const bundle = JSON.parse(await readFile(join(f.workspace, exported.path), 'utf8'))
    const includedVersionIds = new Set(
      (bundle.versions as Array<{ versionId: string }>).map((version) => version.versionId)
    )
    assert.deepEqual(includedVersionIds, new Set([
      dataV1.version.versionId,
      statsV1.version.versionId,
      figureV1.version.versionId,
      figureV2.version.versionId
    ]))
    assert.equal(includedVersionIds.has(dataV2.version.versionId), false)
    assert.equal(includedVersionIds.has(statsV2.version.versionId), false)
    assert.equal(includedVersionIds.has(figureV3.version.versionId), false)

    const projectedArtifacts = new Map(
      (bundle.artifacts as Array<{
        artifactId: string
        currentVersionId: string
        versionCount: number
      }>).map((artifact) => [artifact.artifactId, artifact])
    )
    assert.equal(
      projectedArtifacts.get(dataV1.artifact.artifactId)?.currentVersionId,
      dataV1.version.versionId
    )
    assert.equal(projectedArtifacts.get(dataV1.artifact.artifactId)?.versionCount, 1)
    assert.equal(
      projectedArtifacts.get(statsV1.artifact.artifactId)?.currentVersionId,
      statsV1.version.versionId
    )
    assert.equal(projectedArtifacts.get(statsV1.artifact.artifactId)?.versionCount, 1)
    assert.equal(
      projectedArtifacts.get(figureV1.artifact.artifactId)?.currentVersionId,
      figureV2.version.versionId
    )
    assert.equal(projectedArtifacts.get(figureV1.artifact.artifactId)?.versionCount, 2)

    const expectedBytes = new Map([
      [dataV1.ref.contentDigest, 'sample,value\na,1\n'],
      [statsV1.ref.contentDigest, '{"mean":1}'],
      [figureV1.ref.contentDigest, 'figure-v1'],
      [figureV2.ref.contentDigest, 'figure-v2']
    ])
    assert.equal(bundle.objects.length, expectedBytes.size)
    for (const object of bundle.objects as Array<{
      contentDigest: string
      dataBase64: string
    }>) {
      assert.equal(
        Buffer.from(object.dataBase64, 'base64').toString(),
        expectedBytes.get(object.contentDigest)
      )
    }

    const targetWorkspace = join(f.root, 'exact-target-workspace')
    await mkdir(targetWorkspace)
    await copyFile(
      join(f.workspace, exported.path),
      join(targetWorkspace, 'old-figure.artifact-bundle.json')
    )
    const imported = valueOf(await f.service.importBundle(targetWorkspace, {
      idempotencyKey: 'bundle:exact:import:old-figure',
      bundlePath: 'old-figure.artifact-bundle.json'
    }))
    assert.equal(imported.importedArtifactCount, 3)
    assert.equal(imported.importedVersionCount, 4)
    for (const artifactId of projectedArtifacts.keys()) {
      assert.equal(imported.artifactIdMap[artifactId], artifactId)
    }
    for (const versionId of includedVersionIds) {
      assert.equal(imported.versionIdMap[versionId], versionId)
    }

    for (const version of [dataV1, statsV1, figureV1, figureV2]) {
      const read = valueOf(await f.service.read(targetWorkspace, {
        versionId: version.version.versionId
      }))
      assert.equal(read.ref.contentDigest, version.ref.contentDigest)
      assert.equal(
        Buffer.from(read.dataBase64, 'base64').toString(),
        expectedBytes.get(version.ref.contentDigest)
      )
    }
    const importedFigureHistory = valueOf(await f.service.list(targetWorkspace, {
      artifactId: figureV1.artifact.artifactId
    }))
    assert.equal(importedFigureHistory.items.length, 2)
    assert.ok(importedFigureHistory.items.every((item) =>
      item.artifact.currentVersionId === figureV2.version.versionId &&
      item.artifact.versionCount === 2
    ))
  } finally {
    await cleanup(f)
  }
})

test('migrates a real two-version Evidence registry once with exact ids, digests, and bytes', async () => {
  const f = await fixture('legacy-migration')
  try {
    const firstText = 'sample,value\na,3\n'
    const secondText = 'sample,value\na,5\n'
    await mkdir(join(f.workspace, 'archive'))
    await writeFile(join(f.workspace, 'archive', 'treatment-v1.csv'), firstText)
    await writeFile(join(f.workspace, 'treatment.csv'), secondText)
    const registryPath = await legacyRegistryPath(f)
    const legacy = {
      schemaVersion: 'artifact-registry.v1',
      artifacts: [{
        artifactId: 'artifact:legacy-treatment',
        kind: 'dataset',
        createdAt: '2026-01-01T00:00:00Z',
        currentVersionId: 'artifact-version:legacy-treatment-v2',
        accessPolicy: {}
      }],
      artifactVersions: [
        {
          versionId: 'artifact-version:legacy-treatment-v1',
          artifactId: 'artifact:legacy-treatment',
          locator: 'archive/treatment-v1.csv',
          contentDigest: `sha256:${digest(firstText)}`,
          version: 'v1',
          size: Buffer.byteLength(firstText),
          mediaType: 'text/csv',
          observedAt: '2026-01-01T00:00:00Z',
          availability: 'available',
          retention: 'snapshot',
          historicalLocators: [],
          rebindCandidates: [],
          supersedes: null
        },
        {
          versionId: 'artifact-version:legacy-treatment-v2',
          artifactId: 'artifact:legacy-treatment',
          locator: 'treatment.csv',
          contentDigest: `sha256:${digest(secondText)}`,
          version: 'v2',
          size: Buffer.byteLength(secondText),
          mediaType: 'text/csv',
          observedAt: '2026-01-02T00:00:00Z',
          availability: 'available',
          retention: 'snapshot',
          historicalLocators: ['archive/treatment-v1.csv'],
          rebindCandidates: [],
          supersedes: 'artifact-version:legacy-treatment-v1'
        }
      ],
      sourceAnchors: []
    }
    const originalRegistry = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(registryPath, originalRegistry)

    const history = valueOf(await f.service.list(f.workspace, {
      artifactId: 'artifact:legacy-treatment'
    }))
    assert.equal(history.items.length, 2)
    const current = history.items.find((item) =>
      item.version.versionId === 'artifact-version:legacy-treatment-v2'
    )!
    const first = history.items.find((item) =>
      item.version.versionId === 'artifact-version:legacy-treatment-v1'
    )!
    assert.equal(current.artifact.artifactId, 'artifact:legacy-treatment')
    assert.equal(current.artifact.currentVersionId, 'artifact-version:legacy-treatment-v2')
    assert.equal(current.artifact.versionCount, 2)
    assert.equal(first.ref.contentDigest, digest(firstText))
    assert.equal(current.ref.contentDigest, digest(secondText))
    assert.equal(first.version.parentVersionId, undefined)
    assert.equal(current.version.parentVersionId, first.version.versionId)
    assert.equal(first.version.storage.mode, 'snapshot')
    assert.equal(current.version.storage.mode, 'snapshot')

    const firstRead = valueOf(await f.service.read(f.workspace, {
      versionId: first.version.versionId
    }))
    const currentRead = valueOf(await f.service.read(f.workspace, {
      versionId: current.version.versionId
    }))
    assert.equal(Buffer.from(firstRead.dataBase64, 'base64').toString(), firstText)
    assert.equal(Buffer.from(currentRead.dataBase64, 'base64').toString(), secondText)

    valueOf(await f.service.materialize(f.workspace, {
      idempotencyKey: 'legacy:migration:materialize:v1',
      versionId: first.version.versionId,
      destinationPath: 'restored/treatment-v1.csv'
    }))
    valueOf(await f.service.materialize(f.workspace, {
      idempotencyKey: 'legacy:migration:materialize:v2',
      versionId: current.version.versionId,
      destinationPath: 'restored/treatment-v2.csv'
    }))
    assert.equal(await readFile(join(f.workspace, 'restored/treatment-v1.csv'), 'utf8'), firstText)
    assert.equal(await readFile(join(f.workspace, 'restored/treatment-v2.csv'), 'utf8'), secondText)
    assert.equal(await readFile(registryPath, 'utf8'), originalRegistry)

    const indexPath = await artifactVersionIndexPath(f)
    const beforeRestart = await readFile(indexPath, 'utf8')
    const persisted = JSON.parse(beforeRestart)
    assert.deepEqual(
      persisted.migrations.evidenceArtifactRegistryV1,
      {
        sourceDigest: digest(originalRegistry),
        migratedAt: persisted.migrations.evidenceArtifactRegistryV1.migratedAt,
        artifactCount: 1,
        versionCount: 2,
        snapshotCount: 2
      }
    )

    const restarted = trustedTestService(
      new ArtifactVersionService({ userDataDir: f.userDataDir })
    )
    const restartedHistory = valueOf(await restarted.list(f.workspace, {
      artifactId: 'artifact:legacy-treatment'
    }))
    assert.equal(restartedHistory.items.length, 2)
    assert.deepEqual(
      restartedHistory.items.map((item) => item.version.versionId).sort(),
      [
        'artifact-version:legacy-treatment-v1',
        'artifact-version:legacy-treatment-v2'
      ]
    )
    assert.equal(await readFile(indexPath, 'utf8'), beforeRestart)
    assert.equal(await readFile(registryPath, 'utf8'), originalRegistry)
  } finally {
    await cleanup(f)
  }
})

test('fails closed without creating an index when a legacy version has no digest', async () => {
  const f = await fixture('legacy-missing-digest')
  try {
    const registryPath = await legacyRegistryPath(f)
    const legacy = {
      schemaVersion: 'artifact-registry.v1',
      artifacts: [{
        artifactId: 'artifact:legacy-undigested',
        kind: 'dataset',
        createdAt: '2026-01-01T00:00:00Z',
        currentVersionId: 'artifact-version:legacy-undigested-v1',
        accessPolicy: {}
      }],
      artifactVersions: [{
        versionId: 'artifact-version:legacy-undigested-v1',
        artifactId: 'artifact:legacy-undigested',
        locator: 'undigested.csv',
        contentDigest: null,
        version: 'v1',
        size: 4,
        mediaType: 'text/csv',
        observedAt: '2026-01-01T00:00:00Z',
        availability: 'missing',
        retention: 'reference',
        historicalLocators: [],
        rebindCandidates: [],
        supersedes: null
      }],
      sourceAnchors: []
    }
    const originalRegistry = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(registryPath, originalRegistry)

    const result = await f.service.list(f.workspace, {})
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.issue.code, 'content-unavailable')
      assert.match(result.issue.message, /failed closed.*contentDigest/i)
    }
    await assert.rejects(readFile(await artifactVersionIndexPath(f)), { code: 'ENOENT' })
    assert.equal(await readFile(registryPath, 'utf8'), originalRegistry)
  } finally {
    await cleanup(f)
  }
})

test('retains an unverifiable remote legacy version as a remote reference', async () => {
  const f = await fixture('legacy-remote-reference')
  try {
    const registryPath = await legacyRegistryPath(f)
    const expectedBytes = 'remote-result\n'
    const legacy = {
      schemaVersion: 'artifact-registry.v1',
      artifacts: [{
        artifactId: 'artifact:legacy-remote',
        kind: 'dataset',
        createdAt: '2026-01-01T00:00:00Z',
        currentVersionId: 'artifact-version:legacy-remote-v1',
        accessPolicy: {}
      }],
      artifactVersions: [{
        versionId: 'artifact-version:legacy-remote-v1',
        artifactId: 'artifact:legacy-remote',
        locator: 'https://example.invalid/result.csv',
        contentDigest: `sha256:${digest(expectedBytes)}`,
        version: 'v1',
        size: Buffer.byteLength(expectedBytes),
        mediaType: 'text/csv',
        observedAt: '2026-01-01T00:00:00Z',
        availability: 'remote',
        retention: 'reference',
        historicalLocators: [],
        rebindCandidates: [],
        supersedes: null
      }],
      sourceAnchors: []
    }
    const originalRegistry = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(registryPath, originalRegistry)

    const history = valueOf(await f.service.list(f.workspace, {}))
    assert.equal(history.items.length, 1)
    const item = history.items[0]!
    assert.deepEqual(item.version.storage, {
      mode: 'reference',
      locator: 'https://example.invalid/result.csv',
      contentDigest: digest(expectedBytes),
      byteLength: Buffer.byteLength(expectedBytes),
      mediaType: 'text/csv',
      availability: 'remote'
    })
    assert.equal(item.ref.availability, 'remote')
    assert.equal(item.version.metadata.legacyAvailability, 'remote')
    const read = await f.service.read(f.workspace, { versionId: item.version.versionId })
    assert.equal(read.ok, false)
    if (!read.ok) assert.equal(read.issue.code, 'content-unavailable')
    assert.equal(await readFile(registryPath, 'utf8'), originalRegistry)
  } finally {
    await cleanup(f)
  }
})
