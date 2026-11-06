import { modelSourceCandidates } from './main/model-source-commit.js'
import { visualModelSourceSchema } from './model-source.js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadResultV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type { z } from 'zod'
import {
  VISUAL_REVIEW_CAPABILITY_IDS,
  visualReviewApplyStyleReferenceInputSchema,
  visualReviewApplyStyleReferenceOutputSchema,
  visualReviewCreateCandidateInputSchema,
  visualReviewCreateCandidateOutputSchema,
  visualReviewDocumentInputSchema,
  visualReviewExportReviewPacketOutputSchema,
  visualReviewOpenInputSchema,
  visualReviewOpenOutputSchema,
  visualReviewReadImageInputSchema,
  visualReviewReadImageOutputSchema,
  visualReviewRevisionDecisionInputSchema,
  visualReviewRevisionDecisionOutputSchema,
  visualReviewSaveAnnotationsInputSchema,
  visualReviewSaveAnnotationsOutputSchema,
  visualReviewUpdateContextInputSchema,
  visualReviewUpdateContextOutputSchema
} from './contract.js'
import {
  acceptVisualCandidateRevision,
  abortPreparedVisualCandidateAcceptance,
  applyVisualStyleReference,
  createVisualCandidateRevision,
  exportVisualReviewPacket,
  openVisualReviewDocument,
  preflightVisualCandidateAcceptance,
  readVisualReviewImage,
  rejectVisualCandidateRevision,
  saveVisualDocumentAnnotations,
  updateVisualDocumentContext
} from './main/service.js'
import type { VisualNode } from './types.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'workspace-write' | 'destructive'

type VisualReviewCapabilityContext = Readonly<{
  caller: Readonly<{ workspaceId?: string }>
}>

export type VisualReviewCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'workspace'
  effect: CapabilityEffect
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none' | 'optimistic'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: VisualReviewCapabilityContext
  ) => Promise<{ output: unknown }> | { output: unknown }
}>

export type VisualReviewServicePort = Readonly<{
  open: typeof openVisualReviewDocument
  readImage: typeof readVisualReviewImage
  updateContext: typeof updateVisualDocumentContext
  applyStyleReference: typeof applyVisualStyleReference
  saveAnnotations: typeof saveVisualDocumentAnnotations
  exportReviewPacket: typeof exportVisualReviewPacket
  createCandidate: typeof createVisualCandidateRevision
  preflightAcceptCandidate: typeof preflightVisualCandidateAcceptance
  abortPreparedAcceptance: typeof abortPreparedVisualCandidateAcceptance
  acceptCandidate: typeof acceptVisualCandidateRevision
  rejectCandidate: typeof rejectVisualCandidateRevision
}>

