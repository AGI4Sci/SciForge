import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  BIOGYM_DESIGN_INPUT_JSON_SCHEMA,
  BIOGYM_DESIGN_TOOL_NAME,
  BioGymDesignRequestSchema,
  bioGymDesignRequiresApproval,
  buildBioGymDesignToolProviderFromConfig,
  isProteinDesignIntent
} from './biogym-design-tool.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

const DESIGN_RUN_ID = 'design-111111111111111111111111'
const SECOND_DESIGN_RUN_ID = 'design-222222222222222222222222'
let nextBridgePort = 43_210

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BioGymDesignRequestSchema', () => {
  it.each([
    { operation: 'capabilities' },
    {
      operation: 'start',
      workflow: 'de_novo_scaffold',
      objective: 'Generate a compact stable scaffold'
    },
    {
      operation: 'start',
      workflow: 'fixed_backbone',
      objective: 'Redesign this backbone',
      input: { backbonePath: 'inputs/backbone.pdb' },
      budget: { maxGpuJobs: 4, maxWallclockHours: 2, maxCandidatesPerStage: 5 }
    },
    {
      operation: 'start',
      workflow: 'target_binder',
      objective: 'Design a binder',
      input: {
        targetStructurePath: 'inputs/target.cif',
        targetChain: 'A',
        hotspotResidues: ['A:42', 'A:73']
      }
    },
    {
      operation: 'advance',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 1,
      stage: { kind: 'backbone', lengthRange: [80, 120], numBackbones: 5 }
    },
    {
      operation: 'advance',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 2,
      stage: {
        kind: 'sequence',
        backboneAssetId: 'backbone-1',
        chainsToDesign: ['A'],
        numSequences: 5,
        samplingTemperature: 0.1,
        seed: 7
      }
    },
    {
      operation: 'advance',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 3,
      stage: { kind: 'verify', candidateSetId: 'set-1', topN: 5 }
    },
    {
      operation: 'advance',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 3,
      stage: {
        kind: 'verify',
        candidateIds: ['job_000002_candidate_004', 'job_000003_candidate_005']
      }
    },
    {
      operation: 'advance',
      designRunId: SECOND_DESIGN_RUN_ID,
      expectedRevision: 1,
      stage: {
        kind: 'binder',
        lengthRange: [60, 90],
        numTrajectories: 10,
        numSequences: 5,
        finalDesigns: 3
      }
    },
    { operation: 'status', designRunId: DESIGN_RUN_ID, sinceRevision: 2 },
    {
      operation: 'extend_budget',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 4,
      additionalGpuJobs: 2,
      reason: 'The best candidate needs one controlled retry'
    },
    { operation: 'cancel', designRunId: DESIGN_RUN_ID, expectedRevision: 4 },
    {
      operation: 'finalize',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 5,
      disposition: 'selected',
      selectedCandidateIds: ['candidate-3'],
      summary: 'Candidate 3 has the strongest predicted confidence.',
      caveats: ['Computational prediction only; no wet-lab validation.']
    },
    {
      operation: 'finalize',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 5,
      disposition: 'no_viable_candidate',
      summary: 'No candidate met the computational threshold.',
      caveats: ['No experimental validation was performed.']
    },
    { operation: 'cleanup', designRunId: DESIGN_RUN_ID, expectedRevision: 6 }
  ])('accepts a valid discriminated request: $operation', (request) => {
    expect(BioGymDesignRequestSchema.safeParse(request).success).toBe(true)
  })

  it.each([
    {
      request: {
        operation: 'start',
        workflow: 'fixed_backbone',
        objective: 'missing backbone'
      },
      issue: 'backbonePath'
    },
    {
      request: {
        operation: 'start',
        workflow: 'target_binder',
        objective: 'missing target',
        input: { targetStructurePath: 'target.pdb' }
      },
      issue: 'targetChain'
    },
    {
      request: {
        operation: 'finalize',
        designRunId: 'run',
        expectedRevision: 1,
        disposition: 'selected',
        summary: 'selected nothing',
        caveats: ['prediction only']
      },
      issue: 'selectedCandidateIds'
    },
    {
      request: {
        operation: 'capabilities',
        workspaceRoot: '/model/spoof'
      },
      issue: 'Unrecognized key'
    },
    {
      request: {
        operation: 'capabilities',
        context: { threadId: 'spoof' }
      },
      issue: 'Unrecognized key'
    },
    {
      request: {
        operation: 'start',
        workflow: 'de_novo_scaffold',
        objective: 'too many candidates',
        budget: { maxCandidatesPerStage: 21 }
      },
      issue: 'Too big'
    },
    {
      request: {
        operation: 'advance',
        designRunId: DESIGN_RUN_ID,
        expectedRevision: 3,
        stage: { kind: 'verify' }
      },
      issue: 'exactly one'
    },
    {
      request: {
        operation: 'advance',
        designRunId: DESIGN_RUN_ID,
        expectedRevision: 3,
        stage: {
          kind: 'verify',
          candidateSetId: 'set-1',
          candidateIds: ['candidate-1']
        }
      },
      issue: 'exactly one'
    },
    {
      request: {
        operation: 'advance',
        designRunId: DESIGN_RUN_ID,
        expectedRevision: 3,
        stage: {
          kind: 'verify',
          candidateIds: ['candidate-1', 'candidate-1']
        }
      },
      issue: 'unique'
    }
  ])('rejects unsafe or inconsistent request shapes', ({ request, issue }) => {
    const parsed = BioGymDesignRequestSchema.safeParse(request)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((entry) => entry.message).join(' ')).toContain(issue)
    }
  })

  it('publishes a provider-compatible flat schema that survives Model Router sanitization', () => {
    const properties = BIOGYM_DESIGN_INPUT_JSON_SCHEMA.properties as Record<string, unknown>
    expect(Object.keys(properties)).toEqual(expect.arrayContaining([
      'operation', 'workflow', 'objective', 'designRunId', 'expectedRevision', 'stage'
    ]))
    expect(JSON.stringify(BIOGYM_DESIGN_INPUT_JSON_SCHEMA)).not.toMatch(/oneOf|prefixItems|"const"/)
    expect((properties.operation as { enum?: unknown[] }).enum).toHaveLength(8)
    expect((properties.stage as { properties?: Record<string, unknown> }).properties).toHaveProperty('kind')
  })
})

