import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
  type MarkdownWechatCopyResult
} from '@shared/markdown-wechat'

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
    onCopyForWechat?: () => Promise<MarkdownWechatCopyResult>
    onOpenWorkspaceLink?: (target: { path: string; workspaceRoot: string }) => void
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
  WorkspacePreviewPluginOutlet
} from './WorkspacePreviewPluginOutlet'
import {
  createBuiltInWorkspacePreviewPluginRegistrations,
  BUILT_IN_WORKSPACE_PREVIEW_OWNER_ID
} from './built-in-plugin-contributions'

import {
  createRendererWorkspacePreviewRegistry
} from './registry'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'

const rendererWorkspacePreviewRegistry = createRendererWorkspacePreviewRegistry({
  registrations: createBuiltInWorkspacePreviewPluginRegistrations()
})

function createObservation(
  modality: WorkspaceObservation['view']['modality'],
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  const path = `/workspace/lab/sample.${modality}`
  const pluginId = ({
    sequence: 'sequence-genomics',
    omics: 'omics-matrix',
    spectra: 'proteomics-spectra'
  } as Partial<Record<WorkspaceObservation['view']['modality'], string>>)[modality] ?? modality

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path,
      workspaceRoot: '/workspace/lab'
    },
    view: {
      pluginId,
      modality,
      mode: 'preview',
      title: `sample.${modality}`
    },
    actions: [],
    ...overrides
  }
}

