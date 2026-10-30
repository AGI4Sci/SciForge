import { z } from 'zod'

/**
 * Unified Workflow / Lifecycle contribution contract (BUG-024).
 *
 * SciForge's extension boundary exposes typed contributions (renderer /
 * managed-runtime / workflow). This SDK layer owns the WORKFLOW/LIFECYCLE
 * contract so the host bridge can turn a plugin's DAG business state into
 * Broker-discoverable operations WITHOUT forcing the plugin to look like a
 * plain Tool. The plugin keeps only its DAG business state, task dependencies
 * and fixture logic; registration/logout, discover descriptors, generation
 * checks, idempotent dispose, fail-closed and the Broker invocation
 * adaptation are provided here (registered by the host bridge, which owns the
 * Broker/registry in the main process).
 */

export type WorkflowLifecycleOperation = 'start' | 'status' | 'advance' | 'cancel' | 'dispose'

/** Host-side controlled operation marker: only a system audience may invoke it. */
export const WORKFLOW_CONTROLLED_OPERATIONS: readonly WorkflowLifecycleOperation[] = ['dispose']

/** High-level category used by discover/UI to avoid mislabeling as a Tool. */
export type WorkflowContributionCategory = 'workflow' | 'lifecycle'
export const WORKFLOW_CATEGORY_TAGS: readonly ['workflow', 'lifecycle'] = ['workflow', 'lifecycle']

const teamIdSchema = z.string().trim().min(1).max(128)
const revisionSchema = z.number().int().min(0).max(1_000_000)

/** Generic default input structure; plugins may override per-operation via the constructor. */
const defaultWorkflowInputSchemas = {
  start: z.object({ teamId: teamIdSchema }).strict(),
  status: z.object({ teamId: teamIdSchema }).strict(),
  advance: z.object({ teamId: teamIdSchema, expectedRevision: revisionSchema }).strict(),
  cancel: z.object({ teamId: teamIdSchema, expectedRevision: revisionSchema }).strict(),
  dispose: z.object({}).strict(),
} as const satisfies Record<WorkflowLifecycleOperation, z.ZodType>

export type WorkflowLifecycleContract = Readonly<{
  operation: WorkflowLifecycleOperation
  capabilityId: string
  category: WorkflowContributionCategory
  hostControlled: boolean
  title: string
  description: string
  effect: 'read' | 'compute' | 'destructive'
  approval: 'none' | 'system'
  audiences: readonly ('ui' | 'agent' | 'system')[]
  tags: readonly string[]
  version: string
  inputSchema: z.ZodType
  outputSchema: z.ZodType
}>

export class WorkflowLifecycleAdapterError extends Error {
  readonly code: 'host_controlled' | 'invalid_input' | 'unknown_operation' | 'not_live'
  constructor(code: WorkflowLifecycleAdapterError['code'], message: string) {
    super(message)
    this.name = 'WorkflowLifecycleAdapterError'
    this.code = code
  }
}

/**
 * Host-independent contract builder for one plugin's workflow/lifecycle
 * contribution. Generates Broker-compatible discover contract data from a
 * namespace; the host bridge registers it into the CapabilityRegistry and
 * routes invocations back to the plugin's fixture through its runtime.
 */
export class WorkflowLifecycleAdapter {
  readonly #namespace: string
  readonly #version: string
  readonly #schemas: Readonly<Record<WorkflowLifecycleOperation, z.ZodType>>

  constructor(options: Readonly<{
    namespace: string
    version?: string
    /** Per-operation input-schema overrides so the plugin's own structure wins over the default. */
    inputSchemas?: Readonly<Partial<Record<WorkflowLifecycleOperation, z.ZodType>>>
  }>) {
    this.#namespace = options.namespace
    this.#version = options.version ?? '0.1.0'
    this.#schemas = Object.freeze({
      ...defaultWorkflowInputSchemas,
      ...(options.inputSchemas ?? {})
    })
  }

  /** Validate raw input against the operation's (possibly overridden) schema. */
  validate(operation: WorkflowLifecycleOperation, input: unknown): unknown {
    const schema = this.#schemas[operation]
    if (!schema) throw new WorkflowLifecycleAdapterError('unknown_operation', `Unknown workflow operation: ${operation}`)
    try {
      return schema.parse(input)
    } catch (error) {
      throw new WorkflowLifecycleAdapterError(
        'invalid_input',
        `Invalid workflow ${operation} input: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Host-controlled gate: `dispose` is a host-side management operation and
   * must not be invoked from an ordinary Agent/UI audience. Fail-closed.
   */
  requireHostAuthorized(operation: WorkflowLifecycleOperation, audience: string | undefined): void {
    if (!WORKFLOW_CONTROLLED_OPERATIONS.includes(operation)) return
    if (audience !== 'system') {
      throw new WorkflowLifecycleAdapterError(
        'host_controlled',
        `Workflow operation ${operation} is host-controlled and only a system audience may invoke it.`,
      )
    }
  }

  /** Broker-compatible discover contract data for this contribution. */
  contracts(readonly?: { live: boolean }): readonly WorkflowLifecycleContract[] {
    return Object.freeze(Object.entries(this.#schemas).map(([operation, inputSchema]) => {
      const controlled = WORKFLOW_CONTROLLED_OPERATIONS.includes(operation as WorkflowLifecycleOperation)
      const effect: WorkflowLifecycleContract['effect'] =
        operation === 'status' ? 'read' : operation === 'dispose' ? 'destructive' : 'compute'
      return Object.freeze({
        operation: operation as WorkflowLifecycleOperation,
        capabilityId: `${this.#namespace}.${operation}`,
        category: operation === 'dispose' ? 'lifecycle' : 'workflow',
        hostControlled: controlled,
        title: `${this.#namespace} ${operation}`,
        description: controlled
          ? `Host-side lifecycle management operation: ${operation}. Only a system audience may call it.`
          : `Workflow/lifecycle operation: ${operation}.`,
        effect,
        approval: controlled ? 'system' : 'none',
        audiences: controlled ? Object.freeze(['system']) : Object.freeze(['agent', 'system']),
        tags: Object.freeze([...WORKFLOW_CATEGORY_TAGS, ...(controlled ? ['host-controlled'] : [])]),
        version: this.#version,
        inputSchema,
        outputSchema: z.unknown(),
      }) as WorkflowLifecycleContract
    }))
  }
}
