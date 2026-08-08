import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  canonicalizeReproSpecForDigest,
  sciforgeReproSpecSchema,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'
import type {
  WorkflowExecutionSnapshotV1,
  WorkflowNodeRunResultV1,
  WorkflowRunV1,
  WorkflowV1
} from './contract.js'
import {
  captureWorkflowExecutionSnapshot,
  assertCreateLoopReproSpecTrustedByRun,
  compareWorkflowRunToSpec,
  createWorkflowExecutionSnapshot,
  createWorkflowReproSpec,
  createWorkflowRunContext,
  createWorkflowRunManifest,
  parseCreateLoopReproSpec,
  workflowFingerprint
} from './rerun.js'

test('consumes an Evidence conclusion spec through the shared JSON boundary', () => {
  const helperPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../evidence-dag/tests/emit_shared_spec.py'
  )
  const emittedJson = execFileSync('python3', [helperPath], {
    encoding: 'utf8'
  })
  const emittedSpec: unknown = JSON.parse(emittedJson)

  const parsed = parseCreateLoopReproSpec(emittedSpec)

  assert.equal(parsed.spec.target.kind, 'conclusion')
  assert.equal(parsed.activity.id, 'workflow-run:42')
  assert.equal(parsed.activity.executor.kind, 'create-loop')
  assert.equal(
    parsed.executor.workflowDigest,
    workflowFingerprint(parsed.executor.workflow)
  )
  assert.equal(
    parsed.payload.baseline.workflowFingerprint,
    workflowFingerprint(parsed.payload.workflow)
  )
  assert.equal(parsed.spec.source.activityId, parsed.activity.id)
  assert.equal(parsed.spec.executionReady, true)
})

test('exports legacy history as a canonical but execution-blocked shared spec', () => {
  const run: WorkflowRunV1 = {
    id: 'legacy-run',
    trigger: 'manual',
    status: 'success',
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T00:00:01.000Z',
    message: 'done',
    nodeResults: []
  }

  const spec = createWorkflowReproSpec(run)

  assert.equal(sciforgeReproSpecSchema.safeParse(spec).success, true)
  assert.equal(spec.executionReady, false)
  assert.equal(spec.reproducibility, 'incomplete')
  assert.equal(spec.activities[0]?.executor.kind, 'unavailable')
  assert.equal(spec.breakpoints[0]?.component, 'executor')
  assert.equal(spec.breakpoints[0]?.blocking, true)
  assert.throws(() => parseCreateLoopReproSpec(spec), /blocked by missing executable metadata/)
})

test('exports one Activity with embedded Create Loop executor metadata and exact comparison by default', () => {
  const workflow = fixtureWorkflow()
  const run = completedRun(createWorkflowExecutionSnapshot(workflow), { text: 'same' })

  const spec = createWorkflowReproSpec(run)
  const parsed = parseCreateLoopReproSpec(spec)

  assert.equal(spec.target.kind, 'activity')
  assert.equal(spec.activities.length, 1)
  assert.equal(parsed.activity.type, 'workflow_run')
  assert.equal(parsed.executor.target.kind, 'workflow')
  assert.equal(parsed.executor.workflowDigest, workflowFingerprint(parsed.executor.workflow))
  assert.equal(
    parsed.payload.baseline.workflowFingerprint,
    workflowFingerprint(parsed.payload.workflow)
  )
  assert.equal(parsed.activity.outputs[0]?.comparator.kind, 'exact-digest')
  assert.equal(spec.executionReady, true)
  assert.equal(spec.reproducibility, 'controlled')
  assert.deepEqual(spec.dependencies, [])
})

