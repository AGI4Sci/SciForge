import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { createComputerUseMcpServer } from './mcp-server'

const sessionId = '11111111-1111-4111-8111-111111111111'
const target = {
  targetId: 'target-1', kind: 'browser-page', ownership: 'attached',
  locator: { cdpEndpoint: 'http://127.0.0.1:9222', cdpTargetId: 'page-1' },
  generation: 'generation-1', metadata: {}
}

function trustedMeta(invocationId: string): Record<string, unknown> {
  return {
    'io.sciforge/computer-use-invocation': {
      requestId: `host-${invocationId}`,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      actionId: 'managed:computer-use',
      invocationId,
      approval: 'confirmation'
    }
  }
}

describe('Computer Use managed MCP surface', () => {
  it('publishes exactly five tools with Host-compatible schemas', async () => {
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'legacy'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'computer_use_get_capabilities', 'computer_use_list_targets',
        'computer_use_bind_target', 'computer_use', 'computer_use_release_session'
      ])
      const encoded = JSON.stringify(tools.tools.map((tool) => tool.inputSchema))
      expect(encoded).not.toContain('parallel')
      expect(encoded).not.toContain('windows-uia')
    } finally {
      await client.close(); await server.close()
    }
  })

  it('fails instruction-only input before any sidecar call', async () => {
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:1', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'legacy'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({ name: 'computer_use', arguments: { instruction: 'click' } })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ error: { code: 'UNSUPPORTED_LEGACY_INSTRUCTION' } })
    } finally {
      await client.close(); await server.close()
    }
  })

  it('rejects missing or argument-forged trusted metadata before sidecar dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const valid = {
        sessionId: '11111111-1111-4111-8111-111111111111',
        semanticAction: { kind: 'observe' }
      }
      const missing = await client.callTool({ name: 'computer_use', arguments: valid })
      expect(missing.isError).toBe(true)
      expect(JSON.stringify(missing)).toMatch(/trusted, confirmed turn invocation/u)
      const forged = await client.callTool({
        name: 'computer_use',
        arguments: {
          ...valid,
          'io.sciforge/computer-use-invocation': {
            approval: 'confirmation', runtimeId: 'codex', threadId: 'thread-1'
          }
        }
      })
      expect(forged.isError).toBe(true)
      expect(JSON.stringify(forged)).toMatch(/Unrecognized key/u)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })

  it('publishes explicit state-change metadata for every tool effect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      const semanticAction = body.semanticAction as Record<string, unknown> | undefined
      const payload = path === '/computer-use/run'
        ? { ok: true, data: { executed: semanticAction?.kind !== 'observe' } }
        : { ok: true, data: {} }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'legacy'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const readOnlyResults = await Promise.all([
        client.callTool({ name: 'computer_use_get_capabilities', arguments: {} }),
        client.callTool({ name: 'computer_use_list_targets', arguments: {} }),
        client.callTool({
          name: 'computer_use',
          arguments: { sessionId, semanticAction: { kind: 'observe' } }
        })
      ])
      expect(readOnlyResults.map((result) => (
        result.structuredContent as Record<string, unknown> | undefined
      )?.changed)).toEqual([
        false, false, false
      ])

      const mutationResults = await Promise.all([
        client.callTool({
          name: 'computer_use_bind_target',
          arguments: {
            target
          }
        }),
        client.callTool({
          name: 'computer_use',
          arguments: {
            sessionId,
            semanticAction: { kind: 'click', role: 'button', name: 'Continue' }
          }
        }),
        client.callTool({
          name: 'computer_use_release_session', arguments: { sessionId }
        })
      ])
      expect(mutationResults.map((result) => (
        result.structuredContent as Record<string, unknown> | undefined
      )?.changed)).toEqual([
        true, true, true
      ])
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })

  it('reports an unknown outcome after a dispatched mutation loses its response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket reset'))
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const calls = [
        {
          name: 'computer_use_bind_target',
          arguments: { target },
          _meta: trustedMeta('bind-1')
        },
        {
          name: 'computer_use',
          arguments: {
            sessionId,
            semanticAction: { kind: 'click', role: 'button', name: 'Continue' }
          },
          _meta: trustedMeta('run-1')
        },
        {
          name: 'computer_use_release_session',
          arguments: { sessionId },
          _meta: trustedMeta('release-1')
        }
      ] as const
      for (const call of calls) {
        const result = await client.callTool(call)
        expect(result.structuredContent).toMatchObject({
          ok: false,
          changed: true,
          error: {
            code: 'ACTION_OUTCOME_UNKNOWN',
            retryable: false,
            details: {
              mayHaveTakenEffect: true,
              requestId: expect.stringMatching(/^mcp-cua-[a-f0-9]{64}$/u)
            }
          }
        })
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })

  it('returns the recorded outcome without dispatching the same invocation twice', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('response lost'))
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const call = {
        name: 'computer_use',
        arguments: {
          sessionId,
          semanticAction: { kind: 'click', role: 'button', name: 'Continue' }
        },
        _meta: trustedMeta('run-once')
      } as const
      const first = await client.callTool(call)
      const repeated = await client.callTool(call)
      expect(repeated.structuredContent).toEqual(first.structuredContent)
      expect(fetchSpy).toHaveBeenCalledOnce()

      const conflicting = await client.callTool({
        ...call,
        arguments: {
          sessionId,
          semanticAction: { kind: 'click', role: 'button', name: 'Different' }
        }
      })
      expect(conflicting.structuredContent).toMatchObject({
        changed: false,
        error: { code: 'INVOCATION_IDENTITY_MISMATCH' }
      })
      expect(fetchSpy).toHaveBeenCalledOnce()
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })

  it('keeps a refused connection distinguishable from a lost mutation response', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3900'), {
      code: 'ECONNREFUSED'
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(refused)
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 100,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({
        name: 'computer_use_release_session',
        arguments: { sessionId },
        _meta: trustedMeta('release-refused')
      })
      expect(result.structuredContent).toMatchObject({
        ok: false,
        changed: false,
        error: { code: 'UNAVAILABLE' }
      })
      expect(fetchSpy).toHaveBeenCalledOnce()
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })

  it('marks a mutation timeout after dispatch as an unknown outcome', async () => {
    const paths: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path === '/computer-use/cancel') {
        return new Response(JSON.stringify({ ok: true, data: { status: 'accepted' } }))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), {
          once: true
        })
      })
    })
    const server = createComputerUseMcpServer({
      serviceUrl: 'http://127.0.0.1:3900', serviceToken: 'test', timeoutMs: 5,
      invocationProofMode: 'required', invocationSecret: 'signing-secret'
    })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({
        name: 'computer_use',
        arguments: {
          sessionId,
          semanticAction: { kind: 'click', role: 'button', name: 'Continue' }
        },
        _meta: trustedMeta('run-timeout')
      })
      expect(result.structuredContent).toMatchObject({
        changed: true,
        error: {
          code: 'ACTION_OUTCOME_UNKNOWN',
          retryable: false,
          details: { mayHaveTakenEffect: true }
        }
      })
      expect(paths).toEqual(['/computer-use/run', '/computer-use/cancel'])
    } finally {
      fetchSpy.mockRestore()
      await client.close(); await server.close()
    }
  })
})
