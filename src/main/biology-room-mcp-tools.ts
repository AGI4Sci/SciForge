import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  biologyRoomApplyInputSchema,
  biologyRoomObserveInputSchema,
  type BiologyRoomApplyInput,
  type BiologyRoomApplyResult,
  type BiologyRoomObserveInput,
  type BiologyRoomObserveResult
} from '../shared/biology-room'
import { visibleContextSnapshotSchema } from '../shared/visible-context'

export const BIOLOGY_ROOM_OBSERVE_TOOL_NAME = 'biology_room_observe'
export const BIOLOGY_ROOM_APPLY_TOOL_NAME = 'biology_room_apply'
export const BIOLOGY_ROOM_MCP_TOOL_NAMES = [
  BIOLOGY_ROOM_OBSERVE_TOOL_NAME,
  BIOLOGY_ROOM_APPLY_TOOL_NAME
] as const

export type BiologyRoomMcpToolName = typeof BIOLOGY_ROOM_MCP_TOOL_NAMES[number]

export type BiologyRoomMcpService = {
  observe(input: BiologyRoomObserveInput): Promise<BiologyRoomObserveResult>
  apply(input: BiologyRoomApplyInput): Promise<BiologyRoomApplyResult>
}

export type RegisterBiologyRoomMcpToolsOptions = {
  visibleContextPath?: string
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
  isError?: true
}

const BIOLOGY_ROOM_TOOL_META = {
  'sciforge/exposure': 'active-biology-room',
  'sciforge/sourceMutation': false
} as const

/**
 * Attach the narrow, state-only Biology Room surface to workspace-intel's GUI
 * MCP server. The room service remains the sole writer of room manifests; this
 * bridge never reads or writes source biology files directly.
 */
