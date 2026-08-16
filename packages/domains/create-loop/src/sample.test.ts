import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { DomainExecutionEventV1 } from '@sciforge/domain-sdk/reproducibility'

import type { WorkflowV1 } from './contract.js'
import { CreateLoopRuntime, checkWorkflowCode, createLoopStatePath } from './runtime.js'
import { parseWorkflowDsl } from './workflow-dsl.js'
import { defaultWorkflowSettings } from './workflow-settings.js'

const SAMPLE_URL = new URL('../samples/reproducible-dag-v3.loop.json', import.meta.url)

test('complex DAG v3 sample imports as one connected deterministic 14-node DAG', async () => {
  const imported = parseWorkflowDsl(
    await readFile(SAMPLE_URL, 'utf8'),
    '2026-08-06T10:00:00.000Z'
  )
  assert.equal(imported.ok, true)
  if (!imported.ok) return

  const workflow = imported.workflow
  assert.equal(workflow.name, 'DAG v3 复杂可复跑演示')
  assert.equal(workflow.nodes.length, 14)
  assert.equal(workflow.connections.length, 16)
  assert.equal(new Set(workflow.nodes.map((node) => node.id)).size, 14)
  assert.deepEqual(
    workflow.nodes.filter((node) => node.type === 'merge').map((node) => node.id),
    ['demo-comparison-merge']
  )
  assert.deepEqual(
    workflow.connections
      .filter((edge) => edge.source === 'demo-strategy')
      .map((edge) => edge.sourceHandle),
    ['case-0', 'case-1', 'fallback']
  )
  assert.deepEqual(
    workflow.connections
      .filter((edge) => edge.source === 'demo-quality-gate')
      .map((edge) => edge.sourceHandle),
    ['true', 'false']
  )
  assert.equal(
    workflow.connections.find((edge) => edge.id === 'edge-approval-output')?.sourceHandle,
    'approved'
  )

  const reachable = reachableNodeIds(workflow, 'demo-input')
  assert.equal(reachable.size, workflow.nodes.length)
  assert.equal(isAcyclic(workflow), true)

  const externalKinds = new Set(['llm', 'ai-agent', 'generate-image', 'research-search', 'paper-download', 'http-request'])
  assert.equal(workflow.nodes.some((node) => externalKinds.has(node.type)), false)
  for (const node of workflow.nodes) {
    if (node.type !== 'code') continue
    assert.deepEqual(await checkWorkflowCode(node.config.language, node.config.code), { status: 'ok' })
  }

  const source = await readFile(SAMPLE_URL, 'utf8')
  for (const semantic of ['Input', 'Parameter', 'Environment', 'Code', 'Tool', 'Artifact', 'Evidence', 'Approval', 'Conclusion']) {
    assert.match(source, new RegExp(`\\b${semantic}\\b`, 'u'))
  }
  assert.match(source, /evidence:dag-v3-controlled-score/u)
  assert.match(source, /conclusion:dag-v3-controlled-rerun/u)
  assert.match(source, /rel: 'supports'/u)
})

