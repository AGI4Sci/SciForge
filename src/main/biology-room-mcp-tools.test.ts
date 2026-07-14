import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BiologyRoomApplyResult,
  BiologyRoomObserveResult
} from '../shared/biology-room'
import {
  BIOLOGY_ROOM_APPLY_TOOL_NAME,
  BIOLOGY_ROOM_OBSERVE_TOOL_NAME,
  registerBiologyRoomMcpTools,
  type BiologyRoomMcpService
} from './biology-room-mcp-tools'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Biology Room MCP tools', () => {
  it('exposes bounded observe and approval-gated apply tools only for the active room', async () => {
    const fixture = await createFixture('room-1')
    const observe = vi.fn(async () => observeResult())
    const apply = vi.fn(async () => applyResult(true))
    const session = await connectTools({ observe, apply }, fixture.visibleContextPath)

    const listed = await session.client.listTools()
    expect(listed.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: BIOLOGY_ROOM_OBSERVE_TOOL_NAME,
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
        _meta: expect.objectContaining({
          'sciforge/exposure': 'active-biology-room',
          'sciforge/sourceMutation': false
        })
      }),
      expect.objectContaining({
        name: BIOLOGY_ROOM_APPLY_TOOL_NAME,
        annotations: expect.objectContaining({ readOnlyHint: false, destructiveHint: true }),
        _meta: expect.objectContaining({
          'sciforge/approval': 'persistent-room-change',
          'sciforge/sourceMutation': false
        })
      })
    ]))

    const observed = await session.client.callTool({
      name: BIOLOGY_ROOM_OBSERVE_TOOL_NAME,
      arguments: {
        workspaceRoot: fixture.workspaceRoot,
        roomId: 'room-1',
        assetLimit: 4,
        annotationLimit: 5,
        contigLimit: 6
      }
    })
    expect(observed.isError).not.toBe(true)
    expect(asRecord(observed.structuredContent)).toMatchObject({
      ok: true,
      roomId: 'room-1',
      revision: 3
    })
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: fixture.workspaceRoot,
      roomId: 'room-1',
      assetLimit: 4,
      annotationLimit: 5,
      contigLimit: 6
    }))

    const applied = await session.client.callTool({
      name: BIOLOGY_ROOM_APPLY_TOOL_NAME,
      arguments: {
        workspaceRoot: fixture.workspaceRoot,
        roomId: 'room-1',
        baseRevision: 3,
        dryRun: true,
        operations: [{ type: 'setSelection', selection: null }],
        actor: { kind: 'user', id: 'spoofed-user' }
      }
    })
    expect(applied.isError).not.toBe(true)
    expect(asRecord(applied.structuredContent)).toMatchObject({
      ok: true,
      dryRun: true,
      previousRevision: 3,
      revision: 3
    })
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-1',
      baseRevision: 3,
      dryRun: true,
      actor: { kind: 'agent', id: 'spoofed-user' }
    }))

    await session.close()
  })

  it('rejects calls for a room that is not active before reaching the room service', async () => {
    const fixture = await createFixture('different-room')
    const service: BiologyRoomMcpService = {
      observe: vi.fn(async () => observeResult()),
      apply: vi.fn(async () => applyResult(false))
    }
    const session = await connectTools(service, fixture.visibleContextPath)

    const result = await session.client.callTool({
      name: BIOLOGY_ROOM_OBSERVE_TOOL_NAME,
      arguments: { workspaceRoot: fixture.workspaceRoot, roomId: 'room-1' }
    })

    expect(result.isError).toBe(true)
    expect(asRecord(asRecord(result.structuredContent).error)).toMatchObject({
      code: 'biology_room_not_active'
    })
    expect(service.observe).not.toHaveBeenCalled()

    await session.close()
  })

  it('returns a structured optimistic-revision conflict', async () => {
    const fixture = await createFixture('room-1')
    const conflict = Object.assign(new Error('expected 2, current 3'), {
      name: 'BiologyRoomConflictError',
      expectedRevision: 2,
      currentRevision: 3
    })
    const service: BiologyRoomMcpService = {
      observe: vi.fn(async () => observeResult()),
      apply: vi.fn(async () => { throw conflict })
    }
    const session = await connectTools(service, fixture.visibleContextPath)

    const result = await session.client.callTool({
      name: BIOLOGY_ROOM_APPLY_TOOL_NAME,
      arguments: {
        workspaceRoot: fixture.workspaceRoot,
        roomId: 'room-1',
        baseRevision: 2,
        operations: [{ type: 'setSelection', selection: null }]
      }
    })

    expect(result.isError).toBe(true)
    expect(asRecord(asRecord(result.structuredContent).error)).toMatchObject({
      code: 'revision_conflict',
      expectedRevision: 2,
      currentRevision: 3
    })

    await session.close()
  })
})

async function createFixture(activeRoomId: string): Promise<{
  workspaceRoot: string
  visibleContextPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'biology-room-mcp-'))
  roots.push(root)
  const workspaceRoot = join(root, 'workspace')
  const visibleContextPath = join(root, 'visible-context.json')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(visibleContextPath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: '2026-07-11T00:00:00.000Z',
    activeThreadId: 'thread-1',
    workspaceRoot,
    route: 'chat',
    components: [{
      id: `biology-room:${activeRoomId}`,
      region: 'main-workspace',
      component: 'biology-room',
      visible: true,
      updatedAt: '2026-07-11T00:00:00.000Z',
      summary: `Biology Room ${activeRoomId}`,
      state: {
        roomId: activeRoomId,
        workspaceRoot,
        revision: 3
      },
      resources: [{
        kind: 'biologyRoom',
        role: 'active-room',
        workspaceRoot,
        relativePath: `.sciforge/biology/rooms/${activeRoomId}/room.json`,
        metadata: { roomId: activeRoomId, revision: 3 }
      }]
    }]
  }), 'utf8')
  return { workspaceRoot, visibleContextPath }
}

async function connectTools(service: BiologyRoomMcpService, visibleContextPath: string) {
  const server = new McpServer({ name: 'biology-room-test', version: '0.1.0' })
  registerBiologyRoomMcpTools(server, service, { visibleContextPath })
  const client = new Client({ name: 'biology-room-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

function observeResult(): BiologyRoomObserveResult {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Protein room',
    revision: 3,
    viewerStates: {},
    assets: [],
    annotations: [],
    visibleTrackIds: [],
    truncated: { assets: false, annotations: false, contigs: false },
    updatedAt: '2026-07-11T00:00:00.000Z'
  }
}

function applyResult(dryRun: boolean): BiologyRoomApplyResult {
  return {
    dryRun,
    changed: false,
    previousRevision: 3,
    revision: 3,
    manifest: {
      schemaVersion: 1,
      roomId: 'room-1',
      title: 'Protein room',
      revision: 3,
      assets: [],
      viewerStates: {},
      annotations: [],
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    },
    warnings: []
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