test('extracts structured credentials into required slots and blocks rerun without a resolver', () => {
  const workflow = fixtureWorkflow()
  workflow.env = [{ key: 'API_TOKEN', type: 'secret', value: 'env-canary' }]
  workflow.nodes.splice(1, 1, {
    id: 'http',
    name: 'HTTP request',
    type: 'http-request',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      method: 'GET',
      url: 'https://example.invalid',
      headers: [
        { key: 'Authorization', value: 'Bearer authorization-canary' },
        { key: 'Cookie', value: 'session=cookie-canary' },
        { key: 'X-API-Key', value: 'api-key-canary' },
        { key: 'X-Max-Tokens', value: '4096' }
      ],
      body: '',
      timeoutMs: 1_000,
      parseJson: false
    }
  }, {
    id: 'fields',
    name: 'Credential fields',
    type: 'set-fields',
    position: { x: 300, y: 0 },
    disabled: false,
    config: {
      fields: [
        { key: 'password', value: 'password-canary' },
        { key: 'token', value: 'token-canary' },
        { key: 'apiKey', value: 'field-api-key-canary' },
        { key: 'maxTokens', value: '8192' },
        { key: 'tokenizer', value: 'keep-tokenizer' }
      ],
      keepIncoming: false,
      scope: 'payload'
    }
  })
  const extensibleConfig = workflow.nodes.find((node) => node.id === 'fields')!
    .config as unknown as Record<string, unknown>
  extensibleConfig.credentialDefaults = [
    { name: 'Authorization', defaultValue: 'Bearer named-authorization-canary' },
    { name: 'password', value: 'named-password-canary' },
    { name: 'maxTokens', defaultValue: '16384' }
  ]
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'http', targetHandle: '' },
    { id: 'edge-2', source: 'http', sourceHandle: '', target: 'fields', targetHandle: '' },
    { id: 'edge-3', source: 'fields', sourceHandle: '', target: 'output', targetHandle: '' }
  ]

  const captured = captureWorkflowExecutionSnapshot(workflow)
  const serializedSnapshot = JSON.stringify(captured.workflow)
  assert.doesNotMatch(serializedSnapshot, /(?:env|authorization|cookie|api-key|password|token)-canary/u)
  assert.match(serializedSnapshot, /X-Max-Tokens/u)
  assert.match(serializedSnapshot, /maxTokens/u)
  assert.match(serializedSnapshot, /16384/u)
  assert.match(serializedSnapshot, /keep-tokenizer/u)
  assert.equal(captured.secretSlots.length, 9)

  const run = completedRun(captured.workflow, { ok: true }, 'secret-baseline')
  const spec = createWorkflowReproSpec(run)
  assert.equal(spec.executionReady, false)
  assert.equal(spec.reproducibility, 'incomplete')
  assert.deepEqual(spec.secretSlots, captured.secretSlots)
  assert.equal(
    spec.breakpoints.filter((point) => point.code === 'secret_binding_resolver_unavailable').length,
    captured.secretSlots.length
  )
  assert.doesNotMatch(JSON.stringify(spec), /canary/u)
  assert.throws(() => parseCreateLoopReproSpec(spec), /no safe secret resolver/u)

  const bypassAttempt = resignSpec({
    ...spec,
    executionReady: true,
    reproducibility: 'uncontrolled',
    breakpoints: spec.breakpoints.filter((point) => !point.blocking)
  })
  assert.throws(() => parseCreateLoopReproSpec(bypassAttempt), /no safe secret resolver/u)
})

test('redacts structured run input and output into required secret slots', () => {
  const workflow = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const canary = 'dynamic-run-secret-canary'
  const nodeResults = workflow.nodes.map((node, index) => nodeResult(node, { ok: true }, index))
  const manifest = createWorkflowRunManifest({
    source: 'workflow',
    workflow,
    triggerNodeId: 'trigger',
    runInput: {
      credentials: { accessToken: canary },
      headers: [{ key: 'Authorization', value: `Bearer ${canary}` }]
    },
    context: createWorkflowRunContext(
      workflow,
      '/workspace',
      { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' }
    ),
    output: { password: canary, result: 42 },
    nodeResults,
    approvals: []
  })
  const run: WorkflowRunV1 = {
    id: 'dynamic-secret-run',
    trigger: 'trigger',
    status: 'success',
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T00:00:01.000Z',
    message: 'done',
    nodeResults,
    manifest
  }

  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(canary, 'u'))
  const spec = createWorkflowReproSpec(run)
  assert.equal(spec.secretSlots.length, 3)
  assert.equal(spec.executionReady, false)
  assert.doesNotMatch(JSON.stringify(spec), new RegExp(canary, 'u'))
  assert.throws(() => parseCreateLoopReproSpec(spec), /no safe secret resolver/u)
})

test('rejects re-signed executor tampering when repeated fingerprints diverge', () => {
  const run = completedRun(
    createWorkflowExecutionSnapshot(fixtureWorkflow()),
    { text: 'same' }
  )
  const spec = createWorkflowReproSpec(run)

  const workflowTamper = tamperExecutorSpec(spec, (_activity, payload) => {
    payload.baseline.workflowFingerprint = `sha256:${'f'.repeat(64)}`
  })
  assert.throws(
    () => parseCreateLoopReproSpec(workflowTamper),
    /workflow fingerprints are inconsistent/u
  )

  const inputTamper = tamperExecutorSpec(spec, (_activity, payload) => {
    payload.input = { prompt: 'tampered' }
  })
  assert.throws(() => parseCreateLoopReproSpec(inputTamper), /input fingerprints are inconsistent/u)

  const contextTamper = tamperExecutorSpec(spec, (_activity, payload) => {
    payload.context.workspaceRoot = '/tampered-workspace'
  })
  assert.throws(
    () => parseCreateLoopReproSpec(contextTamper),
    /execution context fingerprints are inconsistent/u
  )

  const outputTamper = tamperExecutorSpec(spec, (_activity, payload) => {
    payload.baseline.outputJson = JSON.stringify({ text: 'tampered' })
  })
  assert.throws(
    () => parseCreateLoopReproSpec(outputTamper),
    /baseline output fingerprints are inconsistent/u
  )

  const primaryOutputTamper = tamperExecutorSpec(spec, (activity) => {
    const primary = activity.outputs.find((output) => output.role === 'primary-output')
    if (!primary) throw new Error('Fixture primary output is missing.')
    primary.baselineDigest = `sha256:${'f'.repeat(64)}`
  })
  assert.throws(
    () => parseCreateLoopReproSpec(primaryOutputTamper),
    /primary output baseline fingerprints are inconsistent/u
  )

  const specTamper = tamperExecutorSpec(spec, (activity, payload) => {
    const forged = `sha256:${'f'.repeat(64)}`
    activity.specFingerprint = forged
    payload.baseline.specFingerprint = forged
  })
  assert.throws(
    () => parseCreateLoopReproSpec(specTamper),
    /activity specification fingerprints are inconsistent/u
  )
})

