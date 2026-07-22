import { describe, expect, it, vi } from 'vitest'
import {
  BIOLOGY_ROOM_CAPABILITY_IDS,
  BIOLOGY_ROOM_RESOURCE_KIND,
  type BiologyRoomManifest,
  type BiologyRoomObserveResult
} from './contract.js'
import { domainPackageDefinition } from './definition.js'
import {
  createDomainMainEntry,
  type BiologyRoomCapabilityOptions,
  type BiologyRoomServicePort
} from './main.js'

const now = '2026-07-22T00:00:00.000Z'

function manifest(revision = 1): BiologyRoomManifest {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Room',
    revision,
    assets: [],
    viewerStates: {},
    annotations: [],
    createdAt: now,
    updatedAt: now
  }
}

function observation(revision = 1): BiologyRoomObserveResult {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Room',
    revision,
    viewerStates: {},
    assets: [],
    annotations: [],
    visibleTrackIds: [],
    truncated: { assets: false, annotations: false, contigs: false },
    updatedAt: now
  }
}

function service(): BiologyRoomServicePort {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => manifest()),
    openOrCreate: vi.fn(async () => ({ created: true, manifest: manifest() })),
    load: vi.fn(async () => manifest()),
    observe: vi.fn(async () => observation()),
    apply: vi.fn(async (input) => ({
      dryRun: false,
      changed: true,
      previousRevision: input.baseRevision,
      revision: input.baseRevision + 1,
      manifest: manifest(input.baseRevision + 1),
      warnings: []
    })),
    refresh: vi.fn(async () => ({
      dryRun: false,
      changed: false,
      previousRevision: 1,
      revision: 1,
      manifest: manifest(),
      warnings: []
    })),
    history: vi.fn(async () => ({
      roomId: 'room-1',
      currentRevision: 1,
      entries: [],
      truncated: false
    }))
  }
}

function buildEntry() {
  const definitions: BiologyRoomCapabilityOptions[] = []
  let created = 0
  const services: BiologyRoomServicePort[] = []
  const entry = createDomainMainEntry({
    defineCapability: (definition) => {
      definitions.push(definition as BiologyRoomCapabilityOptions)
      return definition
    },
    getUserDataDir: () => '/tmp/unused',
    createService: () => {
      created += 1
      const next = service()
      services.push(next)
      return next
    }
  })
  return { entry, definitions, services, created: () => created }
}

describe('Biology Room main domain entry', () => {
  it('matches its manifest and owns one lazy, disposable service', async () => {
    const harness = buildEntry()
    expect(harness.entry.definition).toBe(domainPackageDefinition)
    expect(harness.entry.contributions.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'main.capability-factory:biology-room.capabilities'
    ])

    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    expect(factory.createDefinitions()).toHaveLength(8)
    expect(harness.created()).toBe(0)

    await harness.definitions[0]!.handler({}, {
      caller: { workspaceId: '/workspace' },
      issueResource: () => ({})
    })
    expect(harness.created()).toBe(1)
    harness.entry.contributions[0]!.onDispose?.()
    await harness.definitions[0]!.handler({}, {
      caller: { workspaceId: '/workspace' },
      issueResource: () => ({})
    })
    expect(harness.created()).toBe(2)
  })

  it('creates a room through the canonical service and issues an observable resource', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const create = harness.definitions.find((definition) =>
      definition.id === BIOLOGY_ROOM_CAPABILITY_IDS.create
    )!
    const issued: unknown[] = []
    const input = create.inputSchema.parse({ title: 'Room' })
    expect(() => create.inputSchema.parse({ title: '', unknown: true })).toThrow()
    const result = await create.handler(
      input,
      {
        caller: { workspaceId: '/workspace' },
        issueResource: (registration) => {
          issued.push(registration)
          return { token: 'opaque', semanticRevision: registration.semanticRevision, expiresAt: now }
        }
      }
    )

    expect(harness.services[0]!.create).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      title: 'Room',
      assets: []
    })
    expect(result.output).toMatchObject({ manifest: { roomId: 'room-1' } })
    expect(issued[0]).toMatchObject({
      resourceId: 'room-1',
      resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: '1'
    })
  })

  it('applies resource-scoped operations with optimistic revision semantics', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const apply = harness.definitions.find((definition) =>
      definition.id === BIOLOGY_ROOM_CAPABILITY_IDS.apply
    )!
    const input = apply.inputSchema.parse({
      operations: [{ type: 'setActiveAsset', assetId: 'asset-1' }]
    })
    expect(() => apply.inputSchema.parse({ operations: [] })).toThrow()
    const result = await apply.handler(
      input,
      {
        caller: { workspaceId: '/workspace' },
        resource: {
          resourceId: 'room-1',
          workspaceId: '/workspace',
          semanticRevision: '4'
        },
        issueResource: vi.fn()
      }
    )

    expect(harness.services[0]!.apply).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      roomId: 'room-1',
      baseRevision: 4,
      dryRun: false,
      operations: [{ type: 'setActiveAsset', assetId: 'asset-1' }]
    })
    expect(result).toMatchObject({ changed: true, semanticRevision: '5' })
  })
})
