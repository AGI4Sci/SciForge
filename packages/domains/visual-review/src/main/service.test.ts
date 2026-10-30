import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acceptVisualCandidateRevision,
  applyVisualStyleReference,
  createVisualCandidateRevision,
  exportVisualReviewPacket,
  openVisualReviewDocument,
  preflightVisualCandidateAcceptance,
  readVisualReviewImage,
  rejectVisualCandidateRevision,
  saveVisualDocumentAnnotations,
  updateVisualDocumentContext
} from './service.js'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'visual-document-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function seededDocument(documentId = 'figure') {
  const root = await workspace()
  const sourcePath = join(root, 'figure.png')
  await writeFile(sourcePath, 'original')
  const inserted = await openVisualReviewDocument({
    workspaceRoot: root,
    documentId,
    artifact: {
      kind: 'scientific_plot',
      sourcePath,
      width: 1600,
      height: 900
    }
  })
  return { root, sourcePath, inserted }
}

function passingReviewEvidence(path: string, content: string | Uint8Array) {
  return {
    tool: 'image_generation_review_candidate' as const,
    ok: true as const,
    reviewedArtifactPath: path,
    reviewedArtifactHash: createHash('sha256').update(content).digest('hex'),
    reviewedAt: '2026-07-12T00:00:00.000Z',
    score: {
      overall: 0.92,
      dimensions: 1,
      nonEmpty: 1,
      background: 1,
      semantic: 0.94,
      warnings: []
    },
    semantic: {
      pass: true as const,
      summary: 'The candidate preserves locked content and satisfies the requested edit.',
      violations: [] as [],
      repairInstructions: [] as []
    },
    repairable: false as const,
    warnings: []
  }
}

async function writePng(path: string, width: number, height: number): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#123456'
  context.fillRect(0, 0, Math.max(1, width / 2), Math.max(1, height / 2))
  const bytes = canvas.toBuffer('image/png')
  await writeFile(path, bytes)
  return bytes
}

