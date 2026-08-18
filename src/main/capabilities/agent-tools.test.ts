import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  CapabilityCallerContext,
  CapabilityDescriptor,
  CapabilityInvocationResult,
  CapabilityObservation,
  CapabilityResourceHandle
} from '../../shared/capability-broker'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  CapabilityAgentToolError,
  createCapabilityAgentToolSurface,
  type AgentVisualRuntime,
  type CapabilityAgentApprovalRequest,
  type CapabilityAgentBroker,
  type CapabilityAgentToolRequestContext
} from './agent-tools'
import { CapabilityBroker } from './broker'
import { CapabilityRegistry, defineCapability } from './registry'

const nestedArtifactInputSchema = z.object({
  task: z.string().min(1),
  artifacts: z.array(z.object({
    id: z.string().min(1),
    path: z.string().min(1),
    regions: z.array(z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number()
    }).strict()).optional()
  }).strict()).min(1)
}).strict()

const observedResourceStateSchema = z.object({
  resources: z.array(z.object({
    kind: z.string().min(1),
    resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/u)
  }).strict())
}).passthrough()

const caller: CapabilityCallerContext = {
  audience: 'agent',
  callerId: 'thread-1',
  workspaceId: '/workspace',
  approvals: []
}

const context: CapabilityAgentToolRequestContext = {
  requestId: 'request-1',
  runtimeId: 'test',
  threadId: 'thread-1',
  workspaceId: '/workspace'
}

