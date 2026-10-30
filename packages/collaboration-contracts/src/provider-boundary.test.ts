import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Human Endpoint Provider public boundary', () => {
  it('publishes only a non-secret file directory and provider-neutral services', () => {
    const source = readFileSync(new URL('./provider.ts', import.meta.url), 'utf8')

    expect(source).toContain('readonly secretFileDirectory: string')
    expect(source).not.toMatch(
      /HumanEndpointProviderSecretReader|HumanEndpointProviderHttp(?:Request|Response)|\breadSecret\s*\(|\bhttp\s*\(request:/u
    )
  })
})
