import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { buildDatasetGenerationLoop } from './dataset-loop-builder.js'
import { CreateLoopRuntime, createLoopStatePath } from './runtime.js'
import { defaultWorkflowSettings } from './workflow-settings.js'

const request = {
  name: 'Grounded TP53 questions',
  objective: 'Create grounded question-answer records about TP53.',
  sourceIds: ['uniprot', 'pjlab-hdd1-ncbi-gene'],
  outputSchema: {
    question: { type: 'string' as const, required: true },
    answer: { type: 'string' as const, required: true },
    evidence: { type: 'array' as const, required: true },
    notes: { type: 'string' as const, required: false }
  },
  quality: {
    criteria: ['Answers must be supported by retrieved evidence.'],
    targetCount: 5,
    maxIterations: 12,
    minQualityScore: 0.8,
    minStrongScore: 0.7,
    maxWeakScore: 0.45,
    minScoreGap: 0.25,
    maxDuplicateFraction: 0
  },
  models: {
    challenger: 'challenger-model',
    weak: 'weak-model',
    strong: 'strong-model',
    judge: 'judge-model'
  },
  output: {
    datasetName: 'tp53-grounded-qa',
    fileName: 'tp53-grounded-qa.jsonl',
    format: 'jsonl' as const
  },
  humanReview: true,
  run: true
}

