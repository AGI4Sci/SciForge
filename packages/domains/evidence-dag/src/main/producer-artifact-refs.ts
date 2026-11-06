import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ArtifactVersionReadPortV1, ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'

/** Validate every producer-named immutable ref and its bytes at the public read port. */
export async function verifyProducerArtifactRefs(
  refs: readonly ArtifactVersionRefV1[], readPort: ArtifactVersionReadPortV1
): Promise<void> {
  if (refs.length > 1_024) throw new Error('Producer provenance exceeds the exact version-ref limit.')
  if (refs.reduce((total, ref) => total + ref.byteLength, 0) > 256 * 1024 * 1024) {
    throw new Error('Producer provenance exceeds the exact byte-validation budget.')
  }
  for (const expected of refs) {
    const result = await readPort.read({ versionId: expected.versionId })
    if (!result.ok) throw new Error(`Producer ArtifactVersion ${expected.versionId} is unavailable: ${result.issue.message}`)
    if (!isDeepStrictEqual(result.value.ref, expected)) {
      throw new Error(`Producer ArtifactVersion ${expected.versionId} does not match its exact ref.`)
    }
    const bytes = Buffer.from(result.value.dataBase64, 'base64')
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== expected.byteLength || digest !== expected.contentDigest) {
      throw new Error(`Producer ArtifactVersion ${expected.versionId} failed byte integrity validation.`)
    }
  }
}
