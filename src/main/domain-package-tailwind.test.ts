import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer domain package styling', () => {
  it('includes every trusted domain package renderer source in Tailwind discovery', () => {
    const config = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')

    expect(config).toContain("'./packages/domains/*/src/**/*.{ts,tsx}'")
    expect(config).not.toContain('packages/domains/paper-radar')
  })
})