test('builds editable coordinator and iteration workflows from a dataset requirement', () => {
  const built = buildDatasetGenerationLoop(request, {
    now: '2026-08-04T00:00:00.000Z',
    defaultModel: 'fallback-model'
  })
  assert.match(built.workflow.id, /^dataset-grounded-tp53-questions-/)
  assert.equal(built.iterationWorkflow.id, `${built.workflow.id}-iteration`)
  assert.equal(built.workflow.callableByAgent, true)
  assert.equal(built.workflow.nodes.find((node) => node.id === 'generation-loop')?.type, 'loop')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'grounding-ready')?.type, 'condition')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'normalize-grounding')?.type, 'code')
  assert.equal(
    built.workflow.connections.find((edge) => edge.source === 'grounding-ready' && edge.sourceHandle === 'false')?.target,
    'grounding-failed'
  )
  assert.equal(built.workflow.nodes.find((node) => node.id === 'review')?.type, 'human-approval')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'challenger')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'weak-solver')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'strong-solver')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'judge')?.type, 'llm')

  const grounding = built.workflow.nodes.find((node) => node.id === 'grounding')
  assert.equal(grounding?.type, 'ai-agent')
  if (grounding?.type === 'ai-agent') {
    assert.equal(grounding.config.runtimeId, undefined)
    assert.match(grounding.config.prompt, /pjlab-hdd1-ncbi-gene/)
    assert.match(grounding.config.prompt, /sciforge_discover and sciforge_invoke/)
    assert.match(grounding.config.prompt, /<sciforge-tool-policy allowed="sciforge_discover,sciforge_invoke" \/>/)
    assert.match(grounding.config.prompt, /dataset-api\.metadata/)
    assert.match(grounding.config.prompt, /dataset-api\.raw-data/)
    assert.match(grounding.config.prompt, /Do not use shell, curl/)
    assert.match(grounding.config.prompt, /Calling any other tool invalidates the run/)
    assert.match(grounding.config.prompt, /always set responseMode=summary/)
    assert.match(grounding.config.prompt, /Never request responseMode=full/)
    assert.match(grounding.config.prompt, /always set overwrite=true/)
    assert.match(grounding.config.prompt, /Never use shell or filesystem tools to re-check an artifact path/)
    assert.match(grounding.config.prompt, /immediately return the final JSON and stop calling tools/)
    assert.match(grounding.config.prompt, /do not call dataset-api\.list or dataset-api\.catalog/)
    assert.match(grounding.config.prompt, /Discover each required capability exactly once and invoke it exactly once/)
    assert.match(grounding.config.prompt, /Copy every artifact\.path.*verbatim/)
    assert.match(grounding.config.prompt, /Do not generate candidates in this stage/)
    assert.match(grounding.config.prompt, /Your pretrained knowledge is not evidence/)
    assert.match(grounding.config.prompt, /a pathway hierarchy proves only event containment/)
  }
  for (const nodeId of ['challenger', 'weak-solver', 'strong-solver', 'judge']) {
    const node = built.iterationWorkflow.nodes.find((candidate) => candidate.id === nodeId)
    assert.equal(node?.type, 'llm')
    if (node?.type === 'llm') {
      assert.match(node.config.prompt, /<sciforge-tool-policy allowed="" \/>/)
    }
  }
  const judge = built.iterationWorkflow.nodes.find((node) => node.id === 'judge')
  assert.equal(judge?.type, 'llm')
  if (judge?.type === 'llm') {
    assert.match(judge.config.prompt, /"state":<unchanged>/)
    assert.match(judge.config.prompt, /"verdict":\{"schemaValid":boolean/)
    assert.match(judge.config.prompt, /Audit claim types strictly/)
    assert.match(judge.config.prompt, /every state\.parentArtifacts path/)
    assert.match(judge.config.prompt, /field named path or artifact/)
  }
  const publisher = built.workflow.nodes.find((node) => node.id === 'publish')
  assert.equal(publisher?.type, 'ai-agent')
  if (publisher?.type === 'ai-agent') {
    assert.equal(publisher.config.runtimeId, undefined)
    assert.match(publisher.config.prompt, /dataset-api\.prepare-plan/)
    assert.match(publisher.config.prompt, /dataset-api\.execute-plan/)
    assert.match(publisher.config.prompt, /Never invent an operationRef/)
    assert.match(publisher.config.prompt, /discover exactly dataset-api\.prepare-plan and dataset-api\.execute-plan/)
    assert.match(publisher.config.prompt, /Do not add planId, placeholders, extra parameters/)
    assert.match(publisher.config.prompt, /"objective": "Create grounded question-answer records about TP53\."/)
    assert.match(publisher.config.prompt, /"inputArtifact": "tp53-grounded-qa\.jsonl"/)
    assert.match(publisher.config.prompt, /"outputFileName": "tp53-grounded-qa\.jsonl\.validation\.json"/)
    assert.match(publisher.config.prompt, /"description": "Materialize the accepted generated records with grounding provenance\."/)
    assert.match(publisher.config.prompt, /Do not invoke materialize, validate, or publish directly/)
    assert.match(publisher.config.prompt, /After it returns, never discover or invoke another capability/)
    assert.match(publisher.config.prompt, /<sciforge-tool-policy allowed="sciforge_discover,sciforge_invoke" \/>/)
  }
})

test('is deterministic for the same confirmed requirement and dynamically changes with the schema', () => {
  const left = buildDatasetGenerationLoop(request, { now: '2026-08-04T00:00:00.000Z' })
  const right = buildDatasetGenerationLoop(request, { now: '2026-08-05T00:00:00.000Z' })
  assert.equal(left.workflow.id, right.workflow.id)
  assert.equal(left.specHash, right.specHash)

  const changed = buildDatasetGenerationLoop({
    ...request,
    outputSchema: { ...request.outputSchema, difficulty: { type: 'number' as const } }
  })
  assert.notEqual(changed.workflow.id, left.workflow.id)
  assert.notEqual(changed.specHash, left.specHash)
})

test('omits human approval only when the confirmed requirement disables it', () => {
  const built = buildDatasetGenerationLoop({ ...request, humanReview: false })
  assert.equal(built.workflow.nodes.some((node) => node.type === 'human-approval'), false)
  const readyToPublish = built.workflow.connections.find((edge) => edge.target === 'publish')
  assert.equal(readyToPublish?.source, 'ready')
  assert.equal(readyToPublish?.sourceHandle, 'true')
})

