import { z } from 'zod'
import {
  BIOLOGY_ROOM_MAX_ASSETS,
  biologyRoomFormatSchema,
  biologyRoomIdSchema
} from '../core/contract.js'

/**
 * Wire schemas for the runtime-plugin entry. Mirrored from the static
 * adapter (packages/domains/biology-room/src/main.ts). For workspace-scoped
 * capabilities the host extension bridge binds input.workspaceRoot to the
 * caller's workspace before dispatch (and the host broker gates workspace
 * scope by caller identity), so the field cannot smuggle a foreign directory
 * into the plugin. The field stays required here so handlers also work when
 * driven directly in tests.
 */

export const biologyRoomActorWireSchema = z.object({
  kind: z.enum(['user', 'agent', 'system']),
  id: z.string().min(1).max(256).optional(),
  taskId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional()
}).strict()

export const biologyRoomAssetInputWireSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  path: z.string().min(1).max(4_096),
  format: biologyRoomFormatSchema.optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  asReference: z.boolean().optional(),
  indexPaths: z.array(z.string().min(1).max(4_096)).max(4).optional(),
  referenceAssetId: z.string().min(1).max(256).optional()
}).strict()

export const biologyRoomMutationOperationWireSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addAsset'), asset: biologyRoomAssetInputWireSchema }).strict(),
  z.object({ type: z.literal('removeAsset'), assetId: z.string().min(1).max(256), cascade: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('setActiveAsset'), assetId: z.string().min(1).max(256).nullable() }).strict(),
  z.object({ type: z.literal('setSelection'), selection: z.unknown().nullable() }).strict(),
  z.object({ type: z.literal('setViewport'), viewport: z.unknown() }).strict(),
  z.object({ type: z.literal('setTrackVisibility'), trackAssetId: z.string().min(1).max(256), visible: z.boolean() }).strict(),
  z.object({ type: z.literal('setMolecularView'), state: z.unknown() }).strict(),
  z.object({ type: z.literal('upsertAnnotation'), annotation: z.unknown() }).strict(),
  z.object({ type: z.literal('deleteAnnotation'), annotationId: z.string().min(1).max(256) }).strict(),
  z.object({ type: z.literal('restoreRevision'), revision: z.number().int().positive() }).strict(),
  z.object({
    type: z.literal('refreshAssets'),
    assetIds: z.array(z.string().min(1).max(256)).max(BIOLOGY_ROOM_MAX_ASSETS),
    orphanedAnnotationIds: z.array(z.string().min(1).max(256)).max(2_000)
  }).strict(),
  z.object({
    type: z.literal('setTrackReference'),
    trackAssetId: z.string().min(1).max(256),
    referenceAssetId: z.string().min(1).max(256)
  }).strict()
])

export const biologyRoomApplyWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema,
  // The static adapter takes baseRevision from the host resource handle's
  // semanticRevision; the plugin has no host handle, so the caller passes it
  // explicitly and the service enforces optimistic concurrency on it.
  baseRevision: z.number().int().positive(),
  dryRun: z.boolean().optional(),
  operations: z.array(biologyRoomMutationOperationWireSchema).min(1).max(100),
  actor: biologyRoomActorWireSchema.optional()
}).strict()

export const biologyRoomCreateWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
  assets: z.array(z.unknown()).max(BIOLOGY_ROOM_MAX_ASSETS).optional(),
  actor: biologyRoomActorWireSchema.optional()
}).strict()

export const biologyRoomOpenOrCreateWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  path: z.string().trim().min(1).max(4_096),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  format: biologyRoomFormatSchema.optional(),
  asReference: z.boolean().optional(),
  indexPaths: z.array(z.string().trim().min(1).max(4_096)).max(4).optional(),
  referenceAssetId: z.string().trim().min(1).max(256).optional(),
  actor: biologyRoomActorWireSchema.optional()
}).strict()

export const biologyRoomLoadWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema
}).strict()

export const biologyRoomListWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).strict()

export const biologyRoomOpenWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema
}).strict()

export const biologyRoomRefreshWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema,
  actor: biologyRoomActorWireSchema.optional()
}).strict()

export const biologyRoomHistoryWireSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema
}).strict()
