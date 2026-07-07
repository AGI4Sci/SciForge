import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildMemoryToolProviders } from '../src/adapters/tool/memory-tool-provider.js'
import { LocalRuntimeCapabilitiesConfig, type MemoryCapabilityConfig } from '../src/contracts/capabilities.js'
import { FileMemoryStore } from '../src/memory/memory-store.js'
import type { ModelClient, ModelRequest } from '../src/ports/model-client.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Memory store and recall', () => {
  let dir = ''
  let nextId = 1

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-memory-'))
    nextId = 1
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores scoped memories, retrieves relevant records, and keeps tombstones', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'User prefers pnpm for frontend projects',
      scope: 'workspace',
      workspace: '/tmp/ws',
      tags: ['frontend'],
      confidence: 0.9
    })
    await store.create({
      content: 'Unrelated backend preference',
      scope: 'workspace',
      workspace: '/tmp/other'
    })

    expect((await store.retrieve({ query: 'frontend pnpm preference', workspace: '/tmp/ws', limit: 3 })).map((item) => item.id)).toEqual([memory.id])
    expect(await createStore({ enabled: false }).retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])

    await store.update(memory.id, { disabled: true })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    await store.update(memory.id, { disabled: false, content: 'User strongly prefers pnpm' })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toHaveLength(1)
    await store.delete(memory.id)
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    expect((await store.list({ workspace: '/tmp/ws', includeDeleted: true })).find((item) => item.id === memory.id)?.deletedAt).toBeTruthy()
  })

  it('strictly scopes project memories and treats missing turn dimensions as wildcards', async () => {
    const store = createStore()
    const user = await store.create({
      content: 'Global pnpm preference',
      scope: 'user'
    })
    const workspace = await store.create({
      content: 'Workspace pnpm setup',
      scope: 'workspace',
      workspace: '/tmp/ws'
    })
    const projectA = await store.create({
      content: 'Project pnpm setup',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-a'
    })
    const projectB = await store.create({
      content: 'Project pnpm setup',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-b'
    })
    const draft = await store.create({
      content: 'Draft pnpm setup',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-a',
      threadMode: 'plan',
      taskType: 'plan_draft'
    })
    const refine = await store.create({
      content: 'Refine pnpm setup',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-a',
      threadMode: 'plan',
      taskType: 'plan_refine'
    })

    const idsForProjectA = (await store.retrieve({
      query: 'pnpm setup',
      workspace: '/tmp/ws',
      project: 'project-a',
      threadMode: 'agent',
      taskType: 'agent',
      limit: 10
    })).map((item) => item.id)
    expect(idsForProjectA).toEqual(expect.arrayContaining([user.id, workspace.id, projectA.id]))
    expect(idsForProjectA).not.toContain(projectB.id)
    expect(idsForProjectA).not.toContain(draft.id)
    expect(idsForProjectA).not.toContain(refine.id)

    const idsWithoutProject = (await store.retrieve({
      query: 'pnpm setup',
      workspace: '/tmp/ws',
      threadMode: 'agent',
      taskType: 'agent',
      limit: 10
    })).map((item) => item.id)
    expect(idsWithoutProject).toEqual(expect.arrayContaining([user.id, workspace.id]))
    expect(idsWithoutProject).not.toContain(projectA.id)
    expect(idsWithoutProject).not.toContain(projectB.id)

    const draftIds = (await store.retrieve({
      query: 'pnpm setup',
      workspace: '/tmp/ws',
      project: 'project-a',
      threadMode: 'plan',
      taskType: 'plan_draft',
      limit: 10
    })).map((item) => item.id)
    expect(draftIds).toEqual(expect.arrayContaining([user.id, workspace.id, projectA.id, draft.id]))
    expect(draftIds).not.toContain(refine.id)
  })

  it('exposes memory API routes with diagnostics', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    const created = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Remember pnpm',
          scope: 'workspace',
          workspace: '/tmp/ws'
        })
      })
    )
    expect(created.status).toBe(201)
    const body = await readJson(created) as { memory: { id: string } }

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect((await readJson(list)) as { memories: unknown[] }).toMatchObject({ memories: [expect.any(Object)] })

    const disabled = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      })
    )
    expect(disabled.status).toBe(200)
    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ tombstoneCount: 1 })
  })

  it('filters project-scoped memories through the memory API', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    await h.runtime.memoryStore.create({
      content: 'Project A keeps pnpm notes',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-a'
    })
    await h.runtime.memoryStore.create({
      content: 'Default project keeps pnpm notes',
      scope: 'project',
      workspace: '/tmp/ws',
      project: '/tmp/ws'
    })
    await h.runtime.memoryStore.create({
      content: 'Project B keeps pnpm notes',
      scope: 'project',
      workspace: '/tmp/ws',
      project: 'project-b'
    })

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws&project=project-a', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect((await readJson(list)) as { memories: Array<{ project?: string }> }).toMatchObject({
      memories: [expect.objectContaining({ project: 'project-a' })]
    })

    const workspaceOnlyList = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const workspaceOnlyProjects = ((await readJson(workspaceOnlyList)) as { memories: Array<{ project?: string }> })
      .memories
      .map((memory) => memory.project)
    expect(workspaceOnlyProjects).toContain('/tmp/ws')
    expect(workspaceOnlyProjects).not.toContain('project-b')
  })

  it('gates memory mutation tools through approval', async () => {
    const store = createStore()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    let approvals = 0
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'memory_create',
      arguments: { content: 'Use pnpm', workspace: '/tmp/ws' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'on-request',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => {
        approvals += 1
        return 'allow'
      }
    })

    expect(approvals).toBe(1)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(await store.list({ workspace: '/tmp/ws' })).toHaveLength(1)
  })

  it('defaults project-scoped memory tool writes to the current project key', async () => {
    const store = createStore()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'memory_create',
      arguments: { content: 'Project memory', scope: 'project' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      project: '/tmp/ws',
      threadMode: 'agent',
      taskType: 'agent',
      approvalPolicy: 'on-request',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(await store.list({
      workspace: '/tmp/ws',
      project: '/tmp/ws',
      threadMode: 'agent',
      taskType: 'agent'
    })).toEqual([
      expect.objectContaining({
        scope: 'project',
        project: '/tmp/ws',
        threadMode: 'agent',
        taskType: 'agent'
      })
    ])
  })

  it('passes project and task scope into memory retrieval from agent turns', async () => {
    const store = createStore()
    const seen: Parameters<typeof store.retrieve>[0][] = []
    const originalRetrieve = store.retrieve.bind(store)
    store.retrieve = async (input) => {
      seen.push(input)
      return originalRetrieve(input)
    }
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream() {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, { workspace: '/tmp/ws', request: { prompt: 'hello' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seen.at(-1)).toMatchObject({
      workspace: '/tmp/ws',
      project: '/tmp/ws',
      threadMode: 'agent',
      taskType: 'agent'
    })
  })

  it('derives plan draft and refine task types for memory retrieval', async () => {
    const runPlanTurn = async (operation: 'draft' | 'refine') => {
      const store = createStore()
      const seen: Parameters<typeof store.retrieve>[0][] = []
      const originalRetrieve = store.retrieve.bind(store)
      store.retrieve = async (input) => {
        seen.push(input)
        return originalRetrieve(input)
      }
      const model: ModelClient = {
        provider: 'fake',
        model: 'fake',
        async *stream() {
          yield { kind: 'completed', stopReason: 'stop' }
        }
      }
      const h = makeHarness(model, { memoryStore: store })
      await bootstrapThread(h, {
        workspace: '/tmp/ws',
        request: {
          prompt: `${operation} a plan`,
          mode: 'plan',
          guiPlan: {
            operation,
            workspaceRoot: '/tmp/ws',
            relativePath: `.sciforge/plan/${operation}.md`,
            planId: `plan-${operation}`
          }
        }
      })
      await h.loop.runTurn(h.threadId, h.turnId)
      return seen.at(-1)
    }

    expect(await runPlanTurn('draft')).toMatchObject({
      threadMode: 'plan',
      taskType: 'plan_draft'
    })
    expect(await runPlanTurn('refine')).toMatchObject({
      threadMode: 'plan',
      taskType: 'plan_refine'
    })
  })

  it('injects relevant memories into AgentLoop metadata and stops after deletion', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Use pnpm when touching frontend code',
      scope: 'workspace',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.contextInstructions?.[0]).toContain(memory.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([memory.id])
    expect((await store.diagnostics()).lastInjectedIds).toEqual([memory.id])

    await store.delete(memory.id)
    const h2 = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h2, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })
    await h2.loop.runTurn(h2.threadId, h2.turnId)
    const finalInstructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(finalInstructions).not.toContain(memory.id)
    expect(finalInstructions).toContain('<shell_environment>')
    expect(finalInstructions).toContain('<syntax>POSIX shell</syntax>')
  })

  it('writes memory records atomically (no .tmp file left on success)', async () => {
    const store = createStore()
    await store.create({ content: 'atomic test memory' })

    // Final file present and parseable.
    const finalContents = await readFile(
      join(dir, 'memory', 'mem_1.json'),
      'utf8'
    )
    expect(finalContents.length).toBeGreaterThan(0)
    expect(JSON.parse(finalContents).content).toBe('atomic test memory')

    // No .tmp leftover from the atomic write.
    const entries = await readdir(join(dir, 'memory'))
    expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  function createStore(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return new FileMemoryStore({
      rootDir: join(dir, 'memory'),
      config: memoryConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `mem_${nextId++}`
    })
  }

  function memoryConfig(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return LocalRuntimeCapabilitiesConfig.parse({
      memory: {
        enabled: true,
        ...overrides
      }
    }).memory
  }
})
