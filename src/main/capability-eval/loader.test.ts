import { describe, expect, it } from 'vitest'
import { parseEvalCasesJsonl, parseTraceEventsJsonl } from './loader'

describe('capability eval loaders', () => {
  it('validates JSONL cases and rejects duplicate IDs', () => {
    const content = [
      '# comments are allowed for local case files',
      JSON.stringify({
        id: 'case-1',
        query: 'test',
        expected: { requiredActions: [], allowedActions: [], taskSuccess: true }
      })
    ].join('\n')
    expect(parseEvalCasesJsonl(content)).toHaveLength(1)
    expect(() => parseEvalCasesJsonl(`${content}\n${content.split('\n').at(-1)}`)).toThrow(/Duplicate eval case id/)
  })

  it('reads valid full-trace events and ignores the export header', () => {
    const content = [
      JSON.stringify({ format: 'sciforge.full-trace.jsonl.v1', eventCount: 1 }),
      JSON.stringify({
        schemaVersion: 'sciforge.trace.v1',
        eventId: 'trace-event-1',
        traceId: 'trace-1',
        source: 'agent-runtime',
        kind: 'agent_event',
        timestamp: '2026-09-15T00:00:00.000Z',
        recordedAt: '2026-09-15T00:00:00.000Z',
        payload: { eventKind: 'lifecycle', event: { kind: 'turn_lifecycle', state: 'completed' } }
      })
    ].join('\n')
    expect(parseTraceEventsJsonl(content)).toHaveLength(1)
  })
})
