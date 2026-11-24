import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { symlink } from '../../test-support/symlink'
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


const researchMetadata = () => ({
  sources: [{ owner: 'public-contract', locator: 'artifact://run/input', version: 'v1', digest: 'sha256:exact', access: 'unknown' as const }],
  conditions: ['Only under matched compute and temperature 300K'],
  counterexamples: ['Negative control at 310K failed'],
  corrections: ['Measured simulation only; no device evidence']
})

describe('source-bound research memory', () => {
  it.each(['inaccessible', 'withdrawn'] as const)('redacts %s across create, update, list and turn retrieval after restart while retaining raw evidence', async (restriction) => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const metadata = researchMetadata()
    const restricted = {
      ...metadata,
      status: restriction === 'withdrawn' ? 'withdrawn' as const : 'unverified' as const, history: [],
      ...(restriction === 'inaccessible' ? {
        sources: [{ ...metadata.sources[0], access: 'inaccessible' as const }]
      } : {})
    }
    const service = new SharedMemoryService(dataDir)
    const created = await service.create({ text: 'PRIVATE THERMAL CLAIM', workspace, tags: ['private-tag'], research: restricted })
    const original = await service.create({ text: 'PRIVATE THERMAL HISTORY', workspace, tags: ['private-tag'], research: metadata })
    await service.update({ memoryId: original.id, patch: { text: 'PRIVATE THERMAL CLAIM' } })
    const updated = await service.update({ memoryId: original.id, patch: { research: restricted } })
    const restarted = new SharedMemoryService(dataDir)
    const outputs = [created, updated, await restarted.list({ workspace }), await restarted.retrieveForTurn({ workspace, prompt: 'THERMAL' })]
    const privateTexts = ['PRIVATE', 'private-tag', metadata.sources[0].locator, metadata.sources[0].owner,
      metadata.sources[0].digest, ...metadata.conditions, ...metadata.counterexamples, ...metadata.corrections]
    for (const output of outputs) {
      const serialized = JSON.stringify(output)
      expect(serialized).toContain(restriction)
      for (const privateText of privateTexts) expect(serialized).not.toContain(privateText)
    }
    expect(await restarted.retrieveForTurn({ workspace, prompt: 'THERMAL' })).toHaveLength(2)
    const raw = JSON.parse(await readFile(join(dataDir, 'shared-memory', 'memories.json'), 'utf8'))
    const retained = raw.records.find((record: { id: string }) => record.id === original.id)
    expect(retained.text).toBe('PRIVATE THERMAL CLAIM')
    expect(retained.research).toMatchObject({ conditions: metadata.conditions, counterexamples: metadata.counterexamples, corrections: metadata.corrections })
    expect(retained.research.history).toEqual([{ text: 'PRIVATE THERMAL HISTORY', sources: metadata.sources, conditions: metadata.conditions, counterexamples: metadata.counterexamples }])
  })

  it.each(['unknown', 'partial'] as const)('requires a workspace for %s research even through generic fallback and empty prompts', async (access) => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const otherWorkspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const claim = await service.create({ text: 'Thermal conditional claim', workspace, research: {
      ...researchMetadata(), sources: [{ ...researchMetadata().sources[0], access }]
    } })
    await service.create({ text: 'Ordinary preference', scope: 'user' })
    const restarted = new SharedMemoryService(dataDir)
    for (const context of [{}, { workspace: '' }, { workspace: '   ' }, { project: workspace }, { workspace: otherWorkspace }]) {
      for (const prompt of ['Thermal', '']) {
        const result = await restarted.retrieveForTurn({ ...context, prompt })
        expect(result.map((record) => record.id)).not.toContain(claim.id)
        expect(result.map((record) => record.text)).toContain('Ordinary preference')
      }
    }
    const [recalled] = await restarted.retrieveForTurn({ workspace, prompt: 'Thermal', limit: 1 })
    expect(recalled.text).toBe(claim.text)
    expect(recalled.research).toMatchObject({ status: 'unverified', conditions: researchMetadata().conditions, counterexamples: researchMetadata().counterexamples })
  })

  it.each(['inaccessible', 'withdrawn'] as const)('allows sticky %s restriction at history capacity without revising evidence', async (restriction) => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    let record = await service.create({ text: 'Thermal claim 0', workspace, research: researchMetadata() })
    for (let i = 1; i <= 8; i++) record = await service.update({ memoryId: record.id, patch: { text: `Thermal claim ${i}` } })
    const history = structuredClone(record.research!.history)
    const file = join(dataDir, 'shared-memory', 'memories.json')
    const restricted = { ...record.research!, ...(restriction === 'withdrawn' ? { status: 'withdrawn' as const } : {
      sources: [{ ...record.research!.sources[0], access: 'inaccessible' as const }]
    }) }
    // An unchanged save uses no history slot; a combined rewrite must fail atomically.
    await expect(service.update({ memoryId: record.id, patch: { text: record.text, research: record.research } })).resolves.toBeDefined()
    await expect(service.update({ memoryId: record.id, patch: { text: 'Replacement evidence', research: restricted } })).rejects.toThrow('history is full')
    await service.update({ memoryId: record.id, patch: { research: restricted } })
    const restarted = new SharedMemoryService(dataDir)
    const response = await restarted.update({ memoryId: record.id, patch: { research: { ...record.research!, status: 'unverified' } } })
    expect(JSON.stringify(response)).not.toContain('Thermal claim')
    const raw = JSON.parse(await readFile(file, 'utf8')).records[0]
    expect(raw.research.history).toEqual(history)
    expect(raw.text).toBe(record.text)
    expect(raw.research.sources).toEqual(restricted.sources)
    expect(raw.research.status).toBe(restriction === 'withdrawn' ? 'withdrawn' : record.research!.status)
    expect(JSON.stringify(await new SharedMemoryService(dataDir).retrieveForTurn({ workspace, prompt: 'Thermal' }))).not.toContain('Thermal claim')
    await expect(restarted.update({ memoryId: record.id, patch: { disabled: true } })).resolves.toMatchObject({ disabled: true })
    await expect(restarted.delete(record.id)).resolves.toMatchObject({ deleted: true })
    expect(JSON.parse(await readFile(file, 'utf8')).records[0].research.history).toEqual(history)
  })

  it('retains source identity, conditions, negative evidence and correction history after restart', async () => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const original = await service.create({ text: 'Thermal simulation claim', workspace, research: researchMetadata(), confidence: 1 })
    const changed = await service.update({ memoryId: original.id, patch: { text: 'Revised thermal simulation claim', research: { ...original.research!, sources: [{ ...original.research!.sources[0], version: 'v2' }], corrections: ['Source changed; repeat controls'] } } })
    expect(changed.research?.status).toBe('stale')
    const restarted = new SharedMemoryService(dataDir)
    const [record] = await restarted.retrieveForTurn({ workspace, prompt: 'thermal', limit: 1 })
    expect(record.research?.sources[0].version).toBe('v2')
    expect(record.research?.history[0]).toEqual({ text: original.text, sources: original.research!.sources, conditions: researchMetadata().conditions, counterexamples: researchMetadata().counterexamples })
    expect(record.research?.corrections).toEqual(['Measured simulation only; no device evidence', 'Source changed; repeat controls'])
    expect((await restarted.update({ memoryId: original.id, patch: { research: { ...record.research!, status: 'withdrawn' } } })).research?.status).toBe('withdrawn')
  })

  it('reserves scientific context ahead of preferences and keeps the entire bundle at limit one', async () => {
    const service = new SharedMemoryService(await tempDir())
    const workspace = await tempDir()
    const claim = await service.create({ text: 'Thermal result', workspace, research: researchMetadata() })
    for (let i = 0; i < 12; i++) await service.create({ text: `Preference ${i}` })
    const records = await service.retrieveForTurn({ workspace, prompt: 'thermal', limit: 1 })
    expect(records.map((r) => r.id)).toEqual([claim.id])
    expect(records[0].research?.counterexamples).toEqual(researchMetadata().counterexamples)
    expect((await service.retrieveForTurn({ prompt: 'thermal' })).some((r) => r.research)).toBe(false)
    expect(await service.retrieveForTurn({ workspace: await tempDir(), prompt: 'thermal', limit: 1 })).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: claim.id })]))
  })

  it('rejects malformed scientific requests instead of downgrading them to preferences', async () => {
    const service = new SharedMemoryService(await tempDir())
    const workspace = await tempDir()
    for (const research of [null, {}, { ...researchMetadata(), status: 'verified' }, { ...researchMetadata(), sources: [] }, { ...researchMetadata(), conditions: [] }]) {
      await expect(service.create({ text: 'Claim', workspace, research })).rejects.toThrow()
    }
    await expect(service.create({ text: 'Claim', scope: 'user', workspace, research: researchMetadata() })).rejects.toThrow()
    expect(await service.list()).toEqual([])
  })

  it('retains revoked history on disk while redacting list and mutation responses', async () => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const original = await service.create({ text: 'PRIVATE THERMAL CLAIM', workspace, research: researchMetadata() })
    const response = await service.update({ memoryId: original.id, patch: { research: {
      ...original.research!, sources: [{ ...original.research!.sources[0], access: 'inaccessible' }]
    } } })
    expect(JSON.stringify(response)).not.toContain('PRIVATE THERMAL CLAIM')
    expect(JSON.stringify(await new SharedMemoryService(dataDir).list({ workspace }))).not.toContain('PRIVATE THERMAL CLAIM')
    const stored = JSON.parse(await readFile(join(dataDir, 'shared-memory', 'memories.json'), 'utf8'))
    expect(stored.records[0].text).toBe('PRIVATE THERMAL CLAIM')
    expect(stored.records[0].research.status).toBe('unverified')
    expect(stored.records[0].research.conditions).toEqual(researchMetadata().conditions)
    expect(stored.records[0].research.history).toEqual([])
    await expect(service.update({ memoryId: original.id, patch: { research: undefined } })).rejects.toThrow()
  })

  it('honors immediate withdrawal when an ordinary record first gains research metadata', async () => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const original = await service.create({ text: 'WITHDRAWN CONVERTED CLAIM', scope: 'workspace', workspace })
    const updated = await service.update({ memoryId: original.id, patch: {
      research: { ...researchMetadata(), status: 'withdrawn', history: [] }
    } })
    expect(updated.research?.status).toBe('withdrawn')
    expect(JSON.stringify(updated)).not.toContain('WITHDRAWN CONVERTED CLAIM')
    const restarted = new SharedMemoryService(dataDir)
    expect(JSON.stringify(await restarted.retrieveForTurn({ workspace, prompt: 'claim' }))).not.toContain('WITHDRAWN CONVERTED CLAIM')
    expect(JSON.parse(await readFile(join(dataDir, 'shared-memory', 'memories.json'), 'utf8')).records[0].text).toBe(original.text)
  })

  it('rejects malformed public scope inputs before they can erase persisted research', async () => {
    const dataDir = await tempDir()
    const workspace = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const original = await service.create({ text: 'Preserve research history', workspace, research: researchMetadata() })
    const invalidScope = 'invalid' as never
    await expect(service.create({ text: 'Bad scope', scope: invalidScope })).rejects.toThrow('scope')
    await expect(service.update({ memoryId: original.id, patch: { scope: invalidScope } })).rejects.toThrow('scope')
    const restarted = new SharedMemoryService(dataDir)
    expect(await restarted.list({ workspace })).toEqual([original])
  })

  it('quarantines malformed persisted research while keeping old ordinary records usable', async () => {
    const dataDir = await tempDir()
    const service = new SharedMemoryService(dataDir)
    const ordinary = await service.create({ text: 'Old preference' })
    const file = join(dataDir, 'shared-memory', 'memories.json')
    await writeFile(file, JSON.stringify({ records: [ordinary, { ...ordinary, id: 'bad', text: 'Unsafe claim', research: {} }] }))
    const restarted = new SharedMemoryService(dataDir)
    expect((await restarted.list({ includeDisabled: true })).find((r) => r.id === 'bad')).toMatchObject({ disabled: true, text: '[Invalid research metadata; source lookup required]' })
    expect((await restarted.retrieveForTurn({ prompt: 'claim' })).map((r) => r.text)).toEqual(['Old preference'])
  })
})
