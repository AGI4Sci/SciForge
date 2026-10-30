import { z } from 'zod'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from '../core/contract.js'
import {
  biologyRoomApplyWireSchema,
  biologyRoomCreateWireSchema,
  biologyRoomHistoryWireSchema,
  biologyRoomListWireSchema,
  biologyRoomLoadWireSchema,
  biologyRoomOpenOrCreateWireSchema,
  biologyRoomOpenWireSchema,
  biologyRoomRefreshWireSchema
} from './wire.js'

/**
 * Capability descriptors for the named-runner contract entry. Fields mirror
 * the static adapter (packages/domains/biology-room/src/main.ts) one by one.
 *
 * Two deliberate phase-1 deviations from the static descriptors, both forced
 * by the runtime-plugin contract surface and recorded in the README:
 * - scope is 'workspace' for all eight capabilities: the named-runner entry
 *   has not been verified for host-issued resource handles, and the service
 *   already enforces optimistic concurrency on baseRevision for apply;
 * - inputSchema carries workspaceRoot explicitly: the host broker injects the
 *   caller workspace into the input and gates workspace scope by callerId.
 */

export interface PluginCapabilityDescriptor {
  contractVersion: 3
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'workspace'
  resourceKinds: readonly string[]
  effect: 'read' | 'workspace-write'
  approval: 'none'
  concurrency: Readonly<{ revision: 'none' | 'optimistic'; idempotency: 'none' | 'required' }>
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  tags: readonly string[]
}

const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { reused: 'ref' }) as Record<string, unknown>

// Matches the static adapter's z.json() output contract: any JSON value,
// including the array returned by biology-room.list.
const outputSchema = {} as const

export const PLUGIN_CAPABILITY_DESCRIPTORS: readonly PluginCapabilityDescriptor[] = Object.freeze([
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.list,
    version: '1.0.0',
    title: 'List Biology Rooms',
    description: 'Lists Biology Rooms in the caller workspace.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(biologyRoomListWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'discovery'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.create,
    version: '1.0.0',
    title: 'Create Biology Room',
    description: 'Creates a Biology Room in the caller workspace and returns a portable resource reference.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(biologyRoomCreateWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'create'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate,
    version: '1.0.0',
    title: 'Open or create Biology Room',
    description: 'Opens the room for a workspace biology asset, creating it when needed.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(biologyRoomOpenOrCreateWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'open'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.load,
    version: '1.0.0',
    title: 'Load Biology Room',
    description: 'Loads a Biology Room manifest and returns a portable resource reference.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(biologyRoomLoadWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'load'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.open,
    version: '1.0.0',
    title: 'Open Biology Room resource',
    description: 'Observes a Biology Room and returns a portable resource reference.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(biologyRoomOpenWireSchema),
    outputSchema,
    tags: ['biology', 'room'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.apply,
    version: '1.0.0',
    title: 'Apply Biology Room operations',
    description: 'Applies revisioned Biology Room operations using the canonical service.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(biologyRoomApplyWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'edit'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
    version: '1.0.0',
    title: 'Refresh Biology Room assets',
    description: 'Refreshes source-backed assets in the current Biology Room.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(biologyRoomRefreshWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'refresh'] as const
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: BIOLOGY_ROOM_CAPABILITY_IDS.history,
    version: '1.0.0',
    title: 'Read Biology Room history',
    description: 'Returns bounded revision history for the current Biology Room.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(biologyRoomHistoryWireSchema),
    outputSchema,
    tags: ['biology', 'room', 'history'] as const
  })
])