test('complex DAG v3 sample runs offline and an approved rerun matches its baseline', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-create-loop-sample-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const imported = parseWorkflowDsl(
    await readFile(SAMPLE_URL, 'utf8'),
    '2026-08-06T10:00:00.000Z'
  )
  assert.equal(imported.ok, true)
  if (!imported.ok) return

  let sequence = 0
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    createId: () => `complex-sample-${++sequence}`,
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext())
  context.after(() => deactivate())

  const workflow = { ...imported.workflow, enabled: true }
  await runtime.save({
    ...defaultWorkflowSettings(),
    enabled: true,
    defaultWorkspaceRoot: '/deterministic-demo-workspace',
    workflows: [workflow]
  }, 0)

  const input = {
    sampleId: 'controlled-sample-A',
    baselineScore: 100,
    observedScore: 99.96,
    tolerance: 0.1,
    comparisonMode: 'tolerance'
  }
  const first = await runtime.runWorkflow(workflow.id, input)
  assert.equal(first.ok, true)
  const firstApproval = await waitForApproval(runtime)
  assert.equal(
    await runtime.resolveApproval(
      firstApproval.token,
      'approved',
      'demo-reviewer',
      'verified deterministic evidence package'
    ),
    true
  )
  await waitForRun(runtime, workflow.id)

  const firstRun = (await runtime.read()).settings.workflows[0]!.runs[0]!
  assert.equal(firstRun.status, 'success')
  assert.deepEqual(firstRun.nodeResults.map((result) => result.nodeId), [
    'demo-input',
    'demo-parameters',
    'demo-environment',
    'demo-code',
    'demo-strategy',
    'demo-tool-tolerance',
    'demo-comparison-merge',
    'demo-quality-gate',
    'demo-artifact-match',
    'demo-evidence-merge',
    'demo-approval',
    'demo-output'
  ])
  const output = JSON.parse(firstRun.manifest!.outputJson) as {
    comparison: { passed: boolean; delta: number; reasonCode: string }
    artifactUri: string
    evidenceLineage: {
      evidence: Array<{
        id: string
        type?: string
        artifact?: { kind?: string; locator?: string }
      }>
      conclusions: Array<{ id: string }>
      relations: Array<{ src: string; dst: string; rel: string }>
    }
  }
  assert.deepEqual(output.comparison, {
    mode: 'tolerance',
    comparator: 'numeric-absolute-tolerance',
    baseline: 100,
    observed: 99.96,
    delta: 0.04,
    tolerance: 0.1,
    passed: true,
    reasonCode: 'within_tolerance'
  })
  assert.equal(output.artifactUri, 'urn:sciforge:artifact:dag-v3-controlled-report:v2')
  assert.deepEqual(output.evidenceLineage.evidence.map((entry) => entry.id), [
    'evidence:dag-v3-controlled-score',
    'evidence:dag-v3-comparison-match',
    'evidence:dag-v3-controlled-artifact',
    'evidence:dag-v3-environment-lock'
  ])
  assert.deepEqual(output.evidenceLineage.conclusions.map((entry) => entry.id), [
    'conclusion:dag-v3-controlled-rerun',
    'conclusion:dag-v3-evidence-package-complete'
  ])
  assert.equal(output.evidenceLineage.relations.filter((edge) => edge.rel === 'supports').length, 4)
  assert.equal(output.evidenceLineage.relations.some((edge) => edge.rel === 'refines'), true)
  assert.equal(output.evidenceLineage.relations.some((edge) => edge.rel === 'prerequisite'), true)
  assert.equal(
    output.evidenceLineage.relations.filter((edge) => (
      edge.rel === 'generated_by' && edge.dst === '$execution'
    )).length,
    4
  )
  const declaredArtifact = output.evidenceLineage.evidence.find((entry) => entry.type === 'artifact')
  assert.equal(declaredArtifact?.artifact?.kind, 'other')
  assert.equal(
    declaredArtifact?.artifact?.locator,
    'runtime:sciforge.create-loop/dag-v3-controlled-report:v2'
  )
  assert.equal(firstRun.manifest!.artifactRefs.length > 0, true)
  assert.equal(firstRun.manifest!.artifactRefs.every((reference) => Boolean(reference.digest)), true)

  const spec = await runtime.exportReproSpec(workflow.id, firstRun.id)
  assert.equal(spec.executionReady, true)
  assert.equal(spec.reproducibility, 'controlled')
  assert.equal(spec.breakpoints.some((point) => point.blocking), false)

  const rerun = await runtime.runRerun(spec, '/deterministic-demo-workspace')
  assert.equal(rerun.ok, true)
  const rerunApproval = await waitForApproval(runtime)
  assert.notEqual(rerunApproval.token, firstApproval.token)
  assert.equal(
    await runtime.resolveApproval(
      rerunApproval.token,
      'approved',
      'demo-reviewer',
      'verified deterministic evidence package'
    ),
    true
  )
  await waitForRun(runtime, workflow.id)

  const runs = (await runtime.read()).settings.workflows[0]!.runs
  assert.equal(runs.length, 2)
  assert.equal(runs[1]!.status, 'success')
  assert.equal(runs[1]!.manifest!.rerunOfRunId, firstRun.id)
  assert.equal(runs[1]!.manifest!.comparison?.replicationStatus, 'matched')
  assert.equal(runs[1]!.manifest!.comparison?.matches, true)
  assert.equal(runs[1]!.manifest!.comparison?.sameInput, true)
  assert.equal(runs[1]!.manifest!.comparison?.sameSpec, true)
  assert.equal(runs[1]!.manifest!.comparison?.sameExecutionContext, true)
  assert.equal(runs[1]!.manifest!.comparison?.comparisonVerifiable, true)
  assert.equal(runs[1]!.manifest!.comparison?.resultMatch, true)
  assert.deepEqual(
    runs[1]!.manifest!.comparison?.reasonCodes,
    ['all_fingerprints_match'],
    JSON.stringify({
      comparison: runs[1]!.manifest!.comparison,
      baselineOutput: firstRun.nodeResults.filter((result) => result.nodeId === 'demo-output'),
      rerunOutput: runs[1]!.nodeResults.filter((result) => result.nodeId === 'demo-output')
    }, null, 2)
  )
  assert.deepEqual(runs[1]!.manifest!.comparison?.differences, [])

  const deviation = await runtime.runWorkflow(workflow.id, {
    ...input,
    comparisonMode: 'exact'
  })
  assert.equal(deviation.ok, true)
  const deviationApproval = await waitForApproval(runtime)
  assert.equal(
    await runtime.resolveApproval(
      deviationApproval.token,
      'approved',
      'demo-reviewer',
      'verified explainable deviation package'
    ),
    true
  )
  await waitForRun(runtime, workflow.id)
  const deviationRun = (await runtime.read()).settings.workflows[0]!.runs[2]!
  assert.equal(deviationRun.status, 'success')
  assert.equal(deviationRun.nodeResults.some((result) => result.nodeId === 'demo-tool-exact'), true)
  assert.equal(deviationRun.nodeResults.some((result) => result.nodeId === 'demo-tool-tolerance'), false)
  assert.equal(deviationRun.nodeResults.some((result) => result.nodeId === 'demo-artifact-deviation'), true)
  assert.equal(deviationRun.nodeResults.some((result) => result.nodeId === 'demo-artifact-match'), false)
  const deviationOutput = JSON.parse(deviationRun.manifest!.outputJson) as {
    comparison: { passed: boolean; reasonCode: string }
    evidenceLineage: {
      evidence: Array<{ id: string }>
      conclusions: Array<{ id: string }>
      relations: Array<{ src: string; dst: string; rel: string }>
    }
  }
  assert.equal(deviationOutput.comparison.passed, false)
  assert.equal(deviationOutput.comparison.reasonCode, 'exact_value_changed')
  assert.equal(deviationOutput.evidenceLineage.evidence.length, 4)
  assert.deepEqual(deviationOutput.evidenceLineage.conclusions.map((entry) => entry.id), [
    'conclusion:dag-v3-controlled-difference',
    'conclusion:dag-v3-evidence-review-required'
  ])
  assert.equal(deviationOutput.evidenceLineage.relations.some((edge) => edge.rel === 'prerequisite'), true)
  assert.equal(
    deviationOutput.evidenceLineage.relations.filter((edge) => (
      edge.rel === 'generated_by' && edge.dst === '$execution'
    )).length,
    4
  )
})

