import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import {
  ClaudeCodeEventStore,
  ClaudeCodeThreadStore,
  storedThreadPage
} from './claude-code-store'
import { ClaudeCodeSessionStore } from './claude-code-session-store'
import {
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  EXECUTION_INTEGRITY_POLICY_VERSION
} from '../agent-runtime/execution-integrity-guard'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-claude-code-store-'))
}

describe('ClaudeCodeThreadStore', () => {
  it('persists Claude Code thread snapshots through the shared app-data store helper', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    await store.upsert({
      guiThreadId: 'gui-thread-1',
      claudeSessionId: 'claude-session-1',
      workspace: '/tmp/workspace',
      title: 'Claude Code work',
      model: 'claude-sonnet'
    })

    await expect(new ClaudeCodeThreadStore({ rootDir }).get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      claudeSessionId: 'claude-session-1',
      runtimeId: 'claude',
      workspace: '/tmp/workspace',
      title: 'Claude Code work',
      model: 'claude-sonnet',
      archived: false,
      latestSeq: 0
    })
  })

  it('truly deletes a persisted Claude thread mapping', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeThreadStore({ rootDir })
    await store.upsert({ guiThreadId: 'thread-delete', title: 'Delete me' })

    await store.delete('thread-delete')

    await expect(store.get('thread-delete')).resolves.toBeNull()
  })

  it('does not follow a symlinked app-data thread snapshot target', async () => {
    const rootDir = await tempRoot()
    const outsideDir = await tempRoot()
    const outsideFile = join(outsideDir, 'threads.json')
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(rootDir, 'threads.json'))

    await expect(new ClaudeCodeThreadStore({ rootDir }).upsert({
      guiThreadId: 'gui-thread-1',
      title: 'Claude Code work'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})

describe('ClaudeCodeEventStore', () => {
  it('deletes an event log and resets its cached sequence', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeEventStore({ rootDir })
    await store.append('thread-delete', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'thread-delete',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'temporary'
    })

    await store.delete('thread-delete')

    await expect(store.read('thread-delete')).resolves.toEqual([])
    await expect(store.latestSeq('thread-delete')).resolves.toBe(0)
  })

  it('preserves the hidden execution-integrity marker as typed thread metadata', async () => {
    const rootDir = await tempRoot()
    const eventStore = new ClaudeCodeEventStore({ rootDir })
    const threadStore = new ClaudeCodeThreadStore({ rootDir })
    const thread = await threadStore.upsert({
      guiThreadId: 'thread-integrity',
      workspace: '/tmp/workspace',
      title: 'Integrity',
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })
    await eventStore.append('thread-integrity', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'thread-integrity',
      turnId: 'turn-1',
      itemId: 'user-1',
      text: 'Runtime-enforced execution integrity gate: []\n\nshort user prompt',
      displayText: 'short user prompt'
    })

    await expect(storedThreadPage(thread, eventStore)).resolves.toMatchObject({
      turns: [{
        items: [{
          id: 'user-1',
          text: 'short user prompt',
          meta: {
            [EXECUTION_INTEGRITY_POLICY_METADATA_KEY]: EXECUTION_INTEGRITY_POLICY_VERSION
          }
        }]
      }]
    })
  })

  it('appends and replays multiple Claude event JSONL rows', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeEventStore({
      rootDir,
      now: () => new Date('2026-06-10T11:00:00.000Z')
    })

    await store.append('thread-1', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'hello'
    })
    await store.append('thread-1', {
      kind: 'turn_lifecycle',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed'
    })

    expect((await store.read('thread-1', { includeAll: true })).map((event) => event.seq)).toEqual([1, 2])
  })

  it('pages complete Claude turns and externalizes large tool details on demand', async () => {
    const rootDir = await tempRoot()
    const eventStore = new ClaudeCodeEventStore({ rootDir })
    const threadStore = new ClaudeCodeThreadStore({ rootDir })
    const detail = '界'.repeat(20_000)
    for (const event of [
      {
        kind: 'assistant_delta' as const,
        runtimeId: 'claude' as const,
        threadId: 'thread-page',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        text: 'first'
      },
      {
        kind: 'turn_lifecycle' as const,
        runtimeId: 'claude' as const,
        threadId: 'thread-page',
        turnId: 'turn-1',
        state: 'completed' as const
      },
      {
        kind: 'tool_event' as const,
        runtimeId: 'claude' as const,
        threadId: 'thread-page',
        turnId: 'turn-2',
        itemId: 'tool-2',
        summary: 'Large output',
        status: 'success' as const,
        detail,
        receipt: createExecutionReceipt({ status: 'success', detail })
      },
      {
        kind: 'turn_lifecycle' as const,
        runtimeId: 'claude' as const,
        threadId: 'thread-page',
        turnId: 'turn-2',
        state: 'completed' as const
      }
    ]) await eventStore.append('thread-page', event)
    const thread = await threadStore.upsert({
      guiThreadId: 'thread-page',
      latestSeq: 4,
      latestTurnId: 'turn-2',
      latestTurnStatus: 'completed'
    })

    const latest = await storedThreadPage(thread, eventStore, { limit: 1 })
    expect(latest.latestSeq).toBe(4)
    expect(latest.turns.map((turn) => turn.id)).toEqual(['turn-2'])
    expect(latest.nextCursor).toEqual(expect.any(String))
    const tool = latest.turns[0]?.items?.[0]
    expect(Buffer.byteLength(tool?.detail ?? '', 'utf8')).toBeLessThanOrEqual(4_096)
    expect(tool?.detailArtifact?.size).toBe(Buffer.byteLength(detail, 'utf8'))
    await expect(eventStore.readToolArtifact('thread-page', tool!.detailArtifact!.ref)).resolves.toBe(detail)

    const earlier = await storedThreadPage(thread, eventStore, {
      cursor: latest.nextCursor!,
      limit: 1
    })
    expect(earlier.turns.map((turn) => turn.id)).toEqual(['turn-1'])
    expect(earlier.nextCursor).toBeNull()
  })

  it('serializes concurrent Claude event appends without corrupting JSONL rows', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeEventStore({ rootDir })

    await Promise.all(Array.from({ length: 25 }, (_, index) => store.append('thread-1', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: `assistant-${index}`,
      text: `chunk ${index}`
    })))

    const raw = await readFile(join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`), 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as { seq: number })
    expect(rows).toHaveLength(25)
    expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1))
  })

  it('rejects symlinked Claude event parents and targets', async () => {
    const parentRoot = await tempRoot()
    await symlink(await tempRoot(), join(parentRoot, 'events'))
    await expect(new ClaudeCodeEventStore({ rootDir: parentRoot }).append('thread-1', {
      kind: 'turn_lifecycle',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed'
    })).rejects.toThrow(/must not cross a symlink/)

    const targetRoot = await tempRoot()
    const outsideFile = join(await tempRoot(), 'thread.jsonl')
    await mkdir(join(targetRoot, 'events'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(targetRoot, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`))

    await expect(new ClaudeCodeEventStore({ rootDir: targetRoot }).append('thread-1', {
      kind: 'turn_lifecycle',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})

describe('ClaudeCodeSessionStore', () => {
  it('appends and loads multi-entry Claude session transcripts', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeSessionStore({ rootDir })
    const key = { projectKey: '/workspace', sessionId: 'session-1' }

    await store.append(key, [
      { type: 'user', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', message: { role: 'assistant', content: 'world' } }
    ] as unknown as SessionStoreEntry[])

    const loaded = await store.load(key)
    expect(loaded).toHaveLength(2)
    const raw = await readFile(store.transcriptPath(key), 'utf8')
    expect(raw.trim().split('\n').map((line) => JSON.parse(line))).toHaveLength(2)
  })

  it('serializes concurrent Claude session transcript appends', async () => {
    const rootDir = await tempRoot()
    const store = new ClaudeCodeSessionStore({ rootDir })
    const key = { projectKey: '/workspace', sessionId: 'session-1', subpath: 'turns/main' }

    await Promise.all(Array.from({ length: 30 }, (_, index) => store.append(key, [
      { type: 'assistant', message: { role: 'assistant', content: `chunk ${index}` } }
    ] as unknown as SessionStoreEntry[])))

    const raw = await readFile(store.transcriptPath(key), 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line))
    expect(rows).toHaveLength(30)
  })

  it('rejects symlinked Claude session transcript parents and targets', async () => {
    const parentRoot = await tempRoot()
    await symlink(await tempRoot(), join(parentRoot, 'sdk-session-store'))
    await expect(new ClaudeCodeSessionStore({ rootDir: parentRoot }).append({
      projectKey: '/workspace',
      sessionId: 'session-1'
    }, [{ type: 'user' }] as unknown as SessionStoreEntry[])).rejects.toThrow(/must not cross a symlink/)

    const targetRoot = await tempRoot()
    const outsideFile = join(await tempRoot(), 'session.jsonl')
    const projectDir = join(targetRoot, 'sdk-session-store', 'projects', Buffer.from('/workspace').toString('base64url'))
    await mkdir(projectDir, { recursive: true })
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(projectDir, `${Buffer.from('session-1').toString('base64url')}.jsonl`))

    await expect(new ClaudeCodeSessionStore({ rootDir: targetRoot }).append({
      projectKey: '/workspace',
      sessionId: 'session-1'
    }, [{ type: 'user' }] as unknown as SessionStoreEntry[])).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
