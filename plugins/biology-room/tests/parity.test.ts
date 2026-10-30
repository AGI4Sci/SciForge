import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import {
  createBiologyRoomCapabilityFactory,
  BiologyRoomService as StaticBiologyRoomService
} from '@sciforge/domain-biology-room/main'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from '../src/core/contract.js'
import { activate, dispose, getCapabilityDefinitions } from '../src/dsh-adapter/index.js'

/**
 * Phase-1 parity evidence (24-1 §4.5): the static adapter (trusted domain
 * package main entry) and the runtime-plugin entry receive the same operation
 * script on twin workspaces; outputs must match field-for-field and the
 * persisted room trees must match byte-for-byte after stripping volatile
 * timestamps (createdAt/updatedAt/timestamp) and sorting JSON keys.
 *
 * The static side keeps its host mechanisms (caller workspace scope,
 * issueResource handles, resource-scoped apply); the plugin side uses the
 * plugin contract surface (input.workspaceRoot, portable resource
 * references). Those mechanism differences are compared separately, and the
 * compared subset is asserted explicitly below.
 */

const tempDirs: string[] = []
async function tempWorkspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const VOLATILE_KEYS = new Set(['createdAt', 'updatedAt', 'timestamp', 'checkedAt', 'mtimeMs', 'eventId'])

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !VOLATILE_KEYS.has(key))
        .map(([key, item]) => [key, normalizeJson(item)] as [string, unknown])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  }
  return value
}


function sameOutput(actual: unknown, expected: unknown): void {
  assert.deepEqual(normalizeJson(actual), normalizeJson(expected))
}

function canonicalize(fileName: string, bytes: Buffer): string {
  if (fileName.endsWith('.json') || fileName.endsWith('.ndjson')) {
    if (fileName.endsWith('.ndjson')) {
      return bytes
        .toString('utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.stringify(normalizeJson(JSON.parse(line))))
        .join('\n')
    }
    return JSON.stringify(normalizeJson(JSON.parse(bytes.toString('utf8'))))
  }
  return bytes.toString('utf8')
}

async function roomTree(workspaceRoot: string): Promise<Record<string, string>> {
  const roomsRoot = join(workspaceRoot, '.sciforge', 'biology', 'rooms')
  const entries: Record<string, string> = {}
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      const rel = relative(roomsRoot, path)
      const info = await stat(path)
      if (info.isDirectory()) await walk(path)
      else entries[rel] = canonicalize(name, await readFile(path))
    }
  }
  await walk(roomsRoot)
  return entries
}

type StaticHandler = (input: any, context: any) => Promise<any>

function buildStaticHandlers(): Map<string, StaticHandler> {
  const definitions: any[] = []
  const factory = createBiologyRoomCapabilityFactory({
    defineCapability: (definition: unknown) => {
      definitions.push(definition)
      return definition
    },
    getService: () => new StaticBiologyRoomService()
  })
  factory.createDefinitions()
  return new Map(definitions.map((definition) => [definition.id, definition.handler]))
}

function buildPluginHandlers(): Map<string, (input: any) => Promise<any>> {
  return new Map(
    getCapabilityDefinitions().map((definition) => [definition.descriptor.id, definition.handler])
  )
}

async function seedFixtureFiles(workspaceRoot: string): Promise<void> {
  await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1 human chromosome\nACGTACGT\n', 'utf8')
  await writeFile(join(workspaceRoot, 'features.gff3'), '##gff-version 3\nchr1\ttest\tgene\t1\t4\t.\t+\t.\tID=gene1\n', 'utf8')
}

const SCRIPT = {
  roomId: 'parity-room',
  title: 'Parity room',
  assets: [
    { id: 'reference-1', path: 'reference.fa', asReference: true },
    { id: 'track-1', path: 'features.gff3' }
  ],
  operations: [
    { type: 'setSelection', selection: { kind: 'genomic', assetId: 'track-1', referenceAssetId: 'reference-1', refName: 'chr1', start: 0, end: 4, featureId: 'gene1' } },
    {
      type: 'upsertAnnotation',
      annotation: {
        id: 'note-1',
        anchor: { kind: 'sequence', assetId: 'reference-1', sequenceId: 'chr1', ranges: [{ start: 0, end: 4 }] },
        body: 'A region of interest.',
        actor: { kind: 'user', id: 'reviewer' },
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z'
      }
    }
  ]
} as const

