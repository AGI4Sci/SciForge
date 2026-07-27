import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewModalitySchema,
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspacePreviewSession,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type {
  WorkspacePreviewApplyEditResult,
  WorkspacePreviewExportResult,
  WorkspacePreviewInvokeActionResult
} from '@shared/sciforge-api'
import {
  createExportWorkspacePreviewAction,
  createInvokeWorkspacePreviewAction,
  createSetSelectionWorkspacePreviewAction,
  runWorkspacePreviewToolbarAction
} from './action-runner'
import {
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHostState,
  type WorkspacePreviewHost
} from './host'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import type {
  WorkspacePreviewActionContribution,
  WorkspacePreviewToolbarAction
} from './registry'

vi.mock('./PdfWorkspaceViewer', () => ({ PdfWorkspaceViewer: () => null }))

const NOW = '2026-07-08T00:00:00.000Z'

function session(overrides: Partial<WorkspacePreviewSession> = {}): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: 'molecular',
    workspaceRoot: '/workspace/lab',
    path: 'protein.pdb',
    modality: workspacePreviewModalitySchema.parse('fixture.domain'),
    mode: 'preview',
    openedAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function observation(overrides: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: { path: 'protein.pdb', workspaceRoot: '/workspace/lab' },
    view: {
      pluginId: 'molecular',
      modality: workspacePreviewModalitySchema.parse('fixture.domain'),
      mode: 'preview',
      title: 'protein.pdb'
    },
    actions: [],
    ...overrides
  }
}

function toolbarAction(
  contribution: WorkspacePreviewActionContribution,
  format?: string
): WorkspacePreviewToolbarAction {
  return {
    id: contribution.id,
    label: contribution.label,
    source: 'observation',
    enabled: true,
    format,
    contribution
  }
}

function context(
  host: WorkspacePreviewHost,
  input: { session?: WorkspacePreviewSession; observation?: WorkspaceObservation } = {}
): WorkspacePreviewPanelShellContext {
  return {
    host,
    state: createWorkspacePreviewHostState({
      session: input.session ?? session(),
      observation: input.observation ?? observation()
    }),
    asset: null,
    assetStatus: 'idle',
    assetError: null,
    transport: createWorkspacePreviewAssetTransportClient({
      descriptor: null,
      readRange: async () => ({ ok: false, message: 'not available' })
    }),
    refresh: vi.fn(),
    refreshing: false
  }
}

describe('workspace preview action contributions', () => {
  it('runs selection and export through reusable host action contributions', async () => {
    const selected: WorkspaceStructuredSelection = workspaceStructuredSelectionSchema.parse({
      kind: 'domain',
      selectionType: 'fixture.domain.selection',
      data: { wireVersion: 2, selection: { ids: ['item-1'] } }
    })
    const activeSession = session({ selection: selected })
    const selectionResult = {
      ok: true as const,
      session: activeSession,
      operationKind: 'workspace.setSelection' as const,
      appliedAt: NOW,
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        operationKind: 'workspace.setSelection' as const,
        effect: 'session-update' as const
      }
    }
    const exportResult: WorkspacePreviewExportResult = {
      ok: true,
      sessionId: activeSession.id,
      target: { kind: 'workspace-file', format: 'json' },
      exportedAt: NOW,
      path: 'protein.json',
      audit: {
        pluginId: activeSession.pluginId,
        sourcePath: activeSession.path,
        targetKind: 'workspace-file',
        format: 'json',
        effect: 'source-copy'
      }
    }
    const host = {
      setSelection: vi.fn(async () => selectionResult),
      export: vi.fn(async () => exportResult)
    } as unknown as WorkspacePreviewHost
    const runnerContext = context(host, { session: activeSession })

    await expect(runWorkspacePreviewToolbarAction(
      toolbarAction(createSetSelectionWorkspacePreviewAction()),
      runnerContext
    )).resolves.toMatchObject({ ok: true, kind: 'set-selection' })
    await expect(runWorkspacePreviewToolbarAction(
      toolbarAction(createExportWorkspacePreviewAction('json'), 'json'),
      runnerContext
    )).resolves.toMatchObject({ ok: true, kind: 'export' })
  })

  it('runs a package-contributed action without central action-id dispatch', async () => {
    const custom = createInvokeWorkspacePreviewAction({
      id: 'custom-domain.analyze',
      label: 'Analyze',
      buildInput: (current) => ({ path: current.file.path })
    })
    const result: WorkspacePreviewInvokeActionResult = {
      ok: true,
      sessionId: 'session-1',
      pluginId: 'molecular',
      actionId: custom.id,
      invokedAt: NOW,
      result: { ok: true },
      audit: {
        pluginId: 'molecular',
        path: 'protein.pdb',
        actionId: custom.id,
        effect: 'worker-action'
      }
    }
    const host = { invokeAction: vi.fn(async () => result) } as unknown as WorkspacePreviewHost

    await expect(runWorkspacePreviewToolbarAction(
      toolbarAction(custom),
      context(host)
    )).resolves.toMatchObject({ ok: true, kind: 'invoke-action', actionId: custom.id })
    expect(host.invokeAction).toHaveBeenCalledWith('session-1', {
      actionId: custom.id,
      input: { path: 'protein.pdb' }
    })
  })
})
