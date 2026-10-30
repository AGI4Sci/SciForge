import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { projectEvidenceTrace } from '../src/trace-projection.js'

const pagePath = new URL('./fixtures/captured-host-page.json', import.meta.url)

describe('real Agent Host projection (component fixture, not model acceptance)', () => {
  it('preserves source provenance and ordinary policy prose in the captured page', async () => {
    const page = JSON.parse(await readFile(pagePath, 'utf8')) as { turns: Array<{ status: string; items: Record<string, unknown>[] }> }
    const turn = page.turns.find(candidate => candidate.status === 'completed')!
    const trace = projectEvidenceTrace(turn.items)
    expect(trace.length).toBeGreaterThan(0)
    expect(trace).toEqual(JSON.parse(JSON.stringify(trace)))
    expect(trace.some(item => item.type === 'tool_result' && typeof item.output === 'object')).toBe(true)
    expect(JSON.stringify(trace)).toContain('A glass bead immersed')
    expect(JSON.stringify(trace)).toContain('workspace/evidence-source.md')
  })

  it('normalizes types and explicit complete text envelopes without opening locators', () => {
    const text = 'Unrelated source Δ and ordinary API credentials policy.'
    const output = { path: 'arbitrary/no-read.md', sourcePath: 'another/source.txt', api_key: 'test-redaction-value', content: [{ type: 'text', text: JSON.stringify({ dataBase64: Buffer.from(text).toString('base64'), length: Buffer.byteLength(text) }) }] }
    const projected = projectEvidenceTrace([{ id: 'receipt', kind: 'tool', detail: JSON.stringify(output) }])
    expect(JSON.stringify(projected)).toContain(text)
    expect(JSON.stringify(projected)).toContain('arbitrary/no-read.md')
    expect(JSON.stringify(projected)).toContain('another/source.txt')
    expect(JSON.stringify(projected)).not.toContain('test-redaction-value')
    const secretBytes = JSON.stringify({ api_key: 'test-encoded-redaction-value', sourcePath: 'unrelated/provenance.md' })
    const encoded = Buffer.from(secretBytes).toString('base64')
    const redacted = projectEvidenceTrace([{ kind: 'tool', output: { dataBase64: encoded, length: Buffer.byteLength(secretBytes) } }])
    expect(JSON.stringify(redacted)).not.toContain('test-encoded-redaction-value')
    expect(JSON.stringify(redacted)).not.toContain(encoded)
    expect(JSON.stringify(redacted)).toContain('unrelated/provenance.md')
    const neutral = projectEvidenceTrace([{ id: 'neutral', type: 'tool_result', output }])
    expect(neutral[0].type).toBe('tool_result')
    expect(JSON.stringify(neutral)).toContain(text)
    for (const bad of [{ dataBase64: 'YWJj', length: 99 }, { dataBase64: '/w==', length: 1 }, { dataBase64: 'YW!j', length: 3 }]) {
      const trace = projectEvidenceTrace([{ kind: 'tool', detail: bad }])
      expect(JSON.stringify(trace)).not.toContain('decodedText')
    }
  })
})
