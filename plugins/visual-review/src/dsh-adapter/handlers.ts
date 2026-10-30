import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  artifactVersionCommitResultV1Schema,
  artifactVersionReadResultV1Schema,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadResultV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { VISUAL_REVIEW_CAPABILITY_IDS, type VisualNode } from '../core/contract.js'
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
} from '../core/service.js'
import { PORTS_VERSION, type Json, type VisualReviewPorts } from '../ports/visual-review-ports.js'
import {
  visualReviewAcceptCandidateWireSchema,
  visualReviewApplyStyleReferenceWireSchema,
  visualReviewCreateCandidateWireSchema,
  visualReviewExportReviewPacketWireSchema,
  visualReviewOpenWireSchema,
  visualReviewReadDocumentWireSchema,
  visualReviewReadImageWireSchema,
  visualReviewRejectCandidateWireSchema,
  visualReviewSaveAnnotationsWireSchema,
  visualReviewUpdateContextWireSchema
} from './wire.js'

/**
 * Handlers for the runtime-plugin entry. Each handler mirrors its static
 * adapter counterpart (packages/domains/visual-review/src/main.ts) with the
 * caller workspace arriving as input.workspaceRoot: the host extension bridge
 * binds it to the caller's workspace before dispatch (same guarantee as the
 * static path's context.caller.workspaceId), and the field is required so the
 * handlers also work when driven directly in tests.
 *
 * Artifact-bound handlers (exportReviewPacket/createCandidate/acceptCandidate,
 * plus open with an explicit artifact versionRef) need the host ports bridge
 * declared in src/ports/visual-review-ports.ts (#53 HOST-PORTS line). Until
 * the host injects VisualReviewPorts through setVisualReviewPorts(), they
 * fail closed — the named-runner contract gives plugin children no channel to
 * reach host capabilities, so an unversioned acceptance would be unrecoverable.
 */

export const HOST_PORTS_BRIDGE_ERROR =
  'Host ports bridge is not connected (visual-review artifact operations require the host bridge from #53 HOST-PORTS).'

let hostPorts: VisualReviewPorts | undefined

/** Injection seam for the future host bridge. Passing undefined resets to the
 * fail-closed pre-bridge state. */
export function setVisualReviewPorts(ports: VisualReviewPorts | undefined): void {
  hostPorts = ports
}

function requireVisualReviewPorts(): VisualReviewPorts {
  if (!hostPorts) throw new Error(HOST_PORTS_BRIDGE_ERROR)
  return hostPorts
}

type ArtifactCommitPort = (
  input: ArtifactVersionCommitInputV1,
  workspaceRoot: string
) => Promise<ArtifactVersionCommitResultV1>
type ArtifactReadPort = (
  input: ArtifactVersionReadInputV1,
  workspaceRoot: string
) => Promise<ArtifactVersionReadResultV1>

/** Adapts the injected VisualReviewPorts onto the static adapter's
 * commitArtifactVersion/readArtifactVersion port shape. workspaceRoot stays in
 * the signature for parity with the static path; the request itself omits
 * scope because the host bridge re-binds runtime/thread/workspace from the
 * authenticated invocation (never trusting tool input — see ports header). */
function commitArtifactVersionThroughPorts(ports: VisualReviewPorts): ArtifactCommitPort {
  return async (input, workspaceRoot) => {
    void workspaceRoot
    const response = await ports.request({
      protocol: PORTS_VERSION,
      requestId: randomUUID(),
      identity: ports.identity,
      operation: 'artifacts.commit',
      input: input as unknown as Json
    })
    const parsed = artifactVersionCommitResultV1Schema.safeParse(response)
    if (!parsed.success) {
      throw new Error('Visual Review host ports bridge returned a malformed artifacts.commit response.')
    }
    return parsed.data
  }
}

function readArtifactVersionThroughPorts(ports: VisualReviewPorts): ArtifactReadPort {
  return async (input, workspaceRoot) => {
    void workspaceRoot
    const response = await ports.request({
      protocol: PORTS_VERSION,
      requestId: randomUUID(),
      identity: ports.identity,
      operation: 'artifacts.read',
      input: input as unknown as Json
    })
    const parsed = artifactVersionReadResultV1Schema.safeParse(response)
    if (!parsed.success) {
      throw new Error('Visual Review host ports bridge returned a malformed artifacts.read response.')
    }
    return parsed.data
  }
}

