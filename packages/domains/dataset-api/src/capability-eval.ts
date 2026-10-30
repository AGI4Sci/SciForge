import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalOracleResult,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import { DATASET_API_CAPABILITY_IDS } from './contract.js'
import { DATASET_API_DOMAIN_MODULE_ID } from './definition.js'
import { createDatasetPlanExecutor } from './plan-executor.js'
import { createDatasetProcessingService } from './processing.js'
import { createDatasetApiService } from './service.js'
import { createDatasetObjectStoreService } from './object-store.js'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

/** Agent-visible Dataset API actions owned by this package. */
export const DATASET_API_AGENT_CAPABILITY_IDS = Object.freeze(
  Object.values(DATASET_API_CAPABILITY_IDS).filter((actionId) => (
    actionId !== DATASET_API_CAPABILITY_IDS.register &&
    actionId !== DATASET_API_CAPABILITY_IDS.registerObjectStore
  ))
)

export const DATASET_API_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND

/** First package-owned live case. Its ID is referenced by the integration case file. */
export const DATASET_API_PROFILE_EVAL_CASE_ID = 'dataset-api-profile-local-fixture'
export const DATASET_API_PROFILE_EVAL_INPUT_PATH = 'fixtures/dataset-api-profile.jsonl'
export const DATASET_API_CATALOG_EVAL_CASE_ID = 'dataset-api-catalog-local-fixture'
export const DATASET_API_LIST_EVAL_CASE_ID = 'dataset-api-list-local-fixture'
export const DATASET_API_LIST_OBJECT_STORES_EVAL_CASE_ID = 'dataset-api-list-object-stores-local-fixture'
export const DATASET_API_REGISTER_PROVIDER_EVAL_CASE_ID = 'dataset-api-register-provider-local-fixture'
export const DATASET_API_METADATA_EVAL_CASE_ID = 'dataset-api-metadata-local-fixture'
export const DATASET_API_RAW_DATA_EVAL_CASE_ID = 'dataset-api-raw-data-local-fixture'
export const DATASET_API_LOCAL_HTTP_SOURCE_ID = 'eval-local-http'
export const DATASET_API_PUBLISH_EVAL_CASE_ID = 'dataset-api-publish-local-fixture'
export const DATASET_API_PUBLISH_PLAN_ID = 'plan-dataset-api-publish'
export const DATASET_API_PUBLISH_SOURCE_PATH = 'fixtures/publish-source.jsonl'
export const DATASET_API_PUBLISH_VALIDATION_PATH = 'fixtures/publish-source.validation.json'
export const DATASET_API_LIST_OBJECTS_EVAL_CASE_ID = 'dataset-api-list-objects-local-fixture'
export const DATASET_API_OBJECT_METADATA_EVAL_CASE_ID = 'dataset-api-object-metadata-local-fixture'
export const DATASET_API_OBJECT_RAW_DATA_EVAL_CASE_ID = 'dataset-api-object-raw-data-local-fixture'
export const DATASET_API_EVAL_OBJECT_STORE_ID = 'eval-object-store'
export const DATASET_API_EVAL_OBJECT_KEY = 'fixture/tp53.json'
export const DATASET_API_JOIN_EVAL_CASE_ID = 'dataset-api-join-local-fixture'
export const DATASET_API_JOIN_LEFT_PATH = 'fixtures/dataset-api-join-left.json'
export const DATASET_API_JOIN_RIGHT_PATH = 'fixtures/dataset-api-join-right.tsv'
export const DATASET_API_JOIN_PLAN_ID = 'plan-dataset-api-join'
export const DATASET_API_STRUCTURE_PROFILE_EVAL_CASE_ID = 'dataset-api-structure-profile-local-fixture'
export const DATASET_API_STRUCTURE_VALIDATE_EVAL_CASE_ID = 'dataset-api-structure-validate-local-fixture'
export const DATASET_API_STRUCTURE_INPUT_PATH = 'fixtures/dataset-api-structure.sdf'
export const DATASET_API_GRAPH_EVAL_CASE_ID = 'dataset-api-graph-organize-local-fixture'
export const DATASET_API_GRAPH_INPUT_PATH = 'fixtures/dataset-api-graph.tsv'
export const DATASET_API_GRAPH_PLAN_ID = 'plan-dataset-api-graph'
export const DATASET_API_PREPARE_PLAN_EVAL_CASE_ID = 'dataset-api-prepare-plan-local-fixture'
export const DATASET_API_MATERIALIZE_EVAL_CASE_ID = 'dataset-api-materialize-local-fixture'
export const DATASET_API_MATERIALIZE_PARENT_PATH = 'fixtures/dataset-api-grounding.json'
export const DATASET_API_MATERIALIZE_PLAN_ID = 'plan-dataset-api-materialize'
export const DATASET_API_ID_MAP_EVAL_CASE_ID = 'dataset-api-id-map-local-fixture'
export const DATASET_API_ID_MAP_INPUT_PATH = 'fixtures/dataset-api-id-map-input.json'
export const DATASET_API_ID_MAP_MAPPING_PATH = 'fixtures/dataset-api-id-map.tsv'
export const DATASET_API_ID_MAP_PLAN_ID = 'plan-dataset-api-id-map'
export const DATASET_API_ID_MAP_PROVIDER_EVAL_CASE_ID = 'dataset-api-id-map-provider-local-fixture'
export const DATASET_API_ID_MAP_PROVIDER_INPUT_PATH = 'fixtures/dataset-api-id-map-provider-input.json'
export const DATASET_API_ID_MAP_PROVIDER_PLAN_ID = 'plan-dataset-api-id-map-provider'
export const DATASET_API_ID_MAP_PROVIDER_MAPPING_PATH = 'uniprot-uniprotkb_ac-id-to-ensembl.mapping.json'
export const DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH = 'provider-mapped.json'
export const DATASET_API_EXECUTE_PLAN_EVAL_CASE_ID = 'dataset-api-execute-plan-local-fixture'
export const DATASET_API_EXECUTE_PLAN_INPUT_PATH = 'fixtures/dataset-api-execute-plan.jsonl'
export const DATASET_API_EXECUTE_PLAN_ID = 'plan-dataset-api-execute'
export const DATASET_API_RESUME_PLAN_EVAL_CASE_ID = 'dataset-api-resume-plan-local-fixture'
export const DATASET_API_RESUME_PLAN_INPUT_PATH = 'fixtures/dataset-api-resume-plan.jsonl'
export const DATASET_API_RESUME_PLAN_ID = 'plan-dataset-api-resume'
export const DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID = 'dataset-api-filter-validate-local-fixture'
export const DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH = 'fixtures/dataset-api-multistep.jsonl'
export const DATASET_API_FILTER_VALIDATE_PLAN_ID = 'plan-dataset-api-local'
export const DATASET_API_CONFIRM_PLAN_DENIED_EVAL_CASE_ID = 'dataset-api-confirm-plan-denied'
export const DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID = 'plan-dataset-api-approval-denied'
export const DATASET_API_PROCESSING_EVAL_CASE_ID = 'dataset-api-processing-local-fixture'
export const DATASET_API_PROCESSING_EVAL_INPUT_PATH = 'fixtures/dataset-api-processing.jsonl'
export const DATASET_API_PROCESSING_PLAN_ID = 'plan-dataset-api-processing'

const DATASET_API_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'natural-routing.dataset.profile': DATASET_API_PROFILE_EVAL_CASE_ID,
  'natural-routing.dataset.catalog': DATASET_API_CATALOG_EVAL_CASE_ID,
  'natural-routing.dataset.list': DATASET_API_LIST_EVAL_CASE_ID,
  'natural-routing.dataset.filter': DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID,
  'natural-routing.dataset.join': DATASET_API_JOIN_EVAL_CASE_ID,
  'natural-routing.dataset.id-map': DATASET_API_ID_MAP_EVAL_CASE_ID,
  'core.dataset.catalog': DATASET_API_CATALOG_EVAL_CASE_ID,
  'core.dataset.profile': DATASET_API_PROFILE_EVAL_CASE_ID,
  'core.dataset.filter-validate': DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID,
  'core.dataset.join': DATASET_API_JOIN_EVAL_CASE_ID
})

const DATASET_API_PROFILE_EVAL_INPUT = [
  { sample_id: 's1', condition: 'Control', score: 0.72 },
  { sample_id: 's2', condition: 'Treated', score: 0.91 },
  { sample_id: 's3', condition: 'Treated', score: 0.88 }
]

const DATASET_API_FILTER_VALIDATE_EVAL_INPUT = [
  { sample_id: 's1', condition: 'Control', score: 0.72 },
  { sample_id: 's2', condition: 'Treated', score: 0.91 },
  { sample_id: 's3', condition: 'Treated', score: 0.88 }
]

const DATASET_API_FILTER_CONDITIONS = [
  { field: 'score', operator: 'gte', value: 0.8 }
] as const

const DATASET_API_PROCESSING_INPUT = [
  { sample_id: 's1', condition: ' Control ', score: '0.72' },
  { sample_id: 's1', condition: ' Control ', score: '0.72' },
  { sample_id: 's2', condition: ' Treated ', score: '0.91' },
  { sample_id: 's3', condition: ' Treated ', score: '0.88' }
]

const DATASET_API_JOIN_LEFT_INPUT = [
  { accession: 'P04637', reviewed: 'YES', length: '393' },
  { accession: 'Q9TEST', reviewed: 'no', length: '90' }
]

const DATASET_API_JOIN_RIGHT_INPUT = [
  ['protein_id', 'pathway'],
  ['P04637', 'R-HSA-69563'],
  ['P99999', 'R-HSA-00000']
]

const DATASET_API_STRUCTURE_INPUT = [
  'Example molecule',
  '  SciForge',
  '',
  '  2  1  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0  0  0  0',
  'M  END',
  '>  <CHEMBL_ID>',
  'CHEMBL25',
  '',
  '>  <ACTIVITY>',
  '12.5',
  '',
  '$$$$',
  ''
].join('\n')

const DATASET_API_GRAPH_INPUT = [
  ['source', 'target', 'score', 'type', 'evidence'],
  ['TP53', 'MDM2', '0.99', 'physical', 'experiment-1'],
  ['MDM2', 'TP53', '0.80', 'physical', 'experiment-2'],
  ['TP53', 'BRCA1', 'invalid', 'functional', 'experiment-3'],
  ['', 'ATM', '0.70', 'functional', 'experiment-4']
]

const DATASET_API_MATERIALIZE_RECORDS = [
  { id: 'sample-1', question: 'What does TP53 encode?', answer: 'A tumor suppressor protein.' },
  { id: 'sample-2', question: 'Which pathway contains TP53?', answer: 'The p53 signaling pathway.' }
]

const DATASET_API_ID_MAP_INPUT = [
  { accession: 'P04637', gene: 'TP53' },
  { accession: 'Q9UNMAPPED', gene: 'UNKNOWN' }
]

const DATASET_API_ID_MAP_PROVIDER_INPUT = [
  { accession: 'P04637', gene: 'TP53' },
  { accession: 'P38398', gene: 'BRCA1' },
  { accession: 'BAD', gene: 'UNKNOWN' }
]

const DATASET_API_ID_MAP_MAPPING = [
  ['uniprot', 'ensembl'],
  ['P04637', 'ENSG00000141510'],
  ['P04637', 'ENST00000269305'],
  ['P04637', 'ENSG00000141510'],
  ['', 'INVALID']
]

const DATASET_API_EVAL_HTTP_SERVERS = new Map<string, ReturnType<typeof createServer>>()
const DATASET_API_EVAL_PROVIDER_HARNESSES = new Map<string, {
  requestLog: string[]
  statusCalls: number
  fetch: typeof fetch
}>()
const DATASET_API_EVAL_OBJECT_SERVERS = new Map<string, {
  server: ReturnType<typeof createServer>
  requests: Array<{ method: string; pathname: string; search: string }>
  envNames: { accessKeyId: string; secretAccessKey: string }
  previousEnv: { accessKeyId?: string; secretAccessKey?: string }
}>()

export const DATASET_API_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: DATASET_API_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: DATASET_API_AGENT_CAPABILITY_IDS,
  evaluationActionIds: [
    DATASET_API_CAPABILITY_IDS.profile,
    DATASET_API_CAPABILITY_IDS.catalog,
    DATASET_API_CAPABILITY_IDS.list,
    DATASET_API_CAPABILITY_IDS.listObjectStores,
    DATASET_API_CAPABILITY_IDS.registerProvider,
    DATASET_API_CAPABILITY_IDS.metadata,
    DATASET_API_CAPABILITY_IDS.rawData,
    DATASET_API_CAPABILITY_IDS.listObjects,
    DATASET_API_CAPABILITY_IDS.objectMetadata,
    DATASET_API_CAPABILITY_IDS.objectRawData,
    DATASET_API_CAPABILITY_IDS.publish,
    DATASET_API_CAPABILITY_IDS.join,
    DATASET_API_CAPABILITY_IDS.structureProfile,
    DATASET_API_CAPABILITY_IDS.structureValidate,
    DATASET_API_CAPABILITY_IDS.graphOrganize,
    DATASET_API_CAPABILITY_IDS.preparePlan,
    DATASET_API_CAPABILITY_IDS.materialize,
    DATASET_API_CAPABILITY_IDS.idMap,
    DATASET_API_CAPABILITY_IDS.idMapProvider,
    DATASET_API_CAPABILITY_IDS.executePlan,
    DATASET_API_CAPABILITY_IDS.resumePlan,
    DATASET_API_CAPABILITY_IDS.filter,
    DATASET_API_CAPABILITY_IDS.validate,
    DATASET_API_CAPABILITY_IDS.confirmPlan,
    DATASET_API_CAPABILITY_IDS.selectColumns,
    DATASET_API_CAPABILITY_IDS.transform,
    DATASET_API_CAPABILITY_IDS.deduplicate
  ],
  prepare: prepareDatasetApiEvaluationFixture,
  inspect: inspectDatasetApiEvaluation
})

