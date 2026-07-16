import { describe, expect, it } from 'vitest'
import {
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_MAX_ARTIFACT_BYTES,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
  extensionFromPreviewPath,
  isDeferredNonLifeScienceExtension,
  isDelimitedTabularEditPreviewPath,
  isFirstPartyTabularShellPreviewPath,
  isFirstPartyTextPreviewPath,
  isTextLikePreviewMimeType,
  normalizePreviewMimeType,
  isLifeSciencePreviewExtension,
  normalizePreviewExtension,
  normalizeWorkspacePreviewSha256Digest,
  resolveWorkspacePreviewInitialSelection,
  resolveLifeSciencePreviewRoute,
  resolveWorkspacePreviewPlugin,
  resolveWorkspacePreviewTransferCapabilities,
  workspacePreviewEditOperationSchema,
  workspacePreviewAnchorSchema,
  workspacePreviewIntegrityExpectationSchema,
  workspaceObservationSchema,
  workspacePreviewArtifactDescriptorSchema,
  workspacePreviewAnnotationSidecarImportActionInputSchema,
  workspacePreviewAnnotationSidecarImportActionResultSchema,
  workspacePreviewAssetTransportDescriptorSchema,
  workspacePreviewByteRangeSchema,
  workspacePreviewConflictPolicySchema,
  workspacePreviewCopyPayloadSchema,
  workspacePreviewDragInActionSchema,
  workspacePreviewDragOutActionSchema,
  workspacePreviewDragSourceSchema,
  workspacePreviewDragTargetSchema,
  workspacePreviewEditDiffSummarySchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewPastePayloadSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPluginActionResultSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  workspacePreviewSessionSchema,
  workspacePreviewPluginManifestSchema,
  type WorkspaceObservation
} from './workspace-preview'

