import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'

vi.mock('../components/write/WritePdfViewer', () => ({
  WritePdfViewer: (props: { onPresentationStateChange?: unknown }) => createElement('div', {
    'data-write-pdf-viewer': 'true',
    'data-has-presentation-state-change': props.onPresentationStateChange ? 'true' : 'false'
  })
}))

vi.mock('../components/write/WriteDocxViewer', () => ({
  WriteDocxViewer: () => createElement('div', { 'data-write-docx-viewer': 'true' })
}))

const pluginOutletMocks = vi.hoisted(() => ({
  latestMarkdownProps: null as null | {
    loadWorkspaceImage?: (input: { path: string; workspaceRoot: string }) => Promise<{
      ok: true
      dataUrl: string
    } | {
      ok: false
      message?: string
    }>
  }
}))

vi.mock('./MarkdownWorkspaceViewer', () => ({
  MarkdownWorkspaceViewer: (props: NonNullable<typeof pluginOutletMocks.latestMarkdownProps>) => {
    pluginOutletMocks.latestMarkdownProps = props
    return createElement('div', { 'data-workspace-preview-markdown-viewer': 'true' })
  }
}))

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
    host,
    refresh: vi.fn(),
    refreshing: false
  }
}

describe('WorkspacePreviewPluginOutlet', () => {
  beforeEach(() => {
    pluginOutletMocks.latestMarkdownProps = null
  })

  it('routes shell observations to the matching renderer plugin viewer', () => {
    const cases: Array<{
      observation: WorkspaceObservation
      marker: string
    }> = [
      {
        observation: createObservation('text', {
          visibleText: 'alpha',
          text: { lineCount: 1, characterCount: 5, truncated: false },
          actions: ['text.replaceRange']
        }),
        marker: 'data-workspace-preview-text-viewer'
      },
      {
        observation: createObservation('document', {
          file: {
            path: '/workspace/lab/notes.md',
            workspaceRoot: '/workspace/lab',
            mimeType: 'text/markdown'
          },
          view: {
            pluginId: 'markdown',
            modality: 'document',
            mode: 'preview',
            title: 'notes.md'
          },
          visibleText: '# Alpha\n',
          text: { lineCount: 1, characterCount: 8, truncated: false },
          actions: ['text.replaceRange']
        }),
        marker: 'data-workspace-preview-markdown-viewer'
      },
      {
        observation: createObservation('document', {
          file: {
            path: '/workspace/lab/report.html',
            workspaceRoot: '/workspace/lab',
            mimeType: 'text/html'
          },
          view: {
            pluginId: 'html',
            modality: 'document',
            mode: 'preview',
            title: 'report.html'
          },
          visibleText: '<h1>Alpha</h1>',
          text: { lineCount: 1, characterCount: 14, truncated: false },
          actions: ['text.replaceRange']
        }),
        marker: 'data-workspace-preview-html-viewer'
      },
      {
        observation: createObservation('image', {
          file: {
            path: '/workspace/lab/cell.png',
            workspaceRoot: '/workspace/lab',
            mimeType: 'image/png'
          },
          view: {
            pluginId: 'image',
            modality: 'image',
            mode: 'preview',
            title: 'cell.png'
          }
        }),
        marker: 'data-workspace-preview-image-viewer'
      },
      {
        observation: createObservation('document', {
          file: {
            path: '/workspace/lab/paper.pdf',
            workspaceRoot: '/workspace/lab',
            mimeType: 'application/pdf'
          },
          view: {
            pluginId: 'pdf',
            modality: 'document',
            mode: 'preview',
            title: 'paper.pdf'
          }
        }),
        marker: 'data-workspace-preview-pdf-viewer'
      },
      {
        observation: createObservation('document', {
          file: {
            path: '/workspace/lab/report.docx',
            workspaceRoot: '/workspace/lab',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          },
          view: {
            pluginId: 'docx',
            modality: 'document',
            mode: 'preview',
            title: 'report.docx'
          },
          document: {
            paragraphs: [{ id: 'docx-p-1', index: 1, text: 'Body paragraph' }],
            truncatedParagraphs: false
          }
        }),
        marker: 'data-workspace-preview-docx-viewer'
      },
      {
        observation: createObservation('tabular', {
          tables: [{ id: 'table-1', rowCount: 1, columnCount: 1 }],
          tabular: { header: ['sample'], rows: [{ index: 0, values: ['s1'] }] },
          actions: ['tabular.updateCell']
        }),
        marker: 'data-workspace-preview-tabular-viewer'
      },
      {
        observation: createObservation('deck', {
          slides: [{ id: 'slide-1', index: 0, title: 'Intro' }],
          actions: ['deck.updateTextElement']
        }),
        marker: 'data-workspace-preview-deck-viewer'
      },
      {
        observation: createObservation('molecular', {
          molecular: { modelCount: 1, chains: ['A'] },
          actions: ['molecular.workbench']
        }),
        marker: 'data-workspace-preview-molecular-viewer'
      },
      {
        observation: createObservation('sequence', {
          sequence: { sequenceCount: 1, totalLength: 8, alphabet: 'dna' },
          actions: ['workspace.setSelection']
        }),
        marker: 'data-workspace-preview-sequence-viewer'
      },
      {
        observation: createObservation('omics', {
          omics: { matrixShape: [10, 4], matrixIds: ['X'] },
          actions: ['omics.preview']
        }),
        marker: 'data-workspace-preview-omics-viewer'
      },
      {
        observation: createObservation('bioimaging', {
          bioimaging: { dimensions: { width: 128, height: 64 } },
          actions: ['bioimaging.inspectHeader']
        }),
        marker: 'data-workspace-preview-bioimaging-viewer'
      },
      {
        observation: createObservation('spectra', {
          spectra: { spectrumCount: 1, sampledPeaks: [{ mz: 100, intensity: 42 }] },
          actions: ['spectra.preview']
        }),
        marker: 'data-workspace-preview-spectra-viewer'
      }
    ]

    for (const testCase of cases) {
      const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
        context: createContext(testCase.observation),
        routeReason: 'registered-plugin'
      }))

      expect(html).toContain(testCase.marker)
    }
  })

  it('loads Markdown relative images through the workspace preview host action', async () => {
    const observation = createObservation('document', {
      file: {
        path: '/workspace/lab/docs/notes.md',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/markdown'
      },
      view: {
        pluginId: 'markdown',
        modality: 'document',
        mode: 'preview',
        title: 'notes.md'
      },
      visibleText: '![Cell](figures/cell.png)',
      text: { lineCount: 1, characterCount: 25, truncated: false },
      actions: ['markdown.readImage', 'text.replaceRange']
    })
    const invokeAction = vi.fn(async (_sessionId: string, action: { actionId: string }) => ({
      ok: true as const,
      sessionId: 'session-1',
      pluginId: 'markdown',
      actionId: action.actionId,
      invokedAt: '2026-07-08T00:00:00.000Z',
      result: { dataUrl: 'data:image/png;base64,aW1n' },
      audit: {
        pluginId: 'markdown',
        path: '/workspace/lab/docs/notes.md',
        actionId: action.actionId,
        effect: 'host-action' as const
      }
    }))

    renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation, { invokeAction }),
      routeReason: 'registered-plugin'
    }))

    await expect(pluginOutletMocks.latestMarkdownProps?.loadWorkspaceImage?.({
      path: '/workspace/lab/docs/figures/cell.png',
      workspaceRoot: '/workspace/lab'
    })).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,aW1n'
    })
    expect(invokeAction).toHaveBeenCalledWith('session-1', {
      actionId: 'markdown.readImage',
      input: { path: '/workspace/lab/docs/figures/cell.png' }
    })
  })

  it('passes the shared presentation-state channel through to the active viewer', () => {
    const observation = createObservation('document')

    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation),
      routeReason: 'registered-plugin',
      renderers: [{
        id: 'presentation-aware',
        matches: () => true,
        render: ({ onPresentationStateChange }) => createElement('div', {
          'data-has-presentation-state-change': onPresentationStateChange ? 'true' : 'false'
        })
      }],
      onPresentationStateChange: vi.fn()
    }))

    expect(html).toContain('data-has-presentation-state-change="true"')
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
    expect(html).toContain('inline viewer has not been enabled')
    expect(html).toContain('Use Inspect for plugin details')
    expect(html).not.toContain('Preview support is deferred.')
    expect(html).not.toContain('workspace.export:source')
  })

  it('routes registered plugin targets from bridge route metadata while observation is still empty', () => {
    const molecularHtml = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(null),
      routeReason: 'registered-plugin',
      routePluginId: 'molecular',
      routeModality: 'molecular'
    }))
    const pdfHtml = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(null),
      routeReason: 'registered-plugin',
      routePluginId: 'pdf',
      routeModality: 'document'
    }))

    expect(molecularHtml).toContain('data-workspace-preview-molecular-viewer')
    expect(molecularHtml).not.toContain('data-workspace-preview-plugin-summary')
    expect(pdfHtml).toContain('data-workspace-preview-pdf-viewer')
    expect(pdfHtml).not.toContain('data-workspace-preview-plugin-summary')
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
      'registered-plugin',
      renderers
    )
    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context,
      routeReason: 'registered-plugin',
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
