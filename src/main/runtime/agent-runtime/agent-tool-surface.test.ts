import { describe, expect, it } from 'vitest'

import {
  AgentRuntimeToolError,
  composeAgentRuntimeToolSurfaces,
  createDeferredAgentRuntimeToolSurface,
  filterAgentRuntimeToolSurface,
  nativeAgentToolExecutionMetadata,
  nativeVisualResourceIdentity,
  normalizeNativeVisualToolError
} from './agent-tool-surface'

describe('filterAgentRuntimeToolSurface', () => {
  it('filters publication and rejects dispatch outside the same allowlist', async () => {
    const calls: string[] = []
    const source = {
      tools: () => [
        { type: 'function' as const, name: 'sciforge_discover', description: 'discover', inputSchema: {} },
        { type: 'function' as const, name: 'sciforge_invoke', description: 'invoke', inputSchema: {} }
      ],
      call: async (request: { name: string }) => {
        calls.push(request.name)
        return { tool: request.name, value: {} }
      }
    }
    const filtered = filterAgentRuntimeToolSurface(source as never, ['sciforge_discover'])
    expect(filtered.tools().map((tool) => tool.name)).toEqual(['sciforge_discover'])
    expect(() => filtered.call({
      name: 'sciforge_invoke',
      arguments: {},
      context: { requestId: 'request', runtimeId: 'codex' }
    })).toThrow(/not allowed/)
    expect(calls).toEqual([])
  })

  it('preserves synchronous Principal lease verification through filtered, composed, and deferred wrappers', () => {
    const verified: string[] = []
    const context = {
      requestId: 'request',
      runtimeId: 'codex',
      threadId: 'thread',
      turnId: 'turn'
    }
    const first = {
      tools: () => [{
        type: 'function' as const,
        name: 'first_tool',
        description: 'first',
        inputSchema: {}
      }],
      assertPrincipalLease: () => verified.push('first'),
      call: async () => ({ tool: 'first_tool', value: {} })
    }
    const second = {
      tools: () => [{
        type: 'function' as const,
        name: 'second_tool',
        description: 'second',
        inputSchema: {}
      }],
      assertPrincipalLease: () => verified.push('second'),
      call: async () => ({ tool: 'second_tool', value: {} })
    }

    filterAgentRuntimeToolSurface(first as never, ['first_tool'])
      .assertPrincipalLease?.(context)
    composeAgentRuntimeToolSurfaces([first, second] as never)
      .assertPrincipalLease?.(context)

    let resolved: typeof first | undefined
    const deferred = createDeferredAgentRuntimeToolSurface(() => resolved as never)
    expect(() => deferred.assertPrincipalLease?.(context)).toThrow(/not initialized/)
    resolved = first
    deferred.assertPrincipalLease?.(context)

    expect(verified).toEqual(['first', 'first', 'second', 'first'])
  })
})

const refs = {
  source: `res_${'s'.repeat(24)}`,
  snapshot: `snapshot_${'n'.repeat(24)}`,
  region: `region_${'r'.repeat(24)}`,
  artifact: `artifact_${'a'.repeat(24)}`,
  lookProof: `visual_proof_${'l'.repeat(24)}`,
  captureProof: `visual_proof_${'c'.repeat(24)}`
} as const

