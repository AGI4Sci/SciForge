import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { DomainWorkflowExecutionReceiptProvider } from '@sciforge/domain-sdk/workflow-template'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { CreateLoopResourceExecutor } from '@sciforge/domain-create-loop/resource-executor'
import { z } from 'zod'
import {
  DATASET_API_CAPABILITY_IDS,
  datasetApiCapabilityOutputSchema,
  datasetApiCatalogInputSchema,
  datasetApiListInputSchema,
  datasetApiMetadataInputSchema,
  datasetApiRawDataInputSchema,
  datasetApiRegisterInputSchema,
  datasetApiRegisterProviderInputSchema,
  datasetObjectListInputSchema,
  datasetObjectMetadataInputSchema,
  datasetObjectRawDataInputSchema,
  datasetObjectStoreListInputSchema,
  datasetObjectStoreRegisterInputSchema,
  datasetConfirmPlanInputSchema,
  datasetDeduplicateInputSchema,
  datasetExecutePlanInputSchema,
  datasetFilterInputSchema,
  datasetGraphOrganizeInputSchema,
  datasetIdMapInputSchema,
  datasetJoinInputSchema,
  datasetMaterializeInputSchema,
  datasetPreparePlanWireSchema,
  datasetProfileInputSchema,
  datasetProviderIdMapInputSchema,
  datasetPublishInputSchema,
  datasetResumePlanInputSchema,
  datasetSelectColumnsInputSchema,
  datasetStructureProfileInputSchema,
  datasetStructureValidateInputSchema,
  datasetTransformInputSchema,
  datasetValidateInputSchema
} from './contract.js'
import {
  DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRACT,
  DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRIBUTION,
  DATASET_API_CAPABILITY_FACTORY_CONTRIBUTION,
  DATASET_API_DOMAIN_MODULE_ID,
  DATASET_API_WORKFLOW_EXECUTION_RECEIPT_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import { createDatasetApiCreateLoopResourceExecutor } from './create-loop-resource-executor.js'
import { createDatasetWorkflowExecutionReceiptProvider } from './receipt-provider.js'
import { createDatasetPlanExecutor } from './plan-executor.js'
import {
  createDatasetProcessingService,
  type DatasetProcessingService
} from './processing.js'
import {
  createDatasetApiService,
  type DatasetApiService
} from './service.js'
import {
  createDatasetObjectStoreService,
  type DatasetObjectStoreService
} from './object-store.js'

type Audience = 'ui' | 'agent' | 'system'
type Effect = 'read' | 'workspace-write' | 'external-write'

type CapabilityContext = Readonly<{
  caller: Readonly<{
    workspaceId?: string
    approvals: readonly Readonly<{
      actionId: string
      invocationId?: string
      mode: 'confirmation' | 'system'
    }>[]
  }>
}>

type CapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly Audience[]
  scope: 'workspace'
  effect: Effect
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: CapabilityContext
  ) => Promise<{ output: unknown }> | { output: unknown }
}>

export { DATASET_API_CAPABILITY_IDS } from './contract.js'

type DatasetApiServices = Readonly<{
  api: DatasetApiService
  objectStore: DatasetObjectStoreService
  processing: DatasetProcessingService
  executor: ReturnType<typeof createDatasetPlanExecutor>
}>

type DatasetMainHost = DomainMainHost & Readonly<{
  createDatasetApiServices?: () => DatasetApiServices
}>

export type DatasetApiCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof DATASET_API_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'dataset-api'
    title: 'Dataset API'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export function createDomainMainEntry(
  host: DatasetMainHost
): TrustedDomainProcessEntryInput<
  DatasetApiCapabilityFactory | DomainWorkflowExecutionReceiptProvider | CreateLoopResourceExecutor
> {
  let services: DatasetApiServices | undefined
  const getServices = (): DatasetApiServices => {
    if (!services) {
      if (host.createDatasetApiServices) {
        services = host.createDatasetApiServices()
      } else {
        const api = createDatasetApiService()
        const objectStore = createDatasetObjectStoreService()
        const processing = createDatasetProcessingService()
        services = {
          api,
          objectStore,
          processing,
          executor: createDatasetPlanExecutor(api, processing)
        }
      }
    }
    return services
  }

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...DATASET_API_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createDatasetApiCapabilityFactory({
          defineCapability: host.defineCapability as (
            options: CapabilityOptions
          ) => unknown,
          getServices
        }),
        onDispose: () => {
          services = undefined
        }
      },
      {
        ...DATASET_API_WORKFLOW_EXECUTION_RECEIPT_CONTRIBUTION,
        value: createDatasetWorkflowExecutionReceiptProvider()
      },
      {
        ...DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRIBUTION,
        contract: DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRACT,
        value: createDatasetApiCreateLoopResourceExecutor(host.capabilities)
      }
    ]
  }
}