describe('workspace preview contract', () => {
  it('normalizes extensions and preserves compound file suffixes', () => {
    expect(normalizePreviewExtension('CSV')).toBe('.csv')
    expect(extensionFromPreviewPath('/data/cell.OME.TIFF', ['.ome.tiff', '.tiff'])).toBe('.ome.tiff')
    expect(extensionFromPreviewPath('sample.fastq.gz', ['.fastq.gz', '.gz'])).toBe('.fastq.gz')
  })

  it('keeps first-party tabular shell routing on the explicit tabular allowlist', () => {
    expect(isFirstPartyTabularShellPreviewPath('table.csv')).toBe(true)
    expect(isFirstPartyTabularShellPreviewPath('records.ndjson')).toBe(true)
    expect(isFirstPartyTabularShellPreviewPath('paper.pdf')).toBe(false)
    expect(isFirstPartyTabularShellPreviewPath('notes.md')).toBe(false)
    expect(isDelimitedTabularEditPreviewPath('table.csv')).toBe(true)
    expect(isDelimitedTabularEditPreviewPath('workbook.xlsx')).toBe(false)
  })

  it('normalizes text preview paths and MIME types through shared helpers', () => {
    expect(isFirstPartyTextPreviewPath('notes.txt')).toBe(true)
    expect(isFirstPartyTextPreviewPath('script.py')).toBe(true)
    expect(isFirstPartyTextPreviewPath('.env')).toBe(true)
    expect(isFirstPartyTextPreviewPath('.env.local')).toBe(true)
    expect(isFirstPartyTextPreviewPath('Dockerfile')).toBe(true)
    expect(isFirstPartyTextPreviewPath('archive.local')).toBe(false)
    expect(normalizePreviewMimeType('Text/Plain; charset=utf-8')).toBe('text/plain')
    expect(isTextLikePreviewMimeType('text/x-python')).toBe(true)
    expect(isTextLikePreviewMimeType('application/json; charset=utf-8')).toBe(true)
    expect(isTextLikePreviewMimeType('application/octet-stream')).toBe(false)
  })

  it('normalizes initial text, document, and tabular anchors into structured selections', () => {
    expect(resolveWorkspacePreviewInitialSelection({ line: 7, column: 3 })).toEqual({
      kind: 'text',
      ranges: [{ startLine: 7, startColumn: 3, endLine: 7, endColumn: 3 }]
    })
    expect(resolveWorkspacePreviewInitialSelection({
      anchor: { kind: 'text', line: 2, endLine: 4 }
    })).toEqual({
      kind: 'text',
      ranges: [{ startLine: 2, startColumn: 1, endLine: 4, endColumn: 1_000_000 }]
    })
    expect(resolveWorkspacePreviewInitialSelection({
      anchor: {
        kind: 'document',
        page: 2,
        rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
      }
    })).toMatchObject({
      kind: 'document',
      anchors: [{ page: 2, rects: [{ page: 2, x: 0.1 }] }]
    })
    expect(resolveWorkspacePreviewInitialSelection({
      anchor: {
        kind: 'tabular',
        sheet: 'Results',
        rowStart: 4,
        rowEnd: 8,
        columnStart: 1,
        columnEnd: 3
      }
    })).toEqual({
      kind: 'tabular',
      sheet: 'Results',
      ranges: [{ rowStart: 3, rowEnd: 7, columnStart: 1, columnEnd: 3 }]
    })
  })

  it('validates anchors and canonicalizes sha256 integrity expectations', () => {
    expect(workspacePreviewAnchorSchema.parse({ kind: 'text', line: 12 })).toEqual({
      kind: 'text',
      line: 12
    })
    expect(workspacePreviewIntegrityExpectationSchema.parse({
      algorithm: 'sha256',
      expectedDigest: `SHA256:${'A'.repeat(64)}`
    })).toEqual({
      algorithm: 'sha256',
      expectedDigest: `sha256:${'a'.repeat(64)}`
    })
    expect(normalizeWorkspacePreviewSha256Digest('0'.repeat(64))).toBe(`sha256:${'0'.repeat(64)}`)
    expect(() => normalizeWorkspacePreviewSha256Digest('not-a-digest')).toThrow(/64 hexadecimal/)
  })

  it('validates plugin manifests without a parallel agent-access contract', () => {
    const manifest = workspacePreviewPluginManifestSchema.parse(LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS[0])

    expect(manifest.id).toBe('molecular')
    expect(manifest.capabilities).not.toHaveProperty('agent')
    expect(manifest.capabilities.structuredSelection).toBe(true)
  })

  it('declares first-party worker packages for every life-science plugin manifest', () => {
    expect(LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [
      manifest.id,
      manifest.workerPackage
    ])).toEqual(expect.arrayContaining([
      ['molecular', '@sciforge/workspace-molecular'],
      ['sequence-genomics', '@sciforge/workspace-sequence'],
      ['omics-matrix', '@sciforge/workspace-omics'],
      ['bioimaging', '@sciforge/workspace-bioimaging'],
      ['proteomics-spectra', '@sciforge/workspace-spectra']
    ]))
  })

  it('keeps life-science file write capabilities explicit', () => {
    for (const manifest of LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS) {
      expect(manifest.capabilities.preview).toBe(true)
      expect(manifest.capabilities.inspect).toBe(true)
      expect(manifest.capabilities.structuredSelection).toBe(true)
      expect(manifest.capabilities.edit).toBe(false)
      expect(manifest.capabilities).not.toHaveProperty('agent')
    }
  })

  it('resolves plugins by MIME type or highest-priority extension match', () => {
    const plugin = resolveWorkspacePreviewPlugin({
      path: '/workspace/protein.PDB',
      manifests: LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS
    })
    const mimePlugin = resolveWorkspacePreviewPlugin({
      path: '/workspace/unknown.bin',
      mimeType: 'chemical/x-pdb',
      manifests: LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS
    })

    expect(plugin?.id).toBe('molecular')
    expect(mimePlugin?.id).toBe('molecular')
  })

  it('routes text-like MIME parameters and text file names through the text plugin', () => {
    const textManifest = {
      contractVersion: 1 as const,
      id: 'text',
      displayName: 'Text Preview',
      version: '0.1.0',
      modality: 'text' as const,
      lifecycle: 'main' as const,
      priority: 100,
      extensions: ['.txt'],
      mimeTypes: ['text/plain'],
      capabilities: {
        preview: true,
        edit: true,
        inspect: true,
        structuredSelection: true
      }
    }

    expect(resolveWorkspacePreviewPlugin({
      path: '/workspace/unknown.bin',
      mimeType: 'text/plain; charset=utf-8',
      manifests: [textManifest]
    })?.id).toBe('text')
    expect(resolveWorkspacePreviewPlugin({
      path: '/workspace/script',
      mimeType: 'text/x-python',
      manifests: [textManifest]
    })?.id).toBe('text')
    expect(resolveWorkspacePreviewPlugin({
      path: '/workspace/.env.local',
      manifests: [textManifest]
    })?.id).toBe('text')
  })

  it('accepts representative edit operations for selections, text, tables, decks, documents, annotations, and molecular selections', () => {
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'workspace.setSelection',
      path: 'variants.vcf',
      selection: {
        kind: 'sequence',
        sequenceId: 'chr1',
        ranges: [{ start: 100, end: 120, strand: '+' }],
        features: [{ type: 'variant', start: 108, end: 109 }]
      }
    }).kind).toBe('workspace.setSelection')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'workspace.setSelection',
      path: 'atlas.h5ad',
      selection: {
        kind: 'omics',
        matrixIds: ['matrix-1'],
        obsKeys: ['cell_type'],
        varKeys: ['gene_symbol'],
        embeddings: ['X_umap'],
        ranges: [{
          matrixId: 'matrix-1',
          axis: 'obs',
          start: 0,
          end: 128,
          axisLength: 2700
        }]
      }
    }).kind).toBe('workspace.setSelection')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'text.replaceRange',
      path: 'notes.md',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 5 }
      },
      text: 'hello'
    }).kind).toBe('text.replaceRange')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'tabular.updateCell',
      path: 'samples.csv',
      row: 2,
      column: 3,
      value: 42
    }).kind).toBe('tabular.updateCell')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'tabular.insertColumns',
      path: 'samples.csv',
      afterColumn: 1,
      columns: [['batch', 'b1', 'b2']]
    }).kind).toBe('tabular.insertColumns')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'tabular.deleteRows',
      path: 'samples.csv',
      rows: [1, 3]
    }).kind).toBe('tabular.deleteRows')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'tabular.insertColumns',
      path: 'samples.csv',
      afterColumn: -1,
      columns: [['group', 'control', 'treated']]
    }).kind).toBe('tabular.insertColumns')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'tabular.deleteColumns',
      path: 'samples.csv',
      columns: [0, 2]
    }).kind).toBe('tabular.deleteColumns')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'deck.updateTextElement',
      path: 'talk.pptx',
      slideId: 'slide1',
      elementId: 'slide1:slide-2',
      text: 'Updated bounded deck text'
    }).kind).toBe('deck.updateTextElement')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'document.updateParagraph',
      path: 'report.docx',
      paragraphIndex: 4,
      text: 'Updated paragraph'
    }).kind).toBe('document.updateParagraph')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'a1',
      annotationKind: 'comment',
      body: 'Check this claim.'
    }).kind).toBe('annotation.upsert')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'a2',
      annotationKind: 'highlight',
      body: 'Verify this result.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-a',
        anchor: {
          id: 'anchor-a',
          kind: 'text',
          quote: 'result',
          rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
        },
        thread: {
          kind: 'question',
          status: 'open',
          title: 'Result check',
          sourceMessageId: 'side-thread-1'
        },
        annotation: {
          color: '#facc15',
          sourceText: 'result',
          sourceMessageId: 'side-thread-1:user-1'
        }
      }
    }).kind).toBe('annotation.upsert')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.upsert',
      path: 'report.docx',
      annotationId: 'a3',
      annotationKind: 'note',
      body: 'Clarify this paragraph.',
      target: {
        documentKind: 'docx',
        threadId: 'thread-docx',
        anchor: {
          id: 'anchor-docx',
          kind: 'text',
          quote: 'important paragraph',
          contextBefore: 'Before',
          contextAfter: 'After'
        }
      }
    })).toMatchObject({
      kind: 'annotation.upsert',
      target: {
        documentKind: 'docx'
      }
    })
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.thread.update',
      path: 'paper.pdf',
      threadId: 'thread-a',
      patch: {
        status: 'resolved',
        title: 'Resolved result check'
      }
    }).kind).toBe('annotation.thread.update')
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.thread.delete',
      path: 'paper.pdf',
      threadId: 'thread-a'
    })).toMatchObject({
      kind: 'annotation.thread.delete',
      pruneOrphanAnchors: true
    })
    expect(() => workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.thread.update',
      path: 'paper.pdf',
      threadId: 'thread-a',
      patch: {}
    })).toThrow()
    expect(() => workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'a4',
      annotationKind: 'comment',
      body: 'No arbitrary target blobs.',
      target: {
        sidecarPath: '.sciforge/pdf-annotations/manual.json'
      }
    })).toThrow()
    expect(() => workspacePreviewEditOperationSchema.parse({
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'a5',
      annotationKind: 'comment',
      body: 'Bad rect.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-b',
        anchor: {
          id: 'anchor-b',
          rects: [{ page: 1, x: 0, y: 0, width: 0, height: 0.1 }]
        }
      }
    })).toThrow()
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'molecular.setSelection',
      path: 'protein.pdb',
      selection: { kind: 'molecular', chains: ['A'], residues: [{ index: 42 }] }
    }).kind).toBe('molecular.setSelection')
  })

  it('allows workspace-file exports to omit a path for host-generated source-copy targets', () => {
    expect(workspacePreviewExportTargetSchema.parse({
      kind: 'workspace-file',
      format: 'pptx'
    })).toEqual({
      kind: 'workspace-file',
      format: 'pptx'
    })
    expect(workspacePreviewExportTargetSchema.parse({
      kind: 'workspace-file',
      format: 'pptx',
      path: 'exports/talk-copy.pptx'
    })).toMatchObject({
      path: 'exports/talk-copy.pptx'
    })
  })

  it('validates sessions and agent-visible observations across life-science modalities', () => {
    const observation: WorkspaceObservation = {
      schemaVersion: 1,
      file: { path: 'protein.pdb' },
      view: {
        pluginId: 'molecular',
        modality: 'molecular',
        mode: 'inspect',
        title: 'protein.pdb'
      },
      selection: {
        kind: 'molecular',
        chains: ['A'],
        residues: [{ chain: 'A', index: 42, name: 'TYR' }]
      },
      molecular: {
        modelCount: 1,
        chains: ['A', 'B'],
        ligands: ['ATP'],
        representations: ['cartoon', 'surface']
      },
      actions: ['molecular.workbench']
    }

    expect(workspacePreviewSessionSchema.parse({
      id: 'session-1',
      pluginId: 'molecular',
      workspaceRoot: '/workspace',
      path: '/workspace/protein.pdb',
      modality: 'molecular',
      mode: 'inspect',
      openedAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      selection: observation.selection
    }).selection?.kind).toBe('molecular')
    expect(workspaceObservationSchema.parse(observation).selection?.kind).toBe('molecular')
    expect(observation.selection?.kind).toBe('molecular')
    expect(observation.actions).toContain('molecular.workbench')
  })

  it('validates plugin metadata seeds on observations', () => {
    const observation = workspaceObservationSchema.parse({
      schemaVersion: 1,
      file: { path: 'cells.ome.tiff' },
      view: {
        pluginId: 'bioimaging',
        modality: 'bioimaging',
        mode: 'preview',
        title: 'cells.ome.tiff'
      },
      bioimaging: {
        format: 'ome-tiff',
        dimensions: { width: 1024, height: 768 },
        tilePlan: {
          status: 'metadata-only',
          pixelDecoding: false,
          tileRendererImplemented: false
        }
      },
      pluginMetadata: [{
        source: 'plugin-metadata',
        metadataKind: 'bioimaging',
        mimeType: 'application/vnd.sciforge.workspace-preview.bioimaging-metadata+json',
        metadataOnly: true,
        containsPixels: false,
        pixelDecoding: false,
        data: {
          format: 'ome-tiff',
          dimensions: { width: 1024, height: 768 },
          tilePlan: {
            status: 'metadata-only',
            pixelDecoding: false,
            tileRendererImplemented: false
          }
        },
        actions: ['bioimaging.describeTilePlan']
      }],
      actions: ['observe', 'bioimaging.describeTilePlan']
    })

    expect(observation.pluginMetadata?.[0]).toMatchObject({
      metadataKind: 'bioimaging',
      metadataOnly: true,
      containsPixels: false,
      data: {
        dimensions: { width: 1024, height: 768 }
      }
    })
    expect(() => workspaceObservationSchema.parse({
      ...observation,
      pluginMetadata: [{
        ...observation.pluginMetadata?.[0],
        data: Number.NaN
      }]
    })).toThrow()
  })

  it('validates bounded deck text elements on observations', () => {
    const observation: WorkspaceObservation = {
      schemaVersion: 1,
      file: { path: 'talk.pptx' },
      view: {
        pluginId: 'deck',
        modality: 'deck',
        mode: 'preview',
        title: 'talk.pptx'
      },
      slides: [{ id: 'slide1', index: 0, title: 'Overview' }],
      deck: {
        textElementCount: 2,
        truncatedTextElements: false,
        textElements: [
          {
            slideId: 'slide1',
            elementId: 'slide1:slide-1',
            kind: 'title',
            text: 'Overview'
          },
          {
            slideId: 'slide1',
            elementId: 'slide1:slide-2',
            kind: 'body',
            text: 'Assay response increased after treatment.'
          }
        ]
      },
      actions: ['deck.selectText']
    }

    expect(workspaceObservationSchema.parse(observation).deck?.textElements?.[0]).toMatchObject({
      slideId: 'slide1',
      elementId: 'slide1:slide-1',
      kind: 'title',
      text: 'Overview'
    })
  })

  it('validates plugin action invocation envelopes with audit metadata', () => {
    const action = workspacePreviewPluginActionInputSchema.parse({
      actionId: 'sequence.search',
      input: {
        query: 'BRCA1',
        scope: 'features'
      }
    })
    const result = workspacePreviewPluginActionResultSchema.parse({
      ok: true,
      sessionId: 'session-action',
      pluginId: 'sequence-genomics',
      actionId: action.actionId,
      invokedAt: '2026-07-08T00:00:00.000Z',
      result: {
        ok: true,
        matches: []
      },
      audit: {
        pluginId: 'sequence-genomics',
        path: '/workspace/genes.gff',
        actionId: action.actionId,
        effect: 'worker-action'
      }
    })

    expect(action.input.query).toBe('BRCA1')
    expect(result.audit.effect).toBe('worker-action')
    expect(workspacePreviewPluginActionResultSchema.parse({
      ...result,
      pluginId: 'html',
      actionId: 'html.previewUrl',
      result: {
        url: 'http://127.0.0.1:5179/token/report.html?sciforge_preview=1'
      },
      audit: {
        ...result.audit,
        pluginId: 'html',
        actionId: 'html.previewUrl',
        effect: 'host-action'
      }
    }).audit.effect).toBe('host-action')
  })

  it('validates PDF annotation sidecar import action payloads without target bypasses', () => {
    expect(workspacePreviewAnnotationSidecarImportActionInputSchema.parse({
      packagePath: ' annotations.dsgui-pdf.zip ',
      attemptRelocation: true
    })).toEqual({
      packagePath: 'annotations.dsgui-pdf.zip',
      attemptRelocation: true
    })

    expect(workspacePreviewAnnotationSidecarImportActionInputSchema.parse({
      packageBase64: ' ZmFrZS16aXA= '
    })).toEqual({
      packageBase64: 'ZmFrZS16aXA='
    })

    expect(() => workspacePreviewAnnotationSidecarImportActionInputSchema.parse({})).toThrow(/Exactly one/)
    expect(() => workspacePreviewAnnotationSidecarImportActionInputSchema.parse({
      packagePath: 'annotations.dsgui-pdf.zip',
      packageBase64: 'ZmFrZS16aXA='
    })).toThrow(/Exactly one/)
    expect(() => workspacePreviewAnnotationSidecarImportActionInputSchema.parse({
      packagePath: 'annotations.dsgui-pdf.zip',
      pdfPath: 'paper.pdf'
    })).toThrow(/Unrecognized key/)

    expect(workspacePreviewAnnotationSidecarImportActionResultSchema.parse({
      sidecar: { schemaVersion: 1 },
      importedAt: '2026-07-08T00:05:00.000Z',
      pdfFingerprint: {
        sha256: 'sha256',
        size: 1024,
        fileName: 'paper.pdf'
      },
      fingerprintMatched: true,
      warnings: [],
      counts: {
        threads: 1,
        annotations: 2,
        anchors: 1
      },
      effect: 'sidecar-write'
    }).counts.annotations).toBe(2)
  })

  it('bounds cross-boundary edit and observation payloads', () => {
    expect(() => workspacePreviewEditOperationSchema.parse({
      kind: 'text.replaceRange',
      path: 'notes.md',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 }
      },
      text: 'x'.repeat(2_000_001)
    })).toThrow()
    expect(() => workspaceObservationSchema.parse({
      schemaVersion: 1,
      file: { path: 'notes.md' },
      view: {
        pluginId: 'text',
        modality: 'text',
        mode: 'preview',
        title: 'notes.md'
      },
      visibleText: 'x'.repeat(200_001),
      actions: []
    })).toThrow()
  })

  it('bounds byte range requests for lazy large-asset transport', () => {
    expect(workspacePreviewByteRangeSchema.parse({ offset: 10, length: 1024 })).toEqual({
      offset: 10,
      length: 1024
    })
    expect(() => workspacePreviewByteRangeSchema.parse({
      offset: 0,
      length: WORKSPACE_PREVIEW_MAX_RANGE_BYTES + 1
    })).toThrow()
  })

  it('describes large preview asset transport without embedding asset bytes', () => {
    const artifact = workspacePreviewArtifactDescriptorSchema.parse({
      schemaVersion: 1,
      sessionId: 'session-asset',
      assetId: 'asset:session-asset',
      artifactId: 'artifact-1',
      kind: 'cache-artifact',
      pluginId: 'bioimaging',
      mimeType: 'application/json',
      byteLength: 256,
      range: {
        available: true,
        size: 256,
        maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
        recommendedChunkBytes: 256
      },
      source: {
        assetId: 'asset:session-asset',
        size: 8_000_000_000,
        mtimeMs: 1783468800000
      },
      cache: {
        scope: 'session',
        source: 'observation',
        createdAt: '2026-07-08T00:00:00.000Z',
        invalidation: 'source-size-mtime'
      }
    })
    const descriptor = workspacePreviewAssetTransportDescriptorSchema.parse({
      schemaVersion: 1,
      sessionId: 'session-asset',
      assetId: 'asset:session-asset',
      pluginId: 'bioimaging',
      modality: 'bioimaging',
      file: {
        name: 'cells.ome.tiff',
        relativePath: 'cells.ome.tiff',
        mimeType: 'image/tiff',
        size: 8_000_000_000,
        mtimeMs: 1783468800000
      },
      primary: 'byte-range',
      eagerRead: {
        allowed: false,
        reason: 'large scientific asset'
      },
      range: {
        available: true,
        maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
        recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
        size: 8_000_000_000
      },
      strategies: [
        {
          kind: 'byte-range',
          status: 'available',
          reason: 'bounded reads',
          maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES
        },
        {
          kind: 'tile',
          status: 'requires-plugin',
          reason: 'format-specific decoder'
        },
        {
          kind: 'cache-artifact',
          status: 'deferred',
          reason: 'worker-generated derivatives need invalidation rules'
        }
      ],
      artifacts: [artifact]
    })

    expect(descriptor.eagerRead.allowed).toBe(false)
    expect(descriptor.assetId).toBe('asset:session-asset')
    expect(descriptor.artifacts?.[0]).toEqual(artifact)
    expect(descriptor.file).not.toHaveProperty('workspaceRoot')
    expect(descriptor.file).not.toHaveProperty('path')
    expect(descriptor.artifacts?.[0]).not.toHaveProperty('path')
    expect(descriptor.artifacts?.[0]).not.toHaveProperty('workspaceRoot')
    expect(descriptor.artifacts?.[0]).not.toHaveProperty('url')
    expect(descriptor.strategies.map((strategy) => strategy.kind)).toEqual([
      'byte-range',
      'tile',
      'cache-artifact'
    ])
    expect(() => workspacePreviewAssetTransportDescriptorSchema.parse({
      ...descriptor,
      file: {
        ...descriptor.file,
        path: 'file:///workspace/cells.ome.tiff'
      }
    })).toThrow()
    expect(() => workspacePreviewArtifactDescriptorSchema.parse({
      ...artifact,
      byteLength: WORKSPACE_PREVIEW_MAX_ARTIFACT_BYTES + 1
    })).toThrow()
    expect(workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'cache-artifact',
      source: 'observation'
    })).toEqual({
      kind: 'cache-artifact',
      source: 'observation'
    })
    expect(workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'cache-artifact',
      source: 'plugin-metadata',
      metadataKind: 'bioimaging'
    })).toEqual({
      kind: 'cache-artifact',
      source: 'plugin-metadata',
      metadataKind: 'bioimaging'
    })
    expect(workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'tile',
      level: 0,
      x: 1,
      y: 2,
      width: 256,
      height: 128,
      channelIndex: 0
    })).toEqual({
      kind: 'tile',
      level: 0,
      x: 1,
      y: 2,
      width: 256,
      height: 128,
      channelIndex: 0
    })
    expect(workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'thumbnail',
      width: 320,
      height: 180,
      channelIndex: 1
    })).toEqual({
      kind: 'thumbnail',
      width: 320,
      height: 180,
      channelIndex: 1
    })
    expect(() => workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'thumbnail',
      width: 4097,
      height: 180
    })).toThrow()
    expect(() => workspacePreviewPrepareArtifactRequestSchema.parse({
      kind: 'tile',
      level: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 128
    })).toThrow()
    expect(workspacePreviewArtifactDescriptorSchema.parse({
      ...artifact,
      artifactId: 'tile-artifact-1',
      kind: 'tile',
      mimeType: 'image/png',
      cache: {
        ...artifact.cache,
        source: 'worker-decoder'
      },
      tile: {
        level: 0,
        x: 1,
        y: 2,
        width: 256,
        height: 128
      }
    })).toMatchObject({
      kind: 'tile',
      mimeType: 'image/png',
      cache: {
        source: 'worker-decoder'
      },
      tile: {
        level: 0,
        x: 1,
        y: 2,
        width: 256,
        height: 128
      }
    })
    expect(workspacePreviewArtifactDescriptorSchema.parse({
      ...artifact,
      artifactId: 'thumbnail-artifact-1',
      kind: 'thumbnail',
      mimeType: 'image/png',
      cache: {
        ...artifact.cache,
        source: 'worker-decoder'
      },
      thumbnail: {
        width: 320,
        height: 180
      }
    })).toMatchObject({
      kind: 'thumbnail',
      mimeType: 'image/png',
      cache: {
        source: 'worker-decoder'
      },
      thumbnail: {
        width: 320,
        height: 180
      }
    })
    expect(workspacePreviewReadArtifactRangeRequestSchema.parse({
      artifactId: 'artifact-1',
      range: { offset: 0, length: 128 }
    })).toEqual({
      artifactId: 'artifact-1',
      range: { offset: 0, length: 128 }
    })
  })

  it('resolves desktop transfer capabilities and web preview fallbacks', () => {
    const desktop = resolveWorkspacePreviewTransferCapabilities('desktop')
    const web = resolveWorkspacePreviewTransferCapabilities({ runtime: 'web' })

    expect(desktop.nativeFileSystem).toBe(true)
    expect(desktop.dragInActions).toEqual(expect.arrayContaining(['import-files', 'move-workspace-items']))
    expect(desktop.dragOutActions).toContain('native-file')
    expect(desktop.pastePayloadKinds).toEqual(expect.arrayContaining(['files', 'screenshot']))

    expect(web.nativeFileSystem).toBe(false)
    expect(web.dragInActions).not.toContain('import-files')
    expect(web.dragOutActions).not.toContain('native-file')
    expect(web.dragOutActions).toEqual(expect.arrayContaining(['download', 'copy-path', 'copy-content']))
    expect(web.pastePayloadKinds).not.toContain('files')
    expect(web.fallbacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'native-file',
        to: expect.arrayContaining(['download', 'copy-path', 'copy-content'])
      })
    ]))
  })

  it('validates conflict policies for workspace transfer naming decisions', () => {
    expect(workspacePreviewConflictPolicySchema.parse({ strategy: 'overwrite' })).toEqual({
      strategy: 'overwrite'
    })
    expect(workspacePreviewConflictPolicySchema.parse({ strategy: 'rename' })).toEqual({
      strategy: 'rename',
      renameTemplate: '{name} copy{ext}',
      maxAttempts: 100
    })
    expect(workspacePreviewConflictPolicySchema.parse({
      strategy: 'rename',
      renameTemplate: '{name} ({n}){ext}',
      maxAttempts: 5
    })).toMatchObject({
      strategy: 'rename',
      renameTemplate: '{name} ({n}){ext}',
      maxAttempts: 5
    })
    expect(() => workspacePreviewConflictPolicySchema.parse({ strategy: 'replace' })).toThrow()
  })

  it('accepts copy payloads for paths, content, and attachments plus paste payload skeletons', () => {
    expect([
      workspacePreviewCopyPayloadSchema.parse({
        kind: 'path',
        path: 'results/report.pdf'
      }).kind,
      workspacePreviewCopyPayloadSchema.parse({
        kind: 'content',
        text: 'gene,count\nTP53,12',
        mimeType: 'text/csv',
        sourcePath: 'results/counts.csv'
      }).kind,
      workspacePreviewCopyPayloadSchema.parse({
        kind: 'attachment',
        attachment: {
          attachmentId: 'a1',
          name: 'report.pdf',
          path: 'results/report.pdf',
          mimeType: 'application/pdf'
        }
      }).kind
    ]).toEqual(['path', 'content', 'attachment'])

    expect(workspacePreviewPastePayloadSchema.parse({
      kind: 'files',
      files: [{ name: 'cells.csv', mimeType: 'text/csv' }],
      targetDirectory: 'incoming',
      conflictPolicy: { strategy: 'rename' }
    }).conflictPolicy).toMatchObject({
      strategy: 'rename',
      renameTemplate: '{name} copy{ext}'
    })
    expect(workspacePreviewPastePayloadSchema.parse({
      kind: 'text',
      text: 'notes',
      targetDirectory: 'incoming'
    }).kind).toBe('text')
  })

  it('declares drag-in and drag-out actions and parses source and target contracts', () => {
    for (const action of ['import-files', 'import-directory', 'move-workspace-items', 'paste-content', 'attach-to-session']) {
      expect(workspacePreviewDragInActionSchema.parse(action)).toBe(action)
    }
    for (const action of ['native-file', 'download', 'copy-path', 'copy-content', 'attach-to-session']) {
      expect(workspacePreviewDragOutActionSchema.parse(action)).toBe(action)
    }
    expect(() => workspacePreviewDragInActionSchema.parse('native-file')).toThrow()

    expect(workspacePreviewDragSourceSchema.parse({
      kind: 'workspace-file',
      path: 'results/report.pdf',
      supportedActions: ['native-file', 'copy-path']
    }).kind).toBe('workspace-file')
    expect(workspacePreviewDragTargetSchema.parse({
      kind: 'workspace-directory',
      path: 'incoming',
      acceptedActions: ['import-files', 'paste-content'],
      conflictPolicy: { strategy: 'ask' }
    }).kind).toBe('workspace-directory')
  })

  it('validates bounded edit diff summaries with undo unavailable hints', () => {
    const summary = workspacePreviewEditDiffSummarySchema.parse({
      schemaVersion: 1,
      kind: 'bounded',
      summary: 'Updated cell R0C1.',
      operationKind: 'tabular.updateCell',
      target: {
        path: '/workspace/samples.csv',
        tabular: {
          cells: [{ row: 0, column: 1 }]
        }
      },
      counts: {
        filesChanged: 1,
        cellsChanged: 1
      },
      previews: [{
        label: 'R0C1',
        before: '2',
        after: '3'
      }],
      undo: {
        available: false,
        hint: 'Undo is not available for workspace preview edits yet.'
      },
      bounded: {
        maxPreviewItems: 20,
        maxPreviewChars: 4000,
        truncated: false
      }
    })

    expect(summary.undo.available).toBe(false)
    expect(summary.counts.cellsChanged).toBe(1)
  })
})