async function prepareDatasetApiEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const evaluationContext = normalizeDatasetApiContext(context)
  if (evaluationContext.caseId === DATASET_API_PROFILE_EVAL_CASE_ID) {
    return prepareDatasetApiProfileFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_CATALOG_EVAL_CASE_ID ||
      evaluationContext.caseId === DATASET_API_LIST_EVAL_CASE_ID ||
      evaluationContext.caseId === DATASET_API_LIST_OBJECT_STORES_EVAL_CASE_ID) {
    return {
      fixtureId: `dataset-api.${evaluationContext.caseId}.v1`,
      paths: [],
      metadata: { expectedCase: evaluationContext.caseId }
    }
  }
  if (evaluationContext.caseId === DATASET_API_REGISTER_PROVIDER_EVAL_CASE_ID) {
    return {
      fixtureId: 'dataset-api.register-provider.v1',
      paths: [],
      metadata: { providerId: 'uniprot' }
    }
  }
  if (evaluationContext.caseId === DATASET_API_METADATA_EVAL_CASE_ID || evaluationContext.caseId === DATASET_API_RAW_DATA_EVAL_CASE_ID) {
    return prepareDatasetApiHttpFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_PUBLISH_EVAL_CASE_ID) {
    return prepareDatasetApiPublishFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_LIST_OBJECTS_EVAL_CASE_ID ||
      evaluationContext.caseId === DATASET_API_OBJECT_METADATA_EVAL_CASE_ID ||
      evaluationContext.caseId === DATASET_API_OBJECT_RAW_DATA_EVAL_CASE_ID) {
    return prepareDatasetApiObjectStoreFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_JOIN_EVAL_CASE_ID) {
    return prepareDatasetApiJoinFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_STRUCTURE_PROFILE_EVAL_CASE_ID ||
      evaluationContext.caseId === DATASET_API_STRUCTURE_VALIDATE_EVAL_CASE_ID) {
    return prepareDatasetApiStructureFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_GRAPH_EVAL_CASE_ID) {
    return prepareDatasetApiGraphFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_PREPARE_PLAN_EVAL_CASE_ID) {
    return {
      fixtureId: 'dataset-api.prepare-plan.v1',
      paths: [],
      metadata: { expectedOperation: 'dataset_materialize' }
    }
  }
  if (evaluationContext.caseId === DATASET_API_MATERIALIZE_EVAL_CASE_ID) {
    return prepareDatasetApiMaterializeFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_ID_MAP_EVAL_CASE_ID) {
    return prepareDatasetApiIdMapFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_ID_MAP_PROVIDER_EVAL_CASE_ID) {
    return prepareDatasetApiIdMapProviderFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_EXECUTE_PLAN_EVAL_CASE_ID) {
    return prepareDatasetApiExecutePlanFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_RESUME_PLAN_EVAL_CASE_ID) {
    return prepareDatasetApiResumePlanFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID) {
    return prepareDatasetApiFilterValidateFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_CONFIRM_PLAN_DENIED_EVAL_CASE_ID) {
    return prepareDatasetApiConfirmPlanDeniedFixture(evaluationContext)
  }
  if (evaluationContext.caseId === DATASET_API_PROCESSING_EVAL_CASE_ID) {
    return prepareDatasetApiProcessingFixture(evaluationContext)
  }
  return undefined
}

async function prepareDatasetApiProfileFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  if (context.caseId !== DATASET_API_PROFILE_EVAL_CASE_ID) return undefined
  const inputPath = datasetProfileInputPath(context)
  const path = join(context.workspaceDirectory, inputPath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `${DATASET_API_PROFILE_EVAL_INPUT.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  )
  return {
    fixtureId: 'dataset-api.profile.jsonl.v1',
    paths: [inputPath],
    metadata: {
      inputPath,
      expectedRecords: DATASET_API_PROFILE_EVAL_INPUT.length,
      expectedFields: ['sample_id', 'condition', 'score']
    }
  }
}

function datasetProfileInputPath(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile === 'natural-routing.dataset.profile'
    ? 'experiment-results.jsonl'
    : DATASET_API_PROFILE_EVAL_INPUT_PATH
}

function normalizeDatasetApiContext(context: DomainCapabilityEvalRunContext): DomainCapabilityEvalRunContext {
  const caseId = context.fixtureProfile ? DATASET_API_ROUTING_PROFILES[context.fixtureProfile] : undefined
  return caseId ? { ...context, caseId } : context
}

async function prepareDatasetApiJoinFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const leftPath = join(context.workspaceDirectory, DATASET_API_JOIN_LEFT_PATH)
  const rightPath = join(context.workspaceDirectory, DATASET_API_JOIN_RIGHT_PATH)
  await mkdir(dirname(leftPath), { recursive: true })
  await writeFile(leftPath, `${JSON.stringify(DATASET_API_JOIN_LEFT_INPUT)}\n`, 'utf8')
  await writeFile(rightPath, `${DATASET_API_JOIN_RIGHT_INPUT.map((row) => row.join('\t')).join('\n')}\n`, 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_JOIN_PLAN_ID,
    {
      objective: 'Join the local protein records with pathway annotations while retaining unmatched records.',
      operations: [{
        tool: 'dataset_join',
        description: 'Perform a full join on accession and protein_id.',
        parameters: {
          leftArtifact: DATASET_API_JOIN_LEFT_PATH,
          rightArtifact: DATASET_API_JOIN_RIGHT_PATH,
          rightFormat: 'tsv',
          keys: [{ left: 'accession', right: 'protein_id' }],
          joinType: 'full',
          rightPrefix: 'pathway_',
          outputFormat: 'tsv',
          outputFileName: 'protein-pathways.tsv'
        }
      }],
      outputs: [{ name: 'protein-pathways.tsv', format: 'tsv', description: 'Full protein/pathway join.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.join.local.v1',
    paths: [
      DATASET_API_JOIN_LEFT_PATH,
      DATASET_API_JOIN_RIGHT_PATH,
      relativePlanPath(DATASET_API_JOIN_PLAN_ID),
      relativeConfirmationPath(DATASET_API_JOIN_PLAN_ID)
    ],
    metadata: {
      leftPath: DATASET_API_JOIN_LEFT_PATH,
      rightPath: DATASET_API_JOIN_RIGHT_PATH,
      planId: DATASET_API_JOIN_PLAN_ID,
      planPath,
      expectedOutputRecords: 3,
      expectedUnmatchedLeft: 1,
      expectedUnmatchedRight: 1
    }
  }
}

async function prepareDatasetApiStructureFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_STRUCTURE_INPUT_PATH)
  await mkdir(dirname(inputPath), { recursive: true })
  await writeFile(inputPath, DATASET_API_STRUCTURE_INPUT, 'utf8')
  return {
    fixtureId: 'dataset-api.structure.sdf.v1',
    paths: [DATASET_API_STRUCTURE_INPUT_PATH],
    metadata: {
      inputPath: DATASET_API_STRUCTURE_INPUT_PATH,
      expectedFormat: 'sdf',
      expectedRecords: 1,
      expectedCoordinateRecords: 2
    }
  }
}

async function prepareDatasetApiGraphFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_GRAPH_INPUT_PATH)
  await mkdir(dirname(inputPath), { recursive: true })
  await writeFile(inputPath, `${DATASET_API_GRAPH_INPUT.map((row) => row.join('\t')).join('\n')}\n`, 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_GRAPH_PLAN_ID,
    {
      objective: 'Organize the local interaction table as a deduplicated undirected network.',
      operations: [{
        tool: 'dataset_graph_organize',
        description: 'Build a bounded network graph and retain invalid-edge evidence.',
        parameters: {
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
        }
      }],
      outputs: [{ name: 'tp53-network.graph.json', format: 'json', description: 'Network graph report.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.graph-organize.tsv.v1',
    paths: [
      DATASET_API_GRAPH_INPUT_PATH,
      relativePlanPath(DATASET_API_GRAPH_PLAN_ID),
      relativeConfirmationPath(DATASET_API_GRAPH_PLAN_ID)
    ],
    metadata: {
      inputPath: DATASET_API_GRAPH_INPUT_PATH,
      planId: DATASET_API_GRAPH_PLAN_ID,
      planPath,
      expectedNodes: 2,
      expectedEdges: 1,
      expectedInvalid: 2,
      expectedDuplicateEdgesRemoved: 1
    }
  }
}

async function prepareDatasetApiMaterializeFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const parentPath = join(context.workspaceDirectory, DATASET_API_MATERIALIZE_PARENT_PATH)
  await mkdir(dirname(parentPath), { recursive: true })
  await writeFile(parentPath, '[{"source":"controlled-fixture"}]\n', 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_MATERIALIZE_PLAN_ID,
    {
      objective: 'Create grounded TP53 questions from a controlled generation request.',
      operations: [{
        tool: 'dataset_materialize',
        description: 'Materialize the fixed generated records with provenance.',
        parameters: { format: 'jsonl', outputFileName: 'synthetic-tp53.jsonl' }
      }],
      outputs: [{ name: 'synthetic-tp53.jsonl', format: 'jsonl', description: 'Grounded generated records.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.materialize.v1',
    paths: [DATASET_API_MATERIALIZE_PARENT_PATH, relativePlanPath(DATASET_API_MATERIALIZE_PLAN_ID), relativeConfirmationPath(DATASET_API_MATERIALIZE_PLAN_ID)],
    metadata: { planId: DATASET_API_MATERIALIZE_PLAN_ID, planPath, parentPath: DATASET_API_MATERIALIZE_PARENT_PATH, expectedRecords: DATASET_API_MATERIALIZE_RECORDS.length }
  }
}

async function prepareDatasetApiIdMapFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_ID_MAP_INPUT_PATH)
  const mappingPath = join(context.workspaceDirectory, DATASET_API_ID_MAP_MAPPING_PATH)
  await mkdir(dirname(inputPath), { recursive: true })
  await writeFile(inputPath, `${JSON.stringify(DATASET_API_ID_MAP_INPUT)}\n`, 'utf8')
  await writeFile(mappingPath, `${DATASET_API_ID_MAP_MAPPING.map((row) => row.join('\t')).join('\n')}\n`, 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_ID_MAP_PLAN_ID,
    {
      objective: 'Map local UniProt accessions to Ensembl identifiers with explicit unmatched evidence.',
      operations: [{
        tool: 'dataset_id_map',
        description: 'Map accession values through the local controlled mapping table.',
        parameters: {
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
        }
      }],
      outputs: [{ name: 'protein-ensembl.tsv', format: 'tsv', description: 'Mapped protein identifiers.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.id-map.v1',
    paths: [DATASET_API_ID_MAP_INPUT_PATH, DATASET_API_ID_MAP_MAPPING_PATH, relativePlanPath(DATASET_API_ID_MAP_PLAN_ID), relativeConfirmationPath(DATASET_API_ID_MAP_PLAN_ID)],
    metadata: { inputPath: DATASET_API_ID_MAP_INPUT_PATH, mappingPath: DATASET_API_ID_MAP_MAPPING_PATH, planId: DATASET_API_ID_MAP_PLAN_ID, planPath }
  }
}

async function prepareDatasetApiIdMapProviderFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_ID_MAP_PROVIDER_INPUT_PATH)
  await mkdir(dirname(inputPath), { recursive: true })
  await writeFile(inputPath, `${JSON.stringify(DATASET_API_ID_MAP_PROVIDER_INPUT)}\n`, 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
    {
      objective: 'Map local UniProt accessions through a bounded provider job and retain provider provenance.',
      operations: [
        {
          tool: 'dataset_id_map_provider',
          description: 'Run the controlled UniProt ID Mapping provider job.',
          parameters: {
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
          }
        },
        {
          tool: 'dataset_id_map',
          description: 'Apply the provider mapping artifact to the local input.',
          parameters: {
            inputArtifact: DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
            mappingArtifact: DATASET_API_ID_MAP_PROVIDER_MAPPING_PATH,
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
          }
        }
      ],
      outputs: [{ name: DATASET_API_ID_MAP_PROVIDER_OUTPUT_PATH, format: 'json', description: 'Provider-backed mapped records.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled provider evaluation fixture.']
    },
    { approved: true }
  )

  const previousFetch = globalThis.fetch
  const harness = {
    requestLog: [] as string[],
    statusCalls: 0,
    fetch: undefined as unknown as typeof fetch
  }
  const providerFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    harness.requestLog.push(`${String(init?.method ?? 'GET').toUpperCase()} ${url}`)
    if (!url.startsWith('https://rest.uniprot.org/idmapping/')) return previousFetch(input, init)
    if (url.endsWith('/idmapping/run')) {
      return new Response(JSON.stringify({ jobId: 'evaljob' }), {
        headers: { 'content-type': 'application/json' }
      })
    }
    if (url.endsWith('/idmapping/status/evaljob')) {
      harness.statusCalls += 1
      if (harness.statusCalls === 1) return new Response('temporary provider failure', { status: 503 })
      return new Response(JSON.stringify({ jobStatus: harness.statusCalls === 2 ? 'RUNNING' : 'FINISHED' }), {
        headers: { 'content-type': 'application/json' }
      })
    }
    if (url.endsWith('/idmapping/details/evaljob')) {
      return new Response(JSON.stringify({
        redirectURL: 'https://rest.uniprot.org/idmapping/results/evaljob'
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://rest.uniprot.org/idmapping/stream/evaljob?format=json') {
      return new Response(JSON.stringify({
        results: [
          { from: 'P04637', to: 'ENSG00000141510' },
          { from: 'P38398', to: { id: 'ENSG00000012048' } }
        ],
        failedIds: ['BAD']
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  }
  harness.fetch = providerFetch
  DATASET_API_EVAL_PROVIDER_HARNESSES.set(`${context.caseId}:${context.runId}`, harness)
  globalThis.fetch = providerFetch

  return {
    fixtureId: 'dataset-api.id-map-provider.v1',
    paths: [
      DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
      relativePlanPath(DATASET_API_ID_MAP_PROVIDER_PLAN_ID),
      relativeConfirmationPath(DATASET_API_ID_MAP_PROVIDER_PLAN_ID)
    ],
    metadata: {
      inputPath: DATASET_API_ID_MAP_PROVIDER_INPUT_PATH,
      planId: DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
      planPath,
      provider: 'uniprot',
      expectedJobId: 'evaljob',
      expectedProviderCalls: 5
    },
    cleanup: () => {
      if (globalThis.fetch === providerFetch) globalThis.fetch = previousFetch
      DATASET_API_EVAL_PROVIDER_HARNESSES.delete(`${context.caseId}:${context.runId}`)
    }
  }
}

async function prepareDatasetApiExecutePlanFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_EXECUTE_PLAN_INPUT_PATH)
  await writeJsonlFixture(inputPath, [
    { sample_id: 'execute-1', condition: 'Control', score: 0.72 },
    { sample_id: 'execute-2', condition: 'Treated', score: 0.91 }
  ])
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_EXECUTE_PLAN_ID,
    {
      objective: 'Execute a deterministic profile plan over the local fixture.',
      operations: [{
        tool: 'dataset_profile',
        description: 'Profile the controlled JSONL fixture.',
        parameters: {
          inputArtifact: DATASET_API_EXECUTE_PLAN_INPUT_PATH,
          outputFileName: 'execute-plan.profile.json'
        }
      }],
      outputs: [{ name: 'execute-plan.profile.json', format: 'json', description: 'Execution profile report.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.execute-plan.v1',
    paths: [DATASET_API_EXECUTE_PLAN_INPUT_PATH, relativePlanPath(DATASET_API_EXECUTE_PLAN_ID), relativeConfirmationPath(DATASET_API_EXECUTE_PLAN_ID)],
    metadata: { inputPath: DATASET_API_EXECUTE_PLAN_INPUT_PATH, planId: DATASET_API_EXECUTE_PLAN_ID, planPath, expectedRecords: 2 }
  }
}

async function prepareDatasetApiResumePlanFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_RESUME_PLAN_INPUT_PATH)
  await writeJsonlFixture(inputPath, [
    { sample_id: 'resume-1', condition: 'Control', score: 0.72 },
    { sample_id: 'resume-2', condition: 'Treated', score: 0.91 }
  ])
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_RESUME_PLAN_ID,
    {
      objective: 'Resume a deterministic profile plan after a controlled interruption.',
      operations: [{
        tool: 'dataset_profile',
        description: 'Profile the controlled JSONL fixture after resuming.',
        parameters: {
          inputArtifact: DATASET_API_RESUME_PLAN_INPUT_PATH,
          outputFileName: 'resume-plan.profile.json'
        }
      }],
      outputs: [{ name: 'resume-plan.profile.json', format: 'json', description: 'Resumed profile report.' }],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  const api = createDatasetApiService({ workspaceRoot: context.workspaceDirectory })
  const processing = createDatasetProcessingService({ workspaceRoot: context.workspaceDirectory })
  const interruptedProcessing = new Proxy(processing, {
    get(target, property, receiver) {
      if (property === 'profile') {
        return async () => {
          throw new Error('controlled evaluation interruption')
        }
      }
      return Reflect.get(target, property, receiver)
    }
  }) as ReturnType<typeof createDatasetProcessingService>
  const interrupted = await createDatasetPlanExecutor(api, interruptedProcessing).execute({
    planId: DATASET_API_RESUME_PLAN_ID
  })
  if (interrupted.execution.status !== 'failed') {
    throw new Error(`Expected the resume fixture to create a failed checkpoint, received '${interrupted.execution.status}'.`)
  }
  return {
    fixtureId: 'dataset-api.resume-plan.v1',
    paths: [DATASET_API_RESUME_PLAN_INPUT_PATH, relativePlanPath(DATASET_API_RESUME_PLAN_ID), relativeConfirmationPath(DATASET_API_RESUME_PLAN_ID)],
    metadata: { inputPath: DATASET_API_RESUME_PLAN_INPUT_PATH, planId: DATASET_API_RESUME_PLAN_ID, planPath, checkpointStatus: 'failed', expectedRecords: 2 }
  }
}

async function prepareDatasetApiHttpFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/metadata/P04637') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ primaryAccession: 'P04637', gene: 'TP53', fixture: 'local-http' }))
      return
    }
    if (pathname === '/raw/P04637') {
      response.writeHead(200, { 'content-type': 'text/plain; format=fasta' })
      response.end('>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n')
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to resolve the local Dataset API evaluation server port.')
  const api = createDatasetApiService({ workspaceRoot: context.workspaceDirectory })
  await api.register({
    workspaceRoot: context.workspaceDirectory,
    id: DATASET_API_LOCAL_HTTP_SOURCE_ID,
    name: 'Dataset API local evaluation source',
    baseUrl: `http://127.0.0.1:${address.port}/`,
    metadataEndpoint: 'metadata/{identifier}',
    rawDataEndpoint: 'raw/{identifier}'
  })
  DATASET_API_EVAL_HTTP_SERVERS.set(`${context.caseId}:${context.runId}`, server)
  return {
    fixtureId: `dataset-api.${context.caseId}.v1`,
    paths: ['.sciforge/datasets/api-sources.json'],
    metadata: { sourceId: DATASET_API_LOCAL_HTTP_SOURCE_ID, accession: 'P04637', server: 'loopback' }
  }
}

async function prepareDatasetApiPublishFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const groundingPath = join(context.workspaceDirectory, 'fixtures/publish-grounding.json')
  await mkdir(dirname(groundingPath), { recursive: true })
  await writeFile(groundingPath, '{"source":"controlled-publish-fixture"}\n', 'utf8')
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_PUBLISH_PLAN_ID,
    {
      objective: 'Publish a validated controlled dataset artifact.',
      operations: [
        {
          tool: 'dataset_materialize',
          description: 'Materialize the controlled publication records.',
          parameters: { format: 'jsonl', outputFileName: 'publish-source.jsonl' }
        },
        {
          tool: 'dataset_validate',
          description: 'Validate the controlled publication records.',
          parameters: {
            inputArtifact: DATASET_API_PUBLISH_SOURCE_PATH,
            rules: [{ field: 'id', required: true }, { field: 'value', required: true }],
            minRecords: 2,
            failOnInvalid: true,
            outputFileName: 'publish-source.validation.json'
          }
        },
        {
          tool: 'dataset_publish',
          description: 'Publish the validated artifact and quality report.',
          parameters: {
            name: 'eval-publish',
            artifacts: [DATASET_API_PUBLISH_SOURCE_PATH, DATASET_API_PUBLISH_VALIDATION_PATH]
          }
        }
      ],
      outputs: [
        { name: DATASET_API_PUBLISH_SOURCE_PATH, format: 'jsonl', description: 'Validated publication source.' },
        { name: DATASET_API_PUBLISH_VALIDATION_PATH, format: 'json', description: 'Publication validation report.' }
      ],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  const processing = createDatasetProcessingService({ workspaceRoot: context.workspaceDirectory })
  const materialized = await processing.materialize({
    workspaceRoot: context.workspaceDirectory,
    planId: DATASET_API_PUBLISH_PLAN_ID,
    records: [
      { id: 'publish-1', value: 'TP53' },
      { id: 'publish-2', value: 'MDM2' }
    ],
    format: 'jsonl',
    outputFileName: 'publish-source.jsonl',
    parentArtifacts: ['fixtures/publish-grounding.json'],
    generation: { objective: 'Controlled publication fixture.', loopId: 'publish-fixture-loop' }
  })
  const sourcePath = join(context.workspaceDirectory, DATASET_API_PUBLISH_SOURCE_PATH)
  await linkFixtureArtifact(materialized.artifact.path, sourcePath)
  await linkFixtureArtifact(materialized.artifact.manifestPath, `${sourcePath}.manifest.json`)
  const validation = await processing.validate({
    workspaceRoot: context.workspaceDirectory,
    planId: DATASET_API_PUBLISH_PLAN_ID,
    inputArtifact: DATASET_API_PUBLISH_SOURCE_PATH,
    rules: [{ field: 'id', required: true }, { field: 'value', required: true }],
    minRecords: 2,
    failOnInvalid: true,
    outputFileName: 'publish-source.validation.json'
  })
  const validationPath = join(context.workspaceDirectory, DATASET_API_PUBLISH_VALIDATION_PATH)
  await linkFixtureArtifact(validation.artifact.path, validationPath)
  await linkFixtureArtifact(validation.artifact.manifestPath, `${validationPath}.manifest.json`)
  return {
    fixtureId: 'dataset-api.publish.v1',
    paths: [
      'fixtures/publish-grounding.json',
      DATASET_API_PUBLISH_SOURCE_PATH,
      `${DATASET_API_PUBLISH_SOURCE_PATH}.manifest.json`,
      DATASET_API_PUBLISH_VALIDATION_PATH,
      `${DATASET_API_PUBLISH_VALIDATION_PATH}.manifest.json`,
      relativePlanPath(DATASET_API_PUBLISH_PLAN_ID),
      relativeConfirmationPath(DATASET_API_PUBLISH_PLAN_ID)
    ],
    metadata: { planId: DATASET_API_PUBLISH_PLAN_ID, planPath, sourcePath: DATASET_API_PUBLISH_SOURCE_PATH, validationPath: DATASET_API_PUBLISH_VALIDATION_PATH, expectedRecords: 2 }
  }
}

