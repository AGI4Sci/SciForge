import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_LIBRARY_KIND, KNOWLEDGE_RECORD_KIND } from './contract.js'
import { definitionBytes, deriveKnowledgeIndex, deriveKnowledgeState, sha256 } from './derive.js'

const resource = { schemaVersion: 1, name: 'Dataset', aliases: [], identifiers: [], description: 'Test',
  dataTypes: ['image'], processingLevel: 'unknown', locations: [], access: { mode: 'unknown', evidenceIds: [] },
  paperLinks: [], evidence: [], checks: [] }

type Stored = { artifactId: string; versionId: string; kind: string; bytes: Buffer; digest?: string; paperId?: string }

function ports(items: Stored[]) {
  const events = items.map((item, i) => ({
    type: 'version-committed', artifactId: item.artifactId, versionId: item.versionId, sequence: i + 1
  }))
  const byVersion = new Map(items.map((item) => [item.versionId, item]))
  return {
    eventPort: { listEvents: async () => ({ ok: true, value: { events, lastSequence: events.length } }) },
    readPort: {
      read: async ({ versionId }: { versionId: string }) => {
        const item = byVersion.get(versionId)
        if (!item) return { ok: false, issue: { message: 'missing' } }
        return {
          ok: true,
          value: {
            artifact: { artifactId: item.artifactId, kind: item.kind },
            version: { versionId: item.versionId, createdAt: '2026-11-20T00:00:00Z', metadata: item.paperId ? { paperId: item.paperId } : {}, storage: { mode: 'snapshot', contentDigest: item.digest ?? sha256(item.bytes) } },
            dataBase64: item.bytes.toString('base64')
          }
        }
      }
    }
  } as never
}

const record = (paperId: string, term: string) => ({
  schemaVersion: 1, paperId, concepts: [{ term, definition: `${term} defined.` }], conceptTargets: []
})
const stored = (artifactId: string, versionId: string, rec: unknown, extra: Partial<Stored> = {}): Stored =>
  ({ artifactId, versionId, kind: KNOWLEDGE_RECORD_KIND, bytes: definitionBytes(rec), ...extra })

