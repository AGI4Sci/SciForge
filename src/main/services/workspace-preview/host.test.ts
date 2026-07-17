import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPdfAnnotationSidecar } from '../pdf-annotation-sidecar-service'
import { WorkspaceHtmlPreviewService } from '../workspace-html-preview-service'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES
} from '../../../shared/workspace-preview'
import { WorkspacePreviewHost } from './host'
import type { WorkspacePreviewWorkerClient } from './worker-client'

describe('WorkspacePreviewHost', () => {
  let rootDir = ''
  let workspaceRoot = ''
  let htmlPreviewService: WorkspaceHtmlPreviewService | null = null

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'workspace-preview-host-'))
    workspaceRoot = join(rootDir, 'workspace')
    await mkdir(workspaceRoot)
  })

  afterEach(async () => {
    await htmlPreviewService?.close()
    htmlPreviewService = null
  })

  it('opens a safe workspace file without reading its content', async () => {
    const filePath = join(workspaceRoot, 'huge.csv')
    await writeFile(filePath, `a,b\n${'1,2\n'.repeat(1000)}`, 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-1' })

    const result = await host.open({
      workspaceRoot,
      path: 'huge.csv',
      mimeType: 'text/csv',
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session).toMatchObject({
      id: 'session-1',
      pluginId: 'tabular',
      modality: 'tabular',
      mode: 'preview'
    })
    expect(result.file.relativePath).toBe('huge.csv')
    expect(result.file.size).toBeGreaterThan(0)
    expect(result.file.sha256).toBeUndefined()

    const observation = await host.observe(result.session.id)
    expect(observation).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'tabular', modality: 'tabular' },
        visibleText: expect.stringContaining('Tabular preview'),
        tables: [{ id: 'table-1', name: 'huge.csv', rowCount: 1000, columnCount: 2 }],
        actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save', 'export'])
      }
    })
  })

  it('infers image MIME metadata when opening an image by path only', async () => {
    await writeFile(join(workspaceRoot, 'figure.png'), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-image-path-only' })

    const opened = await host.open({ workspaceRoot, path: 'figure.png' })

    expect(opened).toMatchObject({
      ok: true,
      session: {
        pluginId: 'image',
        modality: 'image',
        file: { mimeType: 'image/png' }
      },
      file: { mimeType: 'image/png' }
    })
    if (!opened.ok) return

    await expect(host.describeAsset(opened.session.id)).resolves.toMatchObject({
      ok: true,
      descriptor: { file: { mimeType: 'image/png' } }
    })
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: { file: { mimeType: 'image/png' } }
    })
  })

  it('seeds the session and observation with a structured selection at open time', async () => {
    await writeFile(join(workspaceRoot, 'selected.csv'), 'name,value\nalpha,1\nbeta,2\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-selected' })
    const selection = {
      kind: 'tabular' as const,
      sheet: 'Results',
      ranges: [{ rowStart: 1, rowEnd: 2, columnStart: 0, columnEnd: 1 }]
    }

    const opened = await host.open({ workspaceRoot, path: 'selected.csv', selection })

    expect(opened).toMatchObject({ ok: true, session: { selection } })
    if (!opened.ok) return
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: { selection }
    })
  })

  it('normalizes document anchors and verifies sha256 only when requested', async () => {
    const contents = Buffer.from('%PDF-1.4\n%%EOF\n')
    await writeFile(join(workspaceRoot, 'evidence.pdf'), contents)
    const expectedHex = createHash('sha256').update(contents).digest('hex')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-evidence' })

    const opened = await host.open({
      workspaceRoot,
      path: 'evidence.pdf',
      anchor: {
        kind: 'document',
        id: 'source-anchor-1',
        page: 3,
        rects: [{ page: 3, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
      },
      integrity: { algorithm: 'sha256', expectedDigest: `SHA256:${expectedHex.toUpperCase()}` }
    })

    expect(opened).toMatchObject({
      ok: true,
      session: {
        selection: {
          kind: 'document',
          anchors: [{ id: 'source-anchor-1', page: 3, rects: [{ page: 3 }] }]
        }
      },
      file: { sha256: expectedHex },
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${expectedHex}`,
        actualDigest: `sha256:${expectedHex}`,
        verified: true
      }
    })

    await expect(host.open({
      workspaceRoot,
      path: 'evidence.pdf',
      integrity: { algorithm: 'sha256', expectedDigest: '0'.repeat(64) }
    })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('integrity mismatch')
    })
  })

  it('rejects paths outside the selected workspace', async () => {
    await writeFile(join(rootDir, 'outside.txt'), 'outside', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: '../outside.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('within the selected workspace')
  })

  it('rejects symlinked targets that leave the selected workspace', async () => {
    const outsidePath = join(rootDir, 'outside.txt')
    await writeFile(outsidePath, 'outside', 'utf8')
    await symlink(outsidePath, join(workspaceRoot, 'linked.txt'))
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: 'linked.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('within the selected workspace')
  })

  it('does not create observations for missing sessions', async () => {
    const host = new WorkspacePreviewHost()

    await expect(host.observe('missing')).resolves.toEqual({
      ok: false,
      message: 'Workspace preview session was not found.'
    })
  })

  it('releases opened sessions so later asset reads cannot reuse them', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nATOM\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-release' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(host.getSession(opened.session.id)?.id).toBe('session-release')
    expect(host.releaseSession(opened.session.id)).toBe(true)
    expect(host.getSession(opened.session.id)).toBeNull()
    expect(host.releaseSession(opened.session.id)).toBe(false)
    await expect(host.describeAsset(opened.session.id)).resolves.toEqual({
      ok: false,
      message: 'Workspace preview session was not found.'
    })
  })

  it('reads bounded byte ranges from an opened session without eager-loading the file', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nATOM\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-range' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.readRange(opened.session.id, { offset: 7, length: 4 })

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-range',
      assetId: 'asset:session-range',
      offset: 7,
      length: 4
    })
    if (result.ok) {
      expect(result).not.toHaveProperty('path')
      expect(Buffer.from(result.dataBase64, 'base64').toString('utf8')).toBe('ATOM')
    }
  })

  it('opens passive binary biology indexes for range transport', async () => {
    await writeFile(join(workspaceRoot, 'variants.vcf.gz.tbi'), Buffer.from([0x54, 0x42, 0x49, 0x01, 0x00, 0xff]))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-index' })

    const opened = await host.open({
      workspaceRoot,
      path: 'variants.vcf.gz.tbi',
      mode: 'inspect'
    })

    expect(opened).toMatchObject({
      ok: true,
      session: {
        id: 'session-index',
        pluginId: 'biology-index-transport',
        modality: 'unknown',
        mode: 'inspect'
      }
    })
    if (!opened.ok) return
    await expect(host.readRange(opened.session.id, { offset: 0, length: 4 })).resolves.toMatchObject({
      ok: true,
      length: 4
    })
  })

  it('describes lazy large-asset transport for life-science plugins', async () => {
    await writeFile(join(workspaceRoot, 'cells.ome.tiff'), Buffer.alloc(8 * 1024 * 1024))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-asset' })
    const opened = await host.open({
      workspaceRoot,
      path: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.describeAsset(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      descriptor: {
        sessionId: 'session-asset',
        assetId: 'asset:session-asset',
        pluginId: 'bioimaging',
        modality: 'bioimaging',
        file: {
          name: 'cells.ome.tiff',
          relativePath: 'cells.ome.tiff',
          mimeType: 'image/tiff',
          size: 8 * 1024 * 1024
        },
        primary: 'byte-range',
        eagerRead: {
          allowed: false
        },
        range: {
          available: true,
          maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
          recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
          size: 8 * 1024 * 1024
        },
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'byte-range', status: 'available' }),
          expect.objectContaining({ kind: 'object-url', status: 'requires-renderer' }),
          expect.objectContaining({ kind: 'tile', status: 'requires-plugin' }),
          expect.objectContaining({ kind: 'thumbnail', status: 'requires-plugin' }),
          expect.objectContaining({ kind: 'cache-artifact', status: 'deferred' })
        ])
      }
    })
    if (result.ok) {
      expect(result.descriptor.file).not.toHaveProperty('workspaceRoot')
      expect(result.descriptor.file).not.toHaveProperty('path')
    }
  })

  it('prepares session-scoped observation cache artifacts and invalidates stale reads', async () => {
    const filePath = join(workspaceRoot, 'cells.ome.tiff')
    await writeFile(filePath, Buffer.from('II*\0metadata'), 'binary')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-artifact' })
    const opened = await host.open({
      workspaceRoot,
      path: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'observation'
    }, '2026-07-08T00:05:00.000Z')

    expect(prepared).toMatchObject({
      ok: true,
      sessionId: 'session-artifact',
      artifact: {
        sessionId: 'session-artifact',
        assetId: 'asset:session-artifact',
        kind: 'cache-artifact',
        pluginId: 'bioimaging',
        mimeType: 'application/json',
        cache: {
          scope: 'session',
          source: 'observation',
          invalidation: 'source-size-mtime'
        }
      }
    })
    if (!prepared.ok) return
    expect(prepared.artifact).not.toHaveProperty('path')
    expect(prepared.artifact).not.toHaveProperty('workspaceRoot')
    expect(prepared.artifact).not.toHaveProperty('url')

    const described = await host.describeAsset(opened.session.id)
    expect(described).toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [expect.objectContaining({ artifactId: prepared.artifact.artifactId })],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'cache-artifact', status: 'available' })
        ])
      }
    })

    const artifactBytes = await host.readArtifactRange(opened.session.id, {
      artifactId: prepared.artifact.artifactId,
      range: { offset: 0, length: prepared.artifact.byteLength }
    })
    expect(artifactBytes).toMatchObject({
      ok: true,
      sessionId: 'session-artifact',
      assetId: 'asset:session-artifact',
      artifactId: prepared.artifact.artifactId,
      mimeType: 'application/json'
    })
    if (!artifactBytes.ok) return
    const payloadText = Buffer.from(artifactBytes.dataBase64, 'base64').toString('utf8')
    const payload = JSON.parse(payloadText) as {
      kind: string
      asset: Record<string, unknown>
      observation: Record<string, unknown>
    }
    expect(payload.kind).toBe('workspace-preview.observation-cache')
    expect(payload.asset).toMatchObject({
      name: 'cells.ome.tiff',
      relativePath: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(payload.asset).not.toHaveProperty('path')
    expect(payload.asset).not.toHaveProperty('workspaceRoot')
    expect(payload.observation).not.toHaveProperty('file')
    expect(payloadText).not.toContain('file://')
    expect(payloadText).not.toContain(workspaceRoot)

    await writeFile(filePath, Buffer.from('II*\0metadata-updated'), 'binary')
    await expect(host.readArtifactRange(opened.session.id, {
      artifactId: prepared.artifact.artifactId,
      range: { offset: 0, length: 8 }
    })).resolves.toEqual({
      ok: false,
      message: 'Workspace preview artifact is stale because the source file changed.'
    })
  })

  it('prepares metadata-only plugin cache artifacts for bioimaging previews', async () => {
    const rawBytes = Buffer.from('II*\0<OME><Image raw-secret="do-not-cache"><Pixels /></Image></OME>')
    await writeFile(join(workspaceRoot, 'cells.ome.tiff'), rawBytes)
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-bioimaging-metadata-artifact' })
    const opened = await host.open({
      workspaceRoot,
      path: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'plugin-metadata',
      metadataKind: 'bioimaging'
    }, '2026-07-08T00:07:00.000Z')

    expect(prepared).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-metadata-artifact',
      artifact: {
        sessionId: 'session-bioimaging-metadata-artifact',
        assetId: 'asset:session-bioimaging-metadata-artifact',
        kind: 'cache-artifact',
        pluginId: 'bioimaging',
        mimeType: 'application/vnd.sciforge.workspace-preview.bioimaging-metadata+json',
        cache: {
          scope: 'session',
          source: 'plugin-metadata',
          metadataKind: 'bioimaging',
          invalidation: 'source-size-mtime'
        }
      }
    })
    if (!prepared.ok) return

    const described = await host.describeAsset(opened.session.id)
    expect(described).toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [expect.objectContaining({ artifactId: prepared.artifact.artifactId })],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'cache-artifact', status: 'available' })
        ])
      }
    })

    const artifactBytes = await host.readArtifactRange(opened.session.id, {
      artifactId: prepared.artifact.artifactId,
      range: { offset: 0, length: prepared.artifact.byteLength }
    })
    expect(artifactBytes).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-metadata-artifact',
      assetId: 'asset:session-bioimaging-metadata-artifact',
      artifactId: prepared.artifact.artifactId,
      mimeType: 'application/vnd.sciforge.workspace-preview.bioimaging-metadata+json'
    })
    if (!artifactBytes.ok) return

    const payloadText = Buffer.from(artifactBytes.dataBase64, 'base64').toString('utf8')
    const payload = JSON.parse(payloadText) as {
      kind: string
      source: string
      metadataKind: string
      asset: Record<string, unknown>
      artifact: Record<string, unknown>
      metadata: Record<string, unknown>
    }
    expect(payload).toMatchObject({
      kind: 'workspace-preview.plugin-metadata-cache',
      source: 'plugin-metadata',
      metadataKind: 'bioimaging',
      asset: {
        name: 'cells.ome.tiff',
        relativePath: 'cells.ome.tiff',
        mimeType: 'image/tiff'
      },
      artifact: {
        metadataOnly: true,
        containsPixels: false
      },
      metadata: {
        byteLength: rawBytes.length
      }
    })
    expect(payload).not.toHaveProperty('bioimaging')
    expect(payload.asset).not.toHaveProperty('path')
    expect(payload.asset).not.toHaveProperty('workspaceRoot')
    expect(payloadText).not.toContain('raw-secret')
    expect(payloadText).not.toContain('<OME>')
    expect(payloadText).not.toContain('file://')
    expect(payloadText).not.toContain(workspaceRoot)
  })

  it('prepares session-scoped bioimaging tile artifacts through worker decoders', async () => {
    const bytes = createUncompressedRgbTiffBytes(4, 3, new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10
    ]))
    await writeFile(join(workspaceRoot, 'rgb-field.tif'), bytes)
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-bioimaging-tile' })
    const opened = await host.open({
      workspaceRoot,
      path: 'rgb-field.tif',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'tile',
      level: 0,
      x: 0,
      y: 0,
      width: 2,
      height: 2
    }, '2026-07-08T00:09:00.000Z')

    expect(prepared).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-tile',
      artifact: {
        sessionId: 'session-bioimaging-tile',
        assetId: 'asset:session-bioimaging-tile',
        kind: 'tile',
        pluginId: 'bioimaging',
        mimeType: 'image/png',
        cache: {
          scope: 'session',
          source: 'worker-decoder',
          invalidation: 'source-size-mtime'
        },
        tile: {
          level: 0,
          x: 0,
          y: 0,
          width: 2,
          height: 2
        }
      }
    })
    if (!prepared.ok) return
    expect(prepared.artifact).not.toHaveProperty('path')
    expect(prepared.artifact).not.toHaveProperty('workspaceRoot')
    expect(prepared.artifact).not.toHaveProperty('url')

    const described = await host.describeAsset(opened.session.id)
    expect(described).toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [expect.objectContaining({ artifactId: prepared.artifact.artifactId, kind: 'tile' })],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'tile', status: 'available' })
        ])
      }
    })

    const artifactBytes = await host.readArtifactRange(opened.session.id, {
      artifactId: prepared.artifact.artifactId,
      range: { offset: 0, length: prepared.artifact.byteLength }
    })
    expect(artifactBytes).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-tile',
      assetId: 'asset:session-bioimaging-tile',
      artifactId: prepared.artifact.artifactId,
      mimeType: 'image/png'
    })
    if (!artifactBytes.ok) return
    expect([...Buffer.from(artifactBytes.dataBase64, 'base64').subarray(0, 8)]).toEqual([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a
    ])
    expect(JSON.stringify(described)).not.toContain(workspaceRoot)
    expect(JSON.stringify(described)).not.toContain('file://')
  })

  it('prepares session-scoped bioimaging thumbnail artifacts through worker decoders', async () => {
    const bytes = createUncompressedRgbTiffBytes(4, 2, new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120
    ]))
    await writeFile(join(workspaceRoot, 'rgb-thumbnail.tif'), bytes)
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-bioimaging-thumbnail' })
    const opened = await host.open({
      workspaceRoot,
      path: 'rgb-thumbnail.tif',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'thumbnail',
      width: 2,
      height: 2
    }, '2026-07-08T00:10:00.000Z')

    expect(prepared).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-thumbnail',
      artifact: {
        sessionId: 'session-bioimaging-thumbnail',
        assetId: 'asset:session-bioimaging-thumbnail',
        kind: 'thumbnail',
        pluginId: 'bioimaging',
        mimeType: 'image/png',
        cache: {
          scope: 'session',
          source: 'worker-decoder',
          invalidation: 'source-size-mtime'
        },
        thumbnail: {
          width: 2,
          height: 1
        }
      }
    })
    if (!prepared.ok) return

    const described = await host.describeAsset(opened.session.id)
    expect(described).toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [expect.objectContaining({ artifactId: prepared.artifact.artifactId, kind: 'thumbnail' })],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'thumbnail', status: 'available' })
        ])
      }
    })

    const artifactBytes = await host.readArtifactRange(opened.session.id, {
      artifactId: prepared.artifact.artifactId,
      range: { offset: 0, length: prepared.artifact.byteLength }
    })
    expect(artifactBytes).toMatchObject({
      ok: true,
      sessionId: 'session-bioimaging-thumbnail',
      assetId: 'asset:session-bioimaging-thumbnail',
      artifactId: prepared.artifact.artifactId,
      mimeType: 'image/png'
    })
    if (!artifactBytes.ok) return
    expect([...Buffer.from(artifactBytes.dataBase64, 'base64').subarray(0, 8)]).toEqual([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a
    ])
    expect(JSON.stringify(described)).not.toContain(workspaceRoot)
    expect(JSON.stringify(described)).not.toContain('file://')
  })

  it('does not commit thumbnail artifacts when worker decoding fails', async () => {
    await writeFile(join(workspaceRoot, 'compressed.tif'), createCompressedTiffBytes(8, 8))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-bioimaging-thumbnail-fail' })
    const opened = await host.open({
      workspaceRoot,
      path: 'compressed.tif',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'thumbnail',
      width: 4,
      height: 4
    })

    expect(prepared).toMatchObject({
      ok: false,
      message: expect.stringContaining('Only uncompressed TIFF tiles are currently decoded')
    })
    await expect(host.describeAsset(opened.session.id)).resolves.toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'thumbnail', status: 'requires-plugin' })
        ])
      }
    })
  })

  it('rejects plugin metadata cache artifacts when a plugin has no metadata payload', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-no-plugin-metadata' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(host.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'plugin-metadata'
    }, '2026-07-08T00:08:00.000Z')).resolves.toEqual({
      ok: false,
      message: 'Workspace preview plugin "molecular" does not provide plugin-metadata cache artifacts.'
    })

    await expect(host.describeAsset(opened.session.id)).resolves.toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'cache-artifact', status: 'deferred' })
        ])
      }
    })
  })

  it('rejects unsafe plugin metadata cache payloads without committing artifacts', async () => {
    await writeFile(join(workspaceRoot, 'cells.ome.tiff'), Buffer.from('II*\0metadata'), 'binary')
    const workerClient = {
      observe: vi.fn(async () => ({
        ok: true as const,
        bytesRead: 12,
        truncated: false,
        observation: {
          schemaVersion: 1 as const,
          file: {
            path: join(workspaceRoot, 'cells.ome.tiff'),
            workspaceRoot,
            mimeType: 'image/tiff',
            size: 12
          },
          view: {
            pluginId: 'bioimaging',
            modality: 'bioimaging' as const,
            mode: 'preview' as const,
            title: 'cells.ome.tiff'
          },
          bioimaging: {
            format: 'ome-tiff'
          },
          pluginMetadata: [{
            source: 'plugin-metadata' as const,
            metadataKind: 'bioimaging',
            metadataOnly: true as const,
            containsPixels: false as const,
            data: {
              fileUrl: `file://${workspaceRoot}/cells.ome.tiff`
            }
          }],
          actions: ['observe']
        }
      })),
      invokeAction: vi.fn()
    } as unknown as WorkspacePreviewWorkerClient
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-unsafe-plugin-metadata',
      workerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(host.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'plugin-metadata',
      metadataKind: 'bioimaging'
    }, '2026-07-08T00:09:00.000Z')).resolves.toEqual({
      ok: false,
      message: 'Workspace preview plugin metadata contains unsafe key "fileUrl".'
    })

    await expect(host.describeAsset(opened.session.id)).resolves.toMatchObject({
      ok: true,
      descriptor: {
        artifacts: [],
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'cache-artifact', status: 'deferred' })
        ])
      }
    })
  })

  it('does not commit preview artifacts when artifact preparation exceeds the size guard', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const oversizedParagraphText = 'x'.repeat(200_000)
    const workerClient = {
      observe: vi.fn(async () => ({
        ok: true as const,
        observation: {
          schemaVersion: 1 as const,
          file: {
            path: join(workspaceRoot, 'protein.pdb'),
            workspaceRoot,
            size: 12
          },
          view: {
            pluginId: 'molecular',
            modality: 'molecular' as const,
            mode: 'preview' as const,
            title: 'protein.pdb'
          },
          document: {
            paragraphs: Array.from({ length: 7 }, (_, index) => ({
              id: `p-${index}`,
              index: index + 1,
              text: oversizedParagraphText
            }))
          },
          actions: ['observe']
        }
      })),
      invokeAction: vi.fn()
    } as unknown as WorkspacePreviewWorkerClient
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-artifact-rollback',
      workerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const prepared = await host.prepareArtifact(opened.session.id, {
      kind: 'cache-artifact',
      source: 'observation'
    }, '2026-07-08T00:06:00.000Z')

    expect(prepared).toMatchObject({
      ok: false,
      message: expect.stringContaining('artifact limit')
    })
    const described = await host.describeAsset(opened.session.id)
    expect(described).toMatchObject({
      ok: true,
      descriptor: {
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'cache-artifact', status: 'deferred' })
        ])
      }
    })
    if (described.ok) {
      expect(described.descriptor.artifacts ?? []).toEqual([])
    }
  })

  it('keeps generic fallback observations aligned with read-only life-science capabilities', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const workerClient = {
      observe: vi.fn(async () => ({
        ok: false,
        reason: 'worker-error',
        message: 'forced worker fallback'
      })),
      invokeAction: vi.fn()
    } as unknown as WorkspacePreviewWorkerClient
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-life-science-fallback',
      workerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'molecular', modality: 'molecular' },
        actions: expect.arrayContaining(['observe', 'select', 'export'])
      }
    })
    if (observed.ok) {
      expect(observed.observation.actions).not.toContain('applyEdit')
      expect(observed.observation.actions).not.toContain('save')
    }
  })

  it('rejects oversized range reads before touching the file', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-range' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.readRange(opened.session.id, {
      offset: 0,
      length: WORKSPACE_PREVIEW_MAX_RANGE_BYTES + 1
    })

    expect(result.ok).toBe(false)
  })

  it('reports deferred non-life-science scientific formats explicitly', async () => {
    await writeFile(join(workspaceRoot, 'mesh.vtk'), '# vtk data', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: 'mesh.vtk'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('deferred')
  })

  it('applies text range edits through the generic host with an audit trail', async () => {
    await writeFile(join(workspaceRoot, 'notes.md'), 'hello\nworld\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'notes.md',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'text.replaceRange',
      path: 'notes.md',
      range: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 6 }
      },
      text: 'SciForge'
    }, '2026-07-08T00:01:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'text.replaceRange',
      audit: {
        pluginId: 'markdown',
        effect: 'file-write'
      },
      diffSummary: {
        kind: 'bounded',
        operationKind: 'text.replaceRange',
        counts: {
          filesChanged: 1,
          charsInserted: 8,
          charsDeleted: 5
        },
        undo: {
          available: false
        }
      }
    })
    if (result.ok) {
      expect(result.diffSummary?.summary).toContain('Replaced text range')
      expect(result.diffSummary?.previews?.[0]).toMatchObject({
        before: 'world',
        after: 'SciForge'
      })
    }
    await expect(readFile(join(workspaceRoot, 'notes.md'), 'utf8')).resolves.toBe('hello\nSciForge\n')
  })

  it('observes first-party text previews with bounded visible text and edit actions', async () => {
    await writeFile(join(workspaceRoot, 'notes.txt'), 'alpha\nbeta\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-text' })
    const opened = await host.open({
      workspaceRoot,
      path: 'notes.txt',
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(opened).toMatchObject({
      ok: true,
      manifest: {
        id: 'text',
        modality: 'text'
      }
    })
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: {
          pluginId: 'text',
          modality: 'text'
        },
        visibleText: 'alpha\nbeta\n',
        text: {
          lineCount: 3,
          characterCount: 11,
          truncated: false
        },
        actions: expect.arrayContaining(['workspace.setSelection', 'text.replaceRange', 'applyEdit'])
      }
    })
  })

  it('observes source text extensions through the unified text preview plugin', async () => {
    const files = [
      ['notes.txt', 'plain text\n'],
      ['script.py', 'print("hello")\n'],
      ['.env', 'API_TOKEN=local\n']
    ] as const
    for (const [fileName, content] of files) {
      await writeFile(join(workspaceRoot, fileName), content, 'utf8')
    }

    let sessionIndex = 0
    const host = new WorkspacePreviewHost({ createSessionId: () => `session-source-text-${++sessionIndex}` })

    for (const [fileName, content] of files) {
      const opened = await host.open({
        workspaceRoot,
        path: fileName,
        now: '2026-07-08T00:00:00.000Z'
      })

      expect(opened).toMatchObject({
        ok: true,
        manifest: {
          id: 'text',
          modality: 'text'
        }
      })
      if (!opened.ok) continue

      await expect(host.observe(opened.session.id)).resolves.toMatchObject({
        ok: true,
        observation: {
          view: {
            pluginId: 'text',
            modality: 'text'
          },
          visibleText: content,
          actions: expect.arrayContaining(['text.replaceRange', 'applyEdit'])
        }
      })
    }
  })

  it('falls back to text only for unregistered files that sniff as UTF-8 text', async () => {
    await writeFile(join(workspaceRoot, 'settings.env.local'), 'API_TOKEN=local\n', 'utf8')
    await writeFile(join(workspaceRoot, 'opaque.custom'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await writeFile(join(workspaceRoot, 'opaque.txt'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-text-fallback' })

    const textOpened = await host.open({
      workspaceRoot,
      path: 'settings.env.local',
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(textOpened).toMatchObject({
      ok: true,
      route: 'fallback',
      manifest: {
        id: 'text',
        modality: 'text'
      }
    })
    if (textOpened.ok) {
      await expect(host.observe(textOpened.session.id)).resolves.toMatchObject({
        ok: true,
        observation: {
          visibleText: 'API_TOKEN=local\n'
        }
      })
    }

    await expect(host.open({
      workspaceRoot,
      path: 'opaque.custom'
    })).resolves.toEqual({
      ok: false,
      message: 'No workspace preview plugin is available for opaque.custom.'
    })

    await expect(host.open({
      workspaceRoot,
      path: 'opaque.txt'
    })).resolves.toEqual({
      ok: false,
      message: 'No workspace preview plugin is available for opaque.txt.'
    })
  })

  it('serves Markdown relative images through the unified host action without exposing file paths', async () => {
    await mkdir(join(workspaceRoot, 'docs'))
    await mkdir(join(workspaceRoot, 'docs', 'figures'))
    await writeFile(join(workspaceRoot, 'docs', 'notes.md'), '![Cell](figures/cell.png)\n', 'utf8')
    await writeFile(join(workspaceRoot, 'docs', 'figures', 'cell.png'), Buffer.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ]))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-markdown-image' })
    const opened = await host.open({
      workspaceRoot,
      path: 'docs/notes.md',
      mimeType: 'text/markdown'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'markdown', modality: 'document' },
        actions: expect.arrayContaining(['markdown.readImage', 'text.replaceRange'])
      }
    })

    const actionResult = await host.invokeAction(
      opened.session.id,
      { actionId: 'markdown.readImage', input: { path: join(workspaceRoot, 'docs', 'figures', 'cell.png') } },
      '2026-07-08T00:00:00.000Z'
    )
    expect(actionResult).toMatchObject({
      ok: true,
      sessionId: 'session-markdown-image',
      pluginId: 'markdown',
      actionId: 'markdown.readImage',
      audit: {
        effect: 'host-action'
      }
    })
    if (!actionResult.ok) return
    expect(actionResult.result).toMatchObject({
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
      size: 8
    })
    expect(actionResult.result).not.toHaveProperty('path')
    expect(JSON.stringify(actionResult.result)).not.toContain(workspaceRoot)
  })

  it('serves HTML preview URLs through the unified host action without exposing file paths in the action result', async () => {
    await mkdir(join(workspaceRoot, 'site'))
    await writeFile(
      join(workspaceRoot, 'site', 'report.html'),
      '<link rel="stylesheet" href="style.css"><h1>Ready</h1>',
      'utf8'
    )
    await writeFile(join(workspaceRoot, 'site', 'style.css'), 'body { color: rgb(1, 2, 3); }', 'utf8')
    htmlPreviewService = new WorkspaceHtmlPreviewService()
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-html',
      htmlPreviewService
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'site/report.html',
      mimeType: 'text/html'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'html', modality: 'document' },
        actions: expect.arrayContaining(['html.previewUrl', 'text.replaceRange'])
      }
    })

    const actionResult = await host.invokeAction(
      opened.session.id,
      { actionId: 'html.previewUrl', input: {} },
      '2026-07-08T00:00:00.000Z'
    )
    expect(actionResult).toMatchObject({
      ok: true,
      sessionId: 'session-html',
      pluginId: 'html',
      actionId: 'html.previewUrl',
      audit: {
        effect: 'host-action'
      }
    })
    if (!actionResult.ok) return
    expect(actionResult.result).toEqual({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/report\.html\?sciforge_preview=\d+$/),
      size: expect.any(Number),
      mtimeMs: expect.any(Number)
    })
    expect(actionResult.result).not.toHaveProperty('path')
    expect(actionResult.result).not.toHaveProperty('workspaceRoot')

    const previewUrl = (actionResult.result as { url: string }).url
    await expect(fetch(previewUrl).then(async (response) => ({
      status: response.status,
      text: await response.text()
    }))).resolves.toMatchObject({
      status: 200,
      text: expect.stringContaining('<h1>Ready</h1>')
    })
    await expect(fetch(new URL('style.css', previewUrl)).then(async (response) => ({
      status: response.status,
      text: await response.text()
    }))).resolves.toMatchObject({
      status: 200,
      text: expect.stringContaining('rgb(1, 2, 3)')
    })

    const saved = await host.applyEdit(opened.session.id, {
      kind: 'text.replaceRange',
      path: 'site/report.html',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 55 }
      },
      text: '<link rel="stylesheet" href="style.css"><h1>Updated</h1>'
    }, '2026-07-08T00:01:00.000Z')
    expect(saved).toMatchObject({
      ok: true,
      operationKind: 'text.replaceRange',
      audit: {
        pluginId: 'html',
        effect: 'file-write'
      }
    })

    const observedAfterSave = await host.observe(opened.session.id)
    expect(observedAfterSave).toMatchObject({
      ok: true,
      observation: {
        visibleText: expect.stringContaining('<h1>Updated</h1>'),
        actions: expect.arrayContaining(['html.previewUrl', 'text.replaceRange'])
      }
    })
    const refreshedPreview = await host.invokeAction(
      opened.session.id,
      { actionId: 'html.previewUrl', input: {} },
      '2026-07-08T00:01:30.000Z'
    )
    expect(refreshedPreview).toMatchObject({ ok: true })
    if (!refreshedPreview.ok) return
    await expect(fetch((refreshedPreview.result as { url: string }).url).then(async (response) => ({
      status: response.status,
      text: await response.text()
    }))).resolves.toMatchObject({
      status: 200,
      text: expect.stringContaining('<h1>Updated</h1>')
    })
  })

  it('observes DOCX paragraphs through the unified workspace preview contract', async () => {
    await writeFile(join(workspaceRoot, 'report.docx'), await createMinimalDocxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-docx-observe' })
    const opened = await host.open({
      workspaceRoot,
      path: 'report.docx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: {
          pluginId: 'docx',
          modality: 'document'
        },
        visibleText: expect.stringContaining('Study note'),
        outline: expect.arrayContaining([
          expect.objectContaining({
            id: 'docx-p-1',
            title: 'Study note',
            level: 1
          })
        ]),
        document: {
          paragraphs: expect.arrayContaining([
            expect.objectContaining({
              id: 'docx-p-1',
              index: 1,
              text: 'Study note',
              style: 'Heading1'
            }),
            expect.objectContaining({
              id: 'docx-p-2',
              index: 2,
              text: 'First paragraph with tab'
            })
          ]),
          truncatedParagraphs: false
        },
        actions: expect.arrayContaining([
          'document.updateParagraph',
          'applyEdit',
          'save'
        ])
      }
    })
  })

  it('applies DOCX paragraph edits through the document edit operation', async () => {
    await writeFile(join(workspaceRoot, 'report.docx'), await createMinimalDocxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-docx-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'report.docx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'document.updateParagraph',
      path: 'report.docx',
      paragraphIndex: 2,
      text: 'Updated paragraph\nwith line break'
    }, '2026-07-08T00:02:30.000Z')
    const zip = await JSZip.loadAsync(await readFile(join(workspaceRoot, 'report.docx')))
    const documentXml = await zip.file('word/document.xml')?.async('string')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'document.updateParagraph',
      audit: {
        pluginId: 'docx',
        effect: 'file-write'
      },
      diffSummary: {
        summary: 'Updated DOCX paragraph 2.',
        operationKind: 'document.updateParagraph',
        counts: {
          filesChanged: 1,
          charsInserted: 33,
          charsDeleted: 24
        },
        previews: [{
          before: 'First paragraph\twith tab',
          after: 'Updated paragraph\nwith line break'
        }]
      }
    })
    expect(documentXml).toContain('Updated paragraph')
    expect(documentXml).toContain('<w:br/>')
    expect(documentXml).toContain('with line break')
  })

  it('uses the canonical document annotation provider for list, update, delete, and import', async () => {
    const sourcePdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'
    await writeFile(join(workspaceRoot, 'paper.pdf'), sourcePdf, 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-pdf-annotation' })
    const opened = await host.open({
      workspaceRoot,
      path: 'paper.pdf',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const created = await host.updateAnnotation(opened.session.id, {
      annotationId: 'ann-1',
      annotationKind: 'comment',
      body: 'Check the stated assay result.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-1',
        anchor: {
          id: 'anchor-1',
          kind: 'text',
          quote: 'assay result',
          rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
        },
        thread: {
          status: 'open',
          title: 'Assay result'
        },
        annotation: {
          color: '#facc15',
          sourceText: 'assay result'
        }
      }
    }, '2026-07-08T00:03:00.000Z')
    const updated = await host.updateAnnotation(opened.session.id, {
      annotationId: 'ann-1',
      annotationKind: 'note',
      body: 'Updated assay note.'
    }, '2026-07-08T00:04:00.000Z')
    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'paper.pdf',
      workspaceRoot
    })
    const observed = await host.observe(opened.session.id)

    expect(created).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        pluginId: 'pdf',
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Created comment annotation ann-1.',
        counts: {
          filesChanged: 1,
          charsInserted: 30,
          charsDeleted: 0
        }
      }
    })
    expect(updated).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Updated note annotation ann-1.',
        counts: {
          filesChanged: 1,
          charsInserted: 19,
          charsDeleted: 30
        },
        previews: [{
          before: 'Check the stated assay result.',
          after: 'Updated assay note.'
        }]
      }
    })
    await expect(readFile(join(workspaceRoot, 'paper.pdf'), 'utf8')).resolves.toBe(sourcePdf)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.anchors).toHaveLength(1)
    expect(loaded.sidecar.anchors[0]).toMatchObject({
      id: 'anchor-1',
      kind: 'text',
      pageStart: 1,
      pageEnd: 1,
      quote: 'assay result'
    })
    expect(loaded.sidecar.annotations).toHaveLength(1)
    expect(loaded.sidecar.annotations[0]).toMatchObject({
      id: 'ann-1',
      threadId: 'thread-1',
      anchorId: 'anchor-1',
      kind: 'note',
      body: 'Updated assay note.',
      color: '#facc15',
      sourceText: 'assay result'
    })
    expect(loaded.sidecar.threads).toHaveLength(1)
    expect(loaded.sidecar.threads[0]).toMatchObject({
      id: 'thread-1',
      anchorIds: ['anchor-1'],
      annotationIds: ['ann-1'],
      title: 'Assay result'
    })
    const exported = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'sidecar'
    }, '2026-07-08T00:04:30.000Z')
    expect(exported).toMatchObject({
      ok: true,
      sessionId: 'session-pdf-annotation',
      audit: {
        pluginId: 'pdf',
        format: 'sidecar',
        effect: 'sidecar-package'
      }
    })
    if (exported.ok) {
      const zip = await JSZip.loadAsync(await readFile(exported.path))
      const annotationsJson = await zip.file('annotations.json')?.async('string')
      expect(annotationsJson).toContain('"id": "ann-1"')
      expect(annotationsJson).toContain('"body": "Updated assay note."')
    }
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        documentAnnotations: {
          threadCount: 1,
          annotationCount: 1,
          openThreadCount: 1,
          truncated: false,
          threads: [{
            id: 'thread-1',
            kind: 'comment',
            status: 'open',
            pageStart: 1,
            pageEnd: 1,
            annotationCount: 1,
            summary: 'open | page 1 | Assay result | Updated assay note.'
          }]
        }
      }
    })
    if (observed.ok) {
      const annotationPayload = JSON.stringify(observed.observation.documentAnnotations)
      expect(annotationPayload).not.toContain('rects')
      expect(annotationPayload).not.toContain('sha256')
      expect(annotationPayload).not.toContain('sourceMessageId')
      expect(observed.observation.actions.every((action) => !action.startsWith('annotation.'))).toBe(true)
    }

    const listed = await host.listAnnotations(opened.session.id)
    expect(listed).toMatchObject({
      ok: true,
      sidecar: {
        threads: [expect.objectContaining({ id: 'thread-1' })],
        annotations: [expect.objectContaining({ id: 'ann-1' })]
      }
    })
    if (listed.ok) {
      expect(JSON.stringify(listed)).not.toContain(workspaceRoot)
      expect(JSON.stringify(listed)).not.toContain('sourcePdfPath')
    }

    if (!exported.ok) return
    const deleted = await host.deleteAnnotation(opened.session.id, {
      threadId: 'thread-1',
      pruneOrphanAnchors: true
    }, '2026-07-08T00:05:00.000Z')
    expect(deleted).toMatchObject({
      ok: true,
      operationKind: 'annotation.thread.delete',
      audit: {
        effect: 'sidecar-write'
      }
    })

    const imported = await host.importAnnotations(opened.session.id, {
      packagePath: exported.path
    }, '2026-07-08T00:06:00.000Z')
    expect(imported).toMatchObject({
      ok: true,
      fingerprintMatched: true,
      sidecar: {
        threads: [expect.objectContaining({ id: 'thread-1' })],
        annotations: [expect.objectContaining({ id: 'ann-1', body: 'Updated assay note.' })]
      }
    })
    if (imported.ok) {
      expect(JSON.stringify(imported)).not.toContain(workspaceRoot)
      expect(JSON.stringify(imported)).not.toContain('sourcePdfPath')
    }

    const observedAfterImport = await host.observe(opened.session.id)
    expect(observedAfterImport).toMatchObject({
      ok: true,
      observation: {
        documentAnnotations: {
          threadCount: 1,
          annotationCount: 1,
          openThreadCount: 1
        }
      }
    })
  })

  it('updates and deletes annotation threads through generic sidecar edit operations', async () => {
    await writeFile(join(workspaceRoot, 'paper.pdf'), '%PDF-1.4\n%%EOF\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-pdf-thread' })
    const opened = await host.open({
      workspaceRoot,
      path: 'paper.pdf',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-thread',
      annotationKind: 'comment',
      body: 'Thread body',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-edit',
        anchor: {
          id: 'anchor-edit',
          kind: 'text',
          quote: 'target',
          rects: [{ page: 1, x: 0.2, y: 0.2, width: 0.2, height: 0.04 }]
        },
        thread: {
          status: 'open',
          title: 'Target'
        }
      }
    }, '2026-07-08T00:01:00.000Z')).resolves.toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert'
    })

    const updated = await host.applyEdit(opened.session.id, {
      kind: 'annotation.thread.update',
      path: 'paper.pdf',
      threadId: 'thread-edit',
      patch: {
        status: 'resolved',
        title: 'Resolved target'
      }
    }, '2026-07-08T00:02:00.000Z')
    expect(updated).toMatchObject({
      ok: true,
      operationKind: 'annotation.thread.update',
      audit: {
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Updated annotation thread thread-edit.',
        previews: [{
          before: 'open | Target',
          after: 'resolved | Resolved target'
        }]
      }
    })

    let loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'paper.pdf',
      workspaceRoot
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.threads[0]).toMatchObject({
      id: 'thread-edit',
      status: 'resolved',
      title: 'Resolved target'
    })

    const deleted = await host.applyEdit(opened.session.id, {
      kind: 'annotation.thread.delete',
      path: 'paper.pdf',
      threadId: 'thread-edit',
      pruneOrphanAnchors: true
    }, '2026-07-08T00:03:00.000Z')
    expect(deleted).toMatchObject({
      ok: true,
      operationKind: 'annotation.thread.delete',
      audit: {
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Deleted annotation thread thread-edit.'
      }
    })

    loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'paper.pdf',
      workspaceRoot
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.threads).toHaveLength(0)
    expect(loaded.sidecar.annotations).toHaveLength(0)
    expect(loaded.sidecar.anchors).toHaveLength(0)
    expect(loaded.sidecar.deletedThreads).toEqual([{
      threadId: 'thread-edit',
      annotationIds: ['ann-thread'],
      anchorIds: ['anchor-edit'],
      deletedAt: '2026-07-08T00:03:00.000Z',
      deletedVersion: 3
    }])

    const observed = await host.observe(opened.session.id)
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        documentAnnotations: {
          threadCount: 0,
          annotationCount: 0,
          openThreadCount: 0,
          threads: []
        }
      }
    })
    if (observed.ok) {
      expect(observed.observation.actions.every((action) => !action.startsWith('annotation.'))).toBe(true)
    }
  })

  it('updates annotation thread kind and side conversation linkage through annotation upsert', async () => {
    await writeFile(join(workspaceRoot, 'paper.pdf'), '%PDF-1.4\n%%EOF\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-pdf-question-link' })
    const opened = await host.open({
      workspaceRoot,
      path: 'paper.pdf',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-question',
      annotationKind: 'comment',
      body: 'Initial note.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-question',
        anchor: {
          id: 'anchor-question',
          kind: 'text',
          quote: 'result',
          rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
        },
        thread: {
          status: 'open',
          title: 'Initial note'
        }
      }
    }, '2026-07-08T00:00:30.000Z')

    const linked = await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-question',
      annotationKind: 'question',
      body: 'Why does this result change?',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-question',
        thread: {
          kind: 'question',
          status: 'open',
          title: 'Why does this result change?',
          sourceMessageId: 'side-thread-1'
        },
        annotation: {
          sourceText: 'result',
          sourceMessageId: 'side-thread-1:user-1'
        }
      }
    }, '2026-07-08T00:01:00.000Z')
    expect(linked).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        effect: 'sidecar-write'
      }
    })

    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'paper.pdf',
      workspaceRoot
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.threads[0]).toMatchObject({
      id: 'thread-question',
      kind: 'question',
      sourceMessageId: 'side-thread-1',
      title: 'Why does this result change?'
    })
    expect(loaded.sidecar.annotations[0]).toMatchObject({
      id: 'ann-question',
      kind: 'question',
      body: 'Why does this result change?',
      sourceMessageId: 'side-thread-1:user-1'
    })
  })

  it('exports PDF annotations as an annotated PDF through workspace preview export', async () => {
    await writeFile(join(workspaceRoot, 'paper.pdf'), await createBlankPdfBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-pdf-annotated-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'paper.pdf',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-export',
      annotationKind: 'comment',
      body: 'Export this PDF note.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-export',
        anchor: {
          id: 'anchor-export',
          kind: 'text',
          quote: 'export',
          rects: [{ page: 1, x: 0.2, y: 0.2, width: 0.2, height: 0.04 }]
        },
        thread: {
          status: 'open',
          title: 'Export note'
        }
      }
    }, '2026-07-08T00:01:00.000Z')).resolves.toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert'
    })

    const exported = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'annotated-pdf'
    }, '2026-07-08T00:02:00.000Z')

    expect(exported).toMatchObject({
      ok: true,
      sessionId: 'session-pdf-annotated-export',
      target: {
        format: 'annotated-pdf'
      },
      audit: {
        pluginId: 'pdf',
        format: 'annotated-pdf',
        effect: 'annotated-pdf'
      }
    })
    if (!exported.ok) return
    expect(exported.path.endsWith('paper.annotated.pdf')).toBe(true)
    const content = await readFile(exported.path, 'latin1')
    expect(content).toContain('/Subtype /Text')
  })

  it('upserts DOCX annotations with text anchors and no PDF rects', async () => {
    await writeFile(join(workspaceRoot, 'report.docx'), await createMinimalDocxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-docx-annotation' })
    const opened = await host.open({
      workspaceRoot,
      path: 'report.docx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'report.docx',
      annotationId: 'docx-ann-1',
      annotationKind: 'question',
      body: 'Clarify this paragraph.',
      target: {
        documentKind: 'docx',
        threadId: 'docx-thread-1',
        anchor: {
          id: 'docx-anchor-1',
          kind: 'text',
          quote: 'First paragraph with tab',
          contextBefore: 'Intro',
          contextAfter: 'Next paragraph'
        },
        thread: {
          title: 'Paragraph question'
        }
      }
    }, '2026-07-08T00:03:30.000Z')
    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'report.docx',
      workspaceRoot
    })
    const observed = await host.observe(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        pluginId: 'docx',
        effect: 'sidecar-write'
      }
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.anchors).toHaveLength(1)
    expect(loaded.sidecar.anchors[0]).toMatchObject({
      id: 'docx-anchor-1',
      kind: 'text',
      rects: [],
      quote: 'First paragraph with tab',
      contextBefore: 'Intro',
      contextAfter: 'Next paragraph'
    })
    expect(loaded.sidecar.annotations).toEqual([
      expect.objectContaining({
        id: 'docx-ann-1',
        threadId: 'docx-thread-1',
        anchorId: 'docx-anchor-1',
        kind: 'question',
        body: 'Clarify this paragraph.',
        sourceText: 'First paragraph with tab'
      })
    ])
    expect(loaded.sidecar.threads).toEqual([
      expect.objectContaining({
        id: 'docx-thread-1',
        kind: 'question',
        anchorIds: ['docx-anchor-1'],
        annotationIds: ['docx-ann-1'],
        title: 'Paragraph question'
      })
    ])
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        documentAnnotations: {
          threadCount: 1,
          annotationCount: 1,
          openThreadCount: 1,
          threads: [{
            id: 'docx-thread-1',
            kind: 'question',
            status: 'open',
            pageStart: 1,
            pageEnd: 1,
            annotationCount: 1,
            summary: 'open | page 1 | Paragraph question | Clarify this paragraph.'
          }]
        }
      }
    })
  })

  it('applies CSV cell edits through the tabular plugin with safe write-back', async () => {
    await writeFile(join(workspaceRoot, 'samples.csv'), 'sample,count,note\ns1,2,old\ns2,3,ok\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'samples.csv',
      mimeType: 'text/csv',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.updateCell',
      path: 'samples.csv',
      row: 0,
      column: 2,
      value: 'alpha, "quoted"'
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.updateCell',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        summary: 'Updated cell R0C2.',
        counts: {
          filesChanged: 1,
          cellsChanged: 1
        },
        target: {
          tabular: {
            cells: [{ row: 0, column: 2 }]
          }
        },
        undo: {
          available: false
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'samples.csv'), 'utf8'))
      .resolves.toBe('sample,count,note\ns1,2,"alpha, ""quoted"""\ns2,3,ok\n')
  })

  it('applies TSV row inserts relative to data rows through the tabular plugin', async () => {
    await writeFile(join(workspaceRoot, 'samples.tsv'), 'sample\tcount\ns1\t2\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-tsv-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'samples.tsv',
      mimeType: 'text/tab-separated-values'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertRows',
      path: 'samples.tsv',
      afterRow: -1,
      rows: [['s0', 1]]
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.insertRows',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      }
    })
    await expect(readFile(join(workspaceRoot, 'samples.tsv'), 'utf8'))
      .resolves.toBe('sample\tcount\ns0\t1\ns1\t2\n')
  })

  it('applies CSV column inserts across headers and data rows through the tabular plugin', async () => {
    await writeFile(join(workspaceRoot, 'insert-columns.csv'), 'sample,count\ns1,2\ns2\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-column-insert' })
    const opened = await host.open({
      workspaceRoot,
      path: 'insert-columns.csv',
      mimeType: 'text/csv'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertColumns',
      path: 'insert-columns.csv',
      afterColumn: -1,
      columns: [
        ['group', 'control, A'],
        ['note', '"quoted"']
      ]
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.insertColumns',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          columnsInserted: 2
        },
        target: {
          tabular: {
            columns: [0, 1]
          }
        },
        undo: {
          available: false
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'insert-columns.csv'), 'utf8'))
      .resolves.toBe('group,note,sample,count\n"control, A","""quoted""",s1,2\n,,s2,\n')
  })

  it('applies CSV row and column deletes through the tabular plugin with header-aware write-back', async () => {
    await writeFile(join(workspaceRoot, 'delete-me.csv'), 'sample,count,note\ns1,2,old\ns2,3,ok\ns3,4,done\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-delete' })
    const opened = await host.open({
      workspaceRoot,
      path: 'delete-me.csv',
      mimeType: 'text/csv'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const rowResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.deleteRows',
      path: 'delete-me.csv',
      rows: [1]
    })
    const columnResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.deleteColumns',
      path: 'delete-me.csv',
      columns: [1]
    })

    expect(rowResult).toMatchObject({
      ok: true,
      operationKind: 'tabular.deleteRows',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          rowsDeleted: 1
        },
        target: {
          tabular: {
            rows: [1]
          }
        }
      }
    })
    expect(columnResult).toMatchObject({
      ok: true,
      operationKind: 'tabular.deleteColumns',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          columnsDeleted: 1
        },
        target: {
          tabular: {
            columns: [1]
          }
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'delete-me.csv'), 'utf8'))
      .resolves.toBe('sample,note\ns1,old\ns3,done\n')
  })

  it('rejects tabular write-back for formats without a safe delimited serializer', async () => {
    await writeFile(join(workspaceRoot, 'records.jsonl'), '{"sample":"s1","count":2}\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-jsonl-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'records.jsonl',
      mimeType: 'application/x-ndjson'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed.ok).toBe(true)
    if (observed.ok) {
      expect(observed.observation.actions).toContain('tabular.filterRows')
      expect(observed.observation.actions).not.toContain('applyEdit')
      expect(observed.observation.actions).not.toContain('save')
      expect(observed.observation.actions).not.toContain('tabular.updateCell')
      expect(observed.observation.actions).not.toContain('tabular.insertColumns')
    }

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.updateCell',
      path: 'records.jsonl',
      row: 0,
      column: 1,
      value: 3
    })
    const insertResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertColumns',
      path: 'records.jsonl',
      afterColumn: -1,
      columns: [['group', 'control']]
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('CSV and TSV')
    expect(insertResult.ok).toBe(false)
    if (!insertResult.ok) expect(insertResult.message).toContain('CSV and TSV')
    await expect(readFile(join(workspaceRoot, 'records.jsonl'), 'utf8'))
      .resolves.toBe('{"sample":"s1","count":2}\n')
  })

  it('updates session selection for molecular selection edits', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-mol' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'molecular.setSelection',
      path: 'protein.pdb',
      selection: {
        kind: 'molecular',
        chains: ['A'],
        residues: [{ chain: 'A', index: 42, name: 'TYR' }]
      }
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'molecular.setSelection',
      audit: { effect: 'session-update' }
    })
    expect(host.getSession(opened.session.id)?.selection).toMatchObject({
      kind: 'molecular',
      chains: ['A']
    })
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: {
        selection: {
          kind: 'molecular',
          chains: ['A']
        }
      }
    })
  })

  it('updates and observes generic structured selections for life-science plugins', async () => {
    await writeFile(join(workspaceRoot, 'variants.vcf'), '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t42\t.\tA\tG\t.\tPASS\t.\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-sequence' })
    const opened = await host.open({
      workspaceRoot,
      path: 'variants.vcf'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'workspace.setSelection',
      path: 'variants.vcf',
      selection: {
        kind: 'sequence',
        sequenceId: 'chr1',
        ranges: [{ start: 42, end: 43 }],
        features: [{ type: 'variant', start: 42, end: 43 }]
      }
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'workspace.setSelection',
      audit: { effect: 'session-update' }
    })
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: {
        selection: {
          kind: 'sequence',
          sequenceId: 'chr1'
        }
      }
    })
  })

  it('overlays session selection onto worker observations at the host boundary', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const workerClient = {
      observe: vi.fn<WorkspacePreviewWorkerClient['observe']>(async ({ session, manifest, file }) => ({
        ok: true,
        observation: {
          schemaVersion: 1,
          file: {
            path: file.path,
            workspaceRoot: file.workspaceRoot,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            ...(file.size !== undefined ? { size: file.size } : {}),
            ...(file.mtimeMs !== undefined ? { mtimeMs: file.mtimeMs } : {})
          },
          view: {
            pluginId: manifest.id,
            modality: manifest.modality,
            mode: session.mode,
            title: 'protein.pdb'
          },
          molecular: {
            chains: ['B']
          },
          actions: ['molecular.workbench']
        },
        bytesRead: 0,
        truncated: false
      })),
      invokeAction: vi.fn<WorkspacePreviewWorkerClient['invokeAction']>()
    } as Pick<WorkspacePreviewWorkerClient, 'observe' | 'invokeAction'>
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-molecular-overlay',
      workerClient: workerClient as WorkspacePreviewWorkerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const selection = {
      kind: 'molecular' as const,
      chains: ['A']
    }
    const applied = await host.applyEdit(opened.session.id, {
      kind: 'workspace.setSelection',
      path: 'protein.pdb',
      selection
    })
    expect(applied.ok).toBe(true)

    const observed = await host.observe(opened.session.id)

    expect(workerClient.observe).toHaveBeenCalledTimes(1)
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        molecular: {
          chains: ['B']
        },
        selection
      }
    })
  })

  it('invokes bounded worker actions with audit metadata', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), [
      'ATOM      1  N   MET A   1      11.104  13.207   9.447  1.00 20.00           N',
      'ATOM      2  CA  MET A   1      12.560  13.401   9.447  1.00 20.00           C',
      'END'
    ].join('\n'), 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-action' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.invokeAction(opened.session.id, {
      actionId: 'molecular.workbench',
      input: {
        selection: {
          chains: ['A']
        }
      }
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-action',
      pluginId: 'molecular',
      actionId: 'molecular.workbench',
      invokedAt: '2026-07-08T00:02:00.000Z',
      result: {
        ok: true,
        atomCount: 2,
        state: {
          selection: {
            kind: 'molecular',
            chains: ['A']
          }
        }
      },
      audit: {
        pluginId: 'molecular',
        actionId: 'molecular.workbench',
        effect: 'worker-action'
      }
    })

    const measurementResult = await host.invokeAction(opened.session.id, {
      actionId: 'molecular.workbench',
      input: {
        measurement: {
          kind: 'distance',
          atoms: [{ id: '1' }, { index: 2 }]
        }
      }
    }, '2026-07-08T00:03:00.000Z')

    expect(measurementResult).toMatchObject({
      ok: true,
      sessionId: 'session-action',
      pluginId: 'molecular',
      actionId: 'molecular.workbench',
      invokedAt: '2026-07-08T00:03:00.000Z',
      result: {
        ok: true,
        state: {
          measurement: {
            kind: 'distance',
            coordinateAvailable: true,
            unit: 'angstrom',
            selection: {
              kind: 'molecular',
              atoms: [{ id: '1', index: 1 }, { id: '2', index: 2 }]
            }
          }
        }
      },
      audit: {
        pluginId: 'molecular',
        actionId: 'molecular.workbench',
        effect: 'worker-action'
      }
    })
    expect((measurementResult as { result?: { state?: { measurement?: { value?: number } } } }).result?.state?.measurement?.value)
      .toBeCloseTo(1.4689, 3)
  })

  it('observes sequence files through first-party worker summaries', async () => {
    await writeFile(join(workspaceRoot, 'reads.fasta'), '>seq1\nACGT\n>seq2\nACGA\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-seq' })
    const opened = await host.open({
      workspaceRoot,
      path: 'reads.fasta'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'sequence-genomics', modality: 'sequence' },
        sequence: {
          sequenceCount: 2,
          totalLength: 8,
          alphabet: 'dna'
        },
        visibleText: expect.stringContaining('Sequences or references: 2')
      }
    })
  })

  it('falls back to generic observation when a worker cannot safely summarize a format', async () => {
    await writeFile(join(workspaceRoot, 'large.pptx'), Buffer.alloc(4 * 1024 * 1024 + 8))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck' })
    const opened = await host.open({
      workspaceRoot,
      path: 'large.pptx'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'deck', modality: 'deck' },
        actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save', 'export'])
      }
    })
    if (observed.ok) {
      expect(observed.observation.slides).toBeUndefined()
    }
  })

  it('applies PPTX deck text element edits and re-observes the updated file', async () => {
    await writeFile(join(workspaceRoot, 'talk.pptx'), await createMinimalPptxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'talk.pptx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed.ok).toBe(true)
    if (!observed.ok) return
    const target = observed.observation.deck?.textElements?.find((element) =>
      element.slideId === 'slide1' &&
      element.kind === 'body' &&
      element.text === 'Assay response increased after treatment.'
    )
    expect(target).toBeTruthy()
    if (!target) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'deck.updateTextElement',
      path: 'talk.pptx',
      slideId: target.slideId,
      elementId: target.elementId,
      text: 'Assay response remained stable after washout.'
    }, '2026-07-08T00:04:00.000Z')
    const nextObserved = await host.observe(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'deck.updateTextElement',
      audit: {
        pluginId: 'deck',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          charsInserted: 45,
          charsDeleted: 41
        },
        previews: [{
          before: 'Assay response increased after treatment.',
          after: 'Assay response remained stable after washout.'
        }]
      }
    })
    expect(nextObserved).toMatchObject({
      ok: true,
      observation: {
        deck: {
          textElements: expect.arrayContaining([
            expect.objectContaining({
              slideId: target.slideId,
              elementId: target.elementId,
              text: 'Assay response remained stable after washout.'
            })
          ])
        }
      }
    })
  })

  it('exports PPTX deck source copies and rejects renderer-only deck conversions', async () => {
    await writeFile(join(workspaceRoot, 'talk.pptx'), await createMinimalPptxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'talk.pptx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const pptxCopy = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pptx'
    }, '2026-07-08T00:05:00.000Z')
    const pdfConversion = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdf',
      path: 'talk.pdf'
    }, '2026-07-08T00:06:00.000Z')

    expect(pptxCopy).toMatchObject({
      ok: true,
      sessionId: 'session-deck-export',
      audit: {
        pluginId: 'deck',
        targetKind: 'workspace-file',
        format: 'pptx',
        effect: 'source-copy'
      }
    })
    if (pptxCopy.ok) {
      expect(pptxCopy.path.endsWith('/talk.export.pptx')).toBe(true)
      const copiedObservation = await host.open({
        workspaceRoot,
        path: 'talk.export.pptx'
      })
      expect(copiedObservation.ok).toBe(true)
    }
    expect(pdfConversion.ok).toBe(false)
    if (!pdfConversion.ok) expect(pdfConversion.message).toContain('does not declare pdf export support')
  })

  it('exports declared source formats to a workspace file with an audit trail', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb',
      path: 'exports/protein-copy.pdb'
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-export',
      audit: {
        pluginId: 'molecular',
        targetKind: 'workspace-file',
        format: 'pdb',
        effect: 'source-copy'
      }
    })
    await expect(readFile(join(workspaceRoot, 'exports/protein-copy.pdb'), 'utf8')).resolves.toBe('HEADER\nEND\n')

    const defaultResult = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb'
    }, '2026-07-08T00:03:00.000Z')
    const conflictResult = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb'
    }, '2026-07-08T00:04:00.000Z')

    expect(defaultResult).toMatchObject({
      ok: true,
      target: {
        kind: 'workspace-file',
        format: 'pdb'
      }
    })
    expect(conflictResult).toMatchObject({
      ok: true
    })
    if (defaultResult.ok) {
      expect(defaultResult.path.endsWith('/protein.export.pdb')).toBe(true)
      await expect(readFile(defaultResult.path, 'utf8')).resolves.toBe('HEADER\nEND\n')
    }
    if (conflictResult.ok) {
      expect(conflictResult.path.endsWith('/protein.export-2.pdb')).toBe(true)
      await expect(readFile(conflictResult.path, 'utf8')).resolves.toBe('HEADER\nEND\n')
    }
  })

  it('rejects undeclared export formats and renderer-only export targets', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const unsupportedFormat = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'xlsx',
      path: 'exports/protein.xlsx'
    })
    const clipboardTarget = await host.exportPreview(opened.session.id, {
      kind: 'clipboard',
      format: 'pdb'
    })
    const conversionTarget = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'cif',
      path: 'exports/protein.cif'
    })

    expect(unsupportedFormat.ok).toBe(false)
    if (!unsupportedFormat.ok) expect(unsupportedFormat.message).toContain('does not declare')
    expect(clipboardTarget.ok).toBe(false)
    if (!clipboardTarget.ok) expect(clipboardTarget.message).toContain('requires a renderer/plugin implementation')
    expect(conversionTarget.ok).toBe(false)
    if (!conversionTarget.ok) expect(conversionTarget.message).toContain('requires a plugin implementation')
  })

  it('prepares preview file watches from safe file state without eager content payloads', async () => {
    await writeFile(join(workspaceRoot, 'samples.csv'), 'sample,count\ns1,2\n', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.prepareWatch({
      workspaceRoot,
      path: 'samples.csv'
    }, '2026-07-08T00:03:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      content: '',
      size: 18,
      truncated: false,
      startedAt: '2026-07-08T00:03:00.000Z'
    })
    if (result.ok) {
      expect(result.path.endsWith('samples.csv')).toBe(true)
      expect(result.workspaceRoot.endsWith('workspace')).toBe(true)
      expect(result.mtimeMs).toBeGreaterThan(0)
    }
  })

  it('rejects edit operations for a different file than the open session', async () => {
    await writeFile(join(workspaceRoot, 'a.md'), 'a\n', 'utf8')
    await writeFile(join(workspaceRoot, 'b.md'), 'b\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'a.md'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'text.replaceRange',
      path: 'b.md',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 }
      },
      text: 'edited'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('must match')
  })
})

