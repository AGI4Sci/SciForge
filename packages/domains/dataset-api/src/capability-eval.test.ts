import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  DATASET_API_CAPABILITY_EVAL_CONTRIBUTION,
  DATASET_API_CATALOG_EVAL_CASE_ID,
  DATASET_API_CONFIRM_PLAN_DENIED_EVAL_CASE_ID,
  DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID,
  DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID,
  DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
  DATASET_API_FILTER_VALIDATE_PLAN_ID,
  DATASET_API_GRAPH_EVAL_CASE_ID,
  DATASET_API_GRAPH_INPUT_PATH,
  DATASET_API_GRAPH_PLAN_ID,
  DATASET_API_ID_MAP_EVAL_CASE_ID,
  DATASET_API_ID_MAP_INPUT_PATH,
  DATASET_API_ID_MAP_MAPPING_PATH,
  DATASET_API_ID_MAP_PLAN_ID,
  DATASET_API_ID_MAP_PROVIDER_EVAL_CASE_ID,
  DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
  DATASET_API_ID_MAP_PROVIDER_MAPPING_PATH,
  DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
  DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH,
  DATASET_API_EXECUTE_PLAN_EVAL_CASE_ID,
  DATASET_API_EXECUTE_PLAN_ID,
  DATASET_API_EVAL_OBJECT_KEY,
  DATASET_API_EVAL_OBJECT_STORE_ID,
  DATASET_API_LIST_OBJECTS_EVAL_CASE_ID,
  DATASET_API_OBJECT_METADATA_EVAL_CASE_ID,
  DATASET_API_OBJECT_RAW_DATA_EVAL_CASE_ID,
  DATASET_API_PUBLISH_EVAL_CASE_ID,
  DATASET_API_PUBLISH_PLAN_ID,
  DATASET_API_PUBLISH_SOURCE_PATH,
  DATASET_API_PUBLISH_VALIDATION_PATH,
  DATASET_API_JOIN_EVAL_CASE_ID,
  DATASET_API_JOIN_LEFT_PATH,
  DATASET_API_JOIN_PLAN_ID,
  DATASET_API_JOIN_RIGHT_PATH,
  DATASET_API_LIST_EVAL_CASE_ID,
  DATASET_API_LIST_OBJECT_STORES_EVAL_CASE_ID,
  DATASET_API_REGISTER_PROVIDER_EVAL_CASE_ID,
  DATASET_API_RESUME_PLAN_EVAL_CASE_ID,
  DATASET_API_RESUME_PLAN_ID,
  DATASET_API_MATERIALIZE_EVAL_CASE_ID,
  DATASET_API_MATERIALIZE_PARENT_PATH,
  DATASET_API_MATERIALIZE_PLAN_ID,
  DATASET_API_PREPARE_PLAN_EVAL_CASE_ID,
  DATASET_API_PROCESSING_EVAL_CASE_ID,
  DATASET_API_PROCESSING_EVAL_INPUT_PATH,
  DATASET_API_PROCESSING_PLAN_ID,
  DATASET_API_PROFILE_EVAL_CASE_ID,
  DATASET_API_PROFILE_EVAL_INPUT_PATH,
  DATASET_API_STRUCTURE_INPUT_PATH,
  DATASET_API_STRUCTURE_PROFILE_EVAL_CASE_ID,
  DATASET_API_STRUCTURE_VALIDATE_EVAL_CASE_ID
} from './capability-eval.js'
import { DATASET_API_CAPABILITY_IDS } from './contract.js'
import { createDatasetPlanExecutor } from './plan-executor.js'
import { createDatasetProcessingService } from './processing.js'
import { createDatasetApiService } from './service.js'
import { createDatasetObjectStoreService } from './object-store.js'