export type VisualReviewCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: string
  policy: Readonly<{
    id: 'visual-review'
    title: 'Visual Review'
    directTransportPrefixes: readonly ['visual-document:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export function createVisualReviewCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  moduleId?: string
  defineCapability: (options: VisualReviewCapabilityOptions) => CapabilityDefinition
  getService: () => VisualReviewServicePort
  commitArtifactVersion?: (
    input: ArtifactVersionCommitInputV1,
    workspaceRoot: string
  ) => Promise<ArtifactVersionCommitResultV1>
  readArtifactVersion?: (
    input: ArtifactVersionReadInputV1,
    workspaceRoot: string
  ) => Promise<ArtifactVersionReadResultV1>
}>): VisualReviewCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<VisualReviewCapabilityOptions, 'version' | 'scope' | 'tags'> &
      Readonly<{ tags?: readonly string[] }>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    scope: 'workspace',
    tags: ['visual-review', 'image', 'annotation', ...(input.tags ?? [])],
    async handler(value, context) {
      const result = await input.handler(value, context)
      const document = (result.output as { document?: import('./types.js').VisualDocument })?.document
      if (document) await verifyDocumentSources(document, requireWorkspace(context))
      return result
    }
  })

  async function verifyDocumentSources(document: import('./types.js').VisualDocument, root: string): Promise<void> {
    if (document.artifact?.versionRef) await requireVerifiedArtifactVersion(options.readArtifactVersion, root, document.artifact.versionRef, visualArtifactVersionKind(document.artifact.kind), false)
    for (const revision of document.revisions ?? []) {
      if (!revision.versionRef) {
        // Candidate sources are already visible before acceptance. Check their
        // own source permissions, even when the document image is public.
        for (const ref of revision.modelSource?.referenceVersions ?? []) {
          await requireVerifiedArtifactVersion(options.readArtifactVersion, root, ref, undefined, false)
        }
        continue
      }
      const version = await requireVerifiedArtifactVersion(options.readArtifactVersion, root, revision.versionRef, visualArtifactVersionKind(document.artifact!.kind), false)
      const receipts = (version.version.dependencies ?? []).filter((dependency) => dependency.role === 'model-execution')
      if (!receipts.length) { delete revision.modelSource; continue }
      if (receipts.length !== 1) throw new Error('Model receipt dependency is ambiguous.')
      const receipt = await requireVerifiedArtifactVersion(options.readArtifactVersion, root, receipts[0]!.target, 'model-execution-receipt', false)
      const bytes = Buffer.from(receipt.dataBase64, 'base64')
      if (bytes.length !== receipt.ref.byteLength || createHash('sha256').update(bytes).digest('hex') !== receipt.ref.contentDigest) throw new Error('Model receipt byte digest mismatch.')
      const source = visualModelSourceSchema.parse(JSON.parse(bytes.toString('utf8')))
      if (source.outputHash !== revision.versionRef.contentDigest
        || createHash('sha256').update(source.request.prompt).digest('hex') !== source.request.promptHash) throw new Error('Model receipt output or prompt digest mismatch.')
      const inputs = receipt.version.dependencies.filter((dependency) => dependency.role === 'model-input')
      if (inputs.length !== source.request.references.length) throw new Error('Model receipt input dependencies are incomplete.')
      for (const [index, dependency] of inputs.entries()) {
        const expected = source.request.references[index]!
        const input = await requireVerifiedArtifactVersion(options.readArtifactVersion, root, dependency.target, 'model-input', false)
        const captured = Buffer.from(input.dataBase64, 'base64')
        if (captured.length !== expected.byteLength || createHash('sha256').update(captured).digest('hex') !== expected.contentDigest) throw new Error('Model receipt input digest mismatch.')
      }
      revision.modelSource = source
    }
  }

  return Object.freeze({
    moduleId: options.moduleId ?? 'scientific-plotting',
    policy: Object.freeze({
      id: 'visual-review' as const,
      title: 'Visual Review' as const,
      directTransportPrefixes: Object.freeze(['visual-document:']) as readonly ['visual-document:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.open,
        title: 'Open Visual Review document',
        description: 'Opens or creates the canonical Visual Review document and optionally stages one source artifact.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewOpenInputSchema,
        outputSchema: visualReviewOpenOutputSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          if (input.artifact?.versionRef) {
            await requireVerifiedArtifactVersion(
              options.readArtifactVersion,
              workspaceRoot,
              input.artifact.versionRef,
              visualArtifactVersionKind(input.artifact.kind)
            )
          }
          const opened = await options.getService().open({
            workspaceRoot,
            documentId: input.documentId,
            ...(input.artifact ? { artifact: input.artifact } : {})
          })
          const { changed, ...output } = opened
          void changed
          return { output }
        }
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
        title: 'Read Visual Review document',
        description: 'Reads one existing canonical Visual Review document without creating it.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: visualReviewDocumentInputSchema,
        outputSchema: visualReviewOpenOutputSchema,
        handler: async (input, context) => {
          const opened = await options.getService().open({
            workspaceRoot: requireWorkspace(context),
            documentId: input.documentId,
            createIfMissing: false
          })
          const { changed: _changed, ...output } = opened
          return { output }
        }
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.readImage,
        title: 'Read Visual Review image',
        description: 'Reads one bounded workspace image for the package-owned review surface.',
        audiences: ['ui'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: visualReviewReadImageInputSchema,
        outputSchema: visualReviewReadImageOutputSchema,
        handler: async (input, context) => {
          const root = requireWorkspace(context)
          if (input.versionRef) {
            const version = await requireVerifiedArtifactVersion(options.readArtifactVersion, root, input.versionRef, undefined, false)
            const bytes = Buffer.from(version.dataBase64, 'base64')
            if (!version.ref.mediaType?.startsWith('image/') || bytes.length !== version.ref.byteLength
              || createHash('sha256').update(bytes).digest('hex') !== version.ref.contentDigest
              || (input.expectedHash && input.expectedHash !== version.ref.contentDigest)) throw new Error('Versioned review image digest or media type mismatch.')
            return { output: { ok: true, dataUrl: `data:${version.ref.mediaType};base64,${bytes.toString('base64')}` } }
          }
          return { output: await options.getService().readImage({ workspaceRoot: root, path: input.path, expectedHash: input.expectedHash }) }
        }
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
        title: 'Update Visual Review context',
        description: 'Updates the canonical visual nodes, truth locks, or style reference.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewUpdateContextInputSchema,
        outputSchema: visualReviewUpdateContextOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().updateContext({
            workspaceRoot: requireWorkspace(context),
            ...input,
            ...(input.nodes ? { nodes: input.nodes as VisualNode[] } : {})
          })
        })
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
        title: 'Apply Visual Review style reference',
        description: 'Extracts a manuscript visual style from one reference image and applies it to the current Visual Review document.',
        audiences: ['ui'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewApplyStyleReferenceInputSchema,
        outputSchema: visualReviewApplyStyleReferenceOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().applyStyleReference({
            workspaceRoot: requireWorkspace(context),
            ...input
          })
        })
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
        title: 'Save Visual Review annotations',
        description: 'Replaces the structured annotation set for one Visual Review document.',
        audiences: ['ui'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewSaveAnnotationsInputSchema,
        outputSchema: visualReviewSaveAnnotationsOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().saveAnnotations({
            workspaceRoot: requireWorkspace(context),
            ...input
          })
        })
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
        title: 'Export Visual Review packet',
        description: 'Exports the current open annotations and immutable source context for revision.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewDocumentInputSchema,
        outputSchema: visualReviewExportReviewPacketOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().exportReviewPacket({
            workspaceRoot: requireWorkspace(context),
            ...input
          })
        })
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
        title: 'Create Visual Review candidate',
        description: 'Stages one non-destructive candidate after validated image-generation QA.',
        audiences: ['agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewCreateCandidateInputSchema,
        outputSchema: visualReviewCreateCandidateOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().createCandidate({
            workspaceRoot: requireWorkspace(context),
            ...input
          })
        })
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
        title: 'Accept Visual Review candidate',
        description: 'Atomically accepts the active candidate and preserves the previous image as a backup.',
        audiences: ['ui'],
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewRevisionDecisionInputSchema,
        outputSchema: visualReviewRevisionDecisionOutputSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          const commitArtifactVersion = options.commitArtifactVersion
          if (!commitArtifactVersion) {
            throw new Error('Artifact Versions capability is unavailable; refusing to accept an unversioned candidate.')
          }
          const service = options.getService()
          const decision = {
            workspaceRoot,
            documentId: input.documentId,
            revisionId: input.revisionId
          }
          const preflight = await service.preflightAcceptCandidate(decision)
          if (preflight.alreadyAccepted) {
            return { output: preflight.alreadyAccepted, changed: false }
          }
          const { artifact, candidate } = preflight
          let bytes: Buffer
          try {
            bytes = await readFile(candidate.artifactPath)
            const digest = createHash('sha256').update(bytes).digest('hex')
            if (digest !== candidate.artifactHash || digest !== candidate.reviewEvidence.reviewedArtifactHash) {
              throw new Error('Candidate bytes no longer match the reviewed artifact; refusing to version them.')
            }
          } catch (error) {
            if (!preflight.committedVersionRef) {
              if (preflight.newlyPrepared !== false) await service.abortPreparedAcceptance(decision)
            }
            throw error
          }
          if (preflight.committedVersionRef) {
            await requireVerifiedArtifactVersion(
              options.readArtifactVersion,
              workspaceRoot,
              preflight.committedVersionRef,
              visualArtifactVersionKind(artifact.kind),
              false
            )
            return {
              output: await service.acceptCandidate({
                workspaceRoot,
                ...input,
                artifactVersionRef: preflight.committedVersionRef
              })
            }
          }
          const currentRef = artifact.versionRef
          let currentVersion: Awaited<ReturnType<typeof requireVerifiedArtifactVersion>> | undefined
          try {
            currentVersion = currentRef && preflight.newlyPrepared !== false
              ? await requireVerifiedArtifactVersion(
                  options.readArtifactVersion,
                  workspaceRoot,
                  currentRef,
                  visualArtifactVersionKind(artifact.kind)
                )
              : undefined
          } catch (error) {
            if (preflight.newlyPrepared !== false) await service.abortPreparedAcceptance(decision)
            throw error
          }
          let sourceCommit: Awaited<ReturnType<typeof modelSourceCandidates>>
          try {
            sourceCommit = await modelSourceCandidates(candidate.modelSource, candidate.id, candidate.artifactHash, currentRef, workspaceRoot, options.readArtifactVersion)
          } catch (error) {
            if (preflight.newlyPrepared !== false) await service.abortPreparedAcceptance(decision)
            throw error
          }
          const commitInput: ArtifactVersionCommitInputV1 = {
            idempotencyKey: `visual-review:${preflight.document.documentId}:${candidate.id}:accept`,
            candidates: [{
              candidateId: `visual-review:${candidate.id}`,
              ...(currentRef ? { artifactId: currentRef.artifactId } : {}),
              expectedCurrentVersionId: currentRef?.versionId ?? null,
              kind: currentVersion?.artifact.kind ?? visualArtifactVersionKind(artifact.kind),
              label: artifact.title ?? `Visual Review ${preflight.document.documentId}`,
              intent: 'save',
              content: {
                mode: 'snapshot',
                dataBase64: bytes.toString('base64'),
                ...(artifact.mimeType ? { mediaType: artifact.mimeType } : {})
              },
              dependencies: [
                ...(currentRef ? [{ role: 'reviewed-from', required: true, target: { kind: 'version' as const, ref: currentRef } }] : []),
                ...(sourceCommit.candidates.length ? [{ role: 'model-execution', required: true,
                  target: { kind: 'candidate' as const, candidateId: `visual-review:${candidate.id}:receipt` } }] : [])
              ],
              accessPolicy: sourceCommit.accessPolicy,
              metadata: {
                producer: 'visual-review',
                documentId: preflight.document.documentId,
                revisionId: candidate.id,
                reviewEvidenceDigest: candidate.reviewEvidence.reviewedArtifactHash
              }
            }, ...sourceCommit.candidates]
          }
          const committed = await commitArtifactVersion(commitInput, workspaceRoot)
          if (!committed.ok) {
            if (preflight.newlyPrepared !== false) await service.abortPreparedAcceptance(decision)
            throw new Error(`Artifact version commit failed (${committed.issue.code}): ${committed.issue.message}`)
          }
          const committedItem = committed.value.versions.find((item) => item.candidateId === `visual-review:${candidate.id}`)
          if (!committedItem) throw new Error('Artifact version commit returned no version reference.')
          return {
            output: await service.acceptCandidate({
              workspaceRoot,
              ...input,
              artifactVersionRef: committedItem.ref
            })
          }
        }
      }),
      define({
        id: VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate,
        title: 'Reject Visual Review candidate',
        description: 'Rejects the active candidate without replacing the source image.',
        audiences: ['ui'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: visualReviewRevisionDecisionInputSchema,
        outputSchema: visualReviewRevisionDecisionOutputSchema,
        handler: async (input, context) => ({
          output: await options.getService().rejectCandidate({
            workspaceRoot: requireWorkspace(context),
            ...input
          })
        })
      })
    ]
  })
}

