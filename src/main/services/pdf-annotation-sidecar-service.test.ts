import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyPdfAnnotationSidecar, createPdfAnchor } from '../../shared/pdf-annotations'
import {
  exportPdfAnnotationAdobePdf,
  exportPdfAnnotationSidecarPackage,
  importPdfAnnotationSidecarPackage,
  loadPdfAnnotationSidecar,
  migrateLegacyPdfAnnotationSidecar,
  savePdfAnnotationSidecar
} from './pdf-annotation-sidecar-service'

const tempDirs: string[] = []

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-pdf-annotations-'))
  tempDirs.push(dir)
  return dir
}

async function writeBlankPdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800])
  await writeFile(path, Buffer.from(await pdf.save({ useObjectStreams: false })))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pdf annotation sidecar service', () => {
  it('loads an empty default sidecar and saves stable JSON under .sciforge', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfake\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot, pageCount: 3 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.source).toBe('empty')
    expect(loaded.path).toContain('.sciforge/pdf-annotations/')
    expect(loaded.sidecar.pdfFingerprint.pageCount).toBe(3)

    const saved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: loaded.sidecar })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.sidecar.version).toBe(1)

    const content = await readFile(saved.path, 'utf8')
    expect(content).toContain('"schemaVersion": 1')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('rejects default sidecar writes through symlinked metadata directories outside the workspace', async () => {
    const workspaceRoot = await createTempWorkspace()
    const outsideRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfake\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot, pageCount: 3 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    await mkdir(outsideRoot, { recursive: true })
    await symlink(outsideRoot, join(workspaceRoot, '.sciforge'), 'dir')

    const saved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: loaded.sidecar })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.message).toContain('within the selected workspace')
    }
    await expect(readdir(outsideRoot)).resolves.toEqual([])
  })

  it('keeps the same annotation sidecar when the PDF fingerprint changes', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfirst-build\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const now = '2026-07-04T00:00:00.000Z'
    const anchor = createPdfAnchor({
      id: 'anchor-1',
      rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      quote: 'old build quote',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })
    const saved = await savePdfAnnotationSidecar({
      pdfPath,
      workspaceRoot,
      sidecar: {
        ...loaded.sidecar,
        anchors: [anchor],
        annotations: [{
          id: 'annotation-1',
          threadId: 'thread-1',
          anchorId: 'anchor-1',
          kind: 'comment',
          body: 'keep this comment after rebuild',
          createdAt: now,
          updatedAt: now
        }],
        threads: [{
          id: 'thread-1',
          kind: 'comment',
          anchorIds: ['anchor-1'],
          annotationIds: ['annotation-1'],
          status: 'open',
          title: 'Persisted comment',
          createdAt: now,
          updatedAt: now
        }],
        updatedAt: now,
        manifest: {
          ...loaded.sidecar.manifest,
          updatedAt: now
        }
      }
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const firstSidecarPath = saved.path

    await writeFile(pdfPath, '%PDF-1.7\nsecond-build\n', 'utf8')
    const rebuiltPdf = await readFile(pdfPath)
    const rebuiltInfo = await stat(pdfPath)
    const rebuiltSha256 = createHash('sha256').update(rebuiltPdf).digest('hex')
    const rebuiltSidecar = createEmptyPdfAnnotationSidecar({
      sha256: rebuiltSha256,
      size: rebuiltInfo.size,
      mtimeMs: rebuiltInfo.mtimeMs,
      fileName: 'paper.pdf'
    }, {
      sourcePdfName: 'paper.pdf',
      sourcePdfPath: pdfPath
    })
    await writeFile(
      join(workspaceRoot, '.sciforge/pdf-annotations', `${rebuiltSha256}.json`),
      `${JSON.stringify(rebuiltSidecar, null, 2)}\n`,
      'utf8'
    )

    const reloaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.source).toBe('default')
    expect(reloaded.path).toBe(firstSidecarPath)
    expect(reloaded.pdfFingerprint.sha256).not.toBe(loaded.pdfFingerprint.sha256)
    expect(reloaded.sidecar.annotations[0]?.body).toBe('keep this comment after rebuild')
    expect(reloaded.sidecar.manifest.sourcePdfPath?.endsWith('/paper.pdf')).toBe(true)
  })

  it('loads only the canonical path and migrates a matching legacy sidecar explicitly', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfirst-build\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const now = '2026-07-04T00:00:00.000Z'
    const anchor = createPdfAnchor({
      id: 'anchor-1',
      rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      quote: 'old build quote',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })
    const existingSidecar = {
      ...loaded.sidecar,
      anchors: [anchor],
      annotations: [{
        id: 'annotation-1',
        threadId: 'thread-1',
        anchorId: 'anchor-1',
        kind: 'comment' as const,
        body: 'promote this comment',
        createdAt: now,
        updatedAt: now
      }],
      threads: [{
        id: 'thread-1',
        kind: 'comment' as const,
        anchorIds: ['anchor-1'],
        annotationIds: ['annotation-1'],
        status: 'open' as const,
        title: 'Persisted comment',
        createdAt: now,
        updatedAt: now
      }],
      updatedAt: now,
      manifest: {
        ...loaded.sidecar.manifest,
        updatedAt: now
      }
    }
    await mkdir(join(workspaceRoot, '.sciforge/pdf-annotations'), { recursive: true })
    const existingPath = join(workspaceRoot, '.sciforge/pdf-annotations', `${loaded.pdfFingerprint.sha256}.json`)
    await writeFile(existingPath, `${JSON.stringify(existingSidecar, null, 2)}\n`, 'utf8')

    const reloaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.source).toBe('empty')
    expect(reloaded.path).not.toBe(existingPath)
    expect(reloaded.sidecar.annotations).toEqual([])

    const migrated = await migrateLegacyPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.path).toBe(reloaded.path)
    expect(migrated.sidecar.annotations[0]?.body).toBe('promote this comment')
    await expect(readFile(migrated.path, 'utf8')).resolves.toContain('promote this comment')
  })

  it('does not scan a populated legacy sidecar when the canonical file is empty', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfirst-build\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const emptySaved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: loaded.sidecar })
    expect(emptySaved.ok).toBe(true)
    if (!emptySaved.ok) return

    const now = '2026-07-04T00:00:00.000Z'
    const anchor = createPdfAnchor({
      id: 'anchor-promoted',
      rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      quote: 'promoted quote',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })
    const legacySidecar = {
      ...loaded.sidecar,
      anchors: [anchor],
      annotations: [{
        id: 'annotation-promoted',
        threadId: 'thread-promoted',
        anchorId: anchor.id,
        kind: 'comment' as const,
        body: 'promote from legacy content hash file',
        createdAt: now,
        updatedAt: now
      }],
      threads: [{
        id: 'thread-promoted',
        kind: 'comment' as const,
        anchorIds: [anchor.id],
        annotationIds: ['annotation-promoted'],
        status: 'open' as const,
        createdAt: now,
        updatedAt: now
      }],
      updatedAt: now,
      manifest: { ...loaded.sidecar.manifest, updatedAt: now }
    }
    const legacyPath = join(workspaceRoot, '.sciforge/pdf-annotations', `${loaded.pdfFingerprint.sha256}.json`)
    await writeFile(legacyPath, `${JSON.stringify(legacySidecar, null, 2)}\n`, 'utf8')

    const reloaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.path).toBe(emptySaved.path)
    expect(reloaded.sidecar.threads).toEqual([])

    const migrated = await migrateLegacyPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.path).toBe(emptySaved.path)
    expect(migrated.sidecar.threads.map((thread) => thread.id)).toEqual(['thread-promoted'])
  })

  it('serializes concurrent saves and preserves additions from both snapshots', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nconcurrent\n', 'utf8')
    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const now = '2026-07-04T00:00:00.000Z'
    const sidecarWithThread = (suffix: string) => ({
      ...loaded.sidecar,
      annotations: [{
        id: `annotation-${suffix}`,
        threadId: `thread-${suffix}`,
        anchorId: `anchor-${suffix}`,
        kind: 'comment' as const,
        body: suffix,
        createdAt: now,
        updatedAt: now
      }],
      anchors: [createPdfAnchor({
        id: `anchor-${suffix}`,
        rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
        quote: suffix,
        pdfFingerprint: loaded.pdfFingerprint,
        createdAt: now,
        updatedAt: now
      })],
      threads: [{
        id: `thread-${suffix}`,
        kind: 'comment' as const,
        anchorIds: [`anchor-${suffix}`],
        annotationIds: [`annotation-${suffix}`],
        status: 'open' as const,
        createdAt: now,
        updatedAt: now
      }],
      updatedAt: now,
      manifest: { ...loaded.sidecar.manifest, updatedAt: now }
    })

    const saved = await Promise.all([
      savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: sidecarWithThread('a') }),
      savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: sidecarWithThread('b') })
    ])
    if (!saved[0].ok) throw new Error(saved[0].message)
    if (!saved[1].ok) throw new Error(saved[1].message)
    expect(saved).toMatchObject([{ ok: true }, { ok: true }])

    const reloaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.sidecar.threads.map((thread) => thread.id).sort()).toEqual(['thread-a', 'thread-b'])
  })

  it('does not resurrect a tombstoned thread from a stale save', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\ndelete\n', 'utf8')
    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const now = '2026-07-04T00:00:00.000Z'
    const staleAnchor = createPdfAnchor({
      id: 'anchor-deleted',
      rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      quote: 'deleted quote',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })
    const staleSidecar = {
      ...loaded.sidecar,
      anchors: [staleAnchor],
      annotations: [{
        id: 'annotation-deleted',
        threadId: 'thread-deleted',
        anchorId: staleAnchor.id,
        kind: 'comment' as const,
        body: 'must stay deleted',
        createdAt: now,
        updatedAt: now
      }],
      threads: [{
        id: 'thread-deleted',
        kind: 'comment' as const,
        anchorIds: [staleAnchor.id],
        annotationIds: ['annotation-deleted'],
        status: 'open' as const,
        createdAt: now,
        updatedAt: now
      }],
      updatedAt: now,
      manifest: { ...loaded.sidecar.manifest, updatedAt: now }
    }
    const deleted = await savePdfAnnotationSidecar({
      pdfPath,
      workspaceRoot,
      sidecar: {
        ...loaded.sidecar,
        deletedThreads: [{
          threadId: 'thread-deleted',
          annotationIds: ['annotation-deleted'],
          anchorIds: ['anchor-deleted'],
          deletedAt: '2026-07-04T00:01:00.000Z',
          deletedVersion: 1
        }]
      }
    })
    expect(deleted.ok).toBe(true)

    const staleSaved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: staleSidecar })
    expect(staleSaved.ok).toBe(true)
    if (!staleSaved.ok) return
    expect(staleSaved.sidecar.threads).toEqual([])
    expect(staleSaved.sidecar.annotations).toEqual([])
    expect(staleSaved.sidecar.anchors).toEqual([])
    expect(staleSaved.sidecar.deletedThreads?.map((item) => item.threadId)).toEqual(['thread-deleted'])
  })

  it('exports and imports reviewable zip sidecar packages', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'roundtrip.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nroundtrip\n', 'utf8')
    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const exported = await exportPdfAnnotationSidecarPackage({
      pdfPath,
      workspaceRoot,
      sidecar: loaded.sidecar,
      anonymizeAuthors: true
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.path.endsWith('roundtrip.dsgui-pdf.zip')).toBe(true)

    const zip = await JSZip.loadAsync(await readFile(exported.path))
    expect(zip.file('roundtrip.pdf')).toBeTruthy()
    expect(zip.file('annotations.json')).toBeTruthy()
    expect(zip.file('manifest.json')).toBeTruthy()

    const imported = await importPdfAnnotationSidecarPackage({
      pdfPath,
      workspaceRoot,
      packagePath: exported.path
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.fingerprintMatched).toBe(true)
  })

  it('exports sidecar threads as Adobe-editable PDF annotations', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeBlankPdf(pdfPath)
    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot, pageCount: 1 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const now = '2026-07-05T00:00:00.000Z'
    const highlightAnchor = createPdfAnchor({
      id: 'anchor-highlight',
      rects: [{ page: 1, x: 0.18, y: 0.2, width: 0.26, height: 0.04 }],
      quote: 'highlighted crystal motif',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })
    const commentAnchor = createPdfAnchor({
      id: 'anchor-comment',
      rects: [{ page: 1, x: 0.5, y: 0.34, width: 0.18, height: 0.05 }],
      quote: 'coordination environment',
      pdfFingerprint: loaded.pdfFingerprint,
      createdAt: now,
      updatedAt: now
    })

    const exported = await exportPdfAnnotationAdobePdf({
      pdfPath,
      workspaceRoot,
      sidecar: {
        ...loaded.sidecar,
        anchors: [highlightAnchor, commentAnchor],
        annotations: [
          {
            id: 'annotation-highlight',
            threadId: 'thread-highlight',
            anchorId: 'anchor-highlight',
            kind: 'highlight',
            body: 'Important evidence.',
            color: '#ffcc33',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'annotation-comment',
            threadId: 'thread-comment',
            anchorId: 'anchor-comment',
            kind: 'comment',
            body: 'Check the coordination environment.',
            createdAt: now,
            updatedAt: now
          }
        ],
        threads: [
          {
            id: 'thread-highlight',
            kind: 'highlight',
            anchorIds: ['anchor-highlight'],
            annotationIds: ['annotation-highlight'],
            status: 'open',
            title: 'Evidence highlight',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'thread-comment',
            kind: 'comment',
            anchorIds: ['anchor-comment'],
            annotationIds: ['annotation-comment'],
            status: 'open',
            title: 'Coordination note',
            createdAt: now,
            updatedAt: now
          }
        ],
        updatedAt: now,
        manifest: {
          ...loaded.sidecar.manifest,
          updatedAt: now
        }
      }
    })

    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.path.endsWith('paper.annotated.pdf')).toBe(true)
    expect(exported.annotationCount).toBe(2)
    const content = await readFile(exported.path, 'latin1')
    expect(content).toContain('/Subtype /Highlight')
    expect(content).toContain('/Subtype /Text')
    expect(content).toContain('/QuadPoints')
  })

  it('requires relocation opt-in when package fingerprint does not match', async () => {
    const workspaceRoot = await createTempWorkspace()
    const sourcePdf = join(workspaceRoot, 'source.pdf')
    const targetPdf = join(workspaceRoot, 'target.pdf')
    await writeFile(sourcePdf, '%PDF-1.7\nsource\n', 'utf8')
    await writeFile(targetPdf, '%PDF-1.7\ntarget\n', 'utf8')

    const source = await loadPdfAnnotationSidecar({ pdfPath: sourcePdf, workspaceRoot })
    expect(source.ok).toBe(true)
    if (!source.ok) return
    const exported = await exportPdfAnnotationSidecarPackage({
      pdfPath: sourcePdf,
      workspaceRoot,
      sidecar: source.sidecar
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const rejected = await importPdfAnnotationSidecarPackage({
      pdfPath: targetPdf,
      workspaceRoot,
      packagePath: exported.path
    })
    expect(rejected.ok).toBe(false)

    const imported = await importPdfAnnotationSidecarPackage({
      pdfPath: targetPdf,
      workspaceRoot,
      packagePath: exported.path,
      attemptRelocation: true
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.fingerprintMatched).toBe(false)
    expect(imported.warnings[0]).toContain('fingerprint mismatch')
  })
})
