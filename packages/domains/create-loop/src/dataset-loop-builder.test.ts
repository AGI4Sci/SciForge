import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { createDatasetWorkflowExecutionReceiptProvider } from '@sciforge/domain-dataset-api/receipt-provider'
import { buildDatasetGenerationLoop } from './dataset-loop-builder.js'
import {
  CreateLoopRuntime,
  createLoopStatePath
} from './runtime.js'
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
    minRubricCoverage: 0.8,
    minQuestionQuality: 0.75,
    maxDuplicateFraction: 0
  },
  models: {
    designer: 'designer-model',
    challenger: 'challenger-model',
    weak: 'weak-model',
    strong: 'strong-model',
    judge: 'judge-model',
    verifier: 'verifier-model',
    strategist: 'strategist-model'
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
  assert.equal(built.workflow.nodes.find((node) => node.id === 'design')?.type, 'llm')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'grounding-ready')?.type, 'condition')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'normalize-acquisition')?.type, 'code')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'preparation')?.type, 'ai-agent')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'normalize-grounding')?.type, 'code')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'validate-publication')?.type, 'code')
  assert.equal(
    built.workflow.connections.find((edge) => edge.source === 'grounding-ready' && edge.sourceHandle === 'false')?.target,
    'grounding-failed'
  )
  assert.equal(built.workflow.nodes.find((node) => node.id === 'review')?.type, 'human-approval')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'challenger')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'challenger-context')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'judge-context')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'verifier-context')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'strategy-context')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'preflight')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'weak-solver')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'strong-solver-context')?.type, 'code')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'strong-solver')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'judge')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'verifier')?.type, 'llm')
  assert.equal(built.iterationWorkflow.nodes.find((node) => node.id === 'strategy-learner')?.type, 'llm')
  const preflightNode = built.iterationWorkflow.nodes.find((node) => node.id === 'preflight')
  const updateStateNode = built.iterationWorkflow.nodes.find((node) => node.id === 'update-state')
  assert.equal(preflightNode?.type, 'code')
  assert.equal(updateStateNode?.type, 'code')
  if (preflightNode?.type === 'code') {
    assert.match(preflightNode.config.code, /sourceCoverageBlocked/)
    assert.match(preflightNode.config.code, /typeof value === 'string' && !value\.trim\(\)/)
  }
  for (const nodeId of ['challenger-context', 'judge-context', 'verifier-context', 'strategy-context']) {
    const contextNode = built.iterationWorkflow.nodes.find((node) => node.id === nodeId)
    assert.equal(contextNode?.type, 'code')
    if (contextNode?.type !== 'code') continue
    assert.match(contextNode.config.code, /preparationExecution: bounded\(state\.preparationExecution\)/)
    assert.match(contextNode.config.code, /preparationArtifacts: bounded\(state\.preparationArtifacts\)/)
    assert.match(contextNode.config.code, /value\.slice\(0, 8\)/)
  }
  if (updateStateNode?.type === 'code') {
    assert.match(updateStateNode.config.code, /does not advance required source coverage/)
    assert.match(updateStateNode.config.code, /verifierFailedRubricItems\.length === 0/)
  }

  const designer = built.workflow.nodes.find((node) => node.id === 'design')
  assert.equal(designer?.type, 'llm')
  if (designer?.type === 'llm') {
    assert.equal(designer.config.model, '')
    assert.match(designer.config.prompt, /Design the schema, task rubric, data preparation recipe/)
    assert.match(designer.config.prompt, /exact-key join/)
    assert.match(designer.config.prompt, /never use object-metadata for a public source/)
    assert.match(designer.config.prompt, /Do not invent endpoint-specific source field names/)
    assert.match(designer.config.prompt, /required question and answer string fields/)
    assert.match(designer.config.prompt, /Fields that apply only to one source or record type must be optional/)
    assert.match(designer.config.prompt, /will actually be executed before candidate generation/)
    assert.match(designer.config.prompt, /structure-profile or structure-validate only for SDF or mmCIF/)
    assert.match(designer.config.prompt, /processingRecipe/)
    assert.match(designer.config.prompt, /generationRecipe/)
    assert.match(designer.config.prompt, /strict JSON object only, without Markdown fences/)
    assert.match(designer.config.prompt, /must not contain literal double-quote characters/)
    assert.match(designer.config.prompt, /do not emit nested JSON Schema keywords/)
  }
  const publicationGate = built.workflow.nodes.find((node) => node.id === 'validate-publication')
  assert.equal(publicationGate?.type, 'code')
  if (publicationGate?.type === 'code') {
    assert.match(publicationGate.config.code, /Dataset publication receipt is not successful/)
    assert.match(publicationGate.config.code, /publicationComplete: true/)
  }

  const grounding = built.workflow.nodes.find((node) => node.id === 'grounding-1')
  assert.equal(grounding?.type, 'ai-agent')
  assert.equal(built.workflow.nodes.find((node) => node.id === 'grounding-2')?.type, 'ai-agent')
  if (grounding?.type === 'ai-agent') {
    assert.equal(grounding.config.runtimeId, undefined)
    assert.deepEqual(grounding.config.allowedTools, ['sciforge_discover', 'sciforge_invoke'])
    assert.match(grounding.config.prompt, /pjlab-hdd1-ncbi-gene/)
    assert.match(grounding.config.prompt, /sciforge_discover and sciforge_invoke/)
    assert.doesNotMatch(grounding.config.prompt, /sciforge-tool-policy/)
    assert.match(grounding.config.prompt, /dataset-api\.metadata/)
    assert.match(grounding.config.prompt, /dataset-api\.raw-data/)
    assert.match(grounding.config.prompt, /Do not use shell, curl/)
    assert.match(grounding.config.prompt, /always set responseMode=summary/)
    assert.match(grounding.config.prompt, /Never request responseMode=full/)
    assert.match(grounding.config.prompt, /always set overwrite=true/)
    assert.match(grounding.config.prompt, /Never use shell or filesystem tools to re-check an artifact path/)
    assert.match(grounding.config.prompt, /immediately return the final JSON and stop calling tools/)
    assert.match(grounding.config.prompt, /final JSON is an assistant response, never a tool input/)
    assert.match(grounding.config.prompt, /First discover dataset-api\.list exactly once and invoke it exactly once/)
    assert.match(grounding.config.prompt, /copy the matching usageExamplesBySource metadata or rawData request/)
    assert.match(grounding.config.prompt, /preserving parameter names, value types, and expectedFormat/)
    assert.match(grounding.config.prompt, /Never retry a failed source by guessing alternate parameters or formats/)
    assert.match(grounding.config.prompt, /Copy every artifact\.path.*verbatim/)
    assert.match(grounding.config.prompt, /Do not generate candidates in this stage/)
    assert.match(grounding.config.prompt, /Your pretrained knowledge is not evidence/)
    assert.match(grounding.config.prompt, /exact recordSamples/)
    assert.match(grounding.config.prompt, /a pathway hierarchy proves only event containment/)
    assert.match(grounding.config.prompt, /acquisitionComplete/)
    assert.match(grounding.config.prompt, /assigned exactly one source/)
    assert.match(grounding.config.prompt, /Do not access, rediscover, summarize, or modify any other source/)
  }
  const preparation = built.workflow.nodes.find((node) => node.id === 'preparation')
  assert.equal(preparation?.type, 'ai-agent')
  if (preparation?.type === 'ai-agent') {
    assert.equal(preparation.config.model, 'challenger-model')
    assert.equal(preparation.retries, 2)
    assert.match(preparation.config.prompt, /Execute the designed processingRecipe instead of merely describing it/)
    assert.deepEqual(preparation.config.allowedTools, ['sciforge_discover', 'sciforge_invoke'])
    assert.match(preparation.config.prompt, /plus dataset-api\.prepare-plan, dataset-api\.confirm-plan, and dataset-api\.execute-plan exactly once each/)
    assert.match(preparation.config.prompt, /requires the Host's real user-confirmation approval/)
    assert.match(preparation.config.prompt, /Discover every distinct plan-gated capability/)
    assert.match(preparation.config.prompt, /inputArtifact, conditions as an array/)
    assert.match(preparation.config.prompt, /leftRecordPath and\/or rightRecordPath/)
    assert.match(preparation.config.prompt, /never name TSV bytes with a \.json extension/)
    assert.match(preparation.config.prompt, /acquisition receipt and artifact path override/)
    assert.match(preparation.config.prompt, /outputRecords=0 is a failed preparation outcome/)
    assert.match(preparation.config.prompt, /Never replace these schema fields with informal keys/)
    assert.match(preparation.config.prompt, /Include every plan-gated recipe step/)
    assert.match(preparation.config.prompt, /preparationExecution/)
  }
  const design = built.workflow.nodes.find((node) => node.id === 'design')
  assert.equal(design?.type, 'llm')
  if (design?.type === 'llm') {
    assert.match(design.config.prompt, /Candidate evidence values are artifact paths only/)
    assert.match(design.config.prompt, /hashes belong to the run report/)
  }
  for (const nodeId of ['challenger', 'weak-solver', 'strong-solver', 'judge']) {
    const node = built.iterationWorkflow.nodes.find((candidate) => candidate.id === nodeId)
    assert.equal(node?.type, 'llm')
    if (node?.type === 'llm') {
      assert.doesNotMatch(node.config.prompt, /sciforge-tool-policy/)
    }
  }
  const weakSolver = built.iterationWorkflow.nodes.find((candidate) => candidate.id === 'weak-solver')
  assert.equal(weakSolver?.type, 'llm')
  if (weakSolver?.type === 'llm') {
    assert.match(weakSolver.config.prompt, /Solve independently from the question alone/)
    assert.match(weakSolver.config.prompt, /withholds the candidate reference answer/)
    assert.match(weakSolver.config.prompt, /\{\{json\.candidate\.question\}\}/)
    assert.doesNotMatch(weakSolver.config.prompt, /\{\{text\}\}/)
  }
  const strongSolverContext = built.iterationWorkflow.nodes.find((candidate) => candidate.id === 'strong-solver-context')
  assert.equal(strongSolverContext?.type, 'code')
  if (strongSolverContext?.type === 'code') {
    assert.match(strongSolverContext.config.code, /preparationExecution: bounded\(state\.preparationExecution\)/)
    assert.match(strongSolverContext.config.code, /taskRubric: bounded\(state\.rubric\)/)
    assert.match(strongSolverContext.config.code, /value\.slice\(0, 8\)/)
    assert.match(strongSolverContext.config.code, /strongSolverContext/)
    assert.doesNotMatch(strongSolverContext.config.code, /candidate\.answer/)
  }
  const strongSolver = built.iterationWorkflow.nodes.find((candidate) => candidate.id === 'strong-solver')
  assert.equal(strongSolver?.type, 'llm')
  if (strongSolver?.type === 'llm') {
    assert.match(strongSolver.config.prompt, /evidence-bounded context/i)
    assert.match(strongSolver.config.prompt, /Satisfy every applicable item in taskRubric/)
    assert.match(strongSolver.config.prompt, /withholds the candidate reference answer/)
    assert.match(strongSolver.config.prompt, /\{\{json\.strongSolverContext\}\}/)
    assert.doesNotMatch(strongSolver.config.prompt, /\{\{json\.candidate\.question\}\}/)
    assert.doesNotMatch(strongSolver.config.prompt, /\{\{text\}\}/)
  }
  const verifier = built.iterationWorkflow.nodes.find((node) => node.id === 'verifier')
  assert.equal(verifier?.type, 'llm')
  if (verifier?.type === 'llm') {
    assert.equal(verifier.config.model, '', 'Direct Model Router calls must use its negotiated public alias.')
    assert.match(verifier.config.prompt, /independent task verifier/)
    assert.match(verifier.config.prompt, /rubricCoverage/)
    assert.match(verifier.config.prompt, /answer leakage/)
    assert.match(verifier.config.prompt, /one candidate per round/i)
    assert.match(verifier.config.prompt, /one source record/i)
    assert.match(verifier.config.prompt, /valid auditable join/i)
  }
  const strategist = built.iterationWorkflow.nodes.find((node) => node.id === 'strategy-learner')
  assert.equal(strategist?.type, 'llm')
  if (strategist?.type === 'llm') {
    assert.equal(strategist.config.model, '', 'Direct Model Router calls must use its negotiated public alias.')
    assert.match(strategist.config.prompt, /complete failure trajectory/)
    assert.match(strategist.config.prompt, /Never propose an array, batch, or multiple records/i)
    assert.match(strategist.config.prompt, /current deterministic preflight/)
    assert.match(strategist.config.prompt, /preflight\.uncoveredSources/)
    assert.match(strategist.config.prompt, /revisedRecipe/)
    assert.match(strategist.config.prompt, /Never switch from a required processed artifact to a raw artifact/)
    assert.match(strategist.config.prompt, /do not prescribe or fabricate Weak\/Strong Solver answers/)
  }
  const judge = built.iterationWorkflow.nodes.find((node) => node.id === 'judge')
  assert.equal(judge?.type, 'llm')
  if (judge?.type === 'llm') {
    assert.match(judge.config.prompt, /Model context:\n\{\{json\.judgeContext\}\}/)
    assert.match(judge.config.prompt, /"verdict":\{"schemaValid":boolean/)
    assert.match(judge.config.prompt, /Audit claim types strictly/)
    assert.match(judge.config.prompt, /canonical labels must match verbatim/i)
    assert.match(judge.config.prompt, /at least one exact path from state\.parentArtifacts/)
    assert.match(judge.config.prompt, /field named path or artifact/)
  }
  const challenger = built.iterationWorkflow.nodes.find((node) => node.id === 'challenger')
  assert.equal(challenger?.type, 'llm')
  if (challenger?.type === 'llm') {
    assert.match(challenger.config.prompt, /canonical source labels verbatim/i)
    assert.match(challenger.config.prompt, /answerable uniquely from the evidence-bounded recordSamples/)
    assert.match(challenger.config.prompt, /must explicitly request every source-side component/)
  }
  const publisher = built.workflow.nodes.find((node) => node.id === 'publish')
  assert.equal(publisher?.type, 'ai-agent')
  if (publisher?.type === 'ai-agent') {
    assert.equal(publisher.config.runtimeId, undefined)
    assert.deepEqual(publisher.config.allowedTools, ['sciforge_discover', 'sciforge_invoke'])
    assert.match(publisher.config.prompt, /dataset-api\.prepare-plan/)
    assert.match(publisher.config.prompt, /dataset-api\.execute-plan/)
    assert.match(publisher.config.prompt, /Never invent an operationRef/)
    assert.match(publisher.config.prompt, /discover exactly dataset-api\.prepare-plan, dataset-api\.confirm-plan, and dataset-api\.execute-plan/)
    assert.match(publisher.config.prompt, /Do not add planId, placeholders, extra parameters/)
    assert.match(publisher.config.prompt, /"objective": "Create grounded question-answer records about TP53\."/)
    assert.match(publisher.config.prompt, /"providerId": "uniprot"/)
    assert.match(publisher.config.prompt, /"providerId": "pjlab-hdd1-ncbi-gene"/)
    assert.match(publisher.config.prompt, /"models": \{/)
    assert.match(publisher.config.prompt, /"strong": "strong-model"/)
    assert.match(publisher.config.prompt, /Create Loop targetCount=5 and maxIterations=12/)
    assert.match(publisher.config.prompt, /Acceptance thresholds: quality>=0\.8, strong>=0\.7, weak<=0\.45, scoreGap>=0\.25/)
    assert.match(publisher.config.prompt, /"inputArtifact": "tp53-grounded-qa\.jsonl"/)
    assert.match(publisher.config.prompt, /"outputFileName": "tp53-grounded-qa\.jsonl\.validation\.json"/)
    assert.match(publisher.config.prompt, /"description": "Materialize the accepted generated records with grounding provenance\."/)
    assert.match(publisher.config.prompt, /Do not invoke materialize, validate, or publish directly/)
    assert.match(publisher.config.prompt, /After it returns, never discover or invoke another capability/)
    assert.doesNotMatch(publisher.config.prompt, /sciforge-tool-policy/)
  }
})

test('requires every designed plan-gated preparation step to succeed before generation', () => {
  const built = buildDatasetGenerationLoop(request)
  const normalize = built.workflow.nodes.find((node) => node.id === 'normalize-grounding')
  assert.equal(normalize?.type, 'code')
  if (normalize?.type !== 'code') return
  const execute = new Function('$json', normalize.config.code) as (input: unknown) => Record<string, unknown>
  const rawPath = '/workspace/.sciforge/datasets/raw/string/tp53.tsv'
  const filteredPath = '/workspace/.sciforge/datasets/processed/dataset_filter/tp53-human.tsv'
  const receipt = {
    groundingComplete: true,
    processingComplete: true,
    processingRecipe: [
      { capability: 'dataset-api.raw-data', purpose: 'Acquire STRING data.' },
      { capability: 'dataset-api.filter', purpose: 'Keep taxon 9606.' }
    ],
    parentArtifacts: [rawPath],
    preparationPlanId: 'plan-preparation',
    preparationExecution: {
      status: 'succeeded',
      steps: [{ index: 0, tool: 'dataset_filter', status: 'succeeded', attempts: 1, artifacts: [{ path: filteredPath }] }]
    },
    preparationArtifacts: [{ path: filteredPath, sha256: 'a'.repeat(64) }],
    grounding: { string: { status: 'ready' } }
  }
  const normalized = execute(receipt)
  assert.equal(normalized.processingComplete, true)
  assert.equal(normalized.preparationPlanId, 'plan-preparation')
  assert.deepEqual(normalized.parentArtifacts, [rawPath, filteredPath])
  assert.throws(() => execute({
    ...receipt,
    preparationExecution: { status: 'failed', steps: [{ status: 'failed' }] },
    processingComplete: false
  }), /preparation recipe was not executed successfully/)
  assert.throws(() => execute({
    ...receipt,
    preparationExecution: { status: 'succeeded', steps: [] }
  }), /does not prove every designed plan-gated recipe step succeeded/)
  assert.throws(() => execute({
    ...receipt,
    preparationExecution: {
      status: 'succeeded',
      steps: [{
        index: 0,
        tool: 'dataset_filter',
        status: 'succeeded',
        attempts: 1,
        counts: { inputRecords: 10, outputRecords: 0 },
        artifacts: [{ path: filteredPath }]
      }]
    }
  }), /produced an empty output/)
})

test('rejects a successful join receipt that did not match records', () => {
  const built = buildDatasetGenerationLoop(request)
  const normalize = built.workflow.nodes.find((node) => node.id === 'normalize-grounding')
  assert.equal(normalize?.type, 'code')
  if (normalize?.type !== 'code') return
  const execute = new Function('$json', normalize.config.code) as (input: unknown) => Record<string, unknown>
  assert.throws(() => execute({
    groundingComplete: true,
    processingComplete: true,
    processingRecipe: [{ capability: 'dataset-api.join', purpose: 'Join annotations to metadata.' }],
    parentArtifacts: ['/workspace/annotations.json', '/workspace/metadata.json'],
    preparationPlanId: 'plan-join',
    preparationExecution: {
      status: 'succeeded',
      steps: [{
        index: 0,
        tool: 'dataset_join',
        status: 'succeeded',
        attempts: 1,
        counts: { leftRecords: 1, rightRecords: 1, outputRecords: 1, matchedLeftRecords: 0 },
        artifacts: [{ path: '/workspace/joined.json' }]
      }]
    },
    preparationArtifacts: [{ path: '/workspace/joined.json', sha256: 'b'.repeat(64) }],
    grounding: {}
  }), /join did not match any records/)
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

test('rejects a redundant covered source until every required source is represented', () => {
  const built = buildDatasetGenerationLoop({
    ...request,
    sourceIds: ['string', 'quickgo'],
    quality: { ...request.quality, targetCount: 2, maxIterations: 4 }
  })
  const update = built.iterationWorkflow.nodes.find((node) => node.id === 'update-state')
  assert.equal(update?.type, 'code')
  if (update?.type !== 'code') return
  const execute = new Function('$json', update.config.code) as (input: unknown) => Record<string, unknown>
  const stringArtifact = '/workspace/.sciforge/datasets/raw/string/tp53.tsv'
  const quickgoArtifact = '/workspace/.sciforge/datasets/raw/quickgo/tp53.json'
  const acceptedString = { question: 'STRING question 1', answer: '0.999', evidence: [stringArtifact] }
  const state = {
    sourceIds: ['string', 'quickgo'],
    quality: { targetCount: 2 },
    outputSchema: request.outputSchema,
    parentArtifacts: [stringArtifact, quickgoArtifact],
    acceptedSamples: [acceptedString],
    rejectedCount: 0,
    round: 1,
    strategy: { version: 1, currentRecipe: 'recipe', revisions: [], failureTrajectory: [] }
  }
  const evaluation = {
    verdict: { schemaValid: true, grounded: true, leakage: false, qualityScore: 1, weakScore: 0, strongScore: 1, failureReasons: [] },
    verifier: { leakage: false, rubricCoverage: 1, questionQuality: 1, verifiable: true, grounded: true, evidenceCoverage: true, duplicate: false, failureReasons: [] },
    strategyUpdate: { shouldRevise: true, revisedRecipe: 'use quickgo', challengerPromptPatch: 'use quickgo' }
  }
  const redundant = execute({
    state,
    candidate: { question: 'STRING question 2', answer: '0.998', evidence: [stringArtifact] },
    ...evaluation
  })
  assert.equal((redundant.acceptedSamples as unknown[]).length, 1)
  assert.equal(redundant.done, false)
  assert.match(JSON.stringify(redundant), /Uncovered sources: quickgo/)

  const completing = execute({
    state,
    candidate: { question: 'QuickGO question', answer: 'IDA', evidence: [quickgoArtifact] },
    ...evaluation
  })
  assert.equal((completing.acceptedSamples as unknown[]).length, 2)
  assert.equal(completing.done, true)
})

test('omits human approval only when the confirmed requirement disables it', () => {
  const built = buildDatasetGenerationLoop({ ...request, humanReview: false })
  assert.equal(built.workflow.nodes.some((node) => node.type === 'human-approval'), false)
  const readyToPublish = built.workflow.connections.find((edge) => edge.target === 'publication-context')
  assert.equal(readyToPublish?.source, 'ready')
  assert.equal(readyToPublish?.sourceHandle, 'true')
  assert.equal(built.workflow.connections.find((edge) => edge.target === 'publish')?.source, 'publication-context')
})

test('bounds publication state before invoking the publishing agent', () => {
  const built = buildDatasetGenerationLoop({ ...request, humanReview: false })
  const contextNode = built.workflow.nodes.find((node) => node.id === 'publication-context')
  assert.equal(contextNode?.type, 'code')
  if (contextNode?.type !== 'code') return
  const execute = new Function('$json', contextNode.config.code) as (input: unknown) => Record<string, unknown>
  const artifactPath = '/workspace/.sciforge/datasets/processed/string.tsv'
  const hugeChildren = Array.from({ length: 5000 }, (_, index) => ({ id: `GO:${index}`, text: 'x'.repeat(100) }))
  const output = execute({
    readyToPublish: true,
    objective: request.objective,
    outputSchema: request.outputSchema,
    rubric: ['grounded'],
    acceptedSamples: [{ question: 'q', answer: 'a', evidence: [artifactPath] }],
    parentArtifacts: [artifactPath],
    preparationExecution: { steps: [{ counts: { recordSamples: hugeChildren } }] },
    preparationArtifacts: [{ path: artifactPath, sha256: 'abc', key: 'artifact', tool: 'dataset_filter', recordSamples: hugeChildren }],
    verdicts: [{ accepted: true }],
    strategy: { version: 2 },
    batchQuality: { records: 1 }
  })
  assert.equal(output.readyToPublish, true)
  assert.equal(Object.hasOwn(output, 'preparationExecution'), false)
  assert.deepEqual(output.preparationArtifacts, [{ path: artifactPath, sha256: 'abc', key: 'artifact', tool: 'dataset_filter' }])
  assert.ok(JSON.stringify(output).length < 16_384)
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
    if (request.input.includes('Design the schema, task rubric')) {
      const incoming = promptJson(request.input)
      return jsonResponse({
        ...incoming,
        design: {
          outputSchema: incoming.outputSchema ?? {
            question: { type: 'string', required: true },
            answer: { type: 'string', required: true }
          },
          rubric: ['Answers must be supported by retrieved evidence.'],
          processingRecipe: [{ capability: 'raw-data', purpose: 'Retrieve TP53 evidence.' }],
          generationRecipe: 'Generate diverse evidence-first TP53 questions without answer leakage.',
          designRationale: 'Use the confirmed schema and source.'
        }
      })
    }
    if (request.input.includes('Generate exactly one new candidate')) {
      const incoming = promptJson(request.input)
      generationRound += 1
      return jsonResponse({
        state: incoming,
        candidate: {
          question: generationRound === 1
            ? 'TP53 encodes a tumor suppressor protein. What does TP53 encode?'
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
      assert.doesNotMatch(request.input, /\.sciforge\/datasets/)
      assert.doesNotMatch(request.input, /"answer":"TP53 encodes a tumor suppressor protein\./)
      return jsonResponse({ weak: { answer: 'It regulates cells.', confidence: 0.4 } })
    }
    if (request.input.includes('Act as the strong solver')) {
      assert.doesNotMatch(request.input, /\.sciforge\/datasets/)
      assert.doesNotMatch(request.input, /"answer":"TP53 encodes a tumor suppressor protein\./)
      strongCalls += 1
      if (generationRound === 3 && strongCalls === 3) {
        return jsonResponse(['uniprot', 'ensembl', 'reactome', 'string'])
      }
      return jsonResponse({ strong: { answer: 'It encodes a tumor suppressor that regulates cell-cycle responses.', confidence: 0.9 } })
    }
    if (request.input.includes('Evaluate the candidate')) {
      const incoming = promptJson(request.input)
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
    if (request.input.includes('Act as an independent task verifier')) {
      const incoming = promptJson(request.input)
      return jsonResponse({
        ...incoming,
        state: { tampered: 'verifier must not replace state' },
        verifier: {
          leakage: generationRound === 1,
          rubricCoverage: 0.95,
          questionQuality: 0.95,
          verifiable: true,
          grounded: true,
          evidenceCoverage: true,
          duplicate: false,
          failedRubricItems: generationRound === 1 ? ['Question must not reveal the answer.'] : [],
          failureReasons: generationRound === 1 ? ['The question leaks its answer.'] : [],
          suggestedRecipeChanges: generationRound === 1 ? ['Separate the question from the answer evidence.'] : []
        }
      })
    }
    if (request.input.includes('Analyze the complete failure trajectory')) {
      const incoming = promptJson(request.input)
      return jsonResponse({
        ...incoming,
        state: { tampered: 'strategy learner must not replace state' },
        strategyUpdate: {
          shouldRevise: generationRound < 3,
          systemicFailurePatterns: generationRound < 3 ? ['Candidate construction is not yet verifiable.'] : [],
          revisedRecipe: `recipe-v${generationRound + 1}`,
          challengerPromptPatch: generationRound < 3 ? 'Use the revised evidence-first recipe.' : '',
          reason: generationRound < 3 ? 'The failure trajectory requires a structural change.' : 'Candidate passes.'
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
    executionReceiptProviders: [createDatasetWorkflowExecutionReceiptProvider()],
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
          const assignedSource = request.prompt.match(/assigned exactly one source: "([^"]+)"/)?.[1] ?? 'uniprot'
          const priorArtifacts = Array.isArray(incoming.parentArtifacts) ? incoming.parentArtifacts : []
          const sourceArtifact = assignedSource === 'uniprot'
            ? '.sciforge/datasets/raw/uniprot/tp53.json'
            : `.sciforge/datasets/raw/${assignedSource}/fixture.json`
          const priorSources = Array.isArray(incoming.acquiredSourceIds) ? incoming.acquiredSourceIds : []
          return {
            text: `Grounding completed.\n\n\`\`\`json\n${JSON.stringify({
              ...incoming,
              // A grounding agent may preserve the nested design while omitting the
              // normalized top-level alias. Downstream state updates must recover it.
              outputSchema: undefined,
              round: 9,
              acceptedSamples: [{ question: 'premature candidate' }],
              grounding: {
                ...(incoming.grounding as Record<string, unknown> ?? {}),
                [assignedSource]: { status: 'ready', records: 1 },
                records: [{ question: 'premature grounding candidate' }],
                candidate: { question: 'another premature candidate' }
              },
              parentArtifacts: [...new Set([...priorArtifacts, sourceArtifact])],
              acquiredSourceIds: [...new Set([...priorSources, assignedSource])],
              acquisitionComplete: request.prompt.includes('true because this is the final assigned source'),
              processingComplete: false,
              groundingComplete: false
            })}\n\`\`\``,
            threadId: 'grounding-thread'
          }
        }
        if (request.prompt.includes('bounded Dataset API preparation stage')) {
          const incoming = promptJson(request.prompt)
          return {
            text: JSON.stringify({
              ...incoming,
              preparationPlanId: null,
              preparationExecution: null,
              preparationArtifacts: [],
              processingComplete: true,
              groundingComplete: true
            }),
            threadId: 'preparation-thread'
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
    outputSchema: undefined,
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
  assert.ok(completedRun?.reportPath)
  const report = await readFile(completedRun.reportPath, 'utf8')
  assert.match(report, /^# Synthetic Dataset Loop Run Report/m)
  assert.match(report, /## Designed Output Schema/)
  assert.match(report, /Answers must be supported by retrieved evidence/)
  assert.match(report, /dataset-api\.raw-data/)
  assert.match(report, /## Dataset API Preparation Execution/)
  assert.match(report, /No plan-gated preparation was required or captured/)
  assert.match(report, /### Loop Node Execution/)
  assert.match(report, /`challenger`/)
  assert.match(report, /`strategy-learner`/)
  assert.match(report, /## Candidate Evaluation and Independent Verification/)
  assert.match(report, /## Strategy Evolution/)
  assert.match(report, /recipe-v3/)
  assert.match(report, /## Data Lineage and Artifact Hashes/)
  const output = completedRun?.nodeResults.find((result) => result.nodeId === 'output')
  assert.match(
    output?.outputJson ?? '',
    /published\/synthetic/,
    JSON.stringify(completedRun, null, 2)
  )
  assert.equal(agentPrompts.length, 4)
  assert.equal(agentRequests.every((request) => request.runtimeId === undefined), true)
  assert.equal(generationRound, 3)
  assert.equal(judgeRound, 3)
  assert.equal(strongCalls, 4, 'Malformed solver output must retry without losing the incoming state.')
  assert.match(agentPrompts[0] ?? '', /sciforge_discover and sciforge_invoke/)
  assert.match(agentPrompts[1] ?? '', /assigned exactly one source/)
  assert.match(agentPrompts[2] ?? '', /bounded Dataset API preparation stage/)
  assert.match(agentPrompts[3] ?? '', /dataset-api\.execute-plan/)
  const publicationState = promptJson(agentPrompts[3] ?? '')
  assert.equal(publicationState.round, 3)
  assert.equal(publicationState.rejectedCount, 2)
  assert.deepEqual(Object.keys(publicationState.outputSchema as Record<string, unknown>), ['question', 'answer', 'evidence'])
  assert.deepEqual(publicationState.grounding, {
    uniprot: { status: 'ready', records: 1 },
    'pjlab-hdd1-ncbi-gene': { status: 'ready', records: 1 }
  })
  assert.equal((publicationState.strategy as { version: number }).version, 3)
  assert.equal((publicationState.strategy as { revisions: unknown[] }).revisions.length, 2)
  assert.equal((publicationState.loopExecutionTrace as unknown[]).length, 3)
  assert.deepEqual(publicationState.processingRecipe, [{
    capability: 'dataset-api.raw-data',
    purpose: 'Retrieve TP53 evidence.'
  }])
  assert.equal((publicationState.batchQuality as { verifierFailureCount: number }).verifierFailureCount, 1)
  assert.equal((publicationState.verdicts as Array<{ deterministicLeakage: boolean }>)[0]?.deterministicLeakage, true)
  assert.equal((publicationState.verdicts as Array<{ verifier: { leakage: boolean } }>)[0]?.verifier.leakage, true)
  assert.deepEqual(
    (publicationState.verdicts as Array<{ schemaErrors: { missingArtifactPaths: string[]; unknownArtifactPaths: string[] } }>)[1]?.schemaErrors,
    {
      missingRequired: [],
      invalidTypes: [],
      unexpectedFields: [],
      missingEvidence: false,
      missingArtifactPaths: [],
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
  const markers = ['Incoming state:\n', 'Incoming JSON:\n', 'Model context:\n']
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
    workflowExecutionReceipts: [],
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
