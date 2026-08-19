import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CodexEventStore } from './codex-event-store'
import { CodexThreadStore } from './codex-thread-store'
import { externalizeToolDetails } from '../agent-runtime/jsonl-thread-page'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-store-'))
}

describe('CodexThreadStore', () => {
  it('persists Codex thread mappings without using local runtime ids or paths', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    const created = await store.upsert({
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Codex work'
    })

    expect(created).toMatchObject({
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'Codex work',
      archived: false,
      latestSeq: 0
    })

    await store.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      latestSeq: 7,
      latestTurnId: 'turn-1'
    })

    expect(await store.get('gui-thread-1')).toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      latestSeq: 7,
      latestTurnId: 'turn-1'
    })
    expect(await store.getByCodexThreadId('codex-thread-1')).toMatchObject({
      guiThreadId: 'gui-thread-1'
    })
  })

  it('normalizes malformed persisted thread records and filters archived lists', async () => {
    const rootDir = await tempRoot()
    await writeFile(join(rootDir, 'threads.json'), JSON.stringify({
      version: 1,
      threads: [
        { codexThreadId: 'codex-live', title: 'Live' },
        { codexThreadId: 'codex-archived', archived: true },
        { guiThreadId: 'missing-codex-id' }
      ]
    }), 'utf8')
    const store = new CodexThreadStore({ rootDir })

    expect((await store.list()).map((thread) => thread.codexThreadId)).toEqual(['codex-live'])
    expect((await store.list({ includeArchived: true })).map((thread) => thread.codexThreadId).sort()).toEqual([
      'codex-archived',
      'codex-live'
    ])
  })

  it('preserves explicit runtime updatedAt values during upsert', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    await store.upsert({
      codexThreadId: 'older-live-thread',
      title: 'Older',
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
    await store.upsert({
      codexThreadId: 'newer-live-thread',
      title: 'Newer',
      updatedAt: '2026-06-02T00:00:00.000Z'
    })

    const threads = await store.list()

    expect(threads.map((thread) => thread.codexThreadId)).toEqual([
      'newer-live-thread',
      'older-live-thread'
    ])
    expect(await store.get('older-live-thread')).toMatchObject({
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
  })

  it('keeps a terminal status absorbing for the same turn while allowing a newer turn to run', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({ rootDir })
    await store.upsert({
      codexThreadId: 'codex-terminal-thread',
      latestSeq: 10,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })

    await store.upsert({
      codexThreadId: 'codex-terminal-thread',
      latestSeq: 11,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'running'
    })
    await expect(store.get('codex-terminal-thread')).resolves.toMatchObject({
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })

    await store.upsert({
      codexThreadId: 'codex-terminal-thread',
      latestSeq: 12,
      latestTurnId: 'turn-2',
      latestTurnStatus: 'running'
    })
    await expect(store.get('codex-terminal-thread')).resolves.toMatchObject({
      latestTurnId: 'turn-2',
      latestTurnStatus: 'running'
    })
  })

  it('recovers a valid threads snapshot when a corrupted tail is present', async () => {
    const rootDir = await tempRoot()
    await writeFile(join(rootDir, 'threads.json'), `${JSON.stringify({
      version: 1,
      threads: [{ codexThreadId: 'codex-live', title: 'Live' }]
    }, null, 2)}\nnot-json-tail`, 'utf8')
    const store = new CodexThreadStore({ rootDir })

    expect((await store.list()).map((thread) => thread.codexThreadId)).toEqual(['codex-live'])
  })

  it('serializes concurrent upserts into one valid snapshot', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({ rootDir })

    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.upsert({
        codexThreadId: `codex-thread-${index}`,
        title: `Thread ${index}`
      })
    ))

    const raw = await readFile(join(rootDir, 'threads.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect((await store.list()).map((thread) => thread.codexThreadId).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `codex-thread-${index}`).sort()
    )
  })

  it('does not follow a symlinked app-data thread snapshot target', async () => {
    const rootDir = await tempRoot()
    const outsideDir = await tempRoot()
    const outsideFile = join(outsideDir, 'threads.json')
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(rootDir, 'threads.json'))

    await expect(new CodexThreadStore({ rootDir }).upsert({
      codexThreadId: 'codex-thread-1',
      title: 'Codex work'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})

describe('CodexEventStore', () => {
  it('keeps exact durable child lookup independent from bounded summary pages', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    const child = {
      id: 'child-exact', runtimeId: 'codex' as const, parentThreadId: 'parent', kind: 'agent' as const,
      status: 'running' as const, updatedAt: '2026-08-19T00:00:00.000Z'
    }
    await store.append('parent', { threadId: 'parent', child })
    await store.append('parent', {
      threadId: 'parent',
      child: { ...child, status: 'completed', summary: 'done', updatedAt: '2026-08-19T00:00:01.000Z' }
    })
    await expect(store.findLatestChild('parent', 'child-exact')).resolves.toMatchObject({
      id: 'child-exact', status: 'completed', summary: 'done'
    })
    await store.append('parent', {
      threadId: 'parent',
      child: { ...child, status: 'completed', metadata: { lifecycleOperation: 'delete' } }
    })
    await expect(store.findLatestChild('parent', 'child-exact')).resolves.toBeNull()
  })

  it('streams a bounded latest-child window while retaining exact access to older audit history', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    await Promise.all(Array.from({ length: 400 }, (_, index) => store.append('parent-scale', {
      threadId: 'parent-scale',
      child: {
        id: `child-${index}`, runtimeId: 'codex', parentThreadId: 'parent-scale', kind: 'agent',
        status: 'completed', updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      }
    })))
    const latest = await store.readLatestChildren('parent-scale')
    expect(latest).toHaveLength(200)
    expect(latest.map((child) => child.id)).toContain('child-399')
    expect(latest.map((child) => child.id)).not.toContain('child-0')
    await expect(store.findLatestChild('parent-scale', 'child-0')).resolves.toMatchObject({ id: 'child-0' })
  })

  it('appends normalized events with GUI-owned seq values', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({
      rootDir,
      now: () => new Date('2026-06-10T11:00:00.000Z')
    })

    const first = await store.append('codex/thread:1', {
      threadId: 'codex/thread:1',
      deltas: [{ kind: 'agent_message', text: 'Hello' }]
    })
    const second = await store.append('codex/thread:1', {
      threadId: 'codex/thread:1',
      turnComplete: true
    })

    expect(first.seq).toBe(1)
    expect(first.event.seq).toBe(1)
    expect(first.event.createdAt).toBe('2026-06-10T11:00:00.000Z')
    expect(second.seq).toBe(2)
    expect(second.event.createdAt).toBe(second.createdAt)
    expect(await store.latestSeq('codex/thread:1')).toBe(2)
    const replayed = await store.read('codex/thread:1', { sinceSeq: 1 })
    expect(replayed.map((event) => event.seq)).toEqual([2])
    expect(replayed[0]?.event.createdAt).toBe(replayed[0]?.createdAt)
  })

  it('projects legacy outer-envelope time into replayed lifecycle events', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    const first = await store.append('thread-legacy', {
      threadId: 'thread-legacy',
      turnId: 'turn-legacy',
      turnComplete: true
    })
    const path = join(
      rootDir,
      'events',
      `${Buffer.from('thread-legacy').toString('base64url')}.jsonl`
    )
    const raw = JSON.parse((await readFile(path, 'utf8')).trim()) as {
      event: { createdAt?: string }
    }
    delete raw.event.createdAt
    await writeFile(path, `${JSON.stringify(raw)}\n`, 'utf8')

    const replayed = await new CodexEventStore({ rootDir }).read('thread-legacy', { includeAll: true })
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.createdAt).toBe(first.createdAt)
    expect(replayed[0]?.event.createdAt).toBe(first.createdAt)
  })

  it('serializes concurrent appends for one thread into unique monotonic seq values', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    await store.append('thread-1', { threadId: 'thread-1', deltas: [{ kind: 'agent_message', text: 'seed' }] })

    const appended = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.append('thread-1', {
        threadId: 'thread-1',
        deltas: [{ kind: 'agent_message', text: `message ${index}` }]
      })
    ))

    expect(appended.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    )
    expect((await store.read('thread-1')).map((event) => event.seq)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1)
    )
    const raw = await readFile(join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`), 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as { seq: number })
    expect(rows).toHaveLength(21)
    expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1))
  })

  it('continues seq values from the existing event log after a store restart', async () => {
    const rootDir = await tempRoot()
    const firstStore = new CodexEventStore({ rootDir })
    await firstStore.append('thread-1', { threadId: 'thread-1', deltas: [{ kind: 'agent_message', text: 'one' }] })
    await firstStore.append('thread-1', { threadId: 'thread-1', deltas: [{ kind: 'agent_message', text: 'two' }] })

    const restartedStore = new CodexEventStore({ rootDir })
    const appended = await restartedStore.append('thread-1', {
      threadId: 'thread-1',
      turnComplete: true
    })

    expect(appended.seq).toBe(3)
    expect(await restartedStore.latestSeq('thread-1')).toBe(3)
  })

  it('pages complete turns newest-first and preserves the latest sequence', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    for (const event of [
      { threadId: 'thread-1', turnId: 'turn-1', deltas: [{ kind: 'agent_message' as const, text: 'one' }] },
      { threadId: 'thread-1', turnId: 'turn-1', turnComplete: true },
      { threadId: 'thread-1', turnId: 'turn-2', deltas: [{ kind: 'agent_message' as const, text: 'two' }] },
      { threadId: 'thread-1', turnId: 'turn-2', turnComplete: true },
      { threadId: 'thread-1', turnId: 'turn-3', deltas: [{ kind: 'agent_message' as const, text: 'three' }] }
    ]) await store.append('thread-1', event)

    const latest = await store.readPage('thread-1', { limit: 2 })
    expect(latest.events.map((event) => event.seq)).toEqual([3, 4, 5])
    expect(latest.nextCursor).toEqual(expect.any(String))
    expect(await store.latestSeq('thread-1')).toBe(5)

    const earlier = await store.readPage('thread-1', { cursor: latest.nextCursor!, limit: 2 })
    expect(earlier.events.map((event) => event.seq)).toEqual([1, 2])
    expect(earlier.nextCursor).toBeNull()
    expect(await store.latestSeq('thread-1')).toBe(5)
  })

  it('reads the latest full tool detail only through its artifact reference', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    const originalDetail = 'x'.repeat(20_000)
    await store.append('thread-1', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: { itemId: 'tool-1', summary: 'Running', status: 'running', detail: 'initial' }
    })
    await store.append('thread-1', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: { itemId: 'tool-1', summary: 'Done', status: 'success', detail: originalDetail }
    })
    const [externalized] = externalizeToolDetails({
      runtimeId: 'codex',
      threadId: 'thread-1',
      items: [{ id: 'tool-1', kind: 'tool', detail: originalDetail }]
    })

    expect(externalized?.detail).toHaveLength(4_096)
    expect(externalized?.detailArtifact?.size).toBe(20_000)
    await expect(store.readToolArtifact('thread-1', externalized!.detailArtifact!.ref))
      .resolves.toBe(originalDetail)
    await expect(store.readToolArtifact('missing-thread', externalized!.detailArtifact!.ref))
      .resolves.toBeNull()

    const outputOnly = { rows: Array.from({ length: 2_000 }, () => 'full-output') }
    await store.append('thread-1', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: { itemId: 'tool-output', summary: 'Done', status: 'success', meta: { output: outputOnly } }
    })
    const [outputProjection] = externalizeToolDetails({
      runtimeId: 'codex',
      threadId: 'thread-1',
      items: [{ id: 'tool-output', kind: 'tool', meta: { output: outputOnly } }]
    })
    expect(outputProjection?.detailArtifact).toBeDefined()
    await expect(store.readToolArtifact('thread-1', outputProjection!.detailArtifact!.ref))
      .resolves.toBe(JSON.stringify(outputOnly))
  })

  it('ignores malformed JSONL rows when replaying events', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    await store.append('thread-1', { threadId: 'thread-1', turnComplete: true })
    const eventFiles = await readFile(join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`), 'utf8')
    await writeFile(
      join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`),
      `${eventFiles}{bad json\n${JSON.stringify({ seq: 2, threadId: 'other', event: { threadId: 'other' } })}\n`,
      'utf8'
    )

    expect((await store.read('thread-1')).map((event) => event.seq)).toEqual([1])
  })

  it('rejects event append through symlinked app-data event parents and targets', async () => {
    const parentRoot = await tempRoot()
    const outsideParent = await tempRoot()
    await symlink(outsideParent, join(parentRoot, 'events'))
    await expect(new CodexEventStore({ rootDir: parentRoot }).append('thread-1', {
      threadId: 'thread-1',
      turnComplete: true
    })).rejects.toThrow(/must not cross a symlink/)

    const targetRoot = await tempRoot()
    const outsideTarget = join(await tempRoot(), 'thread.jsonl')
    await mkdir(join(targetRoot, 'events'))
    await writeFile(outsideTarget, 'outside', 'utf8')
    await symlink(outsideTarget, join(targetRoot, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`))

    await expect(new CodexEventStore({ rootDir: targetRoot }).append('thread-1', {
      threadId: 'thread-1',
      turnComplete: true
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('outside')
  })
})
