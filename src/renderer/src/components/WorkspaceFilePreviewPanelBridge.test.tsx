import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../workspace-preview/PdfWorkspaceViewer', () => ({ PdfWorkspaceViewer: () => null }))
import type { ReactNode } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { CAPABILITY_BROKER_CONTRACT_VERSION } from '@shared/capability-broker'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewModalitySchema,
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  WorkspaceFilePreviewPanelBridge,
  buildWorkspacePreviewVisibleContextComponent,
  resolveWorkspaceFilePreviewPanelBridgeRoute,
  resolveWorkspacePreviewWorkspaceLocator,
  workspacePreviewVisualContentType
} from './WorkspaceFilePreviewPanelBridge'
import { workspacePreviewVisibleContextComponentId } from '../workspace-preview/visible-context-identity'

const TEST_SURFACE_ID = 'right-panel-pane-test'

const workspacePreviewMock = vi.hoisted(() => {
  const editSummary = {
    schemaVersion: 1 as const,
    kind: 'bounded' as const,
    summary: 'Updated 1 cell in table.csv.',
    operationKind: 'tabular.updateCell',
    target: {
      path: '/workspace/lab/table.csv',
      tabular: {
        cells: [{ row: 0, column: 1 }]
      }
    },
    counts: {
      filesChanged: 1 as const,
      cellsChanged: 1
    },
    undo: {
      available: false as const,
      hint: 'Undo is unavailable for workspace preview edits.'
    },
    bounded: {
      maxPreviewItems: 20,
      maxPreviewChars: 4000,
      truncated: false
    }
  }
  const mock = {
    editSummary,
    lastEditSummary: null as null | typeof editSummary,
    latestTabularProps: null as null | {
      onApplyEdit?: (operation: unknown) => Promise<void> | void
    },
    latestTextProps: null as null | {
      onApplyEdit?: (operation: unknown) => Promise<void> | void
    },
    latestDeckProps: null as null | {
      onApplyEdit?: (operation: unknown) => Promise<void> | void
    },
    latestMolecularProps: null as null | {
      asset?: unknown
      assetStatus?: string
      assetError?: string | null
      readRange?: (range: unknown) => Promise<unknown>
      onApplyEdit?: (operation: unknown) => Promise<void> | void
    },
    latestSequenceProps: null as null | {
      onSetSelection?: (operation: unknown) => Promise<void> | void
    },
    host: {
      applyEdit: vi.fn(async (operation: unknown) => {
        const operationKind = typeof operation === 'object' && operation !== null && 'kind' in operation
          ? String((operation as { kind?: unknown }).kind)
          : 'tabular.updateCell'
        const isDeckEdit = operationKind === 'deck.updateTextElement'
        const isTextEdit = operationKind === 'text.replaceRange'
        const isMolecularEdit = operationKind === 'domain.applyEdit' &&
          typeof operation === 'object' && operation !== null && 'operationType' in operation &&
          operation.operationType === 'sciforge.life-science-preview.molecular.set-selection'
        const isWorkspaceSelection = operationKind === 'workspace.setSelection'
        mock.lastEditSummary = editSummary
        return {
          ok: true as const,
          session: {
            id: isDeckEdit
              ? 'session-deck'
              : isTextEdit
                ? 'session-text'
                : isMolecularEdit
                  ? 'session-molecular'
                  : isWorkspaceSelection
                    ? 'session-sequence'
                  : 'session-tabular',
            pluginId: isDeckEdit
              ? 'deck'
              : isTextEdit
                ? 'text'
                : isMolecularEdit
                  ? 'molecular'
                  : isWorkspaceSelection
                    ? 'sequence-genomics'
                  : 'tabular',
            workspaceRoot: '/workspace/lab',
            path: isDeckEdit
              ? '/workspace/lab/slides.pptx'
              : isTextEdit
                ? '/workspace/lab/notes.txt'
                : isMolecularEdit
                  ? '/workspace/lab/protein.pdb'
                  : isWorkspaceSelection
                    ? '/workspace/lab/reads.fasta'
                  : '/workspace/lab/table.csv',
            modality: isDeckEdit
              ? 'deck' as const
              : isTextEdit
                ? 'text' as const
                : isMolecularEdit
                  ? 'molecular' as const
                  : isWorkspaceSelection
                    ? 'sequence' as const
                  : 'tabular' as const,
            mode: 'preview' as const,
            openedAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:01:00.000Z'
          },
          operationKind,
          appliedAt: '2026-07-08T00:01:00.000Z',
          audit: {
            pluginId: isDeckEdit
              ? 'deck'
              : isTextEdit
                ? 'text'
                : isMolecularEdit
                  ? 'molecular'
                  : isWorkspaceSelection
                    ? 'sequence-genomics'
                    : 'tabular',
            path: isDeckEdit
              ? '/workspace/lab/slides.pptx'
              : isTextEdit
                ? '/workspace/lab/notes.txt'
                : isMolecularEdit
                  ? '/workspace/lab/protein.pdb'
                  : isWorkspaceSelection
                    ? '/workspace/lab/reads.fasta'
                  : '/workspace/lab/table.csv',
            operationKind,
            effect: isMolecularEdit || isWorkspaceSelection ? 'session-update' as const : 'file-write' as const
          },
          diffSummary: editSummary
        }
      }),
      observe: vi.fn(async () => ({
        ok: true as const,
        observation: {
          schemaVersion: 1 as const,
          file: {
            path: '/workspace/lab/table.csv',
            workspaceRoot: '/workspace/lab'
          },
          view: {
            pluginId: 'tabular',
            modality: 'tabular' as const,
            mode: 'preview' as const,
            title: 'table.csv'
          },
          actions: ['tabular.updateCell']
        }
      })),
      readRange: vi.fn(async () => ({
        ok: true as const,
        sessionId: 'session-molecular',
        assetId: 'asset:session-molecular',
        offset: 0,
        length: 4,
        size: 4,
        dataBase64: 'RU5ECg=='
      }))
    }
  }
  return mock
})

