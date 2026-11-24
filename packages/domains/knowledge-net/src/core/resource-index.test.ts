import { describe, expect, it } from 'vitest'
import { knowledgeResourceSchema, type SealedResource } from '../resource-contract.js'
import { searchResources } from './resource-index.js'

const sealed = (id: string, override: Record<string, unknown> = {}): SealedResource => ({
  resourceId: id, versionId: `v-${id}`, contentDigest: 'a'.repeat(64), sealedAt: '2026-11-20T00:00:00Z',
  resource: knowledgeResourceSchema.parse({ schemaVersion: 1, name: 'Shared dataset', aliases: ['Example'],
    identifiers: [{ scheme: 'DOI', value: 'https://doi.org/10.1234/DATA' }], description: 'Images', dataTypes: ['image'],
    processingLevel: 'raw', locations: [], access: { mode: 'unknown', evidenceIds: [] }, paperLinks: [], evidence: [], checks: [], ...override })
})
const coverage = { coverage: 'complete' as const, coverageReasons: [], eventsScanned: 3, versionsScanned: 3, skipped: [] }

describe('resource index', () => {
  it('uses AND across fields and OR within tags, preserving separate identities', () => {
    const resources = [sealed('b'), sealed('a'), sealed('c', { dataTypes: ['fmri'] })]
    const result = searchResources(resources, { query: ' EXAMPLE ', dataTypes: ['image', 'behavior'], processingLevels: ['raw'] }, coverage)
    expect(result.resources.map((item) => item.resourceId)).toEqual(['a', 'b'])
    expect(searchResources(resources, { query: 'example', accessModes: ['open'] }, coverage).status).toBe('no_recorded_match')
    expect(result.duplicateCandidates[0]?.identifiers).toEqual([{ scheme: 'doi', value: '10.1234/data' }])
  })
  it('binds cursor to filters and current snapshot and rejects malformed cursors', () => {
    const resources = [sealed('b'), sealed('a'), sealed('c')]
    const page = searchResources(resources, { limit: 1 }, coverage)
    expect(page.resources[0]?.resourceId).toBe('a')
    expect(searchResources(resources, { limit: 1, cursor: page.nextCursor! }, coverage).resources[0]?.resourceId).toBe('b')
    expect(() => searchResources(resources, { query: 'changed', limit: 1, cursor: page.nextCursor! }, coverage)).toThrow(/cursor/)
    expect(() => searchResources(resources.slice(1), { limit: 1, cursor: page.nextCursor! }, coverage)).toThrow(/cursor/)
    expect(() => searchResources(resources, { cursor: 'garbage' }, coverage)).toThrow(/cursor/)
  })
  it('reports partial absence and parent problems without losing independent records', () => {
    const resources = [sealed('a', { parentResourceId: 'b' }), sealed('b', { parentResourceId: 'a' }), sealed('c', { parentResourceId: 'missing' })]
    expect(searchResources(resources, {}, coverage).relationIssues.map((item) => item.code)).toEqual(['parent_cycle', 'parent_cycle', 'unresolved_parent'])
    expect(searchResources([], {}, { ...coverage, coverage: 'partial', coverageReasons: ['event_limit'] }).status).toBe('coverage_unknown')
  })
  it('retains version and component distinctions in duplicate hints and case-sensitive accessions', () => {
    const resources = [sealed('a', { version: '1' }), sealed('b', { version: '2', parentResourceId: 'a' }),
      sealed('c', { identifiers: [{ scheme: 'accession', value: 'AbC' }] }),
      sealed('d', { identifiers: [{ scheme: 'accession', value: 'abc' }] })]
    const result = searchResources(resources, {}, coverage)
    expect(result.resources).toHaveLength(4)
    expect(result.duplicateCandidates).toHaveLength(1)
    expect(result.duplicateCandidates[0]).toMatchObject({ resourceId: 'a', otherResourceId: 'b' })
  })
})
