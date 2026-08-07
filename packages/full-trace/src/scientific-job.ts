import { createHash } from 'node:crypto'
import {
  prepareScientificTraceEvent,
  validateScientificTraceClosure,
  validateScientificTraceEvent,
  type ScientificTraceActor,
  type ScientificTraceEvent,
  type ScientificTraceEventInput,
  type ScientificTraceValidationResult
} from './scientific.js'

export type ScientificJobScenario = 'success' | 'blocked' | 'rerun'

export type ScientificJobState =
  | 'submitted'
  | 'running'
  | 'finished'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'resumed'

export type ScientificJobResourceUsage = {
  humanMinutes: number
  gpuHours: number
  apiTokens: number
  storageGb: number
  estimatedUsd: number
}

export type ScientificJobFixtureInput = {
  inputRef: string
  sequenceId: string
  sequence: string
  goal: string
  command: string
  parameters: Record<string, string | number | boolean>
}

export type ScientificJobArtifact = {
  artifactId: string
  path: string
  sha256: string
  content: string
}

export type ScientificJobBaselineTrace = {
  scenario: ScientificJobScenario
  traceId: string
  jobId: string
  state: ScientificJobState
  fixture: ScientificJobFixtureInput
  resourceUsage: ScientificJobResourceUsage
  artifacts: ScientificJobArtifact[]
  events: ScientificTraceEvent[]
  validation: ScientificTraceValidationResult
}

export type ScientificJobBaselineOptions = {
  scenario: ScientificJobScenario
  traceId?: string
  jobId?: string
  scheduler?: string
  reviewerId?: string
  fixture?: Partial<ScientificJobFixtureInput>
  resourceUsage?: Partial<ScientificJobResourceUsage>
}

export type ScientificJobOperationResult = {
  jobId: string
  state: ScientificJobState
}

export type ScientificJobScheduler = {
  submit(jobId: string, fixture: ScientificJobFixtureInput): Promise<ScientificJobState>
  poll(jobId: string): Promise<ScientificJobState>
  cancel(jobId: string, reason: string): Promise<ScientificJobState>
  resume(jobId: string): Promise<ScientificJobState>
  collectResult(jobId: string): Promise<ScientificJobArtifact>
}

export class ScientificJobManager {
  constructor(private readonly scheduler: ScientificJobScheduler) {}

  async submit(jobId: string, fixture: ScientificJobFixtureInput): Promise<ScientificJobOperationResult> {
    return {
      jobId,
      state: await this.scheduler.submit(jobId, fixture)
    }
  }

  async monitor(jobId: string): Promise<ScientificJobOperationResult> {
    return {
      jobId,
      state: await this.scheduler.poll(jobId)
    }
  }

  async cancel(jobId: string, reason: string): Promise<ScientificJobOperationResult> {
    return {
      jobId,
      state: await this.scheduler.cancel(jobId, reason)
    }
  }

  async resume(jobId: string): Promise<ScientificJobOperationResult> {
    return {
      jobId,
      state: await this.scheduler.resume(jobId)
    }
  }

  async collectResult(jobId: string): Promise<ScientificJobArtifact> {
    return this.scheduler.collectResult(jobId)
  }
}

export class LocalScientificFixtureScheduler implements ScientificJobScheduler {
  private readonly states = new Map<string, ScientificJobState>()

  async submit(jobId: string, _fixture: ScientificJobFixtureInput): Promise<ScientificJobState> {
    this.states.set(jobId, 'submitted')
    return 'submitted'
  }

  async poll(jobId: string): Promise<ScientificJobState> {
    const current = this.states.get(jobId)
    if (current === 'submitted' || !current) {
      this.states.set(jobId, 'running')
      return 'running'
    }
    return current
  }

  async cancel(jobId: string, _reason: string): Promise<ScientificJobState> {
    this.states.set(jobId, 'cancelled')
    return 'cancelled'
  }

  async resume(jobId: string): Promise<ScientificJobState> {
    this.states.set(jobId, 'resumed')
    return 'resumed'
  }