test('rejects re-signed node targets that can bypass fresh workflow approval', () => {
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'approval',
    name: 'Review',
    type: 'human-approval',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      title: 'Review output',
      instruction: 'Approve this run.',
      timeoutMs: 0,
      onTimeout: 'rejected'
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'approval', targetHandle: '' },
    { id: 'edge-2', source: 'approval', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  const run = completedRun(createWorkflowExecutionSnapshot(workflow), { text: 'approved' })
  const spec = createWorkflowReproSpec(run)
  assert.equal(parseCreateLoopReproSpec(spec).activity.approvals.length, 1)

  const nodeTargetBypass = tamperExecutorSpec(spec, (activity) => {
    if (activity.executor.kind !== 'create-loop') throw new Error('Fixture executor is missing.')
    activity.executor.target = { kind: 'node', id: 'output' }
  })
  assert.throws(
    () => parseCreateLoopReproSpec(nodeTargetBypass),
    /node target cannot bypass workflow human-approval requirements/u
  )

  const approvalSubjectTamper = tamperExecutorSpec(spec, (activity) => {
    const approval = activity.approvals[0]
    if (!approval) throw new Error('Fixture approval is missing.')
    approval.subjectId = 'output'
  })
  assert.throws(
    () => parseCreateLoopReproSpec(approvalSubjectTamper),
    /approval requirements are inconsistent with the workflow topology/u
  )

  const workflowTargetTamper = tamperExecutorSpec(spec, (activity) => {
    if (activity.executor.kind !== 'create-loop') throw new Error('Fixture executor is missing.')
    activity.executor.target = { kind: 'workflow', id: 'other-workflow' }
  })
  assert.throws(
    () => parseCreateLoopReproSpec(workflowTargetTamper),
    /workflow target does not match the executor workflow/u
  )
})

test('derives approvals only from trigger-reachable nodes and rejects duplicate node ids', () => {
  const workflow = fixtureWorkflow()
  workflow.nodes.push({
    id: 'orphan-approval',
    name: 'Disconnected review',
    type: 'human-approval',
    position: { x: 200, y: 200 },
    disabled: false,
    config: {
      title: 'Orphan review',
      instruction: 'This node is not reachable.',
      timeoutMs: 0,
      onTimeout: 'rejected'
    }
  })
  const run = completedRun(createWorkflowExecutionSnapshot(workflow), { text: 'same' })
  const spec = createWorkflowReproSpec(run)
  assert.deepEqual(spec.activities[0]?.approvals, [])

  const duplicateBypass = tamperExecutorSpec(spec, (_activity, payload) => {
    const executorPayload = payload as typeof payload & {
      workflow: WorkflowExecutionSnapshotV1
    }
    executorPayload.workflow.nodes.push({
      ...structuredClone(executorPayload.workflow.nodes[1]!),
      type: 'human-approval',
      config: {
        title: 'Forged review',
        instruction: 'Duplicate id shadows this approval.',
        timeoutMs: 0,
        onTimeout: 'rejected'
      }
    } as WorkflowExecutionSnapshotV1['nodes'][number])
  })
  assert.throws(
    () => parseCreateLoopReproSpec(duplicateBypass),
    /duplicate node id/u
  )
})

test('rejects a coherently re-signed executable spec unless it matches the trusted local export', () => {
  const workflow = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const trustedRun = completedRun(workflow, { text: 'same' })
  const trusted = parseCreateLoopReproSpec(createWorkflowReproSpec(trustedRun))
  assert.doesNotThrow(() => assertCreateLoopReproSpecTrustedByRun(trusted, trustedRun))

  const forged = coherentlyTamperWorkflowSpec(trusted.spec)
  const parsedForgery = parseCreateLoopReproSpec(forged)
  assert.throws(
    () => assertCreateLoopReproSpecTrustedByRun(parsedForgery, trustedRun),
    /not the locally trusted export/u
  )
})

