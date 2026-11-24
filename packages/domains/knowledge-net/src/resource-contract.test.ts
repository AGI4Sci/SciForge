import { describe, expect, it } from 'vitest'
import { knowledgeResourceSchema, resourceCommitInputSchema, validateResourceUpdate } from './resource-contract.js'

export function resourceFixture() {
  return {
    schemaVersion: 1 as const, name: 'Example dataset', aliases: [], identifiers: [],
    description: 'Synthetic acceptance resource.', dataTypes: ['image'], processingLevel: 'raw' as const,
    locations: [{ url: 'https://example.org/data', role: 'landing' as const }],
    access: { mode: 'unknown' as const, evidenceIds: [] as string[] },
    paperLinks: [], evidence: [{ evidenceId: 'e1', url: 'https://example.org/data',
      quote: 'Data access conditions pending verification.', observedAt: '2026-11-20T00:00:00Z', actorLabel: 'test' }],
    checks: []
  }
}

describe('resource contract', () => {
  it('accepts unknown access without claiming verification', () => {
    expect(knowledgeResourceSchema.parse(resourceFixture()).access.mode).toBe('unknown')
  })
  it('requires types and evidence for declared access', () => {
    expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), dataTypes: [] }).success).toBe(false)
    expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), access: { mode: 'closed', evidenceIds: [] } }).success).toBe(false)
    expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), access: { mode: 'open', evidenceIds: ['missing'] } }).success).toBe(false)
  })
  it('rejects credentials, signed URLs, invalid timestamps and duplicate evidence', () => {
    for (const url of ['https://user:secret@example.org', 'file:///data', 'https://example.org?X-Amz-Signature=secret']) {
      expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), locations: [{ url, role: 'download' }] }).success).toBe(false)
    }
    const resource = resourceFixture()
    expect(knowledgeResourceSchema.safeParse({ ...resource, evidence: [...resource.evidence, ...resource.evidence] }).success).toBe(false)
    expect(knowledgeResourceSchema.safeParse({ ...resource, evidence: [{ ...resource.evidence[0], observedAt: 'yesterday' }] }).success).toBe(false)
  })
  it('validates check sources, correction chains and integrity facts', () => {
    const check = { checkId: 'c1', kind: 'integrity', outcome: 'confirmed', observedAt: '2026-11-20T00:00:00Z', evidenceIds: ['e1'] }
    for (const checks of [[check], [{ ...check, integrity: { algorithm: 'sha256', expectedDigest: 'a'.repeat(64), actualDigest: 'b'.repeat(64) } }],
      [{ ...check, kind: 'retrieval', supersedesCheckId: 'c1' }],
      [{ ...check, kind: 'source_report' }]]) {
      expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), checks }).success).toBe(false)
    }
    expect(knowledgeResourceSchema.safeParse({ ...resourceFixture(), checks: [{ ...check,
      integrity: { algorithm: 'sha256', expectedDigest: 'a'.repeat(64), actualDigest: 'a'.repeat(64) } }] }).success).toBe(true)
  })
  it('requires creation or explicit update baseline', () => {
    const input = { operationId: 'resource-create-1', expectedVersionId: null, resource: resourceFixture() }
    expect(resourceCommitInputSchema.safeParse(input).success).toBe(true)
    expect(resourceCommitInputSchema.safeParse({ ...input, resourceId: 'a1' }).success).toBe(false)
    expect(resourceCommitInputSchema.safeParse({ ...input, expectedVersionId: 'v1' }).success).toBe(false)
    expect(resourceCommitInputSchema.safeParse({ ...input, resourceId: 'a1', expectedVersionId: 'v1', resource: { ...resourceFixture(), parentResourceId: 'a1' } }).success).toBe(false)
  })
  it('preserves evidence and observations while permitting appended corrections', () => {
    const baseline = knowledgeResourceSchema.parse({ ...resourceFixture(), checks: [{ checkId: 'c1', kind: 'retrieval',
      outcome: 'failed', observedAt: '2026-11-20T00:00:00Z', evidenceIds: ['e1'] }] })
    expect(validateResourceUpdate(baseline, { ...baseline, checks: [] })).toMatch(/checks/)
    expect(validateResourceUpdate(baseline, { ...baseline, evidence: [{ ...baseline.evidence[0]!, quote: 'Changed' }] })).toMatch(/evidence/)
    expect(validateResourceUpdate(baseline, { ...baseline, checks: [...baseline.checks, { ...baseline.checks[0]!, checkId: 'c2', supersedesCheckId: 'c1' }] })).toBeNull()
  })
})