describe('BioGym native provider gating', () => {
  it.each([
    'Use BioGym to design a protein binder',
    'Run ProteinMPNN for fixed-backbone sequence design',
    'Create a de novo scaffold with RFdiffusion',
    '请从头设计一个蛋白骨架',
    '为这个靶点设计结合蛋白',
    '请使用 BioGym 设计一个 80–100 aa 的 de novo protein scaffold。先生成 3 个 backbone，然后用 ProteinMPNN 设计 sequence，最后选择最好的 2 个候选用 Boltz-2 验证结构。每个阶段完成后分析结果，并在 Biology Room 展示候选。'
  ])('recognizes protein-design intent: %s', (requestText) => {
    expect(isProteinDesignIntent(requestText)).toBe(true)
  })

  it.each([
    undefined,
    'View this protein structure in the Biology Room',
    'Research the latest protein folding paper',
    'Annotate residue 42',
    'Refactor the settings panel'
  ])('does not advertise for unrelated intent: %s', (requestText) => {
    expect(isProteinDesignIntent(requestText)).toBe(false)
  })

  it('stays unavailable unless both private bridge variables are configured', () => {
    const missing = buildBioGymDesignToolProviderFromConfig(undefined)
    expect(missing.provider.available).toBe(false)
    expect(missing.provider.tools).toEqual([])

    const remote = buildBioGymDesignToolProviderFromConfig({
      baseUrl: 'https://biogym.example.com',
      token: 'secret'
    })
    expect(remote.provider.available).toBe(false)
    expect(remote.provider.reason).toContain('HTTP loopback')
  })

  it('captures the private pipe config only in the native tool closure', () => {
    const captured = buildBioGymDesignToolProviderFromConfig({
      baseUrl: 'http://127.0.0.1:43210',
      token: 'private-token'
    })
    expect(captured.provider.available).toBe(true)
    expect(captured.provider.tools).toHaveLength(1)
  })

  it('advertises only in a matching native turn context', async () => {
    const { baseUrl } = await listenJsonServer(() => ({ ok: true, data: {} }))
    const tool = configuredTool(baseUrl)
    const host = new LocalToolHost({ tools: [tool] })

    expect(await host.listTools(context({ requestText: 'Show this PDB structure' }))).toEqual([])
    expect(await host.listTools(context({ requestText: 'Design a protein scaffold' }))).toEqual([
      expect.objectContaining({ name: BIOGYM_DESIGN_TOOL_NAME, providerKind: 'built-in' })
    ])
    await expect(host.execute({
      callId: 'hidden-call',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: { operation: 'capabilities' }
    }, context({ requestText: 'Show this PDB structure' }))).rejects.toThrow(/not advertised/)
  })
})

