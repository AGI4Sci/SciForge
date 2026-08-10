import {
  domainPackageJsonValueSchema
} from '@sciforge/domain-sdk'
import type {
  DomainRendererCapabilityContract,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  sciforgeReproSpecSchema,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'
import {
  CREATE_LOOP_CAPABILITY_IDS,
  createLoopApprovalInputSchema,
  createLoopApprovalOutputSchema,
  createLoopCheckCodeInputSchema,
  createLoopCodeCheckResultSchema,
  createLoopDslInputSchema,
  createLoopDslOutputSchema,
  createLoopExportInputSchema,
  createLoopExportRerunInputSchema,
  createLoopNodeTestResultSchema,
  createLoopReadInputSchema,
  createLoopRunNodeInputSchema,
  createLoopRunResultSchema,
  createLoopRuntimeStatusSchema,
  createLoopSaveInputSchema,
  createLoopSnapshotSchema,
  createLoopStopInputSchema,
  createLoopTestNodeInputSchema,
  createLoopWorkflowInputSchema,
  createLoopWorkflowSchema,
  createDatasetLoopInputSchema,
  createDatasetLoopOutputSchema,
  type CreateDatasetLoopInput,
  type CreateDatasetLoopOutput,
  type CreateLoopSnapshot,
  type WorkflowApprovalDecision,
  type WorkflowCodeCheckResult,
  type WorkflowCodeLanguage,
  type WorkflowNodeTestResult,
  type WorkflowRunResult,
  type WorkflowRuntimeStatus,
  type WorkflowRunComparatorV1,
  type WorkflowSettingsV1,
  type WorkflowV1
} from '../contract.js'

export const createLoopCapabilityContracts = Object.freeze({
  read: contract(CREATE_LOOP_CAPABILITY_IDS.read, 'read', createLoopReadInputSchema, createLoopSnapshotSchema),
  save: contract(CREATE_LOOP_CAPABILITY_IDS.save, 'workspace-write', createLoopSaveInputSchema, createLoopSnapshotSchema),
  buildDataset: contract(
    CREATE_LOOP_CAPABILITY_IDS.buildDataset,
    'external-write',
    createDatasetLoopInputSchema,
    createDatasetLoopOutputSchema
  ),
  run: contract(CREATE_LOOP_CAPABILITY_IDS.run, 'external-write', createLoopWorkflowInputSchema, createLoopRunResultSchema),
  stop: contract(CREATE_LOOP_CAPABILITY_IDS.stop, 'external-write', createLoopStopInputSchema, createLoopRunResultSchema),
  status: contract(CREATE_LOOP_CAPABILITY_IDS.status, 'read', createLoopReadInputSchema, createLoopRuntimeStatusSchema),
  resolveApproval: contract(
    CREATE_LOOP_CAPABILITY_IDS.resolveApproval,
    'external-write',
    createLoopApprovalInputSchema,
    createLoopApprovalOutputSchema
  ),
  runNode: contract(
    CREATE_LOOP_CAPABILITY_IDS.runNode,
    'external-write',
    createLoopRunNodeInputSchema,
    createLoopRunResultSchema
  ),
  testNode: contract(
    CREATE_LOOP_CAPABILITY_IDS.testNode,
    'compute',
    createLoopTestNodeInputSchema,
    createLoopNodeTestResultSchema
  ),
  checkCode: contract(
    CREATE_LOOP_CAPABILITY_IDS.checkCode,
    'compute',
    createLoopCheckCodeInputSchema,
    createLoopCodeCheckResultSchema
  ),
  importDsl: contract(
    CREATE_LOOP_CAPABILITY_IDS.importDsl,
    'compute',
    createLoopDslInputSchema,
    createLoopWorkflowSchema
  ),
  exportDsl: contract(
    CREATE_LOOP_CAPABILITY_IDS.exportDsl,
    'read',
    createLoopExportInputSchema,
    createLoopDslOutputSchema
  ),
  exportRerun: contract(
    CREATE_LOOP_CAPABILITY_IDS.exportRerun,
    'read',
    createLoopExportRerunInputSchema,
    sciforgeReproSpecSchema
  )
})

function contract<TInput, TOutput>(
  actionId: string,
  effect: DomainRendererCapabilityContract<TInput, TOutput>['effect'],
  inputSchema: DomainRendererCapabilityContract<TInput, TOutput>['inputSchema'],
  outputSchema: DomainRendererCapabilityContract<TInput, TOutput>['outputSchema']
): DomainRendererCapabilityContract<TInput, TOutput> {
  return Object.freeze({ actionId, effect, inputSchema, outputSchema })
}

export type CreateLoopCapabilityClient = Readonly<{
  read: (workspaceRoot: string) => Promise<CreateLoopSnapshot>
  save: (
    workspaceRoot: string,
    settings: WorkflowSettingsV1,
    expectedRevision?: number
  ) => Promise<CreateLoopSnapshot>
  buildDataset: (
    workspaceRoot: string,
    input: CreateDatasetLoopInput
  ) => Promise<CreateDatasetLoopOutput>
  run: (
    workspaceRoot: string,
    workflowId: string,
    input?: unknown
  ) => Promise<WorkflowRunResult>
  rerun: (
    workspaceRoot: string,
    spec: SciForgeReproSpecV1,
    activityId?: string
  ) => Promise<WorkflowRunResult>
  stop: (workspaceRoot: string, workflowId: string) => Promise<WorkflowRunResult>
  status: (workspaceRoot: string) => Promise<WorkflowRuntimeStatus>
  resolveApproval: (
    workspaceRoot: string,
    token: string,
    decision: WorkflowApprovalDecision
  ) => Promise<{ resolved: boolean }>
  runNode: (
    workspaceRoot: string,
    workflowId: string,
    nodeId: string
  ) => Promise<WorkflowRunResult>
  testNode: (
    workspaceRoot: string,
    workflowId: string,
    nodeId: string,
    mockJson: string
  ) => Promise<WorkflowNodeTestResult>
  checkCode: (
    workspaceRoot: string,
    language: WorkflowCodeLanguage,
    code: string
  ) => Promise<WorkflowCodeCheckResult>
  importDsl: (workspaceRoot: string, dsl: string) => Promise<WorkflowV1>
  exportDsl: (workspaceRoot: string, workflowId: string) => Promise<{ dsl: string }>
  exportRerun: (
    workspaceRoot: string,
    workflowId: string,
    runId: string,
    comparator?: WorkflowRunComparatorV1
  ) => Promise<SciForgeReproSpecV1>
}>

export function createCreateLoopCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): CreateLoopCapabilityClient {
  const options = (workspaceRoot: string) => ({
    workspaceId: requireWorkspaceRoot(workspaceRoot)
  })
  const confirmedOptions = (workspaceRoot: string) => ({
    ...options(workspaceRoot),
    approval: { mode: 'confirmation' as const }
  })
  return Object.freeze({
    read: (workspaceRoot) =>
      invoker.invoke(createLoopCapabilityContracts.read, {}, options(workspaceRoot)),
    save: (workspaceRoot, settings, expectedRevision) =>
      invoker.invoke(
        createLoopCapabilityContracts.save,
        { settings, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
        options(workspaceRoot)
      ),
    buildDataset: (workspaceRoot, input) =>
      invoker.invoke(
        createLoopCapabilityContracts.buildDataset,
        input,
        confirmedOptions(workspaceRoot)
      ),
    run: (workspaceRoot, workflowId, input) =>
      invoker.invoke(
        createLoopCapabilityContracts.run,
        {
          workflowId,
          ...(input === undefined ? {} : { input: domainPackageJsonValueSchema.parse(input) })
        },
        confirmedOptions(workspaceRoot)
      ),
    rerun: (workspaceRoot, spec, activityId) =>
      invoker.invoke(
        createLoopCapabilityContracts.run,
        { rerunSpec: spec, ...(activityId ? { activityId } : {}) },
        confirmedOptions(workspaceRoot)
      ),
    stop: (workspaceRoot, workflowId) =>
      invoker.invoke(
        createLoopCapabilityContracts.stop,
        { workflowId },
        confirmedOptions(workspaceRoot)
      ),
    status: (workspaceRoot) =>
      invoker.invoke(createLoopCapabilityContracts.status, {}, options(workspaceRoot)),
    resolveApproval: (workspaceRoot, token, decision) =>
      invoker.invoke(
        createLoopCapabilityContracts.resolveApproval,
        { token, decision },
        confirmedOptions(workspaceRoot)
      ),
    runNode: (workspaceRoot, workflowId, nodeId) =>
      invoker.invoke(
        createLoopCapabilityContracts.runNode,
        { workflowId, nodeId },
        confirmedOptions(workspaceRoot)
      ),
    testNode: (workspaceRoot, workflowId, nodeId, mockJson) =>
      invoker.invoke(
        createLoopCapabilityContracts.testNode,
        { workflowId, nodeId, mockJson },
        options(workspaceRoot)
      ),
    checkCode: (workspaceRoot, language, code) =>
      invoker.invoke(
        createLoopCapabilityContracts.checkCode,
        { language, code },
        options(workspaceRoot)
      ),
    importDsl: (workspaceRoot, dsl) =>
      invoker.invoke(createLoopCapabilityContracts.importDsl, { dsl }, options(workspaceRoot)),
    exportDsl: (workspaceRoot, workflowId) =>
      invoker.invoke(
        createLoopCapabilityContracts.exportDsl,
        { workflowId },
        options(workspaceRoot)
      ),
    exportRerun: (workspaceRoot, workflowId, runId, comparator) =>
      invoker.invoke(
        createLoopCapabilityContracts.exportRerun,
        { workflowId, runId, ...(comparator ? { comparator } : {}) },
        options(workspaceRoot)
      )
  })
}

function requireWorkspaceRoot(workspaceRoot: string): string {
  const normalized = workspaceRoot.trim()
  if (!normalized) throw new Error('Create Loop requires an active workspace.')
  return normalized
}
