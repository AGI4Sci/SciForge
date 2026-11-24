import { describe, expect, it } from 'vitest'
import { buildKnowledgeGraph, countGraph, graphToGraphML, graphToJsonLd, paperNodeId, conceptNodeId } from './graph.js'
import type { KnowledgeRecord } from '../contract.js'

const records: KnowledgeRecord[] = [
  {
    schemaVersion: 1,
    paperId: 'p1',
    title: 'Alpha',
    concepts: [
      { term: 'concept A', definition: 'A means ...' },
      { term: 'concept B', definition: 'B means ...', subConcept: { term: 'concept C', definition: 'C means ...' } }
    ],
    conceptTargets: [{ term: 'concept D' }]
  },
  {
    schemaVersion: 1,
    paperId: 'p2',
    concepts: [{ term: 'concept A', definition: 'A, from a second paper' }],
    conceptTargets: []
  }
]

describe('buildKnowledgeGraph', () => {
  it('joins papers to the concepts they explain and target, deduplicating nodes and edges', () => {
    const graph = buildKnowledgeGraph(records)
    const ids = new Set(graph.nodes.map((node) => node.id))
    expect(ids.has(paperNodeId('p1'))).toBe(true)
    expect(ids.has(paperNodeId('p2'))).toBe(true)
    expect(ids.has(conceptNodeId('concept A'))).toBe(true)
    expect(ids.has(conceptNodeId('concept C'))).toBe(true)
    expect(ids.has(conceptNodeId('concept D'))).toBe(true)
    // concept A is shared by two papers but appears once as a node.
    expect(graph.nodes.filter((node) => node.id === conceptNodeId('concept A'))).toHaveLength(1)
    expect(countGraph(graph)).toEqual({ papers: 2, concepts: 4, resources: 0, explains: 4, targets: 1, uses: 0, produces: 0, mentions: 0, part_of: 0 })
    // concept A is explained by both papers.
    const explainsA = graph.edges.filter((edge) => edge.relation === 'explains' && edge.to === conceptNodeId('concept A'))
    expect(explainsA.map((edge) => edge.from).sort()).toEqual([paperNodeId('p1'), paperNodeId('p2')])
  })

  it('returns a deterministic node and edge order', () => {
    const first = buildKnowledgeGraph(records)
    const second = buildKnowledgeGraph(records)
    expect(first.nodes).toEqual(second.nodes)
    expect(first.edges).toEqual(second.edges)
  })
})

describe('graphToGraphML', () => {
  it('escapes XML metacharacters and emits both node and edge data', () => {
    const graph = buildKnowledgeGraph([
      { schemaVersion: 1, paperId: 'p<1>', title: 'A & B', concepts: [{ term: 'x', definition: 'y' }], conceptTargets: [] }
    ])
    const xml = graphToGraphML(graph)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('key="relation"')
    expect(xml).toContain('<edge source="paper:p&lt;1&gt;"')
  })
})

describe('graphToJsonLd', () => {
  it('projects papers and concepts as schema.org types with relation edges', () => {
    const graph = buildKnowledgeGraph(records)
    const parsed = JSON.parse(graphToJsonLd(graph)) as { '@context': unknown; '@graph': Array<Record<string, unknown>> }
    expect(parsed['@context']).toBeDefined()
    const papers = parsed['@graph'].filter((node) => node['@type'] === 'ScholarlyArticle')
    const concepts = parsed['@graph'].filter((node) => node['@type'] === 'DefinedTerm')
    expect(papers).toHaveLength(2)
    expect(concepts).toHaveLength(4)
    const p1 = papers.find((node) => node['@id'] === paperNodeId('p1'))!
    expect(p1.explains).toContain(conceptNodeId('concept A'))
    expect(p1.targets).toEqual([conceptNodeId('concept D')])
  })
})