describe('VisualDocument engine', () => {
  it('reads only bounded raster images inside the owning workspace', async () => {
    const root = await workspace()
    const pngPath = join(root, 'review.png')
    await writePng(pngPath, 20, 10)

    await expect(readVisualReviewImage({
      workspaceRoot: root,
      path: pngPath
    })).resolves.toMatchObject({
      ok: true,
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u)
    })
    await expect(readVisualReviewImage({
      workspaceRoot: root,
      path: '../outside.png'
    })).rejects.toThrow()
    const svgPath = join(root, 'unsafe.svg')
    await writeFile(svgPath, '<svg><script>alert(1)</script></svg>')
    await expect(readVisualReviewImage({
      workspaceRoot: root,
      path: svgPath
    })).rejects.toThrow('Unsupported Visual Review image type')
  })

  it('creates only VisualDocument JSON storage without editor snapshots', async () => {
    const root = await workspace()
    const created = await openVisualReviewDocument({ workspaceRoot: root, documentId: 'paper-figure' })
    expect(created.status).toBe('created')
    expect(created.paths.documentPath).toBe(join(created.workspaceRoot, '.sciforge', 'visual-documents', 'paper-figure', 'document.json'))
    expect(created.document).toMatchObject({
      schemaVersion: 1,
      artifact: null,
      activeCandidateRevisionId: null,
      acceptedRevisionId: null
    })
    const persisted = JSON.parse(await readFile(created.paths.documentPath, 'utf8'))
    expect(persisted).toEqual(created.document)
    expect(JSON.stringify(persisted)).not.toMatch(/drawio|tldraw|xml/i)
  })

  it('does not create a missing document when a restore probe opens existing-only', async () => {
    const root = await workspace()
    const documentPath = join(root, '.sciforge', 'visual-documents', 'deleted-review', 'document.json')

    await expect(openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'deleted-review',
      createIfMissing: false
    })).rejects.toThrow('VisualDocument does not exist')
    await expect(access(documentPath)).rejects.toThrow()
  })

  it('rolls back a newly created document when artifact activation fails', async () => {
    const root = await workspace()
    const documentPath = join(
      root,
      '.sciforge',
      'visual-documents',
      'failed-activation',
      'document.json'
    )

    await expect(openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'failed-activation',
      artifact: {
        kind: 'image',
        sourcePath: join(root, 'missing.png')
      }
    })).rejects.toThrow()
    await expect(access(documentPath)).rejects.toThrow()
  })

  it('fails closed when source bytes, size, or media type disagree with a bound ArtifactVersionRef', async () => {
    const root = await workspace()
    const sourcePath = join(root, 'bound-source.png')
    const sourceBytes = Buffer.from('version-bound source bytes')
    await writeFile(sourcePath, sourceBytes)
    const validRef = {
      artifactId: 'artifact:bound-source',
      versionId: 'artifact-version:bound-source-v1',
      contentDigest: createHash('sha256').update(sourceBytes).digest('hex'),
      byteLength: sourceBytes.byteLength,
      mediaType: 'image/png',
      availability: 'available' as const,
      retention: 'snapshot' as const,
      accessPolicy: {
        visibility: 'workspace' as const,
        principals: [],
        allowExport: true
      }
    }

    await expect(openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'digest-mismatch',
      artifact: {
        kind: 'image',
        sourcePath,
        versionRef: { ...validRef, contentDigest: 'a'.repeat(64) },
        mimeType: 'image/png'
      }
    })).rejects.toThrow('bytes do not match')

    await expect(openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'size-mismatch',
      artifact: {
        kind: 'image',
        sourcePath,
        versionRef: { ...validRef, byteLength: validRef.byteLength + 1 },
        mimeType: 'image/png'
      }
    })).rejects.toThrow('byte length')

    await expect(openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'media-mismatch',
      artifact: {
        kind: 'image',
        sourcePath,
        versionRef: { ...validRef, mediaType: 'image/jpeg' },
        mimeType: 'image/png'
      }
    })).rejects.toThrow('media type')
  })

  it('inherits the manuscript visual style unless the caller explicitly disables it', async () => {
    const root = await workspace()
    const profilePath = join(root, '.sciforge', 'visual-styles', 'manuscript-default.json')
    await mkdir(join(root, '.sciforge', 'visual-styles'), { recursive: true })
    await writeFile(profilePath, '{}')

    const inherited = await openVisualReviewDocument({ workspaceRoot: root, documentId: 'inherited' })
    const disabled = await openVisualReviewDocument({ workspaceRoot: root, documentId: 'disabled', styleProfileRef: null })

    expect(inherited.document.styleProfileRef).toBe('.sciforge/visual-styles/manuscript-default.json')
    expect(disabled.document.styleProfileRef).toBeNull()
  })

  it('extracts a reference image style and applies the canonical manuscript profile', async () => {
    const root = await workspace()
    const sourcePath = join(root, 'source.png')
    const referencePath = join(root, 'reference.png')
    await writePng(sourcePath, 80, 60)
    await writePng(referencePath, 120, 90)
    await openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'styled-figure',
      artifact: { kind: 'image', sourcePath }
    })

    const applied = await applyVisualStyleReference({
      workspaceRoot: root,
      documentId: 'styled-figure',
      sourcePath: referencePath
    })

    expect(applied).toMatchObject({
      ok: true,
      status: 'style_applied',
      styleProfileRef: '.sciforge/visual-styles/manuscript-default.json',
      document: {
        documentId: 'styled-figure',
        styleProfileRef: '.sciforge/visual-styles/manuscript-default.json'
      },
      profile: {
        id: expect.stringMatching(/^visual-style-/u),
        semanticDescription: expect.any(String),
        confidence: expect.any(Number)
      }
    })
    expect(applied.profile.palette.colors.length).toBeGreaterThan(0)
    const saved = JSON.parse(await readFile(
      join(root, '.sciforge', 'visual-styles', 'manuscript-default.json'),
      'utf8'
    ))
    expect(saved.profile.id).toBe(applied.profile.id)
    expect(saved.diagnostics.analyzedAt).toEqual(expect.any(String))
  })

  it('inserts one protected artifact with reusable semantic nodes and context', async () => {
    const root = await workspace()
    const sourcePath = join(root, 'figure.svg')
    await writeFile(sourcePath, '<svg/>')
    const inserted = await openVisualReviewDocument({
      workspaceRoot: root,
      documentId: 'semantic',
      artifact: {
        kind: 'generated_image',
        sourcePath,
        width: 1000,
        height: 600,
        styleProfileRef: '.sciforge/styles/manuscript.json',
        nodes: [{
          id: 'evidence-dag',
          kind: 'group',
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          semanticRef: 'architecture.evidence-dag',
          editable: true,
          truthLocked: true
        }],
        truthLocks: [{ id: 'relation', description: 'Preserve relation', nodeIds: ['evidence-dag'] }]
      }
    })
    expect(inserted.document.artifact).toMatchObject({ width: 1000, height: 600 })
    expect(inserted.document.artifact?.sourcePath).toMatch(/figure\.svg$/)
    expect(await readFile(inserted.document.artifact!.workingCopyPath, 'utf8')).toBe('<svg/>')
    expect(inserted.document.nodes[0].semanticRef).toBe('architecture.evidence-dag')
    expect(inserted.document.styleProfileRef).toContain('manuscript')
  })

  it('saves normalized annotations and exports one structured review packet', async () => {
    const { root, inserted } = await seededDocument()
    const nodeId = inserted.document.nodes[0].id
    await updateVisualDocumentContext({
      workspaceRoot: root,
      documentId: 'figure',
      styleProfileRef: '.sciforge/styles/paper.json',
      truthLocks: [{ id: 'labels', description: 'Preserve labels', nodeIds: [nodeId] }]
    })
    const saved = await saveVisualDocumentAnnotations({
      workspaceRoot: root,
      documentId: 'figure',
      annotations: [{
        id: 'crowded-area',
        geometry: { kind: 'box', bounds: { x: 0.1, y: 0.15, width: 0.35, height: 0.2 } },
        instruction: 'Increase spacing and align the labels.',
        targetNodeIds: [nodeId]
      }, {
        geometry: { kind: 'arrow', from: { x: 0.4, y: 0.4 }, to: { x: 0.7, y: 0.6 } },
        instruction: 'Simplify this relationship.'
      }, {
        geometry: {
          kind: 'freehand',
          points: [
            { x: 0.2, y: 0.25 },
            { x: 0.3, y: 0.2 },
            { x: 0.38, y: 0.3 },
            { x: 0.2, y: 0.25 }
          ]
        },
        instruction: 'Revise the circled structure.'
      }]
    })
    expect(saved.annotations).toHaveLength(3)
    expect(saved.annotations[2]?.geometry.kind).toBe('freehand')
    const exported = await exportVisualReviewPacket({ workspaceRoot: root, documentId: 'figure' })
    expect(exported.packet.sourceArtifact.width).toBe(1600)
    expect(exported.packet.annotations).toHaveLength(3)
    expect(exported.packet.revisionContext.selectedNodeIds).toEqual([nodeId])
    expect(exported.packet.revisionContext.preserve).toEqual(['Preserve labels'])
    expect(exported.packet.styleProfileRef).toContain('paper.json')
    expect(JSON.parse(await readFile(exported.packetPath, 'utf8'))).toEqual(exported.packet)
  })

  it('rejects annotation geometry outside the normalized artifact space', async () => {
    const { root } = await seededDocument()
    await expect(saveVisualDocumentAnnotations({
      workspaceRoot: root,
      documentId: 'figure',
      annotations: [{
        geometry: { kind: 'box', bounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 } },
        instruction: 'Invalid overflow'
      }]
    })).rejects.toThrow('must stay inside')
  })

  it('stages and rejects a candidate without modifying the source', async () => {
    const { root, sourcePath, inserted } = await seededDocument()
    const candidatePath = join(root, 'candidate.bin')
    await writeFile(candidatePath, 'candidate')
    const staged = await createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      candidatePath,
      summary: 'Improve layout',
      reviewEvidence: passingReviewEvidence(candidatePath, 'candidate'),
      expectedBaseHash: inserted.document.artifact!.workingCopyHash
    })
    expect(await readFile(sourcePath, 'utf8')).toBe('original')
    expect(await readFile(staged.revision.artifactPath, 'utf8')).toBe('candidate')
    const rejected = await rejectVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      revisionId: staged.revision.id
    })
    expect(rejected.document.activeCandidateRevisionId).toBeNull()
    expect(rejected.revision.status).toBe('rejected')
    expect(await readFile(sourcePath, 'utf8')).toBe('original')
  })

  it('refuses candidate evidence that is not bound to the reviewed file', async () => {
    const { root } = await seededDocument()
    const candidatePath = join(root, 'candidate.bin')
    await writeFile(candidatePath, 'candidate')
    await expect(createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      candidatePath,
      summary: 'Unverified revision',
      reviewEvidence: {
        ...passingReviewEvidence(candidatePath, 'different bytes'),
        semantic: {
          pass: true,
          summary: 'Claims to pass.',
          violations: [],
          repairInstructions: []
        }
      }
    })).rejects.toThrow('reviewed artifact hash')
  })

  it('atomically accepts a candidate, backs up the source, and records history', async () => {
    const { root, sourcePath } = await seededDocument()
    const candidatePath = join(root, 'candidate.svg')
    await writeFile(candidatePath, 'accepted content')
    const staged = await createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      candidatePath,
      summary: 'Publication-ready revision',
      reviewEvidence: passingReviewEvidence(candidatePath, 'accepted content'),
      width: 2000,
      height: 1200
    })
    const versionRef = {
      artifactId: 'artifact:figure',
      versionId: 'artifact-version:figure-v1',
      contentDigest: staged.revision.artifactHash,
      byteLength: Buffer.byteLength('accepted content'),
      mediaType: 'image/png',
      availability: 'available' as const,
      retention: 'snapshot' as const,
      accessPolicy: {
        visibility: 'workspace' as const,
        principals: [],
        allowExport: true
      }
    }
    const accepted = await acceptVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      revisionId: staged.revision.id,
      artifactVersionRef: versionRef
    })
    expect(await readFile(sourcePath, 'utf8')).toBe('accepted content')
    expect(await readFile(accepted.revision.backupPath!, 'utf8')).toBe('original')
    expect(accepted.document.artifact).toMatchObject({ width: 2000, height: 1200 })
    expect(accepted.document.acceptedRevisionId).toBe(staged.revision.id)
    expect(accepted.document.activeCandidateRevisionId).toBeNull()
    expect(accepted.revision.status).toBe('accepted')
    expect(accepted.revision.versionRef).toEqual(versionRef)
    expect(accepted.document.artifact?.versionRef).toEqual(versionRef)
  })

  it('recovers idempotently after version commit and a partial local acceptance', async () => {
    const { root, sourcePath, inserted } = await seededDocument('recoverable')
    const candidatePath = join(root, 'recoverable-candidate.svg')
    const candidateBytes = Buffer.from('recoverable accepted content')
    await writeFile(candidatePath, candidateBytes)
    const staged = await createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'recoverable',
      candidatePath,
      summary: 'Recover after a local write interruption',
      reviewEvidence: passingReviewEvidence(candidatePath, candidateBytes)
    })
    const prepared = await preflightVisualCandidateAcceptance({
      workspaceRoot: root,
      documentId: 'recoverable',
      revisionId: staged.revision.id
    })
    expect(prepared).toMatchObject({ acceptanceState: 'prepared', newlyPrepared: true })

    const versionRef = {
      artifactId: 'artifact:recoverable',
      versionId: 'artifact-version:recoverable-v2',
      contentDigest: staged.revision.artifactHash,
      byteLength: candidateBytes.byteLength,
      mediaType: 'image/svg+xml',
      availability: 'available' as const,
      retention: 'snapshot' as const,
      accessPolicy: {
        visibility: 'workspace' as const,
        principals: [],
        allowExport: true
      }
    }
    const receiptPath = join(
      root,
      '.sciforge',
      'visual-documents',
      'recoverable',
      'acceptance-outbox',
      `${staged.revision.id}.json`
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(receiptPath, `${JSON.stringify({
      ...receipt,
      state: 'version-committed',
      artifactVersionRef: versionRef
    }, null, 2)}\n`)

    // Simulate a crash after the source replacement but before the working
    // copy and document were updated.
    await writeFile(sourcePath, candidateBytes)
    const resumed = await preflightVisualCandidateAcceptance({
      workspaceRoot: root,
      documentId: 'recoverable',
      revisionId: staged.revision.id
    })
    expect(resumed).toMatchObject({
      acceptanceState: 'version-committed',
      newlyPrepared: false,
      committedVersionRef: versionRef
    })
    await expect(rejectVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'recoverable',
      revisionId: staged.revision.id
    })).rejects.toThrow('pending acceptance receipt')

    const accepted = await acceptVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'recoverable',
      revisionId: staged.revision.id,
      artifactVersionRef: versionRef
    })
    expect(await readFile(sourcePath, 'utf8')).toBe(candidateBytes.toString())
    expect(await readFile(inserted.document.artifact!.workingCopyPath, 'utf8'))
      .toBe(candidateBytes.toString())
    expect(await readFile(accepted.revision.backupPath!, 'utf8')).toBe('original')
    expect(accepted.revision.versionRef).toEqual(versionRef)

    const replay = await acceptVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'recoverable',
      revisionId: staged.revision.id,
      artifactVersionRef: versionRef
    })
    expect(replay).toEqual(accepted)
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      state: 'completed',
      artifactVersionRef: versionRef
    })
  })

  it('derives raster candidate dimensions from its bytes instead of trusting caller hints', async () => {
    const { root } = await seededDocument()
    const candidatePath = join(root, 'candidate.png')
    const candidateBytes = await writePng(candidatePath, 1920, 1440)

    const staged = await createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      candidatePath,
      summary: 'Keep the raster at its actual aspect ratio',
      reviewEvidence: passingReviewEvidence(candidatePath, candidateBytes),
      width: 1200,
      height: 800
    })

    expect(staged.revision).toMatchObject({ width: 1920, height: 1440 })
  })

  it('fails closed when the source changed outside SciForge', async () => {
    const { root, sourcePath } = await seededDocument()
    const candidatePath = join(root, 'candidate.bin')
    await writeFile(candidatePath, 'candidate')
    const staged = await createVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      candidatePath,
      summary: 'Revision',
      reviewEvidence: passingReviewEvidence(candidatePath, 'candidate')
    })
    await writeFile(sourcePath, 'external update')
    await expect(acceptVisualCandidateRevision({
      workspaceRoot: root,
      documentId: 'figure',
      revisionId: staged.revision.id
    })).rejects.toThrow('changed outside SciForge')
    expect(await readFile(sourcePath, 'utf8')).toBe('external update')
  })
})
