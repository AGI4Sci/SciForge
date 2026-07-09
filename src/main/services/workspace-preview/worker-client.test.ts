import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspacePreviewFileState,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession
} from '../../../shared/workspace-preview'
import { FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS } from './registry'
import { WorkspacePreviewWorkerClient } from './worker-client'

describe('WorkspacePreviewWorkerClient', () => {
  let rootDir = ''
  let workspaceRoot = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'workspace-preview-worker-client-'))
    workspaceRoot = join(rootDir, 'workspace')
    await mkdir(workspaceRoot)
  })

  it('maps tabular worker summaries to the shared observation schema', async () => {
    const filePath = join(workspaceRoot, 'samples.jsonl')
    const text = '{"sample":"s1","count":2}\n{"sample":"s2","count":3}\n'
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('tabular'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'samples.jsonl',
        mimeType: 'application/x-ndjson',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
        view: { pluginId: 'tabular', modality: 'tabular' },
        tables: [{ id: 'table-1', rowCount: 2, columnCount: 2 }]
      }
    })
    if (result.ok) {
      expect(result.observation.actions).toContain('tabular.filterRows')
      expect(result.observation.actions).toContain('tabular.selectCells')
      for (const actionId of [
        'applyEdit',
        'save',
        'tabular.updateCell',
        'tabular.insertRows',
        'tabular.insertColumns',
        'tabular.deleteRows',
        'tabular.deleteColumns'
      ]) {
        expect(result.observation.actions).not.toContain(actionId)
      }
    }
  })

  it('maps XLSX first-sheet bounded previews through the tabular worker as read-only observations', async () => {
    const filePath = join(workspaceRoot, 'samples.xlsx')
    const bytes = await createMinimalTabularXlsxBytes()
    await writeFile(filePath, bytes)

    const result = await observeFile({
      manifest: manifestById('tabular'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'samples.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: bytes.byteLength,
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      bytesRead: bytes.byteLength,
      truncated: false,
      observation: {
        schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
        view: { pluginId: 'tabular', modality: 'tabular' },
        tables: [{ id: 'table-1', name: 'Data', rowCount: 3, columnCount: 3 }],
        tabular: {
          header: ['sample', 'count', 'note'],
          rows: [
            { index: 0, values: ['s1', '2', 'alpha'] },
            { index: 1, values: ['s2', '3', 'true'] },
            { index: 2, values: ['s3', '4', 'rich text'] }
          ],
          truncatedRows: false,
          truncatedColumns: false
        }
      }
    })
    if (result.ok) {
      expect(result.observation.visibleText).toContain('Detected format: XLSX')
      expect(result.observation.visibleText).toContain('Sheet: Data')
      expect(result.observation.actions).toContain('tabular.filterRows')
      for (const actionId of [
        'applyEdit',
        'save',
        'tabular.updateCell',
        'tabular.insertRows',
        'tabular.insertColumns',
        'tabular.deleteRows',
        'tabular.deleteColumns'
      ]) {
        expect(result.observation.actions).not.toContain(actionId)
      }
    }
  })

  it('maps omics worker-private matrix details onto shared omics fields', async () => {
    const filePath = join(workspaceRoot, 'counts.mtx')
    const text = '%%MatrixMarket matrix coordinate integer general\n2 3 4\n1 1 7\n'
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('omics-matrix'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'counts.mtx',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'omics-matrix', modality: 'omics' },
        omics: {
          matrixShape: [2, 3],
          observationCount: 2,
          variableCount: 3
        }
      }
    })
  })

  it('maps omics metadata embedding names onto shared omics fields', async () => {
    const filePath = join(workspaceRoot, 'atlas.h5ad')
    const text = JSON.stringify({
      n_obs: 3,
      n_vars: 2,
      obs: ['cell_type', 'batch'],
      var: ['gene_symbol'],
      obsm: {
        X_umap: [],
        X_pca: []
      }
    })
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('omics-matrix'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'atlas.h5ad',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'omics-matrix', modality: 'omics' },
        omics: {
          format: 'h5ad',
          matrixIds: ['matrix-1'],
          matrixShape: [3, 2],
          observationCount: 3,
          variableCount: 2,
          obsKeys: ['cell_type', 'batch'],
          varKeys: ['gene_symbol'],
          embeddings: ['X_umap', 'X_pca']
        }
      }
    })
  })

  it('maps bioimaging selection and metadata-only tile plans onto shared fields', async () => {
    const filePath = join(workspaceRoot, 'cells.tif')
    const bytes = createMinimalTiffBytes(2048, 1024)
    await writeFile(filePath, bytes)

    const result = await observeFile({
      manifest: manifestById('bioimaging'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'cells.tif',
        mimeType: 'image/tiff',
        size: bytes.byteLength,
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'bioimaging', modality: 'bioimaging' },
        selection: {
          kind: 'bioimaging',
          regions: [{ x: 0, y: 0, width: 2048, height: 1024 }]
        },
        bioimaging: {
          format: 'tiff',
          detectedBy: 'path',
          byteLength: bytes.byteLength,
          dimensions: { width: 2048, height: 1024 },
          tilePlan: {
            status: 'metadata-only',
            source: 'tiff-metadata',
            levelCount: expect.any(Number),
            tileSize: { width: 512, height: 512 },
            pixelDecoding: false,
            tileRendererImplemented: false
          }
        }
      }
    })
  })

  it('prepares bioimaging tile artifacts through the first-party worker decoder', async () => {
    const filePath = join(workspaceRoot, 'rgb-field.tif')
    const bytes = createUncompressedRgbTiffBytes(4, 3, new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10
    ]))
    await writeFile(filePath, bytes)
    const manifest = manifestById('bioimaging')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'rgb-field.tif',
      mimeType: 'image/tiff',
      size: bytes.byteLength,
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.prepareArtifact({
      manifest,
      file,
      session: createSession(manifest, file),
      request: {
        kind: 'tile',
        level: 0,
        x: 0,
        y: 0,
        width: 2,
        height: 2
      }
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'tile',
      mimeType: 'image/png',
      tile: {
        level: 0,
        x: 0,
        y: 0,
        width: 2,
        height: 2
      },
      bytesRead: bytes.byteLength,
      truncated: false,
      pixelDecoding: true,
      tileRendererImplemented: true
    })
    if (result.ok) {
      expect([...result.bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })

  it('prepares bioimaging thumbnail artifacts through the first-party worker decoder', async () => {
    const filePath = join(workspaceRoot, 'rgb-thumbnail.tif')
    const bytes = createUncompressedRgbTiffBytes(4, 2, new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120
    ]))
    await writeFile(filePath, bytes)
    const manifest = manifestById('bioimaging')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'rgb-thumbnail.tif',
      mimeType: 'image/tiff',
      size: bytes.byteLength,
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.prepareArtifact({
      manifest,
      file,
      session: createSession(manifest, file),
      request: {
        kind: 'thumbnail',
        width: 2,
        height: 2
      }
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'thumbnail',
      mimeType: 'image/png',
      thumbnail: {
        width: 2,
        height: 1
      },
      bytesRead: bytes.byteLength,
      truncated: false,
      pixelDecoding: true,
      thumbnailRendererImplemented: true
    })
    if (result.ok) {
      expect([...result.bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })

  it('maps spectra worker-private scan details onto shared spectra fields', async () => {
    const filePath = join(workspaceRoot, 'run.mgf')
    const text = 'BEGIN IONS\nTITLE=s1\n100.1 200\n101.2 300\nEND IONS\n'
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('proteomics-spectra'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'run.mgf',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'proteomics-spectra', modality: 'spectra' },
        selection: {
          kind: 'spectra',
          ranges: [{ xStart: 100.1, xEnd: 101.2, yStart: 200, yEnd: 300 }]
        },
        spectra: {
          format: 'mgf',
          spectrumCount: 1,
          peakCount: 2,
          scanCount: 0,
          xAxis: 'm/z',
          mzRange: { min: 100.1, max: 101.2 },
          intensityRange: { min: 200, max: 300 },
          sampledPeaks: [
            { spectrumIndex: 0, peakIndex: 0, mz: 100.1, intensity: 200 },
            { spectrumIndex: 0, peakIndex: 1, mz: 101.2, intensity: 300 }
          ]
        }
      }
    })
  })

  it('routes MOL2 molecular files to the lightweight molecular worker', async () => {
    const filePath = join(workspaceRoot, 'ligand.mol2')
    const text = [
      '@<TRIPOS>MOLECULE',
      'LIG',
      '3 2 1 0 0',
      'SMALL',
      'USER_CHARGES',
      '@<TRIPOS>ATOM',
      '1 C1 0.0 0.0 0.0 C.3 1 LIG 0.0',
      '2 O1 1.0 0.0 0.0 O.2 1 LIG 0.0',
      '3 N1 0.0 1.0 0.0 N.am 1 LIG 0.0',
      '@<TRIPOS>BOND',
      '1 1 2 1',
      '2 1 3 1',
      '@<TRIPOS>SUBSTRUCTURE',
      '1 LIG 1 RESIDUE 1 A LIG 0 ROOT',
      ''
    ].join('\n')
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('molecular'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'ligand.mol2',
        mimeType: 'chemical/x-mol2',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'molecular', modality: 'molecular' },
        molecular: {
          modelCount: 1
        }
      }
    })
  })

  it('routes molecular trajectory files to safe placeholder observations', async () => {
    const filePath = join(workspaceRoot, 'trajectory.xtc')
    const bytes = new Uint8Array([0x58, 0x54, 0x43, 0x00, 0x01, 0x02])
    await writeFile(filePath, bytes)

    const result = await observeFile({
      manifest: manifestById('molecular'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'trajectory.xtc',
        mimeType: 'application/x-gromacs-xtc',
        size: bytes.byteLength,
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'molecular', modality: 'molecular' },
        molecular: {
          modelCount: 0,
          representations: ['trajectory-placeholder']
        },
        annotations: [
          {
            kind: 'warning',
            summary: expect.stringContaining('recognized but not decoded')
          }
        ],
        actions: expect.arrayContaining(['observe', 'select', 'export', 'molecular.preview'])
      }
    })
    if (result.ok) {
      expect(result.observation.actions).not.toContain('molecular.measureDistance')
    }
  })

  it('maps sequence worker summaries to the shared sequence fields', async () => {
    const filePath = join(workspaceRoot, 'refs.fasta')
    const text = '>chr1\nACGTACGT\n>chr2\nGGCC\n'
    await writeFile(filePath, text, 'utf8')

    const result = await observeFile({
      manifest: manifestById('sequence-genomics'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'refs.fasta',
        mimeType: 'text/x-fasta',
        size: Buffer.byteLength(text),
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'sequence-genomics', modality: 'sequence' },
        sequence: {
          sequenceCount: 2,
          totalLength: 12,
          references: [
            expect.objectContaining({
              id: 'chr1',
              sequenceLength: 8
            }),
            expect.objectContaining({
              id: 'chr2',
              sequenceLength: 4
            })
          ],
          indexedRanges: [
            expect.objectContaining({
              reference: 'chr1',
              start: 0,
              end: 8
            }),
            expect.objectContaining({
              reference: 'chr2',
              start: 0,
              end: 4
            })
          ]
        }
      }
    })
  })

  it('does not advertise write-backed edit/save actions for read-only life-science observations', async () => {
    const samples: Array<{
      manifestId: string
      relativePath: string
      mimeType?: string
      bytes: Uint8Array | string
    }> = [
      {
        manifestId: 'molecular',
        relativePath: 'protein.pdb',
        mimeType: 'chemical/x-pdb',
        bytes: 'ATOM      1  CA  GLY A   1       0.000   0.000   0.000  1.00 10.00           C\nEND\n'
      },
      {
        manifestId: 'sequence-genomics',
        relativePath: 'refs.fasta',
        mimeType: 'text/x-fasta',
        bytes: '>chr1\nACGTACGT\n'
      },
      {
        manifestId: 'omics-matrix',
        relativePath: 'counts.mtx',
        bytes: '%%MatrixMarket matrix coordinate integer general\n2 3 1\n1 1 7\n'
      },
      {
        manifestId: 'bioimaging',
        relativePath: 'experiment.czi',
        bytes: new Uint8Array(Buffer.from('ZISRAWFILE\0metadata-placeholder'))
      },
      {
        manifestId: 'proteomics-spectra',
        relativePath: 'run.mgf',
        bytes: 'BEGIN IONS\nTITLE=s1\n100.1 200\nEND IONS\n'
      }
    ]

    for (const sample of samples) {
      const manifest = manifestById(sample.manifestId)
      const filePath = join(workspaceRoot, sample.relativePath)
      await writeFile(filePath, sample.bytes)
      const size = typeof sample.bytes === 'string' ? Buffer.byteLength(sample.bytes) : sample.bytes.byteLength

      const result = await observeFile({
        manifest,
        file: {
          workspaceRoot,
          path: filePath,
          relativePath: sample.relativePath,
          ...(sample.mimeType ? { mimeType: sample.mimeType } : {}),
          size,
          mtimeMs: 1
        }
      })

      expect(result).toMatchObject({
        ok: true,
        observation: {
          view: { pluginId: manifest.id, modality: manifest.modality }
        }
      })
      if (!result.ok) continue
      expect(result.observation.actions).not.toContain('applyEdit')
      expect(result.observation.actions).not.toContain('save')
    }
  })

  it('invokes life-science worker actions through bounded previews', async () => {
    const filePath = join(workspaceRoot, 'refs.fasta')
    const text = '>chr1\nACGTACGT\n>chr2\nGGCC\n'
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('sequence-genomics')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'refs.fasta',
      mimeType: 'text/x-fasta',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'sequence.search',
        input: {
          query: 'chr1',
          scope: 'records'
        }
      }
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        query: 'chr1',
        matchCount: 1,
        matches: [{ kind: 'record', reference: 'chr1' }]
      }
    })
  })

  it('invokes declared life-science inspect and preview actions from existing metadata previews', async () => {
    const client = new WorkspacePreviewWorkerClient()

    const gffText = '##gff-version 3\nchr1\tsrc\tgene\t1\t10\t.\t+\t.\tID=gene1\n'
    const gffPath = join(workspaceRoot, 'genes.gff')
    await writeFile(gffPath, gffText, 'utf8')
    const sequenceManifest = manifestById('sequence-genomics')
    const sequenceFile: WorkspacePreviewFileState = {
      workspaceRoot,
      path: gffPath,
      relativePath: 'genes.gff',
      size: Buffer.byteLength(gffText),
      mtimeMs: 1
    }
    const sequenceFeatures = await client.invokeAction({
      manifest: sequenceManifest,
      file: sequenceFile,
      session: createSession(sequenceManifest, sequenceFile),
      action: {
        actionId: 'sequence.inspectFeatures',
        input: {}
      }
    })

    const h5adText = JSON.stringify({
      n_obs: 3,
      n_vars: 2,
      obs: ['cell_type'],
      var: ['gene_symbol'],
      obsm: { X_umap: [] }
    })
    const h5adPath = join(workspaceRoot, 'atlas.h5ad')
    await writeFile(h5adPath, h5adText, 'utf8')
    const omicsManifest = manifestById('omics-matrix')
    const omicsFile: WorkspacePreviewFileState = {
      workspaceRoot,
      path: h5adPath,
      relativePath: 'atlas.h5ad',
      size: Buffer.byteLength(h5adText),
      mtimeMs: 1
    }
    const omicsMetadata = await client.invokeAction({
      manifest: omicsManifest,
      file: omicsFile,
      session: createSession(omicsManifest, omicsFile),
      action: {
        actionId: 'omics.inspectMetadata',
        input: {}
      }
    })
    const omicsCapabilities = await client.invokeAction({
      manifest: omicsManifest,
      file: omicsFile,
      session: createSession(omicsManifest, omicsFile),
      action: {
        actionId: 'omics.declareCapabilities',
        input: {}
      }
    })

    const tiffBytes = createMinimalTiffBytes(1024, 512)
    const tiffPath = join(workspaceRoot, 'cells.tif')
    await writeFile(tiffPath, tiffBytes)
    const bioimagingManifest = manifestById('bioimaging')
    const bioimagingFile: WorkspacePreviewFileState = {
      workspaceRoot,
      path: tiffPath,
      relativePath: 'cells.tif',
      mimeType: 'image/tiff',
      size: tiffBytes.byteLength,
      mtimeMs: 1
    }
    const tilePlan = await client.invokeAction({
      manifest: bioimagingManifest,
      file: bioimagingFile,
      session: createSession(bioimagingManifest, bioimagingFile),
      action: {
        actionId: 'bioimaging.describeTilePlan',
        input: {}
      }
    })

    const mzmlText = [
      '<mzML>',
      '<spectrum index="0" id="scan=27" defaultArrayLength="1234">',
      '<cvParam accession="MS:1000511" name="ms level" value="2"/>',
      '<cvParam accession="MS:1000528" name="lowest observed m/z" value="50.5"/>',
      '<cvParam accession="MS:1000527" name="highest observed m/z" value="1000.5"/>',
      '</spectrum>',
      '</mzML>'
    ].join('\n')
    const mzmlPath = join(workspaceRoot, 'run.mzML')
    await writeFile(mzmlPath, mzmlText, 'utf8')
    const spectraManifest = manifestById('proteomics-spectra')
    const spectraFile: WorkspacePreviewFileState = {
      workspaceRoot,
      path: mzmlPath,
      relativePath: 'run.mzML',
      size: Buffer.byteLength(mzmlText),
      mtimeMs: 1
    }
    const scanInspection = await client.invokeAction({
      manifest: spectraManifest,
      file: spectraFile,
      session: createSession(spectraManifest, spectraFile),
      action: {
        actionId: 'spectra.inspectScans',
        input: {}
      }
    })

    expect(sequenceFeatures).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: 'gff',
        featureCount: 1,
        features: [{ reference: 'chr1', type: 'gene' }]
      }
    })
    expect(omicsMetadata).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: 'h5ad',
        dataset: { nObs: 3, nVars: 2, obsKeys: ['cell_type'], varKeys: ['gene_symbol'] }
      }
    })
    expect(omicsCapabilities).toMatchObject({
      ok: true,
      result: {
        ok: true,
        capabilities: expect.arrayContaining([
          expect.objectContaining({ format: 'h5ad' })
        ])
      }
    })
    expect(tilePlan).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: 'tiff',
        tilePlan: {
          status: 'metadata-only',
          pixelDecoding: false
        }
      }
    })
    expect(scanInspection).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: 'mzml',
        scanCount: 1,
        scanMarkers: [{ scanNumber: '27', msLevel: '2' }]
      }
    })
  })

  it('invokes tabular worker actions from bounded preview rows', async () => {
    const filePath = join(workspaceRoot, 'samples.csv')
    const text = 'sample,count,group\ns1,2,control\ns2,12,treated\ns3,15,treated\n'
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('tabular')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'samples.csv',
      mimeType: 'text/csv',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const query = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.filterRows',
        input: {
          filters: [{ columnName: 'group', operator: 'equals', value: 'treated' }],
          sorts: [{ columnName: 'count', direction: 'desc', compareAs: 'number' }]
        }
      }
    })
    const selection = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.selectCells',
        input: {
          ranges: [{ rowStart: 1, rowEnd: 2, columnStart: 0, columnEnd: 1 }]
        }
      }
    })
    const rowDelete = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.deleteRows',
        input: {
          rows: [1]
        }
      }
    })
    const columnInsert = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.insertColumns',
        input: {
          afterColumn: -1,
          columns: [['label-1', 'label-2']]
        }
      }
    })
    const columnDelete = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.deleteColumns',
        input: {
          columns: [1]
        }
      }
    })

    expect(query).toMatchObject({
      ok: true,
      result: {
        filteredRowCount: 2,
        returnedRowCount: 2,
        rows: [
          { values: ['s3', '15', 'treated'] },
          { values: ['s2', '12', 'treated'] }
        ]
      }
    })
    expect(selection).toMatchObject({
      ok: true,
      result: {
        selection: {
          kind: 'tabular',
          ranges: [{ rowStart: 1, rowEnd: 2, columnStart: 0, columnEnd: 1 }]
        },
        selectedCellCount: 4
      }
    })
    expect(rowDelete).toMatchObject({
      ok: true,
      result: [
        ['s1', '2', 'control'],
        ['s3', '15', 'treated']
      ]
    })
    expect(columnInsert).toMatchObject({
      ok: true,
      result: [
        ['label-1', 's1', '2', 'control'],
        ['label-2', 's2', '12', 'treated'],
        ['', 's3', '15', 'treated']
      ]
    })
    expect(columnDelete).toMatchObject({
      ok: true,
      result: [
        ['s1', 'control'],
        ['s2', 'treated'],
        ['s3', 'treated']
      ]
    })
  })

  it('allows XLSX read-only tabular actions and rejects write-like actions', async () => {
    const filePath = join(workspaceRoot, 'samples.xlsx')
    const bytes = await createMinimalTabularXlsxBytes()
    await writeFile(filePath, bytes)
    const manifest = manifestById('tabular')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'samples.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: bytes.byteLength,
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const query = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.filterRows',
        input: {
          filters: [{ columnName: 'count', operator: 'gte', value: 3, compareAs: 'number' }],
          sorts: [{ columnName: 'sample', direction: 'desc' }]
        }
      }
    })
    const update = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.updateCell',
        input: {
          row: 0,
          column: 1,
          value: '99'
        }
      }
    })

    expect(query).toMatchObject({
      ok: true,
      result: {
        filteredRowCount: 2,
        returnedRowCount: 2,
        rows: [
          { values: ['s3', '4', 'rich text'] },
          { values: ['s2', '3', 'true'] }
        ]
      }
    })
    expect(update).toMatchObject({
      ok: false,
      reason: 'unsupported-action',
      message: expect.stringContaining('read-only')
    })
  })

  it('allows JSONL read-only tabular actions and rejects write-like actions', async () => {
    const filePath = join(workspaceRoot, 'samples.jsonl')
    const text = '{"sample":"s1","count":2}\n{"sample":"s2","count":3}\n'
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('tabular')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'samples.jsonl',
      mimeType: 'application/x-ndjson',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const query = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.filterRows',
        input: {
          filters: [{ columnName: 'count', operator: 'gte', value: 3, compareAs: 'number' }]
        }
      }
    })
    const update = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'tabular.updateCell',
        input: {
          row: 0,
          column: 1,
          value: '99'
        }
      }
    })

    expect(query).toMatchObject({
      ok: true,
      result: {
        filteredRowCount: 1,
        returnedRowCount: 1,
        rows: [{ values: ['s2', '3'] }]
      }
    })
    expect(update).toMatchObject({
      ok: false,
      reason: 'unsupported-action',
      message: expect.stringContaining('JSONL tabular preview is read-only')
    })
  })

  it('maps PPTX text elements onto shared deck observation fields', async () => {
    const filePath = join(workspaceRoot, 'talk.pptx')
    const bytes = await createMinimalDeckPptxBytes()
    await writeFile(filePath, bytes)

    const result = await observeFile({
      manifest: manifestById('deck'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'talk.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: bytes.byteLength,
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'deck', modality: 'deck' },
        deck: {
          textElementCount: 2,
          truncatedTextElements: false,
          slidePreviews: [
            {
              slideId: 'slide1',
              index: 0,
              width: 12_192_000,
              height: 6_858_000,
              textBoxes: [
                {
                  elementId: 'slide1:slide-1',
                  kind: 'title',
                  text: 'Overview',
                  x: 914_400,
                  y: 457_200,
                  width: 10_363_200,
                  height: 914_400
                },
                {
                  elementId: 'slide1:slide-2',
                  kind: 'body',
                  text: 'Assay response increased after treatment.',
                  x: 914_400,
                  y: 1_828_800,
                  width: 10_363_200,
                  height: 3_657_600
                }
              ]
            }
          ],
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
        annotations: [
          {
            id: 'slide1:comment-0-1',
            kind: 'pptx-comment',
            summary: expect.stringContaining('Review assay trend.')
          }
        ]
      }
    })
  })

  it('routes deck worker actions and reports unsupported legacy PPT formats', async () => {
    const filePath = join(workspaceRoot, 'legacy.ppt')
    const bytes = new Uint8Array([1, 2, 3, 4])
    await writeFile(filePath, bytes)
    const manifest = manifestById('deck')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'legacy.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
      size: bytes.byteLength,
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'deck.selectSlide',
        input: {
          index: 0
        }
      }
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'unsupported-format',
      message: expect.stringContaining('Only PPTX deck worker actions')
    })
  })

  it('returns explicit unsupported-action results for unknown first-party worker actions', async () => {
    const filePath = join(workspaceRoot, 'refs.fasta')
    const text = '>chr1\nACGTACGT\n'
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('sequence-genomics')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'refs.fasta',
      mimeType: 'text/x-fasta',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'sequence.notImplemented',
        input: {}
      }
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'unsupported-action',
      message: expect.stringContaining('sequence.notImplemented')
    })
  })

  it('does not trust caller-supplied spectra peaks when selecting bounded preview peaks', async () => {
    const filePath = join(workspaceRoot, 'run.mgf')
    const text = 'BEGIN IONS\nTITLE=s1\n100.1 200\nEND IONS\n'
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('proteomics-spectra')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'run.mgf',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'spectra.selectPeaksByRange',
        input: {
          peaks: [{ spectrumIndex: 0, peakIndex: 99, mz: 999.9, intensity: 1 }],
          range: {
            mzMin: 900,
            mzMax: 1000
          }
        }
      }
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        peakCount: 0,
        peaks: []
      }
    })
  })

  it('annotates bioimaging placeholders without decoding pixels', async () => {
    const filePath = join(workspaceRoot, 'experiment.czi')
    const bytes = new Uint8Array(64)
    bytes.set(Buffer.from('ZISRAWFILE', 'utf8'))
    await writeFile(filePath, bytes)
    const manifest = manifestById('bioimaging')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'experiment.czi',
      size: bytes.byteLength,
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'bioimaging.annotateRegion',
        input: {
          roiId: 'roi-placeholder',
          label: 'Placeholder ROI',
          region: {
            x: 1,
            y: 2,
            width: 10,
            height: 12
          }
        }
      }
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        roiId: 'roi-placeholder',
        annotation: {
          metadataOnly: true,
          pixelDecoding: false,
          label: 'Placeholder ROI'
        },
        selection: {
          kind: 'bioimaging',
          roiIds: ['roi-placeholder']
        }
      }
    })
  })

  it('returns a molecular distance fallback when preview atoms have no coordinates', async () => {
    const filePath = join(workspaceRoot, 'no-coordinates.pdb')
    const text = [
      'ATOM      1  N   GLY A   1                                                  N',
      'ATOM      2  CA  GLY A   1                                                  C',
      ''
    ].join('\n')
    await writeFile(filePath, text, 'utf8')
    const manifest = manifestById('molecular')
    const file: WorkspacePreviewFileState = {
      workspaceRoot,
      path: filePath,
      relativePath: 'no-coordinates.pdb',
      mimeType: 'chemical/x-pdb',
      size: Buffer.byteLength(text),
      mtimeMs: 1
    }
    const client = new WorkspacePreviewWorkerClient()

    const result = await client.invokeAction({
      manifest,
      file,
      session: createSession(manifest, file),
      action: {
        actionId: 'molecular.measureDistance',
        input: {
          atoms: [{ id: '1' }, { id: '2' }]
        }
      }
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        coordinateAvailable: false,
        unit: 'angstrom',
        selection: {
          kind: 'molecular',
          atoms: [{ index: 1 }, { index: 2 }]
        },
        warnings: [expect.stringContaining('coordinates')]
      }
    })
    if (result.ok && typeof result.result === 'object' && result.result !== null) {
      expect(result.result).not.toHaveProperty('distance')
    }
  })

  it('maps bioimaging placeholder observations without eager pixel decoding', async () => {
    const filePath = join(workspaceRoot, 'experiment.czi')
    const bytes = new Uint8Array(64)
    bytes.set(Buffer.from('ZISRAWFILE', 'utf8'))
    await writeFile(filePath, bytes)

    const result = await observeFile({
      manifest: manifestById('bioimaging'),
      file: {
        workspaceRoot,
        path: filePath,
        relativePath: 'experiment.czi',
        size: bytes.byteLength,
        mtimeMs: 1
      }
    })

    expect(result).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'bioimaging', modality: 'bioimaging' }
      }
    })
    if (result.ok) {
      expect(result.bytesRead).toBe(bytes.byteLength)
      expect(result.observation.visibleText).toContain('CZI')
    }
  })
})

