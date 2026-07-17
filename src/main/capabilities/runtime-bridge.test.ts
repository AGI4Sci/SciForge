import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES,
  CAPABILITY_RUNTIME_BRIDGE_VERSION,
  atomicWriteCapabilityRuntimeBridgeJson,
  capabilityRuntimeBridgePaths,
  capabilityRuntimeBridgeRequestPath,
  capabilityRuntimeBridgeResponsePath,
  parseCapabilityRuntimeBridgeCatalog,
  parseCapabilityRuntimeBridgeResponse,
  signCapabilityRuntimeBridgeRequest
} from '../local-runtime-package-contract'
import type { CapabilityAgentToolSurface } from './agent-tools'
import { CapabilityRuntimeBridge } from './runtime-bridge'

let rootDir = ''

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true })
  rootDir = ''
})

describe('CapabilityRuntimeBridge', () => {
  it('publishes the authoritative surface and forwards authenticated hidden context', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'sciforge-runtime-bridge-'))
    const call = vi.fn(async (request: { name: string; context: Record<string, unknown> }) => ({
      tool: request.name,
      value: { forwarded: true }
    }))
    const surface = {
      tools: () => CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({
        type: 'function' as const,
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} }
      })),
      call
    } as unknown as Pick<CapabilityAgentToolSurface, 'tools' | 'call'>
    const bridge = new CapabilityRuntimeBridge({
      rootDir,
      surface,
      capabilityIds: () => ['surface.inspect', 'artifact.inspect'],
      authSecret: 'runtime-bridge-test-secret-that-is-long-enough',
      pollIntervalMs: 5
    })
    await bridge.start()

    const launch = bridge.launchConfig()
    const catalog = parseCapabilityRuntimeBridgeCatalog(
      JSON.parse(await readFile(capabilityRuntimeBridgePaths(rootDir).catalog, 'utf8')),
      launch.authSecret
    )
    expect(catalog.tools.map((tool) => tool.name)).toEqual(CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES)
    expect(catalog.capabilityIds).toContain('surface.inspect')

    const requestId = 'request_0123456789abcdef'
    await atomicWriteCapabilityRuntimeBridgeJson(
      capabilityRuntimeBridgeRequestPath(rootDir, requestId),
      signCapabilityRuntimeBridgeRequest(launch.authSecret, {
        version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
        requestId,
        createdAt: new Date().toISOString(),
        nonce: 'nonce_0123456789abcdef',
        tool: 'sciforge_discover',
        arguments: { text: 'surface' },
        context: {
          requestId: 'host-request',
          threadId: 'thread-1',
          turnId: 'turn-1',
          workspaceId: '/tmp/workspace'
        }
      })
    )
    const rawResponse = await waitForFile(capabilityRuntimeBridgeResponsePath(rootDir, requestId))
    const response = parseCapabilityRuntimeBridgeResponse(rawResponse, launch.authSecret, requestId)

    expect(response.result).toEqual({ ok: true, value: { forwarded: true } })
    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sciforge_discover',
      context: expect.objectContaining({
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        turnId: 'turn-1',
        workspaceId: '/tmp/workspace'
      })
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect((await readdir(capabilityRuntimeBridgePaths(rootDir).responses)).some((name) => name.endsWith('.tmp'))).toBe(false)
    await bridge.close()
  })

  it('returns signed structured errors instead of leaking transport failures', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'sciforge-runtime-bridge-'))
    const surface = {
      tools: () => CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({
        type: 'function' as const,
        name,
        description: name,
        inputSchema: { type: 'object' }
      })),
      call: async () => {
        throw Object.assign(new Error('temporary capability failure'), { code: 'capability_unavailable' })
      }
    } as unknown as Pick<CapabilityAgentToolSurface, 'tools' | 'call'>
    const bridge = new CapabilityRuntimeBridge({
      rootDir,
      surface,
      capabilityIds: () => ['surface.inspect'],
      authSecret: 'runtime-bridge-test-secret-that-is-long-enough',
      pollIntervalMs: 5
    })
    await bridge.start()
    const launch = bridge.launchConfig()
    const requestId = 'request_fedcba9876543210'
    await atomicWriteCapabilityRuntimeBridgeJson(
      capabilityRuntimeBridgeRequestPath(rootDir, requestId),
      signCapabilityRuntimeBridgeRequest(launch.authSecret, {
        version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
        requestId,
        createdAt: new Date().toISOString(),
        nonce: 'nonce_fedcba9876543210',
        tool: 'sciforge_events',
        arguments: {},
        context: { requestId: 'host-request', threadId: 'thread-1', turnId: 'turn-1' }
      })
    )
    const response = parseCapabilityRuntimeBridgeResponse(
      await waitForFile(capabilityRuntimeBridgeResponsePath(rootDir, requestId)),
      launch.authSecret,
      requestId
    )
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'capability_unavailable',
        message: 'temporary capability failure',
        retryable: false
      }
    })
    await bridge.close()
  })
})

async function waitForFile(path: string): Promise<unknown> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${path}`)
}