test('a failed run or missing or failed required node can never be matched', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const baseline = completedRun(snapshot, { text: 'same' })
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline))

  const failedRun = completedRun(snapshot, { text: 'same' }, 'failed-run')
  failedRun.status = 'error'
  const failedRunComparison = compareWorkflowRunToSpec(parsed, failedRun)
  assert.equal(failedRunComparison.replicationStatus, 'inconclusive')
  assert.equal(failedRunComparison.sameInput, true)
  assert.equal(failedRunComparison.sameSpec, true)
  assert.equal(failedRunComparison.sameExecutionContext, true)
  assert.equal(failedRunComparison.comparisonVerifiable, false)
  assert.equal(failedRunComparison.resultMatch, false)

  const missingManifest = completedRun(snapshot, { text: 'same' }, 'missing-manifest')
  missingManifest.status = 'error'
  missingManifest.manifest = undefined
  const missingManifestComparison = compareWorkflowRunToSpec(parsed, missingManifest)
  assert.equal(missingManifestComparison.matches, false)
  assert.equal(missingManifestComparison.replicationStatus, 'inconclusive')
  assert.equal(missingManifestComparison.sameInput, false)
  assert.equal(missingManifestComparison.comparisonVerifiable, false)
  assert.equal(
    missingManifestComparison.reasonCodes.includes('candidate_manifest_missing'),
    true
  )

  const missingNode = completedRun(snapshot, { text: 'same' }, 'missing-node')
  missingNode.nodeResults.splice(1, 1)
  const missingComparison = compareWorkflowRunToSpec(parsed, missingNode)
  assert.equal(missingComparison.replicationStatus, 'inconclusive')
  assert.equal(missingComparison.reasonCodes.includes('node_missing'), true)

  const failedNode = completedRun(snapshot, { text: 'same' }, 'failed-node')
  failedNode.nodeResults[1]!.status = 'error'
  const failedNodeComparison = compareWorkflowRunToSpec(parsed, failedNode)
  assert.equal(failedNodeComparison.replicationStatus, 'inconclusive')
  assert.equal(failedNodeComparison.reasonCodes.includes('required_node_failed'), true)

  const addedNode = completedRun(snapshot, { text: 'same' }, 'added-node')
  addedNode.nodeResults.push({
    ...structuredClone(addedNode.nodeResults[0]!),
    nodeId: 'attacker-side-effect-node'
  })
  const addedNodeComparison = compareWorkflowRunToSpec(parsed, addedNode)
  assert.equal(addedNodeComparison.matches, false)
  assert.equal(addedNodeComparison.replicationStatus, 'inconclusive')
  assert.equal(addedNodeComparison.reasonCodes.includes('node_added'), true)

  const addedTopology = completedRun(snapshot, { text: 'same' }, 'added-topology')
  addedTopology.manifest!.workflow.nodes.push({
    ...structuredClone(addedTopology.manifest!.workflow.nodes[1]!),
    id: 'hidden-side-effect-node'
  })
  addedTopology.manifest!.workflowFingerprint = workflowFingerprint(
    addedTopology.manifest!.workflow
  )
  const addedTopologyComparison = compareWorkflowRunToSpec(parsed, addedTopology)
  assert.equal(addedTopologyComparison.matches, false)
  assert.equal(addedTopologyComparison.replicationStatus, 'inconclusive')
  assert.equal(addedTopologyComparison.reasonCodes.includes('workflow_node_set_changed'), true)

  for (const field of [
    'inputFingerprint',
    'contextFingerprint',
    'specFingerprint'
  ] as const) {
    const changedExplanation = completedRun(
      snapshot,
      { text: 'same' },
      `failed-changed-${field}`
    )
    changedExplanation.status = 'error'
    changedExplanation.manifest = {
      ...changedExplanation.manifest!,
      [field]: `sha256:${'f'.repeat(64)}`
    }
    const comparison = compareWorkflowRunToSpec(parsed, changedExplanation)
    assert.equal(comparison.matches, false)
    assert.equal(comparison.replicationStatus, 'inconclusive')
    assert.equal(comparison.reasonCodes.includes('candidate_manifest_integrity_invalid'), true)
    assert.equal(comparison.reasonCodes.includes('candidate_run_failed'), true)
    assert.equal(
      field === 'inputFingerprint'
        ? comparison.sameInput
        : field === 'contextFingerprint'
          ? comparison.sameExecutionContext
          : comparison.sameSpec,
      false
    )
  }
})