async function createMinimalTabularXlsxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`)
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">
  <si><t>sample</t></si>
  <si><t>count</t></si>
  <si><t>note</t></si>
  <si><t>s1</t></si>
  <si><t>s2</t></si>
  <si><t>s3</t></si>
  <si><t>ignored</t></si>
  <si><r><t>rich</t></r><r><t> text</t></r></si>
</sst>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>2</v></c><c r="C2" t="inlineStr"><is><t>alpha</t></is></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>3</v></c><c r="C3" t="b"><v>1</v></c></row>
    <row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>4</v></c><c r="C4" t="s"><v>7</v></c></row>
  </sheetData>
</worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>6</v></c></row>
  </sheetData>
</worksheet>`)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

async function createMinimalDeckPptxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rIdAuthors" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/>
</Relationships>`)
  zip.file('ppt/commentAuthors.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cmAuthor id="0" name="Reviewer" initials="RV" lastIdx="1" clrIdx="0"/>
</p:cmAuthorLst>`)
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="1" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10363200" cy="914400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Overview</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="10363200" cy="3657600"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Assay response increased after treatment.</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`)
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>
</Relationships>`)
  zip.file('ppt/comments/comment1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cm authorId="0" dt="2026-07-08T00:00:00Z" idx="1">
    <p:pos x="1" y="2"/>
    <p:text>Review assay trend.</p:text>
  </p:cm>
</p:cmLst>`)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

function createMinimalTiffBytes(width: number, height: number): Uint8Array {
  const entryCount = 2
  const bytes = Buffer.alloc(8 + 2 + entryCount * 12 + 4)
  bytes.write('II', 0, 'ascii')
  bytes.writeUInt16LE(42, 2)
  bytes.writeUInt32LE(8, 4)
  bytes.writeUInt16LE(entryCount, 8)
  writeTiffLongTag(bytes, 10, 256, width)
  writeTiffLongTag(bytes, 22, 257, height)
  bytes.writeUInt32LE(0, 34)
  return new Uint8Array(bytes)
}

function writeTiffLongTag(bytes: Buffer, offset: number, tag: number, value: number): void {
  bytes.writeUInt16LE(tag, offset)
  bytes.writeUInt16LE(4, offset + 2)
  bytes.writeUInt32LE(1, offset + 4)
  bytes.writeUInt32LE(value, offset + 8)
}

function createUncompressedRgbTiffBytes(
  width: number,
  height: number,
  pixels: Uint8Array
): Uint8Array {
  const samplesPerPixel = 3
  expect(pixels.byteLength).toBe(width * height * samplesPerPixel)
  const entryCount = 9
  const ifdOffset = 8
  const ifdByteLength = 2 + entryCount * 12 + 4
  const bitsOffset = ifdOffset + ifdByteLength
  const pixelOffset = bitsOffset + 6
  const bytes = Buffer.alloc(pixelOffset + pixels.byteLength)

  bytes.write('II', 0, 'ascii')
  bytes.writeUInt16LE(42, 2)
  bytes.writeUInt32LE(ifdOffset, 4)
  bytes.writeUInt16LE(entryCount, ifdOffset)
  writeTiffEntry(bytes, ifdOffset, 0, 256, 4, 1, width)
  writeTiffEntry(bytes, ifdOffset, 1, 257, 4, 1, height)
  writeTiffEntry(bytes, ifdOffset, 2, 258, 3, 3, bitsOffset)
  writeTiffEntry(bytes, ifdOffset, 3, 259, 3, 1, 1)
  writeTiffEntry(bytes, ifdOffset, 4, 262, 3, 1, 2)
  writeTiffEntry(bytes, ifdOffset, 5, 273, 4, 1, pixelOffset)
  writeTiffEntry(bytes, ifdOffset, 6, 277, 3, 1, samplesPerPixel)
  writeTiffEntry(bytes, ifdOffset, 7, 278, 4, 1, height)
  writeTiffEntry(bytes, ifdOffset, 8, 279, 4, 1, pixels.byteLength)
  bytes.writeUInt32LE(0, ifdOffset + 2 + entryCount * 12)
  bytes.writeUInt16LE(8, bitsOffset)
  bytes.writeUInt16LE(8, bitsOffset + 2)
  bytes.writeUInt16LE(8, bitsOffset + 4)
  pixels.forEach((byte, index) => {
    bytes[pixelOffset + index] = byte
  })
  return new Uint8Array(bytes)
}

function writeTiffEntry(
  bytes: Buffer,
  ifdOffset: number,
  index: number,
  tag: number,
  type: number,
  count: number,
  value: number
): void {
  const offset = ifdOffset + 2 + index * 12
  bytes.writeUInt16LE(tag, offset)
  bytes.writeUInt16LE(type, offset + 2)
  bytes.writeUInt32LE(count, offset + 4)
  bytes.writeUInt32LE(value, offset + 8)
}

async function observeFile(input: {
  manifest: WorkspacePreviewPluginManifest
  file: WorkspacePreviewFileState
}) {
  const client = new WorkspacePreviewWorkerClient()
  return client.observe({
    manifest: input.manifest,
    file: input.file,
    session: createSession(input.manifest, input.file)
  })
}

function createSession(
  manifest: WorkspacePreviewPluginManifest,
  file: WorkspacePreviewFileState
): WorkspacePreviewSession {
  return {
    id: `session-${manifest.id}`,
    pluginId: manifest.id,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality: manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    mtimeMs: file.mtimeMs
  }
}

function manifestById(id: string): WorkspacePreviewPluginManifest {
  const manifest = [
    ...FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS,
    ...LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS
  ].find((candidate) => candidate.id === id)
  if (!manifest) throw new Error(`Missing manifest ${id}`)
  return manifest
}