describe('CapabilityAgentToolSurface', () => {
  it('fails closed when the Host cannot match a tool request to its captured Principal lease', async () => {
    const discover = vi.fn(async () => [])
    const assertPrincipalLease = vi.fn(() => {
      throw new CapabilityAgentToolError(
        'principal_changed',
        'The turn Principal lease is unknown.'
      )
    })
    const surface = createCapabilityAgentToolSurface({
      broker: { ...brokerStub(), discover },
      assertPrincipalLease,
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: { ...context, turnId: 'forged-turn' }
    })).rejects.toMatchObject({ code: 'principal_changed' })
    expect(discover).not.toHaveBeenCalled()
  })

  it('publishes the broker meta-tools and native visual tools without authority fields', () => {
    const surface = createCapabilityAgentToolSurface({ broker: brokerStub(), resolveCaller: () => caller })

    expect(surface.tools().map((tool) => tool.name)).toEqual([
      'sciforge_discover',
      'sciforge_observe',
      'sciforge_invoke',
      'sciforge_events',
      'sciforge_look',
      'sciforge_capture'
    ])
    expect(surface.tools().every((tool) => tool.inputSchema.type === 'object')).toBe(true)
    expect(surface.tools().find((tool) => tool.name === CAPABILITY_AGENT_TOOL_NAMES.discover)?.description)
      .toMatch(/native.*before.*managed|native.*first/iu)
    expect(JSON.stringify(surface.tools())).not.toMatch(
      /snapshotToken|componentId|expectedRevision|semanticRevision|invocationId|actionId|coordinates/u
    )
    expect(surface.tools().find((tool) => tool.name === CAPABILITY_AGENT_TOOL_NAMES.look)?.inputSchema)
      .toMatchObject({
        required: ['task'],
        properties: {
          sourceRef: { type: 'string' },
          targetRef: { type: 'string' },
          frame: { type: 'integer' },
          task: { type: 'string' },
          intent: { enum: ['describe', 'ocr', 'locate', 'quality-review'] },
          capture: { enum: ['snapshot', 'region'] },
          timeoutMs: {
            type: 'integer',
            minimum: 30_000,
            maximum: 600_000
          }
        }
      })
    expect(surface.tools().find((tool) => tool.name === CAPABILITY_AGENT_TOOL_NAMES.look)?.inputSchema)
      .not.toHaveProperty('properties.path')
    expect(surface.tools().find((tool) => tool.name === CAPABILITY_AGENT_TOOL_NAMES.capture)?.inputSchema)
      .toMatchObject({
        required: ['snapshotRef'],
        properties: {
          snapshotRef: { type: 'string' },
          regionRef: { type: 'string' },
          purpose: { enum: ['workspace-asset', 'visual-evidence'] }
        }
      })
  })

  it('forwards native look and capture through one typed visual runtime boundary', async () => {
    const look = vi.fn<AgentVisualRuntime['look']>(async () => visualLookOutput())
    const capture = vi.fn<AgentVisualRuntime['capture']>(async () => visualCaptureOutput())
    const surface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      visualRuntime: { look, capture },
      resolveCaller: () => caller
    })
    const turnContext = { ...context, turnId: 'turn-visual', callId: 'call-visual' }

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        sourceRef: visualRefs.source,
        targetRef: visualRefs.target,
        task: 'Locate the method overview figure.',
        intent: 'locate'
      },
      context: turnContext
    })).resolves.toEqual({
      tool: CAPABILITY_AGENT_TOOL_NAMES.look,
      value: visualLookOutput()
    })
    expect(look).toHaveBeenCalledWith({
      sourceRef: visualRefs.source,
      targetRef: visualRefs.target,
      task: 'Locate the method overview figure.',
      intent: 'locate'
    }, {
      caller,
      request: turnContext,
      signal: expect.any(AbortSignal)
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.capture,
      arguments: {
        snapshotRef: visualRefs.snapshot,
        regionRef: visualRefs.region,
        purpose: 'workspace-asset'
      },
      context: turnContext
    })).resolves.toEqual({
      tool: CAPABILITY_AGENT_TOOL_NAMES.capture,
      value: visualCaptureOutput()
    })
    expect(capture).toHaveBeenCalledWith({
      snapshotRef: visualRefs.snapshot,
      regionRef: visualRefs.region,
      purpose: 'workspace-asset'
    }, {
      caller,
      request: turnContext,
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects file paths so workspace visuals use the canonical resource pipeline', async () => {
    const look = vi.fn<AgentVisualRuntime['look']>(async () => visualLookOutput())
    const surface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      visualRuntime: {
        look,
        capture: async () => visualCaptureOutput()
      },
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        path: 'paper.pdf',
        task: 'Inspect the paper.'
      },
      context
    })).rejects.toThrow()
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        task: 'Extract a figure.',
        intent: 'describe',
        capture: 'region'
      },
      context
    })).rejects.toThrow(/intent=locate/u)
    expect(look).not.toHaveBeenCalled()
  })

  it('fails closed when the visual runtime is missing or returns an invalid proof', async () => {
    const unavailable = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      resolveCaller: () => caller
    })
    await expect(unavailable.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        sourceRef: visualRefs.source,
        task: 'Inspect the figure.'
      },
      context
    })).rejects.toMatchObject({ code: 'visual_runtime_unavailable' })

    const invalid = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      visualRuntime: {
        look: async () => ({
          ...visualLookOutput(),
          proof: { ...visualLookOutput().proof, snapshotRef: `snapshot_${'x'.repeat(26)}` }
        }),
        capture: async () => visualCaptureOutput()
      },
      resolveCaller: () => caller
    })
    await expect(invalid.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        sourceRef: visualRefs.source,
        task: 'Inspect the figure.'
      },
      context
    })).rejects.toMatchObject({
      code: 'visual_invalid_result',
      failureClass: 'contract_violation',
      retryable: false
    })
  })

  it('discovers live operations as opaque refs and expands only a requested compact schema', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry)
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })).rejects.toMatchObject({
      code: 'capability_discovery_empty',
      details: {
        outcome: 'empty',
        registryReadiness: { status: 'ready' },
        appliedFilters: { limit: 8 },
        suggestedQueries: expect.any(Array)
      }
    })
    registry.register(readCapability('test.hot-discovered'))

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'hot-discovered' },
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operation = discovered.value[0]
    expect(operation).toMatchObject({
      operationRef: expect.stringMatching(/^op_/u),
      schemaRef: expect.stringMatching(/^schema_/u),
      title: 'Hot-discovered capability',
      providerFamily: 'native',
      acceptedResourceKinds: [],
      producedResourceKinds: []
    })
    expect(operation).not.toHaveProperty('id')
    expect(operation).not.toHaveProperty('inputShape')

    const discoveredWithSchema = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {
        capabilityId: 'test.hot-discovered',
        includeSchema: true,
        limit: 1
      },
      context
    })
    if (discoveredWithSchema.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected discover result.')
    }
    expect(discoveredWithSchema.value[0]).toMatchObject({
      inputShape: {
        properties: {
          query: {
            pattern: '^query_[A-Za-z0-9_-]{4,32}$',
            description: 'A caller-generated query identifier.'
          }
        }
      }
    })

    const expanded = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef: operation?.operationRef, includeSchema: true },
      context
    })
    if (expanded.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    expect(expanded.value[0]).toMatchObject({
      inputShape: {
        properties: {
          query: {
            pattern: '^query_[A-Za-z0-9_-]{4,32}$',
            description: 'A caller-generated query identifier.'
          }
        }
      }
    })
  })

  it('projects current event resource liveness without treating retired refs as reusable', async () => {
    const eventOperation = descriptor('document.update', 'Update document', 'resource', 'workspace-write')
    const resourceRef = 'res_document_abcdefghijklmnopqrstuvwxyz'
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [eventOperation]),
        listEvents: vi.fn(async () => [{
          id: 'event_abcdefghijklmnopqrstuvwxyz',
          type: 'resource.changed' as const,
          occurredAt: '2026-07-16T11:00:00.000Z',
          workspaceId: '/workspace',
          resourceRef,
          resourceStatus: 'retired' as const,
          resourceKind: 'document',
          actionId: eventOperation.id,
          invocationId: 'update-1',
          beforeRevision: '1',
          afterRevision: '2'
        }])
      },
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.events,
      arguments: {},
      context
    })).resolves.toMatchObject({
      value: [{
        resourceRef,
        resourceStatus: 'retired',
        operationRef: expect.stringMatching(/^op_/u)
      }]
    })
  })

  it('preserves nested array items and discriminated union variants in compact schemas', async () => {
    const capability = defineCapability({
      id: 'artifact.review-nested',
      version: '1',
      title: 'Inspect nested artifact input',
      description: 'Verifies compact nested schemas.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: nestedArtifactInputSchema.extend({
        fields: z.record(z.string(), z.object({
          type: z.enum(['string', 'array']),
          required: z.boolean().optional()
        }).strict()),
        request: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('page'), page: z.number().int().positive() }).strict(),
          z.object({ kind: z.literal('region'), regionId: z.string().min(1) }).strict()
        ])
      }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([capability])
    const surface = createCapabilityAgentToolSurface({
      broker: new CapabilityBroker(registry),
      resolveCaller: () => caller
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'nested' },
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operation = discovered.value[0]
    const expanded = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef: operation?.operationRef, includeSchema: true },
      context
    })
    if (expanded.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')

    expect(expanded.value[0]?.inputShape).toMatchObject({
      properties: {
        fields: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['string', 'array'], required: true },
              required: { type: 'boolean', required: false }
            },
            additionalProperties: false
          }
        },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', required: true },
              path: { type: 'string', required: true },
              regions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number', required: true },
                    width: { type: 'number', required: true }
                  }
                }
              }
            }
          }
        },
        request: {
          type: 'union',
          variants: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({
                kind: expect.objectContaining({ const: 'page' }),
                page: expect.objectContaining({ type: 'integer' })
              })
            }),
            expect.objectContaining({
              properties: expect.objectContaining({
                kind: expect.objectContaining({ const: 'region' }),
                regionId: expect.objectContaining({ type: 'string' })
              })
            })
          ])
        }
      }
    })
  })

  it('keeps handles, revisions, action ids, and mutation ids inside the adapter', async () => {
    const surfaceHandle = handle('surface-revision')
    const documentHandle = handle('document-revision', 'b')
    const open = descriptor('surface.current', 'Open current surface', 'global', 'read')
    const inspect = descriptor('surface.describe', 'Describe surface', 'resource', 'read')
    const mutate = {
      ...descriptor('document.update', 'Update document', 'resource', 'workspace-write'),
      approval: 'confirmation' as const
    }
    const surfaceObservation = observation(
      surfaceHandle,
      'res_surface_abcdefghijklmnopqrstuvwxyz',
      'surface',
      {
        layoutFreshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
        targets: [],
        resources: [{ kind: 'workspace-preview', resource: documentHandle }]
      },
      [inspect, mutate]
    )
    const documentObservation = observation(
      documentHandle,
      'res_document_abcdefghijklmnopqrstuvwxyz',
      'workspace-preview',
      { title: 'Paper' },
      [mutate]
    )
    const discover = vi.fn(async () => [open, inspect, mutate])
    const observe = vi.fn(async (_caller, request) => (
      request.resource.token === surfaceHandle.token ? surfaceObservation : documentObservation
    ))
    const invoke = vi.fn(async (_caller, request): Promise<CapabilityInvocationResult> => ({
      actionId: request.actionId,
      ...(request.invocationId ? { invocationId: request.invocationId } : {}),
      output: request.actionId === open.id ? { surface: surfaceHandle } : { ok: true },
      changed: request.actionId === mutate.id,
      replayed: false,
      completedAt: '2026-07-16T11:00:00.000Z'
    }))
    const requestApproval = vi.fn(async (_request: CapabilityAgentApprovalRequest) => 'allowed' as const)
    const surface = createCapabilityAgentToolSurface({
      broker: {
        discover,
        observe,
        bindResourceRef: vi.fn(async () => documentHandle),
        invoke,
        listEvents: vi.fn(async () => [])
      },
      resolveCaller: () => caller,
      requestApproval
    })

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operations = discovered.value
    const openRef = operations.find((candidate) => candidate.title === open.title)?.operationRef
    const mutateRef = operations.find((candidate) => candidate.title === mutate.title)?.operationRef
    const opened = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: openRef, input: {} },
      context
    })
    if (opened.tool !== CAPABILITY_AGENT_TOOL_NAMES.invoke) throw new Error('Expected invoke result.')
    expect(opened.value.capabilityId).toBe(open.id)
    const surfaceRef = (opened.value.output as { surface: { resourceRef: string } }).surface.resourceRef
    const observed = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: surfaceRef },
      context
    })
    if (observed.tool !== CAPABILITY_AGENT_TOOL_NAMES.observe) throw new Error('Expected observe result.')
    const sanitizedState = observedResourceStateSchema.parse(observed.value.state)
    const documentRef = sanitizedState.resources[0]?.resourceRef

    const mutationContext = { ...context, turnId: 'turn-update', callId: 'call-update' }
    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: mutateRef, resourceRef: documentRef, input: { title: 'Updated' } },
      context: mutationContext
    })

    const approvedInvocationId = requestApproval.mock.calls[0]?.[0].invocationId
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      actionId: mutate.id,
      resourceRef: documentRef,
      resourceLabel: 'Paper',
      input: { title: 'Updated' }
    }), expect.any(Object))
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({
      ...caller,
      approvals: [{ actionId: mutate.id, invocationId: approvedInvocationId, mode: 'confirmation' }]
    }), expect.objectContaining({
      actionId: mutate.id,
      resource: documentHandle,
      expectedRevision: documentHandle.semanticRevision,
      invocationId: approvedInvocationId,
      input: { title: 'Updated' }
    }), { context: mutationContext, signal: expect.any(AbortSignal) })
    expect(JSON.stringify({ opened, observed })).not.toMatch(
      /cap_|semanticRevision|expiresAt|actionId|invocationId|expectedRevision|snapshotToken|componentId/u
    )
  })

  it('fails closed when the broker returns a different capability identity', async () => {
    const read = descriptor('document.identity-check', 'Identity check', 'global', 'read')
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [read]),
        invoke: vi.fn(async (): Promise<CapabilityInvocationResult> => ({
          actionId: 'document.forged-identity',
          output: { ok: true },
          changed: false,
          replayed: false,
          completedAt: '2026-07-16T11:00:00.000Z'
        }))
      },
      resolveCaller: () => caller
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: {} },
      context
    })).rejects.toMatchObject({ code: 'capability_identity_mismatch' })
  })

  it('passes a Host workspace locator only through the private caller context', async () => {
    const locator = {
      contractVersion: 1 as const,
      hostSessionId: 'workspace-host-session-1',
      path: '/remote/workspace'
    }
    const discover = vi.fn(async () => [descriptor('document.remote-read', 'Remote read', 'global', 'read')])
    const resolveCaller = vi.fn((request: CapabilityAgentToolRequestContext) => ({
      audience: 'agent' as const,
      callerId: 'remote-agent',
      workspaceId: request.workspaceId,
      workspaceLocator: request.workspaceLocator
    }))
    const surface = createCapabilityAgentToolSurface({
      broker: { ...brokerStub(), discover },
      resolveCaller
    })
    const remoteContext = {
      ...context,
      workspaceId: '/remote/workspace',
      workspaceLocator: locator
    }

    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: remoteContext
    })

    expect(resolveCaller).toHaveBeenCalledWith(remoteContext)
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: '/remote/workspace',
      workspaceLocator: locator
    }), expect.any(Object), { context: remoteContext })
    expect(JSON.stringify(surface.tools())).not.toContain('workspaceLocator')
  })

  it('isolates opaque caches by exact Principal context lease and workspace locator', async () => {
    const operation = descriptor('document.lease-read', 'Lease read', 'global', 'read')
    let identityVersion = 1
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [operation])
      },
      assertPrincipalLease: () => ({ identityVersion, principal: null }),
      resolveCaller: (request) => ({
        ...caller,
        ...(request.workspaceLocator ? { workspaceLocator: request.workspaceLocator } : {})
      })
    })
    const firstLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'workspace-host-session-1',
      path: '/remote/workspace'
    }
    const first = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: { ...context, workspaceLocator: firstLocator }
    })
    if (first.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operationRef = first.value[0]!.operationRef

    identityVersion = 2
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef },
      context: { ...context, workspaceLocator: firstLocator }
    })).rejects.toMatchObject({ code: 'unknown_operation_ref' })

    identityVersion = 1
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef },
      context: {
        ...context,
        workspaceLocator: {
          ...firstLocator,
          hostSessionId: 'workspace-host-session-2'
        }
      }
    })).rejects.toMatchObject({ code: 'unknown_operation_ref' })
  })

  it('rechecks the Principal lease after async caller resolution before direct discovery delivery', async () => {
    const operation = descriptor('document.resolve-barrier', 'Resolve barrier', 'global', 'read')
    let leaseCurrent = true
    let switchDuringResolve = false
    const surface = createCapabilityAgentToolSurface({
      broker: { ...brokerStub(), discover: vi.fn(async () => [operation]) },
      assertPrincipalLease: () => {
        if (!leaseCurrent) throw new CapabilityAgentToolError('principal_changed', 'Principal changed.')
      },
      resolveCaller: async () => {
        await Promise.resolve()
        if (switchDuringResolve) leaseCurrent = false
        return caller
      }
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discovery.')

    switchDuringResolve = true
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef: discovered.value[0]!.operationRef },
      context
    })).rejects.toMatchObject({ code: 'principal_changed' })
  })

  it('rechecks the Principal lease after an async resource-reference bind', async () => {
    let leaseCurrent = true
    const observe = vi.fn()
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        bindResourceRef: vi.fn(async () => {
          await Promise.resolve()
          leaseCurrent = false
          return handle('1', 'b')
        }),
        observe
      },
      assertPrincipalLease: () => {
        if (!leaseCurrent) throw new CapabilityAgentToolError('principal_changed', 'Principal changed.')
      },
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: `res_${'b'.repeat(26)}` },
      context
    })).rejects.toMatchObject({ code: 'principal_changed' })
    expect(observe).not.toHaveBeenCalled()
  })

  it('rechecks the Principal lease after nested observation sanitization', async () => {
    const outerHandle = handle('1', 'o')
    const nestedHandle = handle('1', 'n')
    let leaseCurrent = true
    let observations = 0
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        bindResourceRef: vi.fn(async () => outerHandle),
        observe: vi.fn(async () => {
          observations += 1
          if (observations === 1) {
            return observation(
              outerHandle,
              `res_${'o'.repeat(26)}`,
              'document',
              nestedHandle,
              []
            )
          }
          await Promise.resolve()
          leaseCurrent = false
          return observation(
            nestedHandle,
            `res_${'n'.repeat(26)}`,
            'document',
            { title: 'Principal A state' },
            []
          )
        })
      },
      assertPrincipalLease: () => {
        if (!leaseCurrent) throw new CapabilityAgentToolError('principal_changed', 'Principal changed.')
      },
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: `res_${'o'.repeat(26)}` },
      context
    })).rejects.toMatchObject({ code: 'principal_changed' })
  })

  it('reports outcome_unknown when Principal changes while sanitizing a committed mutation result', async () => {
    const operation = globalMutationDescriptor('document.sanitize-barrier', 'Sanitize barrier')
    const outputHandle = handle('1', 's')
    let leaseCurrent = true
    const invoke = vi.fn(async (): Promise<CapabilityInvocationResult> => ({
      actionId: operation.id,
      output: outputHandle,
      changed: true,
      replayed: false,
      completedAt: '2026-07-16T11:00:00.000Z'
    }))
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [operation]),
        invoke,
        observe: vi.fn(async () => {
          await Promise.resolve()
          leaseCurrent = false
          return observation(
            outputHandle,
            `res_${'s'.repeat(26)}`,
            'document',
            { title: 'Committed result' },
            []
          )
        })
      },
      assertPrincipalLease: () => {
        if (!leaseCurrent) throw new CapabilityAgentToolError('principal_changed', 'Principal changed.')
      },
      resolveCaller: () => caller
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discovery.')

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: discovered.value[0]!.operationRef, input: {} },
      context: { ...context, turnId: 'turn-sanitize-barrier', callId: 'call-sanitize-barrier' }
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('normalizes a Broker Principal rejection after mutation dispatch as non-retryable outcome_unknown', async () => {
    const operation = globalMutationDescriptor('document.dispatch-principal-barrier', 'Dispatch barrier')
    const invoke = vi.fn(async () => {
      throw Object.assign(new Error('Principal changed at Broker delivery.'), {
        code: 'principal_changed'
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [operation]),
        invoke
      },
      resolveCaller: () => caller
    })
    const invocationContext = {
      ...context,
      turnId: 'turn-dispatch-principal-barrier',
      callId: 'call-dispatch-principal-barrier'
    }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: invocationContext
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discovery.')

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: discovered.value[0]!.operationRef, input: {} },
      context: invocationContext
    })).rejects.toMatchObject({ code: 'outcome_unknown', retryable: false })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('normalizes outcome_unknown after an expired resource renewal without a blind retry', async () => {
    const mutation = defineCapability({
      id: 'document.renewed-dispatch-barrier',
      version: '1',
      title: 'Renewed dispatch barrier',
      description: 'Exercises outcome classification after one expired handle renewal.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    }).descriptor
    const resourceRef = `res_${'r'.repeat(26)}`
    const expired = handle('1', 'e')
    const renewed = handle('1', 'u')
    const bindResourceRef = vi.fn()
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(renewed)
    const observe = vi.fn(async () => observation(
      expired,
      resourceRef,
      'document',
      { title: 'Renewable document' },
      [mutation]
    ))
    const invoke = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'resource_handle_expired' }))
      .mockRejectedValueOnce(Object.assign(new Error('unknown'), { code: 'outcome_unknown' }))
    const surface = createCapabilityAgentToolSurface({
      broker: { ...brokerStub(), bindResourceRef, observe, invoke },
      resolveCaller: () => caller
    })
    const invocationContext = {
      ...context,
      turnId: 'turn-renewed-dispatch-barrier',
      callId: 'call-renewed-dispatch-barrier'
    }
    const observed = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef },
      context: invocationContext
    })
    if (observed.tool !== CAPABILITY_AGENT_TOOL_NAMES.observe) throw new Error('Expected observation.')

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: {
        operationRef: observed.value.operations[0]!.operationRef,
        resourceRef,
        input: {}
      },
      context: invocationContext
    })).rejects.toMatchObject({ code: 'outcome_unknown', retryable: false })
    expect(bindResourceRef).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('rejects a prior Principal resource reference before approval or label projection', async () => {
    const protectedOperation = defineCapability({
      id: 'document.publish-principal-bound-resource',
      version: '1',
      title: 'Publish Principal-bound resource',
      description: 'Requires confirmation without exposing another Principal resource label.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    }).descriptor
    const priorResourceRef = `res_${'p'.repeat(26)}`
    const resourceHandle = handle('1', 'p')
    const bindResourceRef = vi.fn(async () => resourceHandle)
    const observe = vi.fn(async () => observation(
      resourceHandle,
      priorResourceRef,
      'document',
      { title: 'Principal A confidential title' },
      [protectedOperation]
    ))
    const invoke = vi.fn()
    const requestApproval = vi.fn(async () => 'allowed' as const)
    let principalVersion = 1
    let principalSubject = 'person-a'
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [protectedOperation]),
        bindResourceRef,
        observe,
        invoke
      },
      assertPrincipalLease: () => ({
        identityVersion: principalVersion,
        principal: {
          authority: 'sciforge.identity-access',
          subject: principalSubject,
          assurance: 'local-selection' as const,
          deviceId: 'installation-1',
          identityVersion: principalVersion
        }
      }),
      resolveCaller: () => caller,
      requestApproval
    })

    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: priorResourceRef },
      context
    })

    principalVersion = 2
    principalSubject = 'person-b'
    const discoveredForB = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    if (discoveredForB.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected discover result.')
    }
    const operationRefForB = discoveredForB.value[0]!.operationRef
    const error = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: {
        operationRef: operationRefForB,
        resourceRef: priorResourceRef,
        input: {}
      },
      context: { ...context, turnId: 'turn-b', callId: 'call-b' }
    }).then(() => undefined, (caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unknown_resource_ref' })
    expect(String((error as Error).message)).not.toContain('Principal A confidential title')
    expect(requestApproval).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('derives one stable mutation identity from trusted provider call context', async () => {
    const handler = vi.fn(async (input: { value: string }) => ({ output: { value: input.value } }))
    const mutate = defineCapability({
      id: 'test.stable-mutation',
      version: '1',
      title: 'Stable mutation',
      description: 'Verifies provider-call idempotency after response loss.',
      audiences: ['agent'],
      scope: 'global',
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ value: z.string() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([mutate]))
    const invoke = vi.spyOn(broker, 'invoke')
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })
    const mutationContext = {
      ...context,
      runtimeId: 'codex',
      threadId: 'thread-stable',
      turnId: 'turn-stable',
      callId: 'provider-call-stable'
    }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: mutationContext
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef

    const first = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { value: 'first' } },
      context: mutationContext
    })
    const replay = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { value: 'first' } },
      context: { ...mutationContext, requestId: 'request-after-response-loss' }
    })

    expect(first.value).toMatchObject({ output: { value: 'first' }, replayed: false })
    expect(replay.value).toMatchObject({ output: { value: 'first' }, replayed: true })
    const firstInvocationId = invoke.mock.calls[0]?.[1].invocationId
    expect(firstInvocationId).toMatch(/^agent_inv_[a-f0-9]{64}$/u)
    expect(invoke.mock.calls[1]?.[1].invocationId).toBe(firstInvocationId)
    expect(handler).toHaveBeenCalledTimes(1)

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { value: 'changed' } },
      context: mutationContext
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(invoke.mock.calls[2]?.[1].invocationId).toBe(firstInvocationId)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('separates mutation identities by operation and exact provider call context', async () => {
    const firstMutation = globalMutationDescriptor('document.first-update', 'First update')
    const secondMutation = globalMutationDescriptor('document.second-update', 'Second update')
    const invoke = vi.fn(async (_caller, request): Promise<CapabilityInvocationResult> => ({
      actionId: request.actionId,
      ...(request.invocationId ? { invocationId: request.invocationId } : {}),
      output: { ok: true },
      changed: true,
      replayed: false,
      completedAt: '2026-07-16T11:00:00.000Z'
    }))
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [firstMutation, secondMutation]),
        invoke
      },
      resolveCaller: () => caller
    })
    const mutationContext = { ...context, turnId: 'turn-separated', callId: 'call-shared' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: mutationContext
    })
    const operations = discovered.value as Array<{ operationRef: string }>

    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: operations[0]!.operationRef, input: {} },
      context: mutationContext
    })
    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: operations[1]!.operationRef, input: {} },
      context: mutationContext
    })
    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: operations[0]!.operationRef, input: {} },
      context: { ...mutationContext, callId: 'call-distinct' }
    })

    const invocationIds = invoke.mock.calls.map((call) => call[1].invocationId)
    expect(invocationIds).toHaveLength(3)
    expect(new Set(invocationIds).size).toBe(3)
  })

  it('fails closed for mutation without exact thread, turn, and call context but preserves reads', async () => {
    const read = descriptor('document.read-contextless', 'Read without exact context', 'global', 'read')
    const mutate = globalMutationDescriptor('document.update-contextless', 'Update without exact context')
    const invoke = vi.fn(async (_caller, request): Promise<CapabilityInvocationResult> => ({
      actionId: request.actionId,
      ...(request.invocationId ? { invocationId: request.invocationId } : {}),
      output: { ok: true },
      changed: request.actionId === mutate.id,
      replayed: false,
      completedAt: '2026-07-16T11:00:00.000Z'
    }))
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [read, mutate]),
        invoke
      },
      resolveCaller: () => caller
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    const operations = discovered.value as Array<{ operationRef: string; title: string }>
    const readRef = operations.find((operation) => operation.title === read.title)!.operationRef
    const mutateRef = operations.find((operation) => operation.title === mutate.title)!.operationRef

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: readRef, input: {} },
      context
    })).resolves.toMatchObject({ value: { output: { ok: true } } })
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('invocationId')

    for (const incomplete of [
      context,
      { ...context, runtimeId: '   ', turnId: 'turn-1', callId: 'call-1' },
      { ...context, threadId: '   ', turnId: 'turn-1', callId: 'call-1' },
      { ...context, turnId: '   ', callId: 'call-1' },
      { ...context, turnId: 'turn-1', callId: '   ' }
    ]) {
      await expect(surface.call({
        name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
        arguments: { operationRef: mutateRef, input: {} },
        context: incomplete
      })).rejects.toMatchObject({ code: 'missing_invocation_context' })
    }
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('binds a transferred resourceRef and renews its expired cached handle on observation', async () => {
    let now = new Date('2026-07-16T11:00:00.000Z')
    const read = defineCapability({
      id: 'document.read',
      version: '1',
      title: 'Read document',
      description: 'Reads a bound document resource.',
      audiences: ['agent', 'ui'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([read])
    const broker = new CapabilityBroker(registry, { now: () => now, handleTtlMs: 1_000 })
    const uiCaller: CapabilityCallerContext = {
      audience: 'ui',
      callerId: 'window-1',
      workspaceId: '/workspace',
      approvals: []
    }
    const uiHandle = broker.issueResourceHandle(uiCaller, {
      resourceId: 'internal-paper',
      resourceKind: 'document',
      workspaceId: '/workspace',
      audiences: ['ui', 'agent'],
      semanticRevision: '1',
      expiresInMs: 1_000,
      observe: async () => ({
        state: { title: 'Paper' },
        semanticRevision: '1',
        operationIds: ['document.read']
      })
    })
    const transferred = await broker.observe(uiCaller, { resource: uiHandle })
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    const first = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: transferred.resourceRef },
      context
    })
    expect(first.value).toMatchObject({ resourceRef: transferred.resourceRef, state: { title: 'Paper' } })
    if (first.tool !== CAPABILITY_AGENT_TOOL_NAMES.observe) throw new Error('Expected observe result.')
    const readRef = first.value.operations[0]?.operationRef

    now = new Date('2026-07-16T11:00:02.000Z')
    const invoked = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: readRef, resourceRef: transferred.resourceRef, input: {} },
      context
    })
    expect(invoked.value).toMatchObject({ resourceRef: transferred.resourceRef, output: { ok: true } })
    const renewed = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: transferred.resourceRef },
      context
    })
    expect(renewed.value).toMatchObject({ resourceRef: transferred.resourceRef, state: { title: 'Paper' } })
  })

  it('waits for human confirmation and grants only the approved action invocation', async () => {
    const handler = vi.fn(async () => ({ output: { ok: true } }))
    const publish = defineCapability({
      id: 'test.publish',
      version: '1',
      title: 'Publish result',
      description: 'Publishes a result outside the workspace.',
      audiences: ['agent'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([publish]))
    let nextDecision: 'allowed' | 'denied' | 'cancelled' = 'allowed'
    const confirmation = vi.fn(async (
      _request: CapabilityAgentApprovalRequest
    ): Promise<'allowed' | 'denied' | 'cancelled'> => nextDecision)
    const invoke = vi.spyOn(broker, 'invoke')
    const cancelApprovalTurn = vi.fn(() => 1)
    const surface = createCapabilityAgentToolSurface({
      broker,
      resolveCaller: () => caller,
      requestApproval: confirmation,
      cancelApprovalTurn
    })
    const approvalContext = { ...context, turnId: 'turn-1', callId: 'call-1' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: approvalContext
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { value: 'result' } },
      context: approvalContext
    })).resolves.toMatchObject({ value: { output: { ok: true } } })

    const approvalRequest = confirmation.mock.calls[0]?.[0]
    if (!approvalRequest) throw new Error('Expected a confirmation request.')
    expect(approvalRequest).toMatchObject({
      context: approvalContext,
      actionId: 'test.publish',
      invocationId: expect.stringMatching(/^agent_inv_/u),
      mode: 'confirmation',
      input: { value: 'result' }
    })
    expect(invoke.mock.calls[0]![0].approvals).toEqual([{
      actionId: 'test.publish',
      invocationId: approvalRequest.invocationId,
      mode: 'confirmation'
    }])
    expect(handler).toHaveBeenCalledTimes(1)

    nextDecision = 'denied'
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { value: 'denied' } },
      context: { ...approvalContext, callId: 'call-2' }
    })).rejects.toMatchObject({ code: 'approval_denied' })
    expect(handler).toHaveBeenCalledTimes(1)

    expect(surface.abortTurn({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1' }, 'user_stop')).toBe(1)
    expect(cancelApprovalTurn).toHaveBeenCalledWith(
      { runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1' },
      'user_stop'
    )
  })

  it('rechecks the captured Principal lease after approval and before dispatch', async () => {
    const protectedCapability = defineCapability({
      id: 'test.principal-bound-publish',
      version: '1',
      title: 'Principal-bound publish',
      description: 'Requires confirmation and one unchanged Principal lease.',
      audiences: ['agent'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const protectedDescriptor = protectedCapability.descriptor
    const invoke = vi.fn()
    let leaseCurrent = true
    const surface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        discover: vi.fn(async () => [protectedDescriptor]),
        invoke
      },
      assertPrincipalLease: () => {
        if (!leaseCurrent) {
          throw new CapabilityAgentToolError('principal_changed', 'Principal changed.')
        }
      },
      resolveCaller: () => caller,
      requestApproval: async () => {
        leaseCurrent = false
        return 'allowed' as const
      }
    })
    const invocationContext = { ...context, turnId: 'turn-a', callId: 'call-a' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: invocationContext
    })
    const operationRef = discovered.tool === CAPABILITY_AGENT_TOOL_NAMES.discover
      ? discovered.value[0]?.operationRef
      : undefined

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: {} },
      context: invocationContext
    })).rejects.toMatchObject({ code: 'principal_changed' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('aborts an active native broker invocation when its runtime turn stops', async () => {
    const started = vi.fn()
    let handlerSignal: AbortSignal | undefined
    const execute = defineCapability({
      id: 'test.long-native-write',
      version: '1',
      title: 'Long native write',
      description: 'Runs until its host turn is stopped.',
      audiences: ['agent'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ script: z.string() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async (_input, handlerContext) => new Promise((_, reject) => {
        handlerSignal = handlerContext.signal
        started()
        const fail = (): void => reject(new Error('native invoke aborted'))
        if (handlerContext.signal?.aborted) fail()
        else handlerContext.signal?.addEventListener('abort', fail, { once: true })
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: new CapabilityBroker(new CapabilityRegistry([execute])),
      resolveCaller: () => caller,
      requestApproval: async () => 'allowed' as const
    })
    const turnContext = { ...context, runtimeId: 'codex', turnId: 'turn-native', callId: 'call-native' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context: turnContext
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef
    const invocation = surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { script: 'sleep 600' } },
      context: turnContext
    })
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1))

    expect(surface.abortTurn({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-native' })).toBe(1)
    await expect(invocation).rejects.toThrow('Handler for test.long-native-write failed.')
    expect(handlerSignal?.aborted).toBe(true)
  })

  it('aborts an active native visual call when its runtime turn stops', async () => {
    let visualSignal: AbortSignal | undefined
    const lookStarted = vi.fn()
    const surface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      visualRuntime: {
        look: async (_input, visualContext) => new Promise((_, reject) => {
          visualSignal = visualContext.signal
          lookStarted()
          const fail = (): void => reject(new Error('native visual look aborted'))
          if (visualContext.signal.aborted) fail()
          else visualContext.signal.addEventListener('abort', fail, { once: true })
        }),
        capture: async () => visualCaptureOutput()
      },
      resolveCaller: () => caller
    })
    const turnContext = { ...context, turnId: 'turn-visual-abort', callId: 'call-visual-abort' }
    const visualCall = surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.look,
      arguments: {
        sourceRef: visualRefs.source,
        task: 'Inspect until the turn is stopped.'
      },
      context: turnContext
    })
    await vi.waitFor(() => expect(lookStarted).toHaveBeenCalledTimes(1))

    expect(surface.abortTurn({
      runtimeId: 'test',
      threadId: 'thread-1',
      turnId: 'turn-visual-abort'
    })).toBe(1)
    await expect(visualCall).rejects.toThrow('native visual look aborted')
    expect(visualSignal?.aborted).toBe(true)
  })

  it('derives caller identity from transport and rejects non-agent callers and unknown refs', async () => {
    const surface = createCapabilityAgentToolSurface({ broker: brokerStub(), resolveCaller: () => caller })
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: 'res_abcdefghijklmnopqrstuvwxyz' },
      context
    })).rejects.toMatchObject({ code: 'unknown_resource_ref' })

    const retiredSurface = createCapabilityAgentToolSurface({
      broker: {
        ...brokerStub(),
        bindResourceRef: vi.fn(() => {
          throw Object.assign(new Error('retired'), { code: 'resource_ref_retired' })
        })
      },
      resolveCaller: () => caller
    })
    await expect(retiredSurface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: 'res_abcdefghijklmnopqrstuvwxyz' },
      context
    })).rejects.toMatchObject({ code: 'resource_ref_retired' })

    const uiSurface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      resolveCaller: () => ({ ...caller, audience: 'ui' })
    })
    await expect(uiSurface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })).rejects.toEqual(expect.objectContaining<Partial<CapabilityAgentToolError>>({
      code: 'invalid_caller_audience'
    }))
  })
})

