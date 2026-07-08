import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
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
  buildWorkspacePreviewPluginActionInput,
  runWorkspacePreviewToolbarAction
} from './action-runner'
import type { WorkspacePreviewToolbarAction } from './chrome-model'
import { createWorkspacePreviewHostState, type WorkspacePreviewHost } from './host'

const NOW = '2026-07-08T00:00:00.000Z'

function action(id: string, format?: string): WorkspacePreviewToolbarAction {
  return {
    id,
    label: id,
    source: 'observation',
    enabled: true,
    format
  }
}

function session(overrides: Partial<WorkspacePreviewSession> = {}): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: 'molecular',
    workspaceRoot: '/workspace/lab',
    path: 'protein.pdb',
    modality: 'molecular',
    mode: 'preview',
    openedAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function observation(overrides: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/protein.pdb',
      workspaceRoot: '/workspace/lab',
      mimeType: 'chemical/x-pdb',
      size: 128
    },
    view: {
      pluginId: 'molecular',
      modality: 'molecular',
      mode: 'preview',
      title: 'protein.pdb'
    },
    actions: [],
    ...overrides
  }
}

describe('workspace preview action runner', () => {
  it('derives safe default plugin inputs from life-science observations', () => {
    const molecularSelect = buildWorkspacePreviewPluginActionInput(
      'molecular.select',
      observation({
        molecular: {
          chains: ['A', 'B'],
          ligands: ['ATP']
        }
      })
    )
    const sequenceRegion = buildWorkspacePreviewPluginActionInput(
      'sequence.selectRegion',
      observation({
        selection: {
          kind: 'sequence',
          sequenceId: 'chr1',
          ranges: [{ start: 10, end: 25, strand: '+' }]
        }
      })
    )
    const omicsDataset = buildWorkspacePreviewPluginActionInput(
      'omics.selectDataset',
      observation({
        omics: {
          embeddings: ['X_umap']
        }
      })
    )
    const search = buildWorkspacePreviewPluginActionInput('sequence.search', observation())

    expect(molecularSelect).toMatchObject({
      ok: true,
      action: {
        actionId: 'molecular.select',
        input: { chains: ['A'] }
      }
    })
    expect(sequenceRegion).toMatchObject({
      ok: true,
      action: {
        actionId: 'sequence.selectRegion',
        input: {
          reference: 'chr1',
          start: 10,
          end: 25,
          strand: '+'
        }
      }
    })
    expect(omicsDataset).toMatchObject({
      ok: true,
      action: {
        actionId: 'omics.selectDataset',
        input: {
          embeddingNames: ['X_umap']
        }
      }
    })
    expect(search).toMatchObject({
      ok: false,
      reason: 'unsupported'
    })
  })

  it('maps molecular selections into select and distance worker inputs', () => {
    const molecularSelection: WorkspaceStructuredSelection = {
      kind: 'molecular',
      chains: ['A'],
      residues: [{ chain: 'A', index: 42, name: 'GLY' }],
      ligands: ['ATP'],
      atoms: [{ id: 'atom-1' }, { index: 2 }, { element: 'N' }]
    }
    const molecularSelect = buildWorkspacePreviewPluginActionInput(
      'molecular.select',
      observation({ selection: molecularSelection })
    )
    const molecularDistance = buildWorkspacePreviewPluginActionInput(
      'molecular.measureDistance',
      observation({ selection: molecularSelection })
    )
    const missingDistance = buildWorkspacePreviewPluginActionInput(
      'molecular.measureDistance',
      observation({
        selection: {
          kind: 'molecular',
          atoms: [{ element: 'N' }]
        }
      })
    )

    expect(molecularSelect).toMatchObject({
      ok: true,
      action: {
        actionId: 'molecular.select',
        input: {
          chains: ['A'],
          residues: [{ chain: 'A', index: 42, name: 'GLY' }],
          ligands: ['ATP'],
          atoms: [{ id: 'atom-1' }, { index: 2 }, { element: 'N' }]
        }
      }
    })
    expect(molecularDistance).toMatchObject({
      ok: true,
      action: {
        actionId: 'molecular.measureDistance',
        input: {
          atoms: [{ id: 'atom-1' }, { index: 2 }]
        }
      }
    })
    expect(missingDistance).toMatchObject({
      ok: false,
      reason: 'missing-selection'
    })
  })

  it('maps bioimaging and spectra selections into worker action inputs', () => {
    const bioimagingAnnotation = buildWorkspacePreviewPluginActionInput(
      'bioimaging.annotateRegion',
      observation({
        selection: {
          kind: 'bioimaging',
          roiIds: ['roi-1'],
          channels: ['DAPI'],
          regions: [{ x: 1, y: 2, width: 30, height: 40 }]
        }
      })
    )
    const spectraExport = buildWorkspacePreviewPluginActionInput(
      'spectra.exportPeakList',
      observation({
        selection: {
          kind: 'spectra',
          ranges: [{ xStart: 100, xEnd: 400, yStart: 50 }]
        }
      })
    )

    expect(bioimagingAnnotation).toMatchObject({
      ok: true,
      action: {
        actionId: 'bioimaging.annotateRegion',
        input: {
          roiId: 'roi-1',
          label: 'ROI annotation',
          channels: ['DAPI'],
          region: { x: 1, y: 2, width: 30, height: 40 }
        }
      }
    })
    expect(spectraExport).toMatchObject({
      ok: true,
      action: {
        actionId: 'spectra.exportPeakList',
        input: {
          format: 'csv',
          range: {
            mzMin: 100,
            mzMax: 400,
            intensityMin: 50
          }
        }
      }
    })
  })

  it('derives safe default plugin inputs from tabular and deck observations', () => {
    const tabularSelection = buildWorkspacePreviewPluginActionInput(
      'tabular.selectCells',
      observation({
        view: {
          pluginId: 'tabular',
          modality: 'tabular',
          mode: 'preview',
          title: 'samples.csv'
        },
        tables: [{ id: 'table-1', name: 'samples', rowCount: 20, columnCount: 8 }]
      })
    )
    const tabularQuery = buildWorkspacePreviewPluginActionInput(
      'tabular.filterRows',
      observation({
        view: {
          pluginId: 'tabular',
          modality: 'tabular',
          mode: 'preview',
          title: 'samples.csv'
        }
      })
    )
    const deckSlide = buildWorkspacePreviewPluginActionInput(
      'deck.selectSlide',
      observation({
        view: {
          pluginId: 'deck',
          modality: 'deck',
          mode: 'preview',
          title: 'talk.pptx'
        },
        slides: [{ id: 'slide-2', index: 1, title: 'Results' }]
      })
    )
    const deckText = buildWorkspacePreviewPluginActionInput(
      'deck.selectText',
      observation({
        view: {
          pluginId: 'deck',
          modality: 'deck',
          mode: 'preview',
          title: 'talk.pptx'
        },
        selection: {
          kind: 'deck',
          slideIds: ['slide-3'],
          elementIds: ['slide-3-notes-1']
        },
        deck: {
          textElements: [
            {
              slideId: 'slide-3',
              elementId: 'slide-3-title-1',
              kind: 'title',
              text: 'Results'
            },
            {
              slideId: 'slide-3',
              elementId: 'slide-3-notes-1',
              kind: 'notes',
              text: 'Discuss the confirmatory assay results.'
            }
          ]
        }
      })
    )

    expect(tabularSelection).toMatchObject({
      ok: true,
      action: {
        actionId: 'tabular.selectCells',
        input: {
          selection: {
            ranges: [{ rowStart: 0, rowEnd: 4, columnStart: 0, columnEnd: 4 }],
            includeCellValues: true
          }
        }
      }
    })
    expect(tabularQuery).toMatchObject({
      ok: true,
      action: {
        actionId: 'tabular.filterRows',
        input: { maxRows: 50 }
      }
    })
    expect(deckSlide).toMatchObject({
      ok: true,
      action: {
        actionId: 'deck.selectSlide',
        input: {
          slideId: 'slide-2',
          maxElements: 20
        }
      }
    })
    expect(deckText).toMatchObject({
      ok: true,
      action: {
        actionId: 'deck.selectText',
        input: {
          slideId: 'slide-3',
          elementId: 'slide-3-notes-1',
          kind: 'notes',
          query: 'Discuss the confirmatory assay results.',
          maxElements: 20
        }
      }
    })
  })

  it('builds deck text inputs from selected and fallback bounded text elements', () => {
    const textElements = [
      {
        slideId: 'slide-1',
        elementId: 'slide-1-title-1',
        kind: 'title' as const,
        text: 'Opening question'
      },
      {
        slideId: 'slide-2',
        elementId: 'slide-2-body-1',
        kind: 'body' as const,
        text: 'Bounded assay result summary'
      }
    ]
    const selectedText = buildWorkspacePreviewPluginActionInput(
      'deck.selectText',
      observation({
        view: {
          pluginId: 'deck',
          modality: 'deck',
          mode: 'preview',
          title: 'talk.pptx'
        },
        selection: {
          kind: 'deck',
          slideIds: ['slide-2'],
          elementIds: ['missing-element', 'slide-2-body-1']
        },
        deck: { textElements }
      })
    )
    const fallbackText = buildWorkspacePreviewPluginActionInput(
      'deck.selectText',
      observation({
        view: {
          pluginId: 'deck',
          modality: 'deck',
          mode: 'preview',
          title: 'talk.pptx'
        },
        selection: {
          kind: 'deck',
          slideIds: ['slide-2']
        },
        deck: { textElements }
      })
    )
    const missingTextElements = () => buildWorkspacePreviewPluginActionInput(
      'deck.selectText',
      observation({
        view: {
          pluginId: 'deck',
          modality: 'deck',
          mode: 'preview',
          title: 'talk.pptx'
        },
        slides: [{ id: 'slide-1', index: 0, title: 'Opening question' }],
        selection: {
          kind: 'deck',
          slideIds: ['slide-1'],
          elementIds: ['slide-1-title-1']
        }
      })
    )

    expect(selectedText).toMatchObject({
      ok: true,
      action: {
        actionId: 'deck.selectText',
        input: {
          slideId: 'slide-2',
          elementId: 'slide-2-body-1',
          kind: 'body',
          query: 'Bounded assay result summary',
          maxElements: 20
        }
      }
    })
    expect(fallbackText).toMatchObject({
      ok: true,
      action: {
        actionId: 'deck.selectText',
        input: {
          slideId: 'slide-1',
          elementId: 'slide-1-title-1',
          kind: 'title',
          query: 'Opening question',
          maxElements: 20
        }
      }
    })
    expect(missingTextElements).not.toThrow()
    expect(missingTextElements()).toMatchObject({
      ok: false,
      reason: 'missing-selection'
    })
  })

  it('invokes plugin actions and applies returned structured selections to the session', async () => {
    const selected: WorkspaceStructuredSelection = {
      kind: 'molecular',
      chains: ['A']
    }
    const activeSession = session()
    const invokeResult: WorkspacePreviewInvokeActionResult = {
      ok: true,
      sessionId: activeSession.id,
      pluginId: activeSession.pluginId,
      actionId: 'molecular.select',
      invokedAt: NOW,
      result: {
        ok: true,
        selection: selected
      },
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        actionId: 'molecular.select',
        effect: 'worker-action'
      }
    }
    const applyResult: WorkspacePreviewApplyEditResult = {
      ok: true,
      session: {
        ...activeSession,
        selection: selected,
        updatedAt: NOW
      },
      operationKind: 'workspace.setSelection',
      appliedAt: NOW,
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        operationKind: 'workspace.setSelection',
        effect: 'session-update'
      }
    }
    const host = {
      invokeAction: vi.fn(async () => invokeResult),
      setSelection: vi.fn(async () => applyResult)
    } as unknown as WorkspacePreviewHost

    const result = await runWorkspacePreviewToolbarAction(action('molecular.select'), {
      host,
      state: createWorkspacePreviewHostState({
        session: activeSession,
        observation: observation({
          molecular: {
            chains: ['A']
          }
        })
      })
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'invoke-action',
      actionId: 'molecular.select'
    })
    expect(host.invokeAction).toHaveBeenCalledWith(activeSession.id, {
      actionId: 'molecular.select',
      input: { chains: ['A'] }
    })
    expect(host.setSelection).toHaveBeenCalledWith(selected, {
      sessionId: activeSession.id,
      path: activeSession.path
    })
  })

  it('invokes molecular distance actions and applies the returned measured selection', async () => {
    const measuredSelection: WorkspaceStructuredSelection = {
      kind: 'molecular',
      atoms: [{ id: 'atom-1' }, { index: 2 }]
    }
    const activeSession = session()
    const invokeResult: WorkspacePreviewInvokeActionResult = {
      ok: true,
      sessionId: activeSession.id,
      pluginId: activeSession.pluginId,
      actionId: 'molecular.measureDistance',
      invokedAt: NOW,
      result: {
        ok: true,
        coordinateAvailable: true,
        distance: 1.46,
        unit: 'angstrom',
        selection: measuredSelection
      },
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        actionId: 'molecular.measureDistance',
        effect: 'worker-action'
      }
    }
    const applyResult: WorkspacePreviewApplyEditResult = {
      ok: true,
      session: {
        ...activeSession,
        selection: measuredSelection,
        updatedAt: NOW
      },
      operationKind: 'workspace.setSelection',
      appliedAt: NOW,
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        operationKind: 'workspace.setSelection',
        effect: 'session-update'
      }
    }
    const host = {
      invokeAction: vi.fn(async () => invokeResult),
      setSelection: vi.fn(async () => applyResult)
    } as unknown as WorkspacePreviewHost

    const result = await runWorkspacePreviewToolbarAction(action('molecular.measureDistance'), {
      host,
      state: createWorkspacePreviewHostState({
        session: activeSession,
        observation: observation({
          selection: {
            kind: 'molecular',
            atoms: [{ id: 'atom-1' }, { index: 2 }, { element: 'N' }]
          }
        })
      })
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'invoke-action',
      actionId: 'molecular.measureDistance'
    })
    expect(host.invokeAction).toHaveBeenCalledWith(activeSession.id, {
      actionId: 'molecular.measureDistance',
      input: {
        atoms: [{ id: 'atom-1' }, { index: 2 }]
      }
    })
    expect(host.setSelection).toHaveBeenCalledWith(measuredSelection, {
      sessionId: activeSession.id,
      path: activeSession.path
    })
  })

  it('runs generic selection and export actions through the host', async () => {
    const selected: WorkspaceStructuredSelection = {
      kind: 'bioimaging',
      channels: ['DAPI']
    }
    const activeSession = session({
      pluginId: 'bioimaging',
      modality: 'bioimaging',
      path: 'cells.ome.tiff'
    })
    const applyResult: WorkspacePreviewApplyEditResult = {
      ok: true,
      session: {
        ...activeSession,
        selection: selected
      },
      operationKind: 'workspace.setSelection',
      appliedAt: NOW,
      audit: {
        pluginId: activeSession.pluginId,
        path: activeSession.path,
        operationKind: 'workspace.setSelection',
        effect: 'session-update'
      }
    }
    const exportResult: WorkspacePreviewExportResult = {
      ok: true,
      sessionId: activeSession.id,
      path: 'cells.export.json',
      target: {
        kind: 'workspace-file',
        format: 'json'
      },
      exportedAt: NOW,
      audit: {
        pluginId: activeSession.pluginId,
        sourcePath: activeSession.path,
        targetKind: 'workspace-file',
        format: 'json',
        effect: 'source-copy'
      }
    }
    const host = {
      setSelection: vi.fn(async () => applyResult),
      export: vi.fn(async () => exportResult)
    } as unknown as WorkspacePreviewHost
    const state = createWorkspacePreviewHostState({
      session: activeSession,
      observation: observation({ selection: selected })
    })

    const selectionResult = await runWorkspacePreviewToolbarAction(action('workspace.setSelection'), {
      host,
      state
    })
    const downloadResult = await runWorkspacePreviewToolbarAction(action('workspace.export:json', 'json'), {
      host,
      state
    })

    expect(selectionResult).toMatchObject({ ok: true, kind: 'set-selection' })
    expect(downloadResult).toMatchObject({ ok: true, kind: 'export' })
    expect(host.setSelection).toHaveBeenCalledWith(selected, {
      sessionId: activeSession.id,
      path: activeSession.path
    })
    expect(host.export).toHaveBeenCalledWith(activeSession.id, {
      kind: 'workspace-file',
      format: 'json'
    })
  })

  it('reports a failure when an invoked action selection cannot be written back', async () => {
    const selected: WorkspaceStructuredSelection = {
      kind: 'molecular',
      chains: ['A']
    }
    const activeSession = session()
    const host = {
      invokeAction: vi.fn(async (): Promise<WorkspacePreviewInvokeActionResult> => ({
        ok: true,
        sessionId: activeSession.id,
        pluginId: activeSession.pluginId,
        actionId: 'molecular.select',
        invokedAt: NOW,
        result: {
          ok: true,
          selection: selected
        },
        audit: {
          pluginId: activeSession.pluginId,
          path: activeSession.path,
          actionId: 'molecular.select',
          effect: 'worker-action'
        }
      })),
      setSelection: vi.fn(async (): Promise<WorkspacePreviewApplyEditResult> => ({
        ok: false,
        message: 'selection writeback failed'
      }))
    } as unknown as WorkspacePreviewHost

    const result = await runWorkspacePreviewToolbarAction(action('molecular.select'), {
      host,
      state: createWorkspacePreviewHostState({
        session: activeSession,
        observation: observation({
          molecular: {
            chains: ['A']
          }
        })
      })
    })

    expect(result).toEqual({
      ok: false,
      actionId: 'molecular.select',
      reason: 'bridge',
      message: 'selection writeback failed'
    })
  })
})