  async collectResult(jobId: string): Promise<ScientificJobArtifact> {
    const content = `fixture-result:${jobId}`
    return {
      artifactId: `artifact-${jobId}-result`,
      path: `artifacts/${jobId}/result.txt`,
      sha256: sha256(content),
      content
    }
  }
}

export function createScientificJobBaselineTrace(
  options: ScientificJobBaselineOptions
): ScientificJobBaselineTrace {
  const traceId = options.traceId ?? `trace-06b-${options.scenario}`
  const jobId = options.jobId ?? `job-06b-${options.scenario}`
  const scheduler = options.scheduler ?? 'local-fixture'
  const reviewerId = options.reviewerId ?? 'reviewer-scientist'
  const fixture = createFixture(options.fixture)
  const resourceUsage = createResourceUsage(options.resourceUsage)
  const artifacts = createScenarioArtifacts(options.scenario, jobId, fixture)
  const events = createScenarioEvents({
    scenario: options.scenario,
    traceId,
    jobId,
    scheduler,
    reviewerId,
    fixture,
    resourceUsage,
    artifacts
  })
  const validation = validateScientificTraceClosure(events)

  return {
    scenario: options.scenario,
    traceId,
    jobId,
    state: stateForScenario(options.scenario),
    fixture,
    resourceUsage,
    artifacts,
    events,
    validation
  }
}

export function createScientificJobBaselineJsonl(
  options: ScientificJobBaselineOptions
): string {
  return createScientificJobBaselineTrace(options)
    .events
    .map((event) => JSON.stringify(event))
    .join('\n')
}

export function validateScientificJobBaselineTrace(
  trace: Pick<ScientificJobBaselineTrace, 'events'>
): ScientificTraceValidationResult {
  const eventIssues = trace.events.flatMap((event) => validateScientificTraceEvent(event).issues)
  const closure = validateScientificTraceClosure(trace.events)
  return {
    ok: !eventIssues.some((issue) => issue.severity === 'error') && closure.ok,
    issues: [...eventIssues, ...closure.issues]
  }
}

type ScenarioEventOptions = {
  scenario: ScientificJobScenario
  traceId: string
  jobId: string
  scheduler: string
  reviewerId: string
  fixture: ScientificJobFixtureInput
  resourceUsage: ScientificJobResourceUsage
  artifacts: ScientificJobArtifact[]
}

