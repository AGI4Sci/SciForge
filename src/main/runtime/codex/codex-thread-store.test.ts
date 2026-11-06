import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataWriteOptions } from '../../services/app-data-store'

const appDataWrites = vi.hoisted(() => [] as Array<{
  rootDir: string
  segments: readonly string[]
  value: unknown
}>)

vi.mock('../../services/app-data-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/app-data-store')>()
  return {
    ...actual,
    atomicWriteAppDataJson: vi.fn(async (
      rootDir: string,
      segments: readonly string[],
      value: unknown,
      options?: AppDataWriteOptions
    ) => {
      appDataWrites.push({ rootDir, segments: [...segments], value })
      return actual.atomicWriteAppDataJson(rootDir, segments, value, options)
    })
  }
})

import { CodexThreadStore } from './codex-thread-store'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-thread-store-'))
}

beforeEach(() => {
  appDataWrites.length = 0
})

describe('CodexThreadStore bulk upsert', () => {
  it('preserves the minimal context marker through updates and reopening old storage', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({ rootDir })
    await store.upsert({ codexThreadId: 'native-minimal', contextProfile: 'minimal' })
    await store.upsert({ codexThreadId: 'native-minimal', latestTurnId: 'turn-1', latestSeq: 3 })
    await store.upsert({ codexThreadId: 'ordinary' })
    const reopened = new CodexThreadStore({ rootDir })
    expect(await reopened.get('native-minimal')).toMatchObject({ contextProfile: 'minimal', latestSeq: 3 })
    expect(await reopened.get('ordinary')).not.toHaveProperty('contextProfile')
  })
  it.each(['failed', 'completed', 'aborted'] as const)(
    'does not inherit a previous %s state when a new turn first reports activity', async (previousStatus) => {
      const rootDir = await tempRoot()
      const store = new CodexThreadStore({ rootDir })
      await store.upsert({
        guiThreadId: 'gui-thread', codexThreadId: 'native-thread',
        latestTurnId: 'previous-turn', latestTurnStatus: previousStatus, latestSeq: 6
      })

      // turn_start_sent identifies the new turn before its user_message sets running.
      const starting = await store.upsert({
        guiThreadId: 'gui-thread', codexThreadId: 'native-thread',
        latestTurnId: 'new-turn', latestSeq: 7
      })
      expect(starting.latestTurnId).toBe('new-turn')
      expect(starting.latestTurnStatus).toBeUndefined()
      await store.upsert({
        guiThreadId: 'gui-thread', codexThreadId: 'native-thread',
        latestTurnId: 'new-turn', latestTurnStatus: 'running', latestSeq: 8
      })
      await expect(new CodexThreadStore({ rootDir }).get('gui-thread')).resolves.toMatchObject({
        latestTurnId: 'new-turn', latestTurnStatus: 'running', latestSeq: 8
      })

      await store.upsert({
        guiThreadId: 'gui-thread', codexThreadId: 'native-thread',
        latestTurnId: 'new-turn', latestTurnStatus: 'completed', latestSeq: 9
      })
      await expect(store.upsert({
        guiThreadId: 'gui-thread', codexThreadId: 'native-thread',
        latestTurnId: 'new-turn', latestTurnStatus: 'running', latestSeq: 10
      })).resolves.toMatchObject({ latestTurnId: 'new-turn', latestTurnStatus: 'completed' })
    }
  )

  it('persists many Codex thread mappings with one snapshot write', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    const records = await store.upsertMany([
      {
        codexThreadId: 'codex-thread-1',
        workspace: '/tmp/workspace',
        workspaceDisplayName: 'Project One',
        title: 'First Codex',
        updatedAt: '2026-06-01T00:00:00.000Z'
      },
      {
        codexThreadId: 'codex-thread-2',
        workspace: '/tmp/workspace',
        title: 'Second Codex',
        updatedAt: '2026-06-02T00:00:00.000Z'
      },
      {
        guiThreadId: 'gui-thread-3',
        codexThreadId: 'codex-thread-3',
        workspace: '/tmp/workspace',
        title: 'Third Codex',
        latestTurnId: 'turn-3',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ])

    expect(records.map((thread) => thread.guiThreadId)).toEqual([
      'codex-thread-1',
      'codex-thread-2',
      'gui-thread-3'
    ])
    expect(records[0]?.workspaceDisplayName).toBe('Project One')
    expect(appDataWrites).toHaveLength(1)
    expect(appDataWrites[0]).toMatchObject({
      rootDir,
      segments: ['threads.json']
    })
    expect((appDataWrites[0]?.value as { threads?: unknown[] }).threads).toHaveLength(3)
    await expect(store.list({ includeArchived: true })).resolves.toEqual([
      expect.objectContaining({ guiThreadId: 'gui-thread-3', codexThreadId: 'codex-thread-3' }),
      expect.objectContaining({ guiThreadId: 'codex-thread-2', codexThreadId: 'codex-thread-2' }),
      expect.objectContaining({ guiThreadId: 'codex-thread-1', codexThreadId: 'codex-thread-1' })
    ])

    const raw = JSON.parse(await readFile(join(rootDir, 'threads.json'), 'utf8')) as {
      threads: Array<{ codexThreadId: string }>
    }
    expect(raw.threads.map((thread) => thread.codexThreadId).sort()).toEqual([
      'codex-thread-1',
      'codex-thread-2',
      'codex-thread-3'
    ])
  })

  it('preserves side thread metadata when later upserts only update activity', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    await store.upsert({
      guiThreadId: 'child-gui',
      codexThreadId: 'child-codex',
      workspace: '/tmp/workspace',
      title: 'Reviewer',
      relation: 'side',
      parentThreadId: 'parent-gui',
      parentTurnId: 'turn-1',
      threadSource: 'subagent',
      sidebarVisibility: 'side',
      titleSource: 'user',
      agentNickname: 'Reviewer',
      agentRole: 'code reviewer'
    })
    await store.upsert({
      codexThreadId: 'child-codex',
      latestTurnId: 'turn-child-2',
      updatedAt: '2026-06-10T11:00:00.000Z'
    })

    await expect(store.get('child-gui')).resolves.toMatchObject({
      guiThreadId: 'child-gui',
      codexThreadId: 'child-codex',
      relation: 'side',
      parentThreadId: 'parent-gui',
      parentTurnId: 'turn-1',
      threadSource: 'subagent',
      sidebarVisibility: 'side',
      titleSource: 'user',
      agentNickname: 'Reviewer',
      agentRole: 'code reviewer',
      latestTurnId: 'turn-child-2'
    })
  })
})
