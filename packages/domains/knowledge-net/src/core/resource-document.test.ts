import { expect, it } from 'vitest'
import { knowledgeResourceSchema, documentExportInputSchema, type SealedResource } from '../contract.js'
import { buildKnowledgeGraph, countGraph, graphToGraphML, graphToJsonLd } from './graph.js'
import { renderKnowledgeDocument } from './document.js'
import { renderResourceDocument } from './resource-document.js'

const item: SealedResource = { resourceId: 'r1', versionId: 'v1', contentDigest: 'a'.repeat(64), sealedAt: '2026-11-20T00:00:00Z',
  resource: knowledgeResourceSchema.parse({ schemaVersion: 1, name: 'Test dataset', aliases: [], identifiers: [], description: 'Example',
    parentResourceId: 'r0', dataTypes: ['image'], processingLevel: 'raw', locations: [], access: { mode: 'unknown', evidenceIds: [] },
    evidence: [{ evidenceId: 'e1', paperId: 'p1', quote: 'Dataset used', observedAt: '2026-11-20T00:00:00Z', actorLabel: 'test' }],
    paperLinks: [{ paperId: 'p1', relation: 'used', evidenceIds: ['e1'] }],
    checks: [{ checkId: 'c1', kind: 'retrieval', outcome: 'failed', evidenceIds: ['e1'], observedAt: '2026-11-20T00:00:00Z' }] }) }

it('exports resource relationships with unresolved references explicitly marked', () => {
  const graph = buildKnowledgeGraph([], [item])
  expect(graph.nodes.find((node) => node.id === 'paper:p1')).toMatchObject({ referenceOnly: true })
  expect(countGraph(graph)).toMatchObject({ resources: 2, uses: 1, part_of: 1 })
  expect(graphToGraphML(graph)).toContain('resource:r1')
  expect(graphToGraphML(graph)).toContain('Dataset used')
  const json = JSON.parse(graphToJsonLd(graph))
  expect(json['@graph'].find((node: any) => node['@id'] === 'paper:p1').uses).toEqual(['resource:r1'])
  expect(json['@graph'].find((node: any) => node['@id'] === 'resource:r1').part_of).toEqual(['resource:r0'])
  expect(json['@graph'].find((node: any) => node['@id'] === 'resource:r1').resourceSnapshot).toEqual(item)
})
it('exports full resource evidence and independent verification stages', () => {
  const markdown = renderResourceDocument(item, 'markdown')
  expect(markdown).toContain('unknown')
  expect(markdown).toContain('retrieval: failed')
  expect(markdown).toContain('Dataset used')
  expect(JSON.parse(renderResourceDocument(item, 'json'))).toEqual(item)
  expect(renderKnowledgeDocument([], 'p1', 'markdown', [item])).toContain('Test dataset')
  expect(JSON.parse(renderKnowledgeDocument([], 'p1', 'json', [item])).resources).toEqual([item])
})
it('accepts exactly one document identity', () => {
  expect(documentExportInputSchema.safeParse({ resourceId: 'r1' }).success).toBe(true)
  expect(documentExportInputSchema.safeParse({ paperId: 'p1' }).success).toBe(true)
  expect(documentExportInputSchema.safeParse({ paperId: 'p1', resourceId: 'r1' }).success).toBe(false)
  expect(documentExportInputSchema.safeParse({}).success).toBe(false)
})
