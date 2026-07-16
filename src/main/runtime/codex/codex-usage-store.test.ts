import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppDataJsonlStore } from '../../services/app-data-store'
import { CodexUsageStore } from './codex-usage-store'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-usage-'))
}

describe('CodexUsageStore', () => {
  it('deduplicates turn updates and groups Codex cache telemetry by day, model, and thread', async () => {
    const rootDir = await tempRoot()
    const store = new CodexUsageStore({ rootDir })

    await store.record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        reasoningTokens: 5,
        totalTokens: 115,
        cacheReadTokens: 60,
        cacheWriteTokens: 40
      }
    })
    await store.record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 145,
        cacheReadTokens: 90,
        cacheWriteTokens: 30
      }
    })
    await store.record({
      threadId: 'thread-2',
      turnId: 'turn-2',
      createdAt: '2026-06-11T01:00:00.000Z',
      model: 'gpt-5-mini',
      usage: {
        inputTokens: 80,
        outputTokens: 10,
        totalTokens: 90,
        cacheReadTokens: 20,
        cacheWriteTokens: 60
      }
    })

    await expect(store.summary({
      groupBy: 'day',
      from: '2026-06-10',
      to: '2026-06-11',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'day',
      buckets: [
        {
          date: '2026-06-10',
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedTokens: 90,
          cacheMissTokens: 30,
          totalTokens: 145,
          turns: 1,
          threadCount: 1,
          cacheHitRate: 0.75
        },
        {
          date: '2026-06-11',
          inputTokens: 80,
          cachedTokens: 20,
          cacheMissTokens: 60,
          totalTokens: 90,
          turns: 1,
          threadCount: 1,
          cacheHitRate: 0.25
        }
      ],
      totals: {
        inputTokens: 200,
        cachedTokens: 110,
        cacheMissTokens: 90,
        totalTokens: 235,
        turns: 2,
        threadCount: 2,
        cacheHitRate: 0.55,
        days: 2,
        activeDays: 2
      }
    })

    await expect(store.summary({
      groupBy: 'model',
      from: '2026-06-10',
      to: '2026-06-11',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'model',
      buckets: [
        { model: 'gpt-5-codex', totalTokens: 145, turns: 1 },
        { model: 'gpt-5-mini', totalTokens: 90, turns: 1 }
      ],
      days: [
        { date: '2026-06-10', totalTokens: 145 },
        { date: '2026-06-11', totalTokens: 90 }
      ]
    })

    await expect(store.summary({
      groupBy: 'thread',
      threadId: 'thread-1',
      timezone: 'UTC'
    }, {
      threads: [{ guiThreadId: 'thread-1', title: 'One' }]
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'thread-1',
        title: 'One',
        totalTokens: 145,
        cachedTokens: 90,
        cacheMissTokens: 30,
        turns: 1
      }]
    })
  })

  it('serializes concurrent usage appends without losing JSONL rows', async () => {
    const rootDir = await tempRoot()
    const store = new CodexUsageStore({ rootDir })

    await Promise.all(Array.from({ length: 30 }, (_, index) => store.record({
      threadId: 'thread-1',
      turnId: `turn-${index}`,
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: index + 1,
        outputTokens: 1,
        totalTokens: index + 2
      }
    })))

    const raw = await readFile(join(rootDir, 'usage', 'codex-usage.jsonl'), 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as { turnId: string })
    expect(rows).toHaveLength(30)
    expect(new Set(rows.map((row) => row.turnId)).size).toBe(30)
    await expect(store.summary({ groupBy: 'thread', timezone: 'UTC' })).resolves.toMatchObject({
      totals: { turns: 30, threadCount: 1 }
    })
  })

  it('does not append an unchanged turn again, including after the store is recreated', async () => {
    const rootDir = await tempRoot()
    const input = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110
      }
    }

    const firstStore = new CodexUsageStore({ rootDir })
    await firstStore.record(input)
    await firstStore.record(input)
    await new CodexUsageStore({ rootDir }).record(input)

    const raw = await readFile(join(rootDir, 'usage', 'codex-usage.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
  })

  it('loads its index once and serves repeated queries without reopening the JSONL history', async () => {
    const rootDir = await tempRoot()
    const store = new CodexUsageStore({ rootDir })
    await store.record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }
    })
    const pathSpy = vi.spyOn(AppDataJsonlStore.prototype, 'path')

    const reopened = new CodexUsageStore({ rootDir })
    await reopened.summary({ groupBy: 'thread', timezone: 'UTC' })
    await reopened.summary({ groupBy: 'model', timezone: 'UTC' })
    await reopened.threadUsage('thread-1')

    expect(pathSpy).toHaveBeenCalledTimes(1)
    pathSpy.mockRestore()
  })

  it('compacts a redundant legacy journal to the preferred record per turn', async () => {
    const rootDir = await tempRoot()
    const usageDir = join(rootDir, 'usage')
    const usagePath = join(usageDir, 'codex-usage.jsonl')
    await mkdir(usageDir)
    const rows = Array.from({ length: 300 }, (_, index) => JSON.stringify({
      version: 1,
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      updatedAt: new Date(index + 1).toISOString(),
      model: 'gpt-5-codex',
      inputTokens: index + 1,
      outputTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: index + 1,
      totalTokens: index + 2,
      modelContextWindow: null
    }))
    await writeFile(usagePath, `${rows.join('\n')}\n`, 'utf8')

    const store = new CodexUsageStore({ rootDir })
    await expect(store.threadUsage('thread-1')).resolves.toMatchObject({
      inputTokens: 300,
      totalTokens: 301
    })

    await vi.waitFor(async () => {
      const compacted = (await readFile(usagePath, 'utf8')).trim().split('\n')
      expect(compacted).toHaveLength(1)
      expect(JSON.parse(compacted[0]!) as { inputTokens: number }).toMatchObject({ inputTokens: 300 })
    })
  })

  it('leaves the original journal intact when background compaction cannot replace the target', async () => {
    vi.useFakeTimers()
    try {
      const rootDir = await tempRoot()
      const usageDir = join(rootDir, 'usage')
      const usagePath = join(usageDir, 'codex-usage.jsonl')
      const originalPath = join(usageDir, 'codex-usage.original.jsonl')
      await mkdir(usageDir)
      const row = JSON.stringify({
        version: 1,
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-10T01:00:00.000Z',
        updatedAt: '2026-06-10T01:00:00.000Z',
        model: 'gpt-5-codex',
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheMissTokens: 1,
        totalTokens: 2,
        modelContextWindow: null
      })
      const original = `${Array.from({ length: 300 }, () => row).join('\n')}\n`
      await writeFile(usagePath, original, 'utf8')

      const store = new CodexUsageStore({ rootDir })
      await store.summary({ groupBy: 'thread', timezone: 'UTC' })
      await rename(usagePath, originalPath)
      const outsidePath = join(await tempRoot(), 'outside.jsonl')
      await writeFile(outsidePath, 'outside\n', 'utf8')
      await symlink(outsidePath, usagePath)

      await vi.runAllTimersAsync()
      await store.summary({ groupBy: 'thread', timezone: 'UTC' })

      await expect(readFile(originalPath, 'utf8')).resolves.toBe(original)
      await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside\n')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects symlinked usage append parents and targets', async () => {
    const parentRoot = await tempRoot()
    await symlink(await tempRoot(), join(parentRoot, 'usage'))
    await expect(new CodexUsageStore({ rootDir: parentRoot }).record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })).rejects.toThrow(/must not cross a symlink/)

    const targetRoot = await tempRoot()
    const outsideFile = join(await tempRoot(), 'codex-usage.jsonl')
    await mkdir(join(targetRoot, 'usage'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(targetRoot, 'usage', 'codex-usage.jsonl'))

    await expect(new CodexUsageStore({ rootDir: targetRoot }).record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
