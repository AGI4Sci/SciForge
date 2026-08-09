import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { DomainExecutionEventV1 } from '@sciforge/domain-sdk/reproducibility'
import type { WorkflowV1 } from '../../create-loop/src/contract.js'
import {
  compareWorkflowRunToSpec,
  parseCreateLoopReproSpec,
  workflowFingerprint
} from '../../create-loop/src/rerun.js'
import {
  CreateLoopRuntime,
  createLoopStatePath
} from '../../create-loop/src/runtime.js'
import { defaultWorkflowSettings } from '../../create-loop/src/workflow-settings.js'

function workflow(): WorkflowV1 {
  const now = '2026-08-07T00:00:00.000Z'
  return {
    id: 'workflow:evidence-integration',
    name: 'Evidence integration workflow',
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
        config: { template: 'Topic: {{json.topic}}', outputMode: 'text' }
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
      {
        id: 'edge-1', source: 'trigger', sourceHandle: '',
        target: 'template', targetHandle: ''
      },
      {
        id: 'edge-2', source: 'template', sourceHandle: '',
        target: 'output', targetHandle: ''
      }
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

function publishedEvent(
  event: Parameters<DomainMainRuntimeLifecycleContext['executionEvents']['publish']>[0],
  sequence: number
): DomainExecutionEventV1 {
  return {
    schemaVersion: 'sciforge.execution-event.v1',
    eventId: event.eventId ?? `evidence-integration-event-${sequence}`,
    producer: {
      moduleId: 'sciforge.create-loop',
      moduleVersion: '1.0.0'
    },
    occurredAt: event.occurredAt ?? '2026-08-07T00:00:00.000Z',
    artifacts: event.artifacts ?? [],
    ...event
  } as DomainExecutionEventV1
}

function context(
  published: DomainExecutionEventV1[]
): DomainMainRuntimeLifecycleContext {
  return {
    userDataDir: '/unused',
    appRoot: '/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread', runtimeId: 'codex', watermark: '0', turns: [], artifacts: []
      }),
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => { throw new Error('not used') }
    },
    modelAccess: { textReasoner: async () => null },
    executionEvents: {
      publish: async (event) => {
        const value = publishedEvent(event, published.length + 1)
        published.push(structuredClone(value))
        return value
      }
    },
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

async function waitForRun(
  runtime: CreateLoopRuntime,
  workflowId: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Create Loop integration run did not finish')
}

function manifestArtifact(event: DomainExecutionEventV1): Record<string, unknown> {
  const value = event.artifacts?.find((artifact) => (
    typeof artifact === 'object' && artifact !== null && !Array.isArray(artifact) &&
    'kind' in artifact && artifact.kind === 'sciforge.create-loop.run-manifest'
  ))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Create Loop terminal event omitted its run manifest')
  }
  return value as Record<string, unknown>
}

const root = await mkdtemp(path.join(os.tmpdir(), 'evidence-create-loop-contract-'))
const published: DomainExecutionEventV1[] = []
let sequence = 0
const runtime = new CreateLoopRuntime({
  statePath: createLoopStatePath(root),
  createId: () => `integration-${++sequence}`,
  setInterval: () => ({ timer: true }),
  clearInterval: () => undefined
})
const deactivate = await runtime.activate(context(published))
try {
  const fixture = workflow()
  await runtime.save({
    ...defaultWorkflowSettings(), enabled: true, workflows: [fixture]
  }, 0)
  await runtime.runWorkflow(fixture.id, { topic: 'biology' }, '/workspace')
  await waitForRun(runtime, fixture.id)
  const baselineRun = (await runtime.read()).settings.workflows[0]!.runs[0]!
  const spec = await runtime.exportReproSpec(fixture.id, baselineRun.id)
  await runtime.runRerun(spec, '/workspace')
  await waitForRun(runtime, fixture.id)

  const runs = (await runtime.read()).settings.workflows[0]!.runs
  const candidateRun = runs[1]!
  const terminalEvents = published.filter((event) => event.phase === 'run_completed')
  const baselineEvent = terminalEvents.find((event) => event.runId === baselineRun.id)
  const candidateEvent = terminalEvents.find((event) => event.runId === candidateRun.id)
  if (!baselineEvent || !candidateEvent) {
    throw new Error('Create Loop did not publish both terminal execution events')
  }
  const actualManifest = manifestArtifact(candidateEvent).manifest
  if (typeof actualManifest !== 'object' || actualManifest === null ||
      Array.isArray(actualManifest) || !('comparison' in actualManifest)) {
    throw new Error('Create Loop rerun manifest omitted its real comparison')
  }

  const changedRun = structuredClone(candidateRun)
  if (!changedRun.manifest) throw new Error('candidate manifest missing')
  changedRun.manifest.inputFingerprint = workflowFingerprint({ changed: true })
  const changedComparison = compareWorkflowRunToSpec(
    parseCreateLoopReproSpec(spec), changedRun
  )
  if (changedComparison.sameInput || changedComparison.replicationStatus !== 'inconclusive') {
    throw new Error('Create Loop did not classify the changed input as inconclusive')
  }
  const changedEvent = structuredClone(candidateEvent)
  const changedArtifact = manifestArtifact(changedEvent)
  const changedManifest = changedArtifact.manifest
  if (typeof changedManifest !== 'object' || changedManifest === null ||
      Array.isArray(changedManifest)) {
    throw new Error('changed Create Loop event manifest is invalid')
  }
  changedArtifact.manifest = {
    ...changedManifest,
    inputFingerprint: changedRun.manifest.inputFingerprint,
    comparison: changedComparison
  }

  process.stdout.write(JSON.stringify({
    matched: [baselineEvent, candidateEvent],
    changed: [baselineEvent, changedEvent]
  }))
} finally {
  await deactivate()
  await rm(root, { recursive: true, force: true })
}
