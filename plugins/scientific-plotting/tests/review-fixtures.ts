/** Deterministic artifact-version fixture; every reply uses the public schema. */
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import {
  artifactVersionCommitResultV1Schema,
  artifactVersionReadResultV1Schema,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadResultV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type { ImageGenerationCandidateReviewResult } from '@sciforge/image-generation/contract'
import type { VisualReviewArtifactPort } from '../src/review/operations.js'

/** Fixed clock used by the fake artifact port (never the wall clock). */
export const NOW = '2026-11-01T00:00:00.000Z'

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Renders a real raster image through @napi-rs/canvas. */
export async function renderPng(width = 96, height = 64): Promise<Buffer> {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#f4f1ea'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#274060'
  context.fillRect(width * 0.1, height * 0.2, width * 0.5, height * 0.4)
  context.fillStyle = '#c8a24b'
  context.beginPath()
  context.arc(width * 0.7, height * 0.6, height * 0.2, 0, Math.PI * 2)
  context.fill()
  return canvas.encode('png')
}

export async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** A valid `reviewEvidence` payload for `create-candidate`. */
export function reviewEvidence(reviewedArtifactPath: string, reviewedArtifactHash: string, reviewedAt = NOW) {
  return {
    tool: 'image_generation_review_candidate' as const,
    ok: true as const,
    status: 'publication_ready' as const,
    reviewedArtifactPath,
    reviewedArtifactHash,
    reviewedAt,
    score: {
      overall: 0.95,
      dimensions: 0.9,
      nonEmpty: 1,
      background: 0.95,
      semantic: 1,
      warnings: [] as string[]
    },
    semantic: {
      pass: true as const,
      needsContext: false as const,
      summary: 'Passes visual review',
      violations: [] as string[],
      repairInstructions: [] as string[]
    },
    repairable: false as const,
    warnings: [] as string[]
  } satisfies Extract<ImageGenerationCandidateReviewResult, { ok: true }> & {
    tool: 'image_generation_review_candidate'
  }
}

const deterministicUuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

type StoredVersion = Readonly<{
  artifactId: string
  versionId: string
  transactionId: string
  sequence: number
  kind: string
  intent: string
  bytes: Buffer
  digest: string
  mediaType?: string
  accessPolicy: ArtifactVersionRefV1['accessPolicy']
  metadata: Record<string, unknown>
  ref: ArtifactVersionRefV1
}>

export type FakeArtifactPort = VisualReviewArtifactPort & Readonly<{
  commits: Array<ArtifactVersionCommitInputV1>
  reads: Array<ArtifactVersionReadInputV1>
  versions: Map<string, StoredVersion>
}>

/**
 * In-memory artifact-versions implementation with a deterministic id sequence.
 * Every response is validated by the real contract schema, so a drift in the
 * port shape fails here instead of being silently accepted by the service.
 */
export function createFakeArtifactPort(): FakeArtifactPort {
  const commits: Array<ArtifactVersionCommitInputV1> = []
  const reads: Array<ArtifactVersionReadInputV1> = []
  const versions = new Map<string, StoredVersion>()
  let sequence = 0

  return Object.freeze({
    commits,
    reads,
    versions,
    async commit(input: ArtifactVersionCommitInputV1): Promise<ArtifactVersionCommitResultV1> {
      commits.push(input)
      const candidate = input.candidates[0]
      if (!candidate) throw new Error('fake artifact port received an empty candidate list')
      sequence += 1
      const serial = sequence
      const bytes = candidate.content.mode === 'snapshot'
        ? Buffer.from(candidate.content.dataBase64, 'base64')
        : Buffer.alloc(0)
      const digest = sha256(bytes)
      const mediaType = candidate.content.mode === 'snapshot' ? candidate.content.mediaType : undefined
      const artifactId = `artifact:${deterministicUuid(serial)}`
      const versionId = `artifact-version:${deterministicUuid(serial)}`
      const transactionId = `artifact-commit:${deterministicUuid(serial)}`
      const accessPolicy = candidate.accessPolicy ?? {
        visibility: 'workspace' as const,
        principals: [] as string[],
        allowExport: true
      }
      const ref: ArtifactVersionRefV1 = {
        artifactId,
        versionId,
        contentDigest: digest,
        byteLength: bytes.length,
        ...(mediaType ? { mediaType } : {}),
        availability: 'available',
        retention: 'snapshot',
        accessPolicy
      }
      versions.set(versionId, Object.freeze({
        artifactId,
        versionId,
        transactionId,
        sequence: serial,
        kind: candidate.kind,
        intent: candidate.intent,
        bytes,
        digest,
        ...(mediaType ? { mediaType } : {}),
        accessPolicy,
        metadata: candidate.metadata ?? {},
        ref
      }))
      return artifactVersionCommitResultV1Schema.parse({
        ok: true,
        value: {
          transactionId,
          committedAt: NOW,
          idempotentReplay: false,
          versions: [{
            candidateId: candidate.candidateId,
            artifact: {
              artifactId,
              kind: candidate.kind,
              createdAt: NOW,
              updatedAt: NOW,
              currentVersionId: versionId,
              versionCount: 1
            },
            version: {
              schemaVersion: 1,
              versionId,
              artifactId,
              sequence: 1,
              transactionId,
              createdAt: NOW,
              intent: candidate.intent,
              storage: {
                mode: 'snapshot',
                contentDigest: digest,
                byteLength: bytes.length,
                ...(mediaType ? { mediaType } : {})
              },
              dependencies: [],
              accessPolicy,
              metadata: candidate.metadata ?? {}
            },
            ref
          }],
          events: []
        }
      })
    },
    async read(input: ArtifactVersionReadInputV1): Promise<ArtifactVersionReadResultV1> {
      reads.push(input)
      const stored = versions.get(input.versionId)
      if (!stored) {
        return artifactVersionReadResultV1Schema.parse({
          ok: false,
          issue: { code: 'version-not-found', message: `Unknown version ${input.versionId}` }
        })
      }
      return artifactVersionReadResultV1Schema.parse({
        ok: true,
        value: {
          artifact: {
            artifactId: stored.artifactId,
            kind: stored.kind,
            createdAt: NOW,
            updatedAt: NOW,
            currentVersionId: stored.versionId,
            versionCount: 1
          },
          version: {
            schemaVersion: 1,
            versionId: stored.versionId,
            artifactId: stored.artifactId,
            sequence: stored.sequence,
            transactionId: stored.transactionId,
            createdAt: NOW,
            intent: stored.intent,
            storage: {
              mode: 'snapshot',
              contentDigest: stored.digest,
              byteLength: stored.bytes.length,
              ...(stored.mediaType ? { mediaType: stored.mediaType } : {})
            },
            dependencies: [],
            accessPolicy: stored.accessPolicy,
            metadata: stored.metadata
          },
          ref: stored.ref,
          dataBase64: stored.bytes.toString('base64')
        }
      })
    }
  })
}