test('rejects an impossible target before creating a workflow', () => {
  assert.throws(() => buildDatasetGenerationLoop({
    ...request,
    quality: { ...request.quality, targetCount: 10, maxIterations: 9 }
  }), /maxIterations must be at least targetCount/)
})

test('runs the generated loop through grounding, generation, evaluation, and publication', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-generated-dataset-loop-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const previousFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = previousFetch })
  let generationRound = 0
  let judgeRound = 0
  let strongCalls = 0
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { input: string }
    const incoming = promptJson(request.input)
    if (request.input.includes('Generate exactly one new candidate')) {
      generationRound += 1
      return jsonResponse({
        state: incoming,
        candidate: {
          question: generationRound === 1
            ? 53
            : generationRound === 2
              ? 'What is TP53?'
              : 'What is the primary function of TP53?',
          answer: 'TP53 encodes a tumor suppressor protein.',
          evidence: generationRound === 2
            ? ['invented-artifact']
            : [{ artifact: '.sciforge/datasets/raw/uniprot/tp53.json', fact: 'TP53 source record' }]
        },
        generation: { reasoningAngle: 'functional annotation' }
      })
    }
    if (request.input.includes('Act as the weak solver')) {
      return jsonResponse({ ...incoming, weak: { answer: 'It regulates cells.', confidence: 0.4 } })
    }
    if (request.input.includes('Act as the strong solver')) {
      strongCalls += 1
      if (generationRound === 3 && strongCalls === 3) {
        return jsonResponse(['uniprot', 'ensembl', 'reactome', 'string'])
      }
      return jsonResponse({ ...incoming, strong: { answer: 'It encodes a tumor suppressor that regulates cell-cycle responses.', confidence: 0.9 } })
    }
    if (request.input.includes('Evaluate the candidate')) {
      judgeRound += 1
      return jsonResponse({
        ...incoming,
        verdict: {
          schemaValid: true,
          grounded: true,
          leakage: false,
          qualityScore: 0.9,
          weakScore: 0.3,
          strongScore: 0.9,
          failureReasons: [],
          revisionInstruction: ''
        }
      })
    }
    throw new Error(`Unexpected model prompt: ${request.input.slice(0, 80)}`)
  }

  const agentPrompts: string[] = []
  const agentRequests: Parameters<
    NonNullable<DomainMainRuntimeLifecycleContext['agentExecution']>['run']
  >[0][] = []
  const runtime = new CreateLoopRuntime({
    statePath: createLoopStatePath(root),
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined
  })
  const deactivate = await runtime.activate(runtimeContext({
    agentExecution: {
      run: async (request) => {
        agentRequests.push(request)
        agentPrompts.push(request.prompt)
        if (request.prompt.includes('grounding stage')) {
          const incoming = promptJson(request.prompt)
          return {
            text: `Grounding completed.\n\n\`\`\`json\n${JSON.stringify({
              ...incoming,
              round: 9,
              acceptedSamples: [{ question: 'premature candidate' }],
              grounding: {
                uniprot: { status: 'ready', records: 1 },
                records: [{ question: 'premature grounding candidate' }],
                candidate: { question: 'another premature candidate' }
              },
              parentArtifacts: ['.sciforge/datasets/raw/uniprot/tp53.json'],
              groundingComplete: true
            })}\n\`\`\``,
            threadId: 'grounding-thread'
          }
        }
        if (request.prompt.includes('final publication stage')) {
          return {
            text: `Publication completed.\n${JSON.stringify({
              loopId: 'generated-loop',
              planId: 'plan-fixture',
              materializedArtifact: { path: 'synthetic.jsonl' },
              validation: { valid: true },
              publication: { path: 'published/synthetic' }
            })}`,
            threadId: 'publication-thread'
          }
        }
        throw new Error('Unexpected agent prompt.')
      }
    },
    modelAccess: {
      textReasoner: async () => ({
        baseUrl: 'http://model-router.test/v1',
        apiKey: '',
        model: 'fixture-model'
      })
    }
  }))
  context.after(deactivate)

  const built = buildDatasetGenerationLoop({
    ...request,
    quality: { ...request.quality, targetCount: 1, maxIterations: 3 },
    humanReview: false
  })
  await runtime.save({
    ...defaultWorkflowSettings(),
    enabled: true,
    workflows: [built.iterationWorkflow, built.workflow]
  }, 0)
  const started = await runtime.runWorkflow(built.workflow.id, built.initialInput, root)
  assert.equal(started.ok, true)
  await waitForRun(runtime, built.workflow.id)

  const saved = await runtime.read()
  const completed = saved.settings.workflows.find((workflow) => workflow.id === built.workflow.id)
  assert.equal(completed?.lastStatus, 'success', completed?.lastMessage)
  const completedRun = completed?.runs.at(-1)
  const output = completedRun?.nodeResults.find((result) => result.nodeId === 'output')
  assert.match(
    output?.outputJson ?? '',
    /published\/synthetic/,
    JSON.stringify(completedRun, null, 2)
  )
  assert.equal(agentPrompts.length, 2)
  assert.equal(agentRequests.every((request) => request.runtimeId === undefined), true)
  assert.equal(generationRound, 3)
  assert.equal(judgeRound, 3)
  assert.equal(strongCalls, 4, 'Malformed solver output must retry without losing the incoming state.')
  assert.match(agentPrompts[0] ?? '', /sciforge_discover and sciforge_invoke/)
  assert.match(agentPrompts[1] ?? '', /dataset-api\.execute-plan/)
  const publicationState = promptJson(agentPrompts[1] ?? '')
  assert.equal(publicationState.round, 3)
  assert.equal(publicationState.rejectedCount, 2)
  assert.deepEqual(publicationState.grounding, { uniprot: { status: 'ready', records: 1 } })
  assert.deepEqual(
    (publicationState.verdicts as Array<{ schemaErrors: { missingArtifactPaths: string[]; unknownArtifactPaths: string[] } }>)[1]?.schemaErrors,
    {
      missingRequired: [],
      invalidTypes: [],
      unexpectedFields: [],
      missingArtifactPaths: ['.sciforge/datasets/raw/uniprot/tp53.json'],
      unknownArtifactPaths: ['invented-artifact']
    }
  )
  assert.deepEqual(publicationState.acceptedSamples, [{
    question: 'What is the primary function of TP53?',
    answer: 'TP53 encodes a tumor suppressor protein.',
    evidence: [{ artifact: '.sciforge/datasets/raw/uniprot/tp53.json', fact: 'TP53 source record' }]
  }])
})

