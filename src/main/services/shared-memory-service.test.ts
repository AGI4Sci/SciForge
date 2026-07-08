import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SharedMemoryService } from './shared-memory-service'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsgui-memory-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('SharedMemoryService', () => {
  it('creates, searches, updates, and soft-deletes shared memory records', async () => {
    const dataDir = await tempDir()
    const workspaceA = await tempDir()
    const workspaceB = await tempDir()
    const service = new SharedMemoryService(dataDir)

    const userMemory = await service.create({
      text: '用户喜欢咖啡',
      scope: 'user',
      tags: ['Profile']
    })
    await service.create({
      text: 'workspace A uses pnpm',
      scope: 'workspace',
      workspace: workspaceA
    })

    expect((await service.retrieveForTurn({
      workspace: workspaceB,
      prompt: '今天的天气怎么样？'
    })).map((record) => record.id)).toContain(userMemory.id)
    expect((await service.list({
      workspace: workspaceB,
      query: 'pnpm'
    })).map((record) => record.text)).not.toContain('workspace A uses pnpm')

    const updated = await service.update({
      memoryId: userMemory.id,
      patch: { text: '用户喜欢茶', tags: ['profile', 'drink'] }
    })
    expect(updated.tags).toEqual(['profile', 'drink'])
    expect((await service.list({ query: '茶' })).map((record) => record.id)).toContain(userMemory.id)

    const deleted = await service.delete(userMemory.id)
    expect(deleted.deleted).toBe(true)
    expect(await service.list({ includeDeleted: false })).toHaveLength(1)
  })

  it('strictly scopes project and turn-specific memory retrieval', async () => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const otherWorkspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const userMemory = await service.create({
      text: 'Global pnpm preference',
      scope: 'user'
    })
    const planUserMemory = await service.create({
      text: 'Plan-only pnpm preference',
      scope: 'user',
      threadMode: 'plan',
      taskType: 'plan_refine'
    })
    const projectMemory = await service.create({
      text: 'Project A pnpm preference',
      scope: 'project',
      workspace
    })
    const otherProjectMemory = await service.create({
      text: 'Project B pnpm preference',
      scope: 'project',
      workspace,
      project: 'project-b'
    })
    const sameProjectOtherWorkspace = await service.create({
      text: 'Other workspace pnpm preference',
      scope: 'project',
      workspace: otherWorkspace,
      project: projectMemory.project!
    })

    const agentIds = (await service.retrieveForTurn({
      workspace,
      project: projectMemory.project!,
      threadMode: 'agent',
      taskType: 'agent',
      prompt: 'pnpm preference'
    })).map((record) => record.id)
    expect(agentIds).toEqual(expect.arrayContaining([userMemory.id, projectMemory.id]))
    expect(agentIds).not.toContain(planUserMemory.id)
    expect(agentIds).not.toContain(otherProjectMemory.id)
    expect(agentIds).not.toContain(sameProjectOtherWorkspace.id)

    const otherWorkspaceIds = (await service.retrieveForTurn({
      workspace: otherWorkspace,
      project: projectMemory.project!,
      threadMode: 'agent',
      taskType: 'agent',
      prompt: 'pnpm preference'
    })).map((record) => record.id)
    expect(otherWorkspaceIds).toContain(sameProjectOtherWorkspace.id)
    expect(otherWorkspaceIds).not.toContain(projectMemory.id)

    const noProjectIds = (await service.retrieveForTurn({
      workspace,
      threadMode: 'agent',
      taskType: 'agent',
      prompt: 'pnpm preference'
    })).map((record) => record.id)
    expect(noProjectIds).toContain(userMemory.id)
    expect(noProjectIds).not.toContain(projectMemory.id)

    const planIds = (await service.retrieveForTurn({
      workspace,
      project: projectMemory.project!,
      threadMode: 'plan',
      taskType: 'plan_refine',
      prompt: 'pnpm preference'
    })).map((record) => record.id)
    expect(planIds).toEqual(expect.arrayContaining([userMemory.id, planUserMemory.id, projectMemory.id]))

    const unfilteredListIds = (await service.list({
      workspace,
      project: projectMemory.project!
    })).map((record) => record.id)
    expect(unfilteredListIds).toEqual(expect.arrayContaining([userMemory.id, planUserMemory.id, projectMemory.id]))

    const agentListIds = (await service.list({
      workspace,
      project: projectMemory.project!,
      threadMode: 'agent',
      taskType: 'agent'
    })).map((record) => record.id)
    expect(agentListIds).toContain(userMemory.id)
    expect(agentListIds).not.toContain(planUserMemory.id)
  })

  it('does not follow a symlinked app-data memory store target', async () => {
    const dataDir = await tempDir()
    const outsideDir = await tempDir()
    const outsideFile = join(outsideDir, 'memories.json')
    await mkdir(join(dataDir, 'shared-memory'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(dataDir, 'shared-memory', 'memories.json'))

    await expect(new SharedMemoryService(dataDir).create({
      text: 'keep writes inside app data'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