async function createMinimalDocxBytes(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>'
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>'
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Study note</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>First paragraph</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>with tab</w:t></w:r></w:p>',
    '</w:body>',
    '</w:document>'
  ].join(''))
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function createBlankPdfBytes(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800])
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
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

function createCompressedTiffBytes(width: number, height: number): Uint8Array {
  const entryCount = 6
  const ifdOffset = 8
  const ifdByteLength = 2 + entryCount * 12 + 4
  const pixelOffset = ifdOffset + ifdByteLength
  const bytes = Buffer.alloc(pixelOffset)

  bytes.write('II', 0, 'ascii')
  bytes.writeUInt16LE(42, 2)
  bytes.writeUInt32LE(ifdOffset, 4)
  bytes.writeUInt16LE(entryCount, ifdOffset)
  writeTiffEntry(bytes, ifdOffset, 0, 256, 4, 1, width)
  writeTiffEntry(bytes, ifdOffset, 1, 257, 4, 1, height)
  writeTiffEntry(bytes, ifdOffset, 2, 258, 3, 1, 8)
  writeTiffEntry(bytes, ifdOffset, 3, 259, 3, 1, 7)
  writeTiffEntry(bytes, ifdOffset, 4, 262, 3, 1, 1)
  writeTiffEntry(bytes, ifdOffset, 5, 273, 4, 1, pixelOffset)
  bytes.writeUInt32LE(0, ifdOffset + 2 + entryCount * 12)
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

async function createMinimalPptxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`)
  zip.file('ppt/slides/slide1.xml', slideXml('Results', 'Assay response increased after treatment.'))
  zip.file('ppt/slides/slide2.xml', slideXml('Methods', 'Cells were profiled with a compact panel.'))
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`)
  zip.file('ppt/notesSlides/notesSlide1.xml', notesXml('Mention replicated wells and follow-up validation.'))
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

function slideXml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="1" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function notesXml(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${notes}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
}