test('prepares a fixed Dataset API profile fixture and independently verifies its artifact', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: DATASET_API_PROFILE_EVAL_CASE_ID,
      runId: 'run-profile-1',
      workspaceDirectory
    }
    const fixture = await prepare(context)
    assert.ok(fixture)
    assert.deepEqual(fixture.paths, [DATASET_API_PROFILE_EVAL_INPUT_PATH])
    const inputPath = join(workspaceDirectory, DATASET_API_PROFILE_EVAL_INPUT_PATH)
    const inputBytes = await readFile(inputPath)
    const artifactDirectory = join(workspaceDirectory, '.sciforge/datasets/processed/dataset_profile')
    await mkdir(artifactDirectory, { recursive: true })
    const artifactPath = join(artifactDirectory, 'profile-report.json')
    const profile = {
      format: 'jsonl',
      bytes: inputBytes.byteLength,
      sha256: digest(inputBytes),
      records: 3,
      fields: [
        { name: 'sample_id', types: { string: 3 }, missing: 0, missingFraction: 0, unique: 3, sample: ['s1', 's2', 's3'] },
        { name: 'condition', types: { string: 3 }, missing: 0, missingFraction: 0, unique: 2, sample: ['Control', 'Treated', 'Treated'] },
        { name: 'score', types: { number: 3 }, missing: 0, missingFraction: 0, unique: 3, sample: [0.72, 0.91, 0.88] }
      ]
    }
    const artifactBytes = Buffer.from(`${JSON.stringify(profile)}\n`)
    await writeFile(artifactPath, artifactBytes)
    await writeFile(`${artifactPath}.manifest.json`, `${JSON.stringify({
      version: 2,
      artifactId: `sha256:${digest(artifactBytes)}`,
      operation: 'dataset_profile',
      format: 'report',
      path: artifactPath,
      manifestPath: `${artifactPath}.manifest.json`,
      sha256: digest(artifactBytes),
      bytes: artifactBytes.byteLength,
      parents: [{ path: inputPath, sha256: digest(inputBytes) }],
      parameters: {},
      summary: {},
      createdAt: '2026-09-17T00:00:00.000Z'
    })}\n`)

    const result = await inspect({
      context,
      fixture,
      invocations: [
        {
          actionId: 'dataset-api.profile',
          args: { inputArtifact: DATASET_API_PROFILE_EVAL_INPUT_PATH, planId: 'dataset-api-profile' },
          success: false,
          errorCode: 'handler_failed'
        },
        {
          actionId: 'dataset-api.profile',
          args: { inputArtifact: DATASET_API_PROFILE_EVAL_INPUT_PATH },
          success: true,
          output: {}
        }
      ]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, ['dataset-api.profile'])
    assert.equal((result?.finalState as Record<string, unknown>).records, 3)
    assert.equal((await DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect!({
      context: { ...context, caseId: 'unrelated-case' },
      invocations: []
    })), undefined)
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies Dataset API catalog, source, and object-store read actions', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-read-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const cases = [
      {
        caseId: DATASET_API_CATALOG_EVAL_CASE_ID,
        actionId: DATASET_API_CAPABILITY_IDS.catalog,
        output: {
          providers: [{ id: 'ncbi-eutils' }, { id: 'embl-ebi-search' }, { id: 'uniprot' }],
          total: 3,
          note: 'Built-in Dataset API providers.'
        }
      },
      {
        caseId: DATASET_API_LIST_EVAL_CASE_ID,
        actionId: DATASET_API_CAPABILITY_IDS.list,
        output: {
          sources: [
            { id: 'ncbi-eutils' },
            { id: 'ensembl' },
            { id: 'rcsb-pdb' },
            { id: 'pubchem-pug-rest' },
            { id: 'quickgo' },
            { id: 'uniprot' }
          ],
          registryPath: '/tmp/workspace/.sciforge/datasets/api-sources.json'
        }
      },
      {
        caseId: DATASET_API_LIST_OBJECT_STORES_EVAL_CASE_ID,
        actionId: DATASET_API_CAPABILITY_IDS.listObjectStores,
        output: {
          stores: [],
          registryPath: '/tmp/workspace/.sciforge/datasets/object-stores.json'
        }
      }
    ] as const

    for (const evaluationCase of cases) {
      const context = {
        caseId: evaluationCase.caseId,
        runId: `run-${evaluationCase.caseId}`,
        workspaceDirectory
      }
      const fixture = await prepare(context)
      assert.ok(fixture)
      const result = await inspect({
        context,
        fixture,
        invocations: [{
          actionId: evaluationCase.actionId,
          args: {},
          success: true,
          output: evaluationCase.output
        }]
      })
      assert.equal(result?.taskSuccess, true, evaluationCase.caseId)
      assert.deepEqual(result?.verifiedActions, [evaluationCase.actionId])
      if (evaluationCase.caseId === DATASET_API_LIST_EVAL_CASE_ID) {
        assert.ok(((result?.finalState as Record<string, unknown>).sourceIds as string[]).includes('uniprot'))
      }
    }
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies provider registration and plan execution recovery', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-plan-runtime-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const api = createDatasetApiService({ workspaceRoot: workspaceDirectory })

    const registerContext = { caseId: DATASET_API_REGISTER_PROVIDER_EVAL_CASE_ID, runId: 'run-register-provider-1', workspaceDirectory }
    const registerFixture = await prepare(registerContext)
    assert.ok(registerFixture)
    const registered = await api.registerProvider({ workspaceRoot: workspaceDirectory, providerId: 'uniprot' })
    const registerResult = await inspect({
      context: registerContext,
      fixture: registerFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.registerProvider, args: { providerId: 'uniprot' }, success: true, output: registered }]
    })
    assert.equal(registerResult?.taskSuccess, true)
    assert.deepEqual(registerResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.registerProvider])

    const executeContext = { caseId: DATASET_API_EXECUTE_PLAN_EVAL_CASE_ID, runId: 'run-execute-plan-1', workspaceDirectory }
    const executeFixture = await prepare(executeContext)
    assert.ok(executeFixture)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })
    const executor = createDatasetPlanExecutor(api, processing)
    const executed = await executor.execute({ planId: DATASET_API_EXECUTE_PLAN_ID })
    const executeResult = await inspect({
      context: executeContext,
      fixture: executeFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.executePlan, args: { planId: DATASET_API_EXECUTE_PLAN_ID }, success: true, output: executed }]
    })
    assert.equal(executeResult?.taskSuccess, true)
    assert.deepEqual(executeResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.executePlan])

    const resumeContext = { caseId: DATASET_API_RESUME_PLAN_EVAL_CASE_ID, runId: 'run-resume-plan-1', workspaceDirectory }
    const resumeFixture = await prepare(resumeContext)
    assert.ok(resumeFixture)
    const resumed = await executor.resume({ planId: DATASET_API_RESUME_PLAN_ID })
    const resumeResult = await inspect({
      context: resumeContext,
      fixture: resumeFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.resumePlan, args: { planId: DATASET_API_RESUME_PLAN_ID }, success: true, output: resumed }]
    })
    assert.equal(resumeResult?.taskSuccess, true)
    assert.deepEqual(resumeResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.resumePlan])
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies publication and object-store readbacks', async () => {
  const publishWorkspace = await mkdtemp('/tmp/sciforge-dataset-api-eval-publish-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const publishContext = { caseId: DATASET_API_PUBLISH_EVAL_CASE_ID, runId: 'run-publish-1', workspaceDirectory: publishWorkspace }
    const publishFixture = await prepare(publishContext)
    assert.ok(publishFixture)
    const published = await createDatasetProcessingService({ workspaceRoot: publishWorkspace }).publish({
      planId: DATASET_API_PUBLISH_PLAN_ID,
      name: 'eval-publish',
      artifacts: [DATASET_API_PUBLISH_SOURCE_PATH, DATASET_API_PUBLISH_VALIDATION_PATH]
    })
    const publishResult = await inspect({
      context: publishContext,
      fixture: publishFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.publish, args: { planId: DATASET_API_PUBLISH_PLAN_ID, name: 'eval-publish', artifacts: [DATASET_API_PUBLISH_SOURCE_PATH, DATASET_API_PUBLISH_VALIDATION_PATH] }, success: true, output: published }]
    })
    assert.equal(publishResult?.taskSuccess, true)
    assert.deepEqual(publishResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.publish])
  } finally {
    await rm(publishWorkspace, { recursive: true, force: true })
  }

  const objectCases = [
    { caseId: DATASET_API_LIST_OBJECTS_EVAL_CASE_ID, actionId: DATASET_API_CAPABILITY_IDS.listObjects, input: { sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, prefix: 'fixture/', maxKeys: 100 } },
    { caseId: DATASET_API_OBJECT_METADATA_EVAL_CASE_ID, actionId: DATASET_API_CAPABILITY_IDS.objectMetadata, input: { sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, key: DATASET_API_EVAL_OBJECT_KEY } },
    { caseId: DATASET_API_OBJECT_RAW_DATA_EVAL_CASE_ID, actionId: DATASET_API_CAPABILITY_IDS.objectRawData, input: { sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, key: DATASET_API_EVAL_OBJECT_KEY, expectedFormat: 'json', outputFileName: 'tp53-object.json' } }
  ] as const
  for (const evaluationCase of objectCases) {
    const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-object-')
    try {
      const context = { caseId: evaluationCase.caseId, runId: `run-${evaluationCase.caseId}`, workspaceDirectory }
      const fixture = await DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare!(context)
      assert.ok(fixture)
      const objectStore = createDatasetObjectStoreService({ workspaceRoot: workspaceDirectory, env: process.env })
      const output = evaluationCase.actionId === DATASET_API_CAPABILITY_IDS.listObjects
        ? await objectStore.listObjects({ ...evaluationCase.input, workspaceRoot: workspaceDirectory })
        : evaluationCase.actionId === DATASET_API_CAPABILITY_IDS.objectMetadata
          ? await objectStore.metadata({ ...evaluationCase.input, workspaceRoot: workspaceDirectory })
          : await objectStore.rawData({ ...evaluationCase.input, workspaceRoot: workspaceDirectory })
      const result = await DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect!({
        context,
        fixture,
        invocations: [{ actionId: evaluationCase.actionId, args: evaluationCase.input, success: true, output }]
      })
      assert.equal(result?.taskSuccess, true, evaluationCase.caseId)
      assert.deepEqual(result?.verifiedActions, [evaluationCase.actionId])
    } finally {
      await rm(workspaceDirectory, { recursive: true, force: true })
    }
  }
})

