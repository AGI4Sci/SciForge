import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { HostServiceProviderRegistry, type HostServiceRequest } from '@sciforge/plugin-sdk'
import { createAgentDiscussionHostServiceResolver } from './agent-discussion-host-service'
import { canonicalWorkspacePath } from './workspace-authority'

function fixture() {
  let ports = ['agent-discussion.run']
  const run = vi.fn(async () => ({ state: 'completed', text: 'Explanation', runtimeId: 'claude', threadId: 'side' }))
  const resolver = createAgentDiscussionHostServiceResolver({
    execution: () => ({ run, runtimeReadiness: async () => ({ state: 'ready', runtimeId: 'claude', capabilityTags: [] }) }) as never,
    authorizeWorkspace: async () => true, readGrantedPorts: () => ports,
    hostServiceClientModule: '/host/client.mjs'
  })
  const registry = new HostServiceProviderRegistry(resolver.resolve('consumer', '1', 1)!)
  const request: HostServiceRequest = {
    requestId: 'request', serviceId: 'agentDiscussion', operation: 'run', input: { prompt: 'Explain code' },
    owner: { packageName: 'consumer', version: '1', generation: 1, pluginId: 'consumer',
      connectionId: 'connection', invocationId: 'invocation', authority: {
        caller: { audience: 'ui', callerId: 'panel', workspaceId: resolve('/workspace') }, effect: 'workspace-write' } },
    signal: new AbortController().signal, assertCurrent: vi.fn()
  }
  return { registry, request, run, revoke: () => { ports = [] } }
}

describe('generic discussion Host service', () => {
  it('uses selected runtime with no tools and Host-bound workspace', async () => {
    const f = fixture()
    expect(await f.registry.dispatch(f.request)).toMatchObject({ text: 'Explanation', runtimeId: 'claude' })
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'claude', allowedTools: [],
      workspaceRoot: canonicalWorkspacePath(resolve('/workspace')), interaction: 'background', signal: f.request.signal }))
  })

  it.each([{ prompt: 'Explain', workspaceRoot: '/forged' }, { prompt: 'Explain', allowedTools: ['shell'] },
    { prompt: 'Explain', runtimeId: 'codex' }])('rejects caller-supplied execution authority %j', async (input) => {
    const f = fixture()
    await expect(f.registry.dispatch({ ...f.request, input })).rejects.toThrow()
    expect(f.run).not.toHaveBeenCalled()
  })

  it('rejects revoked grants and missing live leases before execution', async () => {
    const f = fixture()
    await expect(f.registry.dispatch({ ...f.request, assertCurrent: undefined })).rejects.toThrow(/lease/)
    f.revoke()
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/authorized/)
    expect(f.run).not.toHaveBeenCalled()
  })
})