describe('deriveKnowledgeIndex', () => {
  it('derives independent resource identities and newest snapshots without altering papers', async () => {
    const state = await deriveKnowledgeState(ports([
      stored('r1', 'rv1', resource, { kind: 'knowledge-net.resource' }),
      stored('p1', 'pv1', record('p1', 'Term')),
      stored('r1', 'rv2', { ...resource, name: 'Updated' }, { kind: 'knowledge-net.resource' }),
      stored('r2', 'rv3', resource, { kind: 'knowledge-net.resource' })
    ]))
    expect(state.resources.map((item) => [item.resourceId, item.versionId, item.resource.name])).toEqual([
      ['r2', 'rv3', 'Dataset'], ['r1', 'rv2', 'Updated']
    ])
    expect(state.records.map((item) => item.paperId)).toEqual(['p1'])
    expect(state.index.concepts.map((item) => item.term)).toEqual(['Term'])
  })
  it('withholds corrupt latest resource without resurrecting its older snapshot or suppressing notes', async () => {
    const state = await deriveKnowledgeState(ports([
      stored('p1', 'pv1', record('p1', 'Term')),
      stored('r1', 'rv1', resource, { kind: 'knowledge-net.resource' }),
      stored('r1', 'rv2', resource, { kind: 'knowledge-net.resource', digest: 'bad' })
    ]))
    expect(state.resources).toEqual([])
    expect(state.records).toHaveLength(1)
    expect(state.provenance.coverage).toBe('partial')
  })
  it('indexes sealed records and ignores other artifact kinds', async () => {
    const { index, provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Eccentricity bias')),
      stored('a2', 'v2', record('p2', 'ignored'), { kind: 'other.kind' })
    ]))
    expect(index.concepts.map((c) => c.term)).toEqual(['Eccentricity bias'])
    expect(provenance.records).toBe(1)
  })

  it('skips a version whose bytes do not match the recorded digest', async () => {
    const { index, provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Tampered'), { digest: 'f'.repeat(64) })
    ]))
    expect(index.concepts).toEqual([])
    expect(provenance.skipped).toEqual([{ versionId: 'v1', reason: 'content digest mismatch' }])
  })

  it('skips a record that fails the schema', async () => {
    const { provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', { schemaVersion: 1, paperId: 'p1', extra: true })
    ]))
    expect(provenance.skipped[0]?.reason).toBe('record fails the schema')
  })

  it('indexes only the newest version of an artifact', async () => {
    const { index } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Old term')),
      stored('a1', 'v2', record('p1', 'New term'))
    ]))
    expect(index.concepts.map((c) => c.term)).toEqual(['New term'])
  })

  it('indexes only the newest record of a paper sealed as separate artifacts', async () => {
    const { index, provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Old term')),
      stored('a2', 'v2', record('p2', 'Other paper term')),
      stored('a3', 'v3', record('p1', 'New term'))
    ]))
    expect(index.concepts.map((c) => c.term).sort()).toEqual(['New term', 'Other paper term'])
    expect(provenance.records).toBe(2)
  })

  it('withholds an old explanation when a newer record for the paper is invalid', async () => {
    const { index, provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Valid term')),
      stored('other', 'vo', record('p2', 'Independent current term')),
      stored('a2', 'v2', { schemaVersion: 1, paperId: 'p1', extra: true })
    ]))
    expect(index.concepts.map((c) => c.term)).toEqual(['Independent current term'])
    expect(provenance.coverage).toBe('partial')
  })

  it('keeps newer valid notes but withholds unproven older notes after an unidentified corrupt candidate', async () => {
    const { index, provenance } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Old unproven term')),
      stored('a2', 'v2', record('p1', 'Unreadable term'), { digest: 'bad' }),
      stored('a3', 'v3', record('p2', 'New known term'))
    ]))
    expect(index.concepts.map((c) => c.term)).toEqual(['New known term'])
    expect(provenance.coverage).toBe('partial')
  })

  it('uses sealed metadata to withhold only the affected paper when its bytes are corrupt', async () => {
    const { index } = await deriveKnowledgeIndex(ports([
      stored('a1', 'v1', record('p1', 'Old term')),
      stored('other', 'vo', record('p2', 'Unrelated term')),
      stored('a2', 'v2', record('p1', 'Corrupt term'), { digest: 'bad', paperId: 'p1' })
    ]))
    expect(index.concepts.map((c) => c.term)).toEqual(['Unrelated term'])
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(deriveKnowledgeIndex({ ...(ports([]) as object), signal: controller.signal } as never))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reads sealed library imports next to records, newest first', async () => {
    const lib = (title: string) => ({
      schemaVersion: 1, source: { path: 'a.bib', format: 'bibtex' },
      entries: [{ paperId: 'p1', title, authors: [] }]
    })
    const state = await deriveKnowledgeState(ports([
      stored('l1', 'vl1', lib('Old title'), { kind: KNOWLEDGE_LIBRARY_KIND }),
      stored('r1', 'vr1', record('p1', 'Term')),
      stored('l2', 'vl2', lib('New title'), { kind: KNOWLEDGE_LIBRARY_KIND })
    ]))
    expect(state.libraries.map((l) => l.entries[0]!.title)).toEqual(['New title', 'Old title'])
    expect(state.records.map((r) => r.paperId)).toEqual(['p1'])
    expect(state.provenance).toMatchObject({ records: 1, libraries: 2 })
  })

  it('skips a library whose content fails the schema', async () => {
    const state = await deriveKnowledgeState(ports([
      stored('l1', 'vl1', { schemaVersion: 1, source: { path: 'a', format: 'bibtex' }, entries: [] }, { kind: KNOWLEDGE_LIBRARY_KIND })
    ]))
    expect(state.libraries).toEqual([])
    expect(state.provenance.skipped).toEqual([{ versionId: 'vl1', reason: 'library fails the schema' }])
  })
})


describe('derivation coverage', () => {
  it('marks a read cap and invalid versions as partial instead of proving absence', async () => {
    const limited = await deriveKnowledgeState({ ...(ports([
      stored('a1', 'v1', record('p1', 'Omitted')),
      stored('a2', 'v2', record('p2', 'Included'))
    ]) as object), limit: 1 } as never)
    expect(limited.index.concepts.map((c) => c.term)).toEqual(['Included'])
    expect(limited.provenance).toMatchObject({ coverage: 'partial', coverageReasons: ['version_limit'] })
    const corrupt = await deriveKnowledgeState(ports([stored('a', 'v', record('p', 'X'), { digest: 'bad' })]))
    expect(corrupt.provenance.coverage).toBe('partial')
  })

  it('does not return obsolete records from a bounded prefix of a longer event history', async () => {
    let reads = 0
    const state = await deriveKnowledgeState({
      eventPort: { listEvents: async ({ afterSequence }: { afterSequence: number }) => ({ ok: true, value: {
        events: Array.from({ length: 500 }, (_, i) => ({ sequence: afterSequence + i + 1, type: 'version-committed', artifactId: 'same', versionId: `v${afterSequence + i + 1}` })),
        lastSequence: afterSequence + 500
      } }) },
      readPort: { read: async () => { reads++; throw new Error('Must not read an unproven current version') } }
    } as never)
    expect(reads).toBe(0)
    expect(state.index.concepts).toEqual([])
    expect(state.provenance).toMatchObject({ coverage: 'partial', coverageReasons: ['event_limit'], eventsScanned: 2000 })
  })

  it('reports empty complete history distinctly and rejects invalid limits', async () => {
    expect((await deriveKnowledgeState(ports([]))).provenance.coverage).toBe('complete')
    await expect(deriveKnowledgeState({ ...(ports([]) as object), limit: 0 } as never)).rejects.toThrow('Invalid derivation limit')
  })
})