function requireWorkspace(context: VisualReviewCapabilityContext): string {
  const workspaceRoot = context.caller.workspaceId?.trim()
  if (!workspaceRoot) throw new Error('Visual Review requires a workspace-scoped caller.')
  return workspaceRoot
}

function visualArtifactVersionKind(kind: string): string {
  if (kind === 'scientific_plot') return 'scientific-plot'
  if (kind === 'presentation_slide') return 'presentation-slide'
  return 'figure'
}

async function requireVerifiedArtifactVersion(
  read: ((
    input: ArtifactVersionReadInputV1,
    workspaceRoot: string
  ) => Promise<ArtifactVersionReadResultV1>) | undefined,
  workspaceRoot: string,
  expected: ArtifactVersionRefV1,
  expectedKind: string | undefined,
  requireCurrent = true
) {
  if (!read) {
    throw new Error('Artifact Versions read capability is unavailable; refusing an unverified version binding.')
  }
  const result = await read({ versionId: expected.versionId }, workspaceRoot)
  if (!result.ok) {
    throw new Error(`ArtifactVersion verification failed (${result.issue.code}): ${result.issue.message}`)
  }
  if (JSON.stringify(result.value.ref) !== JSON.stringify(expected)) {
    throw new Error('ArtifactVersion verification returned a different immutable reference.')
  }
  if (expectedKind && result.value.artifact.kind !== expectedKind) {
    throw new Error(`Visual artifact kind does not match ArtifactVersion kind ${result.value.artifact.kind}.`)
  }
  if (requireCurrent && result.value.artifact.currentVersionId !== expected.versionId) {
    throw new Error('Visual Review requires the bound ArtifactVersion to be current.')
  }
  return result.value
}