describe('BioGym approval boundary', () => {
  it('validates malformed calls before approval and returns a canonical correction', async () => {
    let approvalCount = 0
    let requestCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: {} }
    })
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    const result = await host.execute({
      callId: 'invalid-empty-call',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {}
    }, context({
      requestText: 'Design a protein scaffold',
      awaitApproval: async () => {
        approvalCount += 1
        return 'allow'
      }
    }))

    expect(result.approved).toBe(true)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'invalid_biogym_design_request',
        correction: { example: { operation: 'capabilities' } }
      }
    })
    expect(approvalCount).toBe(0)
    expect(requestCount).toBe(0)
  })

  it('requires approval for start and budget extension but not in-budget operations', async () => {
    let requestCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: { accepted: true } }
    })
    const approvals: string[] = []
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    const activeContext = context({
      requestText: 'Design a protein scaffold',
      approvalPolicy: 'on-request',
      awaitApproval: async (approval) => {
        approvals.push(approval.summary)
        return 'allow'
      }
    })

    await execute(host, 'capabilities', { operation: 'capabilities' }, activeContext)
    const startResult = await host.execute({
      callId: 'start',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {
      operation: 'start',
      workflow: 'de_novo_scaffold',
      objective: 'Design a scaffold'
      }
    }, activeContext)
    await execute(host, 'status', {
      operation: 'status',
      designRunId: DESIGN_RUN_ID
    }, activeContext)
    await execute(host, 'extend', {
      operation: 'extend_budget',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 1,
      additionalGpuJobs: 1,
      reason: 'One controlled retry'
    }, activeContext)

    expect(approvals).toHaveLength(2)
    expect(startResult.approved).toBe(true)
    expect(approvals[0]).toContain('operation="start"')
    expect(approvals[1]).toContain('operation="extend_budget"')
    expect(requestCount).toBe(4)
  })

  it('returns an operation-specific correction for incomplete finalization', async () => {
    const { baseUrl } = await listenJsonServer(() => ({ ok: true, data: {} }))
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    const result = await host.execute({
      callId: 'invalid-finalize',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {
        operation: 'finalize',
        designRunId: 'design-0123456789abcdef01234567',
        disposition: 'selected',
        selectedCandidateIds: ['candidate-1'],
        summary: 'Select the verified candidate.'
      }
    }, context({ requestText: 'Finalize the protein design run' }))

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'invalid_biogym_design_request',
        correction: {
          example: {
            operation: 'finalize',
            designRunId: 'design-0123456789abcdef01234567',
            expectedRevision: 3,
            disposition: 'selected',
            selectedCandidateIds: ['candidate-1'],
            caveats: ['Computational prediction only; no wet-lab validation.']
          }
        }
      }
    })
  })

  it.each(['auto', 'on-request', 'suggest', 'untrusted'] as const)(
    'enforces the start approval invariant under the %s runtime policy',
    async (approvalPolicy) => {
      let requestCount = 0
      let approvalCount = 0
      const { baseUrl } = await listenJsonServer(() => {
        requestCount += 1
        return { ok: true, data: { designRunId: 'approved-run' } }
      })
      const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
      const result = await host.execute({
        callId: `approved-${approvalPolicy}`,
        toolName: BIOGYM_DESIGN_TOOL_NAME,
        arguments: {
          operation: 'start',
          workflow: 'de_novo_scaffold',
          objective: 'Design a scaffold'
        }
      }, context({
        requestText: 'Design a protein scaffold',
        approvalPolicy,
        awaitApproval: async () => {
          approvalCount += 1
          return 'allow'
        }
      }))

      expect(result.item.kind).toBe('tool_result')
      expect(approvalCount).toBe(1)
      expect(requestCount).toBe(1)
    }
  )

  it('fails closed without dispatch when mandatory approval is disabled by never policy', async () => {
    let requestCount = 0
    let approvalCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: {} }
    })
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    const result = await host.execute({
      callId: 'never-start',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {
        operation: 'start',
        workflow: 'de_novo_scaffold',
        objective: 'Design a scaffold'
      }
    }, context({
      requestText: 'Design a protein scaffold',
      approvalPolicy: 'never',
      awaitApproval: async () => {
        approvalCount += 1
        return 'allow'
      }
    }))

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'approval_policy_blocked'
      }
    })
    expect(approvalCount).toBe(0)
    expect(requestCount).toBe(0)
  })

  it('also enforces budget-extension approval under the auto runtime policy', async () => {
    let requestCount = 0
    let approvalCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: { revision: 3 } }
    })
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    await host.execute({
      callId: 'auto-extension',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {
        operation: 'extend_budget',
        designRunId: DESIGN_RUN_ID,
        expectedRevision: 2,
        additionalGpuJobs: 1,
        reason: 'One bounded verification retry'
      }
    }, context({
      requestText: 'Continue this protein design run',
      approvalPolicy: 'auto',
      awaitApproval: async () => {
        approvalCount += 1
        return 'allow'
      }
    }))

    expect(approvalCount).toBe(1)
    expect(requestCount).toBe(1)
  })

  it('does not contact the service after a denied start approval', async () => {
    let requestCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: {} }
    })
    const host = new LocalToolHost({ tools: [configuredTool(baseUrl)] })
    const result = await host.execute({
      callId: 'denied-start',
      toolName: BIOGYM_DESIGN_TOOL_NAME,
      arguments: {
        operation: 'start',
        workflow: 'de_novo_scaffold',
        objective: 'Design a scaffold'
      }
    }, context({
      requestText: 'Design a protein scaffold',
      approvalPolicy: 'on-request',
      awaitApproval: async () => 'deny'
    }))

    expect(result.item.kind).toBe('approval')
    expect(requestCount).toBe(0)
  })

  it.each([
    [{ operation: 'start', workflow: 'de_novo_scaffold', objective: 'Design a scaffold' }, true],
    [{
      operation: 'extend_budget',
      designRunId: DESIGN_RUN_ID,
      expectedRevision: 2,
      additionalGpuJobs: 1,
      reason: 'One retry'
    }, true],
    [{ operation: 'advance' }, false],
    [{ operation: 'status' }, false],
    [{ operation: 'future_mutation' }, false],
    [{}, false]
  ] as const)('approves only a valid start or budget extension for %j', (args, expected) => {
    expect(bioGymDesignRequiresApproval(args)).toBe(expected)
  })
})