export function registerBiologyRoomMcpTools(
  server: McpServer,
  service: BiologyRoomMcpService,
  options: RegisterBiologyRoomMcpToolsOptions = {}
): void {
  server.registerTool(BIOLOGY_ROOM_OBSERVE_TOOL_NAME, {
    description: [
      'Observe the active SciForge Biology Room as a bounded structured summary.',
      'Use only when the GUI visible context contains the same active room; do not call repeatedly when the active-room summary already answers the question.',
      'Returns room revision, bounded assets and annotations, selection, viewer state, visible tracks, and source hashes without returning source file contents.'
    ].join(' '),
    inputSchema: biologyRoomObserveInputSchema,
    annotations: {
      title: 'Observe active Biology Room',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: BIOLOGY_ROOM_TOOL_META
  }, async (args) => {
    const parsed = biologyRoomObserveInputSchema.safeParse(args)
    if (!parsed.success) return invalidInputResult(parsed.error.message)

    const eligibility = await activeRoomEligibility(options.visibleContextPath, parsed.data)
    if (!eligibility.ok) return eligibilityResult(eligibility.reason)

    try {
      const result = await service.observe(parsed.data)
      return successResult(
        `Observed Biology Room ${result.roomId} at revision ${result.revision}.`,
        result
      )
    } catch (error) {
      return serviceErrorResult(error)
    }
  })

  server.registerTool(BIOLOGY_ROOM_APPLY_TOOL_NAME, {
    description: [
      'Apply validated state-only operations to the active SciForge Biology Room with optimistic revision checking.',
      'Requires baseRevision; use dryRun to validate a proposed batch.',
      'Allowed operations change room assets, selection, viewport, tracks, molecular presentation, annotations, or restore a room revision.',
      'This tool cannot edit FASTA, GenBank, PDB, mmCIF, GFF, BED, or VCF source contents.'
    ].join(' '),
    inputSchema: biologyRoomApplyInputSchema,
    annotations: {
      title: 'Apply Biology Room operations',
      readOnlyHint: false,
      // MCP policies are descriptor-scoped rather than argument-scoped. Keep
      // this conservative so persistent annotation/asset/revision changes are
      // always approval-gated by hosts that honor MCP annotations.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    _meta: {
      ...BIOLOGY_ROOM_TOOL_META,
      'sciforge/approval': 'persistent-room-change',
      'sciforge/protectedOperations': [
        'addAsset',
        'removeAsset',
        'setTrackReference',
        'upsertAnnotation',
        'deleteAnnotation',
        'restoreRevision'
      ]
    }
  }, async (args) => {
    const parsed = biologyRoomApplyInputSchema.safeParse(args)
    if (!parsed.success) return invalidInputResult(parsed.error.message)

    const eligibility = await activeRoomEligibility(options.visibleContextPath, parsed.data)
    if (!eligibility.ok) return eligibilityResult(eligibility.reason)

    try {
      const result = await service.apply({
        ...parsed.data,
        actor: {
          kind: 'agent',
          ...(parsed.data.actor?.id ? { id: parsed.data.actor.id } : {}),
          ...(parsed.data.actor?.taskId ? { taskId: parsed.data.actor.taskId } : {}),
          ...(parsed.data.actor?.turnId ? { turnId: parsed.data.actor.turnId } : {})
        }
      })
      const action = result.dryRun ? 'Validated' : result.changed ? 'Applied' : 'Accepted'
      return successResult(
        `${action} Biology Room operations at revision ${result.revision}.`,
        result
      )
    } catch (error) {
      return serviceErrorResult(error)
    }
  })
}

type ActiveRoomEligibility = { ok: true } | { ok: false; reason: string }

async function activeRoomEligibility(
  visibleContextPath: string | undefined,
  input: { workspaceRoot: string; roomId: string }
): Promise<ActiveRoomEligibility> {
  if (!visibleContextPath) {
    return {
      ok: false,
      reason: 'Biology Room tools are unavailable because GUI visible context is not configured.'
    }
  }

  let raw: string
  try {
    raw = await readFile(visibleContextPath, 'utf8')
  } catch {
    return {
      ok: false,
      reason: 'No active Biology Room is published by the GUI. Open the room before using this tool.'
    }
  }

  let json: unknown
  try {
    json = JSON.parse(raw) as unknown
  } catch {
    return {
      ok: false,
      reason: 'The GUI visible-context snapshot is invalid. Reopen the Biology Room and retry.'
    }
  }
  const snapshot = visibleContextSnapshotSchema.safeParse(json)
  if (!snapshot.success) {
    return {
      ok: false,
      reason: 'The GUI visible-context snapshot is invalid. Reopen the Biology Room and retry.'
    }
  }

  const expectedRoot = canonicalPath(input.workspaceRoot)
  const active = snapshot.data.components.find((component) => {
    if (!component.visible || component.component !== 'biology-room') return false
    const stateRoomId = stringValue(component.state?.roomId)
    const stateWorkspaceRoot = stringValue(component.state?.workspaceRoot)
    const roomResource = component.resources?.find((resource) =>
      resource.kind === 'biologyRoom' && resource.role === 'active-room'
    )
    const resourceRoomId = stringValue(roomResource?.metadata?.roomId)
    const resourceWorkspaceRoot = stringValue(roomResource?.workspaceRoot)
    const roomId = stateRoomId || resourceRoomId
    const workspaceRoot = stateWorkspaceRoot || resourceWorkspaceRoot || snapshot.data.workspaceRoot || ''
    return roomId === input.roomId && canonicalPath(workspaceRoot) === expectedRoot
  })

  return active
    ? { ok: true }
    : {
        ok: false,
        reason: `Biology Room ${input.roomId} is not the active room for this workspace. Open it in the GUI before using this tool.`
      }
}

function successResult(
  text: string,
  result: BiologyRoomObserveResult | BiologyRoomApplyResult
): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { ok: true, ...result }
  }
}

function invalidInputResult(message: string): ToolResult {
  return errorResult('invalid_request', 'Biology Room tool input is invalid.', message)
}

function eligibilityResult(reason: string): ToolResult {
  return errorResult('biology_room_not_active', reason, 'Open the requested Biology Room in the current workspace and retry once.')
}

function serviceErrorResult(error: unknown): ToolResult {
  const record = objectValue(error)
  const name = error instanceof Error ? error.name : stringValue(record.name)
  if (name === 'BiologyRoomConflictError') {
    return errorResult(
      'revision_conflict',
      errorMessage(error),
      'Observe the active room again and retry with its current revision.',
      {
        expectedRevision: numberValue(record.expectedRevision),
        currentRevision: numberValue(record.currentRevision)
      }
    )
  }
  return errorResult(
    'biology_room_failed',
    errorMessage(error),
    'Observe the room, correct the requested operation, and retry.'
  )
}

function errorResult(
  code: string,
  message: string,
  suggestedFix: string,
  details: Record<string, unknown> = {}
): ToolResult {
  return {
    content: [{ type: 'text', text: `${message} ${suggestedFix}` }],
    structuredContent: {
      ok: false,
      error: {
        code,
        message,
        suggestedFix,
        ...details
      }
    },
    isError: true
  }
}

function canonicalPath(value: string): string {
  return resolve(value.trim())
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
