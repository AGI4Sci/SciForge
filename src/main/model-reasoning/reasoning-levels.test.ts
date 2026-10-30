/**
 * Reasoning-level vocabulary (词表) lookup contract.
 *
 * Two rules drive the design:
 *
 * 1. The shipped table is *evidence-only*. An entry exists only when the
 *    repository holds a dated observation for that provider/model/protocol.
 *    Models that merely resemble a known family must stay unknown — matching is
 *    exact (plus an explicit `protocol: '*'` wildcard), never fuzzy.
 * 2. Matching rules themselves are exercised with fixture tables, so the shipped
 *    data never has to grow fake entries just to cover a branch.
 */
import { describe, expect, it } from 'vitest'

import {
  REASONING_LEVEL_TABLE,
  lookupReasoningLevels,
  reasoningLevelTableIssues,
  type ReasoningLevelTable
} from './reasoning-levels'

/** Fixture table: exercises matching rules without touching shipped evidence. */
const FIXTURE_TABLE: ReasoningLevelTable = {
  schemaVersion: 1,
  entries: [
    {
      provider: 'fixture',
      model: 'wildcard-model',
      protocol: '*',
      levels: ['low', 'high'],
      completeness: 'complete',
      defaultLevel: 'low',
      source: 'fixture',
      verifiedAt: '2026-01-01'
    },
    {
      provider: 'fixture',
      model: 'partial-model',
      protocol: '*',
      levels: ['high'],
      completeness: 'partial',
      source: 'fixture',
      verifiedAt: '2026-01-05'
    },
    {
      provider: 'fixture',
      model: 'unsupported-model',
      protocol: '*',
      declaredUnsupported: true,
      source: 'fixture',
      verifiedAt: '2026-01-02'
    },
    {
      provider: 'fixture',
      model: 'endpoint-model',
      protocol: 'responses',
      levels: ['low'],
      completeness: 'complete',
      source: 'fixture',
      verifiedAt: '2026-01-03'
    },
    {
      provider: 'fixture',
      model: 'endpoint-model',
      protocol: 'responses',
      endpoint: 'https://api.example.com/v1',
      levels: ['low', 'high'],
      completeness: 'complete',
      source: 'fixture',
      verifiedAt: '2026-01-04'
    }
  ]
}