vi.mock('../workspace-preview', async () => {
  const registry = await vi.importActual<typeof import('../workspace-preview/registry')>(
    '../workspace-preview/registry'
  )
  const shared = await vi.importActual<typeof import('@shared/workspace-preview')>('@shared/workspace-preview')
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  const rendererWorkspacePreviewRegistry = registry.createRendererWorkspacePreviewRegistry({
    registrations: shared.DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => ({
      ownerId: 'test',
      contribution: { manifest, render: () => h('div') }
    }))
  })
  const contextForTarget = (target: WorkspaceFileTarget | null) => {
    const isText = Boolean(target?.path.match(/\.(?:txt|text|log)$/i))
    const isTabular = Boolean(target?.path.match(/\.(?:csv|tsv|jsonl|ndjson|xlsx)$/i))
    const isDeck = Boolean(target?.path.match(/\.pptx$/i))
    const isMolecular = Boolean(target?.path.match(/\.(?:pdb|cif|mmcif|sdf|mol|mol2|xyz)$/i))
    const isSequence = Boolean(target?.path.match(/\.(?:fasta|fa|fastq|fq|gb|gbk|gff|gff3|gtf|bed|vcf)$/i))
    const integrityMismatch = Boolean(target?.integrity && target.path.includes('integrity-mismatch'))
    const verifiedSha256 = target?.integrity?.expectedDigest.replace(/^sha256:/u, '')
    return {
      state: {
        session: isTabular
          ? {
              id: 'session-tabular',
              pluginId: 'tabular',
              workspaceRoot: '/workspace/lab',
              path: '/workspace/lab/table.csv',
              modality: 'tabular' as const,
              mode: 'preview' as const,
              openedAt: '2026-07-08T00:00:00.000Z',
              updatedAt: '2026-07-08T00:00:00.000Z'
            }
          : isDeck
            ? {
                id: 'session-deck',
                pluginId: 'deck',
                workspaceRoot: '/workspace/lab',
                path: '/workspace/lab/slides.pptx',
                modality: 'deck' as const,
                mode: 'preview' as const,
                openedAt: '2026-07-08T00:00:00.000Z',
                updatedAt: '2026-07-08T00:00:00.000Z'
              }
          : isMolecular
            ? {
                id: 'session-molecular',
                pluginId: 'molecular',
                workspaceRoot: '/workspace/lab',
                path: '/workspace/lab/protein.pdb',
                modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
                mode: 'preview' as const,
                openedAt: '2026-07-08T00:00:00.000Z',
                updatedAt: '2026-07-08T00:00:00.000Z'
              }
          : isSequence
            ? {
                id: 'session-sequence',
                pluginId: 'sequence-genomics',
                workspaceRoot: '/workspace/lab',
                path: '/workspace/lab/reads.fasta',
                modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.sequence'),
                mode: 'preview' as const,
                openedAt: '2026-07-08T00:00:00.000Z',
                updatedAt: '2026-07-08T00:00:00.000Z'
              }
          : isText
            ? {
                id: 'session-text',
                pluginId: 'text',
                workspaceRoot: '/workspace/lab',
                path: '/workspace/lab/notes.txt',
                modality: 'text' as const,
                mode: 'preview' as const,
                openedAt: '2026-07-08T00:00:00.000Z',
                updatedAt: '2026-07-08T00:00:00.000Z'
              }
          : null,
        descriptor: null,
        observation: isTabular
          ? {
              schemaVersion: 1 as const,
              file: {
                path: '/workspace/lab/table.csv',
                workspaceRoot: '/workspace/lab',
                mimeType: 'text/csv'
              },
              view: {
                pluginId: 'tabular',
                modality: 'tabular' as const,
                mode: 'preview' as const,
                title: 'table.csv'
              },
              tables: [{ id: 'table-1', name: 'table.csv', rowCount: 1, columnCount: 1 }],
              tabular: {
                header: ['sample'],
                rows: [{ index: 0, values: ['s1'] }]
              },
              actions: ['tabular.updateCell']
            }
          : isDeck
            ? {
                schemaVersion: 1 as const,
                file: {
                  path: '/workspace/lab/slides.pptx',
                  workspaceRoot: '/workspace/lab',
                  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                },
                view: {
                  pluginId: 'deck',
                  modality: 'deck' as const,
                  mode: 'preview' as const,
                  title: 'slides.pptx'
                },
                slides: [{ id: 'slide1', index: 0, title: 'Results' }],
                deck: {
                  textElements: [{
                    slideId: 'slide1',
                    elementId: 'slide1:slide-2',
                    kind: 'body' as const,
                    text: 'Assay response increased after treatment.'
                  }]
                },
              actions: ['deck.updateTextElement']
            }
          : isText
            ? {
                schemaVersion: 1 as const,
                file: {
                  path: '/workspace/lab/notes.txt',
                  workspaceRoot: '/workspace/lab',
                  mimeType: 'text/plain'
                },
                view: {
                  pluginId: 'text',
                  modality: 'text' as const,
                  mode: 'preview' as const,
                  title: 'notes.txt'
                },
                visibleText: 'alpha\nbeta\n',
                text: {
                  lineCount: 3,
                  characterCount: 11,
                  truncated: false
                },
                actions: ['text.replaceRange', 'applyEdit']
              }
          : isMolecular
            ? {
                schemaVersion: 1 as const,
                file: {
                  path: '/workspace/lab/protein.pdb',
                  workspaceRoot: '/workspace/lab',
                  mimeType: 'chemical/x-pdb',
                  size: 4
                },
                view: {
                  pluginId: 'molecular',
                  modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
                  mode: 'preview' as const,
                  title: 'protein.pdb'
                },
                pluginMetadata: [{
                  source: 'plugin-metadata' as const,
                  metadataKind: 'sciforge.life-science-preview.molecular.observation',
                  metadataOnly: true as const,
                  containsPixels: false as const,
                  data: { wireVersion: 2, kind: 'molecular', observation: { modelCount: 1, chains: ['A'] } }
                }],
                actions: ['molecular.workbench']
              }
          : isSequence
            ? {
                schemaVersion: 1 as const,
                file: {
                  path: '/workspace/lab/reads.fasta',
                  workspaceRoot: '/workspace/lab',
                  mimeType: 'text/x-fasta',
                  size: 16
                },
                view: {
                  pluginId: 'sequence-genomics',
                  modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.sequence'),
                  mode: 'preview' as const,
                  title: 'reads.fasta'
                },
                selection: workspaceStructuredSelectionSchema.parse({
                  kind: 'domain',
                  selectionType: 'sciforge.life-science-preview.sequence.selection',
                  data: { wireVersion: 2, selection: { kind: 'sequence', sequenceId: 'read1', ranges: [{ start: 0, end: 8 }] } }
                }),
                pluginMetadata: [{
                  source: 'plugin-metadata' as const,
                  metadataKind: 'sciforge.life-science-preview.sequence.observation',
                  metadataOnly: true as const,
                  containsPixels: false as const,
                  data: {
                    wireVersion: 2,
                    kind: 'sequence',
                    observation: { sequenceCount: 1, totalLength: 8, alphabet: 'dna' }
                  }
                }],
                actions: ['sequence.selectRegion', 'workspace.setSelection']
              }
          : null,
        file: target?.integrity && !integrityMismatch
          ? {
              workspaceRoot: target.workspaceRoot ?? '/workspace/lab',
              path: target.path,
              sha256: verifiedSha256
            }
          : null,
        lastEditSummary: workspacePreviewMock.lastEditSummary,
        error: integrityMismatch
          ? `Workspace preview integrity mismatch: expected ${target?.integrity?.expectedDigest}, got sha256:${'b'.repeat(64)}.`
          : null
      },
      asset: isMolecular
        ? {
            schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
            sessionId: 'session-molecular',
            pluginId: 'molecular',
            modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
            file: {
              name: 'protein.pdb',
              relativePath: 'protein.pdb',
              size: 4
            },
            primary: 'byte-range' as const,
            eagerRead: {
              allowed: false,
              reason: 'Use bounded byte ranges.'
            },
            range: {
              available: true,
              maxChunkBytes: 4096,
              recommendedChunkBytes: 1024,
              size: 4
            },
            strategies: [{
              kind: 'byte-range' as const,
              status: 'available' as const,
              reason: 'Byte-range transport is available.',
              maxChunkBytes: 4096
            }]
          }
        : null,
      assetStatus: isMolecular ? 'ready' as const : 'idle' as const,
      assetError: integrityMismatch
        ? `Workspace preview integrity mismatch: expected ${target?.integrity?.expectedDigest}, got sha256:${'b'.repeat(64)}.`
        : null,
      host: workspacePreviewMock.host,
      refresh: vi.fn(),
      refreshing: false
    }
  }

  return {
    rendererWorkspacePreviewRegistry,
    WorkspacePreviewPanelShell: (props: {
      target: WorkspaceFileTarget | null
      className?: string
      children?: ReactNode | ((nextContext: ReturnType<typeof contextForTarget>) => ReactNode)
    }) => h(
      'section',
      {
        'data-mock-workspace-preview-shell': 'true',
        'data-target-path': props.target?.path ?? '',
        'data-shell-class-name': props.className ?? ''
      },
      typeof props.children === 'function'
        ? props.children(contextForTarget(props.target))
        : props.children
    ),
    WorkspacePreviewPluginOutlet: (props: {
      context: ReturnType<typeof contextForTarget>
      routeReason: string
    }) => {
      const observation = props.context.state.observation as WorkspaceObservation | null
      const modality = observation?.view.modality ?? props.context.state.session?.modality
      const host = props.context.host as {
        applyEdit: (operation: unknown) => Promise<{ ok: boolean; session?: { id: string } }>
        observe: (sessionId: string) => Promise<unknown>
        readRange: (range: unknown) => Promise<unknown>
      }
      const onApplyEdit = async (operation: unknown) => {
        const result = await host.applyEdit(operation)
        if (result.ok && result.session) {
          await host.observe(result.session.id)
        }
      }

      if (modality === 'tabular' || observation?.tables?.length) {
        workspacePreviewMock.latestTabularProps = { onApplyEdit }
        return h('div', {
          'data-mock-tabular-viewer': 'true',
          'data-has-apply-edit': 'true'
        })
      }
      if (modality === 'text') {
        workspacePreviewMock.latestTextProps = { onApplyEdit }
        return h('div', {
          'data-mock-text-viewer': 'true',
          'data-has-apply-edit': 'true'
        })
      }
      if (modality === 'deck' || observation?.slides?.length) {
        workspacePreviewMock.latestDeckProps = { onApplyEdit }
        return h('div', {
          'data-mock-deck-viewer': 'true',
          'data-has-apply-edit': 'true'
        })
      }
      if (observation?.view.pluginId === 'molecular') {
        workspacePreviewMock.latestMolecularProps = {
          asset: props.context.asset,
          assetStatus: props.context.assetStatus,
          assetError: props.context.assetError,
          readRange: (range: unknown) => host.readRange(range),
          onApplyEdit
        }
        return h('div', {
          'data-mock-molecular-viewer': 'true',
          'data-asset-status': props.context.assetStatus,
          'data-has-apply-edit': 'true'
        })
      }
      if (observation?.view.pluginId === 'sequence-genomics') {
        workspacePreviewMock.latestSequenceProps = { onSetSelection: onApplyEdit }
        return h('div', {
          'data-mock-sequence-viewer': 'true',
          'data-has-set-selection': 'true'
        })
      }
      if (observation?.view.pluginId === 'omics-matrix') return h('div', { 'data-mock-omics-viewer': 'true' })
      if (observation?.view.pluginId === 'bioimaging') return h('div', { 'data-mock-bioimaging-viewer': 'true' })
      if (observation?.view.pluginId === 'proteomics-spectra') return h('div', { 'data-mock-spectra-viewer': 'true' })

      return h('div', {
        'data-mock-plugin-summary': 'true',
        'data-route-reason': props.routeReason
      })
    }
  }
})

