import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { domainMainRuntimeLifecycleContractSchema } from '@sciforge/domain-sdk/host'
import { createDomainMainEntry } from './index.js'

const siyuanResponse = (data: unknown) => ({ ok: true, status: 200,
  json: async () => ({ code: 0, data }) }) as unknown as Response

describe('SiYuan main entry', () => {
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
      createDefinitions: () => { handler: (input: unknown) => Promise<{ output: { url: string } }> }[]
    }
    const action = editor.createDefinitions()[0]
    // Server mode only: without a page address and without a configured default
    // the editor refuses to invent an endpoint.
    await expect(action.handler({})).rejects.toThrow('SIYUAN_BASE_URL')
    await expect(action.handler({ url: 'http://siyuan.example.test:6806' }))
      .resolves.toEqual({ output: { url: 'http://siyuan.example.test:6806/' } })
    await expect(action.handler({ url: 'file:///private' })).rejects.toThrow('HTTP')
    await expect(action.handler({ url: 'http://user:password@example.test' })).rejects.toThrow('HTTP')
    expect(getUserDataDir).not.toHaveBeenCalled()
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
      throw new Error(`unexpected fetch ${url}`)
    }))
    try {
      const entry = createDomainMainEntry({ getUserDataDir: () => userDataDir,
        defineCapability: (value: unknown) => value } as unknown as DomainMainHost)
      const editor = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
        createDefinitions: () => { id: string; handler: (input: unknown) => Promise<{ output: unknown }> }[]
      }
      const compose = editor.createDefinitions().find((item) => item.id === 'siyuan.document.compose')!
      // The broker applies the compose schema default before the handler runs.
      await expect(compose.handler({ title: '实验总结', markdown: '# 总结\n内容', notebookName: '我的笔记本' }))
        .resolves.toEqual({ output: { id: '20261019120000-abcdefg', url: 'http://remote.test:6806/' } })
      expect(calls.every((url) => url.startsWith('http://remote.test:6806/'))).toBe(true)
      expect(calls.some((url) => url.endsWith('createDocWithMd'))).toBe(true)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