test('recomputes candidate manifest fingerprints and rejects stale body digests', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const baseline = completedRun(snapshot, { text: 'same' })
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline))

  const cases: Array<{
    name: string
    mutate: (run: WorkflowRunV1) => void
    invalidBasis?: 'input' | 'spec' | 'context'
  }> = [{
    name: 'input',
    mutate: (run) => { run.manifest!.input = { prompt: 'TAMPERED' } },
    invalidBasis: 'input'
  }, {
    name: 'workflow',
    mutate: (run) => { run.manifest!.workflow.nodes[1]!.name = 'TAMPERED' },
    invalidBasis: 'spec'
  }, {
    name: 'context',
    mutate: (run) => { run.manifest!.context.architecture = 'TAMPERED' },
    invalidBasis: 'context'
  }, {
    name: 'output',
    mutate: (run) => { run.manifest!.outputJson = JSON.stringify({ text: 'TAMPERED' }) }
  }, {
    name: 'approval decision',
    mutate: (run) => {
      run.manifest!.approvals = [{
        requestId: 'attacker-request',
        workflowId: snapshot.id,
        runId: run.id,
        nodeId: 'attacker-approval',
        nodeName: 'Attacker approval',
        title: 'Forged',
        instruction: 'Forged',
        requestedAt: '2026-08-05T00:00:00.000Z',
        status: 'approved',
        decision: 'approved',
        resolvedAt: '2026-08-05T00:00:01.000Z',
        actor: 'attacker',
        rationale: 'forged'
      }]
    }
  }, {
    name: 'node output',
    mutate: (run) => { run.nodeResults[1]!.outputJson = JSON.stringify({ text: 'TAMPERED' }) }
  }, {
    name: 'attempt receipt',
    mutate: (run) => { run.nodeResults[1]!.attempts[0]!.receipt.detail = 'TAMPERED' }
  }]

  for (const fixture of cases) {
    const candidate = completedRun(snapshot, { text: 'same' }, `tampered-${fixture.name}`)
    fixture.mutate(candidate)
    const comparison = compareWorkflowRunToSpec(parsed, candidate)
    assert.equal(comparison.matches, false, fixture.name)
    assert.equal(comparison.replicationStatus, 'inconclusive', fixture.name)
    assert.equal(comparison.comparisonVerifiable, false, fixture.name)
    assert.equal(comparison.resultMatch, false, fixture.name)
    assert.equal(
      comparison.reasonCodes.includes('candidate_manifest_integrity_invalid'),
      true,
      fixture.name
    )
    if (fixture.invalidBasis === 'input') assert.equal(comparison.sameInput, false)
    if (fixture.invalidBasis === 'spec') assert.equal(comparison.sameSpec, false)
    if (fixture.invalidBasis === 'context') assert.equal(comparison.sameExecutionContext, false)
  }
})

test('checks every required Evidence output and treats claimed artifact digests as unverified', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const baseline = completedRun(snapshot, { text: 'same' })
  const exported = createWorkflowReproSpec(baseline)
  const withRequiredEvidence = resignSpec({
    ...exported,
    activities: exported.activities.map((activity) => ({
      ...activity,
      outputs: [...activity.outputs, {
        id: 'evidence:required',
        role: 'evidence',
        kind: 'finding',
        required: true,
        contentDigest: `sha256:${'a'.repeat(64)}`,
        baselineDigest: `sha256:${'a'.repeat(64)}`,
        comparator: { kind: 'exact-digest' as const }
      }]
    }))
  })
  const missing = compareWorkflowRunToSpec(
    parseCreateLoopReproSpec(withRequiredEvidence),
    completedRun(snapshot, { text: 'same' }, 'missing-evidence')
  )
  assert.equal(missing.replicationStatus, 'inconclusive')
  assert.equal(missing.comparisonVerifiable, false)
  assert.equal(missing.reasonCodes.includes('required_output_missing'), true)

  const withRequiredArtifact = resignSpec({
    ...exported,
    activities: exported.activities.map((activity) => ({
      ...activity,
      outputs: [...activity.outputs, {
        id: 'artifact:required',
        role: 'artifact',
        kind: 'file',
        locator: '/workspace/result.csv',
        required: true,
        contentDigest: `sha256:${'b'.repeat(64)}`,
        baselineDigest: `sha256:${'b'.repeat(64)}`,
        comparator: { kind: 'exact-digest' as const }
      }]
    }))
  })
  const candidate = completedRun(snapshot, { text: 'same' }, 'claimed-artifact')
  candidate.nodeResults[0]!.artifactRefs = [{
    ref: '/workspace/result.csv',
    kind: 'file',
    digest: `sha256:${'b'.repeat(64)}`
  }]
  candidate.manifest = {
    ...candidate.manifest!,
    artifactRefs: structuredClone(candidate.nodeResults[0]!.artifactRefs)
  }
  const unverified = compareWorkflowRunToSpec(
    parseCreateLoopReproSpec(withRequiredArtifact),
    candidate
  )
  assert.equal(unverified.matches, false)
  assert.equal(unverified.replicationStatus, 'inconclusive')
  assert.equal(unverified.reasonCodes.includes('required_output_unverifiable'), true)
})