function handle(revision: string, suffix = 'a'): CapabilityResourceHandle {
  return {
    token: `cap_${suffix.repeat(26)}`,
    semanticRevision: revision,
    expiresAt: '2026-07-16T12:00:00.000Z'
  }
}

const visualRefs = {
  source: `res_${'s'.repeat(26)}`,
  target: `target_${'t'.repeat(26)}`,
  snapshot: `snapshot_${'n'.repeat(26)}`,
  region: `region_${'r'.repeat(26)}`,
  artifact: `artifact_${'a'.repeat(26)}`,
  lookProof: `visual_proof_${'l'.repeat(26)}`,
  captureProof: `visual_proof_${'c'.repeat(26)}`
} as const

function visualLookOutput() {
  return {
    snapshotRef: visualRefs.snapshot,
    regions: [{
      regionRef: visualRefs.region,
      label: 'Method overview',
      confidence: 0.98
    }],
    evidence: {
      summary: 'The method overview figure is tightly bounded by the returned region.',
      claims: [{
        kind: 'observation' as const,
        text: 'The region contains the complete method overview.',
        regionRef: visualRefs.region,
        confidence: 0.98
      }],
      uncertainties: []
    },
    proof: {
      schema: 'sciforge.visual-proof.v1' as const,
      kind: 'look' as const,
      status: 'verified' as const,
      proofRef: visualRefs.lookProof,
      sourceRef: visualRefs.source,
      snapshotRef: visualRefs.snapshot,
      provider: 'model-router' as const,
      attestation: `sha256:${'b'.repeat(64)}` as const,
      createdAt: '2026-07-26T10:00:00.000Z'
    }
  }
}