describe('BioGym internal HTTP bridge', () => {
  it('sends a short authenticated request with trusted context only', async () => {
    let seenRequest: RecordedRequest | undefined
    let seenBody: unknown
    const { baseUrl } = await listenJsonServer(async (request, body) => {
      seenRequest = request
      seenBody = body
      return {
        ok: true,
        data: { designRunId: 'design-123', revision: 1, status: 'created' }
      }
    })
    const tool = configuredTool(baseUrl)
    const result = await tool.execute({
      operation: 'start',
      workflow: 'fixed_backbone',
      objective: 'Redesign the backbone',
      input: { backbonePath: 'inputs/backbone.pdb' }
    }, context({
      threadId: 'trusted-thread',
      turnId: 'trusted-turn',
      workspace: '/trusted/workspace',
      project: 'trusted-project',
      requestText: 'Design a protein sequence'
    }))

    expect(result).toEqual({
      output: { designRunId: 'design-123', revision: 1, status: 'created' }
    })
    expect(seenRequest?.method).toBe('POST')
    expect(seenRequest?.url).toBe('/v1/biogym/design')
    expect(seenRequest?.headers.authorization).toBe('Bearer internal-test-token')
    expect(seenRequest?.headers['content-type']).toBe('application/json')
    expect(seenBody).toEqual({
      version: 1,
      request: {
        operation: 'start',
        workflow: 'fixed_backbone',
        objective: 'Redesign the backbone',
        input: { backbonePath: 'inputs/backbone.pdb' }
      },
      context: {
        threadId: 'trusted-thread',
        turnId: 'trusted-turn',
        workspace: '/trusted/workspace',
        project: 'trusted-project'
      }
    })
  })

  it.each([
    { operation: 'capabilities', workspace: '/spoofed' },
    { operation: 'capabilities', workspaceRoot: '/spoofed' },
    { operation: 'capabilities', context: { threadId: 'spoofed' } },
    { operation: 'capabilities', sshHost: 'attacker.example.com' },
    { operation: 'capabilities', outputDirectory: '/tmp/spoofed' }
  ])('rejects model attempts to spoof trusted bridge fields: %j', async (args) => {
    let requestCount = 0
    const { baseUrl } = await listenJsonServer(() => {
      requestCount += 1
      return { ok: true, data: {} }
    })
    const result = await configuredTool(baseUrl).execute(args, context({
      requestText: 'Design a protein'
    }))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ code: 'invalid_biogym_design_request' })
    expect(requestCount).toBe(0)
  })

  it('normalizes a service error without exposing the bridge token', async () => {
    const { baseUrl } = await listenJsonServer(() => ({
      status: 409,
      body: {
        ok: false,
        error: { code: 'revision_conflict', message: 'Expected revision is stale' }
      }
    }))
    const result = await configuredTool(baseUrl).execute({
      operation: 'status',
      designRunId: DESIGN_RUN_ID
    }, context({ requestText: 'Design a protein' }))

    expect(result).toEqual({
      output: { code: 'revision_conflict', error: 'Expected revision is stale' },
      isError: true
    })
    expect(JSON.stringify(result)).not.toContain('internal-test-token')
  })
})

