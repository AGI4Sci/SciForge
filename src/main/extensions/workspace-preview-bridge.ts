/**
 * Host-side bridge for the workspace-preview contribution channel (gap-1b
 * reference implementation). Builds the remote WorkspacePreviewProvider that
 * WorkspacePreviewHost calls in-process; every callback forwards through the
 * governed request closure into the plugin child process.
 *
 * Fail-closed contract: bridge/governance failures become structured
 * `{ ok: false }` provider results (never fabricated data, never a throw past
 * the provider boundary). The preview host already falls back to its generic
 * observation when a provider reports failure, so a broken or stale plugin
 * degrades to "no preview for this slot" instead of broken rendering.
 */
import {
  decodeWorkspacePreviewWireResult,
  type WorkspacePreviewMethod
} from '@sciforge/plugin-sdk'
import type {
  WorkspacePreviewProvider,
  WorkspacePreviewProviderActionInput,
  WorkspacePreviewProviderActionResult,
  WorkspacePreviewProviderApplyEditInput,
  WorkspacePreviewProviderApplyEditResult,
  WorkspacePreviewProviderArtifactInput,
  WorkspacePreviewProviderArtifactResult,
  WorkspacePreviewProviderExportInput,
  WorkspacePreviewProviderExportResult,
  WorkspacePreviewProviderObservationInput,
  WorkspacePreviewProviderObservationResult
} from '../../shared/workspace-preview'

export type WorkspacePreviewBridgeCall = Readonly<{
  method: WorkspacePreviewMethod
  workspaceRoot: string
  input: unknown
}>

export type WorkspacePreviewBridgeRequest = (
  call: WorkspacePreviewBridgeCall
) => Promise<unknown>

function bridgeFailureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { childCode?: unknown }).childCode ?? (error as { code: string }).code
    const message = error instanceof Error ? error.message : String(error)
    return `Workspace preview plugin request failed (${code}): ${message}`
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Creates the remote provider proxy for one registered slot. `request` is the
 * governed channel call (contract slot allowlist + bound identity + workspace
 * check happen inside the extension service before any IPC).
 */
export function createRemoteWorkspacePreviewProvider(input: Readonly<{
  pluginId: string
  request: WorkspacePreviewBridgeRequest
}>): WorkspacePreviewProvider {
  const { pluginId, request } = input
  const workspaceRootOf = (value: unknown): string => {
    const candidate = (value as { file?: { workspaceRoot?: unknown } } | null | undefined)?.file?.workspaceRoot
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error(`Workspace preview plugin ${pluginId} was called without a file workspace.`)
    }
    return candidate
  }
  const invoke = async <T>(method: WorkspacePreviewMethod, callInput: unknown): Promise<T> => {
    const result = await request({
      method,
      workspaceRoot: workspaceRootOf(callInput),
      input: callInput
    })
    return decodeWorkspacePreviewWireResult(method, result) as T
  }
  return Object.freeze({
    pluginId,
    observe: async (observationInput: WorkspacePreviewProviderObservationInput): Promise<WorkspacePreviewProviderObservationResult> => {
      try {
        return await invoke<WorkspacePreviewProviderObservationResult>('observe', observationInput)
      } catch (error) {
        return { ok: false, reason: 'worker-error', message: bridgeFailureMessage(error) }
      }
    },
    invokeAction: async (actionInput: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> => {
      try {
        return await invoke<WorkspacePreviewProviderActionResult>('invokeAction', actionInput)
      } catch (error) {
        return { ok: false, reason: 'worker-error', message: bridgeFailureMessage(error) }
      }
    },
    prepareArtifact: async (artifactInput: WorkspacePreviewProviderArtifactInput): Promise<WorkspacePreviewProviderArtifactResult> => {
      try {
        return await invoke<WorkspacePreviewProviderArtifactResult>('prepareArtifact', artifactInput)
      } catch (error) {
        return { ok: false, reason: 'worker-error', message: bridgeFailureMessage(error) }
      }
    },
    applyEdit: async (editInput: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult | null> => {
      try {
        return await invoke<WorkspacePreviewProviderApplyEditResult | null>('applyEdit', editInput)
      } catch (error) {
        return { ok: false, message: bridgeFailureMessage(error) }
      }
    },
    exportPreview: async (exportInput: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult> => {
      try {
        return await invoke<WorkspacePreviewProviderExportResult>('exportPreview', exportInput)
      } catch (error) {
        return { ok: false, message: bridgeFailureMessage(error) }
      }
    }
  })
}
