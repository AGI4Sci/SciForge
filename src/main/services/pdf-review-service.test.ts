import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPdfAnnotationSidecar } from './pdf-annotation-sidecar-service'
import {
  generatePdfReviewAnnotations,
  improvePdfReviewAnnotation
} from './pdf-review-service'

const tempDirs: string[] = []

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-pdf-review-'))
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  tempDirs.push(root)
  return workspaceRoot
}

async function writeBlankPdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800])
  await writeFile(path, Buffer.from(await pdf.save({ useObjectStreams: false })))
}

async function writeReviewData(path: string, comments: unknown[]): Promise<void> {
  await writeFile(path, `${JSON.stringify({ comments }, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pdf review service', () => {
  it('imports PDF review comments into the annotation sidecar', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    const reviewDataPath = join(workspaceRoot, 'review.json')
    await writeBlankPdf(pdfPath)
    await writeReviewData(reviewDataPath, [
      {
        id: 'C01',
        selected_passage: 'The model improves performance without a baseline.',
        page_number: 1,
        reviewer_concern: 'The claim lacks a control baseline.',
        evidence_issue: 'Readers cannot tell whether the improvement is meaningful.',
        modification_advice: 'Add the baseline and quantify the delta.',
        modified_text: 'The model improves performance by 4.2 points over the strongest baseline.',
        severity: 'major',
        linked_source_file: 'paper.tex',
        rects: [{ page: 1, x: 0.12, y: 0.24, width: 0.32, height: 0.05 }]
      },
      {
        id: 'C02',
        selected_passage: 'This item should be skipped because it has no anchor.',
        page_number: 1,
        reviewer_concern: 'No rectangle is available.',
        evidence_issue: 'The service should not create unanchored sidecar comments.',
        modification_advice: 'Skip this generated comment.',
        modified_text: 'Skipped.',
        severity: 'minor'
      }
    ])

    const result = await generatePdfReviewAnnotations({
      pdfPath: 'paper.pdf',
      workspaceRoot,
      reviewDataPath: 'review.json',
      maxComments: 2
    })

    expect(result).toMatchObject({
      ok: true,
      mode: 'import',
      commentCount: 1,
      skippedCount: 1
    })
    if (!result.ok) return
    expect(result.sidecar.threads).toEqual([
      expect.objectContaining({
        id: 'sciforge-review-thread-C01',
        title: 'C01 · major'
      })
    ])
    expect(result.sidecar.annotations).toEqual([
      expect.objectContaining({
        id: 'sciforge-review-annotation-C01',
        kind: 'comment',
        color: '#f59e0b',
        sourceText: 'The model improves performance without a baseline.',
        body: expect.stringContaining('Reviewer concern:')
      })
    ])
    expect(result.sidecar.anchors[0]).toMatchObject({
      id: 'sciforge-review-anchor-C01',
      pageStart: 1,
      pageEnd: 1,
      rects: [{ page: 1, x: 0.12, y: 0.24, width: 0.32, height: 0.05 }]
    })
    await expect(readFile(result.path, 'utf8')).resolves.toContain('sciforge-review-thread-C01')
  })

  it('replaces previous generated review threads and can append fallback improvement advice', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    const firstReviewPath = join(workspaceRoot, 'review-first.json')
    const secondReviewPath = join(workspaceRoot, 'review-second.json')
    await writeBlankPdf(pdfPath)
    await writeReviewData(firstReviewPath, [{
      id: 'C01',
      selected_passage: 'Original claim.',
      page_number: 1,
      reviewer_concern: 'Original concern.',
      modification_advice: 'Original advice.',
      modified_text: 'Original revised text.',
      rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04 }]
    }])
    await writeReviewData(secondReviewPath, [{
      id: 'C02',
      selected_passage: 'Updated claim.',
      page_number: 1,
      reviewer_concern: 'Updated concern.',
      evidence_issue: 'The evidence is still too vague.',
      modification_advice: 'State the concrete measurement.',
      modified_text: 'Updated claim with a concrete measurement.',
      rects: [{ page: 1, x: 0.2, y: 0.2, width: 0.25, height: 0.05 }]
    }])

    await expect(generatePdfReviewAnnotations({
      pdfPath: 'paper.pdf',
      workspaceRoot,
      reviewDataPath: 'review-first.json'
    })).resolves.toMatchObject({ ok: true, commentCount: 1 })

    const replaced = await generatePdfReviewAnnotations({
      pdfPath: 'paper.pdf',
      workspaceRoot,
      reviewDataPath: 'review-second.json'
    })
    expect(replaced).toMatchObject({ ok: true, commentCount: 1 })
    if (!replaced.ok) return
    expect(replaced.sidecar.threads.map((thread) => thread.id)).toEqual(['sciforge-review-thread-C02'])

    const improved = await improvePdfReviewAnnotation({
      pdfPath: 'paper.pdf',
      workspaceRoot,
      threadId: 'sciforge-review-thread-C02'
    })
    expect(improved).toMatchObject({
      ok: true,
      threadId: 'sciforge-review-thread-C02',
      annotationId: 'sciforge-review-annotation-C02',
      modificationAdvice: 'State the concrete measurement.',
      revisedContent: 'Updated claim with a concrete measurement.'
    })
    if (!improved.ok) return

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.annotations[0].body).toContain('SciForge improvement advice:')
    expect(loaded.sidecar.annotations[0].body).toContain('Suggested revised content:')
  })
})