describe('nativeAgentToolExecutionMetadata', () => {
  it('mints an attested look receipt only from the exact native tool and strict output', () => {
    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_look',
      value: lookOutput()
    }, 'look-call')).toMatchObject({
      effects: ['read'],
      completionReceipts: [{
        receiptId: refs.lookProof,
        kind: 'visual.look',
        callId: 'look-call',
        subjectRef: refs.source,
        attestation: `sha256:${'b'.repeat(64)}`
      }]
    })

    expect(nativeAgentToolExecutionMetadata({
      tool: 'exec_command',
      value: lookOutput()
    }, 'shell-call')).toEqual({ effects: [], completionReceipts: [] })

    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_look',
      value: {
        ...lookOutput(),
        regions: [],
        evidence: {
          summary: 'The image could not be inspected.',
          claims: [],
          uncertainties: ['The visual translator was unavailable.']
        }
      }
    }, 'degraded-look-call')).toEqual({ effects: [], completionReceipts: [] })
  })

  it('mints a linked capture receipt and rejects malformed visual output', () => {
    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_capture',
      value: captureOutput()
    }, 'capture-call')).toMatchObject({
      effects: ['local_write'],
      completionReceipts: [{
        receiptId: refs.captureProof,
        kind: 'visual.capture',
        parentReceiptIds: [refs.lookProof],
        relatedRefs: [refs.artifact, refs.region],
        callId: 'capture-call',
        subjectRef: refs.artifact,
        sha256: 'c'.repeat(64)
      }]
    })

    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_capture',
      value: {
        ...captureOutput(),
        proof: { ...captureOutput().proof, sha256: 'd'.repeat(64) }
      }
    }, 'capture-call')).toEqual({ effects: [], completionReceipts: [] })
  })

  it('does not attach a region reference to a full-snapshot capture', () => {
    const output = captureOutput()
    const { regionRef: _regionRef, ...proof } = output.proof

    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_capture',
      value: {
        ...output,
        proof: { ...proof, cropped: false }
      }
    }, 'capture-call')).toMatchObject({
      completionReceipts: [{
        relatedRefs: [refs.artifact]
      }]
    })
  })

  it('preserves the capture parent on a final native look receipt', () => {
    const output = lookOutput()
    const finalLook = {
      ...output,
      proof: {
        ...output.proof,
        sourceRef: refs.artifact,
        parentProofRef: refs.captureProof
      }
    }

    expect(nativeAgentToolExecutionMetadata({
      tool: 'sciforge_look',
      value: finalLook
    }, 'final-look-call')).toMatchObject({
      completionReceipts: [{
        kind: 'visual.look',
        subjectRef: refs.artifact,
        parentReceiptIds: [refs.captureProof]
      }]
    })
  })
})