function visualCaptureOutput() {
  return {
    artifactRef: visualRefs.artifact,
    relativePath: 'assets/method-overview.png',
    mimeType: 'image/png',
    width: 640,
    height: 320,
    size: 2_048,
    sha256: 'd'.repeat(64),
    changed: true,
    proof: {
      schema: 'sciforge.visual-proof.v1' as const,
      kind: 'capture' as const,
      status: 'persisted' as const,
      proofRef: visualRefs.captureProof,
      inspectionProofRef: visualRefs.lookProof,
      snapshotRef: visualRefs.snapshot,
      regionRef: visualRefs.region,
      artifactRef: visualRefs.artifact,
      sha256: 'd'.repeat(64),
      cropped: true,
      createdAt: '2026-07-26T10:01:00.000Z'
    }
  }
}

function observation(
  resource: CapabilityResourceHandle,
  resourceRef: string,
  resourceKind: string,
  state: CapabilityObservation['state'],
  operations: CapabilityDescriptor[]
): CapabilityObservation {
  return {
    resource,
    resourceRef,
    resourceKind,
    semanticRevision: resource.semanticRevision,
    observedAt: '2026-07-16T11:00:00.000Z',
    state,
    operations
  }
}

function descriptor(
  id: string,
  title: string,
  scope: CapabilityDescriptor['scope'],
  effect: CapabilityDescriptor['effect']
): CapabilityDescriptor {
  return defineCapability({
    id,
    version: '2',
    title,
    description: `${title} through the broker.`,
    audiences: ['agent'],
    scope,
    ...(scope === 'resource' ? { resourceKinds: ['surface', 'workspace-preview'] } : {}),
    effect,
    approval: 'none',
    concurrency: effect === 'read'
      ? { revision: 'none', idempotency: 'none' }
      : { revision: 'optimistic', idempotency: 'required' },
    inputSchema: z.object({ title: z.string().optional() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  }).descriptor
}

function globalMutationDescriptor(id: string, title: string): CapabilityDescriptor {
  return defineCapability({
    id,
    version: '1',
    title,
    description: `${title} through the broker.`,
    audiences: ['agent'],
    scope: 'global',
    effect: 'workspace-write',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'required' },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  }).descriptor
}

function brokerStub(): CapabilityAgentBroker {
  return {
    discover: vi.fn(async () => []),
    observe: vi.fn(),
    bindResourceRef: vi.fn(() => {
      throw new CapabilityAgentToolError('unknown_resource_ref', 'The resource reference is unknown or expired.')
    }),
    invoke: vi.fn(),
    listEvents: vi.fn(async () => [])
  }
}

function readCapability(id: string) {
  return defineCapability({
    id,
    version: '1',
    title: 'Hot-discovered capability',
    description: 'Used to verify current-registry discovery.',
    audiences: ['agent'],
    scope: 'global',
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    inputSchema: z.object({
      query: z.string()
        .regex(/^query_[A-Za-z0-9_-]{4,32}$/u)
        .describe('A caller-generated query identifier.')
        .optional()
    }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  })
}