test('an unseeded stochastic mismatch is uncontrolled and never a replication failure', () => {
  const workflow = fixtureWorkflow()
  workflow.nodes[1] = {
    id: 'model',
    name: 'Model',
    type: 'llm',
    position: { x: 200, y: 0 },
    disabled: false,
    config: {
      prompt: 'Answer {{text}}',
      model: 'fixture-model',
      maxTokens: 0
    }
  }
  workflow.connections = [
    { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'model', targetHandle: '' },
    { id: 'edge-2', source: 'model', sourceHandle: '', target: 'output', targetHandle: '' }
  ]
  const snapshot = createWorkflowExecutionSnapshot(workflow)
  const baseline = completedRun(snapshot, { text: 'baseline' })
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline))
  const candidate = completedRun(snapshot, { text: 'different' }, 'candidate-run')

  const comparison = compareWorkflowRunToSpec(parsed, candidate)

  assert.equal(parsed.spec.reproducibility, 'uncontrolled')
  assert.equal(
    parsed.spec.breakpoints.some((point) => point.component === 'randomness' && !point.blocking),
    true
  )
  assert.equal(parsed.activity.tools.every((tool) => tool.version === '1.0.0'), true)
  assert.equal(comparison.matches, false)
  assert.equal(comparison.replicationStatus, 'inconclusive')
  assert.equal(comparison.reasonCodes.includes('uncontrolled_mismatch_not_replication_failure'), true)
})

test('a conclusion-targeted spec requires activityId when multiple activities are executable', () => {
  const run = completedRun(createWorkflowExecutionSnapshot(fixtureWorkflow()), { text: 'same' })
  const exported = createWorkflowReproSpec(run)
  const second = structuredClone(exported.activities[0]!)
  second.id = 'workflow-run:second'
  const conclusionSpec = resignSpec({
    ...exported,
    specId: 'conclusion-spec',
    source: {
      ...exported.source,
      conclusionId: 'conclusion-1'
    },
    target: { kind: 'conclusion', id: 'conclusion-1' },
    activities: [...exported.activities, second]
  })

  assert.throws(
    () => parseCreateLoopReproSpec(conclusionSpec),
    /multiple executable activities; provide activityId/
  )
  assert.equal(
    parseCreateLoopReproSpec(conclusionSpec, second.id).activity.id,
    second.id
  )
})

test('an optional discovered artifact without a digest does not override the primary comparator', () => {
  const run = completedRun(createWorkflowExecutionSnapshot(fixtureWorkflow()), { text: 'same' })
  const reference = { ref: '/tmp/result.csv', kind: 'file' as const }
  run.nodeResults[0]!.artifactRefs = [reference]
  run.nodeResults[0]!.attempts.at(-1)!.artifactRefs = [reference]
  run.manifest!.artifactRefs = [reference]

  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(run))
  const comparison = compareWorkflowRunToSpec(parsed, run)

  assert.equal(parsed.spec.reproducibility, 'uncontrolled')
  assert.equal(
    parsed.spec.breakpoints.some((point) => point.code === 'artifact_digest_missing'),
    true
  )
  assert.equal(parsed.activity.outputs.find((output) => output.role === 'artifact')?.required, false)
  assert.equal(comparison.matches, true)
  assert.equal(comparison.replicationStatus, 'matched')
  assert.equal(comparison.reasonCodes.includes('artifact_digest_missing'), true)
  assert.equal(comparison.reasonCodes.includes('required_output_unverifiable'), false)
})

test('numeric comparator is authoritative inside tolerance and fails outside tolerance', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const comparator = { kind: 'numeric' as const, absoluteTolerance: 0.1 }
  const baseline = completedRun(snapshot, 100, 'numeric-baseline')
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline, comparator))

  const within = compareWorkflowRunToSpec(
    parsed,
    withObservedArtifact(completedRun(snapshot, 100.05, 'numeric-within', comparator))
  )
  const outside = compareWorkflowRunToSpec(
    parsed,
    completedRun(snapshot, 100.2, 'numeric-outside', comparator)
  )

  assert.equal(within.matches, true)
  assert.equal(within.replicationStatus, 'matched')
  assert.equal(within.reasonCodes.includes('explicit_comparator_match'), true)
  assert.equal(within.reasonCodes.includes('node_output_changed'), true)
  assert.equal(within.reasonCodes.includes('artifact_reference_changed'), true)
  assert.equal(outside.matches, false)
  assert.equal(outside.replicationStatus, 'failed')
})

test('numeric comparator fails closed for non-numeric and non-finite coercions', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const comparator = { kind: 'numeric' as const, absoluteTolerance: 0.1 }
  const baseline = completedRun(snapshot, 'not-a-number', 'numeric-invalid-baseline')
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline, comparator))

  const comparison = compareWorkflowRunToSpec(
    parsed,
    completedRun(snapshot, 'also-not-a-number', 'numeric-invalid-candidate', comparator)
  )

  assert.equal(comparison.matches, false)
  assert.equal(comparison.replicationStatus, 'inconclusive')
  assert.equal(comparison.comparisonVerifiable, false)
  assert.equal(comparison.resultMatch, false)
  assert.equal(comparison.reasonCodes.includes('explicit_comparator_mismatch'), true)
  assert.equal(comparison.reasonCodes.includes('output_comparison_unverifiable'), true)
})