test('independently verifies join, structure, and graph processing readbacks', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-advanced-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })

    const joinContext = {
      caseId: DATASET_API_JOIN_EVAL_CASE_ID,
      runId: 'run-join-1',
      workspaceDirectory
    }
    const joinFixture = await prepare(joinContext)
    assert.ok(joinFixture)
    const joined = await processing.join({
      planId: DATASET_API_JOIN_PLAN_ID,
      leftArtifact: DATASET_API_JOIN_LEFT_PATH,
      rightArtifact: DATASET_API_JOIN_RIGHT_PATH,
      rightFormat: 'tsv',
      keys: [{ left: 'accession', right: 'protein_id' }],
      joinType: 'full',
      rightPrefix: 'pathway_',
      outputFormat: 'tsv',
      outputFileName: 'protein-pathways.tsv'
    })
    const joinResult = await inspect({
      context: joinContext,
      fixture: joinFixture,
      invocations: [
        {
          actionId: DATASET_API_CAPABILITY_IDS.join,
          args: { planId: DATASET_API_JOIN_PLAN_ID, leftArtifact: DATASET_API_JOIN_LEFT_PATH, rightArtifact: DATASET_API_JOIN_RIGHT_PATH, joinType: 'full' },
          success: false,
          errorCode: 'handler_failed'
        },
        {
          actionId: DATASET_API_CAPABILITY_IDS.join,
          args: { planId: DATASET_API_JOIN_PLAN_ID, leftArtifact: DATASET_API_JOIN_LEFT_PATH, rightArtifact: DATASET_API_JOIN_RIGHT_PATH, joinType: 'full', outputFileName: 'protein-pathways.tsv' },
          success: true,
          output: joined
        }
      ]
    })
    assert.equal(joinResult?.taskSuccess, true)
    assert.deepEqual(joinResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.join])

    const profileContext = {
      caseId: DATASET_API_STRUCTURE_PROFILE_EVAL_CASE_ID,
      runId: 'run-structure-profile-1',
      workspaceDirectory
    }
    const profileFixture = await prepare(profileContext)
    assert.ok(profileFixture)
    const profile = await processing.structureProfile({ inputArtifact: DATASET_API_STRUCTURE_INPUT_PATH })
    const profileResult = await inspect({
      context: profileContext,
      fixture: profileFixture,
      invocations: [{
        actionId: DATASET_API_CAPABILITY_IDS.structureProfile,
        args: { inputArtifact: DATASET_API_STRUCTURE_INPUT_PATH },
        success: true,
        output: profile
      }]
    })
    assert.equal(profileResult?.taskSuccess, true)
    assert.deepEqual(profileResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.structureProfile])

    const validateContext = {
      caseId: DATASET_API_STRUCTURE_VALIDATE_EVAL_CASE_ID,
      runId: 'run-structure-validate-1',
      workspaceDirectory
    }
    const validateFixture = await prepare(validateContext)
    assert.ok(validateFixture)
    const validation = await processing.structureValidate({
      inputArtifact: DATASET_API_STRUCTURE_INPUT_PATH,
      minRecords: 1,
      requireCoordinates: true,
      failOnInvalid: true
    })
    const validateResult = await inspect({
      context: validateContext,
      fixture: validateFixture,
      invocations: [{
        actionId: DATASET_API_CAPABILITY_IDS.structureValidate,
        args: { inputArtifact: DATASET_API_STRUCTURE_INPUT_PATH, minRecords: 1, requireCoordinates: true, failOnInvalid: true },
        success: true,
        output: validation
      }]
    })
    assert.equal(validateResult?.taskSuccess, true)
    assert.deepEqual(validateResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.structureValidate])

    const graphContext = {
      caseId: DATASET_API_GRAPH_EVAL_CASE_ID,
      runId: 'run-graph-1',
      workspaceDirectory
    }
    const graphFixture = await prepare(graphContext)
    assert.ok(graphFixture)
    const graph = await processing.organizeGraph({
      planId: DATASET_API_GRAPH_PLAN_ID,
      inputArtifact: DATASET_API_GRAPH_INPUT_PATH,
      format: 'tsv',
      graphType: 'network',
      sourceField: 'source',
      targetField: 'target',
      edgeTypeField: 'type',
      weightField: 'score',
      includeFields: ['evidence'],
      directed: false,
      deduplicateEdges: true,
      onInvalid: 'drop',
      outputFileName: 'tp53-network.graph.json'
    })
    const graphResult = await inspect({
      context: graphContext,
      fixture: graphFixture,
      invocations: [{
        actionId: DATASET_API_CAPABILITY_IDS.graphOrganize,
        args: { planId: DATASET_API_GRAPH_PLAN_ID, inputArtifact: DATASET_API_GRAPH_INPUT_PATH, graphType: 'network', sourceField: 'source', targetField: 'target', outputFileName: 'tp53-network.graph.json' },
        success: true,
        output: graph
      }]
    })
    assert.equal(graphResult?.taskSuccess, true)
    assert.deepEqual(graphResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.graphOrganize])
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies Dataset API plan preparation, materialization, and local ID mapping', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-plan-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })

    const prepareContext = { caseId: DATASET_API_PREPARE_PLAN_EVAL_CASE_ID, runId: 'run-prepare-plan-1', workspaceDirectory }
    const prepareFixture = await prepare(prepareContext)
    assert.ok(prepareFixture)
    const prepared = await processing.preparePlan({
      objective: 'Create grounded TP53 questions.',
      operations: [{ tool: 'dataset_materialize', description: 'Materialize grounded records.' }],
      outputs: [{ name: 'synthetic-tp53.jsonl', format: 'jsonl' }]
    })
    const prepareResult = await inspect({
      context: prepareContext,
      fixture: prepareFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.preparePlan, args: { objective: 'Create grounded TP53 questions.', operations: [{ tool: 'dataset_materialize' }], outputs: [{ name: 'synthetic-tp53.jsonl', format: 'jsonl' }] }, success: true, output: prepared }]
    })
    assert.equal(prepareResult?.taskSuccess, true)
    assert.deepEqual(prepareResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.preparePlan])

    const materializeContext = { caseId: DATASET_API_MATERIALIZE_EVAL_CASE_ID, runId: 'run-materialize-1', workspaceDirectory }
    const materializeFixture = await prepare(materializeContext)
    assert.ok(materializeFixture)
    const materialized = await processing.materialize({
      planId: DATASET_API_MATERIALIZE_PLAN_ID,
      records: [
        { id: 'sample-1', question: 'What does TP53 encode?', answer: 'A tumor suppressor protein.' },
        { id: 'sample-2', question: 'Which pathway contains TP53?', answer: 'The p53 signaling pathway.' }
      ],
      format: 'jsonl',
      outputFileName: 'synthetic-tp53.jsonl',
      parentArtifacts: [DATASET_API_MATERIALIZE_PARENT_PATH],
      generation: { objective: 'Create grounded TP53 questions.', loopId: 'tp53-generation-loop' }
    })
    const materializeResult = await inspect({
      context: materializeContext,
      fixture: materializeFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.materialize, args: { planId: DATASET_API_MATERIALIZE_PLAN_ID, records: [], format: 'jsonl', outputFileName: 'synthetic-tp53.jsonl', generation: { objective: 'Create grounded TP53 questions.', loopId: 'tp53-generation-loop' } }, success: true, output: materialized }]
    })
    assert.equal(materializeResult?.taskSuccess, true)
    assert.deepEqual(materializeResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.materialize])

    const idMapContext = { caseId: DATASET_API_ID_MAP_EVAL_CASE_ID, runId: 'run-id-map-1', workspaceDirectory }
    const idMapFixture = await prepare(idMapContext)
    assert.ok(idMapFixture)
    const mapped = await processing.mapIds({
      planId: DATASET_API_ID_MAP_PLAN_ID,
      inputArtifact: DATASET_API_ID_MAP_INPUT_PATH,
      mappingArtifact: DATASET_API_ID_MAP_MAPPING_PATH,
      mappingFormat: 'tsv',
      inputField: 'accession',
      mappingFromField: 'uniprot',
      mappingToField: 'ensembl',
      outputField: 'ensembl_id',
      cardinality: 'explode',
      onUnmapped: 'drop',
      outputFormat: 'tsv',
      outputFileName: 'protein-ensembl.tsv'
    })
    const idMapResult = await inspect({
      context: idMapContext,
      fixture: idMapFixture,
      invocations: [{ actionId: DATASET_API_CAPABILITY_IDS.idMap, args: { planId: DATASET_API_ID_MAP_PLAN_ID, inputArtifact: DATASET_API_ID_MAP_INPUT_PATH, mappingArtifact: DATASET_API_ID_MAP_MAPPING_PATH, inputField: 'accession', mappingFromField: 'uniprot', mappingToField: 'ensembl', outputField: 'ensembl_id', outputFileName: 'protein-ensembl.tsv' }, success: true, output: mapped }]
    })
    assert.equal(idMapResult?.taskSuccess, true)
    assert.deepEqual(idMapResult?.verifiedActions, [DATASET_API_CAPABILITY_IDS.idMap])
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies filter-to-validate artifact lineage for a package fixture', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-filter-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID,
      runId: 'run-filter-validate-1',
      workspaceDirectory
    }
    const fixture = await prepare(context)
    assert.ok(fixture)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })
    const filtered = await processing.filter({
      inputArtifact: DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
      planId: DATASET_API_FILTER_VALIDATE_PLAN_ID,
      conditions: [{ field: 'score', operator: 'gte', value: 0.8 }],
      combine: 'all',
      outputFileName: 'filtered.jsonl'
    })
    await processing.validate({
      inputArtifact: filtered.artifact.path,
      planId: DATASET_API_FILTER_VALIDATE_PLAN_ID,
      rules: [{ field: 'score', required: true, type: 'number', min: 0.8 }],
      minRecords: 2,
      outputFileName: 'validation.json'
    })
    const result = await inspect({
      context,
      fixture,
      invocations: [
        {
          actionId: DATASET_API_CAPABILITY_IDS.filter,
          args: {
            inputArtifact: DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
            planId: DATASET_API_FILTER_VALIDATE_PLAN_ID,
            conditions: [{ field: 'score', operator: 'gte', value: 0.8 }],
            combine: 'all',
            outputFileName: 'filtered.jsonl'
          },
          success: true,
          output: filtered
        },
        {
          actionId: DATASET_API_CAPABILITY_IDS.validate,
          args: {
            inputArtifact: filtered.artifact.path,
            planId: DATASET_API_FILTER_VALIDATE_PLAN_ID,
            rules: [{ field: 'score', required: true, type: 'number', min: 0.8 }],
            minRecords: 2,
            outputFileName: 'validation.json'
          },
          success: true,
          output: {}
        }
      ]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, [
      DATASET_API_CAPABILITY_IDS.filter,
      DATASET_API_CAPABILITY_IDS.validate
    ])
    assert.equal((result?.finalState as Record<string, unknown>).filteredRows, 2)
    assert.equal((result?.finalState as Record<string, unknown>).validationPassed, true)
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies that denied plan confirmation leaves no confirmation or processed artifacts', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-denied-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: DATASET_API_CONFIRM_PLAN_DENIED_EVAL_CASE_ID,
      runId: 'run-confirm-denied-1',
      workspaceDirectory
    }
    const fixture = await prepare(context)
    assert.ok(fixture)
    const result = await inspect({
      context,
      fixture,
      invocations: [{
        actionId: DATASET_API_CAPABILITY_IDS.confirmPlan,
        args: { planId: DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID },
        success: false,
        errorCode: 'approval_denied'
      }]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, [DATASET_API_CAPABILITY_IDS.confirmPlan])
    assert.deepEqual(result?.finalState, {
      writeBlocked: true,
      confirmationExists: false,
      processedArtifactCount: 0
    })
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('independently verifies a package-owned select-transform-deduplicate chain', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-processing-')
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: DATASET_API_PROCESSING_EVAL_CASE_ID,
      runId: 'run-processing-1',
      workspaceDirectory
    }
    const fixture = await prepare(context)
    assert.ok(fixture)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })
    const selected = await processing.selectColumns({
      inputArtifact: DATASET_API_PROCESSING_EVAL_INPUT_PATH,
      planId: DATASET_API_PROCESSING_PLAN_ID,
      columns: [
        { source: 'sample_id', target: 'id' },
        { source: 'condition' },
        { source: 'score' }
      ],
      outputFormat: 'jsonl',
      outputFileName: 'selected.jsonl'
    })
    const transformed = await processing.transform({
      inputArtifact: selected.artifact.path,
      planId: DATASET_API_PROCESSING_PLAN_ID,
      operations: [
        { operation: 'trim', field: 'condition' },
        { operation: 'to_number', field: 'score' }
      ],
      outputFormat: 'jsonl',
      outputFileName: 'transformed.jsonl'
    })
    const deduplicated = await processing.deduplicate({
      inputArtifact: transformed.artifact.path,
      planId: DATASET_API_PROCESSING_PLAN_ID,
      keys: ['id'],
      keep: 'first',
      outputFileName: 'deduplicated.jsonl'
    })
    const result = await inspect({
      context,
      fixture,
      invocations: [
        { actionId: DATASET_API_CAPABILITY_IDS.selectColumns, args: { inputArtifact: DATASET_API_PROCESSING_EVAL_INPUT_PATH, planId: DATASET_API_PROCESSING_PLAN_ID, columns: [{ source: 'sample_id', target: 'id' }, { source: 'condition' }, { source: 'score' }], outputFormat: 'jsonl', outputFileName: 'selected.jsonl' }, success: true, output: selected },
        { actionId: DATASET_API_CAPABILITY_IDS.transform, args: { inputArtifact: selected.artifact.path, planId: DATASET_API_PROCESSING_PLAN_ID, operations: [{ operation: 'trim', field: 'condition' }, { operation: 'to_number', field: 'score' }], outputFormat: 'jsonl', outputFileName: 'transformed.jsonl' }, success: true, output: transformed },
        { actionId: DATASET_API_CAPABILITY_IDS.deduplicate, args: { inputArtifact: transformed.artifact.path, planId: DATASET_API_PROCESSING_PLAN_ID, keys: ['id'], keep: 'first', outputFileName: 'deduplicated.jsonl' }, success: true, output: deduplicated }
      ]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, [
      DATASET_API_CAPABILITY_IDS.selectColumns,
      DATASET_API_CAPABILITY_IDS.transform,
      DATASET_API_CAPABILITY_IDS.deduplicate
    ])
    assert.equal((result?.finalState as Record<string, unknown>).deduplicatedRows, 3)
    assert.equal((result?.finalState as Record<string, unknown>).duplicateRowsRemoved, 1)
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('prepares a case-scoped async provider harness and verifies provider mapping provenance', async () => {
  const workspaceDirectory = await mkdtemp('/tmp/sciforge-dataset-api-eval-provider-')
  let fixture: Awaited<ReturnType<NonNullable<typeof DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare>>> | undefined
  try {
    const prepare = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = DATASET_API_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: DATASET_API_ID_MAP_PROVIDER_EVAL_CASE_ID,
      runId: 'run-provider-map-1',
      workspaceDirectory
    }
    fixture = await prepare(context)
    assert.ok(fixture)
    const processing = createDatasetProcessingService({ workspaceRoot: workspaceDirectory })
    const provider = await processing.providerIdMapping({
      planId: DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
      inputArtifact: DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
      inputFormat: 'json',
      inputField: 'accession',
      provider: 'uniprot',
      fromDatabase: 'UniProtKB_AC-ID',
      toDatabase: 'Ensembl',
      outputField: 'ensembl_id',
      cardinality: 'explode',
      onUnmapped: 'drop',
      outputFormat: 'json',
      outputFileName: DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH,
      pollIntervalMs: 100,
      maxPollAttempts: 5,
      maxRetries: 1,
      timeoutMs: 1_000
    })
    const mapped = await processing.mapIds({
      planId: DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
      inputArtifact: DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
      mappingArtifact: provider.mappingArtifact.path,
      inputFormat: 'json',
      mappingFormat: 'json',
      inputField: 'accession',
      mappingFromField: 'from',
      mappingToField: 'to',
      outputField: 'ensembl_id',
      cardinality: 'explode',
      onUnmapped: 'drop',
      outputFormat: 'json',
      outputFileName: DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH
    })
    assert.match(provider.mappingArtifact.path, new RegExp(`${DATASET_API_ID_MAP_PROVIDER_MAPPING_PATH}$`, 'u'))
    const result = await inspect({
      context,
      fixture,
      invocations: [{
        actionId: DATASET_API_CAPABILITY_IDS.idMapProvider,
        args: {
          planId: DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
          inputArtifact: DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
          inputField: 'accession',
          provider: 'uniprot',
          fromDatabase: 'UniProtKB_AC-ID',
          toDatabase: 'Ensembl',
          outputField: 'ensembl_id',
          outputFileName: DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH
        },
        success: true,
        output: { provider, mapped }
      }]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, [DATASET_API_CAPABILITY_IDS.idMapProvider])
    assert.equal((result?.finalState as Record<string, unknown>).providerStatusCalls, 3)
    assert.equal((result?.finalState as Record<string, unknown>).outputRecords, 2)
  } finally {
    await fixture?.cleanup?.()
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
