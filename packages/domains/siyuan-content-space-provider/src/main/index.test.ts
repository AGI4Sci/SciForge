import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { domainMainRuntimeLifecycleContractSchema } from '@sciforge/domain-sdk/host'
import { domainMainAgentRoutingContractSchema } from '@sciforge/domain-sdk/agent-routing'
import { domainPackageDefinition } from '../definition.js'
import { createDomainMainEntry as createMain } from './index.js'

const createDomainMainEntry = (host: DomainMainHost) => createMain({ packageSettings: {
  read: async () => ({ revision: 1, value: { mode: 'custom', url: null } }),
  write: async (value, revision) => ({ revision: revision + 1, value }),
  clear: async revision => ({ revision: revision + 1, value: null })
}, ...host })

const siyuanResponse = (data: unknown) => ({ ok: true, status: 200,
  json: async () => ({ code: 0, data }) }) as unknown as Response

describe('SiYuan main entry', () => {
  it('ships agent routing with the package and names the actual governed read and write operations', () => {
    const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value } as DomainMainHost)
    const routing = entry.contributions.find(item => item.kind === 'main.agent-routing')!
    const declaration = domainPackageDefinition.entrypoints.find(item => item.process === 'main')!
      .contributions.find(item => item.id === routing.id)
    expect(declaration?.kind).toBe('main.agent-routing')
    const contract = domainMainAgentRoutingContractSchema.parse(routing.contract)
    const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as {
      createDefinitions(): { id: string; audiences: string[]; effect: string; approval: string }[]
    }
    const actions = factory.createDefinitions()
    expect(contract.allowedRoutes).toEqual(['read', 'compose'])
    expect(contract.workflow.map(step => step.capabilityId)).toEqual([
      'siyuan.space.list', 'siyuan.service.check', 'siyuan.document.search', 'siyuan.document.read', 'siyuan.document.compose',
      'siyuan.notebook.list', 'siyuan.directory.list', 'siyuan.document.open', 'siyuan.document.replace', 'siyuan.document.patch', 'siyuan.document.append',
      'siyuan.comment.list', 'siyuan.comment.create', 'siyuan.comment.reply', 'siyuan.comment.update'
    ])
    for (const step of contract.workflow) {
      const action = actions.find(item => item.id === step.capabilityId)!
      expect(action.audiences).toContain('agent')
      expect(step.appliesToRoutes).toContain(action.effect === 'read' ? 'read' : 'compose')
      expect(action.approval).toBe(action.effect === 'read' ? 'none' : 'confirmation')
    }
    expect(contract.summary).toContain('sciforge_discover')
    expect(contract.reproducibilityRequirements.join('\n')).toContain('localhost:6806')
    expect(contract.workflow.find(step => step.id === 'compose')!.description).toContain('replace/append')
  })

  it('registers its document capabilities without Content Space provider contributions', () => {
    const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value } as DomainMainHost)
    expect(entry.contributions.map(item => item.kind)).toEqual([
      'main.capability-factory', 'main.agent-routing', 'main.runtime-lifecycle'
    ])
    expect(Object.values(domainPackageDefinition.contributionContracts).some(contract =>
      contract !== null && typeof contract === 'object' && !Array.isArray(contract) &&
      (contract.location === 'main.content-space-provider-factory' ||
       contract.location === 'main.provider-instance-directory-entry'))).toBe(false)
  })

  afterEach(() => {
    delete process.env.SIYUAN_BASE_URL
    delete process.env.SIYUAN_API_TOKEN
    vi.unstubAllGlobals()
  })

  it('registers without starting services and declares a valid runtime lifecycle', async () => {
    const getUserDataDir = vi.fn(() => { throw new Error('Service must remain lazy') })
    const entry = createDomainMainEntry({ getUserDataDir, defineCapability: (value: unknown) => value } as DomainMainHost)
    expect(getUserDataDir).not.toHaveBeenCalled()
    const lifecycle = entry.contributions.find((item) => item.kind === 'main.runtime-lifecycle')!
    expect(() => domainMainRuntimeLifecycleContractSchema.parse(lifecycle.contract)).not.toThrow()
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; handler: (input: unknown) => Promise<{ output: { url: string } }> }[]
    }
    const action = editor.createDefinitions().find(item => item.id === 'siyuan.editor.open')!
    // Opening the editor cannot bypass durable configuration.
    await expect(action.handler({})).rejects.toThrow('SIYUAN_BASE_URL')
    await expect(action.handler({ url: 'http://siyuan.example.test:6806' })).rejects.toThrow()
    expect(getUserDataDir).not.toHaveBeenCalled()
  })

  it('refuses a presentation URL other than the configured service before attaching identity', async () => {
    process.env.SIYUAN_BASE_URL = 'https://notes.test'
    const entry = createDomainMainEntry({
      defineCapability: (value: unknown) => value,
      nativeUi: { currentWebContentsId: () => 7 },
      getUserDataDir: () => { throw new Error('must not prepare a preload') }
    } as unknown as DomainMainHost)
    const factory = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions(): { id: string; handler(input: unknown): Promise<unknown> }[]
    }
    const present = factory.createDefinitions().find((item) => item.id === 'siyuan.editor.present')!
    await expect(present.handler({ url: 'https://other.test/',
      viewport: { x: 0, y: 0, width: 100, height: 100, visible: true } })).rejects.toThrow('确认服务地址')
  })

  it('exposes the agent compose capability for human-confirmed external writes', async () => {
    const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value } as DomainMainHost)
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; audiences: string[]; approval: string; effect: string }[]
    }
    const compose = editor.createDefinitions().find((item) => item.id === 'siyuan.document.compose')
    expect(compose).toMatchObject({ audiences: ['agent'], approval: 'confirmation', effect: 'external-write' })
  })

  it('routes agent writes to the configured service', async () => {
    process.env.SIYUAN_BASE_URL = 'http://remote.test:6806'
    process.env.SIYUAN_API_TOKEN = 'test-token'
    const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-compose-'))
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('lsNotebooks')) {
        return siyuanResponse({ notebooks: [{ id: '20261016190841-5xuey2m', name: '我的笔记本', closed: false }] })
      }
      if (url.endsWith('getIDsByHPath')) return siyuanResponse([])
      if (url.endsWith('createDocWithMd')) return siyuanResponse('20261019120000-abcdefg')
      if (url.endsWith('getBlockKramdown')) return siyuanResponse({ id: '20261019120000-abcdefg', kramdown: '# 总结\n内容\n{: id="20261019120000-abcdefg" updated="20261019120000"}\n' })
      if (url.endsWith('getHPathByID')) return siyuanResponse('/实验总结')
      if (url.endsWith('/api/query/sql')) return siyuanResponse([{ id: '20261019120000-abcdefg', box: '20261016190841-5xuey2m', hpath: '/实验总结', updated: '20261019120000' }])
      throw new Error(`unexpected fetch ${url}`)
    }))
    try {
      const entry = createDomainMainEntry({ getUserDataDir: () => userDataDir,
        defineCapability: (value: unknown) => value } as unknown as DomainMainHost)
      const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
        createDefinitions: () => { id: string; handler: (input: unknown, context?: import('./document-resources.js').DocumentCapabilityContext) => Promise<{ output: unknown }> }[]
      }
      const compose = editor.createDefinitions().find((item) => item.id === 'siyuan.document.compose')!
      // The broker applies the compose schema default before the handler runs.
      await expect(compose.handler({ title: '实验总结', markdown: '# 总结\n内容', notebookName: '我的笔记本' }))
        .resolves.toEqual({ output: { id: '20261019120000-abcdefg', url: 'http://remote.test:6806/', verified: true } })
      expect(calls.every((url) => url.startsWith('http://remote.test:6806/'))).toBe(true)
      expect(calls.some((url) => url.endsWith('createDocWithMd'))).toBe(true)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('exposes read-only agent capabilities for finding and reading documents', async () => {
    const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value } as DomainMainHost)
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; audiences: string[]; approval: string; effect: string }[]
    }
    const definitions = editor.createDefinitions()
    for (const id of ['siyuan.document.read', 'siyuan.document.search']) {
      expect(definitions.find((item) => item.id === id))
        .toMatchObject({ audiences: ['agent'], approval: 'none', effect: 'read' })
    }
  })

  it('reads a document from the configured service without ever writing', async () => {
    process.env.SIYUAN_BASE_URL = 'http://remote.test:6806'
    process.env.SIYUAN_API_TOKEN = 'test-token'
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/api/query/sql')) {
        return siyuanResponse([{ id: '20261030140949-abcdefg', box: '20261016190841-5xuey2m',
          hpath: '/SciForge/实验记录', updated: '20261030140949' }])
      }
      if (url.endsWith('/api/block/getBlockKramdown')) {
        return siyuanResponse({ id: '20261030140949-abcdefg', kramdown: '# 结论\n{: id="20261030140949-abcdefg" updated="20261030140949"}\n' })
      }
      if (url.endsWith('getHPathByID')) return siyuanResponse('/SciForge/实验记录')
      throw new Error(`unexpected fetch ${url}`)
    }))
    // A read path must never touch per-user storage: the reader has no receipts.
    const entry = createDomainMainEntry({ getUserDataDir: () => { throw new Error('Service must remain lazy') },
      defineCapability: (value: unknown) => value } as unknown as DomainMainHost)
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; handler: (input: unknown, context?: import('./document-resources.js').DocumentCapabilityContext) => Promise<{ output: unknown }> }[]
    }
    const read = editor.createDefinitions().find((item) => item.id === 'siyuan.document.read')!
    const registrations: Parameters<import('./document-resources.js').DocumentCapabilityContext['issueResource']>[0][] = []
    const context = { issueResource: (value: typeof registrations[number]) => { registrations.push(value); return { token: 'test', semanticRevision: '1', expiresAt: '2099' } } }
    await editor.createDefinitions().find(item => item.id === 'siyuan.document.open')!.handler({ id: '20261030140949-abcdefg' }, context)
    await expect(read.handler({}, { ...context, resource: { resourceId: registrations[0].resourceId } })).resolves.toEqual({ output: {
      id: '20261030140949-abcdefg', path: '/SciForge/实验记录', notebook: '20261016190841-5xuey2m',
      title: '实验记录', updated: '20261030140949', markdown: '# 结论\n', truncated: false,
      offset: 0, nextOffset: null, totalChars: 5, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    } })
    expect(calls.every((url) => url.startsWith('http://remote.test:6806/'))).toBe(true)
    expect(calls.some((url) => url.endsWith('createDocWithMd'))).toBe(false)
  })

  it('exposes the service status and token configuration to the page only', () => {
    const entry = createDomainMainEntry({ defineCapability: (value: unknown) => value } as DomainMainHost)
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; audiences: string[]; approval: string; effect: string }[]
    }
    const definitions = editor.createDefinitions()
    expect(definitions.find((item) => item.id === 'siyuan.service.status'))
      .toMatchObject({ audiences: ['ui'], approval: 'none', effect: 'read' })
    expect(definitions.find((item) => item.id === 'siyuan.service.configure'))
      .toMatchObject({ audiences: ['ui'], approval: 'none', effect: 'compute' })
  })

  it('reads current account attribution through the existing status capability', async () => {
    let profile: { state: string; userId?: string; displayName?: string } = { state: 'signed-in', userId: 'a', displayName: '同名' }
    const entry = createDomainMainEntry({
      defineCapability: (value: unknown) => value,
      internalServices: { acquire: () => ({ read: () => profile }) }
    } as unknown as DomainMainHost)
    const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; handler: (input: unknown, context?: import('./document-resources.js').DocumentCapabilityContext) => Promise<{ output: unknown }> }[]
    }
    const status = factory.createDefinitions().find(item => item.id === 'siyuan.service.status')!
    for (const next of [profile, { state: 'signed-in', userId: 'b', displayName: '同名' }, { state: 'signed-out' }]) {
      profile = next
      await expect(status.handler({})).resolves.toMatchObject({ output: { identity: next } })
    }
  })

  it('prefers the stored token over the environment and never echoes it back', async () => {
    process.env.SIYUAN_BASE_URL = 'http://remote.test:6806'
    process.env.SIYUAN_API_TOKEN = 'env-token'
    const values = new Map<string, string>()
    const authorization: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      authorization.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''))
      if (String(input).endsWith('/api/query/sql')) return siyuanResponse([])
      throw new Error(`unexpected fetch ${String(input)}`)
    }))
    const entry = createDomainMainEntry({
      defineCapability: (value: unknown) => value,
      // The page only ever sends the token inwards; the status document it gets
      // back says whether one exists, which is also what the Host UI shows.
      packageSecrets: {
        has: async (key: string) => values.has(key),
        read: async (key: string) => values.get(key) ?? null,
        write: async (key: string, value: string) => { values.set(key, value) },
        remove: async (key: string) => { values.delete(key) }
      }
    } as unknown as DomainMainHost)
    const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
      createDefinitions: () => { id: string; handler: (input: unknown, context?: import('./document-resources.js').DocumentCapabilityContext) => Promise<{ output: unknown }> }[]
    }
    const definitions = editor.createDefinitions()
    const status = definitions.find((item) => item.id === 'siyuan.service.status')!
    const configure = definitions.find((item) => item.id === 'siyuan.service.configure')!
    await expect(status.handler({})).resolves.toEqual({ output: {
      editorAvailable: false, mode: 'custom', url: 'http://remote.test:6806', urlSource: 'environment',
      token: 'environment', tokenStorage: 'available', identity: { state: 'unavailable' }
    } })
    const configured = await configure.handler({ token: 'stored-token' })
    expect(configured.output).toEqual({
      editorAvailable: false, mode: 'custom', url: 'http://remote.test:6806', urlSource: 'environment',
      token: 'stored', tokenStorage: 'available', identity: { state: 'unavailable' }
    })
    await definitions.find((item) => item.id === 'siyuan.document.search')!
      .handler({ query: 'SciForge', limit: 5 })
    expect(authorization).toEqual(['Token stored-token'])
    expect(JSON.stringify(configured.output)).not.toContain('stored-token')

    const cleared = await configure.handler({ token: null })
    expect(cleared.output).toMatchObject({ token: 'environment' })
    expect(values.size).toBe(0)
  })
})
