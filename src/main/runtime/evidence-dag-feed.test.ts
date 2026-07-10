import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeItem, AgentRuntimeThreadDetail } from '../../shared/agent-runtime-contract'
import {
  completedTurnItems,
  feedEvidenceDag,
  isEvidenceDagAutoFeedEnabled,
  isEvidenceDagFeedEnabled,
  toEvidenceDagTraceItems
} from './evidence-dag-feed'

describe('Evidence DAG runtime feed', () => {
  it('maps neutral runtime items to engine trace items and drops control noise', () => {
    const items: AgentRuntimeItem[] = [
      { id: 'u1', turnId: 't1', kind: 'user_message', text: 'question' },
      { id: 'a1', turnId: 't1', kind: 'assistant_message', text: 'answer' },
      { id: 'r1', turnId: 't1', kind: 'reasoning', summary: 'thinking' },
      {
        id: 'tool1',
        turnId: 't1',
        kind: 'tool',
        status: 'success',
        toolKind: 'command_execution',
        detail: 'result',
        meta: { toolName: 'shell' }
      },
      {
        id: 'tool2',
        turnId: 't1',
        kind: 'tool',
        status: 'error',
        detail: 'boom',
        meta: { toolName: 'shell' }
      },
      { id: 'approval1', turnId: 't1', kind: 'approval', summary: 'allow?' }
    ]

    expect(toEvidenceDagTraceItems(items)).toEqual([
      { id: 'u1', type: 'message', role: 'user', content: 'question' },
      { id: 'a1', type: 'message', role: 'assistant', content: 'answer' },
      { id: 'r1', type: 'message', role: 'assistant', content: 'thinking' },
      { id: 'tool1', type: 'tool_result', tool_name: 'shell', content: 'result' }
    ])
  })

  it('selects the completed turn items from either turn records or flat items', () => {
    const detail = {
      id: 'thread',
      runtimeId: 'claude',
      title: 'Thread',
      updatedAt: '2026-01-01T00:00:00.000Z',
      latestSeq: 1,
      turns: [{
        id: 'turn-1',
        threadId: 'thread',
        status: 'completed',
        items: [{ id: 'nested', turnId: 'turn-1', kind: 'assistant_message', text: 'nested' }]
      }],
      items: [{ id: 'flat', turnId: 'turn-1', kind: 'assistant_message', text: 'flat' }]
    } satisfies AgentRuntimeThreadDetail

    expect(completedTurnItems(detail, 'turn-1').map((item) => item.id)).toEqual(['nested'])
    expect(completedTurnItems({ ...detail, turns: [] }, 'turn-1').map((item) => item.id)).toEqual(['flat'])
  })

  it('requires both service URL and API key before enabling the feed', () => {
    expect(isEvidenceDagFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897',
      SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
    })).toBe(true)
    expect(isEvidenceDagFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897'
    })).toBe(false)
    expect(isEvidenceDagFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
    })).toBe(false)
  })

  it('requires an explicit opt-in before auto-feeding completed turns', () => {
    expect(isEvidenceDagAutoFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897',
      SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
    })).toBe(false)
    expect(isEvidenceDagAutoFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897',
      SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret',
      SCIFORGE_EVIDENCE_DAG_AUTO_FEED: 'true'
    })).toBe(true)
    expect(isEvidenceDagAutoFeedEnabled({
      SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897',
      SCIFORGE_EVIDENCE_DAG_AUTO_FEED: 'true'
    })).toBe(false)
  })

  it('posts completed-turn traces with runtime-scoped, URL-encoded thread ids', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))

    await feedEvidenceDag({
      runtimeId: 'claude',
      threadId: 'thread/with space',
      items: [{ id: 'u1', kind: 'user_message', text: 'hello' }],
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897/',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
      },
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3897/threads/claude%3Athread%2Fwith%20space/ingest-trace',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/json'
        }),
        body: JSON.stringify({
          trace: [{ id: 'u1', type: 'message', role: 'user', content: 'hello' }]
        })
      })
    )
  })

  it('can request a fast full-thread rebuild for explicit updates', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))

    await feedEvidenceDag({
      runtimeId: 'codex',
      threadId: 'thread-1',
      items: [{ id: 'u1', kind: 'user_message', text: 'hello' }],
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897/',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
      },
      fetchImpl,
      rebuild: true,
      verify: false,
      audit: false
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3897/threads/codex%3Athread-1/ingest-trace',
      expect.objectContaining({
        body: JSON.stringify({
          trace: [{ id: 'u1', type: 'message', role: 'user', content: 'hello' }],
          rebuild: true,
          verify: false,
          audit: false
        })
      })
    )
  })

  it('throws on failed ingest when failOpen is disabled', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: 'extract failed' }
    }), { status: 500 }))

    await expect(feedEvidenceDag({
      runtimeId: 'claude',
      threadId: 'thread',
      items: [{ id: 'u1', kind: 'user_message', text: 'hello' }],
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897/',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
      },
      fetchImpl,
      failOpen: false
    })).rejects.toThrow(/extract failed/)
  })

  it('does not post when the service URL has no non-empty API key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))

    await feedEvidenceDag({
      runtimeId: 'claude',
      threadId: 'thread',
      items: [{ id: 'u1', kind: 'user_message', text: 'hello' }],
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897/',
        SCIFORGE_EVIDENCE_DAG_API_KEY: '   '
      },
      fetchImpl
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