function configuredTool(baseUrl: string): LocalTool {
  const built = buildBioGymDesignToolProviderFromConfig({
    baseUrl,
    token: 'internal-test-token'
  })
  expect(built.provider.available).toBe(true)
  const tool = built.provider.tools[0]
  if (!tool) throw new Error('expected configured BioGym tool')
  return tool
}

function context(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace',
    requestText: 'Design a protein',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

async function execute(
  host: LocalToolHost,
  callId: string,
  args: Record<string, unknown>,
  activeContext: ToolHostContext
): Promise<void> {
  await host.execute({
    callId,
    toolName: BIOGYM_DESIGN_TOOL_NAME,
    arguments: args
  }, activeContext)
}

async function listenJsonServer(
  handler: (
    request: RecordedRequest,
    body: unknown
  ) => unknown | Promise<unknown>
): Promise<{ baseUrl: string }> {
  const baseUrl = `http://127.0.0.1:${nextBridgePort++}`
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    )
    const expectedOrigin = new URL(baseUrl).origin
    if (requestUrl.origin !== expectedOrigin) {
      throw new Error(`unexpected in-memory bridge origin: ${requestUrl.origin}`)
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const request: RecordedRequest = {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      url: `${requestUrl.pathname}${requestUrl.search}`,
      headers: Object.fromEntries(headers.entries())
    }
    const rawBody = init?.body ?? (input instanceof Request ? await input.text() : undefined)
    const body = typeof rawBody === 'string' && rawBody.trim()
      ? JSON.parse(rawBody) as unknown
      : null
    try {
      const handled = await handler(request, body)
      const status = isResponseOverride(handled) ? handled.status : 200
      const responseBody = isResponseOverride(handled) ? handled.body : handled
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: { message: String(error) } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }))
  return { baseUrl }
}

type RecordedRequest = {
  method: string
  url: string
  headers: Record<string, string>
}

function isResponseOverride(value: unknown): value is { status: number; body: unknown } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { status?: unknown }).status === 'number' &&
    'body' in value
  )
}
