import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitReceiptV1
} from '../contract.js'
import {
  ArtifactVersionService,
  type ArtifactVersionAccessContext
} from './service.js'

const SYSTEM_ACCESS: ArtifactVersionAccessContext = Object.freeze({
  audience: 'system',
  callerId: 'artifact-versions:test'
})

type AccessControlledMethod =
  | 'commit'
  | 'observe'
  | 'read'
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
  'observe',
  'read',
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

async function fixture(name: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), `artifact-versions-${name}-`))
  const userDataDir = join(root, 'user-data')
  const workspace = join(root, 'workspace')
  await mkdir(userDataDir)
  await mkdir(workspace)
  return {
    root,
    userDataDir,
    workspace,
    service: trustedTestService(new ArtifactVersionService({ userDataDir }))
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
