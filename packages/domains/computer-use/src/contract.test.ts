import { describe, expect, it } from 'vitest'
import fixturePayload from '../../../workers/gui-owl-computer-use/tests/fixtures/computer_use_contract_v2.json'
import {
  COMPUTER_USE_ERROR_CODES,
  computerUseRunInputSchema,
  isComputerUseV2Input,
  normalizeComputerUseRunInput,
  redactComputerUseTarget
} from './contract'

type FixtureCase = {
  name: string
  input: unknown
  protocolVersion?: number
  normalizedPublic?: unknown
}

const fixtures = fixturePayload as { valid: FixtureCase[]; invalid: FixtureCase[] }

describe('computer-use shared v2 contract', () => {
  it('exposes the structured isolated desktop unavailable code', () => {
    expect(COMPUTER_USE_ERROR_CODES).toContain('ISOLATED_DESKTOP_UNAVAILABLE')
    expect(COMPUTER_USE_ERROR_CODES).toContain('APPROVAL_PROOF_CAPACITY')
  })

  it('accepts a bounded deterministic semantic click as protocol v2', () => {
    const normalized = normalizeComputerUseRunInput({
      instruction: 'Commit the exact accessible control.',
      semanticAction: {
        kind: 'click',
        role: 'button',
        name: 'Commit Alpha',
        expect: { kind: 'text-present', text: 'ALPHA_COMMITTED', stableForMs: 8000 }
      }
    })
    expect(normalized.protocolVersion).toBe(2)
    expect(normalized.semanticAction).toEqual({
      kind: 'click', role: 'button', name: 'Commit Alpha',
      expect: { kind: 'text-present', text: 'ALPHA_COMMITTED', stableForMs: 8000 }
    })
  })

  it('rejects unbounded or ambiguous semantic actions', () => {
    expect(computerUseRunInputSchema.safeParse({
      instruction: 'click',
      semanticAction: { kind: 'click', role: 'button', name: 'x' }
    }).success).toBe(false)
    expect(computerUseRunInputSchema.safeParse({
      instruction: 'click',
      semanticAction: {
        kind: 'type', role: 'textbox', name: 'x',
        expect: { kind: 'text-present', text: 'done' }
      }
    }).success).toBe(false)
  })

  it('accepts one approved parallel batch with distinct bounded sessions', () => {
    const normalized = normalizeComputerUseRunInput({
      instruction: 'Run the test-owned targets concurrently.',
      parallel: ['Alpha', 'Beta', 'Gamma'].map((label) => ({
        instruction: `Commit ${label}.`,
        sessionId: `session-${label.toLowerCase()}`,
        requestedIsolation: 'host-app-scoped',
        allowDegraded: false,
        semanticAction: {
          kind: 'click', role: 'button', name: `Commit ${label}`,
          expect: { kind: 'text-present', text: `${label.toUpperCase()}_COMMITTED` }
        }
      }))
    })
    expect(normalized.protocolVersion).toBe(2)
    expect(normalized.parallel).toHaveLength(3)
  })

  it('rejects duplicate sessions and conflicting single-run fields in a parallel batch', () => {
    const entry = { instruction: 'observe', sessionId: 'session-alpha' }
    expect(computerUseRunInputSchema.safeParse({
      instruction: 'batch', parallel: [entry, entry]
    }).success).toBe(false)
    expect(computerUseRunInputSchema.safeParse({
      instruction: 'batch', sessionId: 'top-level',
      parallel: [entry, { instruction: 'observe', sessionId: 'session-beta' }]
    }).success).toBe(false)
  })

  for (const fixture of fixtures.valid) {
    it(`accepts ${fixture.name}`, () => {
      const parsed = computerUseRunInputSchema.parse(fixture.input)
      expect(isComputerUseV2Input(parsed)).toBe(fixture.protocolVersion === 2)
      const normalized = normalizeComputerUseRunInput(fixture.input)
      expect(normalized.protocolVersion).toBe(fixture.protocolVersion)
      expect(normalized).toEqual(fixture.normalizedPublic)
    })
  }

  for (const fixture of fixtures.invalid) {
    it(`rejects ${fixture.name}`, () => {
      expect(computerUseRunInputSchema.safeParse(fixture.input).success).toBe(false)
    })
  }


  it('redacts endpoint and display metadata from target status views', () => {
    const target = computerUseRunInputSchema.parse({
      instruction: 'x',
      target: {
        kind: 'browser-page',
        locator: { cdpEndpoint: 'http://token@127.0.0.1:9222', cdpTargetId: 'page-1' },
        metadata: { title: 'secret', url: 'https://secret.example', publicLabel: 'Test-owned Alpha' }
      }
    }).target!
    const redacted = redactComputerUseTarget(target)
    expect(redacted).not.toEqual(expect.objectContaining({
      locator: expect.objectContaining({ cdpEndpoint: expect.stringContaining('token') })
    }))
    expect(redacted).toMatchObject({
      locator: { cdpEndpoint: '<redacted>' },
      metadata: { title: '<redacted>', url: '<redacted>', publicLabel: 'Test-owned Alpha' }
    })
  })
})
