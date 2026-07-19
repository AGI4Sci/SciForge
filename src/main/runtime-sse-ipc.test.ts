import { describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { localRuntimeEvents } from './runtime-sse-ipc'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: {
        ...defaultLocalRuntimeSettings(),
        port: 49876,
        runtimeToken: 'local-runtime-token'
      },
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('localRuntimeEvents', () => {
  it('parses local runtime SSE events for the AgentRuntimeHost event path', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          'id: 5',
          'event: assistant_delta',
          'data: {"threadId":"thread-1","text":"hi"}',
          '',
          'data: {"seq":6,"kind":"turn_completed"}',
          '',
          ''
        ].join('\n')))
        controller.close()
        init?.signal?.addEventListener('abort', () => undefined, { once: true })
      }
    })))
    vi.stubGlobal('fetch', fetchMock)
    const abort = new AbortController()

    try {
      const events = localRuntimeEvents(settings(), 'thread-1', 4, abort.signal)[Symbol.asyncIterator]()
      const first = await events.next()
      const second = await events.next()
      abort.abort()

      expect(first.value).toEqual({
        threadId: 'thread-1',
        text: 'hi',
        seq: 5,
        kind: 'assistant_delta'
      })
      expect(second.value).toEqual({ seq: 6, kind: 'turn_completed' })
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(String(url)).toBe('http://127.0.0.1:49876/v1/threads/thread-1/events?since_seq=4')
      expect(init?.headers).toMatchObject({
        Accept: 'text/event-stream',
        authorization: 'Bearer local-runtime-token',
        'Last-Event-ID': '4'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not advance the reconnect cursor from heartbeat events', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const call = fetchMock.mock.calls.length
      return new Response(new ReadableStream({
        start(controller) {
          const chunks = call === 1
            ? [
                'id: 5',
                'event: assistant_delta',
                'data: {"threadId":"thread-1","text":"hi"}',
                '',
                'id: 99',
                'event: heartbeat',
                'data: {"threadId":"thread-1"}',
                '',
                ''
              ]
            : [
                'id: 6',
                'event: turn_lifecycle',
                'data: {"threadId":"thread-1","state":"completed"}',
                '',
                ''
              ]
          controller.enqueue(new TextEncoder().encode(chunks.join('\n')))
          controller.close()
          init?.signal?.addEventListener('abort', () => undefined, { once: true })
        }
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const abort = new AbortController()

    try {
      const events = localRuntimeEvents(settings(), 'thread-1', 4, abort.signal)[Symbol.asyncIterator]()
      await events.next()
      const heartbeat = await events.next()
      const third = await events.next()
      abort.abort()

      expect(heartbeat.value).toEqual({
        threadId: 'thread-1',
        seq: 99,
        kind: 'heartbeat'
      })
      expect(third.value).toEqual({
        threadId: 'thread-1',
        state: 'completed',
        seq: 6,
        kind: 'turn_lifecycle'
      })
      const [url] = fetchMock.mock.calls[1] ?? []
      expect(String(url)).toBe('http://127.0.0.1:49876/v1/threads/thread-1/events?since_seq=5')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
