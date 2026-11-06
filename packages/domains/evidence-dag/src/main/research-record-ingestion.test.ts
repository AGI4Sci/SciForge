import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainAgentThreadDetail } from '@sciforge/domain-sdk/host'
import { visibleResearchContextBoundaries, visibleResearchItems } from './research-record-ingestion.js'

test('public context boundaries whitelist metadata and exclude hidden or encrypted content', () => {
  const turn = { id: 'turn', status: 'completed', messages: [], artifacts: [
    { id: 'boundary', kind: 'compaction', status: 'success', createdAt: '2026-01-01', summary: 'PRIVATE_PAYLOAD', text: 'HIDDEN_TEXT', encryptedContent: 'ENCRYPTED' },
    { id: 'reason', kind: 'reasoning', text: 'HIDDEN_REASONING' },
    { id: 'visible', kind: 'tool', status: 'failed', text: 'public failure' }
  ] } as unknown as DomainAgentThreadDetail['turns'][number]
  assert.deepEqual(visibleResearchContextBoundaries(turn), [{ itemId: 'boundary', kind: 'compaction', status: 'success', occurredAt: '2026-01-01' }])
  assert.deepEqual([...visibleResearchItems(turn).keys()], ['visible'])
  assert.equal(JSON.stringify(visibleResearchContextBoundaries(turn)).includes('PRIVATE'), false)
})