test('table comparator aligns key columns and compares only declared value columns', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const comparator = {
    kind: 'table' as const,
    keyColumns: ['id'],
    valueColumns: ['value'],
    absoluteTolerance: 0.1
  }
  const baselineOutput = [
    { id: 'a', value: 1, ignored: 'baseline-a' },
    { id: 'b', value: 2, ignored: 'baseline-b' }
  ]
  const baseline = completedRun(snapshot, baselineOutput, 'table-baseline')
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline, comparator))
  const reordered = withObservedArtifact(completedRun(snapshot, [
    { id: 'b', value: 2.05, ignored: 'candidate-b' },
    { id: 'a', value: 1.05, ignored: 'candidate-a' }
  ], 'table-within', comparator))
  const changedKey = completedRun(snapshot, [
    { id: 'c', value: 2.05, ignored: 'candidate-c' },
    { id: 'a', value: 1.05, ignored: 'candidate-a' }
  ], 'table-key-change', comparator)

  const reorderedComparison = compareWorkflowRunToSpec(parsed, reordered)
  assert.equal(reorderedComparison.replicationStatus, 'matched')
  assert.equal(reorderedComparison.reasonCodes.includes('node_output_changed'), true)
  assert.equal(reorderedComparison.reasonCodes.includes('artifact_reference_changed'), true)
  assert.equal(compareWorkflowRunToSpec(parsed, changedKey).replicationStatus, 'failed')
})

test('json structural comparator applies only its explicit numeric tolerances', () => {
  const snapshot = createWorkflowExecutionSnapshot(fixtureWorkflow())
  const comparator = {
    kind: 'json-structural' as const,
    absoluteTolerance: 0.01,
    relativeTolerance: 0
  }
  const baseline = completedRun(snapshot, {
    score: 1,
    nested: { count: 2 }
  }, 'json-baseline')
  const parsed = parseCreateLoopReproSpec(createWorkflowReproSpec(baseline, comparator))
  const within = withObservedArtifact(completedRun(snapshot, {
    score: 1.005,
    nested: { count: 2 }
  }, 'json-within', comparator))
  const outside = completedRun(snapshot, {
    score: 1.02,
    nested: { count: 2 }
  }, 'json-outside', comparator)

  const withinComparison = compareWorkflowRunToSpec(parsed, within)
  assert.equal(withinComparison.replicationStatus, 'matched')
  assert.equal(withinComparison.reasonCodes.includes('node_output_changed'), true)
  assert.equal(withinComparison.reasonCodes.includes('artifact_reference_changed'), true)
  assert.equal(compareWorkflowRunToSpec(parsed, outside).replicationStatus, 'failed')
})

function withObservedArtifact(run: WorkflowRunV1): WorkflowRunV1 {
  const firstNode = run.nodeResults[0]
  if (!firstNode) throw new Error('Fixture run has no node results.')
  const reference = {
    ref: '/workspace/observed-result.json',
    kind: 'file',
    digest: `sha256:${'f'.repeat(64)}`
  } as const
  firstNode.artifactRefs = [reference]
  firstNode.attempts.at(-1)!.artifactRefs = [reference]
  run.manifest!.artifactRefs = [reference]
  return run
}

