import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ArtifactVersionReadPortV1 } from '@sciforge/domain-artifact-versions/contract'
import type { EvidenceDagArtifactVersionProjectionV1, EvidenceDagArtifactVersionRecordV1, EvidenceDagSubmitClaimsInput, EvidenceDagSubmitClaimsOutput } from '../contract.js'
import { verifyArtifactVersionRef } from './artifact-version-client.js'

/** Explicit source assertions; verification of source bytes is not scientific review. */
export async function prepareSubmittedClaims(
  input: EvidenceDagSubmitClaimsInput,
  readPort: ArtifactVersionReadPortV1
): Promise<{ claims: EvidenceDagSubmitClaimsOutput['claims']; evidenceArtifactVersions: EvidenceDagArtifactVersionProjectionV1 }> {
  const sources = input.claims.flatMap(claim => claim.sources)
  if (sources.length > 1_024 || sources.reduce((total, source) => total + source.ref.byteLength, 0) > 256 * 1024 * 1024) {
    throw new Error('Claim provenance exceeds the exact validation budget.')
  }
  const versions: EvidenceDagArtifactVersionRecordV1[] = []
  const bytes = new Map<string, Buffer>()
  for (const source of sources) {
    const prior = versions.find(record => record.ref.versionId === source.ref.versionId)
    if (prior) {
      if (!isDeepStrictEqual(prior.ref, source.ref)) throw new Error('Conflicting immutable claim source reference.')
      continue
    }
    const verified = await verifyArtifactVersionRef(source.ref, input.workspaceRoot!, () => readPort)
    if (!verified.ok) throw new Error(verified.issue.message)
    versions.push(verified.record)
    bytes.set(source.ref.versionId, verified.bytes)
  }
  for (const source of sources) {
    const content = bytes.get(source.ref.versionId)!
    const quote = Buffer.from(source.quote, 'utf8')
    if (source.endByte > content.length || !content.subarray(source.startByte, source.endByte).equals(quote)) {
      throw new Error('Claim source quotation does not match its exact immutable byte range.')
    }
  }
  const claims = input.claims.map((claim, index) => ({
    id: `claim:${createHash('sha256').update(JSON.stringify([input.runtimeId, input.threadId, input.workspaceRoot, input.idempotencyKey, index])).digest('hex')}`,
    ...claim,
    reviewStatus: 'pending' as const
  }))
  return { claims, evidenceArtifactVersions: { status: 'ready', versions, lifecycleEvents: [] } }
}
