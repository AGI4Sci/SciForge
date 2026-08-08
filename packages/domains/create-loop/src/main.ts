import type {
  DomainMainHost,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  sciforgeReproSpecSchema,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'
import type { z } from 'zod'
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
  type WorkflowApprovalDecision,
  type WorkflowCodeLanguage,
  type WorkflowRunComparatorV1,
  type WorkflowSettingsV1
} from './contract.js'
import {
  WORKFLOW_AUTOMATION_CAPABILITY_FACTORY_CONTRIBUTION,
  WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID,
  WORKFLOW_AUTOMATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import {
  CreateLoopRuntime,
  checkWorkflowCode,
  createLoopStatePath,
  type CreateLoopRuntimeOptions
} from './runtime.js'
import { parseWorkflowDsl, serializeWorkflowDsl } from './workflow-dsl.js'

type CapabilityEffect =
  | 'read'
  | 'compute'
  | 'workspace-write'
  | 'external-write'
  | 'destructive'

export type CreateLoopCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'workspace'
  effect: CapabilityEffect
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
    context: Readonly<{ caller: Readonly<{ workspaceId?: string }> }>
  ) => Promise<Readonly<{ output: unknown }>>
}>

export type CreateLoopCapabilityFactory<CapabilityDefinition = unknown> =
  Readonly<{
    moduleId: typeof WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID
    policy: Readonly<{
      id: 'create-loop'
      title: 'Create Loop'
      directTransportPrefixes: readonly []
      allowedDirectTransports: readonly []
    }>
    createDefinitions: () => readonly CapabilityDefinition[]
  }>

type MainContribution<CapabilityDefinition = unknown> =
  | CreateLoopCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution

type CreateLoopMainHost = DomainMainHost & Readonly<{
  createCreateLoopRuntime?: (options: CreateLoopRuntimeOptions) => CreateLoopRuntime
}>

type OwnedRuntime = Readonly<{
  runtime: CreateLoopRuntime
  deactivate: DomainMainRuntimeDisposer
}>

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: CreateLoopMainHost
): TrustedDomainProcessEntryInput<MainContribution<CapabilityDefinition>> {
  const createRuntime = host.createCreateLoopRuntime ??
    ((options) => new CreateLoopRuntime(options))
  let owned: OwnedRuntime | null = null
  let activation: Promise<OwnedRuntime> | null = null

  const requireRuntime = (): CreateLoopRuntime => {
    if (!owned) throw new Error('Create Loop runtime lifecycle is not active.')
    return owned.runtime
  }
  const disposeOwned = async (record: OwnedRuntime | null): Promise<void> => {
    if (!record) return
    if (owned === record) owned = null
    await record.deactivate()
  }

  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      if (owned || activation) throw new Error('Create Loop runtime lifecycle is already active.')
      const pending = (async (): Promise<OwnedRuntime> => {
        const runtime = createRuntime({ statePath: createLoopStatePath(context.userDataDir) })
        try {
          const deactivate = await runtime.activate(context)
          const record = { runtime, deactivate }
          owned = record
          return record
        } catch (error) {
          await runtime.close().catch(() => undefined)
          throw error
        }
      })()
      activation = pending
      try {
        const record = await pending
        return () => disposeOwned(record)
      } finally {
        if (activation === pending) activation = null
      }
    }
  })

  const capabilityFactory = createCreateLoopCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: CreateLoopCapabilityOptions
    ) => CapabilityDefinition,
    getRuntime: requireRuntime
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...WORKFLOW_AUTOMATION_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...WORKFLOW_AUTOMATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: async () => {
          const pending = activation
          if (pending) await disposeOwned(await pending)
          else await disposeOwned(owned)
        }
      }
    ]
  }
}