function completedRun(
  workflow: WorkflowExecutionSnapshotV1,
  output: unknown,
  id = 'baseline-run',
  comparator?: Parameters<typeof createWorkflowRunManifest>[0]['comparator']
): WorkflowRunV1 {
  const nodeResults = workflow.nodes.map((node, index) => nodeResult(node, output, index))
  const context = createWorkflowRunContext(
    workflow,
    '/workspace',
    { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' }
  )
  const manifest = createWorkflowRunManifest({
    source: 'workflow',
    workflow,
    runInput: { prompt: 'fixture' },
    context,
    output,
    nodeResults,
    approvals: [],
    ...(comparator ? { comparator } : {})
  })
  return {
    id,
    trigger: 'manual',
    status: 'success',
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T00:00:01.000Z',
    message: 'done',
    nodeResults,
    manifest
  }
}

function nodeResult(
  node: WorkflowExecutionSnapshotV1['nodes'][number],
  output: unknown,
  attempt: number
): WorkflowNodeRunResultV1 {
  const nodeId = node.id
  const componentFingerprint = workflowFingerprint(node)
  const inputFingerprint = workflowFingerprint({ prompt: 'fixture' })
  const outputFingerprint = workflowFingerprint(output)
  const receipt = {
    status: 'success' as const,
    outcome: 'progress' as const,
    outputFingerprint
  }
  return {
    nodeId,
    status: 'success',
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T00:00:01.000Z',
    message: 'done',
    outputJson: JSON.stringify(output),
    inputJson: JSON.stringify({ prompt: 'fixture' }),
    retries: 0,
    threadId: '',
    error: '',
    componentFingerprint,
    inputFingerprint,
    outputFingerprint,
    attempts: [{
      attempt,
      startedAt: '2026-08-05T00:00:00.000Z',
      finishedAt: '2026-08-05T00:00:01.000Z',
      activityFingerprint: componentFingerprint,
      inputFingerprint,
      receiptFingerprint: workflowFingerprint(receipt),
      receipt,
      artifactRefs: []
    }],
    artifactRefs: []
  }
}

function fixtureWorkflow(): WorkflowV1 {
  const now = '2026-08-05T00:00:00.000Z'
  return {
    id: 'workflow-1',
    name: 'Reproducible workflow',
    enabled: true,
    callableByAgent: true,
    env: [],
    nodes: [
      {
        id: 'trigger',
        name: 'Manual',
        type: 'manual-trigger',
        position: { x: 0, y: 0 },
        disabled: false,
        config: { workspaceRoot: '', inputSchema: [] }
      },
      {
        id: 'template',
        name: 'Template',
        type: 'template',
        position: { x: 200, y: 0 },
        disabled: false,
        config: { template: '{{text}}', outputMode: 'text' }
      },
      {
        id: 'output',
        name: 'Output',
        type: 'output',
        position: { x: 400, y: 0 },
        disabled: false,
        config: { mode: 'auto', textTemplate: '', jsonPath: '' }
      }
    ],
    connections: [
      { id: 'edge-1', source: 'trigger', sourceHandle: '', target: 'template', targetHandle: '' },
      { id: 'edge-2', source: 'template', sourceHandle: '', target: 'output', targetHandle: '' }
    ],
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: []
  }
}

function resignSpec(spec: SciForgeReproSpecV1): SciForgeReproSpecV1 {
  const provisional = sciforgeReproSpecSchema.parse({
    ...spec,
    specDigest: `sha256:${'0'.repeat(64)}`
  })
  return sciforgeReproSpecSchema.parse({
    ...provisional,
    specDigest: `sha256:${createHash('sha256')
      .update(canonicalizeReproSpecForDigest(provisional))
      .digest('hex')}`
  })
}

function tamperExecutorSpec(
  spec: SciForgeReproSpecV1,
  mutate: (
    activity: SciForgeReproSpecV1['activities'][number],
    payload: {
      input: unknown
      context: { workspaceRoot: string }
      baseline: {
        workflowFingerprint: string
        outputJson: string
        specFingerprint: string
      }
    }
  ) => void
): SciForgeReproSpecV1 {
  const tampered = structuredClone(spec)
  const activity = tampered.activities[0]
  if (!activity || activity.executor.kind !== 'create-loop') {
    throw new Error('Fixture executor is missing.')
  }
  const payload = activity.executor.workflow as {
    input: unknown
    context: { workspaceRoot: string }
    baseline: {
      workflowFingerprint: string
      outputJson: string
      specFingerprint: string
    }
  }
  mutate(activity, payload)
  activity.executor.workflowDigest = workflowFingerprint(activity.executor.workflow)
  return resignSpec(tampered)
}

function coherentlyTamperWorkflowSpec(spec: SciForgeReproSpecV1): SciForgeReproSpecV1 {
  const forged = structuredClone(spec)
  const activity = forged.activities[0]
  if (!activity || activity.executor.kind !== 'create-loop') {
    throw new Error('Fixture executor is missing.')
  }
  const payload = activity.executor.workflow as unknown as {
    workflow: WorkflowExecutionSnapshotV1
    input: unknown
    context: unknown
    baseline: {
      workflowFingerprint: string
      inputFingerprint: string
      contextFingerprint: string
      specFingerprint: string
    }
  }
  const template = payload.workflow.nodes.find((node) => node.type === 'template')
  if (!template || template.type !== 'template') throw new Error('Fixture template is missing.')
  template.config.template = 'forged executable source'
  const workflowDigest = workflowFingerprint(payload.workflow)
  const inputDigest = workflowFingerprint(payload.input)
  const contextDigest = workflowFingerprint(payload.context)
  const comparator = activity.outputs.find((output) => output.role === 'primary-output')?.comparator
  if (!comparator) throw new Error('Fixture comparator is missing.')
  const specFingerprint = workflowFingerprint({
    workflowFingerprint: workflowDigest,
    inputFingerprint: inputDigest,
    contextFingerprint: contextDigest,
    approvalRequirements: [],
    comparator
  })
  payload.baseline.workflowFingerprint = workflowDigest
  payload.baseline.inputFingerprint = inputDigest
  payload.baseline.contextFingerprint = contextDigest
  payload.baseline.specFingerprint = specFingerprint
  activity.inputFingerprint = inputDigest
  activity.executionContextFingerprint = contextDigest
  activity.specFingerprint = specFingerprint
  activity.executor.workflowDigest = workflowFingerprint(activity.executor.workflow)
  forged.source.snapshotDigest = workflowFingerprint({ forgedExecutable: activity.executor.workflow })
  return resignSpec(forged)
}