function createScenarioEvents(options: ScenarioEventOptions): ScientificTraceEvent[] {
  const events: ScientificTraceEventInput[] = []
  const input = eventId(options.jobId, 'input')
  const plan = eventId(options.jobId, 'plan')
  const submitted = eventId(options.jobId, 'submitted')
  const started = eventId(options.jobId, 'started')
  const monitored = eventId(options.jobId, 'monitored')
  const initialAttempt = options.scenario === 'rerun' ? 1 : 0

  events.push(
    baseEvent(options, {
      eventId: input,
      type: 'USER_INPUT',
      actor: { type: 'human', id: 'researcher' },
      payload: {
        text: options.fixture.goal,
        inputRef: options.fixture.inputRef,
        sequenceId: options.fixture.sequenceId
      },
      links: { inputs: [options.fixture.inputRef] }
    }),
    baseEvent(options, {
      eventId: plan,
      type: 'AGENT_ACTION',
      parentEventId: input,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        action: 'prepare_scientific_compute_job',
        command: options.fixture.command,
        parameters: options.fixture.parameters
      }
    }),
    baseEvent(options, {
      eventId: submitted,
      type: 'JOB_SUBMITTED',
      parentEventId: plan,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        scheduler: options.scheduler,
        queue: 'local-fixture',
        resources: {
          cpuCores: 1,
          gpuCount: 0,
          walltimeSeconds: 30
        }
      }
    }),
    baseEvent(options, {
      eventId: started,
      type: 'JOB_STARTED',
      parentEventId: submitted,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        attempt: initialAttempt,
        status: 'running'
      }
    }),
    monitorEvent(options, monitored, started, {
      attempt: initialAttempt,
      status: 'running'
    })
  )

  if (options.scenario === 'success') {
    appendFinishedAttempt(events, options, monitored, { attempt: 0 })
    return prepareScenarioEvents(events)
  }

  const failed = eventId(options.jobId, 'failed')
  const cancelled = eventId(options.jobId, 'cancelled')
  events.push(
    baseEvent(options, {
      eventId: failed,
      type: 'JOB_FAILED',
      parentEventId: monitored,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        attempt: initialAttempt,
        status: 'blocked',
        failureMode: 'missing-input-artifact',
        retryable: true,
        message: 'The fixture intentionally blocks because a required input artifact is unavailable.'
      }
    }),
    baseEvent(options, {
      eventId: cancelled,
      type: 'JOB_CANCELLED',
      parentEventId: failed,
      actor: { type: 'human', id: options.reviewerId },
      payload: {
        jobId: options.jobId,
        reason: 'Researcher paused the run after confirming the missing input artifact.'
      }
    })
  )

  if (options.scenario === 'blocked') {
    appendDiagnosticClosure(events, options, cancelled)
    return prepareScenarioEvents(events)
  }

  const resumed = eventId(options.jobId, 'resumed')
  const rerunStarted = eventId(options.jobId, 'rerun-started')
  const rerunMonitored = eventId(options.jobId, 'rerun-monitored')
  events.push(
    baseEvent(options, {
      eventId: resumed,
      type: 'JOB_RESUMED',
      parentEventId: cancelled,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        resumedFromAttempt: 1,
        reason: 'The missing input artifact was replaced by the deterministic fixture input.'
      },
      links: {
        inputs: [options.fixture.inputRef],
        relatedEvents: [failed, cancelled]
      }
    }),
    baseEvent(options, {
      eventId: rerunStarted,
      type: 'JOB_STARTED',
      parentEventId: resumed,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        attempt: 2,
        status: 'running'
      }
    }),
    monitorEvent(options, rerunMonitored, rerunStarted, {
      attempt: 2,
      status: 'running'
    })
  )
  appendFinishedAttempt(events, options, rerunMonitored, {
    attempt: 2,
    relatedEvents: [failed, cancelled, resumed]
  })
  return prepareScenarioEvents(events)
}

function appendFinishedAttempt(
  events: ScientificTraceEventInput[],
  options: ScenarioEventOptions,
  parentEventId: string,
  metadata: {
    attempt: number
    relatedEvents?: string[]
  }
): void {
  const finished = eventId(options.jobId, metadata.attempt === 0 ? 'finished' : `finished-${metadata.attempt}`)
  const artifact = options.artifacts[0] as ScientificJobArtifact
  const artifactEvent = eventId(options.jobId, metadata.attempt === 0 ? 'artifact' : `artifact-${metadata.attempt}`)
  const evidence = eventId(options.jobId, metadata.attempt === 0 ? 'evidence' : `evidence-${metadata.attempt}`)
  const usage = eventId(options.jobId, metadata.attempt === 0 ? 'usage' : `usage-${metadata.attempt}`)
  const review = eventId(options.jobId, metadata.attempt === 0 ? 'review' : `review-${metadata.attempt}`)

  events.push(
    baseEvent(options, {
      eventId: finished,
      type: 'JOB_FINISHED',
      parentEventId,
      actor: { type: 'scheduler', id: options.scheduler },
      payload: {
        jobId: options.jobId,
        attempt: metadata.attempt,
        status: 'finished',
        resultPath: artifact.path
      },
      links: {
        artifacts: [`artifact://${artifact.artifactId}`],
        ...(metadata.relatedEvents ? { relatedEvents: metadata.relatedEvents } : {})
      }
    }),
    baseEvent(options, {
      eventId: artifactEvent,
      type: 'ARTIFACT_CREATED',
      parentEventId: finished,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        artifactId: artifact.artifactId,
        path: artifact.path,
        sha256: artifact.sha256,
        mediaType: 'text/plain',
        role: 'scientific-compute-result'
      },
      links: { artifacts: [`artifact://${artifact.artifactId}`] }
    }),
    baseEvent(options, {
      eventId: evidence,
      type: 'EVIDENCE_ATTACHED',
      parentEventId: artifactEvent,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        evidenceId: `evidence-${artifact.artifactId}`,
        evidenceType: 'result-hash-and-fixture-validation',
        target: artifactEvent,
        validationSummary: 'The local fixture output hash matches the deterministic baseline.'
      },
      links: {
        artifacts: [`artifact://${artifact.artifactId}`],
        evidence: [`evidence://${artifact.artifactId}/hash-validation`]
      }
    }),
    resourceUsageEvent(options, usage, evidence),
    humanReviewEvent(options, review, evidence, {
      decision: 'accepted',
      reason: 'The fixture run completed, result hash is stable, and zero-cost resource usage is recorded.'
    })
  )
}

