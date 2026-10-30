import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitResultV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { describe, expect, it, vi } from 'vitest'
import {
  VISUAL_REVIEW_CAPABILITY_IDS
} from './contract.js'
import {
  createVisualReviewCapabilityFactory,
  type VisualReviewCapabilityOptions,
  type VisualReviewServicePort
} from './main.js'

function service(): VisualReviewServicePort {
  return {
    open: vi.fn(async ({ workspaceRoot, documentId }) => ({
      ok: true,
      status: 'opened',
      workspaceRoot,
      document: { documentId },
      paths: {},
      changed: false
    })) as unknown as VisualReviewServicePort['open'],
    readImage: vi.fn(),
    updateContext: vi.fn(),
    applyStyleReference: vi.fn(),
    saveAnnotations: vi.fn(),
    exportReviewPacket: vi.fn(),
    createCandidate: vi.fn(),
    preflightAcceptCandidate: vi.fn(),
    abortPreparedAcceptance: vi.fn(),
    acceptCandidate: vi.fn(),
    rejectCandidate: vi.fn()
  }
}

describe('Visual Review capabilities', () => {
  it('publishes one governed definition per canonical operation', () => {
    const definitions = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (definition) => definition,
      getService: service
    }).createDefinitions()
    const byId = new Map(definitions.map((definition) => [definition.id, definition]))

    expect([...byId.keys()]).toEqual(Object.values(VISUAL_REVIEW_CAPABILITY_IDS))
    for (const id of [
      VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
      VISUAL_REVIEW_CAPABILITY_IDS.readImage
    ]) {
      expect(byId.get(id)?.effect, id).toBe('read')
      expect(byId.get(id)?.concurrency, id).toEqual({
        revision: 'none',
        idempotency: 'none'
      })
    }
    for (const id of [
      VISUAL_REVIEW_CAPABILITY_IDS.open,
      VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
      VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
      VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
      VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
      VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
      VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate
    ]) {
      expect(byId.get(id)?.concurrency.idempotency, id).toBe('required')
    }
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)).toMatchObject({
      effect: 'destructive',
      audiences: ['ui'],
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations)?.audiences).toEqual(['ui'])
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate)?.audiences).toEqual([
      'agent',
      'system'
    ])
  })

  it('derives workspace ownership from the caller and calls one open operation', async () => {
    const fake = service()
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: () => fake
    }).createDefinitions().find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.open)
    expect(definition).toBeDefined()

    const result = await definition!.handler({
      documentId: 'figure-1',
      artifact: {
        kind: 'generated_image',
        sourcePath: 'outputs/figure.png'
      }
    }, {
      caller: { workspaceId: '/workspace' }
    })

    expect(fake.open).toHaveBeenCalledOnce()
    expect(fake.open).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      documentId: 'figure-1',
      artifact: {
        kind: 'generated_image',
        sourcePath: 'outputs/figure.png'
      }
    })
    expect('changed' in result).toBe(false)
  })

  it('fails closed without a workspace-scoped caller', async () => {
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: service
    }).createDefinitions()[0]!

    await expect(definition.handler(
      { documentId: 'figure-1' },
      { caller: {} }
    )).rejects.toThrow('workspace-scoped caller')
  })

  it('does not call Artifact Versions commit when acceptance preflight fails', async () => {
    const fake: VisualReviewServicePort = {
      ...service(),
      preflightAcceptCandidate: vi.fn(async () => {
        throw new Error('Candidate artifact changed after creation.')
      }) as unknown as VisualReviewServicePort['preflightAcceptCandidate']
    }
    const commitArtifactVersion = vi.fn()
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: () => fake,
      commitArtifactVersion
    }).createDefinitions().find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!

    await expect(definition.handler(
      { documentId: 'figure-1', revisionId: 'revision-1' },
      { caller: { workspaceId: '/workspace' } }
    )).rejects.toThrow('changed after creation')

    expect(commitArtifactVersion).not.toHaveBeenCalled()
    expect(fake.acceptCandidate).not.toHaveBeenCalled()
  })

  it('commits reviewed candidate bytes before accepting and binds the immutable version ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'visual-review-versioned-'))
    const candidatePath = join(root, 'candidate.png')
    const candidateBytes = Buffer.from('reviewed candidate')
    await writeFile(candidatePath, candidateBytes)
    const digest = 'c316c0be5bc31c21d0e817fc8f698994f04960479d806175ca4a967e8565dfba'
    const ref: ArtifactVersionRefV1 = {
      artifactId: 'artifact:figure-1',
      versionId: 'artifact-version:figure-1-v1',
      contentDigest: digest,
      byteLength: candidateBytes.byteLength,
      mediaType: 'image/png',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: {
        visibility: 'workspace',
        principals: [],
        allowExport: true
      }
    }
    const baseService = service()
    const existingRef: ArtifactVersionRefV1 = {
      ...ref,
      versionId: 'artifact-version:figure-1-v0',
      contentDigest: 'a'.repeat(64)
    }
    const preflightAcceptCandidate = vi.fn(async () => ({
      document: {
        documentId: 'figure-1',
        artifact: { title: 'Figure 1', mimeType: 'image/png' }
      },
      artifact: {
        kind: 'scientific_plot',
        title: 'Figure 1',
        mimeType: 'image/png',
        versionRef: existingRef
      },
      candidate: {
        id: 'revision-1',
        status: 'candidate',
        artifactPath: candidatePath,
        artifactHash: digest,
        reviewEvidence: { reviewedArtifactHash: digest }
      }
    })) as unknown as VisualReviewServicePort['preflightAcceptCandidate']
    const acceptCandidate = vi.fn(async (
      { artifactVersionRef }: { artifactVersionRef?: ArtifactVersionRefV1 }
    ) => ({
      ok: true,
      status: 'accepted',
      revision: { versionRef: artifactVersionRef },
      document: { artifact: { versionRef: artifactVersionRef } }
    })) as unknown as VisualReviewServicePort['acceptCandidate']
    const fake: VisualReviewServicePort = {
      ...baseService,
      preflightAcceptCandidate,
      acceptCandidate
    }
    const commitResult = {
      ok: true,
      value: {
        transactionId: 'artifact-commit:visual-review',
        committedAt: '2026-08-06T00:00:00.000Z',
        idempotentReplay: false,
        versions: [{ candidateId: 'visual-review:revision-1', ref }],
        events: []
      }
    } as unknown as ArtifactVersionCommitResultV1
    const commitArtifactVersion = vi.fn(async (
      _input: ArtifactVersionCommitInputV1,
      _workspaceRoot: string
    ) => commitResult)
    const readArtifactVersion = vi.fn(async () => ({
      ok: true,
      value: {
        artifact: {
          artifactId: existingRef.artifactId,
          kind: 'scientific-plot',
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
          currentVersionId: existingRef.versionId,
          versionCount: 1
        },
        version: {},
        ref: existingRef,
        dataBase64: ''
      }
    })) as never
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: () => fake,
      commitArtifactVersion,
      readArtifactVersion
    }).createDefinitions().find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!

    const result = await definition.handler(
      { documentId: 'figure-1', revisionId: 'revision-1' },
      { caller: { workspaceId: root } }
    )

    expect(commitArtifactVersion).toHaveBeenCalledOnce()
    expect(commitArtifactVersion.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: 'visual-review:figure-1:revision-1:accept',
      candidates: [{
        candidateId: 'visual-review:revision-1',
        artifactId: existingRef.artifactId,
        expectedCurrentVersionId: existingRef.versionId,
        intent: 'save',
        kind: 'scientific-plot',
        content: { mode: 'snapshot', dataBase64: candidateBytes.toString('base64') },
        dependencies: [{
          role: 'reviewed-from',
          required: true,
          target: { kind: 'version', ref: existingRef }
        }]
      }]
    })
    expect(fake.acceptCandidate).toHaveBeenCalledWith({
      workspaceRoot: root,
      documentId: 'figure-1',
      revisionId: 'revision-1',
      artifactVersionRef: ref
    })
    expect(result.output).toMatchObject({ revision: { versionRef: ref } })
  })

  it('resumes a version-committed acceptance receipt without creating another version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'visual-review-resume-'))
    const candidatePath = join(root, 'candidate.png')
    const candidateBytes = Buffer.from('durably committed candidate')
    await writeFile(candidatePath, candidateBytes)
    const digest = createHash('sha256').update(candidateBytes).digest('hex')
    const committedRef: ArtifactVersionRefV1 = {
      artifactId: 'artifact:figure-1',
      versionId: 'artifact-version:figure-1-v2',
      contentDigest: digest,
      byteLength: candidateBytes.byteLength,
      mediaType: 'image/png',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: {
        visibility: 'workspace',
        principals: [],
        allowExport: true
      }
    }
    const fake: VisualReviewServicePort = {
      ...service(),
      preflightAcceptCandidate: vi.fn(async () => ({
        document: { documentId: 'figure-1' },
        artifact: { kind: 'scientific_plot', mimeType: 'image/png' },
        candidate: {
          id: 'revision-1',
          artifactPath: candidatePath,
          artifactHash: digest,
          reviewEvidence: { reviewedArtifactHash: digest }
        },
        acceptanceState: 'version-committed',
        newlyPrepared: false,
        committedVersionRef: committedRef
      })) as unknown as VisualReviewServicePort['preflightAcceptCandidate'],
      acceptCandidate: vi.fn(async () => ({
        ok: true,
        status: 'accepted',
        revision: { versionRef: committedRef },
        document: { artifact: { versionRef: committedRef } }
      })) as unknown as VisualReviewServicePort['acceptCandidate']
    }
    const commitArtifactVersion = vi.fn()
    const readArtifactVersion = vi.fn(async () => ({
      ok: true,
      value: {
        artifact: {
          artifactId: committedRef.artifactId,
          kind: 'scientific-plot',
          currentVersionId: 'artifact-version:figure-1-v3'
        },
        version: {},
        ref: committedRef,
        dataBase64: candidateBytes.toString('base64')
      }
    })) as never
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: () => fake,
      commitArtifactVersion,
      readArtifactVersion
    }).createDefinitions().find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!

    const result = await definition.handler(
      { documentId: 'figure-1', revisionId: 'revision-1' },
      { caller: { workspaceId: root } }
    )

    expect(readArtifactVersion).toHaveBeenCalledWith(
      { versionId: committedRef.versionId },
      root
    )
    expect(commitArtifactVersion).not.toHaveBeenCalled()
    expect(fake.acceptCandidate).toHaveBeenCalledWith({
      workspaceRoot: root,
      documentId: 'figure-1',
      revisionId: 'revision-1',
      artifactVersionRef: committedRef
    })
    expect(result.output).toMatchObject({ revision: { versionRef: committedRef } })
  })
})
