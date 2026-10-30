import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from '../src/core/contract.js'
import { PLUGIN_CAPABILITY_DESCRIPTORS } from '../src/dsh-adapter/descriptors.js'
import { getCapabilityDefinitions, activate, dispose } from '../src/dsh-adapter/index.js'

const tempDirs: string[] = []
async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bio-plugin-unit-'))
  tempDirs.push(dir)
  return dir
}
test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const EXPECTED_EFFECTS: Record<string, 'read' | 'workspace-write'> = {
  [BIOLOGY_ROOM_CAPABILITY_IDS.list]: 'read',
  [BIOLOGY_ROOM_CAPABILITY_IDS.create]: 'workspace-write',
  [BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate]: 'workspace-write',
  [BIOLOGY_ROOM_CAPABILITY_IDS.load]: 'read',
  [BIOLOGY_ROOM_CAPABILITY_IDS.open]: 'read',
  [BIOLOGY_ROOM_CAPABILITY_IDS.apply]: 'workspace-write',
  [BIOLOGY_ROOM_CAPABILITY_IDS.refresh]: 'workspace-write',
  [BIOLOGY_ROOM_CAPABILITY_IDS.history]: 'read'
}

test('the plugin declares the same eight capability ids as the static adapter', () => {
  const ids = PLUGIN_CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.id).sort()
  assert.deepEqual(ids, Object.values(BIOLOGY_ROOM_CAPABILITY_IDS).sort())
  for (const descriptor of PLUGIN_CAPABILITY_DESCRIPTORS) {
    assert.equal(descriptor.scope, 'workspace', `${descriptor.id} stays workspace-scoped`)
    assert.equal(descriptor.effect, EXPECTED_EFFECTS[descriptor.id], `${descriptor.id} effect`)
    assert.equal(descriptor.approval, 'none')
    assert.equal(descriptor.inputSchema.type, 'object', `${descriptor.id} publishes a JSON Schema input`)
  }
})

test('handlers reject calls while the plugin is not active', async () => {
  const definitions = getCapabilityDefinitions()
  const create = definitions.find((definition) => definition.descriptor.id === BIOLOGY_ROOM_CAPABILITY_IDS.create)!
  await assert.rejects(
    () => create.handler({ workspaceRoot: '/tmp/x', title: 'nope' }),
    /not active/
  )
})

test('create, load and list round-trip through the plugin handlers', async () => {
  await activate()
  try {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1\nACGT\n', 'utf8')
    const definitions = getCapabilityDefinitions()
    const byId = new Map(definitions.map((definition) => [definition.descriptor.id, definition.handler]))

    const created = await byId.get(BIOLOGY_ROOM_CAPABILITY_IDS.create)!({
      workspaceRoot,
      roomId: 'unit-room',
      title: 'Unit room',
      assets: [{ id: 'ref-1', path: 'reference.fa', asReference: true }]
    })
    assert.equal((created.output as any).manifest.roomId, 'unit-room')
    assert.deepEqual((created.output as any).resource, {
      resourceId: 'unit-room',
      resourceKind: 'biology-room',
      workspaceId: workspaceRoot,
      audiences: ['ui', 'agent', 'system'],
      semanticRevision: '1'
    })

    const loaded = await byId.get(BIOLOGY_ROOM_CAPABILITY_IDS.load)!({ workspaceRoot, roomId: 'unit-room' })
    assert.equal((loaded.output as any).manifest.revision, 1)

    const listed = await byId.get(BIOLOGY_ROOM_CAPABILITY_IDS.list)!({ workspaceRoot })
    const summaries = listed.output as Array<{ roomId: string }>
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0]!.roomId, 'unit-room')
  } finally {
    await dispose()
  }
})

test('handlers reject a missing workspaceRoot and invalid input', async () => {
  await activate()
  try {
    const definitions = getCapabilityDefinitions()
    const create = definitions.find((definition) => definition.descriptor.id === BIOLOGY_ROOM_CAPABILITY_IDS.create)!
    const apply = definitions.find((definition) => definition.descriptor.id === BIOLOGY_ROOM_CAPABILITY_IDS.apply)!
    await assert.rejects(() => create.handler({ title: 'no workspace' }), /workspaceRoot/)
    await assert.rejects(
      () => apply.handler({ workspaceRoot: '/tmp/x', roomId: 'unit-room', operations: [] }),
      /Too small|too small|min/
    )
  } finally {
    await dispose()
  }
})
