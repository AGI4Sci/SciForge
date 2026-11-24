import { createHash } from 'node:crypto'
import type {
  ArtifactVersionEventListPortV1,
  ArtifactVersionReadPortV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  KNOWLEDGE_LIBRARY_KIND,
  KNOWLEDGE_RECORD_KIND,
  knowledgeLibrarySchema,
  knowledgeRecordSchema,
  type KnowledgeLibrary,
  type KnowledgeRecord
} from './contract.js'
import { buildConceptIndex, type AnalysisSource, type ConceptIndex } from './core/concept-index.js'
import { KNOWLEDGE_RESOURCE_KIND, knowledgeResourceSchema, type SealedResource } from './resource-contract.js'

/** Bounds one derivation so a very large history cannot stall a lookup turn. */
export const MAX_DERIVATION_VERSIONS = 500
export const MAX_SEALED_BYTES = 4 * 1024 * 1024
const EVENT_PAGE = 500
const MAX_DERIVATION_EVENTS = 2000

export type DerivationCoverage = Readonly<{
  coverage: 'complete' | 'partial'
  coverageReasons: readonly string[]
  eventsScanned: number
}>

type Skipped = { versionId: string; reason: string }

export type KnowledgeState = Readonly<{
  index: ConceptIndex
  records: readonly KnowledgeRecord[]
  /** Sealed bibliography imports, newest first. */
  libraries: readonly KnowledgeLibrary[]
  resources: readonly SealedResource[]
  provenance: DerivationCoverage & Readonly<{
    versionsScanned: number
    records: number
    libraries: number
    resources: number
    skipped: readonly Skipped[]
  }>
}>

export type KnowledgeDerivation = Readonly<{
  index: ConceptIndex
  provenance: DerivationCoverage & Readonly<{ versionsScanned: number; records: number; skipped: readonly Skipped[] }>
}>

type DeriveOptions = Readonly<{
  eventPort: ArtifactVersionEventListPortV1
  readPort: ArtifactVersionReadPortV1
  limit?: number
  signal?: AbortSignal
}>

/**
 * Rebuilds the knowledge state from sealed Artifact Versions of kind
 * `knowledge-net.record` and `knowledge-net.library`. Read-only: a version whose
 * bytes do not match their recorded digest, or that fails its schema, is skipped
 * and reported, never trusted. Only the newest version of each artifact counts, and
 * of several records for the same `paperId` only the newest one.
 */