function visualArtifactVersionKind(kind: string): string {
  if (kind === 'scientific_plot') return 'scientific-plot'
  if (kind === 'presentation_slide') return 'presentation-slide'
  return 'figure'
}

async function requireVerifiedArtifactVersion(
  read: ArtifactReadPort | undefined,
  workspaceRoot: string,
  expected: ArtifactVersionRefV1,
  expectedKind: string,
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
  if (result.value.artifact.kind !== expectedKind) {
    throw new Error(`Visual artifact kind does not match ArtifactVersion kind ${result.value.artifact.kind}.`)
  }
  if (requireCurrent && result.value.artifact.currentVersionId !== expected.versionId) {
    throw new Error('Visual Review requires the bound ArtifactVersion to be current.')
  }
  return result.value
}

export type PluginHandler = (input: any) => Promise<{ output: unknown }>

export const pluginHandlers: Readonly<Record<string, PluginHandler>> = Object.freeze({
  [VISUAL_REVIEW_CAPABILITY_IDS.open]: async (input) => {
    const parsed = visualReviewOpenWireSchema.parse(input)
    const { workspaceRoot, ...openInput } = parsed
    if (openInput.artifact?.versionRef) {
      const ports = requireVisualReviewPorts()
      await requireVerifiedArtifactVersion(
        readArtifactVersionThroughPorts(ports),
        workspaceRoot,
        openInput.artifact.versionRef,
        visualArtifactVersionKind(openInput.artifact.kind)
      )
    }
    const opened = await openVisualReviewDocument({ workspaceRoot, ...openInput })
    const { changed, ...output } = opened
    void changed
    return { output }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.readDocument]: async (input) => {
    const { workspaceRoot, ...documentInput } = visualReviewReadDocumentWireSchema.parse(input)
    const opened = await openVisualReviewDocument({
      workspaceRoot,
      ...documentInput,
      createIfMissing: false
    })
    const { changed: _changed, ...output } = opened
    return { output }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.readImage]: async (input) => {
    const { workspaceRoot, ...imageInput } = visualReviewReadImageWireSchema.parse(input)
    return { output: await readVisualReviewImage({ workspaceRoot, ...imageInput }) }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.updateContext]: async (input) => {
    const { workspaceRoot, ...contextInput } = visualReviewUpdateContextWireSchema.parse(input)
    return {
      output: await updateVisualDocumentContext({
        workspaceRoot,
        ...contextInput,
        ...(contextInput.nodes ? { nodes: contextInput.nodes as VisualNode[] } : {})
      })
    }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference]: async (input) => {
    const { workspaceRoot, ...styleInput } = visualReviewApplyStyleReferenceWireSchema.parse(input)
    return { output: await applyVisualStyleReference({ workspaceRoot, ...styleInput }) }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations]: async (input) => {
    const { workspaceRoot, ...annotationInput } = visualReviewSaveAnnotationsWireSchema.parse(input)
    return { output: await saveVisualDocumentAnnotations({ workspaceRoot, ...annotationInput }) }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket]: async (input) => {
    const { workspaceRoot, ...packetInput } = visualReviewExportReviewPacketWireSchema.parse(input)
    const ports = requireVisualReviewPorts()
    const exported = await exportVisualReviewPacket({ workspaceRoot, ...packetInput })
    // The packet is the orchestration handoff: publish it as an immutable
    // artifact version so the host-side revision orchestrator can address it.
    // The packet file is already durably written, so a commit failure leaves
    // an idempotent-retryable operation, never a silent unversioned export.
    const bytes = await readFile(exported.packetPath)
    const commitInput: ArtifactVersionCommitInputV1 = {
      idempotencyKey: `visual-review:packet:${exported.packet.packetId}:export`,
      candidates: [{
        candidateId: `visual-review:packet:${exported.packet.packetId}`,
        expectedCurrentVersionId: null,
        kind: 'review-packet',
        label: `Visual Review packet ${exported.packet.documentId}/${exported.packet.packetId}`,
        intent: 'publish',
        content: {
          mode: 'snapshot',
          dataBase64: bytes.toString('base64'),
          mediaType: 'application/json'
        },
        accessPolicy: { visibility: 'workspace', principals: [], allowExport: true },
        metadata: {
          producer: 'visual-review',
          documentId: exported.packet.documentId,
          packetId: exported.packet.packetId
        }
      }]
    }
    const committed = await commitArtifactVersionThroughPorts(ports)(commitInput, workspaceRoot)
    if (!committed.ok) {
      throw new Error(`Artifact version commit failed (${committed.issue.code}): ${committed.issue.message}`)
    }
    const committedItem = committed.value.versions[0]
    if (!committedItem) throw new Error('Artifact version commit returned no version reference.')
    return { output: { ...exported, versionRef: committedItem.ref } }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.createCandidate]: async (input) => {
    const { workspaceRoot, ...candidateInput } = visualReviewCreateCandidateWireSchema.parse(input)
    const ports = requireVisualReviewPorts()
    // The candidate pipeline completes only through the artifact-versions
    // bridge (acceptCandidate commits the reviewed bytes), so staging is
    // fail-closed without it. With the bridge, also verify that a bound base
    // artifact version is still current before staging on top of it.
    const opened = await openVisualReviewDocument({
      workspaceRoot,
      documentId: candidateInput.documentId,
      createIfMissing: false
    })
    if (opened.document.artifact?.versionRef) {
      await requireVerifiedArtifactVersion(
        readArtifactVersionThroughPorts(ports),
        workspaceRoot,
        opened.document.artifact.versionRef,
        visualArtifactVersionKind(opened.document.artifact.kind)
      )
    }
    return { output: await createVisualCandidateRevision({ workspaceRoot, ...candidateInput }) }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate]: async (input) => {
    const { workspaceRoot, ...decisionInput } = visualReviewAcceptCandidateWireSchema.parse(input)
    const ports = requireVisualReviewPorts()
    const commitArtifactVersion = commitArtifactVersionThroughPorts(ports)
    const readArtifactVersion = readArtifactVersionThroughPorts(ports)
    const decision = { workspaceRoot, ...decisionInput }
    const preflight = await preflightVisualCandidateAcceptance(decision)
    if (preflight.alreadyAccepted) {
      return { output: preflight.alreadyAccepted }
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
        await abortPreparedVisualCandidateAcceptance(decision)
      }
      throw error
    }
    if (preflight.committedVersionRef) {
      await requireVerifiedArtifactVersion(
        readArtifactVersion,
        workspaceRoot,
        preflight.committedVersionRef,
        visualArtifactVersionKind(artifact.kind),
        false
      )
      return {
        output: await acceptVisualCandidateRevision({
          workspaceRoot,
          ...decisionInput,
          artifactVersionRef: preflight.committedVersionRef
        })
      }
    }
    const currentRef = artifact.versionRef
    let currentVersion: Awaited<ReturnType<typeof requireVerifiedArtifactVersion>> | undefined
    try {
      currentVersion = currentRef && preflight.newlyPrepared !== false
        ? await requireVerifiedArtifactVersion(
            readArtifactVersion,
            workspaceRoot,
            currentRef,
            visualArtifactVersionKind(artifact.kind)
          )
        : undefined
    } catch (error) {
      await abortPreparedVisualCandidateAcceptance(decision)
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
        ...(currentRef ? {
          dependencies: [{
            role: 'reviewed-from',
            required: true,
            target: { kind: 'version', ref: currentRef }
          }]
        } : {}),
        accessPolicy: {
          visibility: 'workspace',
          principals: [],
          allowExport: true
        },
        metadata: {
          producer: 'visual-review',
          documentId: preflight.document.documentId,
          revisionId: candidate.id,
          reviewEvidenceDigest: candidate.reviewEvidence.reviewedArtifactHash
        }
      }]
    }
    const committed = await commitArtifactVersion(commitInput, workspaceRoot)
    if (!committed.ok) {
      await abortPreparedVisualCandidateAcceptance(decision)
      throw new Error(`Artifact version commit failed (${committed.issue.code}): ${committed.issue.message}`)
    }
    const committedItem = committed.value.versions[0]
    if (!committedItem) throw new Error('Artifact version commit returned no version reference.')
    return {
      output: await acceptVisualCandidateRevision({
        workspaceRoot,
        ...decisionInput,
        artifactVersionRef: committedItem.ref
      })
    }
  },

  [VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate]: async (input) => {
    const { workspaceRoot, ...decisionInput } = visualReviewRejectCandidateWireSchema.parse(input)
    return { output: await rejectVisualCandidateRevision({ workspaceRoot, ...decisionInput }) }
  }
})
