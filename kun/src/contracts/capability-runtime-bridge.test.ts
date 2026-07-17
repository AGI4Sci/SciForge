import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES,
  CAPABILITY_RUNTIME_BRIDGE_VERSION,
  CapabilityRuntimeBridgeProtocolError,
  parseCapabilityRuntimeBridgeCatalog,
  parseCapabilityRuntimeBridgeRequest,
  signCapabilityRuntimeBridgeCatalog,
  signCapabilityRuntimeBridgeRequest
} from './capability-runtime-bridge.js'

const secret = 'runtime-bridge-test-secret-that-is-long-enough'

describe('capability runtime bridge contract', () => {
  it('authenticates an opaque request and preserves hidden runtime context', () => {
    const request = signCapabilityRuntimeBridgeRequest(secret, {
      version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
      requestId: 'request_0123456789abcdef',
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

    expect(parseCapabilityRuntimeBridgeRequest(request, secret)).toMatchObject({
      tool: 'sciforge_discover',
      context: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        workspaceId: '/tmp/workspace'
      }
    })
    expect(() => parseCapabilityRuntimeBridgeRequest({
      ...request,
      arguments: { text: 'tampered' }
    }, secret)).toThrowError(CapabilityRuntimeBridgeProtocolError)
  })

  it('accepts only a signed catalog with exactly the four meta-tools', () => {
    const catalog = signCapabilityRuntimeBridgeCatalog(secret, {
      version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
      generatedAt: new Date().toISOString(),
      capabilityIds: ['surface.inspect'],
      tools: CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({
        type: 'function' as const,
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} }
      }))
    })

    expect(parseCapabilityRuntimeBridgeCatalog(catalog, secret)).toMatchObject({
      capabilityIds: ['surface.inspect'],
      tools: CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({ name }))
    })
  })
})
