import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { ArtifactVersionAccessPolicyV1, ArtifactVersionCommitInputV1, ArtifactVersionReadInputV1, ArtifactVersionReadResultV1, ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import { visualModelSourceSchema, type VisualModelSource } from '../model-source.js'
import { resolveOpenTargetPath } from '../../worker/workspace-paths.js'

type Read = (input: ArtifactVersionReadInputV1, root: string) => Promise<ArtifactVersionReadResultV1>
function inheritedPolicy(refs: readonly ArtifactVersionRefV1[]): ArtifactVersionAccessPolicyV1 {
  if (refs.length === 1) return { ...refs[0]!.accessPolicy, principals: [...refs[0]!.accessPolicy.principals] }
  const restricted = refs.filter((ref) => ref.accessPolicy.visibility === 'restricted')
  const principals = restricted.length
    ? restricted[0]!.accessPolicy.principals.filter((id) => restricted.every((ref) => ref.accessPolicy.principals.includes(id)))
    : []
  if (restricted.length && !principals.length) throw new Error('Source access policies have no common permitted principal.')
  return { visibility: restricted.length ? 'restricted' : refs.length && refs.every((ref) => ref.accessPolicy.visibility === 'public') ? 'public' : 'workspace', principals,
    allowExport: refs.every((ref) => ref.accessPolicy.allowExport) }
}

export async function modelSourceCandidates(
  sourceInput: VisualModelSource | undefined, revisionId: string, outputHash: string,
  currentRef: ArtifactVersionRefV1 | undefined, root: string, read: Read | undefined
): Promise<{ candidates: ArtifactVersionCommitInputV1['candidates']; accessPolicy: ArtifactVersionAccessPolicyV1 }> {
  if (!sourceInput) return { candidates: [], accessPolicy: inheritedPolicy(currentRef ? [currentRef] : []) }
  const source = visualModelSourceSchema.parse(sourceInput)
  if (source.outputHash !== outputHash || createHash('sha256').update(source.request.prompt).digest('hex') !== source.request.promptHash) {
    throw new Error('Model receipt does not match the candidate or prompt digest.')
  }
  const verified: ArtifactVersionRefV1[] = []
  for (const ref of source.referenceVersions) {
    if (!read) throw new Error('Artifact Versions read capability is required for model input permissions.')
    const result = await read({ versionId: ref.versionId }, root)
    if (!result.ok) throw new Error(`Model input read failed (${result.issue.code}): ${result.issue.message}`)
    if (JSON.stringify(result.value.ref) !== JSON.stringify(ref)) throw new Error('Model input immutable reference mismatch.')
    const bytes = Buffer.from(result.value.dataBase64, 'base64')
    if (bytes.length !== ref.byteLength || createHash('sha256').update(bytes).digest('hex') !== ref.contentDigest) throw new Error('Model input version byte digest mismatch.')
    verified.push(ref)
  }
  const accessPolicy = inheritedPolicy([...new Map([...(currentRef ? [currentRef] : []), ...verified].map((ref) => [ref.versionId, ref])).values()])
  const candidates: ArtifactVersionCommitInputV1['candidates'] = []
  for (const [index, input] of source.request.references.entries()) {
    const matching = verified.filter((ref) => ref.contentDigest === input.contentDigest && ref.byteLength === input.byteLength)
    const verifiedDerivation = input.origin === 'derived' && input.derivedFrom?.length
      && input.derivedFrom.every((digest) => verified.some((ref) => ref.contentDigest === digest))
    if (!matching.length && !verifiedDerivation) throw new Error('Model input permission is unknown: supply its exact referenceVersionRefs; path snapshots do not establish access rights.')
    const path = await resolveOpenTargetPath(input.snapshotPath, root, { allowBasenameFallback: false })
    if ((await stat(path)).size !== input.byteLength) throw new Error('Captured model input digest mismatch (byte length).')
    const bytes = await readFile(path)
    if (bytes.length !== input.byteLength || createHash('sha256').update(bytes).digest('hex') !== input.contentDigest) throw new Error('Captured model input digest mismatch.')
    const lineage = matching.length ? matching : verified.filter((ref) => input.derivedFrom?.includes(ref.contentDigest))
    candidates.push({ candidateId: `visual-review:${revisionId}:input:${index}`, kind: 'model-input', intent: 'save', expectedCurrentVersionId: null,
      content: { mode: 'snapshot', dataBase64: bytes.toString('base64'), mediaType: input.mediaType }, accessPolicy,
      dependencies: lineage.map((ref) => ({ role: matching.length ? 'captured-from' : 'derived-from', required: true, target: { kind: 'version' as const, ref } })) })
  }
  candidates.push({ candidateId: `visual-review:${revisionId}:receipt`, kind: 'model-execution-receipt', intent: 'save', expectedCurrentVersionId: null,
    content: { mode: 'snapshot', dataBase64: Buffer.from(JSON.stringify(source)).toString('base64'), mediaType: 'application/json' }, accessPolicy,
    dependencies: candidates.map((input) => ({ role: 'model-input', required: true, target: { kind: 'candidate' as const, candidateId: input.candidateId } })) })
  return { candidates, accessPolicy }
}
