import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuntimeGoalService } from './runtime-goal-service'

describe('RuntimeGoalService', () => {
  it('sets, updates, clears, and persists runtime goals', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-goals-'))
    const service = new RuntimeGoalService(dataDir)

    const goal = await service.set({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: {
        objective: 'ship goal support',
        status: 'active',
        tokenBudget: 100
      }
    })

    expect(goal).toMatchObject({
      runtimeId: 'codex',
      threadId: 'thread-1',
      objective: 'ship goal support',
      status: 'active',
      tokenBudget: 100,
      tokensUsed: 0,
      timeUsedSeconds: 0
    })

    await expect(service.set({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: { status: 'complete' }
    })).resolves.toMatchObject({
      objective: 'ship goal support',
      status: 'complete',
      tokenBudget: 100
    })

    await expect(new RuntimeGoalService(dataDir).get({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toMatchObject({
      objective: 'ship goal support',
      status: 'complete'
    })

    await expect(service.clear({ runtimeId: 'codex', threadId: 'thread-1' })).resolves.toBe(true)
    await expect(service.clear({ runtimeId: 'codex', threadId: 'thread-1' })).resolves.toBe(false)
    await expect(service.get({ runtimeId: 'codex', threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('rejects status-only updates when no goal exists', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-goals-'))
    const service = new RuntimeGoalService(dataDir)

    await expect(service.set({
      runtimeId: 'claude',
      threadId: 'thread-1',
      patch: { status: 'paused' }
    })).rejects.toThrow(/no goal exists/)
  })

  it('does not follow a symlinked app-data goal store target', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-goals-'))
    const outsideDir = await mkdtemp(join(tmpdir(), 'runtime-goals-outside-'))
    const outsideFile = join(outsideDir, 'goals.json')
    await mkdir(join(dataDir, 'runtime-goals'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(dataDir, 'runtime-goals', 'goals.json'))

    await expect(new RuntimeGoalService(dataDir).set({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: { objective: 'keep writes inside app data' }
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
