/**
 * Host-initiated workspace-preview provider channel (gap-1b reference
 * implementation, lsp-interface-requirements-20261016.md §缺口① candidate b).
 *
 * Direction is the reverse of the HOST-PORTS bridge (#62): there the plugin
 * child requests Host-owned operations during an agent invocation; here the
 * Host invokes plugin-owned workspace-preview providers during rendering
 * (observe / invokeAction / prepareArtifact / applyEdit / exportPreview).
 *
 * Governance mirrors the HOST-PORTS three-layer model, inverted:
 *   1. Contract: the plugin's sciforge.adapter.json declares kind
 *      'workspace-preview' with an exact previewSlots allowlist (slotId +
 *      artifactKinds). The Host registers no slot the declaration does not
 *      name, and denies any prepareArtifact whose artifact kind the declared
 *      slot does not list.
 *   2. Identity: the runtime binds packageName@version to the connection;
 *      plugin-supplied identity fields are discarded before authorization
 *      (same binding as HostPortsRequest).
 *   3. Workspace: the Host passes the render-target workspaceRoot explicitly
 *      with every call; the runner rejects a missing workspaceRoot or one
 *      that disagrees with the request's own file.workspaceRoot.
 *
 * Wire encoding is lossless JSON; the only byte-bearing results
 * (tile/thumbnail artifact payloads) travel as base64 (`bytesBase64`),
 * aligned with the existing renderer asset transport convention. The 30s
 * timeout matches HOST_PORTS_TIMEOUT_MS (pure in-memory compute plus bounded
 * local reads — the interface-requirements doc's latency analysis).
 *
 * REFERENCE IMPLEMENTATION for the SDK maintainer: the open design decisions
 * are listed in the PR body (contribution-kind openness, future unification
 * with HOST-PORTS into a bidirectional invocation channel, binary transport).
 */
import { z } from 'zod'
import {
  workspacePreviewPluginManifestSchema,
  type WorkspacePreviewPluginManifest
} from '@sciforge/domain-sdk/workspace-preview'

/** Wire protocol identifier, mirrored inline in process-extension-runner.mjs. */
export const WORKSPACE_PREVIEW_PROTOCOL = 'sciforge-preview.v1' as const
/** Render-time calls are latency-sensitive but bounded; same budget as HOST-PORTS. */
export const WORKSPACE_PREVIEW_TIMEOUT_MS = 30_000 as const
/** Encoded artifact cap on the wire; the Host enforces its own (smaller) artifact limit after decode. */
export const WORKSPACE_PREVIEW_MAX_WIRE_BYTES = 8 * 1024 * 1024

export const WORKSPACE_PREVIEW_METHODS = Object.freeze([
  'observe',
  'invokeAction',
  'prepareArtifact',
  'applyEdit',
  'exportPreview'
] as const)

export type WorkspacePreviewMethod = typeof WORKSPACE_PREVIEW_METHODS[number]

export const workspacePreviewArtifactKindSchema = z.enum(['tile', 'thumbnail', 'cache-artifact'])
export type WorkspacePreviewArtifactKind = z.infer<typeof workspacePreviewArtifactKindSchema>

/**
 * Declarative slot descriptor in the plugin's sciforge.adapter.json
 * (kind === 'workspace-preview'). slotId is the routing id: it must equal the
 * workspace-preview manifest id the plugin returns for the slot.
 */
export const pluginWorkspacePreviewSlotSchema = z.object({
  slotId: z.string().trim().min(1).max(128),
  artifactKinds: z.array(workspacePreviewArtifactKindSchema).max(8).default([]),
  metadata: z.object({
    displayName: z.string().trim().min(1).max(128).optional()
  }).strict().optional()
}).strict()

export type PluginWorkspacePreviewSlot = z.infer<typeof pluginWorkspacePreviewSlotSchema>

/** Child-side provider surface: the five trusted-domain provider callbacks, in-process. */
export type WorkspacePreviewProviderHandler = Readonly<{
  observe?: (input: unknown) => Promise<unknown>
  invokeAction?: (input: unknown) => Promise<unknown>
  prepareArtifact?: (input: unknown) => Promise<unknown>
  applyEdit?: (input: unknown) => Promise<unknown>
  exportPreview?: (input: unknown) => Promise<unknown>
}>

