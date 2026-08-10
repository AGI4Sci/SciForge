import { describe, expect, it, vi } from 'vitest'
import { createDomainMainEntry } from './main'
import { domainPackageDefinition } from './definition'

describe('Computer Use main domain entry', () => {
  it('declares generic host contributions and constructs capabilities lazily', () => {
    const getUserDataDir = vi.fn(() => 'C:/test/user-data')
    const entry = createDomainMainEntry({
      defineCapability: (definition: unknown) => definition,
      getUserDataDir
    } as never)

    expect(entry.definition).toBe(domainPackageDefinition)
    expect(entry.contributions.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'main.capability-factory:computer-use.capabilities',
      'main.runtime-lifecycle:computer-use.runtime-lifecycle',
      'main.runtime-mcp-server:computer-use.runtime-mcp-server',
      'main.mcp-trusted-invocation-metadata:computer-use.trusted-invocation-metadata'
    ])
    const capabilityFactory = entry.contributions[0]?.value as {
      createDefinitions(): ReadonlyArray<{ id: string }>
    }
    expect(capabilityFactory.createDefinitions().map(({ id }) => id)).toEqual([
      'computer-use.status',
      'computer-use.request-permission'
    ])
    expect(getUserDataDir).not.toHaveBeenCalled()

    const metadata = entry.contributions[3]?.value
    expect(metadata).toMatchObject({
      serverId: 'gui_owl_computer_use',
      tools: [
        'computer_use_bind_target',
        'computer_use',
        'computer_use_release_session'
      ],
      metadataKey: 'io.sciforge/computer-use-invocation',
      source: 'trusted-invocation'
    })
  })

  it('attaches and owner-clears the authenticated Host Agent planning bridge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const entry = createDomainMainEntry({
      defineCapability: (definition: unknown) => definition,
      getUserDataDir: () => 'C:/test/user-data',
      getAppRoot: () => 'C:/test/app'
    } as never)
    const lifecycle = entry.contributions[1]?.value as {
      activate(context: unknown): Promise<undefined | (() => Promise<void>)>
    }
    const dispose = await lifecycle.activate({
      appRoot: 'C:/test/app',
      userDataDir: 'C:/test/user-data',
      environment: {
        SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
        SCIFORGE_CUA_SERVICE_TOKEN: 'sidecar-token',
        SCIFORGE_CUA_CDP_ADAPTER_URL: 'http://127.0.0.1:4900'
      },
      agentExecution: { run: vi.fn() },
      signal: new AbortController().signal,
      log: vi.fn()
    })

    expect(dispose).toEqual(expect.any(Function))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3900/computer-use/model-access/configure'
    )
    const attached = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(attached).toMatchObject({ model: 'sciforge-computer-use-agent' })
    expect(attached.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(attached.apiKey.length).toBeGreaterThanOrEqual(32)

    await dispose?.()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const cleared = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(cleared).toEqual({
      baseUrl: '',
      apiKey: '',
      model: '',
      expectedBaseUrl: attached.baseUrl
    })
    fetchMock.mockRestore()
  })
})