test('static adapter and runtime plugin produce identical outputs and room trees', async () => {
  const staticWs = await tempWorkspace('bio-parity-static-')
  const pluginWs = await tempWorkspace('bio-parity-plugin-')
  await seedFixtureFiles(staticWs)
  await seedFixtureFiles(pluginWs)

  const staticHandlers = buildStaticHandlers()
  const pluginHandlers = buildPluginHandlers()
  await activate()

  try {
    const staticCaller = { workspaceId: staticWs }
    const issueResource = (registration: any) => ({
      resourceId: registration.resourceId,
      workspaceId: registration.workspaceId,
      semanticRevision: registration.semanticRevision
    })

    // 1. create
    const staticCreated = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.create)!(
      { roomId: SCRIPT.roomId, title: SCRIPT.title, assets: [...SCRIPT.assets] },
      { caller: staticCaller, issueResource }
    )
    const pluginCreated = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.create)!({
      workspaceRoot: pluginWs,
      roomId: SCRIPT.roomId,
      title: SCRIPT.title,
      assets: [...SCRIPT.assets]
    })
    sameOutput(pluginCreated.output.manifest, staticCreated.output.manifest)
    assert.deepEqual(pluginCreated.output.resource, {
      resourceId: staticCreated.output.resource.resourceId,
      resourceKind: 'biology-room',
      workspaceId: pluginWs,
      audiences: ['ui', 'agent', 'system'],
      semanticRevision: staticCreated.output.resource.semanticRevision
    })

    // 2. load + open
    const staticLoaded = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.load)!({ roomId: SCRIPT.roomId }, { caller: staticCaller, issueResource })
    const pluginLoaded = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.load)!({ workspaceRoot: pluginWs, roomId: SCRIPT.roomId })
    sameOutput(pluginLoaded.output.manifest, staticLoaded.output.manifest)
    const staticObserved = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.open)!({ roomId: SCRIPT.roomId }, { caller: staticCaller, issueResource })
    const pluginObserved = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.open)!({ workspaceRoot: pluginWs, roomId: SCRIPT.roomId })
    sameOutput(pluginObserved.output.observation, staticObserved.output.observation)

    // 3. apply (static via resource handle, plugin via explicit target)
    const revision = staticCreated.output.resource.semanticRevision
    const applyInput = { dryRun: false, operations: SCRIPT.operations.map((operation) => ({ ...operation })) }
    const staticApplied = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.apply)!(
      applyInput,
      {
        caller: staticCaller,
        issueResource,
        resource: { resourceId: SCRIPT.roomId, workspaceId: staticWs, semanticRevision: revision }
      }
    )
    const pluginApplied = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.apply)!({
      workspaceRoot: pluginWs,
      roomId: SCRIPT.roomId,
      baseRevision: Number(revision),
      ...applyInput
    })
    sameOutput(pluginApplied.output, staticApplied.output)
    assert.equal((pluginApplied.output as { changed: boolean }).changed, (staticApplied.output as { changed: boolean }).changed)
    assert.equal(pluginApplied.semanticRevision, staticApplied.semanticRevision)

    // 4. history + list
    const staticHistory = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.history)!({}, {
      caller: staticCaller,
      issueResource,
      resource: { resourceId: SCRIPT.roomId, workspaceId: staticWs, semanticRevision: String(staticApplied.semanticRevision) }
    })
    const pluginHistory = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.history)!({ workspaceRoot: pluginWs, roomId: SCRIPT.roomId })
    sameOutput(pluginHistory.output, staticHistory.output)
    const staticListed = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.list)!({}, { caller: staticCaller, issueResource })
    const pluginListed = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.list)!({ workspaceRoot: pluginWs })
    sameOutput(pluginListed.output, staticListed.output)

    // 5. persisted room trees match after volatility normalization
    const staticTree = await roomTree(staticWs)
    const pluginTree = await roomTree(pluginWs)
    assert.deepEqual(Object.keys(pluginTree).sort(), Object.keys(staticTree).sort())
    for (const rel of Object.keys(staticTree)) {
      assert.equal(pluginTree[rel], staticTree[rel], `room file ${rel} diverged`)
    }

    // 6. no lock or temp residue on either side
    for (const tree of [staticTree, pluginTree]) {
      assert.equal(Object.keys(tree).some((rel) => rel.endsWith('.write.lock') || rel.includes('.tmp')), false)
    }
  } finally {
    await dispose()
  }
})

test('both entries reject an escaping asset path identically', async () => {
  const staticWs = await tempWorkspace('bio-parity-neg-static-')
  const pluginWs = await tempWorkspace('bio-parity-neg-plugin-')
  await seedFixtureFiles(staticWs)
  await seedFixtureFiles(pluginWs)
  const staticHandlers = buildStaticHandlers()
  const pluginHandlers = buildPluginHandlers()
  await activate()
  try {
    const input = { roomId: 'escape-room', title: 'Escape', assets: [{ id: 'x', path: '../outside.fa' }] }
    const staticError = await staticHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.create)!(
      input,
      { caller: { workspaceId: staticWs }, issueResource: () => ({}) }
    ).then(() => null, (error) => error as Error)
    const pluginError = await pluginHandlers.get(BIOLOGY_ROOM_CAPABILITY_IDS.create)!({
      workspaceRoot: pluginWs,
      ...input
    }).then(() => null, (error) => error as Error)
    assert.ok(staticError instanceof Error)
    assert.ok(pluginError instanceof Error)
    assert.equal(pluginError.message, staticError.message)
  } finally {
    await dispose()
  }
})