function appendDiagnosticClosure(
  events: ScientificTraceEventInput[],
  options: ScenarioEventOptions,
  parentEventId: string
): void {
  const artifact = options.artifacts[0] as ScientificJobArtifact
  const artifactEvent = eventId(options.jobId, 'blocked-artifact')
  const evidence = eventId(options.jobId, 'blocked-evidence')
  const usage = eventId(options.jobId, 'blocked-usage')
  const review = eventId(options.jobId, 'blocked-review')

  events.push(
    baseEvent(options, {
      eventId: artifactEvent,
      type: 'ARTIFACT_CREATED',
      parentEventId,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        artifactId: artifact.artifactId,
        path: artifact.path,
        sha256: artifact.sha256,
        mediaType: 'text/markdown',
        role: 'blocked-run-diagnostic'
      },
      links: { artifacts: [`artifact://${artifact.artifactId}`] }
    }),
    baseEvent(options, {
      eventId: evidence,
      type: 'EVIDENCE_ATTACHED',
      parentEventId: artifactEvent,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        evidenceId: `evidence-${artifact.artifactId}`,
        evidenceType: 'blocked-run-diagnostic',
        target: artifactEvent,
        validationSummary: 'The run was intentionally blocked and converted into a diagnostic baseline.'
      },
      links: {
        artifacts: [`artifact://${artifact.artifactId}`],
        evidence: [`evidence://${artifact.artifactId}/blocked-diagnostic`]
      }
    }),
    resourceUsageEvent(options, usage, evidence),
    humanReviewEvent(options, review, evidence, {
      decision: 'blocked',
      reason: 'The blocked run is accepted as a baseline because the cause and cancellation are recorded.'
    })
  )
}

function resourceUsageEvent(
  options: ScenarioEventOptions,
  eventIdValue: string,
  parentEventId: string
): ScientificTraceEventInput {
  return baseEvent(options, {
    eventId: eventIdValue,
    type: 'RESOURCE_USAGE_RECORDED',
    parentEventId,
    actor: { type: 'system', id: 'resource-accounting' },
    payload: {
      jobId: options.jobId,
      ...options.resourceUsage,
      costPolicy: 'local fixture, no external API or GPU spend'
    }
  })
}

function monitorEvent(
  options: ScenarioEventOptions,
  eventIdValue: string,
  parentEventId: string,
  payload: {
    attempt: number
    status: 'running'
  }
): ScientificTraceEventInput {
  return baseEvent(options, {
    eventId: eventIdValue,
    type: 'TOOL_CALL_COMPLETED',
    parentEventId,
    actor: { type: 'scheduler', id: options.scheduler },
    payload: {
      toolName: 'scheduler.poll',
      jobId: options.jobId,
      attempt: payload.attempt,
      status: payload.status,
      observedState: payload.status
    }
  })
}

