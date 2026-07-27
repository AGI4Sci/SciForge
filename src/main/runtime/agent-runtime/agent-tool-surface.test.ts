import { describe, expect, it } from 'vitest'

import { nativeAgentToolExecutionMetadata } from './agent-tool-surface'

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