function promptJson(prompt: string): Record<string, unknown> {
  const markers = ['Incoming state:\n', 'Incoming JSON:\n']
  const located = markers
    .map((marker) => ({ marker, index: prompt.lastIndexOf(marker) }))
    .sort((left, right) => right.index - left.index)[0]
  assert.ok(located && located.index >= 0, 'Prompt must contain an incoming JSON marker.')
  return JSON.parse(prompt.slice(located.index + located.marker.length)) as Record<string, unknown>
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify({ output_text: JSON.stringify(value) }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function runtimeContext(
  overrides: Partial<DomainMainRuntimeLifecycleContext> = {}
): DomainMainRuntimeLifecycleContext {
  return {
    userDataDir: '/unused',
    appRoot: '/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({ id: 'thread', runtimeId: 'codex', watermark: '0', turns: [], artifacts: [] }),
      hasActiveTurns: () => false
    },
    capabilities: { invoke: async () => { throw new Error('not used') } },
    modelAccess: { textReasoner: async () => null },
    enablement: { isEnabled: () => true, subscribe: () => (() => undefined) },
    log: () => undefined,
    owner: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    ...overrides
  }
}

async function waitForRun(runtime: CreateLoopRuntime, workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runtime.status().runningWorkflowIds.includes(workflowId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Generated workflow did not complete in time.')
}
