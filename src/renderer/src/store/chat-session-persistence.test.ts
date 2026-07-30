import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_SESSION_RECOVERY_STORAGE_KEY,
  CHAT_SESSION_STORAGE_KEY,
  clearPersistedActiveThread,
  normalizePersistedQueuedMessages,
  persistChatSession,
  readPersistedChatSession
} from './chat-session-persistence'

describe('chat session persistence', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key))
      }
    })
  })

  it('round-trips the active thread and deduplicates queue ids across thread/runtime keys', () => {
    persistChatSession({
      activeThreadId: 'thread-a',
      queuedMessages: [{
        id: 'q-1',
        threadId: 'thread-a',
        runtimeId: 'sciforge',
        text: 'first scientific instruction'
      }, {
        id: 'q-1',
        threadId: 'thread-a',
        runtimeId: 'sciforge',
        text: 'duplicate must not survive'
      }, {
        id: 'q-2',
        threadId: 'thread-b',
        runtimeId: 'sciforge',
        text: 'another thread keeps its distinct queue item'
      }, {
        id: 'q-1',
        threadId: 'thread-c',
        runtimeId: 'codex',
        text: 'global id collision must not survive'
      }]
    })

    expect(readPersistedChatSession()).toEqual({
      activeThreadId: 'thread-a',
      persistenceDegraded: false,
      queuedMessages: [{
        id: 'q-1',
        threadId: 'thread-a',
        runtimeId: 'sciforge',
        text: 'first scientific instruction'
      }, {
        id: 'q-2',
        threadId: 'thread-b',
        runtimeId: 'sciforge',
        text: 'another thread keeps its distinct queue item'
      }]
    })
  })

  it('whitelists serializable fields and requires confirmation for restored attachments', () => {
    const queue = normalizePersistedQueuedMessages([{
      id: 'attachment-q',
      threadId: 'thread-a',
      runtimeId: 'sciforge',
      text: 'inspect this image',
      attachmentIds: ['attachment-1'],
      attachments: [{
        id: 'attachment-1',
        name: 'figure.png',
        mimeType: 'image/png',
        previewUrl: 'blob:renderer-that-no-longer-exists',
        unknownCapability: () => undefined
      }],
      guiPlan: { operation: 'draft', workspaceRoot: '/tmp', relativePath: 'x', planId: 'x' },
      unknown: new Map([['secret', 'value']])
    }])

    expect(queue).toEqual([expect.objectContaining({
      id: 'attachment-q',
      attachmentIds: ['attachment-1'],
      attachments: [{ id: 'attachment-1', name: 'figure.png', mimeType: 'image/png' }],
      restoredAttachmentWarning: expect.stringContaining('attachments restored')
    })])
    expect(queue[0]).not.toHaveProperty('guiPlan')
    expect(queue[0]).not.toHaveProperty('unknown')
    expect(queue[0]?.attachments?.[0]).not.toHaveProperty('previewUrl')
  })

  it('keeps failed sends as ordered recovery entries and rejects malformed envelopes', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeThreadId: 'thread-failure',
      queuedMessages: [{
        id: 'retry-1',
        threadId: 'thread-failure',
        runtimeId: 'codex',
        text: 'do not lose me',
        sendFailure: { userBlockId: 'user-1', message: 'bridge disconnected' }
      }, { id: '', text: 'invalid' }]
    }))

    expect(readPersistedChatSession()).toEqual({
      activeThreadId: 'thread-failure',
      persistenceDegraded: false,
      queuedMessages: [{
        id: 'retry-1',
        threadId: 'thread-failure',
        runtimeId: 'codex',
        text: 'do not lose me',
        sendFailure: { userBlockId: 'user-1', message: 'bridge disconnected' }
      }]
    })

    values.set(CHAT_SESSION_STORAGE_KEY, '{broken json')
    expect(readPersistedChatSession()).toEqual({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ version: 99, queuedMessages: [] }))
    expect(readPersistedChatSession()).toEqual({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
  })

  it('persists only schema-valid remote workspace locators for queued delivery', () => {
    const queue = normalizePersistedQueuedMessages([{
      id: 'remote-q',
      text: 'continue on the remote workspace',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    }, {
      id: 'invalid-remote-q',
      text: 'do not trust malformed placement',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: '',
        path: 'relative/project'
      }
    }])

    expect(queue[0]).toMatchObject({
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(queue[1]).not.toHaveProperty('workspaceLocator')
  })

  it('restores an in-flight delivery journal as an explicit reconciliation barrier', () => {
    persistChatSession({
      activeThreadId: 'thread-in-flight',
      queuedMessages: [{
        id: 'q-in-flight',
        threadId: 'thread-in-flight',
        text: 'run this exactly once',
        deliveryAttempt: {
          startedAt: 1_725_000_000_000,
          userBlockId: 'q-in-flight',
          attemptedText: 'run this exactly once',
          journalOnly: true
        }
      }]
    })

    expect(readPersistedChatSession().queuedMessages).toEqual([expect.objectContaining({
      id: 'q-in-flight',
      deliveryAttempt: {
        startedAt: 1_725_000_000_000,
        userBlockId: 'q-in-flight',
        attemptedText: 'run this exactly once',
        journalOnly: true,
        restored: true
      }
    })])
  })

  it('fails open and removes an oversized session envelope before parsing it', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, 'x'.repeat(2_000_001))

    expect(readPersistedChatSession()).toEqual({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
    expect(values.has(CHAT_SESSION_STORAGE_KEY)).toBe(false)
  })

  it('falls back to a bounded recovery outbox when the primary exceeds limits or storage quota', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeThreadId: 'old-thread',
      queuedMessages: [{ id: 'already-sent', text: 'must not be resurrected' }]
    }))
    const oversized = persistChatSession({
      activeThreadId: 'thread-large',
      queuedMessages: Array.from({ length: 25 }, (_, index) => ({
        id: `large-${index}`,
        text: 'x'.repeat(100_000)
      }))
    })
    expect(oversized).toEqual(expect.objectContaining({ degraded: true, persistedMessages: 5 }))
    expect(values.has(CHAT_SESSION_STORAGE_KEY)).toBe(false)
    expect(values.has(CHAT_SESSION_RECOVERY_STORAGE_KEY)).toBe(true)
    expect(readPersistedChatSession()).toEqual(expect.objectContaining({
      activeThreadId: 'thread-large',
      persistenceDegraded: true,
      queuedMessages: expect.arrayContaining([expect.objectContaining({ id: 'large-0' })])
    }))

    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeThreadId: 'old-thread',
      queuedMessages: [{ id: 'already-sent', text: 'must not be resurrected' }]
    }))
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    const quotaFallback = persistChatSession({
      activeThreadId: 'new-thread',
      queuedMessages: [{ id: 'new-queue', text: 'new value' }]
    })
    expect(quotaFallback).toEqual({ degraded: true, persistedMessages: 1, droppedMessages: 0 })
    expect(values.has(CHAT_SESSION_STORAGE_KEY)).toBe(false)
    expect(readPersistedChatSession()).toEqual({
      activeThreadId: 'new-thread',
      persistenceDegraded: true,
      queuedMessages: [{ id: 'new-queue', text: 'new value' }]
    })
  })

  it('clears only a stale active selection while preserving recovery queue data', () => {
    persistChatSession({
      activeThreadId: 'missing-thread',
      queuedMessages: [{ id: 'kept-q', threadId: 'missing-thread', text: 'keep this instruction' }]
    })

    clearPersistedActiveThread()

    expect(readPersistedChatSession()).toEqual({
      activeThreadId: null,
      persistenceDegraded: false,
      queuedMessages: [{ id: 'kept-q', threadId: 'missing-thread', text: 'keep this instruction' }]
    })
  })
})