export async function deriveKnowledgeState(options: DeriveOptions): Promise<KnowledgeState> {
  const limit = options.limit ?? MAX_DERIVATION_VERSIONS
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DERIVATION_VERSIONS) throw new Error('Invalid derivation limit.')
  const coverageReasons: string[] = []
  let eventsScanned = 0
  const newestByArtifact = new Map<string, { artifactId: string; versionId: string; sequence: number }>()
  let afterSequence = 0
  for (;;) {
    throwIfAborted(options.signal)
    const page = await options.eventPort.listEvents({ afterSequence, limit: EVENT_PAGE })
    if (!page.ok) throw new Error(`Artifact version events are unavailable: ${page.issue.message}`)
    eventsScanned += page.value.events.length
    for (const event of page.value.events) {
      if (event.type !== 'version-committed') continue
      const previous = newestByArtifact.get(event.artifactId)
      if (!previous || event.sequence > previous.sequence) {
        newestByArtifact.set(event.artifactId, { artifactId: event.artifactId, versionId: event.versionId, sequence: event.sequence })
      }
    }
    if (page.value.events.length < EVENT_PAGE) break
    if (eventsScanned >= MAX_DERIVATION_EVENTS) { coverageReasons.push('event_limit'); break }
    if (page.value.lastSequence <= afterSequence) throw new Error('Artifact event cursor did not advance.')
    afterSequence = page.value.lastSequence
  }

  const skipped: Skipped[] = []
  const sources: AnalysisSource[] = []
  const records: KnowledgeRecord[] = []
  const libraries: KnowledgeLibrary[] = []
  const resources: SealedResource[] = []
  const seenPapers = new Set<string>()
  let unknownNewerRecord = false
  let scanned = 0
  // An incomplete event prefix cannot establish which versions are current. Do not resurrect superseded notes.
  const newest = coverageReasons.length ? [] : [...newestByArtifact.values()].sort((a, b) => b.sequence - a.sequence)
  if (newest.length > limit) coverageReasons.push('version_limit')
  for (const { artifactId, versionId } of newest) {
    if (scanned >= limit) break
    throwIfAborted(options.signal)
    scanned += 1
    const read = await options.readPort.read({ versionId, maxBytes: MAX_SEALED_BYTES })
    if (!read.ok) {
      skipped.push({ versionId, reason: `unreadable: ${read.issue.message}` })
      unknownNewerRecord = true
      continue
    }
    if (read.value.version.versionId !== versionId || read.value.artifact.artifactId !== artifactId) {
      skipped.push({ versionId, reason: 'artifact/version identity mismatch' })
      unknownNewerRecord = true
      continue
    }
    const kind = read.value.artifact.kind
    if (kind !== KNOWLEDGE_RECORD_KIND && kind !== KNOWLEDGE_LIBRARY_KIND && kind !== KNOWLEDGE_RESOURCE_KIND) continue
    const metadataPaper = read.value.version.metadata?.paperId
    const declaredPaper = typeof metadataPaper === 'string' && metadataPaper.trim() ? metadataPaper : undefined
    const withholdOlder = (paperId = declaredPaper) => {
      if (kind !== KNOWLEDGE_RECORD_KIND) return
      if (paperId) seenPapers.add(paperId)
      else unknownNewerRecord = true
    }
    const bytes = Buffer.from(read.value.dataBase64, 'base64')
    const storage = read.value.version.storage
    if (storage.mode !== 'snapshot') { skipped.push({ versionId, reason: 'not a sealed snapshot' }); withholdOlder(); continue }
    if (storage.contentDigest !== sha256(bytes)) {
      skipped.push({ versionId, reason: 'content digest mismatch' })
      withholdOlder()
      continue
    }
    let json: unknown
    try {
      json = JSON.parse(bytes.toString('utf8'))
    } catch {
      skipped.push({ versionId, reason: `${kind === KNOWLEDGE_RECORD_KIND ? 'record' : 'library'} is not valid JSON` })
      withholdOlder()
      continue
    }
    if (kind === KNOWLEDGE_RECORD_KIND) {
      const parsed = knowledgeRecordSchema.safeParse(json)
      if (!parsed.success) {
        skipped.push({ versionId, reason: 'record fails the schema' })
        const claimed = json && typeof json === 'object' && 'paperId' in json ? json.paperId : undefined
        withholdOlder(typeof claimed === 'string' && claimed.trim() ? claimed : declaredPaper)
        if (declaredPaper) seenPapers.add(declaredPaper)
        continue
      }
      if (declaredPaper && declaredPaper !== parsed.data.paperId) {
        skipped.push({ versionId, reason: 'paper metadata identity mismatch' })
        withholdOlder(parsed.data.paperId); withholdOlder(declaredPaper)
        continue
      }
      // `newest` is ordered newest first, so the first record seen for a paper is its
      // current one. Each commit seals a new artifact, so the same paper committed
      // twice must not keep the older definition next to the newer one.
      if (unknownNewerRecord || seenPapers.has(parsed.data.paperId)) continue
      seenPapers.add(parsed.data.paperId)
      records.push(parsed.data)
      sources.push({
        paperId: parsed.data.paperId,
        versionId,
        contentDigest: storage.mode === 'snapshot' ? storage.contentDigest : sha256(bytes),
        analysis: { concepts: parsed.data.concepts, conceptTargets: parsed.data.conceptTargets }
      })
    } else if (kind === KNOWLEDGE_RESOURCE_KIND) {
      const parsed = knowledgeResourceSchema.safeParse(json)
      if (!parsed.success || !Number.isFinite(Date.parse(read.value.version.createdAt))) {
        skipped.push({ versionId, reason: 'resource fails the schema' }); continue
      }
      resources.push({ resourceId: artifactId, versionId, contentDigest: storage.contentDigest,
        sealedAt: read.value.version.createdAt, resource: parsed.data })
    } else {
      const parsed = knowledgeLibrarySchema.safeParse(json)
      if (!parsed.success) { skipped.push({ versionId, reason: 'library fails the schema' }); continue }
      libraries.push(parsed.data)
    }
  }
  return {
    index: buildConceptIndex(sources),
    records,
    libraries,
    resources,
    provenance: { versionsScanned: scanned, records: records.length, libraries: libraries.length, resources: resources.length, skipped,
      eventsScanned, coverage: coverageReasons.length || skipped.length ? 'partial' : 'complete',
      coverageReasons: [...coverageReasons, ...(skipped.length ? ['unavailable_or_invalid_versions'] : [])] }
  }
}

/** The concept index alone; kept as the narrow entry point for lookup and annotate. */
export async function deriveKnowledgeIndex(options: DeriveOptions): Promise<KnowledgeDerivation> {
  const state = await deriveKnowledgeState(options)
  return {
    index: state.index,
    provenance: {
      coverage: state.provenance.coverage,
      coverageReasons: state.provenance.coverageReasons,
      eventsScanned: state.provenance.eventsScanned,
      versionsScanned: state.provenance.versionsScanned,
      records: state.provenance.records,
      skipped: state.provenance.skipped
    }
  }
}

/** Canonical JSON bytes of a sealed value, as committed. */
export function definitionBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('Knowledge derivation was cancelled.')
    error.name = 'AbortError'
    throw error
  }
}