function humanReviewEvent(
  options: ScenarioEventOptions,
  eventIdValue: string,
  parentEventId: string,
  payload: {
    decision: string
    reason: string
  }
): ScientificTraceEventInput {
  return baseEvent(options, {
    eventId: eventIdValue,
    type: 'HUMAN_REVIEW_RECORDED',
    parentEventId,
    actor: { type: 'human', id: options.reviewerId },
    payload: {
      reviewerId: options.reviewerId,
      scientificAcceptance: payload.decision,
      reason: payload.reason
    },
    links: { reviews: [`review://${options.reviewerId}/${options.jobId}`] }
  })
}

function baseEvent(
  options: ScenarioEventOptions,
  input: Omit<ScientificTraceEventInput, 'traceId' | 'source'>
): ScientificTraceEventInput {
  return {
    ...input,
    traceId: options.traceId,
    actor: input.actor ?? defaultActorFor(input.type),
    source: {
      module: 'scientific-job-manager',
      provider: options.scheduler,
      runtimeId: 'local-fixture-runtime',
      jobId: options.jobId,
      idempotencyKey: `${options.traceId}:${input.eventId ?? input.type}`
    }
  }
}

function prepareScenarioEvents(events: readonly ScientificTraceEventInput[]): ScientificTraceEvent[] {
  return events.map((event, index) => prepareScientificTraceEvent({
    ...event,
    timestamp: timestampForIndex(index)
  }))
}

function createFixture(input: Partial<ScientificJobFixtureInput> | undefined): ScientificJobFixtureInput {
  const defaultParameters = {
    model: 'local-baseline',
    maxIterations: 2,
    deterministic: true
  }
  return {
    inputRef: 'input://fixtures/protein-mini.fa',
    sequenceId: 'protein-mini',
    sequence: 'MTEYKLVVVG',
    goal: 'Run a deterministic low-cost protein mini fixture and preserve a reproducible compute trace.',
    command: 'sciforge-fixture protein-mini --mode deterministic',
    ...input,
    parameters: {
      ...defaultParameters,
      ...(input?.parameters ?? {})
    }
  }
}

function createResourceUsage(input: Partial<ScientificJobResourceUsage> | undefined): ScientificJobResourceUsage {
  return {
    humanMinutes: 5,
    gpuHours: 0,
    apiTokens: 0,
    storageGb: 0.001,
    estimatedUsd: 0,
    ...input
  }
}

function createScenarioArtifacts(
  scenario: ScientificJobScenario,
  jobId: string,
  fixture: ScientificJobFixtureInput
): ScientificJobArtifact[] {
  const content = scenario === 'blocked'
    ? `# Blocked fixture diagnostic\n\njob=${jobId}\nmissing=input-artifact\nsequence=${fixture.sequenceId}\n`
    : `job=${jobId}\nsequence=${fixture.sequenceId}\nresult=${pseudoFoldScore(fixture.sequence)}\n`
  const suffix = scenario === 'blocked' ? 'blocked-diagnostic.md' : 'result.txt'
  return [{
    artifactId: `artifact-${jobId}-${scenario}`,
    path: `artifacts/${jobId}/${suffix}`,
    sha256: sha256(content),
    content
  }]
}

function stateForScenario(scenario: ScientificJobScenario): ScientificJobState {
  if (scenario === 'success' || scenario === 'rerun') return 'finished'
  return 'blocked'
}

function eventId(jobId: string, name: string): string {
  return `${jobId}-${name}`
}

function timestampForIndex(index: number): string {
  return new Date(Date.UTC(2026, 7, 7, 0, 0, index * 10)).toISOString()
}

function defaultActorFor(type: ScientificTraceEventInput['type']): ScientificTraceActor {
  if (type.startsWith('JOB_')) return { type: 'scheduler', id: 'local-fixture' }
  if (type.startsWith('HUMAN_REVIEW')) return { type: 'human', id: 'reviewer-scientist' }
  return { type: 'agent', id: 'codex-runtime' }
}

function pseudoFoldScore(sequence: string): string {
  const score = (hashInteger(sequence) % 10000) / 100
  return score.toFixed(2)
}

function hashInteger(value: string): number {
  return createHash('sha256')
    .update(value)
    .digest()
    .subarray(0, 4)
    .readUInt32BE(0)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
