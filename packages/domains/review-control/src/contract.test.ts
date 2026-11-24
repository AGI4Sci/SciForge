import { describe, expect, it } from 'vitest'
import { coverageReportSchema, reviewReceiptSchema, reviewSuggestionSchema } from './contract.js'
import { receipt } from './test-support.js'

describe('review receipt contract', () => {
  it('accepts a content-free receipt', () => {
    expect(reviewReceiptSchema.parse(receipt)).toEqual(receipt)
  })
  it.each(['accepted', 'corrected', 'rejected', 'needs_revision', 'unresolved', 'skipped'])('accepts verdict %s', (verdict) => {
    expect(reviewReceiptSchema.safeParse({ ...receipt, verdict }).success).toBe(true)
  })
  it('accepts a field-scoped receipt with optional chain references', () => {
    const input = { ...receipt, fieldPath: 'synthetic.field', prev: null, digest: 'synthetic-chain-reference' }
    expect(reviewReceiptSchema.parse(input)).toEqual(input)
  })
  it('accepts an empty coverage report', () => {
    expect(coverageReportSchema.parse({ known: 0, flagged: 0, reviewed: 0, unreachable: 0, unreviewed: 0 }))
      .toEqual({ known: 0, flagged: 0, reviewed: 0, unreachable: 0, unreviewed: 0 })
  })
  it.each(['type_prior', 'downstream_impact', 'low_confidence', 'unreviewed'])('accepts suggestion reason %s', (reason) => {
    expect(reviewSuggestionSchema.safeParse({ nodeId: 'n1', rank: 1, reason, expectedGain: 0, costMinutes: 1 }).success).toBe(true)
  })
  it.each([
    { ...receipt, artifactVersion: undefined },
    { ...receipt, verdict: 'approved' },
    { ...receipt, actorHash: '' },
    { ...receipt, actorHash: '   ' },
    { ...receipt, openedAt: 'invalid' },
    { ...receipt, submittedAt: '2025-12-31T23:59:59Z' }
  ])('rejects invalid receipt %#', (value) => {
    expect(reviewReceiptSchema.safeParse(value).success).toBe(false)
  })
  it.each(['commentBody', 'participantId', 'rawText', 'comment', 'pid', 'open_id', 'accountId', 'apiKey'])(
    'rejects unknown field %s', (key) => {
      expect(reviewReceiptSchema.safeParse({ ...receipt, [key]: 'synthetic-private-sentinel' }).success).toBe(false)
    })
  it('compares timestamp instants across offsets', () => {
    expect(reviewReceiptSchema.safeParse({ ...receipt,
      openedAt: '2026-01-01T02:00:00+02:00', submittedAt: '2026-01-01T00:01:00Z'
    }).success).toBe(true)
  })
  it('rejects an unknown suggestion reason', () => {
    expect(reviewSuggestionSchema.safeParse({ nodeId: 'n1', rank: 1, reason: 'unknown', expectedGain: 0, costMinutes: 1 }).success).toBe(false)
  })
  it.each(['known', 'flagged', 'reviewed', 'unreachable', 'unreviewed'])('rejects negative %s', (key) => {
    expect(coverageReportSchema.safeParse({ known: 0, flagged: 0, reviewed: 0, unreachable: 0, unreviewed: 0, [key]: -1 }).success).toBe(false)
  })
  it.todo('accepts reasonCode values once the closed vocabulary is agreed')
})