export function createCreateLoopCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (options: CreateLoopCapabilityOptions) => CapabilityDefinition
    getRuntime: () => CreateLoopRuntime
  }>
): CreateLoopCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<
      CreateLoopCapabilityOptions,
      'version' | 'audiences' | 'scope' | 'tags'
    > & Readonly<{ audiences?: readonly ('ui' | 'agent' | 'system')[] }>
  ): CreateLoopCapabilityOptions => ({
    ...input,
    version: '1.0.0',
    audiences: input.audiences ?? ['ui', 'agent'],
    scope: 'workspace',
    tags: ['workflow', 'automation', 'loop']
  })
  const capability = (
    id: string,
    title: string,
    description: string,
    effect: CapabilityEffect,
    inputSchema: z.ZodType,
    outputSchema: z.ZodType,
    handler: CreateLoopCapabilityOptions['handler'],
    concurrency: CreateLoopCapabilityOptions['concurrency'] = {
      revision: 'none',
      idempotency: effect === 'read' ? 'none' : 'required'
    }
  ): CapabilityDefinition => options.defineCapability(define({
    id,
    title,
    description,
    effect,
    approval: effect === 'external-write' || effect === 'destructive'
      ? 'confirmation'
      : 'none',
    concurrency,
    inputSchema,
    outputSchema,
    handler
  }))

  return Object.freeze({
    moduleId: WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'create-loop' as const,
      title: 'Create Loop' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      capability(
        CREATE_LOOP_CAPABILITY_IDS.read,
        'Read Create Loop settings',
        'Reads the canonical node workflow definitions and package revision.',
        'read',
        createLoopReadInputSchema,
        createLoopSnapshotSchema,
        async () => ({ output: await options.getRuntime().read() })
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.save,
        'Save Create Loop settings',
        'Atomically saves node workflows, modules, presets, hooks, and runtime settings.',
        'workspace-write',
        createLoopSaveInputSchema,
        createLoopSnapshotSchema,
        async (input) => {
          const request = input as { settings: WorkflowSettingsV1; expectedRevision?: number }
          return {
            output: await options.getRuntime().save(request.settings, request.expectedRevision)
          }
        },
        { revision: 'none', idempotency: 'required' }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.run,
        'Run workflow',
        'Runs one node workflow through the package-owned runtime.',
        'external-write',
        createLoopWorkflowInputSchema,
        createLoopRunResultSchema,
        async (input, context) => {
          const request = input as {
            workflowId?: string
            input?: unknown
            rerunSpec?: SciForgeReproSpecV1
            activityId?: string
          }
          return {
            output: request.rerunSpec
              ? await options.getRuntime().runRerun(
                  request.rerunSpec,
                  context.caller.workspaceId,
                  request.activityId
                )
              : await options.getRuntime().runWorkflow(
                  request.workflowId!,
                  request.input,
                  context.caller.workspaceId
                )
          }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.stop,
        'Stop workflow',
        'Stops one active workflow run and releases its pending operations.',
        'external-write',
        createLoopStopInputSchema,
        createLoopRunResultSchema,
        async (input) => ({
          output: await options.getRuntime().stopWorkflow((input as { workflowId: string }).workflowId)
        })
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.status,
        'Read workflow status',
        'Reads active runs, node statuses, results, and pending approvals.',
        'read',
        createLoopReadInputSchema,
        createLoopRuntimeStatusSchema,
        async () => ({ output: options.getRuntime().status() })
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.resolveApproval,
        'Resolve workflow approval',
        'Resolves a package-owned human approval pause.',
        'external-write',
        createLoopApprovalInputSchema,
        createLoopApprovalOutputSchema,
        async (input) => {
          const request = input as {
            token: string
            decision: WorkflowApprovalDecision
            actor?: string
            rationale?: string
          }
          return {
            output: {
              resolved: await options.getRuntime().resolveApproval(
                request.token,
                request.decision,
                request.actor,
                request.rationale
              )
            }
          }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.runNode,
        'Run workflow node',
        'Runs one node in the context of its persisted workflow.',
        'external-write',
        createLoopRunNodeInputSchema,
        createLoopRunResultSchema,
        async (input, context) => {
          const request = input as { workflowId: string; nodeId: string }
          return {
            output: await options.getRuntime().runNode(
              request.workflowId,
              request.nodeId,
              context.caller.workspaceId
            )
          }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.testNode,
        'Test workflow node',
        'Executes one node against bounded mock JSON without adding run history.',
        'compute',
        createLoopTestNodeInputSchema,
        createLoopNodeTestResultSchema,
        async (input, context) => {
          const request = input as { workflowId: string; nodeId: string; mockJson: string }
          return {
            output: await options.getRuntime().testNode(
              request.workflowId,
              request.nodeId,
              request.mockJson,
              context.caller.workspaceId
            )
          }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.checkCode,
        'Check workflow code',
        'Checks JavaScript, Python, or Bash node syntax.',
        'compute',
        createLoopCheckCodeInputSchema,
        createLoopCodeCheckResultSchema,
        async (input) => {
          const request = input as { language: WorkflowCodeLanguage; code: string }
          return { output: await checkWorkflowCode(request.language, request.code) }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.importDsl,
        'Import workflow DSL',
        'Validates and normalizes one portable Create Loop workflow document.',
        'compute',
        createLoopDslInputSchema,
        createLoopWorkflowSchema,
        async (input) => {
          const result = parseWorkflowDsl(
            (input as { dsl: string }).dsl,
            new Date().toISOString()
          )
          if (!result.ok) throw new Error(`Workflow import failed: ${result.error}.`)
          return { output: result.workflow }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.exportDsl,
        'Export workflow DSL',
        'Exports one workflow as a portable Create Loop document with secrets removed.',
        'read',
        createLoopExportInputSchema,
        createLoopDslOutputSchema,
        async (input) => {
          const workflowId = (input as { workflowId: string }).workflowId
          const state = await options.getRuntime().read()
          const workflow = state.settings.workflows.find((candidate) => candidate.id === workflowId)
          if (!workflow) throw new Error('Workflow not found.')
          return {
            output: {
              dsl: serializeWorkflowDsl(workflow, 'sciforge', new Date().toISOString())
            }
          }
        }
      ),
      capability(
        CREATE_LOOP_CAPABILITY_IDS.exportRerun,
        'Export rerun specification',
        'Exports one run as the canonical portable sciforge.rerun.v1 resource.',
        'read',
        createLoopExportRerunInputSchema,
        sciforgeReproSpecSchema,
        async (input) => {
          const request = input as {
            workflowId: string
            runId: string
            comparator?: WorkflowRunComparatorV1
          }
          return {
            output: await options.getRuntime().exportReproSpec(
              request.workflowId,
              request.runId,
              request.comparator
            )
          }
        }
      )
    ]
  })
}