describe('WorkspaceFilePreviewPanelBridge', () => {
  it('prefers the preview owner thread locator and only falls back to the active locator', () => {
    const activeLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'active-host',
      path: '/cluster/active'
    }
    const ownerLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'owner-host',
      path: '/cluster/owner'
    }
    const input = {
      activeThreadId: 'active-thread',
      threads: [
        { id: 'active-thread' },
        { id: 'owner-thread', workspaceLocator: ownerLocator }
      ],
      workspaceLocator: activeLocator
    }

    expect(resolveWorkspacePreviewWorkspaceLocator({
      ...input,
      sessionId: 'owner-thread'
    })).toEqual(ownerLocator)
    expect(resolveWorkspacePreviewWorkspaceLocator(input)).toEqual(activeLocator)
    expect(resolveWorkspacePreviewWorkspaceLocator({
      ...input,
      sessionId: 'unrelated-thread'
    })).toBeUndefined()
  })

  it('maps generic preview modalities onto visual content types', () => {
    expect(workspacePreviewVisualContentType({ modality: 'deck' })).toBe('slide')
    expect(workspacePreviewVisualContentType({ modality: 'image', mimeType: 'image/png' })).toBe('image')
    expect(workspacePreviewVisualContentType({ modality: 'fixture.microscopy', mimeType: 'image/tiff' })).toBe('image')
    expect(workspacePreviewVisualContentType({ modality: 'fixture.volume', assetPrimary: 'tile' })).toBe('image')
    expect(workspacePreviewVisualContentType({ modality: 'pdf' })).toBe('pdf')
    expect(workspacePreviewVisualContentType({ modality: 'canvas' })).toBe('canvas')
  })

  it('qualifies preview component identities by Session and surface', () => {
    const first = workspacePreviewVisibleContextComponentId({
      sessionId: 'session/1',
      surfaceId: 'pane:a'
    })
    const second = workspacePreviewVisibleContextComponentId({
      sessionId: 'session/1',
      surfaceId: 'pane:b'
    })

    expect(first).toBe('right-sidebar.file-preview:session:session%2F1:surface:pane%3Aa')
    expect(second).toBe('right-sidebar.file-preview:session:session%2F1:surface:pane%3Ab')
    expect(first).not.toBe(second)
  })

  afterEach(() => {
    workspacePreviewMock.latestTabularProps = null
    workspacePreviewMock.latestTextProps = null
    workspacePreviewMock.latestDeckProps = null
    workspacePreviewMock.latestMolecularProps = null
    workspacePreviewMock.latestSequenceProps = null
    workspacePreviewMock.lastEditSummary = null
    vi.clearAllMocks()
  })

  it('routes registered preview plugins through the workspace preview shell', () => {
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute(null)).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'empty'
    })

    const cases = [
      ['notes.md', 'markdown', 'document'],
      ['paper.pdf', 'pdf', 'document'],
      ['report.docx', 'docx', 'document'],
      ['figure.png', 'image', 'image']
    ] as const

    for (const [path, pluginId, modality] of cases) {
      expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path })).toEqual({
        kind: 'workspace-preview-shell',
        reason: 'registered-plugin',
        pluginId,
        modality
      })
    }
  })

  it('routes first-party TXT previews through the workspace preview shell', () => {
    for (const path of ['notes.txt', 'debug.LOG', 'script.py', '.env', '.env.local']) {
      expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path })).toEqual({
        kind: 'workspace-preview-shell',
        reason: 'registered-plugin',
        pluginId: 'text',
        modality: 'text'
      })
    }
  })

  it('routes first-party tabular previews through the workspace preview shell', () => {
    for (const path of ['table.csv', 'samples.tsv', 'records.jsonl', 'records.ndjson', 'workbook.xlsx']) {
      expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path })).toEqual({
        kind: 'workspace-preview-shell',
        reason: 'registered-plugin',
        pluginId: 'tabular',
        modality: 'tabular'
      })
    }
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'legacy.xls' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'unregistered-format'
    })
  })

  it('routes first-party PPTX previews through the workspace preview shell', () => {
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'slides.pptx' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'registered-plugin',
      pluginId: 'deck',
      modality: 'deck'
    })
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'legacy.ppt' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'unregistered-format'
    })
  })

  it('routes supported life-science formats through canonical workspace preview plugins', () => {
    for (const [path, pluginId, modality] of [
      ['protein.pdb', 'molecular', 'sciforge.life-science-preview.molecular'],
      ['structure.mmcif', 'molecular', 'sciforge.life-science-preview.molecular'],
      ['reads.fasta', 'sequence-genomics', 'sciforge.life-science-preview.sequence'],
      ['record.gbk', 'sequence-genomics', 'sciforge.life-science-preview.sequence'],
      ['features.gff', 'sequence-genomics', 'sciforge.life-science-preview.sequence'],
      ['regions.bed', 'sequence-genomics', 'sciforge.life-science-preview.sequence'],
      ['variants.vcf', 'sequence-genomics', 'sciforge.life-science-preview.sequence'],
      ['ligand.sdf', 'molecular', 'sciforge.life-science-preview.molecular'],
      ['reads.fastq', 'sequence-genomics', 'sciforge.life-science-preview.sequence']
    ] as const) {
      expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path })).toEqual({
        kind: 'workspace-preview-shell',
        reason: 'registered-plugin',
        pluginId,
        modality
      })
    }
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'structure.pdb.gz' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'unregistered-format'
    })
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'record.gbk.gz' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'unregistered-format'
    })
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'cells.ome.tiff' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'registered-plugin',
      pluginId: 'bioimaging',
      modality: 'sciforge.life-science-preview.bioimaging'
    })
    expect(resolveWorkspaceFilePreviewPanelBridgeRoute({ path: 'mesh.vtk' })).toEqual({
      kind: 'workspace-preview-shell',
      reason: 'unregistered-format'
    })
  })

  it('renders supported formats through the workspace preview shell', () => {
    const unregisteredHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'legacy.xls', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const markdownHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'notes.md', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const molecularHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'protein.pdb', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const tabularHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'table.csv', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const workbookHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'workbook.xlsx', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const textHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'notes.txt', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const deckHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'slides.pptx', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const deferredHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'mesh.vtk', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const sequenceHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'reads.fasta', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    expect(unregisteredHtml).toContain('data-mock-workspace-preview-shell="true"')
    expect(unregisteredHtml).toContain('data-route-reason="unregistered-format"')
    expect(unregisteredHtml).not.toContain('data-mock-legacy-preview-panel="true"')
    expect(markdownHtml).toContain('data-mock-workspace-preview-shell="true"')
    expect(markdownHtml).toContain('data-shell-class-name="ds-no-drag"')
    expect(markdownHtml).toContain('data-surface-id="right-panel-pane-test"')
    expect(markdownHtml).toContain('data-route-reason="registered-plugin"')
    expect(molecularHtml).toContain('data-mock-workspace-preview-shell="true"')
    expect(molecularHtml).toContain('data-route-reason="registered-plugin"')
    expect(molecularHtml).toContain('data-mock-molecular-viewer="true"')
    expect(tabularHtml).toContain('data-route-reason="registered-plugin"')
    expect(tabularHtml).toContain('data-mock-tabular-viewer="true"')
    expect(tabularHtml).toContain('data-has-apply-edit="true"')
    expect(workbookHtml).toContain('data-route-reason="registered-plugin"')
    expect(workbookHtml).toContain('data-mock-tabular-viewer="true"')
    expect(textHtml).toContain('data-route-reason="registered-plugin"')
    expect(textHtml).toContain('data-mock-text-viewer="true"')
    expect(textHtml).toContain('data-has-apply-edit="true"')
    expect(textHtml).toContain('aria-label="刷新文件预览"')
    expect(deckHtml).toContain('data-route-reason="registered-plugin"')
    expect(deckHtml).toContain('data-mock-deck-viewer="true"')
    expect(deckHtml).toContain('data-has-apply-edit="true"')
    expect(sequenceHtml).toContain('data-mock-workspace-preview-shell="true"')
    expect(sequenceHtml).toContain('data-route-reason="registered-plugin"')
    expect(sequenceHtml).toContain('data-mock-sequence-viewer="true"')
    expect(deferredHtml).toContain('data-route-reason="unregistered-format"')
  })

  it('shows evidence integrity success only when an expected digest is verified', () => {
    const expectedDigest = `sha256:${'a'.repeat(64)}`
    const verifiedHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: {
        path: 'notes.txt',
        workspaceRoot: '/workspace/lab',
        integrity: { algorithm: 'sha256', expectedDigest }
      },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    const ordinaryHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'notes.txt', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    expect(verifiedHtml).toContain('data-workspace-preview-integrity-status="verified"')
    expect(verifiedHtml).toContain('证据版本已验证')
    expect(verifiedHtml).toContain('border-emerald-300')
    expect(ordinaryHtml).not.toContain('data-workspace-preview-integrity-status')
    expect(ordinaryHtml).not.toContain('证据版本已验证')
  })

  it('translates an integrity mismatch into a clear blocking error', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: {
        path: 'integrity-mismatch.txt',
        workspaceRoot: '/workspace/lab',
        integrity: { algorithm: 'sha256', expectedDigest: `sha256:${'a'.repeat(64)}` }
      },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    expect(html).toContain('data-workspace-preview-integrity-status="mismatch"')
    expect(html).toContain('当前文件与 Snapshot 证据版本不一致，未打开')
    expect(html).toContain('border-red-300')
    expect(html).toContain('role="alert"')
  })

  it('connects tabular viewer edit operations to the workspace preview host, refreshes observation, and renders the edit summary', async () => {
    const initialHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'table.csv', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    expect(initialHtml).not.toContain('data-workspace-preview-edit-summary')

    const operation = {
      kind: 'tabular.updateCell' as const,
      path: '/workspace/lab/table.csv',
      row: 0,
      column: 0,
      value: 's2'
    }
    await workspacePreviewMock.latestTabularProps?.onApplyEdit?.(operation)

    expect(workspacePreviewMock.host.applyEdit).toHaveBeenCalledWith(operation)
    expect(workspacePreviewMock.host.observe).toHaveBeenCalledWith('session-tabular')

    const summaryHtml = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'table.csv', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))
    expect(summaryHtml).toContain('data-workspace-preview-edit-summary')
    expect(summaryHtml).toContain(workspacePreviewMock.editSummary.summary)
    expect(summaryHtml).toContain(workspacePreviewMock.editSummary.undo.hint)
    expect(summaryHtml).toContain('bottom-3 left-3')
    expect(summaryHtml).not.toContain('right-3 top-12')
  })

  it('connects deck viewer text edits to the workspace preview host and refreshes observation', async () => {
    renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'slides.pptx', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    const operation = {
      kind: 'deck.updateTextElement' as const,
      path: '/workspace/lab/slides.pptx',
      slideId: 'slide1',
      elementId: 'slide1:slide-2',
      text: 'Updated assay response summary.'
    }
    await workspacePreviewMock.latestDeckProps?.onApplyEdit?.(operation)

    expect(workspacePreviewMock.host.applyEdit).toHaveBeenCalledWith(operation)
    expect(workspacePreviewMock.host.observe).toHaveBeenCalledWith('session-deck')
  })

  it('connects molecular selection edits to the workspace preview host and refreshes observation', async () => {
    renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'ligand.sdf', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    const operation = {
      kind: 'domain.applyEdit' as const,
      path: '/workspace/lab/ligand.sdf',
      operationType: 'sciforge.life-science-preview.molecular.set-selection',
      data: {
        selection: workspaceStructuredSelectionSchema.parse({
          kind: 'domain',
          selectionType: 'sciforge.life-science-preview.molecular.selection',
          data: { wireVersion: 2, selection: { kind: 'molecular', chains: ['A'] } }
        })
      }
    }
    await workspacePreviewMock.latestMolecularProps?.onApplyEdit?.(operation)

    expect(workspacePreviewMock.host.applyEdit).toHaveBeenCalledWith(operation)
    expect(workspacePreviewMock.host.observe).toHaveBeenCalledWith('session-molecular')
  })

  it('connects sequence marker selections to the workspace preview host and refreshes observation', async () => {
    renderToStaticMarkup(createElement(WorkspaceFilePreviewPanelBridge, {
      target: { path: 'reads.fastq', workspaceRoot: '/workspace/lab' },
      workspaceRoot: '/workspace/lab',
      surfaceId: TEST_SURFACE_ID,
      onClose: vi.fn()
    }))

    const operation = {
      kind: 'workspace.setSelection' as const,
      path: '/workspace/lab/reads.fastq',
      selection: workspaceStructuredSelectionSchema.parse({
        kind: 'domain',
        selectionType: 'sciforge.life-science-preview.sequence.selection',
        data: {
          wireVersion: 2,
          selection: { kind: 'sequence', sequenceId: 'read1', ranges: [{ start: 0, end: 8 }] }
        }
      })
    }
    await workspacePreviewMock.latestSequenceProps?.onSetSelection?.(operation)

    expect(workspacePreviewMock.host.applyEdit).toHaveBeenCalledWith(operation)
    expect(workspacePreviewMock.host.observe).toHaveBeenCalledWith('session-sequence')
  })

  it('builds visible context for agent-readable workspace preview state', () => {
    const component = buildWorkspacePreviewVisibleContextComponent({
      context: {
        state: {
          capability: {
            resource: {
              token: 'cap_abcdefghijklmnopqrstuvwxyz',
              semanticRevision: 'revision-2',
              expiresAt: '2026-07-16T14:00:00.000Z'
            },
            resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
            operations: [{
              contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
              id: 'workspace-preview.apply-edit',
              version: '1.0.0',
              title: 'Apply edit',
              description: 'Apply a registered preview edit.',
              audiences: ['ui', 'agent', 'system'],
              scope: 'resource',
              resourceKinds: ['workspace-preview'],
              effect: 'workspace-write',
              approval: 'none',
              concurrency: { revision: 'optimistic', idempotency: 'required' },
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object' },
              tags: ['preview']
            }]
          },
          session: {
            id: 'session-1',
            pluginId: 'molecular',
            workspaceRoot: '/workspace/lab',
            path: '/workspace/lab/protein.pdb',
            modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
            mode: 'preview',
            openedAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:00:00.000Z'
          },
          descriptor: null,
          asset: null,
          file: {
            workspaceRoot: '/workspace/lab',
            path: '/workspace/lab/protein.pdb',
            relativePath: 'protein.pdb',
            mimeType: 'chemical/x-pdb',
            size: 42,
            mtimeMs: 1
          },
          observation: {
            schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
            file: {
              workspaceRoot: '/workspace/lab',
              path: '/workspace/lab/protein.pdb',
              mimeType: 'chemical/x-pdb',
              size: 42
            },
            view: {
              pluginId: 'molecular',
              modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
              mode: 'preview',
              title: 'protein.pdb'
            },
            selection: workspaceStructuredSelectionSchema.parse({
              kind: 'domain',
              selectionType: 'sciforge.life-science-preview.molecular.selection',
              data: { wireVersion: 2, selection: { kind: 'molecular', chains: ['A'] } }
            }),
            documentAnnotations: {
              threadCount: 2,
              annotationCount: 5,
              openThreadCount: 1,
              truncated: false,
              threads: [{
                id: 'thread-1',
                kind: 'comment',
                status: 'open',
                annotationCount: 3,
                summary: 'open | page 2 | Current comment'
              }]
            },
            actions: ['molecular.workbench']
          },
          error: null,
          lastEditSummary: null
        },
        asset: {
          schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
          sessionId: 'session-1',
          assetId: 'asset:session-1',
          pluginId: 'molecular',
          modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
          file: {
            name: 'protein.pdb',
            relativePath: 'protein.pdb'
          },
          primary: 'byte-range',
          eagerRead: {
            allowed: false,
            reason: 'lazy scientific asset transport'
          },
          range: {
            available: true,
            maxChunkBytes: 4096,
            recommendedChunkBytes: 1024,
            size: 42
          },
          strategies: [
            {
              kind: 'byte-range',
              status: 'available',
              reason: 'bounded reads',
              maxChunkBytes: 4096
            },
            {
              kind: 'tile',
              status: 'requires-plugin',
              reason: 'format-specific decoder'
            }
          ]
        },
        assetStatus: 'ready',
        assetError: null
      },
      target: { path: 'protein.pdb', workspaceRoot: '/workspace/lab' },
      route: {
        kind: 'workspace-preview-shell',
        reason: 'registered-plugin',
        pluginId: 'molecular',
        modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular')
      },
      workspaceRoot: '/workspace/lab',
      sessionId: 'chat-session-1',
      surfaceId: 'pane:preview-1',
      updatedAt: '2026-07-08T00:00:01.000Z',
      presentationState: {
        schemaVersion: 1,
        kind: 'document',
        position: { index: 2, count: 12, label: 'Page 2 of 12' },
        visibleContent: {
          kind: 'text',
          label: 'Page 2',
          text: 'Bounded visible page text.',
          truncated: false
        },
        selection: {
          kind: 'text',
          text: 'visible selection',
          summary: 'Page 2; 17 selected characters'
        }
      }
    })

    expect(component).toMatchObject({
      id: 'right-sidebar.file-preview:session:chat-session-1:surface:pane%3Apreview-1',
      component: 'workspace-preview',
      title: 'protein.pdb',
      summary: 'Workspace preview observation for Molecular file protein.pdb. Current position: Page 2 of 12. Selection: Page 2; 17 selected characters.',
      state: {
        sessionId: 'chat-session-1',
        surfaceId: 'pane:preview-1',
        currentPreview: {
          resourceRef: 'res_abcdefghijklmnopqrstuvwxyz'
        },
        documentAnnotations: {
          threadCount: 2,
          annotationCount: 5,
          openThreadCount: 1
        },
        pluginId: 'molecular',
        modality: 'sciforge.life-science-preview.molecular',
        selectionKind: 'domain',
        presentation: {
          kind: 'document',
          position: { index: 2, count: 12, label: 'Page 2 of 12' },
          visibleContent: {
            text: 'Bounded visible page text.',
            truncated: false
          },
          selection: {
            kind: 'text',
            text: 'visible selection'
          }
        },
        assetPrimary: 'byte-range',
        assetStrategies: [
          {
            kind: 'byte-range',
            status: 'available'
          },
          {
            kind: 'tile',
            status: 'requires-plugin'
          }
        ],
        workspaceObservation: {
          view: {
            pluginId: 'molecular',
            modality: 'sciforge.life-science-preview.molecular'
          },
          selection: {
            kind: 'domain',
            selectionType: 'sciforge.life-science-preview.molecular.selection',
            data: { wireVersion: 2, selection: { kind: 'molecular', chains: ['A'] } }
          },
          actions: ['molecular.workbench']
        }
      },
      resources: [
        {
          role: 'preview-target',
          relativePath: 'protein.pdb',
          resourceUri: 'workspace://file/protein.pdb',
          annotationCount: 5,
          threadCount: 2,
          openThreadCount: 1,
          capability: {
            resourceRef: 'res_abcdefghijklmnopqrstuvwxyz'
          },
          metadata: {
            routeReason: 'registered-plugin',
            presentationKind: 'document',
            presentationPosition: { index: 2, count: 12, label: 'Page 2 of 12' },
            assetStrategies: [
              {
                kind: 'byte-range',
                status: 'available'
              },
              {
                kind: 'tile',
                status: 'requires-plugin'
              }
            ]
          }
        }
      ]
    })
    expect(JSON.stringify(component)).not.toContain('cap_abcdefghijklmnopqrstuvwxyz')
    expect(JSON.stringify(component)).not.toContain('semanticRevision')
    expect(JSON.stringify(component)).not.toContain('inputSchema')
    expect(JSON.stringify(component)).not.toContain('workspace-preview.apply-edit')
    expect(JSON.stringify(component)).not.toContain('operationRefs')
  })
})