export function createDatasetApiCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: (options: CapabilityOptions) => CapabilityDefinition
  getServices: () => DatasetApiServices
}>): DatasetApiCapabilityFactory<CapabilityDefinition> {
  const defineRead = (
    id: string,
    title: string,
    description: string,
    inputSchema: z.ZodType,
    handler: (input: any, workspaceRoot: string) => Promise<unknown>,
    tags: readonly string[] = ['dataset', 'biology', 'data-access']
  ): CapabilityDefinition => options.defineCapability({
    id,
    version: '1.0.0',
    title,
    description,
    audiences: ['ui', 'agent', 'system'],
    scope: 'workspace',
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    tags,
    inputSchema,
    outputSchema: datasetApiCapabilityOutputSchema,
    handler: async (input, context) => ({
      output: datasetCapabilityOutput(
        id,
        await handler(input, requireWorkspace(context))
      )
    })
  })

  const defineWrite = (
    id: string,
    title: string,
    description: string,
    inputSchema: z.ZodType,
    handler: (input: any, workspaceRoot: string, context: CapabilityContext) => Promise<unknown>,
    tags: readonly string[] = ['dataset', 'biology', 'data-preparation'],
    policy: Readonly<{
      audiences?: readonly Audience[]
      effect?: Exclude<Effect, 'read'>
      approval?: 'none' | 'confirmation'
    }> = {}
  ): CapabilityDefinition => options.defineCapability({
    id,
    version: '1.0.0',
    title,
    description,
    audiences: policy.audiences ?? ['ui', 'agent', 'system'],
    scope: 'workspace',
    effect: policy.effect ?? 'workspace-write',
    approval: policy.approval ?? 'none',
    concurrency: { revision: 'none', idempotency: 'required' },
    tags,
    inputSchema,
    outputSchema: datasetApiCapabilityOutputSchema,
    handler: async (input, context) => ({
      output: datasetCapabilityOutput(
        id,
        await handler(input, requireWorkspace(context), context)
      )
    })
  })

  const withWorkspace = <T extends Record<string, unknown>>(
    workspaceRoot: string,
    input: T
  ): T & { workspaceRoot: string } => ({
    ...input,
    workspaceRoot
  })
  const services = () => options.getServices()

  return Object.freeze({
    moduleId: DATASET_API_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'dataset-api' as const,
      title: 'Dataset API' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      defineRead(
        DATASET_API_CAPABILITY_IDS.catalog,
        'Browse biology dataset providers',
        'Lists built-in public biology data providers, transports, metadata access, raw-data access, and adapter requirements.',
        datasetApiCatalogInputSchema,
        async (input) => services().api.catalog(input)
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.registerProvider,
        'Register a built-in dataset provider',
        'Registers an executable built-in biology provider preset in the caller workspace.',
        datasetApiRegisterProviderInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().api.registerProvider(withWorkspace(workspaceRoot, input))
      ),
      defineRead(
        DATASET_API_CAPABILITY_IDS.list,
        'List registered dataset databases',
        'Lists API-backed dataset databases registered in the caller workspace.',
        datasetApiListInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().api.list(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.register,
        'Register a dataset database',
        'Registers an API-backed database with separate metadata and raw-data endpoint templates.',
        datasetApiRegisterInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().api.register(withWorkspace(workspaceRoot, input)),
        ['dataset', 'biology', 'data-access', 'registration'],
        { audiences: ['ui'], effect: 'external-write', approval: 'confirmation' }
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.metadata,
        'Read dataset metadata',
        'Reads structured metadata from a registered dataset database and can persist the complete response as a checksummed artifact.',
        datasetApiMetadataInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => {
          const request = withWorkspace(workspaceRoot, input)
          if (input.planId) {
            await services().processing.authorizePlan({
              workspaceRoot,
              planId: input.planId,
              operation: 'dataset_api_metadata',
              parameters: request
            })
          }
          return services().api.metadata(request)
        },
        ['dataset', 'biology', 'metadata', 'network']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.rawData,
        'Download dataset raw data',
        'Downloads validated raw data from a registered database into a checksummed workspace artifact.',
        datasetApiRawDataInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => {
          const request = withWorkspace(workspaceRoot, input)
          if (input.planId) {
            await services().processing.authorizePlan({
              workspaceRoot,
              planId: input.planId,
              operation: 'dataset_api_raw_data',
              parameters: request
            })
          }
          return services().api.rawData(request)
        },
        ['dataset', 'biology', 'raw-data', 'network']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.registerObjectStore,
        'Register a private dataset object store',
        'Registers an S3-compatible object store using credential environment-variable references; credential values are never accepted or persisted.',
        datasetObjectStoreRegisterInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().objectStore.register(withWorkspace(workspaceRoot, input)),
        ['dataset', 'object-storage', 'private-data', 'registration'],
        { audiences: ['ui'], effect: 'external-write', approval: 'confirmation' }
      ),
      defineRead(
        DATASET_API_CAPABILITY_IDS.listObjectStores,
        'List registered dataset object stores',
        'Lists workspace-scoped S3-compatible object stores and credential readiness without exposing credential values.',
        datasetObjectStoreListInputSchema.omit({ workspaceRoot: true }),
        async (_input, workspaceRoot) => services().objectStore.list({ workspaceRoot }),
        ['dataset', 'object-storage', 'private-data']
      ),
      defineRead(
        DATASET_API_CAPABILITY_IDS.listObjects,
        'Browse private dataset objects',
        'Lists a bounded page of objects and common prefixes within a registered object-store scope.',
        datasetObjectListInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().objectStore.listObjects(withWorkspace(workspaceRoot, input)),
        ['dataset', 'object-storage', 'private-data', 'search']
      ),
      defineRead(
        DATASET_API_CAPABILITY_IDS.objectMetadata,
        'Read private dataset object metadata',
        'Reads S3-compatible object metadata without downloading the object body.',
        datasetObjectMetadataInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().objectStore.metadata(withWorkspace(workspaceRoot, input)),
        ['dataset', 'object-storage', 'private-data', 'metadata']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.objectRawData,
        'Download private dataset object data',
        'Streams a complete or ranged S3-compatible object into a checksummed workspace artifact.',
        datasetObjectRawDataInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().objectStore.rawData(withWorkspace(workspaceRoot, input)),
        ['dataset', 'object-storage', 'private-data', 'raw-data']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.preparePlan,
        'Prepare a dataset processing plan',
        'Creates an immutable draft data-preparation plan for review.',
        datasetPreparePlanWireSchema,
        async (input, workspaceRoot) => services().processing.preparePlan(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.confirmPlan,
        'Confirm a dataset processing plan',
        'Records broker-approved user confirmation of an exact immutable draft plan.',
        datasetConfirmPlanInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot, context) => {
          const grant = context.caller.approvals.find((approval) => (
            approval.actionId === DATASET_API_CAPABILITY_IDS.confirmPlan &&
            approval.mode === 'confirmation' &&
            typeof approval.invocationId === 'string'
          ))
          if (!grant?.invocationId) {
            throw new Error('Dataset plan confirmation requires an exact broker approval receipt.')
          }
          return services().processing.confirmPlan(
            withWorkspace(workspaceRoot, input),
            { invocationId: grant.invocationId }
          )
        },
        ['dataset', 'biology', 'data-preparation', 'approval'],
        { effect: 'external-write', approval: 'confirmation' }
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.executePlan,
        'Execute a confirmed dataset plan',
        'Executes every operation in a confirmed plan with durable step checkpoints.',
        datasetExecutePlanInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().executor.execute(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.resumePlan,
        'Resume a dataset plan',
        'Resumes a failed or interrupted confirmed plan from its checksum-verified checkpoint.',
        datasetResumePlanInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().executor.resume(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.profile,
        'Profile a dataset artifact',
        'Profiles JSON, JSONL, CSV, TSV, or FASTA data and persists a bounded report.',
        datasetProfileInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.profile(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.filter,
        'Filter a dataset artifact',
        'Applies structured filter conditions and writes deterministic included and excluded artifacts.',
        datasetFilterInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.filter(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.selectColumns,
        'Select and rename dataset fields',
        'Selects, renames, defaults, and requires structured fields without arbitrary code.',
        datasetSelectColumnsInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.selectColumns(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.transform,
        'Transform dataset fields',
        'Applies allow-listed deterministic normalization and scalar transformations.',
        datasetTransformInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.transform(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.deduplicate,
        'Deduplicate a dataset',
        'Deduplicates records by explicit structured keys and preserves removed duplicates separately.',
        datasetDeduplicateInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.deduplicate(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.idMap,
        'Map biomedical identifiers',
        'Maps identifiers using a workspace mapping artifact with explicit cardinality and unmatched policies.',
        datasetIdMapInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.mapIds(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.idMapProvider,
        'Map biomedical identifiers with UniProt',
        'Runs a bounded UniProt mapping job, persists provenance, and applies the mapping deterministically.',
        datasetProviderIdMapInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => {
          const request = withWorkspace(workspaceRoot, input)
          const provider = await services().processing.providerIdMapping(request)
          const result = await services().processing.mapIds({
            workspaceRoot,
            planId: input.planId,
            inputArtifact: input.inputArtifact,
            mappingArtifact: provider.mappingArtifact.path,
            inputFormat: input.inputFormat,
            mappingFormat: 'json',
            inputRecordPath: input.inputRecordPath,
            inputField: input.inputField,
            mappingFromField: 'from',
            mappingToField: 'to',
            outputField: input.outputField,
            cardinality: input.cardinality,
            onUnmapped: input.onUnmapped,
            caseSensitive: input.caseSensitive,
            deduplicateTargets: input.deduplicateTargets,
            outputFormat: input.outputFormat,
            outputFileName: input.outputFileName,
            maxOutputRecords: input.maxOutputRecords,
            maxBytes: input.maxBytes
          })
          return {
            ...result,
            providerMappingArtifact: provider.mappingArtifact,
            providerJob: {
              jobId: provider.mapping.jobId,
              resultsUrl: provider.mapping.resultsUrl,
              failedIdCount: provider.mapping.failedIds.length
            }
          }
        },
        ['dataset', 'biology', 'id-mapping', 'network']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.join,
        'Join dataset artifacts',
        'Joins two structured artifacts with explicit key mappings and deterministic unmatched outputs.',
        datasetJoinInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.join(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.structureProfile,
        'Profile structure data',
        'Profiles SDF or mmCIF structure data with format-aware parsers.',
        datasetStructureProfileInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.structureProfile(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.structureValidate,
        'Validate structure data',
        'Validates SDF or mmCIF records and persists a quality report.',
        datasetStructureValidateInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.structureValidate(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.graphOrganize,
        'Organize pathway or network data',
        'Converts explicit edge records into deterministic node, edge, graph-summary, and invalid-record artifacts.',
        datasetGraphOrganizeInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.organizeGraph(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.materialize,
        'Materialize generated dataset records',
        'Writes bounded generated records as a checksummed Dataset artifact with generation metadata and parent provenance.',
        datasetMaterializeInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.materialize(withWorkspace(workspaceRoot, input)),
        ['dataset', 'generation', 'materialization', 'provenance']
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.validate,
        'Validate a dataset artifact',
        'Validates schema, record, range, uniqueness, missingness, and FASTA integrity constraints.',
        datasetValidateInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.validate(withWorkspace(workspaceRoot, input))
      ),
      defineWrite(
        DATASET_API_CAPABILITY_IDS.publish,
        'Publish a prepared dataset',
        'Publishes confirmed-plan artifacts with manifest, schema, quality report, checksums, and provenance.',
        datasetPublishInputSchema.omit({ workspaceRoot: true }),
        async (input, workspaceRoot) => services().processing.publish(withWorkspace(workspaceRoot, input))
      )
    ]
  })
}

function requireWorkspace(context: CapabilityContext): string {
  const workspaceRoot = context.caller.workspaceId?.trim()
  if (!workspaceRoot) throw new Error('Dataset API requires a caller workspace.')
  return workspaceRoot
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function datasetCapabilityOutput(actionId: string, result: unknown): unknown {
  return {
    datasetApi: {
      actionId,
      success: true,
      result: toJson(result)
    }
  }
}
