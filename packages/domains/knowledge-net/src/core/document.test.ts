import { describe, expect, it } from 'vitest'
import { buildKnowledgeDocument, renderKnowledgeDocument } from './document.js'
import type { KnowledgeRecord } from '../contract.js'

const records: KnowledgeRecord[] = [
  {
    schemaVersion: 1,
    paperId: 'p1',
    title: 'Alpha',
    concepts: [
      { term: 'concept A', definition: 'A means ...', provenance: { quote: 'A is ...' }, analogy: 'like a key' },
      { term: 'concept B', definition: 'B means ...' }
    ],
    conceptTargets: [{ term: 'target X' }],
    note: {
      definition: 'The paper defines ...',
      roleInPaper: 'central claim',
      argumentativeRelation: { relation: 'support', detail: 'supports the main thesis' },
      criticalExtension: 'extends prior work'
    }
  },
  {
    schemaVersion: 1,
    paperId: 'p1',
    concepts: [{ term: 'concept A', definition: 'A, duplicated from a later record' }],
    conceptTargets: []
  },
  { schemaVersion: 1, paperId: 'p2', concepts: [{ term: 'other', definition: 'x' }], conceptTargets: [] }
]

describe('buildKnowledgeDocument', () => {
  it('folds every record for one paper and deduplicates concepts by term', () => {
    const model = buildKnowledgeDocument(records, 'p1')
    expect(model.title).toBe('Alpha')
    expect(model.concepts.map((concept) => concept.term)).toEqual(['concept A', 'concept B'])
    // First observed definition wins.
    expect(model.concepts[0]!.definition).toBe('A means ...')
    expect(model.targets.map((target) => target.term)).toEqual(['target X'])
    expect(model.notes).toHaveLength(1)
  })

  it('uses the paper id as the title when no record has one', () => {
    expect(buildKnowledgeDocument(records, 'p2').title).toBe('p2')
  })
})

describe('renderKnowledgeDocument', () => {
  it('renders markdown with concepts, targets and the 4-layer note', () => {
    const markdown = renderKnowledgeDocument(records, 'p1', 'markdown')
    expect(markdown).toContain('# Alpha')
    expect(markdown).toContain('### concept A')
    expect(markdown).toContain('> Quote: "A is ..."')
    expect(markdown).toContain('- Analogy: like a key')
    expect(markdown).toContain('## Reading targets')
    expect(markdown).toContain('- target X')
    expect(markdown).toContain('**Role in paper**: central claim')
    expect(markdown).toContain('**Argumentative relation**: support — supports the main thesis')
    expect(markdown).toContain('**Critical extension**: extends prior work')
    // The duplicated second definition must not appear.
    expect(markdown).not.toContain('duplicated from a later record')
  })

  it('renders stable JSON for the same paper', () => {
    const json = renderKnowledgeDocument(records, 'p1', 'json')
    const parsed = JSON.parse(json) as { paperId: string; concepts: Array<{ term: string }> }
    expect(parsed.paperId).toBe('p1')
    expect(parsed.concepts.map((concept) => concept.term)).toEqual(['concept A', 'concept B'])
  })
})