function customManifest(id: string) {
  return {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION as 1,
    id,
    displayName: id,
    version: '1.0.0',
    modality: 'unknown' as const,
    lifecycle: 'renderer' as const,
    priority: 100,
    extensions: [`.${id}`],
    mimeTypes: [],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: false
    }
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
      }
    ]

    for (const testCase of cases) {
      const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
        context: createContext(testCase.observation),
        routeReason: 'registered-plugin',
        rendererRegistry: rendererWorkspacePreviewRegistry
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
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
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

  it('copies Markdown for WeChat through the advertised workspace preview host action', async () => {
    const copyResult: MarkdownWechatCopyResult = {
      copiedAt: '2026-07-30T09:00:00.000Z',
      outputBytes: 768,
      counts: {
        formulas: 2,
        inlineFormulas: 1,
        displayFormulas: 1,
        codeBlocks: 1,
        embeddedImages: 1,
        remoteImages: 0
      },
      warnings: [],
      effect: 'clipboard-write'
    }
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
      visibleText: '# Notes',
      text: { lineCount: 1, characterCount: 7, truncated: false },
      actions: [MARKDOWN_COPY_FOR_WECHAT_ACTION_ID]
    })
    const invokeAction = vi.fn(async (_sessionId: string, action: { actionId: string }) => ({
      ok: true as const,
      sessionId: 'session-1',
      pluginId: 'markdown',
      actionId: action.actionId,
      invokedAt: '2026-07-30T09:00:00.000Z',
      result: copyResult,
      audit: {
        pluginId: 'markdown',
        path: '/workspace/lab/docs/notes.md',
        actionId: action.actionId,
        effect: 'host-action' as const
      }
    }))

    renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation, { invokeAction }),
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    await expect(pluginOutletMocks.latestMarkdownProps?.onCopyForWechat?.()).resolves.toEqual(copyResult)
    expect(invokeAction).toHaveBeenCalledWith('session-1', {
      actionId: MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
      input: {}
    })
  })

  it('does not expose WeChat copy when the observation does not advertise it', () => {
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
      visibleText: '# Notes',
      text: { lineCount: 1, characterCount: 7, truncated: false },
      actions: ['markdown.readImage']
    })

    renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation),
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    expect(pluginOutletMocks.latestMarkdownProps?.onCopyForWechat).toBeUndefined()
  })

  it('rejects malformed WeChat copy action results at the renderer boundary', async () => {
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
      visibleText: '# Notes',
      text: { lineCount: 1, characterCount: 7, truncated: false },
      actions: [MARKDOWN_COPY_FOR_WECHAT_ACTION_ID]
    })
    const invokeAction = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      pluginId: 'markdown',
      actionId: MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
      invokedAt: '2026-07-30T09:00:00.000Z',
      result: { copiedAt: 'not-a-valid-result' },
      audit: {
        pluginId: 'markdown',
        path: '/workspace/lab/docs/notes.md',
        actionId: MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
        effect: 'host-action' as const
      }
    }))

    renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation, { invokeAction }),
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    await expect(pluginOutletMocks.latestMarkdownProps?.onCopyForWechat?.())
      .rejects.toThrow('invalid result')
  })

  it('routes Markdown workspace links through the shell file opener', () => {
    const observation = createObservation('document', {
      file: {
        path: '/workspace/lab/docs/survey.md',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/markdown'
      },
      view: {
        pluginId: 'markdown',
        modality: 'document',
        mode: 'preview',
        title: 'survey.md'
      },
      visibleText: '[OPSD](../OPSD/OPSD.md)',
      text: { lineCount: 1, characterCount: 24, truncated: false }
    })
    const openFile = vi.fn()
    const context = createContext(observation)
    context.openFile = openFile

    renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context,
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    pluginOutletMocks.latestMarkdownProps?.onOpenWorkspaceLink?.({
      path: '/workspace/lab/OPSD/OPSD.md',
      workspaceRoot: '/workspace/lab'
    })
    expect(openFile).toHaveBeenCalledWith({
      path: '/workspace/lab/OPSD/OPSD.md',
      workspaceRoot: '/workspace/lab'
    })
  })

  it('passes the shared presentation-state channel through to the active viewer', () => {
    const observation = createObservation('document')
    const rendererRegistry = createRendererWorkspacePreviewRegistry({
      registrations: [{
        ownerId: 'example.presentation-aware',
        contribution: {
        manifest: customManifest('text'),
        render: ({ onPresentationStateChange }) => createElement('div', {
          'data-has-presentation-state-change': onPresentationStateChange ? 'true' : 'false'
        })
      }
      }]
    })
    const textObservation = createObservation('text', {
      view: { pluginId: 'text', modality: 'text', mode: 'preview', title: 'notes.txt' }
    })

    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(textObservation),
      routeReason: 'registered-plugin',
      rendererRegistry,
      onPresentationStateChange: vi.fn()
    }))

    expect(html).toContain('data-has-presentation-state-change="true"')
  })

  it('renders a generic plugin summary for unregistered shell routes', () => {
    const observation = createObservation('unknown', {
      view: {
        pluginId: 'unregistered-science',
        modality: 'unknown',
        mode: 'preview',
        title: 'mesh.vtk'
      },
      visibleText: 'No preview plugin is registered.',
      actions: ['workspace.export:source']
    })
    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation),
      routeReason: 'unregistered-format',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    expect(html).toContain('data-workspace-preview-plugin-summary')
    expect(html).toContain('data-route-reason="unregistered-format"')
    expect(html).toContain('No inline workspace preview plugin is registered')
    expect(html).toContain('Use Inspect for plugin details')
    expect(html).not.toContain('No preview plugin is registered.')
    expect(html).not.toContain('workspace.export:source')
  })

  it('routes registered plugin targets from bridge route metadata while observation is still empty', () => {
    const pdfHtml = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(null),
      routeReason: 'registered-plugin',
      routePluginId: 'pdf',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

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
    const manifest = customManifest('custom-life-science')
    const rendererRegistry = createRendererWorkspacePreviewRegistry({
      registrations: [{
        ownerId: 'example.custom-life-science',
        contribution: {
        manifest,
        render: () => createElement('div', { 'data-custom-renderer': 'true' })
      }
      }]
    })
    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context,
      routeReason: 'registered-plugin',
      rendererRegistry
    }))

    expect(html).toContain('data-custom-renderer="true"')
    expect(html).not.toContain('data-workspace-preview-plugin-summary')
  })

  it('routes by canonical plugin id without observation-shape arbitration', () => {
    const observation = createObservation('text', {
      visibleText: 'alpha',
      text: { lineCount: 1, characterCount: 5, truncated: false },
      tables: [{ id: 'table-1', rowCount: 1, columnCount: 1 }],
      tabular: { header: ['sample'], rows: [{ index: 0, values: ['s1'] }] }
    })

    const html = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context: createContext(observation),
      routeReason: 'registered-plugin',
      rendererRegistry: rendererWorkspacePreviewRegistry
    }))

    expect(html).toContain('data-workspace-preview-text-viewer')
    expect(html).not.toContain('data-workspace-preview-tabular-viewer')
    expect(rendererWorkspacePreviewRegistry.list().every(
      ({ ownerId }) => ownerId === BUILT_IN_WORKSPACE_PREVIEW_OWNER_ID
    )).toBe(true)
  })

  it('disposes a package contribution without leaving a renderer path', () => {
    const observation = createObservation('unknown', {
      view: {
        pluginId: 'custom-live-renderer',
        modality: 'unknown',
        mode: 'preview',
        title: 'custom.live'
      }
    })
    const context = createContext(observation)
    const rendererRegistry = createRendererWorkspacePreviewRegistry()
    const registration = rendererRegistry.register('example.custom-live-renderer', {
        manifest: customManifest('custom-live-renderer'),
        render: () => createElement('div', { 'data-custom-live-renderer': 'true' })
    })

    try {
      const registeredHtml = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
        context,
        routeReason: 'registered-plugin',
        rendererRegistry
      }))
      expect(registeredHtml).toContain('data-custom-live-renderer="true"')
      expect(registeredHtml).not.toContain('data-workspace-preview-plugin-summary')
    } finally {
      registration.dispose()
    }

    const disposedHtml = renderToStaticMarkup(createElement(WorkspacePreviewPluginOutlet, {
      context,
      routeReason: 'registered-plugin',
      rendererRegistry
    }))
    expect(disposedHtml).toContain('data-workspace-preview-plugin-summary')
    expect(disposedHtml).not.toContain('data-custom-live-renderer')
  })

  it('applies edit operations through the shell host and refreshes the returned session', async () => {
    const operation: WorkspacePreviewEditOperation = {
      kind: 'workspace.setSelection',
      path: '/workspace/lab/reads.fasta',
      selection: {
        kind: 'text',
        ranges: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 }]
      }
    }
    const applyEdit = vi.fn(async () => ({
      ok: true as const,
      session: {
        id: 'session-after-edit',
        pluginId: 'fixture-preview',
        workspaceRoot: '/workspace/lab',
        path: '/workspace/lab/reads.fasta',
        modality: 'text' as const,
        mode: 'preview' as const,
        openedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:01:00.000Z'
      },
      operationKind: 'workspace.setSelection' as const,
      appliedAt: '2026-07-08T00:01:00.000Z',
      audit: {
        pluginId: 'fixture-preview',
        path: '/workspace/lab/reads.fasta',
        operationKind: 'workspace.setSelection' as const,
        effect: 'session-update' as const
      }
    }))
    const observe = vi.fn(async () => ({
      ok: true as const,
      observation: createObservation('text')
    }))
    const context = createContext(createObservation('text'), {
      applyEdit,
      observe
    })

    await applyWorkspacePreviewOutletEdit(context, operation)

    expect(applyEdit).toHaveBeenCalledWith(operation)
    expect(observe).toHaveBeenCalledWith('session-after-edit')
  })
})
