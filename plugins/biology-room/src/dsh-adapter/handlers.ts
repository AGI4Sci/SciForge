import {
  BIOLOGY_ROOM_CAPABILITY_IDS,
  BIOLOGY_ROOM_RESOURCE_KIND,
  biologyRoomApplyInputSchema,
  biologyRoomCreateInputSchema,
  biologyRoomHistoryInputSchema,
  biologyRoomListInputSchema,
  biologyRoomObserveInputSchema,
  biologyRoomOpenOrCreateInputSchema,
  biologyRoomRefreshInputSchema,
  biologyRoomTargetSchema
} from '../core/contract.js'
import { BiologyRoomService } from '../core/service.js'

/**
 * Handlers for the runtime-plugin entry. Each handler mirrors its static
 * adapter counterpart (packages/domains/biology-room/src/main.ts) with two
 * host-mechanism substitutions, both forced by the plugin contract surface:
 * - the caller workspace arrives as input.workspaceRoot. The host extension
 *   bridge binds it to the caller's workspace before dispatch (same guarantee
 *   as the static path's context.caller.workspaceId); the plugin additionally
 *   requires the field to be a non-empty string so the handler also works
 *   when driven directly in tests.
 * - resource references are plain serializable objects
 *   ({ resourceId, resourceKind, workspaceId, semanticRevision }) instead of
 *   host-issued resource handles; the service stays the source of truth and
 *   apply still enforces optimistic concurrency on baseRevision.
 */

let service: BiologyRoomService | undefined
const getService = (): BiologyRoomService => (service ??= new BiologyRoomService())

/** Test seam: reset the lazily created service instance. */
export function resetPluginServiceForTests(): void {
  service = undefined
}

function requireWorkspaceRoot(input: unknown): string {
  const workspaceRoot = (input as { workspaceRoot?: unknown }).workspaceRoot
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw new Error('Biology Room plugin requires input.workspaceRoot (host-injected caller workspace).')
  }
  return workspaceRoot.trim()
}

function resourceReference(target: { workspaceRoot: string; roomId: string }, revision: number) {
  return {
    resourceId: target.roomId,
    resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
    workspaceId: target.workspaceRoot,
    audiences: ['ui', 'agent', 'system'] as const,
    semanticRevision: String(revision)
  }
}

export type PluginHandler = (input: any) => Promise<{ output: unknown; changed?: boolean; semanticRevision?: string }>

export const pluginHandlers: Readonly<Record<string, PluginHandler>> = Object.freeze({
  [BIOLOGY_ROOM_CAPABILITY_IDS.list]: async (input) => ({
    output: await getService().list(biologyRoomListInputSchema.parse(input))
  }),

  [BIOLOGY_ROOM_CAPABILITY_IDS.create]: async (input) => {
    const manifest = await getService().create(biologyRoomCreateInputSchema.parse(input))
    return {
      output: {
        manifest,
        resource: resourceReference({ workspaceRoot: requireWorkspaceRoot(input), roomId: manifest.roomId }, manifest.revision)
      }
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate]: async (input) => {
    const result = await getService().openOrCreate(biologyRoomOpenOrCreateInputSchema.parse(input))
    return {
      output: {
        ...result,
        resource: resourceReference(
          { workspaceRoot: requireWorkspaceRoot(input), roomId: result.manifest.roomId },
          result.manifest.revision
        )
      }
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.load]: async (input) => {
    const manifest = await getService().load(biologyRoomTargetSchema.parse(input))
    return {
      output: {
        manifest,
        resource: resourceReference({ workspaceRoot: requireWorkspaceRoot(input), roomId: manifest.roomId }, manifest.revision)
      }
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.open]: async (input) => {
    const target = biologyRoomObserveInputSchema.parse(input)
    const observation = await getService().observe(target)
    return {
      output: {
        observation,
        resource: resourceReference(target, observation.revision)
      }
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.apply]: async (input) => {
    const result = await getService().apply(biologyRoomApplyInputSchema.parse(input))
    // The broker requires a host-issued resource handle for top-level
    // `changed: true`, which the plugin process cannot produce; the truth
    // stays in the output payload (result.changed / result.revision) and the
    // new revision is still reported via semanticRevision.
    return {
      output: result,
      semanticRevision: String(result.revision)
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.refresh]: async (input) => {
    const result = await getService().refresh(biologyRoomRefreshInputSchema.parse(input))
    return {
      output: result,
      semanticRevision: String(result.revision)
    }
  },

  [BIOLOGY_ROOM_CAPABILITY_IDS.history]: async (input) => ({
    output: await getService().history(biologyRoomHistoryInputSchema.parse(input))
  })
})
