import { describe, expect, it } from 'vitest'
import type { AgentRuntimeMemoryRecord } from '../../shared/agent-runtime-contract'
import { MAX_RESEARCH_MEMORY_PROMPT_BYTES, RESEARCH_MEMORY_OMITTED_PROMPT, memoryForExposure, parseResearchMemory, renderResearchMemory } from './research-memory'

const metadata = {
  sources: [{ owner: 'owner', locator: 'exact/path', version: 'v1', digest: 'sha256:digest', access: 'unknown' }],
  conditions: ['Matched resource budget'], counterexamples: ['Failed control'], corrections: ['Simulation only']
}

describe('research memory trust boundary', () => {
  it('omits an oversized Unicode bundle whole without losing durable negative evidence', () => {
    const research = parseResearchMemory({ ...metadata,
      counterexamples: Array.from({ length: 8 }, (_, i) => `${'反'.repeat(1900)} NEGATIVE-END-${i}`)
    })
    const record = { text: 'OVERSIZED POSITIVE CLAIM', research } as AgentRuntimeMemoryRecord
    const before = structuredClone(record)
    const rendered = renderResearchMemory(record)
    expect(rendered).toBe(RESEARCH_MEMORY_OMITTED_PROMPT)
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(MAX_RESEARCH_MEMORY_PROMPT_BYTES)
    expect(rendered).not.toContain(record.text)
    expect(rendered).not.toContain('NEGATIVE-END')
    expect(record).toEqual(before)
    expect(renderResearchMemory({ ...record, research: { ...research, status: 'withdrawn' } })).toContain('research: withdrawn')
  })

  it('ignores caller freshness and renders uncertainty, completeness and exact source identity', () => {
    const research = parseResearchMemory({ ...metadata, freshness: 'fresh', verifiedAt: '2099', confidence: 1 })
    const record = { text: 'Conditional claim', research } as AgentRuntimeMemoryRecord
    const rendered = renderResearchMemory(record)
    expect(research.status).toBe('unverified')
    expect(rendered).toContain('source lookup required')
    expect(rendered).toContain('access unknown/partial')
    expect(rendered).toContain('Failed control')
    expect(rendered).toContain('Matched resource budget')
    expect(rendered).toContain('sha256:digest')
    expect(rendered).not.toContain('2099')
  })

  it('omits all private text if current or historical source access is revoked', () => {
    const research = parseResearchMemory({ ...metadata, history: [{ ...metadata, text: 'PRIVATE HISTORY', sources: [{ ...metadata.sources[0], access: 'inaccessible' }] }] })
    const record = { id: 'id', text: 'PRIVATE CLAIM', scope: 'workspace', tags: ['PRIVATE TAG'], research } as AgentRuntimeMemoryRecord
    expect(renderResearchMemory(record)).toContain('inaccessible')
    for (const exposure of [renderResearchMemory(record), JSON.stringify(memoryForExposure(record))]) {
      expect(exposure).not.toContain('PRIVATE')
      expect(exposure).not.toContain('exact/path')
      expect(exposure).not.toContain('Failed control')
    }
    expect(record.text).toBe('PRIVATE CLAIM')
  })

  it('rejects empty identities, unbounded conditions, verified access and status', () => {
    for (const value of [
      { ...metadata, sources: [{ ...metadata.sources[0], version: '' }] },
      { ...metadata, sources: [{ ...metadata.sources[0], access: 'verified' }] },
      { ...metadata, conditions: Array(9).fill('condition') },
      { ...metadata, status: 'verified' }
    ]) expect(() => parseResearchMemory(value)).toThrow()
  })

  it('uses the same withdrawn exposure policy for raw and service-sanitized records', () => {
    const record = { id: 'id', text: 'PRIVATE CLAIM', scope: 'workspace', tags: ['PRIVATE TAG'],
      research: parseResearchMemory({ ...metadata, status: 'withdrawn', history: [{ ...metadata, text: 'PRIVATE HISTORY' }] })
    } as AgentRuntimeMemoryRecord
    const exposed = memoryForExposure(record)
    expect(renderResearchMemory(record)).toBe(renderResearchMemory(exposed))
    for (const output of [JSON.stringify(exposed), renderResearchMemory(record)]) {
      expect(output).toContain('withdrawn')
      for (const privateText of ['PRIVATE', 'exact/path', 'Matched resource budget', 'Failed control', 'Simulation only']) {
        expect(output).not.toContain(privateText)
      }
    }
    expect(record.research!.history).toHaveLength(1)
  })
})
