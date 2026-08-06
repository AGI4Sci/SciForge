import { describe, expect, it } from 'vitest'
import fixturePayload from '../../packages/workers/gui-owl-computer-use/tests/fixtures/computer_use_contract_v2.json'
import {
  computerUseRunInputSchema,
  isComputerUseV2Input,
  normalizeComputerUseRunInput,
  redactComputerUseTarget
} from './computer-use-contract'

type FixtureCase = {
  name: string
  input: unknown
  protocolVersion?: number
}

const fixtures = fixturePayload as { valid: FixtureCase[]; invalid: FixtureCase[] }

describe('computer-use shared v2 contract', () => {
  for (const fixture of fixtures.valid) {
    it(`accepts ${fixture.name}`, () => {
      const parsed = computerUseRunInputSchema.parse(fixture.input)
      expect(isComputerUseV2Input(parsed)).toBe(fixture.protocolVersion === 2)
      expect(normalizeComputerUseRunInput(fixture.input).protocolVersion).toBe(fixture.protocolVersion)
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
        metadata: { title: 'secret', url: 'https://secret.example' }
      }
    }).target!
    const redacted = redactComputerUseTarget(target)
    expect(redacted).not.toEqual(expect.objectContaining({
      locator: expect.objectContaining({ cdpEndpoint: expect.stringContaining('token') })
    }))
    expect(redacted).toMatchObject({
      locator: { cdpEndpoint: '<redacted>' },
      metadata: { title: '<redacted>', url: '<redacted>' }
    })
  })
})