async function linkFixtureArtifact(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await symlink(sourcePath, targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
}

async function prepareDatasetApiObjectStoreFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const requests: Array<{ method: string; pathname: string; search: string }> = []
  const objectBytes = Buffer.from('{"accession":"P04637","gene":"TP53"}\n')
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push({ method: request.method ?? 'GET', pathname: url.pathname, search: url.search })
    const pathParts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
    const key = pathParts.slice(1).join('/')
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
        '<Name>eval-bucket</Name><Prefix>fixture/</Prefix><KeyCount>1</KeyCount><MaxKeys>100</MaxKeys><IsTruncated>false</IsTruncated>',
        `<Contents><Key>${DATASET_API_EVAL_OBJECT_KEY}</Key><LastModified>2026-09-17T00:00:00.000Z</LastModified><ETag>"eval-etag"</ETag><Size>${objectBytes.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
        '</ListBucketResult>'
      ].join('')
      response.writeHead(200, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(xml) })
      response.end(xml)
      return
    }
    if ((request.method === 'HEAD' || request.method === 'GET') && key === DATASET_API_EVAL_OBJECT_KEY) {
      const headers = {
        'content-type': 'application/json',
        'content-length': objectBytes.byteLength,
        etag: '"eval-etag"',
        'last-modified': 'Thu, 17 Sep 2026 00:00:00 GMT',
        'x-amz-meta-source': 'controlled-fixture'
      }
      response.writeHead(200, headers)
      if (request.method === 'GET') response.end(objectBytes)
      else response.end()
      return
    }
    response.writeHead(404, { 'content-type': 'application/xml' })
    response.end('<Error><Code>NoSuchKey</Code></Error>')
  })
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to resolve the local object-store evaluation server port.')
  const suffix = context.runId.replace(/[^A-Za-z0-9]/gu, '_')
  const envNames = {
    accessKeyId: `SCIFORGE_EVAL_OBJECT_ACCESS_${suffix}`,
    secretAccessKey: `SCIFORGE_EVAL_OBJECT_SECRET_${suffix}`
  }
  const previousEnv = {
    accessKeyId: process.env[envNames.accessKeyId],
    secretAccessKey: process.env[envNames.secretAccessKey]
  }
  process.env[envNames.accessKeyId] = 'eval-access-key'
  process.env[envNames.secretAccessKey] = 'eval-secret-key'
  const objectStore = createDatasetObjectStoreService({ workspaceRoot: context.workspaceDirectory, env: process.env })
  await objectStore.register({
    workspaceRoot: context.workspaceDirectory,
    id: DATASET_API_EVAL_OBJECT_STORE_ID,
    name: 'Dataset API local object-store fixture',
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: 'eval-bucket',
    allowInsecureHttp: true,
    forcePathStyle: true,
    credentialEnv: envNames
  })
  DATASET_API_EVAL_OBJECT_SERVERS.set(`${context.caseId}:${context.runId}`, { server, requests, envNames, previousEnv })
  return {
    fixtureId: `dataset-api.${context.caseId}.v1`,
    paths: ['.sciforge/datasets/object-stores.json'],
    metadata: { sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, objectKey: DATASET_API_EVAL_OBJECT_KEY, server: 'loopback-s3-compatible' }
  }
}

async function prepareDatasetApiFilterValidateFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH)
  await writeJsonlFixture(inputPath, DATASET_API_FILTER_VALIDATE_EVAL_INPUT)
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_FILTER_VALIDATE_PLAN_ID,
    {
      objective: 'Filter the local fixture to scores at least 0.8 and validate the filtered artifact.',
      operations: [
        {
          tool: 'dataset_filter',
          description: 'Keep records with score >= 0.8.',
          parameters: {
            inputArtifact: DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
            conditions: DATASET_API_FILTER_CONDITIONS,
            combine: 'all',
            outputFileName: 'filtered.jsonl'
          }
        },
        {
          tool: 'dataset_validate',
          description: 'Validate the filtered records and score field.'
        }
      ],
      outputs: [
        { name: 'filtered.jsonl', format: 'jsonl', description: 'Scores at least 0.8.' },
        { name: 'validation.json', format: 'json', description: 'Validation report.' }
      ],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.filter-validate.jsonl.v1',
    paths: [
      DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
      relativePlanPath(DATASET_API_FILTER_VALIDATE_PLAN_ID),
      relativeConfirmationPath(DATASET_API_FILTER_VALIDATE_PLAN_ID)
    ],
    metadata: {
      inputPath: DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH,
      planId: DATASET_API_FILTER_VALIDATE_PLAN_ID,
      expectedFilteredRecords: 2,
      expectedValidation: true,
      planPath
    }
  }
}

async function prepareDatasetApiConfirmPlanDeniedFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID,
    {
      objective: 'Prepare a plan whose confirmation must be rejected by the evaluation harness.',
      operations: [{
        tool: 'dataset_filter',
        description: 'This operation must not execute without confirmation.'
      }],
      outputs: [{ name: 'blocked.jsonl', format: 'jsonl', description: 'Must not be written.' }],
      confirmationNotes: ['The evaluation harness intentionally denies confirmation.']
    },
    { approved: false }
  )
  return {
    fixtureId: 'dataset-api.confirm-plan-denied.v1',
    paths: [
      relativePlanPath(DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID),
      relativeConfirmationPath(DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID)
    ],
    metadata: {
      planId: DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID,
      confirmationExpected: false,
      planPath
    }
  }
}

async function prepareDatasetApiProcessingFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture> {
  const inputPath = join(context.workspaceDirectory, DATASET_API_PROCESSING_EVAL_INPUT_PATH)
  await writeJsonlFixture(inputPath, DATASET_API_PROCESSING_INPUT)
  const planPath = await writeDatasetPlanFixture(
    context.workspaceDirectory,
    DATASET_API_PROCESSING_PLAN_ID,
    {
      objective: 'Select stable identifiers, normalize the local values, and remove duplicate samples.',
      operations: [
        {
          tool: 'dataset_select_columns',
          description: 'Select the sample identifier, condition, and score fields.',
          parameters: {
            inputArtifact: DATASET_API_PROCESSING_EVAL_INPUT_PATH,
            columns: [
              { source: 'sample_id', target: 'id' },
              { source: 'condition' },
              { source: 'score' }
            ],
            outputFormat: 'jsonl',
            outputFileName: 'selected.jsonl'
          }
        },
        {
          tool: 'dataset_transform',
          description: 'Trim conditions and convert scores to numbers.',
          parameters: {
            inputArtifact: 'selected.jsonl',
            operations: [
              { operation: 'trim', field: 'condition' },
              { operation: 'to_number', field: 'score' }
            ],
            outputFormat: 'jsonl',
            outputFileName: 'transformed.jsonl'
          }
        },
        {
          tool: 'dataset_deduplicate',
          description: 'Keep the first record for each sample id.',
          parameters: {
            inputArtifact: 'transformed.jsonl',
            keys: ['id'],
            keep: 'first',
            outputFileName: 'deduplicated.jsonl'
          }
        }
      ],
      outputs: [
        { name: 'selected.jsonl', format: 'jsonl', description: 'Selected fields.' },
        { name: 'transformed.jsonl', format: 'jsonl', description: 'Normalized values.' },
        { name: 'deduplicated.jsonl', format: 'jsonl', description: 'Unique sample records.' }
      ],
      confirmationNotes: ['The plan is pre-confirmed as a controlled evaluation fixture.']
    },
    { approved: true }
  )
  return {
    fixtureId: 'dataset-api.processing.jsonl.v1',
    paths: [
      DATASET_API_PROCESSING_EVAL_INPUT_PATH,
      relativePlanPath(DATASET_API_PROCESSING_PLAN_ID),
      relativeConfirmationPath(DATASET_API_PROCESSING_PLAN_ID)
    ],
    metadata: {
      inputPath: DATASET_API_PROCESSING_EVAL_INPUT_PATH,
      planId: DATASET_API_PROCESSING_PLAN_ID,
      expectedInputRecords: DATASET_API_PROCESSING_INPUT.length,
      expectedOutputRecords: 3,
      planPath
    }
  }
}

async function inspectDatasetApiProfile(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  if (input.context.caseId !== DATASET_API_PROFILE_EVAL_CASE_ID) return undefined
  const profileInvocation = [...input.invocations].reverse().find((invocation) => (
    invocation.actionId === DATASET_API_CAPABILITY_IDS.profile && invocation.success
  ))
  if (!profileInvocation?.success) {
    return {
      taskSuccess: false,
      evidence: ['The Dataset API profile action did not have a successful terminal invocation.'],
      verifiedActions: []
    }
  }

  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, datasetProfileInputPath(input.context))
  const invokedInputArtifact = isRecord(profileInvocation.args)
    ? profileInvocation.args.inputArtifact
    : undefined
  const resolvedInvokedInput = typeof invokedInputArtifact === 'string'
    ? resolve(workspaceDirectory, invokedInputArtifact)
    : undefined
  const manifest = await findProfileManifest(workspaceDirectory, inputPath)
  if (!manifest) {
    return {
      taskSuccess: false,
      evidence: ['No dataset_profile artifact manifest was found for the package fixture input.'],
      verifiedActions: []
    }
  }
  if (typeof manifest.path !== 'string' || !manifest.path.trim()) {
    return {
      taskSuccess: false,
      evidence: ['The dataset_profile manifest did not identify a readable artifact path.'],
      verifiedActions: []
    }
  }
  const artifactPath = resolve(manifest.path)
  let artifactBytes: Buffer
  let profile: Record<string, unknown>
  try {
    artifactBytes = await readFile(artifactPath)
    const parsed = JSON.parse(artifactBytes.toString('utf8')) as unknown
    if (!isRecord(parsed)) throw new Error('profile report is not a JSON object')
    profile = parsed
  } catch (error) {
    return {
      taskSuccess: false,
      evidence: [`The dataset_profile artifact could not be independently read: ${errorMessage(error)}.`],
      verifiedActions: []
    }
  }
  const expectedFields = expectedProfileFields()
  let inputBytes: Buffer
  try {
    inputBytes = await readFile(inputPath)
  } catch (error) {
    return {
      taskSuccess: false,
      evidence: [`The package fixture could not be independently read: ${errorMessage(error)}.`],
      verifiedActions: []
    }
  }
  const parent = Array.isArray(manifest.parents) ? manifest.parents[0] as Record<string, unknown> | undefined : undefined
  const parentPath = typeof parent?.path === 'string' ? await canonicalPath(parent.path) : undefined
  const checks = [
    manifest.operation === 'dataset_profile',
    manifest.format === 'report',
    manifest.sha256 === sha256(artifactBytes),
    resolvedInvokedInput === inputPath,
    parentPath === inputPath,
    parent?.sha256 === sha256(inputBytes),
    profile.format === 'jsonl',
    profile.bytes === inputBytes.byteLength,
    profile.sha256 === sha256(inputBytes),
    profile.records === DATASET_API_PROFILE_EVAL_INPUT.length,
    JSON.stringify(profile.fields) === JSON.stringify(expectedFields)
  ]
  const evidence = [
    `Read independent profile artifact ${artifactPath}.`,
    `Read independent artifact manifest ${String(manifest.manifestPath)}.`,
    `Verified input parent ${inputPath} with sha256:${sha256(inputBytes)}.`,
    `Verified profile records=${String(profile.records)} and fields=${expectedFields.map((field) => field.name).join(',')}.`
  ]
  return {
    taskSuccess: checks.every(Boolean),
    finalState: {
      profiled: checks.every(Boolean),
      records: typeof profile.records === 'number' ? profile.records : null,
      fields: expectedFields.map((field) => field.name),
      artifactPath,
      inputPath
    },
    evidence,
    verifiedActions: checks.every(Boolean) ? [DATASET_API_CAPABILITY_IDS.profile] : []
  }
}

async function inspectDatasetApiEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const normalizedInput = {
    ...input,
    context: normalizeDatasetApiContext(input.context)
  }
  if (normalizedInput.context.caseId === DATASET_API_PROFILE_EVAL_CASE_ID) {
    return inspectDatasetApiProfile(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_CATALOG_EVAL_CASE_ID) {
    return inspectDatasetApiCatalog(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_LIST_EVAL_CASE_ID) {
    return inspectDatasetApiList(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_LIST_OBJECT_STORES_EVAL_CASE_ID) {
    return inspectDatasetApiListObjectStores(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_REGISTER_PROVIDER_EVAL_CASE_ID) {
    return inspectDatasetApiRegisterProvider(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_METADATA_EVAL_CASE_ID) {
    return inspectDatasetApiMetadata(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_RAW_DATA_EVAL_CASE_ID) {
    return inspectDatasetApiRawData(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_PUBLISH_EVAL_CASE_ID) {
    return inspectDatasetApiPublish(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_LIST_OBJECTS_EVAL_CASE_ID) {
    return inspectDatasetApiListObjects(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_OBJECT_METADATA_EVAL_CASE_ID) {
    return inspectDatasetApiObjectMetadata(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_OBJECT_RAW_DATA_EVAL_CASE_ID) {
    return inspectDatasetApiObjectRawData(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_JOIN_EVAL_CASE_ID) {
    return inspectDatasetApiJoin(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_STRUCTURE_PROFILE_EVAL_CASE_ID) {
    return inspectDatasetApiStructureProfile(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_STRUCTURE_VALIDATE_EVAL_CASE_ID) {
    return inspectDatasetApiStructureValidate(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_GRAPH_EVAL_CASE_ID) {
    return inspectDatasetApiGraph(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_PREPARE_PLAN_EVAL_CASE_ID) {
    return inspectDatasetApiPreparePlan(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_MATERIALIZE_EVAL_CASE_ID) {
    return inspectDatasetApiMaterialize(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_ID_MAP_EVAL_CASE_ID) {
    return inspectDatasetApiIdMap(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_ID_MAP_PROVIDER_EVAL_CASE_ID) {
    return inspectDatasetApiIdMapProvider(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_EXECUTE_PLAN_EVAL_CASE_ID) {
    return inspectDatasetApiExecutePlan(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_RESUME_PLAN_EVAL_CASE_ID) {
    return inspectDatasetApiResumePlan(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_FILTER_VALIDATE_EVAL_CASE_ID) {
    return inspectDatasetApiFilterValidate(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_CONFIRM_PLAN_DENIED_EVAL_CASE_ID) {
    return inspectDatasetApiConfirmPlanDenied(normalizedInput)
  }
  if (normalizedInput.context.caseId === DATASET_API_PROCESSING_EVAL_CASE_ID) {
    return inspectDatasetApiProcessing(normalizedInput)
  }
  return undefined
}

function inspectDatasetApiCatalog(input: Readonly<{
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): DomainCapabilityEvalOracleResult {
  const results = input.invocations
    .filter(({ actionId, success }) => actionId === DATASET_API_CAPABILITY_IDS.catalog && success)
    .map((invocation) => datasetApiResult(invocation.output))
  const providersById = new Map<string, Record<string, unknown>>()
  for (const result of results) {
    const resultRecord = isRecord(result) ? result : undefined
    const providers = Array.isArray(resultRecord?.providers)
      ? resultRecord.providers.filter((value) => isRecord(value)).map((value) => value as Record<string, unknown>)
      : []
    for (const provider of providers) {
      if (typeof provider.id === 'string') providersById.set(provider.id, provider)
    }
  }
  const providerIds = [...providersById.keys()]
  const passed = results.length > 0 &&
    ['ncbi-eutils', 'embl-ebi-search', 'uniprot'].every((id) => providerIds.includes(id)) &&
    results.some((result) => isRecord(result) && typeof result.note === 'string')
  return {
    taskSuccess: passed,
    finalState: { providerCount: providerIds.length, providerIds: providerIds.slice(0, 5), total: providerIds.length },
    evidence: ['Independently merged successful package-owned catalog responses and checked stable provider IDs plus the catalog note.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.catalog] : []
  }
}

function inspectDatasetApiList(input: Readonly<{
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): DomainCapabilityEvalOracleResult {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.list)
  const result = datasetApiResult(invocation?.output)
  const resultRecord = isRecord(result) ? result : undefined
  const sources = Array.isArray(resultRecord?.sources)
    ? resultRecord.sources.filter((value) => isRecord(value)).map((value) => value as Record<string, unknown>)
    : []
  const sourceIds = sources.map((source) => source.id).filter((id): id is string => typeof id === 'string')
  const registryPath = isRecord(result) && typeof result.registryPath === 'string' ? result.registryPath : ''
  const passed = invocation?.success === true && ['ncbi-eutils', 'ensembl', 'uniprot'].every((id) => sourceIds.includes(id)) &&
    sourceIds.length === sources.length && registryPath.endsWith('api-sources.json')
  return {
    taskSuccess: passed,
    finalState: { sourceCount: sources.length, sourceIds, registryPath },
    evidence: ['Independently checked the Dataset API source listing for built-in source IDs and registry path scope.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.list] : []
  }
}

async function inspectDatasetApiListObjectStores(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.listObjectStores)
  const result = datasetApiResult(invocation?.output)
  const stores = isRecord(result) && Array.isArray(result.stores) ? result.stores : []
  const registryPath = isRecord(result) && typeof result.registryPath === 'string' ? result.registryPath : ''
  const registry = await readJsonObject(join(await canonicalWorkspaceDirectory(input.context.workspaceDirectory), '.sciforge', 'datasets', 'object-stores.json'))
  const passed = invocation?.success === true && stores.length === 0 && registryPath.endsWith('object-stores.json') &&
    (!registry || !Array.isArray(registry.sources) || registry.sources.length === 0)
  return {
    taskSuccess: passed,
    finalState: { storeCount: stores.length, registryPath, registrySourceCount: Array.isArray(registry?.sources) ? registry.sources.length : 0 },
    evidence: ['Independently checked the workspace object-store registry and verified an empty, credential-safe listing.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.listObjectStores] : []
  }
}

async function inspectDatasetApiRegisterProvider(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.registerProvider)
  if (!invocation?.success) return failedOracle('The Dataset API register-provider action did not have a successful terminal invocation.')
  const result = datasetApiResult(invocation.output)
  const source = isRecord(result) && isRecord(result.source) ? result.source : undefined
  const usage = isRecord(result) && isRecord(result.usage) ? result.usage : undefined
  const registryPath = isRecord(result) && typeof result.registryPath === 'string' ? result.registryPath : undefined
  const registry = registryPath ? await readJsonObject(registryPath) : undefined
  const sources = Array.isArray(registry?.sources) ? registry.sources.filter(isRecord) : []
  const sourceIds = sources.map((candidate) => candidate.id).filter((value): value is string => typeof value === 'string')
  const metadataUsage = isRecord(usage?.metadata) ? usage.metadata : undefined
  const rawDataUsage = isRecord(usage?.rawData) ? usage.rawData : undefined
  const passed = isRecord(invocation.args) && invocation.args.providerId === 'uniprot' &&
    source?.id === 'uniprot' && sourceIds.includes('uniprot') &&
    metadataUsage?.sourceId === 'uniprot' && rawDataUsage?.sourceId === 'uniprot' &&
    registryPath?.endsWith('api-sources.json') === true
  return {
    taskSuccess: passed,
    finalState: { registered: passed, providerId: source?.id ?? null, sourceCount: sources.length, registryPath: registryPath ?? null },
    evidence: ['Read the independent workspace source registry and provider usage receipt.', 'Verified the executable UniProt preset was registered without a network fetch.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.registerProvider] : []
  }
}

async function inspectDatasetApiMetadata(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  await closeDatasetApiEvalHttpServer(input.context)
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.metadata)
  if (!invocation?.success) return failedOracle('The Dataset API metadata action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const manifest = await findServiceArtifactManifest(workspaceDirectory, 'metadata', DATASET_API_LOCAL_HTTP_SOURCE_ID, 'dataset_api_metadata')
  if (!manifest || typeof manifest.path !== 'string') return failedOracle('No independent Dataset API metadata artifact manifest was found.')
  const artifactPath = resolve(manifest.path)
  const artifact = await readJsonObject(artifactPath)
  const artifactBytes = await readFile(artifactPath).catch(() => undefined)
  const source = isRecord(manifest.source) ? manifest.source : undefined
  const checks = [
    isRecord(invocation.args) && invocation.args.sourceId === DATASET_API_LOCAL_HTTP_SOURCE_ID,
    isRecord(invocation.args) && isRecord(invocation.args.pathParameters) && invocation.args.pathParameters.identifier === 'P04637',
    manifest.operation === 'dataset_api_metadata',
    source?.id === DATASET_API_LOCAL_HTTP_SOURCE_ID,
    artifact?.primaryAccession === 'P04637',
    artifact?.gene === 'TP53',
    artifact?.fixture === 'local-http',
    artifactBytes !== undefined && manifest.sha256 === sha256(artifactBytes)
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { downloaded: passed, sourceId: DATASET_API_LOCAL_HTTP_SOURCE_ID, metadataArtifactPath: artifactPath, primaryAccession: typeof artifact?.primaryAccession === 'string' ? artifact.primaryAccession : null },
    evidence: [`Read independent metadata artifact ${artifactPath}.`, 'Verified the loopback provider identity, requested accession, response fields, and artifact checksum.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.metadata] : []
  }
}

async function inspectDatasetApiRawData(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  await closeDatasetApiEvalHttpServer(input.context)
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.rawData)
  if (!invocation?.success) return failedOracle('The Dataset API raw-data action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const manifest = await findServiceArtifactManifest(workspaceDirectory, 'raw', DATASET_API_LOCAL_HTTP_SOURCE_ID, 'dataset_api_raw_data')
  if (!manifest || typeof manifest.path !== 'string') return failedOracle('No independent Dataset API raw-data artifact manifest was found.')
  const artifactPath = resolve(manifest.path)
  const artifactBytes = await readFile(artifactPath).catch(() => undefined)
  const source = isRecord(manifest.source) ? manifest.source : undefined
  const text = artifactBytes?.toString('utf8') ?? ''
  const checks = [
    isRecord(invocation.args) && invocation.args.sourceId === DATASET_API_LOCAL_HTTP_SOURCE_ID,
    isRecord(invocation.args) && isRecord(invocation.args.pathParameters) && invocation.args.pathParameters.identifier === 'P04637',
    manifest.operation === 'dataset_api_raw_data',
    source?.id === DATASET_API_LOCAL_HTTP_SOURCE_ID,
    text === '>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n',
    manifest.format === 'fasta',
    artifactBytes !== undefined && manifest.sha256 === sha256(artifactBytes)
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { downloaded: passed, sourceId: DATASET_API_LOCAL_HTTP_SOURCE_ID, rawArtifactPath: artifactPath, bytes: artifactBytes?.byteLength ?? null },
    evidence: [`Read independent raw-data artifact ${artifactPath}.`, 'Verified the loopback provider identity, requested accession, FASTA content, format, and artifact checksum.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.rawData] : []
  }
}

async function inspectDatasetApiPublish(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.publish)
  if (!invocation?.success) return failedOracle('The Dataset API publish action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const sourcePath = await canonicalPath(resolve(workspaceDirectory, DATASET_API_PUBLISH_SOURCE_PATH))
  const validationPath = await canonicalPath(resolve(workspaceDirectory, DATASET_API_PUBLISH_VALIDATION_PATH))
  const releaseDirectory = join(workspaceDirectory, '.sciforge', 'datasets', 'published', 'eval-publish', DATASET_API_PUBLISH_PLAN_ID)
  const manifestPath = join(releaseDirectory, 'manifest.json')
  const manifest = await readJsonObject(manifestPath)
  if (!manifest) return failedOracle('No independent Dataset API publication manifest was found.')
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts.filter(isRecord) : []
  const quality = isRecord(manifest.quality) ? manifest.quality : undefined
  const releaseFiles = isRecord(manifest.releaseFiles) ? manifest.releaseFiles : undefined
  const artifactSources = artifacts.map((artifact) => artifact.sourcePath).filter((value): value is string => typeof value === 'string')
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_PUBLISH_PLAN_ID,
    isRecord(invocation.args) && invocation.args.name === 'eval-publish',
    isRecord(invocation.args) && Array.isArray(invocation.args.artifacts) && invocation.args.artifacts.includes(DATASET_API_PUBLISH_SOURCE_PATH) && invocation.args.artifacts.includes(DATASET_API_PUBLISH_VALIDATION_PATH),
    manifest.name === 'eval-publish',
    manifest.planId === DATASET_API_PUBLISH_PLAN_ID,
    artifacts.length === 2,
    artifactSources.some((value) => resolve(value) === sourcePath),
    artifactSources.some((value) => resolve(value) === validationPath),
    quality?.validationReportCount === 1,
    quality?.status === 'passed',
    releaseFiles !== undefined && typeof releaseFiles.manifestPath === 'string' && await fileExists(releaseFiles.manifestPath),
    releaseFiles !== undefined && typeof releaseFiles.schemaPath === 'string' && await fileExists(releaseFiles.schemaPath),
    releaseFiles !== undefined && typeof releaseFiles.qualityReportPath === 'string' && await fileExists(releaseFiles.qualityReportPath),
    releaseFiles !== undefined && typeof releaseFiles.preparationPlanPath === 'string' && await fileExists(releaseFiles.preparationPlanPath),
    releaseFiles !== undefined && typeof releaseFiles.checksumsPath === 'string' && await fileExists(releaseFiles.checksumsPath)
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { published: passed, name: 'eval-publish', planId: DATASET_API_PUBLISH_PLAN_ID, artifactCount: artifacts.length, validationReportCount: typeof quality?.validationReportCount === 'number' ? quality.validationReportCount : null, manifestPath },
    evidence: [`Read independent publication manifest ${manifestPath}.`, 'Verified validated source coverage, publication quality status, release files, and checksums.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.publish] : []
  }
}

async function inspectDatasetApiListObjects(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const serverState = await closeDatasetApiEvalObjectServer(input.context)
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.listObjects)
  if (!invocation?.success) return failedOracle('The Dataset API list-objects action did not have a successful terminal invocation.')
  const result = datasetApiResult(invocation.output)
  const resultRecord = isRecord(result) ? result : undefined
  const objects = Array.isArray(resultRecord?.objects)
    ? resultRecord.objects.filter((value) => isRecord(value)).map((value) => value as Record<string, unknown>)
    : []
  const requests = serverState?.requests ?? []
  const request = requests.find((candidate) => candidate.method === 'GET' && candidate.search.includes('list-type=2'))
  const passed = isRecord(invocation.args) && invocation.args.sourceId === DATASET_API_EVAL_OBJECT_STORE_ID &&
    request?.pathname === `/eval-bucket/` && objects.some((object) => object.key === DATASET_API_EVAL_OBJECT_KEY) &&
    resultRecord?.keyCount === 1 && resultRecord.isTruncated === false
  return {
    taskSuccess: passed,
    finalState: { listed: passed, sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, objectCount: objects.length, keys: objects.map((object) => object.key).filter((value): value is string => typeof value === 'string') },
    evidence: ['Verified the local S3-compatible server received a bounded ListObjectsV2 request.', 'Checked the returned object key, count, and non-truncated page.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.listObjects] : []
  }
}

async function inspectDatasetApiObjectMetadata(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const serverState = await closeDatasetApiEvalObjectServer(input.context)
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.objectMetadata)
  if (!invocation?.success) return failedOracle('The Dataset API object-metadata action did not have a successful terminal invocation.')
  const result = datasetApiResult(invocation.output)
  const resultRecord = isRecord(result) ? result : undefined
  const metadata = isRecord(resultRecord?.metadata) ? resultRecord.metadata : undefined
  const request = serverState?.requests.find((candidate) => candidate.method === 'HEAD' && candidate.pathname.endsWith(DATASET_API_EVAL_OBJECT_KEY))
  const passed = isRecord(invocation.args) && invocation.args.sourceId === DATASET_API_EVAL_OBJECT_STORE_ID && invocation.args.key === DATASET_API_EVAL_OBJECT_KEY &&
    request !== undefined && metadata?.key === DATASET_API_EVAL_OBJECT_KEY && metadata.size === 37 && metadata.etag === 'eval-etag' && metadata.contentType === 'application/json'
  return {
    taskSuccess: passed,
    finalState: { inspected: passed, sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, key: typeof metadata?.key === 'string' ? metadata.key : null, size: typeof metadata?.size === 'number' ? metadata.size : null },
    evidence: ['Verified the local S3-compatible server received a HEAD request for the exact object key.', 'Checked size, ETag, and content type from the metadata response.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.objectMetadata] : []
  }
}

async function inspectDatasetApiObjectRawData(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const serverState = await closeDatasetApiEvalObjectServer(input.context)
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.objectRawData)
  if (!invocation?.success) return failedOracle('The Dataset API object-raw-data action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const manifest = await findServiceArtifactManifest(workspaceDirectory, 'raw', DATASET_API_EVAL_OBJECT_STORE_ID, 'dataset_object_raw_data')
  const artifact = manifest && isRecord(manifest.artifact) ? manifest.artifact : undefined
  if (!manifest || typeof artifact?.path !== 'string') return failedOracle('No independent object-store raw-data manifest was found.')
  const artifactPath = resolve(artifact.path)
  const artifactBytes = await readFile(artifactPath).catch(() => undefined)
  const getRequest = serverState?.requests.find((candidate) => candidate.method === 'GET' && candidate.pathname.endsWith(DATASET_API_EVAL_OBJECT_KEY) && !candidate.search.includes('list-type=2'))
  const text = artifactBytes?.toString('utf8') ?? ''
  const passed = isRecord(invocation.args) && invocation.args.sourceId === DATASET_API_EVAL_OBJECT_STORE_ID && invocation.args.key === DATASET_API_EVAL_OBJECT_KEY &&
    getRequest !== undefined && text === '{"accession":"P04637","gene":"TP53"}\n' && manifest.operation === 'dataset_object_raw_data' && artifact.format === 'json' &&
    artifactBytes !== undefined && artifact.sha256 === sha256(artifactBytes)
  return {
    taskSuccess: passed,
    finalState: { downloaded: passed, sourceId: DATASET_API_EVAL_OBJECT_STORE_ID, key: DATASET_API_EVAL_OBJECT_KEY, bytes: artifactBytes?.byteLength ?? null, artifactPath },
    evidence: [`Read independent object-store artifact ${artifactPath}.`, 'Verified the GET request, JSON body, format, and manifest checksum.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.objectRawData] : []
  }
}

async function inspectDatasetApiJoin(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId, success }) => (
    actionId === DATASET_API_CAPABILITY_IDS.join && success
  ))
  if (!invocation?.success) return failedOracle('The Dataset API join action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const leftPath = resolve(workspaceDirectory, DATASET_API_JOIN_LEFT_PATH)
  const rightPath = resolve(workspaceDirectory, DATASET_API_JOIN_RIGHT_PATH)
  const joinManifest = await findOperationManifest(workspaceDirectory, 'dataset_join', leftPath)
  const rightParentManifest = await findOperationManifest(workspaceDirectory, 'dataset_join', rightPath)
  if (!joinManifest || !rightParentManifest || typeof joinManifest.path !== 'string' || joinManifest.path !== rightParentManifest.path) {
    return failedOracle('No independent dataset_join manifest with both package fixture parents was found.')
  }
  const outputPath = resolve(joinManifest.path)
  const outputBytes = await readFile(outputPath).catch(() => undefined)
  const leftUnmatchedManifest = await findOperationManifest(workspaceDirectory, 'dataset_join_unmatched_left', leftPath)
  const rightUnmatchedManifest = await findOperationManifest(workspaceDirectory, 'dataset_join_unmatched_right', rightPath)
  const leftUnmatchedRows = leftUnmatchedManifest && typeof leftUnmatchedManifest.path === 'string'
    ? await readJsonArray(resolve(leftUnmatchedManifest.path))
    : []
  const rightUnmatchedRows = rightUnmatchedManifest && typeof rightUnmatchedManifest.path === 'string'
    ? await readJsonArray(resolve(rightUnmatchedManifest.path))
    : []
  const outputText = outputBytes?.toString('utf8') ?? ''
  const checks = [
    invocationPath(invocation, 'leftArtifact', workspaceDirectory) === leftPath,
    invocationPath(invocation, 'rightArtifact', workspaceDirectory) === rightPath,
    invocation.args && isRecord(invocation.args) && invocation.args.joinType === 'full',
    joinManifest.operation === 'dataset_join',
    joinManifest.format === 'tsv',
    joinManifest.records === 3,
    outputBytes !== undefined && joinManifest.sha256 === sha256(outputBytes),
    outputText.trim().split(/\r?\n/u).length === 4,
    outputText.includes('P04637') && outputText.includes('R-HSA-69563'),
    outputText.includes('Q9TEST') && outputText.includes('P99999'),
    await manifestHasParent(joinManifest, leftPath, sha256(await readFile(leftPath))),
    await manifestHasParent(joinManifest, rightPath, sha256(await readFile(rightPath))),
    leftUnmatchedRows.length === 1 && isRecord(leftUnmatchedRows[0]) && leftUnmatchedRows[0].accession === 'Q9TEST',
    rightUnmatchedRows.length === 1 && isRecord(rightUnmatchedRows[0]) && rightUnmatchedRows[0].protein_id === 'P99999',
    leftUnmatchedManifest ? await manifestMatchesFile(leftUnmatchedManifest) : false,
    rightUnmatchedManifest ? await manifestMatchesFile(rightUnmatchedManifest) : false
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: {
      joined: passed,
      leftRecords: 2,
      rightRecords: 2,
      outputRecords: 3,
      unmatchedLeftRecords: leftUnmatchedRows.length,
      unmatchedRightRecords: rightUnmatchedRows.length,
      artifactPath: outputPath
    },
    evidence: [
      `Read independent full-join artifact ${outputPath}.`,
      'Verified both fixture parents, full-join content, unmatched-left/right artifacts, and manifest checksums.'
    ],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.join] : []
  }
}

async function inspectDatasetApiStructureProfile(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.structureProfile)
  if (!invocation?.success) return failedOracle('The Dataset API structure-profile action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_STRUCTURE_INPUT_PATH)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_structure_profile', inputPath)
  if (!manifest || typeof manifest.path !== 'string') return failedOracle('No dataset_structure_profile manifest was found for the package structure fixture.')
  const artifactPath = resolve(manifest.path)
  const profile = await readJsonObject(artifactPath)
  const details = isRecord(profile?.details) ? profile.details : undefined
  const propertyFields = Array.isArray(details?.propertyFields) ? details.propertyFields : []
  const propertyNames = propertyFields
    .filter((value) => isRecord(value))
    .map((value) => value.name)
    .filter((value): value is string => typeof value === 'string')
  const profileFormat = typeof profile?.format === 'string' ? profile.format : null
  const profileRecords = typeof profile?.records === 'number' ? profile.records : null
  const profileCoordinateRecords = typeof profile?.coordinateRecords === 'number' ? profile.coordinateRecords : null
  const checks = [
    invocationPath(invocation, 'inputArtifact', workspaceDirectory) === inputPath,
    manifest.operation === 'dataset_structure_profile',
    manifest.format === 'report',
    await manifestMatchesFile(manifest),
    await manifestHasParent(manifest, inputPath, sha256(await readFile(inputPath))),
    profileFormat === 'sdf',
    profileRecords === 1,
    profileCoordinateRecords === 2,
    propertyNames.includes('CHEMBL_ID'),
    propertyNames.includes('ACTIVITY')
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { profiled: passed, format: profileFormat, records: profileRecords, coordinateRecords: profileCoordinateRecords, propertyFields: propertyNames, artifactPath },
    evidence: [`Read independent SDF structure profile ${artifactPath}.`, 'Verified parent checksum, molecule count, coordinate count, and property fields.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.structureProfile] : []
  }
}

async function inspectDatasetApiStructureValidate(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.structureValidate)
  if (!invocation?.success) return failedOracle('The Dataset API structure-validate action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_STRUCTURE_INPUT_PATH)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_structure_validate', inputPath)
  if (!manifest || typeof manifest.path !== 'string') return failedOracle('No dataset_structure_validate manifest was found for the package structure fixture.')
  const artifactPath = resolve(manifest.path)
  const validation = await readJsonObject(artifactPath)
  const validationFormat = typeof validation?.format === 'string' ? validation.format : null
  const validationRecords = typeof validation?.records === 'number' ? validation.records : null
  const validationCoordinateRecords = typeof validation?.coordinateRecords === 'number' ? validation.coordinateRecords : null
  const validationErrorCount = typeof validation?.errorCount === 'number' ? validation.errorCount : null
  const checks = [
    invocationPath(invocation, 'inputArtifact', workspaceDirectory) === inputPath,
    manifest.operation === 'dataset_structure_validate',
    manifest.format === 'report',
    await manifestMatchesFile(manifest),
    await manifestHasParent(manifest, inputPath, sha256(await readFile(inputPath))),
    validation?.valid === true,
    validationFormat === 'sdf',
    validationRecords === 1,
    validationCoordinateRecords === 2,
    validationErrorCount === 0
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { validated: passed, valid: validation?.valid === true, format: validationFormat, records: validationRecords, coordinateRecords: validationCoordinateRecords, errorCount: validationErrorCount, artifactPath },
    evidence: [`Read independent SDF structure validation report ${artifactPath}.`, 'Verified parent checksum, valid=true, zero errors, and coordinate coverage.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.structureValidate] : []
  }
}

async function inspectDatasetApiGraph(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.graphOrganize)
  if (!invocation?.success) return failedOracle('The Dataset API graph-organize action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_GRAPH_INPUT_PATH)
  const graphManifest = await findOperationManifestAny(workspaceDirectory, 'dataset_graph_organize')
  const nodesManifest = await findOperationManifest(workspaceDirectory, 'dataset_graph_nodes', inputPath)
  const edgesManifest = await findOperationManifest(workspaceDirectory, 'dataset_graph_edges', inputPath)
  const invalidManifest = await findOperationManifest(workspaceDirectory, 'dataset_graph_invalid', inputPath)
  if (!graphManifest || !nodesManifest || !edgesManifest || !invalidManifest || typeof graphManifest.path !== 'string' || typeof nodesManifest.path !== 'string' || typeof edgesManifest.path !== 'string' || typeof invalidManifest.path !== 'string') {
    return failedOracle('The graph report or one of its independently materialized node, edge, or invalid-record artifacts is missing.')
  }
  const graphPath = resolve(graphManifest.path)
  const graph = await readJsonObject(graphPath)
  const nodes = await readJsonArray(resolve(nodesManifest.path))
  const edges = await readJsonArray(resolve(edgesManifest.path))
  const invalid = await readJsonArray(resolve(invalidManifest.path))
  const counts = isRecord(graph?.counts) ? graph.counts : undefined
  const checks = [
    invocationPath(invocation, 'inputArtifact', workspaceDirectory) === inputPath,
    graphManifest.operation === 'dataset_graph_organize',
    graphManifest.format === 'report',
    await manifestMatchesFile(graphManifest),
    await manifestHasParent(graphManifest, resolve(nodesManifest.path), String(graph?.nodes && isRecord(graph.nodes) ? graph.nodes.sha256 : '')),
    await manifestHasParent(graphManifest, resolve(edgesManifest.path), String(graph?.edges && isRecord(graph.edges) ? graph.edges.sha256 : '')),
    await manifestHasParent(graphManifest, resolve(invalidManifest.path), String(graph?.invalid && isRecord(graph.invalid) ? graph.invalid.sha256 : '')),
    counts?.inputRecords === 4,
    counts?.nodeRecords === 2,
    counts?.edgeRecords === 1,
    counts?.invalidRecords === 2,
    counts?.duplicateEdgesRemoved === 1,
    nodes.length === 2,
    edges.length === 1,
    invalid.length === 2,
    await manifestMatchesFile(nodesManifest),
    await manifestMatchesFile(edgesManifest),
    await manifestMatchesFile(invalidManifest)
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { organized: passed, inputRecords: 4, nodeRecords: nodes.length, edgeRecords: edges.length, invalidRecords: invalid.length, duplicateEdgesRemoved: 1, graphArtifactPath: graphPath },
    evidence: [`Read independent graph report ${graphPath}.`, 'Verified node, edge, invalid-record artifacts, parent lineage, duplicate-edge removal, and graph counts.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.graphOrganize] : []
  }
}

async function inspectDatasetApiPreparePlan(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.preparePlan)
  if (!invocation?.success) return failedOracle('The Dataset API prepare-plan action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const plansDirectory = join(workspaceDirectory, '.sciforge', 'datasets', 'plans')
  let plan: Record<string, unknown> | undefined
  try {
    const entries = await readdir(plansDirectory)
    for (const entry of entries.filter((candidate) => candidate.endsWith('.json') && !candidate.endsWith('.confirmation.json'))) {
      const candidate = parseJsonObject(await readFile(join(plansDirectory, entry)))
      const operations = Array.isArray(candidate?.operations) ? candidate.operations.filter((value) => isRecord(value)) : []
      if (candidate?.status === 'draft' && operations.some((operation) => operation.tool === 'dataset_materialize')) {
        plan = candidate
        break
      }
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  if (!plan || typeof plan.planId !== 'string') return failedOracle('No draft materialization plan was independently found after prepare-plan.')
  const planPath = join(plansDirectory, `${plan.planId}.json`)
  const pipelinePath = join(plansDirectory, `${plan.planId}.md`)
  const planBytes = await readFile(planPath).catch(() => undefined)
  const pipelineBytes = await readFile(pipelinePath).catch(() => undefined)
  const checks = [
    planBytes !== undefined,
    pipelineBytes !== undefined && pipelineBytes.toString('utf8').includes('dataset_materialize'),
    Array.isArray(plan.operations) && plan.operations.length > 0,
    Array.isArray(plan.outputs) && plan.outputs.length > 0,
    typeof plan.objective === 'string' && plan.objective.length > 0
  ]
  const passed = checks.every(Boolean)
  const planStatus = typeof plan.status === 'string' ? plan.status : null
  return {
    taskSuccess: passed,
    finalState: { prepared: passed, status: planStatus, planId: plan.planId, operationCount: Array.isArray(plan.operations) ? plan.operations.length : 0, planPath, pipelinePath },
    evidence: [`Read independent draft plan ${planPath} and pipeline ${pipelinePath}.`, 'Verified the draft contains a materialization operation and declared output.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.preparePlan] : []
  }
}

async function inspectDatasetApiMaterialize(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.materialize)
  if (!invocation?.success) return failedOracle('The Dataset API materialize action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const parentPath = resolve(workspaceDirectory, DATASET_API_MATERIALIZE_PARENT_PATH)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_materialize', parentPath)
  if (!manifest || typeof manifest.path !== 'string') return failedOracle('No dataset_materialize manifest was found with the package grounding parent.')
  const artifactPath = resolve(manifest.path)
  const rows = await readJsonlRows(artifactPath)
  const parameters = isRecord(manifest.parameters) ? manifest.parameters : undefined
  const generation = isRecord(parameters?.generation) ? parameters.generation : undefined
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_MATERIALIZE_PLAN_ID,
    manifest.operation === 'dataset_materialize',
    manifest.format === 'jsonl',
    manifest.records === 2,
    rows.length === 2 && rows.every((row) => isRecord(row) && typeof row.id === 'string' && typeof row.question === 'string' && typeof row.answer === 'string'),
    await manifestMatchesFile(manifest),
    await manifestHasParent(manifest, parentPath, sha256(await readFile(parentPath))),
    generation?.objective === 'Create grounded TP53 questions.',
    generation?.loopId === 'tp53-generation-loop'
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { materialized: passed, records: rows.length, artifactPath, parentPath, generationLoopId: typeof generation?.loopId === 'string' ? generation.loopId : null },
    evidence: [`Read independent materialized JSONL artifact ${artifactPath}.`, 'Verified generated record content, parent provenance, manifest checksum, and generation metadata.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.materialize] : []
  }
}

async function inspectDatasetApiIdMap(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.idMap)
  if (!invocation?.success) return failedOracle('The Dataset API id-map action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_ID_MAP_INPUT_PATH)
  const mappingPath = resolve(workspaceDirectory, DATASET_API_ID_MAP_MAPPING_PATH)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map', inputPath)
  const unmatchedManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map_unmatched', inputPath)
  const ambiguousManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map_ambiguous', inputPath)
  if (!manifest || !unmatchedManifest || !ambiguousManifest || typeof manifest.path !== 'string' || typeof unmatchedManifest.path !== 'string' || typeof ambiguousManifest.path !== 'string') {
    return failedOracle('The id-map output or its unmatched/ambiguous independent evidence artifacts are missing.')
  }
  const artifactPath = resolve(manifest.path)
  const outputText = (await readFile(artifactPath).catch(() => Buffer.from(''))).toString('utf8')
  const unmatched = await readJsonArray(resolve(unmatchedManifest.path))
  const ambiguous = await readJsonArray(resolve(ambiguousManifest.path))
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_ID_MAP_PLAN_ID,
    invocationPath(invocation, 'inputArtifact', workspaceDirectory) === inputPath,
    invocationPath(invocation, 'mappingArtifact', workspaceDirectory) === mappingPath,
    manifest.operation === 'dataset_id_map',
    manifest.format === 'tsv',
    manifest.records === 2,
    outputText.includes('P04637\tTP53\tENSG00000141510') && outputText.includes('P04637\tTP53\tENST00000269305'),
    unmatched.length === 1 && isRecord(unmatched[0]) && unmatched[0].inputId === 'Q9UNMAPPED',
    ambiguous.length === 1 && isRecord(ambiguous[0]) && Array.isArray(ambiguous[0].targets),
    await manifestMatchesFile(manifest),
    await manifestMatchesFile(unmatchedManifest),
    await manifestMatchesFile(ambiguousManifest),
    await manifestHasParent(manifest, inputPath, sha256(await readFile(inputPath))),
    await manifestHasParent(manifest, mappingPath, sha256(await readFile(mappingPath)))
  ]
  const passed = checks.every(Boolean)
  const outputRecords = typeof manifest.records === 'number' ? manifest.records : null
  return {
    taskSuccess: passed,
    finalState: { mapped: passed, outputRecords, unmatchedRecords: unmatched.length, ambiguousRecords: ambiguous.length, artifactPath },
    evidence: [`Read independent id-map artifact ${artifactPath}.`, 'Verified local mapping content, unmatched and ambiguous evidence, parent checksums, and output manifest.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.idMap] : []
  }
}

async function inspectDatasetApiIdMapProvider(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.idMapProvider)
  if (!invocation?.success) return failedOracle('The Dataset API provider id-map action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_ID_MAP_PROVIDER_INPUT_PATH)
  const providerManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map_provider_mapping', inputPath)
  if (!providerManifest || typeof providerManifest.path !== 'string') {
    return failedOracle('The provider mapping artifact or its independent manifest is missing.')
  }
  const providerArtifactPath = resolve(providerManifest.path)
  const providerRows = await readJsonArray(providerArtifactPath)
  const providerOrigin = Array.isArray(providerManifest.origins) && isRecord(providerManifest.origins[0])
    ? providerManifest.origins[0]
    : undefined
  const providerResponse = isRecord(providerOrigin?.response) ? providerOrigin.response : undefined
  const finalManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map', inputPath)
  const unmatchedManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map_unmatched', inputPath)
  const ambiguousManifest = await findOperationManifest(workspaceDirectory, 'dataset_id_map_ambiguous', inputPath)
  if (!finalManifest || typeof finalManifest.path !== 'string' || !unmatchedManifest || !ambiguousManifest) {
    return failedOracle('The provider-backed final mapping or independent unmatched/ambiguous evidence artifacts are missing.')
  }
  const finalArtifactPath = resolve(finalManifest.path)
  const finalRows = await readJsonArray(finalArtifactPath)
  const unmatched = typeof unmatchedManifest.path === 'string'
    ? await readJsonArray(resolve(unmatchedManifest.path))
    : []
  const ambiguous = typeof ambiguousManifest.path === 'string'
    ? await readJsonArray(resolve(ambiguousManifest.path))
    : []
  const harness = DATASET_API_EVAL_PROVIDER_HARNESSES.get(`${input.context.caseId}:${input.context.runId}`)
  const inputBytes = await readFile(inputPath).catch(() => undefined)
  const providerBytes = await readFile(providerArtifactPath).catch(() => undefined)
  const finalBytes = await readFile(finalArtifactPath).catch(() => undefined)
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_ID_MAP_PROVIDER_PLAN_ID,
    isRecord(invocation.args) && invocation.args.provider === 'uniprot',
    isRecord(invocation.args) && invocation.args.fromDatabase === 'UniProtKB_AC-ID',
    isRecord(invocation.args) && invocation.args.toDatabase === 'Ensembl',
    invocationPath(invocation, 'inputArtifact', workspaceDirectory) === inputPath,
    providerManifest.operation === 'dataset_id_map_provider_mapping',
    providerManifest.format === 'json',
    providerManifest.records === 2,
    providerRows.some((row) => isRecord(row) && row.from === 'P04637' && row.to === 'ENSG00000141510'),
    providerRows.some((row) => isRecord(row) && row.from === 'P38398' && row.to === 'ENSG00000012048'),
    providerResponse?.jobId === 'evaljob',
    providerResponse?.mappingRecords === 2,
    providerResponse?.failedIdCount === 1,
    finalManifest.operation === 'dataset_id_map',
    finalManifest.format === 'json',
    finalManifest.records === 2,
    finalRows.some((row) => isRecord(row) && row.accession === 'P04637' && row.ensembl_id === 'ENSG00000141510'),
    finalRows.some((row) => isRecord(row) && row.accession === 'P38398' && row.ensembl_id === 'ENSG00000012048'),
    unmatched.length === 1 && isRecord(unmatched[0]) && unmatched[0].inputId === 'BAD',
    ambiguous.length === 0,
    harness?.statusCalls === 3,
    harness?.requestLog.filter((entry) => entry.endsWith('/idmapping/status/evaljob')).length === 3,
    harness?.requestLog.some((entry) => entry.includes('/idmapping/run')),
    harness?.requestLog.some((entry) => entry.includes('/idmapping/details/evaljob')),
    harness?.requestLog.some((entry) => entry.includes('/idmapping/stream/evaljob?format=json')),
    inputBytes !== undefined && await manifestHasParent(providerManifest, inputPath, sha256(inputBytes)),
    providerBytes !== undefined && await manifestMatchesFile(providerManifest),
    providerBytes !== undefined && await manifestHasParent(finalManifest, providerArtifactPath, sha256(providerBytes)),
    inputBytes !== undefined && await manifestHasParent(finalManifest, inputPath, sha256(inputBytes)),
    finalBytes !== undefined && await manifestMatchesFile(finalManifest),
    await manifestMatchesFile(unmatchedManifest),
    await manifestMatchesFile(ambiguousManifest)
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: {
      mapped: passed,
      providerJobId: typeof providerResponse?.jobId === 'string' ? providerResponse.jobId : null,
      providerStatusCalls: harness?.statusCalls ?? null,
      providerRecords: providerRows.length,
      outputRecords: finalRows.length,
      unmatchedRecords: unmatched.length,
      ambiguousRecords: ambiguous.length,
      artifactPath: finalArtifactPath
    },
    evidence: [
      `Read independent provider mapping artifact ${providerArtifactPath} and final artifact ${finalArtifactPath}.`,
      'Verified the case-scoped provider submission, retry/poll sequence, result provenance, output lineage, and unmatched-record evidence.'
    ],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.idMapProvider] : []
  }
}

async function inspectDatasetApiExecutePlan(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.executePlan)
  if (!invocation?.success) return failedOracle('The Dataset API execute-plan action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_EXECUTE_PLAN_INPUT_PATH)
  const state = await findExecutionState(workspaceDirectory, DATASET_API_EXECUTE_PLAN_ID)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_profile', inputPath)
  const profile = manifest && typeof manifest.path === 'string' ? await readJsonObject(resolve(manifest.path)) : undefined
  const steps = Array.isArray(state?.steps) ? state.steps.filter(isRecord) : []
  const firstStep = steps[0]
  const statePath = typeof state?.statePath === 'string' ? state.statePath : undefined
  const reportPath = statePath ? statePath.replace(/\.json$/iu, '.md') : undefined
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_EXECUTE_PLAN_ID,
    state?.planId === DATASET_API_EXECUTE_PLAN_ID,
    state?.status === 'succeeded',
    steps.length === 1,
    firstStep?.tool === 'dataset_profile' && firstStep.status === 'succeeded',
    firstStep?.attempts === 1,
    reportPath !== undefined && await fileExists(reportPath),
    profile?.records === 2,
    manifest !== undefined && await manifestMatchesFile(manifest),
    manifest !== undefined && await manifestHasParent(manifest, inputPath, sha256(await readFile(inputPath)))
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { executed: passed, planId: DATASET_API_EXECUTE_PLAN_ID, status: typeof state?.status === 'string' ? state.status : null, completedSteps: steps.filter((step) => step.status === 'succeeded').length, artifactPath: typeof manifest?.path === 'string' ? manifest.path : null },
    evidence: ['Read the durable execution checkpoint and report produced by the plan executor.', 'Verified the confirmed plan completed its profile step and preserved the fixture parent checksum.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.executePlan] : []
  }
}

async function inspectDatasetApiResumePlan(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = input.invocations.find(({ actionId }) => actionId === DATASET_API_CAPABILITY_IDS.resumePlan)
  if (!invocation?.success) return failedOracle('The Dataset API resume-plan action did not have a successful terminal invocation.')
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_RESUME_PLAN_INPUT_PATH)
  const state = await findExecutionState(workspaceDirectory, DATASET_API_RESUME_PLAN_ID)
  const manifest = await findOperationManifest(workspaceDirectory, 'dataset_profile', inputPath)
  const profile = manifest && typeof manifest.path === 'string' ? await readJsonObject(resolve(manifest.path)) : undefined
  const steps = Array.isArray(state?.steps) ? state.steps.filter(isRecord) : []
  const firstStep = steps[0]
  const statePath = typeof state?.statePath === 'string' ? state.statePath : undefined
  const reportPath = statePath ? statePath.replace(/\.json$/iu, '.md') : undefined
  const checks = [
    isRecord(invocation.args) && invocation.args.planId === DATASET_API_RESUME_PLAN_ID,
    state?.planId === DATASET_API_RESUME_PLAN_ID,
    state?.status === 'succeeded',
    firstStep?.status === 'succeeded',
    typeof firstStep?.attempts === 'number' && firstStep.attempts >= 2,
    reportPath !== undefined && await fileExists(reportPath),
    profile?.records === 2,
    manifest !== undefined && await manifestMatchesFile(manifest),
    manifest !== undefined && await manifestHasParent(manifest, inputPath, sha256(await readFile(inputPath)))
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: { resumed: passed, planId: DATASET_API_RESUME_PLAN_ID, status: typeof state?.status === 'string' ? state.status : null, attempts: typeof firstStep?.attempts === 'number' ? firstStep.attempts : null, artifactPath: typeof manifest?.path === 'string' ? manifest.path : null },
    evidence: ['Read the checkpoint created by the controlled interruption and the post-resume execution report.', 'Verified the failed step was retried from its checksum-verified checkpoint and completed successfully.'],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.resumePlan] : []
  }
}

async function inspectDatasetApiProcessing(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const actionIds = [
    DATASET_API_CAPABILITY_IDS.selectColumns,
    DATASET_API_CAPABILITY_IDS.transform,
    DATASET_API_CAPABILITY_IDS.deduplicate
  ]
  const invocations = actionIds.map((actionId) => input.invocations.find((invocation) => invocation.actionId === actionId))
  if (invocations.some((invocation) => !invocation?.success)) {
    return failedOracle('The Dataset API select, transform, and deduplicate actions did not all complete successfully.')
  }
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_PROCESSING_EVAL_INPUT_PATH)
  const selectManifest = await findOperationManifest(workspaceDirectory, 'dataset_select_columns', inputPath)
  if (!selectManifest || typeof selectManifest.path !== 'string') return failedOracle('No dataset_select_columns manifest was found for the package fixture.')
  const selectedPath = resolve(selectManifest.path)
  const transformManifest = await findOperationManifest(workspaceDirectory, 'dataset_transform', selectedPath)
  if (!transformManifest || typeof transformManifest.path !== 'string') return failedOracle('No dataset_transform manifest was found with selected.jsonl as its parent.')
  const transformedPath = resolve(transformManifest.path)
  const deduplicateManifest = await findOperationManifest(workspaceDirectory, 'dataset_deduplicate', transformedPath)
  if (!deduplicateManifest || typeof deduplicateManifest.path !== 'string') return failedOracle('No dataset_deduplicate manifest was found with transformed.jsonl as its parent.')
  const deduplicatedPath = resolve(deduplicateManifest.path)
  const duplicateManifest = await findOperationManifest(workspaceDirectory, 'dataset_deduplicate_removed', transformedPath)
  const [selectedRows, transformedRows, deduplicatedRows] = await Promise.all([
    readJsonlRows(selectedPath),
    readJsonlRows(transformedPath),
    readJsonlRows(deduplicatedPath)
  ])
  const duplicatePath = duplicateManifest && typeof duplicateManifest.path === 'string' ? resolve(duplicateManifest.path) : undefined
  const duplicateRows = duplicatePath && await fileExists(duplicatePath) ? await readJsonlRows(duplicatePath) : []
  const checks = [
    invocationPath(invocations[0]!, 'inputArtifact', workspaceDirectory) === inputPath,
    invocationPath(invocations[1]!, 'inputArtifact', workspaceDirectory) === selectedPath,
    invocationPath(invocations[2]!, 'inputArtifact', workspaceDirectory) === transformedPath,
    selectedRows.length === 4,
    selectedRows.every((row) => Object.keys(row).join(',') === 'id,condition,score'),
    transformedRows.length === 4,
    transformedRows.every((row) => typeof row.condition === 'string' && !row.condition.startsWith(' ') && typeof row.score === 'number'),
    deduplicatedRows.length === 3,
    new Set(deduplicatedRows.map((row) => String(row.id))).size === 3,
    duplicateRows.length === 1,
    selectManifest.operation === 'dataset_select_columns',
    transformManifest.operation === 'dataset_transform',
    deduplicateManifest.operation === 'dataset_deduplicate',
    duplicateManifest?.operation === 'dataset_deduplicate_removed',
    await manifestMatchesFile(selectManifest),
    await manifestMatchesFile(transformManifest),
    await manifestMatchesFile(deduplicateManifest),
    duplicateManifest ? await manifestMatchesFile(duplicateManifest) : false
  ]
  const passed = checks.every(Boolean)
  return {
    taskSuccess: passed,
    finalState: {
      selectedRows: selectedRows.length,
      transformedRows: transformedRows.length,
      deduplicatedRows: deduplicatedRows.length,
      duplicateRowsRemoved: duplicateRows.length,
      finalArtifactPath: deduplicatedPath
    },
    evidence: [
      `Read selected artifact ${selectedPath}, transformed artifact ${transformedPath}, and deduplicated artifact ${deduplicatedPath}.`,
      'Verified independent parent lineage, field selection, numeric conversion, and duplicate removal.'
    ],
    verifiedActions: passed ? actionIds : []
  }
}

async function inspectDatasetApiFilterValidate(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const filterInvocation = input.invocations.find((invocation) => (
    invocation.actionId === DATASET_API_CAPABILITY_IDS.filter
  ))
  const validateInvocation = input.invocations.find((invocation) => (
    invocation.actionId === DATASET_API_CAPABILITY_IDS.validate
  ))
  if (!filterInvocation?.success || !validateInvocation?.success) {
    return failedOracle('The Dataset API filter and validate actions did not both have successful terminal invocations.')
  }

  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const inputPath = resolve(workspaceDirectory, DATASET_API_FILTER_VALIDATE_EVAL_INPUT_PATH)
  const filterInputPath = invocationPath(filterInvocation, 'inputArtifact', workspaceDirectory)
  const filterManifest = await findOperationManifest(workspaceDirectory, 'dataset_filter', inputPath)
  if (!filterManifest || typeof filterManifest.path !== 'string') {
    return failedOracle('No dataset_filter artifact manifest was found for the package fixture input.')
  }
  const filterArtifactPath = resolve(filterManifest.path)
  const filteredRows = await readJsonlRows(filterArtifactPath)
  const filteredBytes = await readFile(filterArtifactPath).catch(() => undefined)
  const filterParent = firstParent(filterManifest)
  const validateInputPath = invocationPath(validateInvocation, 'inputArtifact', workspaceDirectory)
  const validateManifest = await findOperationManifest(workspaceDirectory, 'dataset_validate', filterArtifactPath)
  if (!validateManifest || typeof validateManifest.path !== 'string') {
    return failedOracle('No dataset_validate report manifest was found with the filter artifact as its parent.')
  }
  const validationArtifactPath = resolve(validateManifest.path)
  const validationBytes = await readFile(validationArtifactPath).catch(() => undefined)
  const validationReport = validationBytes ? parseJsonObject(validationBytes) : undefined
  const validationParent = firstParent(validateManifest)
  const inputBytes = await readFile(inputPath).catch(() => undefined)
  const filterParentPath = typeof filterParent?.path === 'string' ? resolve(filterParent.path) : undefined
  const validationParentPath = typeof validationParent?.path === 'string' ? resolve(validationParent.path) : undefined
  const filterChecks = [
    filterInputPath === inputPath,
    filterManifest.operation === 'dataset_filter',
    filterManifest.format === 'jsonl',
    filteredBytes !== undefined && filterManifest.sha256 === sha256(filteredBytes),
    inputBytes !== undefined && filterParentPath === inputPath,
    inputBytes !== undefined && filterParent?.sha256 === sha256(inputBytes),
    filteredRows.length === 2,
    filteredRows.every((row) => typeof row.score === 'number' && row.score >= 0.8)
  ]
  const validationChecks = [
    validateInputPath === filterArtifactPath,
    validateManifest.operation === 'dataset_validate',
    validateManifest.format === 'report',
    validationBytes !== undefined && validateManifest.sha256 === sha256(validationBytes),
    validationParentPath === filterArtifactPath,
    filteredBytes !== undefined && validationParent?.sha256 === sha256(filteredBytes),
    validationReport?.valid === true,
    validationReport?.records === 2,
    validationReport?.errorCount === 0
  ]
  const checks = [...filterChecks, ...validationChecks]
  const passed = checks.every(Boolean)
  const evidence = [
    `Read independent filter artifact ${filterArtifactPath}.`,
    `Verified filter input lineage to ${inputPath} and retained ${filteredRows.length} records with score >= 0.8.`,
    `Read independent validation report ${validationArtifactPath}.`,
    'Verified validation input lineage to the filter artifact and report valid=true with zero errors.'
  ]
  return {
    taskSuccess: passed,
    finalState: {
      filteredRows: filteredRows.length,
      validationPassed: validationReport?.valid === true,
      filterArtifactPath,
      validationArtifactPath
    },
    evidence,
    verifiedActions: passed
      ? [DATASET_API_CAPABILITY_IDS.filter, DATASET_API_CAPABILITY_IDS.validate]
      : []
  }
}

async function inspectDatasetApiConfirmPlanDenied(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const confirmationInvocation = input.invocations.find((invocation) => (
    invocation.actionId === DATASET_API_CAPABILITY_IDS.confirmPlan
  ))
  const workspaceDirectory = await canonicalWorkspaceDirectory(input.context.workspaceDirectory)
  const confirmationPath = resolve(
    workspaceDirectory,
    relativeConfirmationPath(DATASET_API_CONFIRM_PLAN_DENIED_PLAN_ID)
  )
  const confirmationExists = await fileExists(confirmationPath)
  const processedArtifactCount = await countRegularFiles(
    join(workspaceDirectory, '.sciforge', 'datasets', 'processed')
  )
  const passed = Boolean(
    confirmationInvocation &&
    !confirmationInvocation.success &&
    confirmationInvocation.errorCode === 'approval_denied' &&
    !confirmationExists &&
    processedArtifactCount === 0
  )
  return {
    taskSuccess: passed,
    finalState: {
      writeBlocked: !confirmationExists && processedArtifactCount === 0,
      confirmationExists,
      processedArtifactCount
    },
    evidence: [
      `Checked that the broker-denied confirmation did not create ${confirmationPath}.`,
      `Checked the processed artifact tree independently; regular file count=${processedArtifactCount}.`
    ],
    verifiedActions: passed ? [DATASET_API_CAPABILITY_IDS.confirmPlan] : []
  }
}

async function writeJsonlFixture(path: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

async function writeDatasetPlanFixture(
  workspaceDirectory: string,
  planId: string,
  input: Readonly<{
    objective: string
    operations: readonly Record<string, unknown>[]
    outputs: readonly Record<string, unknown>[]
    confirmationNotes: readonly string[]
  }>,
  options: Readonly<{ approved: boolean }>
): Promise<string> {
  const planPath = join(await canonicalWorkspaceDirectory(workspaceDirectory), relativePlanPath(planId))
  const plan = {
    version: 1,
    planId,
    status: 'draft',
    objective: input.objective,
    sources: [],
    operations: input.operations,
    outputs: input.outputs,
    exclusions: [],
    confirmationNotes: input.confirmationNotes,
    createdAt: '2026-09-17T00:00:00.000Z'
  }
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)
  await mkdir(dirname(planPath), { recursive: true })
  await writeFile(planPath, planBytes)
  if (options.approved) {
    const confirmationPath = join(dirname(planPath), `${planId}.confirmation.json`)
    await writeFile(confirmationPath, `${JSON.stringify({
      version: 1,
      planId,
      status: 'confirmed',
      approvalId: `eval-fixture-${planId}`,
      approvalSource: 'host-capability-broker',
      draftPath: planPath,
      draftSha256: sha256(planBytes),
      confirmedAt: '2026-09-17T00:00:00.000Z'
    }, null, 2)}\n`)
  }
  return planPath
}

function relativePlanPath(planId: string): string {
  return `.sciforge/datasets/plans/${planId}.json`
}

function relativeConfirmationPath(planId: string): string {
  return `.sciforge/datasets/plans/${planId}.confirmation.json`
}

function invocationPath(
  invocation: DomainCapabilityEvalObservedInvocation,
  key: string,
  workspaceDirectory: string
): string | undefined {
  const value = isRecord(invocation.args) ? invocation.args[key] : undefined
  return typeof value === 'string' ? resolve(workspaceDirectory, value) : undefined
}

function firstParent(manifest: Record<string, unknown>): Record<string, unknown> | undefined {
  const parents = Array.isArray(manifest.parents) ? manifest.parents : []
  const first = parents[0]
  return isRecord(first) ? first : undefined
}

async function findOperationManifest(
  workspaceDirectory: string,
  operation: string,
  parentPath: string
): Promise<Record<string, unknown> | undefined> {
  const directory = join(workspaceDirectory, '.sciforge', 'datasets', 'processed', operation)
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
  for (const entry of entries.filter((candidate) => candidate.endsWith('.manifest.json'))) {
    const candidate = JSON.parse(await readFile(join(directory, entry), 'utf8')) as Record<string, unknown>
    if (candidate.operation !== operation) continue
    const parents = Array.isArray(candidate.parents) ? parentsAsRecords(candidate.parents) : []
    for (const parent of parents) {
      if (typeof parent.path === 'string' && await canonicalPath(parent.path) === parentPath) return candidate
    }
  }
  return undefined
}

async function findServiceArtifactManifest(
  workspaceDirectory: string,
  artifactKind: 'metadata' | 'raw',
  sourceId: string,
  operation: string
): Promise<Record<string, unknown> | undefined> {
  const directory = join(workspaceDirectory, '.sciforge', 'datasets', artifactKind, sourceId)
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
  for (const entry of entries.filter((candidate) => candidate.endsWith('.manifest.json'))) {
    const candidate = parseJsonObject(await readFile(join(directory, entry)))
    if (candidate?.operation !== operation) continue
    if (candidate.operation === operation) return candidate
  }
  return undefined
}

async function closeDatasetApiEvalHttpServer(context: DomainCapabilityEvalRunContext): Promise<void> {
  const key = `${context.caseId}:${context.runId}`
  const server = DATASET_API_EVAL_HTTP_SERVERS.get(key)
  if (!server) return
  DATASET_API_EVAL_HTTP_SERVERS.delete(key)
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
}

async function closeDatasetApiEvalObjectServer(context: DomainCapabilityEvalRunContext): Promise<{
  requests: Array<{ method: string; pathname: string; search: string }>
} | undefined> {
  const key = `${context.caseId}:${context.runId}`
  const state = DATASET_API_EVAL_OBJECT_SERVERS.get(key)
  if (!state) return undefined
  DATASET_API_EVAL_OBJECT_SERVERS.delete(key)
  await new Promise<void>((resolvePromise) => state.server.close(() => resolvePromise()))
  for (const [name, previous] of Object.entries({
    [state.envNames.accessKeyId]: state.previousEnv.accessKeyId,
    [state.envNames.secretAccessKey]: state.previousEnv.secretAccessKey
  })) {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
  return { requests: state.requests }
}

async function findExecutionState(
  workspaceDirectory: string,
  planId: string
): Promise<Record<string, unknown> | undefined> {
  const directory = join(workspaceDirectory, '.sciforge', 'datasets', 'runs')
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
  for (const entry of entries.filter((candidate) => candidate.endsWith('.json'))) {
    const statePath = join(directory, entry)
    const state = await readJsonObject(statePath)
    if (state?.planId === planId) return { ...state, statePath }
  }
  return undefined
}

async function findOperationManifestAny(
  workspaceDirectory: string,
  operation: string
): Promise<Record<string, unknown> | undefined> {
  const directory = join(workspaceDirectory, '.sciforge', 'datasets', 'processed', operation)
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
  for (const entry of entries.filter((candidate) => candidate.endsWith('.manifest.json'))) {
    const candidate = JSON.parse(await readFile(join(directory, entry), 'utf8')) as Record<string, unknown>
    if (candidate.operation === operation) return candidate
  }
  return undefined
}

function parentsAsRecords(value: unknown[]): Array<Record<string, unknown>> {
  return value.filter(isRecord)
}

async function readJsonlRows(path: string): Promise<Array<Record<string, unknown>>> {
  const bytes = await readFile(path)
  return bytes.toString('utf8').split(/\r?\n/u).filter((line) => line.trim()).map((line) => {
    const parsed = JSON.parse(line) as unknown
    return isRecord(parsed) ? parsed : {}
  })
}

async function readJsonArray(path: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse((await readFile(path)).toString('utf8')) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return parseJsonObject(await readFile(path))
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

function datasetApiResult(output: unknown): DomainPackageJsonValue | undefined {
  if (!isRecord(output)) return undefined
  const wrapper = output.datasetApi
  if (isRecord(wrapper) && 'result' in wrapper) return asPackageJsonValue(wrapper.result)
  if ('result' in output) return asPackageJsonValue(output.result)
  return asPackageJsonValue(output)
}

function asPackageJsonValue(value: unknown): DomainPackageJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) return value as DomainPackageJsonValue[]
  if (isRecord(value)) return value as { [key: string]: DomainPackageJsonValue }
  return undefined
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
}

async function manifestMatchesFile(manifest: Record<string, unknown>): Promise<boolean> {
  if (typeof manifest.path !== 'string' || typeof manifest.sha256 !== 'string') return false
  const bytes = await readFile(manifest.path).catch(() => undefined)
  return bytes !== undefined && manifest.sha256 === sha256(bytes)
}

async function manifestHasParent(
  manifest: Record<string, unknown>,
  expectedPath: string,
  expectedSha256: string
): Promise<boolean> {
  if (!expectedSha256) return false
  const parents = Array.isArray(manifest.parents) ? parentsAsRecords(manifest.parents) : []
  for (const parent of parents) {
    if (typeof parent.path !== 'string' || parent.sha256 !== expectedSha256) continue
    if (await canonicalPath(parent.path) === expectedPath) return true
  }
  return false
}

async function countRegularFiles(directory: string): Promise<number> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFile(error)) return 0
    throw error
  }
  let count = 0
  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) count += await countRegularFiles(entryPath)
    else if (entry.isFile()) count += 1
  }
  return count
}

function failedOracle(message: string): DomainCapabilityEvalOracleResult {
  return { taskSuccess: false, evidence: [message], verifiedActions: [] }
}

async function findProfileManifest(workspaceDirectory: string, inputPath: string): Promise<Record<string, unknown> | undefined> {
  const directory = join(workspaceDirectory, '.sciforge', 'datasets', 'processed', 'dataset_profile')
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
  for (const entry of entries.filter((candidate) => candidate.endsWith('.manifest.json'))) {
    const candidate = JSON.parse(await readFile(join(directory, entry), 'utf8')) as Record<string, unknown>
    if (candidate.operation !== 'dataset_profile') continue
    const parents = Array.isArray(candidate.parents) ? candidate.parents : []
    for (const parent of parents) {
      if (!parent || typeof parent !== 'object' || typeof (parent as Record<string, unknown>).path !== 'string') continue
      if (await canonicalPath(String((parent as Record<string, unknown>).path)) === inputPath) return candidate
    }
  }
  return undefined
}

function expectedProfileFields(): Array<Readonly<{
  name: string
  types: Record<string, number>
  missing: number
  missingFraction: number
  unique: number
  sample: unknown[]
}>> {
  return [
    { name: 'sample_id', types: { string: 3 }, missing: 0, missingFraction: 0, unique: 3, sample: ['s1', 's2', 's3'] },
    { name: 'condition', types: { string: 3 }, missing: 0, missingFraction: 0, unique: 2, sample: ['Control', 'Treated', 'Treated'] },
    { name: 'score', types: { number: 3 }, missing: 0, missingFraction: 0, unique: 3, sample: [0.72, 0.91, 0.88] }
  ]
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function canonicalWorkspaceDirectory(directory: string): Promise<string> {
  try {
    return await realpath(directory)
  } catch {
    return resolve(directory)
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