describe('reasoning level vocabulary', () => {
  it('returns the shipped evidence for a model the repository actually verified', () => {
    const evidence = lookupReasoningLevels({
      provider: 'intern',
      model: 'deepseek-v4-flash-0731',
      protocol: 'chat-completions'
    })
    expect(evidence.kind).toBe('declared')
    if (evidence.kind !== 'declared') return
    // Only `high` is evidenced: PR #83 observed an explicit `high` accepted and
    // an effort-free request left untouched. Nothing else was observed, so the
    // evidence is partial — never to be shown as the full ladder.
    expect(evidence.levels).toEqual(['high'])
    expect(evidence.completeness).toBe('partial')
    expect(evidence.defaultLevel).toBeNull()
    expect(evidence.source).toBe('pr-83-live-probe')
    expect(evidence.verifiedAt).toBe('2026-10-23')
  })

  it('distinguishes a complete enumeration from a partial verification', () => {
    const complete = lookupReasoningLevels(
      { provider: 'fixture', model: 'wildcard-model', protocol: 'responses' },
      FIXTURE_TABLE
    )
    const partial = lookupReasoningLevels(
      { provider: 'fixture', model: 'partial-model', protocol: 'responses' },
      FIXTURE_TABLE
    )
    expect(complete.kind === 'declared' && complete.completeness).toBe('complete')
    expect(partial.kind === 'declared' && partial.completeness).toBe('partial')
  })

  it('normalizes provider, model, protocol and endpoint casing and whitespace', () => {
    const evidence = lookupReasoningLevels(
      {
        provider: '  FIXTURE ',
        model: ' wildcard-MODEL ',
        protocol: 'Responses'
      },
      FIXTURE_TABLE
    )
    expect(evidence.kind).toBe('declared')
    if (evidence.kind !== 'declared') return
    expect(evidence.levels).toEqual(['low', 'high'])
  })

  it('matches any protocol through an explicit wildcard entry', () => {
    for (const protocol of ['responses', 'chat-completions', 'anthropic-messages']) {
      expect(
        lookupReasoningLevels({ provider: 'fixture', model: 'wildcard-model', protocol }, FIXTURE_TABLE)
          .kind
      ).toBe('declared')
    }
  })

  it('never guesses levels for a model that only looks like a known one', () => {
    for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-0731-mini', 'deepseek-v4']) {
      expect(
        lookupReasoningLevels({ provider: 'intern', model, protocol: 'responses' }).kind
      ).toBe('unknown')
    }
  })

  it('reports upstream-declared unsupported as its own outcome, never as levels', () => {
    const evidence = lookupReasoningLevels(
      { provider: 'fixture', model: 'unsupported-model', protocol: 'responses' },
      FIXTURE_TABLE
    )
    expect(evidence.kind).toBe('declared-unsupported')
    if (evidence.kind !== 'declared-unsupported') return
    expect(evidence.verifiedAt).toBe('2026-01-02')
  })

  it('stays unknown for an unconfigured provider or protocol', () => {
    expect(
      lookupReasoningLevels({ provider: 'unknown-vendor', model: 'x', protocol: 'responses' }, FIXTURE_TABLE)
        .kind
    ).toBe('unknown')
    expect(
      lookupReasoningLevels(
        { provider: 'intern', model: 'deepseek-v4-flash-0731', protocol: 'anthropic-messages' },
        FIXTURE_TABLE
      ).kind
    ).toBe('unknown')
  })

  it('prefers an endpoint-specific entry over the endpoint-agnostic one', () => {
    const generic = lookupReasoningLevels(
      { provider: 'fixture', model: 'endpoint-model', protocol: 'responses' },
      FIXTURE_TABLE
    )
    const specific = lookupReasoningLevels(
      {
        provider: 'fixture',
        model: 'endpoint-model',
        protocol: 'responses',
        endpoint: 'https://api.example.com/v1/'
      },
      FIXTURE_TABLE
    )
    expect(generic.kind).toBe('declared')
    expect(specific.kind).toBe('declared')
    if (generic.kind !== 'declared' || specific.kind !== 'declared') return
    expect(generic.levels).toEqual(['low'])
    expect(specific.levels).toEqual(['low', 'high'])
  })

  it('keeps every shipped entry evidence-bearing and free of secret material', () => {
    const serialized = JSON.stringify(REASONING_LEVEL_TABLE)
    for (const token of ['sk-', 'Bearer ', 'api_key', 'apiKey', 'password']) {
      expect(serialized).not.toContain(token)
    }
    for (const entry of REASONING_LEVEL_TABLE.entries) {
      expect(entry.source.trim().length).toBeGreaterThan(0)
      expect(entry.provider.trim()).toBe(entry.provider)
      expect(entry.model.trim()).toBe(entry.model)
      if (entry.declaredUnsupported) {
        expect(entry.levels).toBeUndefined()
      } else {
        expect(Array.isArray(entry.levels)).toBe(true)
        expect((entry.levels ?? []).length).toBeGreaterThan(0)
        expect(entry.completeness).toBeDefined()
      }
    }
  })

  it('passes its own invariant check, and the check refuses tables nobody verified', () => {
    expect(reasoningLevelTableIssues(REASONING_LEVEL_TABLE)).toEqual([])
    expect(reasoningLevelTableIssues(FIXTURE_TABLE)).toEqual([])

    const broken: ReasoningLevelTable = {
      schemaVersion: 1,
      entries: [
        { provider: 'x', model: 'dup', protocol: '*', levels: ['low'], completeness: 'complete', source: 'fixture' },
        { provider: 'x', model: 'dup', protocol: '*', levels: ['low'], completeness: 'complete', source: 'fixture' },
        { provider: 'x', model: 'no-completeness', protocol: '*', levels: ['low'], source: 'fixture' },
        { provider: 'x', model: 'no-source', protocol: '*', levels: ['low'], completeness: 'complete', source: '  ' },
        { provider: 'x', model: 'unsupported-with-levels', protocol: '*', levels: ['low'], declaredUnsupported: true, source: 'fixture' }
      ]
    }
    const issues = reasoningLevelTableIssues(broken)
    expect(issues.some((issue) => issue.includes('duplicate'))).toBe(true)
    expect(issues.some((issue) => issue.includes('without completeness'))).toBe(true)
    expect(issues.some((issue) => issue.includes('without source'))).toBe(true)
    expect(issues.some((issue) => issue.includes('must not carry levels'))).toBe(true)
  })
})