describe('normalizeNativeVisualToolError', () => {
  it.each([
    {
      message: 'The bound surface layout is unavailable while another session or resource is visible.',
      code: 'visual_layout_owner_changed',
      failureClass: 'layout_unavailable',
      retryable: false,
      action: 'restore_bound_surface'
    },
    {
      message: 'The selected surface target is no longer visible.',
      code: 'visual_target_stale',
      failureClass: 'stale_resource',
      retryable: false,
      action: 'reobserve_visual_target'
    },
    {
      message: 'The surface layout did not refresh before visual inspection.',
      code: 'visual_layout_refresh_timeout',
      failureClass: 'timeout',
      retryable: true,
      action: 'refresh_visual_layout'
    },
    {
      message: 'Renderer layout refresh is unavailable.',
      code: 'visual_layout_refresh_unavailable',
      failureClass: 'capability_unavailable',
      retryable: false,
      action: 'stop'
    },
    {
      message: 'Visual understanding is unavailable.',
      code: 'visual_inspection_unavailable',
      failureClass: 'upstream_unavailable',
      retryable: true,
      action: 'retry_visual_inspection'
    },
    {
      message: 'Resource reference has been retired.',
      code: 'visual_source_retired',
      failureClass: 'stale_resource',
      retryable: false,
      action: 'stop'
    }
  ])('normalizes "$message" without relying on provider-specific codes', ({
    message,
    code,
    failureClass,
    retryable,
    action
  }) => {
    const error = normalizeNativeVisualToolError(new Error(message), {
      operation: 'look',
      resourceIdentity: refs.source
    })

    expect(error).toBeInstanceOf(AgentRuntimeToolError)
    expect(error).toMatchObject({
      code,
      failureClass,
      retryable,
      resourceIdentity: `visual:${refs.source}`,
      evidenceDelta: false,
      stateChanged: false,
      recovery: {
        action,
        instruction: expect.any(String)
      }
    })
    expect(error.message).toContain('Recovery:')
  })

  it('normalizes schema failures as non-retryable invalid arguments', () => {
    const schemaError = Object.assign(new Error('Invalid input'), { name: 'ZodError' })
    expect(normalizeNativeVisualToolError(schemaError, {
      operation: 'capture',
      resourceIdentity: refs.snapshot
    })).toMatchObject({
      code: 'visual_invalid_arguments',
      failureClass: 'invalid_arguments',
      retryable: false,
      resourceIdentity: `visual:${refs.snapshot}`,
      recovery: { action: 'correct_arguments' }
    })
  })

  it('preserves an already normalized error and derives stable visual identities', () => {
    const error = new AgentRuntimeToolError('already normalized', {
      code: 'visual_target_stale',
      failureClass: 'stale_resource',
      retryable: false
    })
    expect(normalizeNativeVisualToolError(error, { operation: 'look' })).toBe(error)
    expect(nativeVisualResourceIdentity({ sourceRef: refs.source })).toBe(`visual:${refs.source}`)
    expect(nativeVisualResourceIdentity({ targetRef: 'target_current' })).toBe('visual:target_current')
    expect(nativeVisualResourceIdentity({})).toBe('visual:current')
  })

  it('preserves structured visual provider cause metadata verbatim', () => {
    const recovery = {
      action: 'retry_visual_inspection',
      instruction: 'Retry this immutable snapshot once.'
    }
    const error = Object.assign(new Error('Vision evidence was temporarily unavailable.'), {
      code: 'vision_evidence_unavailable',
      failureClass: 'upstream_unavailable',
      retryable: true,
      recovery,
      providerStage: 'vision_translation'
    })

    expect(normalizeNativeVisualToolError(error, {
      operation: 'look',
      resourceIdentity: refs.snapshot
    })).toMatchObject({
      code: 'vision_evidence_unavailable',
      failureClass: 'upstream_unavailable',
      retryable: true,
      recovery,
      providerStage: 'vision_translation',
      resourceIdentity: `visual:${refs.snapshot}`
    })
  })
})

function lookOutput() {
  return {
    snapshotRef: refs.snapshot,
    regions: [{ regionRef: refs.region, label: 'Method overview', confidence: 0.98 }],
    evidence: {
      summary: 'Located the method overview.',
      claims: [{
        kind: 'observation' as const,
        text: 'The requested figure is tightly bounded.',
        regionRef: refs.region,
        confidence: 0.98
      }],
      uncertainties: []
    },
    proof: {
      schema: 'sciforge.visual-proof.v1' as const,
      kind: 'look' as const,
      status: 'verified' as const,
      proofRef: refs.lookProof,
      sourceRef: refs.source,
      snapshotRef: refs.snapshot,
      provider: 'model-router' as const,
      attestation: `sha256:${'b'.repeat(64)}`,
      createdAt: '2026-07-26T00:00:00.000Z'
    }
  }
}

function captureOutput() {
  return {
    artifactRef: refs.artifact,
    relativePath: 'assets/method-overview.png',
    mimeType: 'image/png',
    width: 1200,
    height: 800,
    size: 42_000,
    sha256: 'c'.repeat(64),
    changed: true,
    proof: {
      schema: 'sciforge.visual-proof.v1' as const,
      kind: 'capture' as const,
      status: 'persisted' as const,
      proofRef: refs.captureProof,
      inspectionProofRef: refs.lookProof,
      snapshotRef: refs.snapshot,
      regionRef: refs.region,
      artifactRef: refs.artifact,
      sha256: 'c'.repeat(64),
      cropped: true,
      createdAt: '2026-07-26T00:00:01.000Z'
    }
  }
}
