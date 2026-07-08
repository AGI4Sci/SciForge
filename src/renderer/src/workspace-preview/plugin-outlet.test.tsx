import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHostState,
  type WorkspacePreviewHost
} from './host'
import {
  applyWorkspacePreviewOutletEdit,
  resolveWorkspacePreviewPluginRendererContribution,
  WorkspacePreviewPluginOutlet
} from './WorkspacePreviewPluginOutlet'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'

function createObservation(
  modality: WorkspaceObservation['view']['modality'],
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  const path = `/workspace/lab/sample.${modality}`

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path,
      workspaceRoot: '/workspace/lab'
    },
    view: {
      pluginId: modality,
      modality,
      mode: 'preview',
      title: `sample.${modality}`
    },
    actions: [],
    ...overrides
  }
}

function createContext(
  observation: WorkspaceObservation | null,
  hostOverrides: Record<string, unknown> = {}
): WorkspacePreviewPanelShellContext {
  const host = {
    applyEdit: vi.fn(),
    observe: vi.fn(),
    readRange: vi.fn(),
    ...hostOverrides
  } as unknown as WorkspacePreviewHost

  return {
    state: createWorkspacePreviewHostState({
      observation,
      session: observation
        ? {
            id: 'session-1',
            pluginId: observation.view.pluginId,
            workspaceRoot: observation.file.workspaceRoot ?? '/workspace/lab',
            path: observation.file.path,
            modality: observation.view.modality,
            mode: observation.view.mode,
            openedAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:00:00.000Z'
          }
        : null
    }),
    asset: null,
    assetStatus: 'idle',
    assetError: null,
    transport: createWorkspacePreviewAssetTransportClient({
      descriptor: null,
      readRange: (range) => host.readRange(range)
    }),
    host
  }
}

describe('WorkspacePreviewPluginOutlet', () => {
  it('routes shell observations to the matching renderer plugin viewer', () => {
    const cases: Array<{
      observation: WorkspaceObservation
      routeReason: 'life-science' | 'text-first-party' | 'tabular-first-party' | 'deck-first-party'
      marker: string
    }> = [
      {
        observation: createObservation('text', {
          visibleText: 'alpha',
          text: { lineCount: 1, characterCount: 5, truncated: false },
          actions: ['text.replaceRange']
        }),
        routeReason: 'text-first-party',
        marker: 'data-workspace-preview-text-viewer'
      },
      {
        observation: createObservation('tabular', {
          tables: [{ id: 'table-1', rowCount: 1, columnCount: 1 }],
          tabular: { header: ['sample'], rows: [{ index: 0, values: ['s1'] }] },
          actions: ['tabular.updateCell']
        }),
        routeReason: 'tabular-first-party',
        marker: 'data-workspace-preview-tabular-viewer'
      },
      {
        observation: createObservation('deck', {
          slides: [{ id: 'slide-1', index: 0, title: 'Intro' }],
          actions: ['deck.updateTextElement']
        }),
        routeReason: 'deck-first-party',
        marker: 'data-workspace-preview-deck-viewer'
      },
      {
        observation: createObservation('molecular', {
          molecular: { modelCount: 1, chains: ['A'] },
          actions: ['molecular.select']
        }),
        routeReason: 'life-science',
        marker: 'data-workspace-preview-molecular-viewer'
      },
      {
        observation: createObservation('sequence', {
          sequence: { sequenceCount: 1, totalLength: 8, alphabet: 'dna' },
          actions: ['workspace.setSelection']
        }),
        routeReason: 'life-science',
        marker: 'data-workspace-preview-sequence-viewer'
      },
      {
        observation: createObservation('omics', {
          omics: { matrixShape: [10, 4], matrixIds: ['X'] },
          actions: ['omics.preview']
        }),
        routeReason: 'life-science',
        marker: 'data-workspace-preview-omics-viewer'
      },
      {
        observation: createObservation('bioimaging', {
          bioimaging: { dimensions: { width: 128, height: 64 } },
          actions: ['bioimaging.inspectHeader']
        }),
        routeReason: 'life-science',
        marker: 'data-workspace-preview-bioimaging-viewer'
      },
      {
        observation: createObservation('spectra', {
          spectra: { spectrumCount: 1, sampledPeaks: [{ mz: 100, intensity: 42 }] },
          actions: ['spectra.preview']
        }),
        routeReason: 'life-science',
        marker: 'data-workspace-preview-spectra-viewer'
      }
    ]

    for (const testCase of cases) {
      const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
        context: createContext(testCase.observation),
        routeReason: testCase.routeReason
      }))

      expect(html).toContain(testCase.marker)
    }
  })

  it('renders a generic plugin summary for deferred shell routes without a dedicated viewer', () => {
    const observation = createObservation('unknown', {
      view: {
        pluginId: 'deferred-science',
        modality: 'unknown',
        mode: 'preview',
        title: 'mesh.vtk'
      },
      visibleText: 'Preview support is deferred.',
      actions: ['workspace.export:source']
    })
    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation),
      routeReason: 'deferred-non-life-science'
    }))

    expect(html).toContain('data-workspace-preview-plugin-summary')
    expect(html).toContain('data-route-reason="deferred-non-life-science"')
    expect(html).toContain('Preview support is deferred.')
  })

  it('supports renderer contributions without changing the outlet body', () => {
    const observation = createObservation('unknown', {
      view: {
        pluginId: 'custom-life-science',
        modality: 'unknown',
        mode: 'preview',
        title: 'custom.dat'
      }
    })
    const context = createContext(observation)
    const renderers = [{
      id: 'custom-life-science',
      matches: ({ pluginId }: { pluginId?: string }) => pluginId === 'custom-life-science',
      render: () => createElement('div', { 'data-custom-renderer': 'true' })
    }]
    const resolved = resolveWorkspacePreviewPluginRendererContribution(
      context,
      'life-science',
      renderers
    )
    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context,
      routeReason: 'life-science',
      renderers
    }))

    expect(resolved?.id).toBe('custom-life-science')
    expect(html).toContain('data-custom-renderer="true"')
    expect(html).not.toContain('data-workspace-preview-plugin-summary')
  })

  it('applies edit operations through the shell host and refreshes the returned session', async () => {
    const operation: WorkspacePreviewEditOperation = {
      kind: 'workspace.setSelection',
      path: '/workspace/lab/reads.fasta',
      selection: {
        kind: 'sequence',
        sequenceId: 'read1',
        ranges: [{ start: 0, end: 8 }]
      }
    }
    const applyEdit = vi.fn(async () => ({
      ok: true as const,
      session: {
        id: 'session-after-edit',
        pluginId: 'sequence-genomics',
        workspaceRoot: '/workspace/lab',
        path: '/workspace/lab/reads.fasta',
        modality: 'sequence' as const,
        mode: 'preview' as const,
        openedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:01:00.000Z'
      },
      operationKind: 'workspace.setSelection' as const,
      appliedAt: '2026-07-08T00:01:00.000Z',
      audit: {
        pluginId: 'sequence-genomics',
        path: '/workspace/lab/reads.fasta',
        operationKind: 'workspace.setSelection' as const,
        effect: 'session-update' as const
      }
    }))
    const observe = vi.fn(async () => ({
      ok: true as const,
      observation: createObservation('sequence')
    }))
    const context = createContext(createObservation('sequence'), {
      applyEdit,
      observe
    })

    await applyWorkspacePreviewOutletEdit(context, operation)

    expect(applyEdit).toHaveBeenCalledWith(operation)
    expect(observe).toHaveBeenCalledWith('session-after-edit')
  })
})
