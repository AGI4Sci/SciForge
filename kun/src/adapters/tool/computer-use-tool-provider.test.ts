import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildComputerUseToolProviders } from './computer-use-tool-provider.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function fakeContext(): ToolHostContext {
  return {
    threadId: 't1',
    turnId: 'u1',
    workspace: '/tmp/ws',
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.SCIFORGE_CUA_SERVICE_URL
})

describe('buildComputerUseToolProviders', () => {
  it('advertises nothing when the service URL is unset (fail-closed)', () => {
    delete process.env.SCIFORGE_CUA_SERVICE_URL
    expect(buildComputerUseToolProviders()).toEqual([])
  })

  it('exposes a single on-request computer_use tool when configured', () => {
    const providers = buildComputerUseToolProviders({ serviceUrl: 'http://127.0.0.1:3900' })
    expect(providers).toHaveLength(1)
    expect(providers[0]?.id).toBe('computer-use')
    const tool = providers[0]?.tools[0]
    expect(tool?.name).toBe('computer_use')
    expect(tool?.policy).toBe('on-request') // every call gated by approval
  })

  it('forwards execute+approve and reshapes the ServiceResult trace', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          summary: '1 step(s); status=agent_reported_done; executed.',
          data: {
            status: 'agent_reported_done',
            executed: true,
            platform: 'Windows',
            screen: [1920, 1080],
            stepCount: 1,
            steps: [{ step: 0, plan: 'click Save', action: 'agent.click(955, 74)', coords: [955, 74], executed: true }]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const tool = buildComputerUseToolProviders({ serviceUrl: 'http://127.0.0.1:3900/' })[0]!.tools[0]!
    const res = await tool.execute({ instruction: 'click the Save button' }, fakeContext())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:3900/computer-use/run') // trailing slash trimmed
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      instruction: 'click the Save button',
      execute: true,
      approve: true
    })
    expect(res.isError).toBeFalsy()
    expect(res.output).toMatchObject({
      status: 'agent_reported_done',
      executed: true,
      stepCount: 1
    })
  })

  it('surfaces a NEEDS_APPROVAL error from the service as a tool error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: 'NEEDS_APPROVAL', message: 'requires approval', blockedReason: 'external-side-effect-requires-approval' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    ))
    const tool = buildComputerUseToolProviders({ serviceUrl: 'http://127.0.0.1:3900' })[0]!.tools[0]!
    const res = await tool.execute({ instruction: 'do something' }, fakeContext())
    expect(res.isError).toBe(true)
    expect(res.output).toMatchObject({ code: 'NEEDS_APPROVAL' })
  })

  it('rejects an empty instruction without calling the service', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const tool = buildComputerUseToolProviders({ serviceUrl: 'http://127.0.0.1:3900' })[0]!.tools[0]!
    const res = await tool.execute({ instruction: '   ' }, fakeContext())
    expect(res.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