function reachableNodeIds(workflow: WorkflowV1, root: string): Set<string> {
  const reachable = new Set<string>()
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    for (const edge of workflow.connections) {
      if (edge.source === current) queue.push(edge.target)
    }
  }
  return reachable
}

function isAcyclic(workflow: WorkflowV1): boolean {
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]))
  for (const edge of workflow.connections) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id)
  let visited = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    visited += 1
    for (const edge of workflow.connections.filter((candidate) => candidate.source === current)) {
      const next = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, next)
      if (next === 0) queue.push(edge.target)
    }
  }
  return visited === workflow.nodes.length
}

function runtimeContext(): DomainMainRuntimeLifecycleContext {
  let sequence = 0
  return {
    userDataDir: '/unused',
    appRoot: '/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread',
        runtimeId: 'codex',
        watermark: '0',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => { throw new Error('not used') }
    },
    modelAccess: {
      textReasoner: async () => null
    },
    executionEvents: {
      publish: async (event) => ({
        schemaVersion: 'sciforge.execution-event.v1',
        eventId: event.eventId ?? `sample-event-${++sequence}`,
        producer: {
          moduleId: 'sciforge.create-loop',
          moduleVersion: '1.0.0'
        },
        occurredAt: event.occurredAt ?? '2026-08-06T10:00:00.000Z',
        artifacts: event.artifacts ?? [],
        ...event
      } as DomainExecutionEventV1)
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: () => true,
      subscribe: () => (() => undefined)
    },
    log: () => undefined,
    owner: {
      moduleId: 'sciforge.create-loop',
      moduleVersion: '1.0.0'
    },
    signal: new AbortController().signal
  }
}

async function waitForApproval(runtime: CreateLoopRuntime) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const approval = runtime.status().pendingApprovals[0]
    if (approval) return approval
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Complex sample did not request approval in time.')
}

async function waitForRun(runtime: CreateLoopRuntime, workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Complex sample did not finish in time.')
}