describe('life science workspace preview scope guard', () => {
  it('routes current-stage life-science molecular, omics, bioimaging, and spectra files', () => {
    expect(resolveLifeSciencePreviewRoute('model.mmcif')).toMatchObject({
      scope: 'life-science',
      format: { pluginId: 'molecular', modality: 'molecular' }
    })
    expect(resolveLifeSciencePreviewRoute('atlas.h5ad')).toMatchObject({
      scope: 'life-science',
      format: { pluginId: 'omics-matrix', modality: 'omics' }
    })
    expect(resolveLifeSciencePreviewRoute('/slides/cell.ome.tiff')).toMatchObject({
      scope: 'life-science',
      format: { pluginId: 'bioimaging', modality: 'bioimaging' }
    })
    expect(resolveLifeSciencePreviewRoute('run.mzML')).toMatchObject({
      scope: 'life-science',
      format: { pluginId: 'proteomics-spectra', modality: 'spectra' }
    })
  })

  it('routes sequence and genomics files to the life-science sequence plugin', () => {
    for (const path of [
      'reads.fastq',
      'reference.fasta',
      'reference.fna',
      'proteome.faa',
      'genes.gff',
      'genes.gff3',
      'variants.vcf'
    ]) {
      expect(resolveLifeSciencePreviewRoute(path)).toMatchObject({
        scope: 'life-science',
        format: { pluginId: 'sequence-genomics', modality: 'sequence' }
      })
    }
  })

  it('defers non-life-science scientific modalities explicitly', () => {
    expect(resolveLifeSciencePreviewRoute('mesh.vtk')).toMatchObject({
      scope: 'deferred-non-life-science',
      status: 'deferred'
    })
    expect(resolveLifeSciencePreviewRoute('region.geojson')).toMatchObject({
      scope: 'deferred-non-life-science',
      status: 'deferred'
    })
    expect(isDeferredNonLifeScienceExtension('.stl')).toBe(true)
    expect(isLifeSciencePreviewExtension('.stl')).toBe(false)
  })

  it('leaves unknown formats unsupported instead of silently expanding scope', () => {
    expect(resolveLifeSciencePreviewRoute('experiment.unknown')).toEqual({
      scope: 'unknown',
      status: 'unsupported',
      extension: '.unknown'
    })
  })
})
