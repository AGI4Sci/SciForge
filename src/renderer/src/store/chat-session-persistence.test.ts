import i18n from '../i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_SESSION_RECOVERY_STORAGE_KEY,
  CHAT_SESSION_STORAGE_KEY,
  clearPersistedActiveThread,
  normalizePersistedQueuedMessages,
  persistChatSession,
  readPersistedChatSession,
  readLegacyInputRecovery
} from './chat-session-persistence'

describe('chat session persistence', () => {
  it('preserves queued DSH runtime ownership', () => {
    expect(normalizePersistedQueuedMessages([{ id: 'dsh-q', text: 'hello', runtimeId: 'dsh', threadId: 'dsh-session' }], false))
      .toEqual([expect.objectContaining({ runtimeId: 'dsh', threadId: 'dsh-session' })])
  })
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
        runtimeId: 'dsh',
        text: 'first scientific instruction'
      }, {
        id: 'q-1',
        threadId: 'thread-a',
        runtimeId: 'dsh',
        text: 'duplicate must not survive'
      }, {
        id: 'q-2',
        threadId: 'thread-b',
        runtimeId: 'dsh',
        text: 'another thread keeps its distinct queue item'
      }, {
        id: 'q-1',
        threadId: 'thread-c',
        runtimeId: 'codex',
        text: 'global id collision must not survive'
      }]
    })

    expect(readPersistedChatSession()).toMatchObject({
      activeThreadId: 'thread-a',
      persistenceDegraded: false,
      queuedMessages: [{
        id: 'q-1',
        threadId: 'thread-a',
        runtimeId: 'dsh',
        text: 'first scientific instruction'
      }, {
        id: 'q-2',
        threadId: 'thread-b',
        runtimeId: 'dsh',
        text: 'another thread keeps its distinct queue item'
      }]
    })
  })

  it('keeps Host-managed inputs out of the browser durable queue and blocks legacy replay', () => {
    persistChatSession({ activeThreadId: 'thread-a', queuedMessages: [
      { id: 'direct', text: 'Host direct', hostManaged: true },
      { id: 'admitted', text: 'Host queue', admissionReceipt: { clientDirectiveId: 'admitted', revision: 2,
        payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' } },
      { id: 'legacy', text: 'old pending text' }
    ] })
    const restored = readPersistedChatSession()
    expect(restored.queuedMessages).toHaveLength(1)
    expect(restored.queuedMessages[0]).toMatchObject({ id: 'legacy', sendFailure: {
      message: i18n.t('common:sessionInputLegacyDispositionRequired'), kind: 'legacy-disposition-required'
    } })
    expect(values.get(CHAT_SESSION_STORAGE_KEY)).not.toContain('Host queue')
    expect(values.get(CHAT_SESSION_STORAGE_KEY)).not.toContain('Host direct')
  })

  it('does not certify unreadable legacy storage as an empty recovery checkpoint', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, '{broken')
    expect(() => readLegacyInputRecovery()).toThrow()
    persistChatSession({ activeThreadId: null, queuedMessages: [] })
    expect(values.get(CHAT_SESSION_STORAGE_KEY)).toBe('{broken')
    values.delete(CHAT_SESSION_STORAGE_KEY)
    window.localStorage.getItem = vi.fn(() => { throw new Error('storage denied') })
    expect(() => readLegacyInputRecovery()).toThrow('storage denied')
  })

  it('distinguishes known-unsent legacy drafts from an attempted input requiring reconciliation', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, queuedMessages: [
      { id: 'unsent', text: 'private text', runtimeId: 'codex', threadId: 'bound' },
      { id: 'attempted', text: 'once only', runtimeId: 'codex', threadId: 'bound',
        sendFailure: { userBlockId: 'attempted', message: 'bridge response lost' } }
    ] }))
    expect(readLegacyInputRecovery().map((entry) => entry.disposition)).toEqual(['unconfirmed', 'uncertain'])
  })

  it('persists legacy warning provenance across locales and keeps unmarked failures uncertain', async () => {
    await i18n.changeLanguage('en')
    const [restored] = normalizePersistedQueuedMessages([{ id: 'unsent', text: 'private text' }])
    persistChatSession({ activeThreadId: null, queuedMessages: [restored] })
    await i18n.changeLanguage('zh')
    expect(readPersistedChatSession().queuedMessages[0]?.sendFailure).toEqual({
      userBlockId: 'unsent', kind: 'legacy-disposition-required', message: i18n.t('common:sessionInputLegacyDispositionRequired')
    })
    expect(readLegacyInputRecovery()[0]?.disposition).toBe('unconfirmed')

    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, queuedMessages: [
      { id: 'unmarked', text: 'unknown send', sendFailure: { userBlockId: 'unmarked', message: i18n.t('common:sessionInputLegacyDispositionRequired') } },
      { id: 'attempted', text: 'attempted send', sendFailure: restored.sendFailure,
        deliveryAttempt: { startedAt: 1, userBlockId: 'attempted', attemptedText: 'attempted send' } }
    ] }))
    expect(readLegacyInputRecovery().map(entry => entry.disposition)).toEqual(['uncertain', 'uncertain'])
    await i18n.changeLanguage('en')
  })

  it('round-trips bounded per-thread and draft conversation settings', () => {
    persistChatSession({
      activeThreadId: 'thread-a',
      queuedMessages: [],
      conversationSettingsByThread: {
        'thread-a': { model: '', reasoningEffort: 'medium', serviceTier: '' },
        'thread-b': { model: 'runtime-model', reasoningEffort: 'ultra', serviceTier: 'priority' },
        ['x'.repeat(600)]: { model: 'ignored', reasoningEffort: 'high', serviceTier: 'default' }
      },
      draftConversationSettings: {
        model: 'draft-model',
        reasoningEffort: 'high',
        serviceTier: 'fast'
      }
    })

    expect(readPersistedChatSession()).toMatchObject({
      conversationSettingsByThread: {
        'thread-a': { model: '', reasoningEffort: 'medium', serviceTier: '' },
        'thread-b': { model: 'runtime-model', reasoningEffort: 'ultra', serviceTier: 'priority' }
      },
      draftConversationSettings: {
        model: 'draft-model',
        reasoningEffort: 'high',
        serviceTier: 'fast'
      }
    })
  })

  it('persists a cleared (upstream default) reasoning effort so a reset is not repeated', () => {
    persistChatSession({
      activeThreadId: null,
      queuedMessages: [],
      conversationSettingsByThread: { 'thread-a': { model: '', reasoningEffort: '', serviceTier: '' } },
      draftConversationSettings: { model: '', reasoningEffort: '', serviceTier: '' }
    })

    expect(readPersistedChatSession()).toMatchObject({
      conversationSettingsByThread: { 'thread-a': { model: '', reasoningEffort: '', serviceTier: '' } },
      draftConversationSettings: { model: '', reasoningEffort: '', serviceTier: '' }
    })
  })

  it('preserves the immutable service tier in queued delivery journals', () => {
    const queue = normalizePersistedQueuedMessages([{
      id: 'service-tier-q',
      text: 'use the frozen speed',
      model: 'runtime-model',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    }], false)

    expect(queue[0]).toMatchObject({
      model: 'runtime-model',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })
  })

  it('whitelists serializable fields and requires confirmation for restored attachments', () => {
    const queue = normalizePersistedQueuedMessages([{
      id: 'attachment-q',
      threadId: 'thread-a',
      runtimeId: 'dsh',
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

  it('persists file references as workspace-relative locator metadata only', () => {
    const queue = normalizePersistedQueuedMessages([{
      id: 'file-q',
      text: 'read the referenced files',
      fileReferences: [{
        path: '/workspace/sciforge/papers/report.pdf',
        relativePath: 'papers/report.pdf',
        name: 'report.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf',
        workspaceRoot: '/workspace/sciforge',
        delivery: 'model_router_object',
        modelRouterObject: true
      }, {
        path: '../outside.txt',
        relativePath: '../outside.txt',
        name: 'outside.txt'
      }]
    }], false)

    expect(queue[0]?.fileReferences).toEqual([{
      path: 'papers/report.pdf',
      relativePath: 'papers/report.pdf',
      name: 'report.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf'
    }])
  })

  it('removes legacy inlined file contents when restoring a queued message', () => {
    const legacyRuntimeText = [
      'The user referenced these workspace files. Use them as context for the request.',
      '<workspace_file path="papers/private.md">',
      'PRIVATE FILE CONTENT',
      '</workspace_file>',
      'User request:',
      'summarize the paper'
    ].join('\n')
    const queue = normalizePersistedQueuedMessages([{
      id: 'legacy-file-q',
      text: legacyRuntimeText,
      displayText: 'summarize the paper',
      deliveryAttempt: {
        startedAt: 1,
        userBlockId: 'legacy-file-q',
        attemptedText: legacyRuntimeText
      },
      fileReferences: [{
        path: 'papers/private.md',
        relativePath: 'papers/private.md',
        name: 'private.md',
        kind: 'text'
      }]
    }], true)

    expect(queue[0]?.text).toBe('summarize the paper')
    expect(queue[0]?.deliveryAttempt?.attemptedText).toBe('summarize the paper')
    expect(JSON.stringify(queue)).not.toContain('PRIVATE FILE CONTENT')
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

    expect(readPersistedChatSession()).toMatchObject({
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
    expect(readPersistedChatSession()).toMatchObject({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
    values.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ version: 99, queuedMessages: [] }))
    expect(readPersistedChatSession()).toMatchObject({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
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

  it('preserves an oversized envelope so recovery cannot incorrectly certify empty input', () => {
    values.set(CHAT_SESSION_STORAGE_KEY, 'x'.repeat(2_000_001))

    expect(readPersistedChatSession()).toMatchObject({ activeThreadId: null, queuedMessages: [], persistenceDegraded: false })
    expect(values.has(CHAT_SESSION_STORAGE_KEY)).toBe(true)
    expect(() => readLegacyInputRecovery()).toThrow('recovery limit')
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
    expect(readPersistedChatSession()).toMatchObject({
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

    expect(readPersistedChatSession()).toMatchObject({
      activeThreadId: null,
      persistenceDegraded: false,
      queuedMessages: [{ id: 'kept-q', threadId: 'missing-thread', text: 'keep this instruction' }]
    })
  })
})