/** One slot contribution exported by a plugin entry via getWorkspacePreviewProviders(). */
export type WorkspacePreviewSlotContribution = Readonly<{
  slotId: string
  /** Declared artifact kinds for the slot; mirrored from the adapter declaration and relayed in 'preview-slots'. */
  artifactKinds?: readonly WorkspacePreviewArtifactKind[]
  manifest: WorkspacePreviewPluginManifest
  provider: WorkspacePreviewProviderHandler
}>

/** Wire envelope for one host-initiated preview call (command 'preview'). */
export const workspacePreviewWireRequestSchema = z.object({
  protocol: z.literal(WORKSPACE_PREVIEW_PROTOCOL),
  requestId: z.string().trim().min(1).max(128),
  slotId: z.string().trim().min(1).max(128),
  method: z.enum(WORKSPACE_PREVIEW_METHODS),
  /** Host-declared render-target workspace; the runner re-checks it against input.file.workspaceRoot. */
  workspaceRoot: z.string().trim().min(1).max(4096),
  input: z.json()
}).strict()

export type WorkspacePreviewWireRequest = z.infer<typeof workspacePreviewWireRequestSchema>

/** Slot listing returned by command 'preview-slots' (validated again by the Host). */
export const workspacePreviewSlotWireSchema = z.object({
  slotId: z.string().trim().min(1).max(128),
  artifactKinds: z.array(workspacePreviewArtifactKindSchema).max(8).default([]),
  manifest: workspacePreviewPluginManifestSchema
}).strict()

export type WorkspacePreviewSlotWire = z.infer<typeof workspacePreviewSlotWireSchema>

/** Structured channel errors; codes preserved across the process boundary. */
export type WorkspacePreviewChannelError = Readonly<{ code: string; message: string }>

export function workspacePreviewChannelError(code: string, message: string): WorkspacePreviewChannelError {
  return Object.freeze({ code, message })
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

/**
 * Converts an in-process provider result for the wire: artifact success
 * results carry `bytes: Uint8Array`, which becomes `bytesBase64`. The decoded
 * size is capped before encoding so a misbehaving provider cannot force a
 * giant IPC payload.
 */
export function encodeWorkspacePreviewWireResult(method: WorkspacePreviewMethod, result: unknown):
  | { ok: true; result: unknown }
  | { ok: false; error: WorkspacePreviewChannelError } {
  if (method !== 'prepareArtifact' || !result || typeof result !== 'object') {
    return { ok: true, result: result ?? null }
  }
  const candidate = result as { ok?: unknown; kind?: unknown; bytes?: unknown }
  if (candidate.ok !== true || typeof candidate.kind !== 'string' || !isUint8Array(candidate.bytes)) {
    return { ok: true, result }
  }
  if (candidate.bytes.byteLength > WORKSPACE_PREVIEW_MAX_WIRE_BYTES) {
    return {
      ok: false,
      error: workspacePreviewChannelError(
        'artifact_too_large',
        `Workspace preview artifact is ${candidate.bytes.byteLength} bytes, which exceeds the ${WORKSPACE_PREVIEW_MAX_WIRE_BYTES} byte wire limit.`
      )
    }
  }
  const { bytes, ...rest } = candidate as { bytes: Uint8Array } & Record<string, unknown>
  return {
    ok: true,
    result: {
      ...rest,
      bytesBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    }
  }
}

/** Host-side inverse of encodeWorkspacePreviewWireResult. */
export function decodeWorkspacePreviewWireResult(method: WorkspacePreviewMethod, result: unknown): unknown {
  if (method !== 'prepareArtifact' || !result || typeof result !== 'object') return result ?? null
  const candidate = result as { ok?: unknown; bytesBase64?: unknown }
  if (candidate.ok !== true || typeof candidate.bytesBase64 !== 'string') return result
  const { bytesBase64, ...rest } = candidate as { bytesBase64: string } & Record<string, unknown>
  return {
    ...rest,
    bytes: new Uint8Array(Buffer.from(bytesBase64, 'base64'))
  }
}
