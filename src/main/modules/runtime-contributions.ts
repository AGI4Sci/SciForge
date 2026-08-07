import { randomUUID } from 'node:crypto'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk'
import {
  MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
  MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
  MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
  isDomainAgentArtifactConsumer,
  isDomainMainActionGuard,
  isDomainMainRuntimeLifecycleContribution,
  type DomainAgentArtifactConsumer,
  type DomainMainActionGuard,
  type DomainMainActionGuardInput,
  type DomainMainRuntimeDisposer,
  type DomainMainRuntimeLifecycleContribution,
  type DomainMainRuntimeLifecycleHost,
  type DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  MAIN_WORKFLOW_EXECUTION_RECEIPT_PROVIDER_CONTRIBUTION_KIND,
  isDomainWorkflowExecutionReceiptProvider,
  type DomainWorkflowExecutionReceiptProvider
} from '@sciforge/domain-sdk/workflow-template'
import { capabilityJsonValueSchema } from '../../shared/capability-broker'
import { CapabilityBroker } from '../capabilities/broker'
import { DomainModuleCatalog } from './catalog'

type ActivatedLifecycle = Readonly<{
  controller: AbortController
  disposer?: DomainMainRuntimeDisposer
}>

export type ActivatedMainRuntimeContributions = Readonly<{
  artifactConsumers: readonly DomainAgentArtifactConsumer[]
  readonly disposed: boolean
  dispose: () => Promise<void>
}>

export type MainActionGuardEvaluation = Readonly<{
  allowed: boolean
  message?: string
  metadata?: Readonly<Record<string, DomainPackageJsonValue>>
}>

export type MainActionGuardEvaluator = Readonly<{
  evaluate: (input: DomainMainActionGuardInput) => Promise<MainActionGuardEvaluation>
}>

export function listMainAgentArtifactConsumers(
  catalog: DomainModuleCatalog
): readonly DomainAgentArtifactConsumer[] {
  return Object.freeze(catalog.listContributions(
    MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND,
    (value): value is DomainAgentArtifactConsumer => isDomainAgentArtifactConsumer(value)
  ).map((contribution) => contribution.value))
}

export function listMainWorkflowExecutionReceiptProviders(
  catalog: DomainModuleCatalog
): readonly DomainWorkflowExecutionReceiptProvider[] {
  return Object.freeze(catalog.listContributions(
    MAIN_WORKFLOW_EXECUTION_RECEIPT_PROVIDER_CONTRIBUTION_KIND,
    (value): value is DomainWorkflowExecutionReceiptProvider =>
      isDomainWorkflowExecutionReceiptProvider(value)
  ).map((contribution) => contribution.value))
}

export function createMainActionGuardEvaluator(
  catalog: DomainModuleCatalog
): MainActionGuardEvaluator {
  const guards = catalog.listContributions(
    MAIN_ACTION_GUARD_CONTRIBUTION_KIND,
    (value): value is DomainMainActionGuard => isDomainMainActionGuard(value)
  )

  return Object.freeze({
    evaluate: async (input) => {
      const actionId = input.actionId.trim()
      if (!actionId) throw new TypeError('Action guard evaluation requires a non-empty actionId.')
      const guardInput = Object.freeze({
        actionId,
        payload: domainPackageJsonValueSchema.parse(input.payload)
      })
      const metadata: Record<string, DomainPackageJsonValue> = {}

      for (const contribution of guards) {
        if (!contribution.value.actions.includes(actionId)) continue
        const result = parseActionGuardResult(
          await contribution.value.evaluate(guardInput),
          contribution.declaration.id
        )
        if (result.metadata !== undefined) {
          metadata[contribution.declaration.id] = result.metadata
        }
        if (!result.allowed) {
          return Object.freeze({
            allowed: false,
            ...(result.message ? { message: result.message } : {}),
            ...(Object.keys(metadata).length > 0
              ? { metadata: Object.freeze({ ...metadata }) }
              : {})
          })
        }
      }

      return Object.freeze({
        allowed: true,
        ...(Object.keys(metadata).length > 0
          ? { metadata: Object.freeze({ ...metadata }) }
          : {})
      })
    }
  })
}

export function createMainSystemCapabilityInvoker(
  broker: CapabilityBroker,
  options: Readonly<{
    callerId?: string
    createInvocationId?: () => string
  }> = {}
): DomainMainSystemCapabilityInvoker {
  const callerId = options.callerId?.trim() || 'domain-runtime'
  const createInvocationId = options.createInvocationId ?? randomUUID
  return Object.freeze({
    invoke: async (contract, input, invokeOptions) => {
      const definition = broker.registry.require(contract.actionId)
      if (definition.descriptor.effect !== contract.effect) {
        throw new Error(
          `Capability ${contract.actionId} effect does not match its public domain contract.`
        )
      }
      const parsedInput = capabilityJsonValueSchema.parse(
        contract.inputSchema.parse(input)
      )
      const invocationId = contract.effect === 'read'
        ? undefined
        : invokeOptions?.idempotencyKey?.trim() || createInvocationId()
      const approval = definition.descriptor.approval
      const inherited = invokeOptions?.authorization?.mode === 'inherit-current-action'
        ? broker.currentInvocation()
        : undefined
      if (invokeOptions?.authorization?.mode === 'inherit-current-action') {
        const inheritedWorkspace = inherited?.caller.workspaceId?.trim()
        const requestedWorkspace = invokeOptions.workspaceId?.trim()
        if (
          !inherited ||
          !inherited.approved ||
          inherited.approval === 'none' ||
          inherited.effect !== 'destructive' ||
          definition.descriptor.effect !== 'destructive' ||
          !inherited.invocationId ||
          !inheritedWorkspace ||
          inheritedWorkspace !== requestedWorkspace
        ) {
          throw new Error(
            `Capability ${contract.actionId} cannot inherit approval outside a matching approved destructive action.`
          )
        }
      }
      const result = await broker.invoke({
        audience: 'system',
        callerId,
        ...(invokeOptions?.workspaceId?.trim()
          ? { workspaceId: invokeOptions.workspaceId.trim() }
          : {}),
        ...(approval === 'none' || !inherited || !invocationId
          ? {}
          : {
              approvals: [{
                actionId: contract.actionId,
                invocationId,
                mode: approval
              }]
            })
      }, {
        actionId: contract.actionId,
        ...(invocationId ? { invocationId } : {}),
        ...(invokeOptions?.resource ? { resource: invokeOptions.resource } : {}),
        ...(invokeOptions?.expectedRevision?.trim()
          ? { expectedRevision: invokeOptions.expectedRevision.trim() }
          : {}),
        input: parsedInput
      })
      return contract.outputSchema.parse(result.output)
    }
  })
}

/**
 * Activates package-owned main runtimes and projects generic artifact
 * consumers from the canonical domain catalog.
 */
export async function activateMainRuntimeContributions(
  catalog: DomainModuleCatalog,
  host: DomainMainRuntimeLifecycleHost
): Promise<ActivatedMainRuntimeContributions> {
  // Validate every value before starting package-owned side effects.
  const lifecycleContributions = catalog.listContributions(
    MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
    (value): value is DomainMainRuntimeLifecycleContribution =>
      isDomainMainRuntimeLifecycleContribution(value)
  )
  const artifactConsumers = listMainAgentArtifactConsumers(catalog)
  const workflowExecutionReceipts = listMainWorkflowExecutionReceiptProviders(catalog)

  const activated: ActivatedLifecycle[] = []
  try {
    for (const contribution of lifecycleContributions) {
      const controller = new AbortController()
      const owner = Object.freeze({ ...contribution.owner })
      const { enablement, ...sharedHost } = host
      const lifecycle: { controller: AbortController; disposer?: DomainMainRuntimeDisposer } = {
        controller
      }
      activated.push(lifecycle)
      const disposer = await contribution.value.activate(Object.freeze({
        ...sharedHost,
        owner,
        workflowExecutionReceipts,
        enablement: Object.freeze({
          isEnabled: () => enablement.isEnabled(owner.moduleId),
          subscribe: (listener: (enabled: boolean) => void) =>
            enablement.subscribe(owner.moduleId, listener)
        }),
        signal: controller.signal
      }))
      if (disposer !== undefined && typeof disposer !== 'function') {
        throw new TypeError(
          `Runtime lifecycle contribution ${contribution.declaration.id} returned an invalid disposer.`
        )
      }
      if (typeof disposer === 'function') lifecycle.disposer = disposer
    }
  } catch (error) {
    const cleanupErrors = await disposeActivatedLifecycles(activated)
    if (cleanupErrors.length === 0) throw error
    throw new AggregateError(
      [error, ...cleanupErrors],
      'Main runtime contribution activation failed and rollback was incomplete.'
    )
  }

  let disposed = false
  return Object.freeze({
    artifactConsumers: Object.freeze([...artifactConsumers]),
    get disposed() {
      return disposed
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      const errors = await disposeActivatedLifecycles(activated)
      throwDisposalErrors(errors)
    }
  })
}

async function disposeActivatedLifecycles(
  activated: readonly ActivatedLifecycle[]
): Promise<unknown[]> {
  for (const lifecycle of activated) lifecycle.controller.abort()
  const errors: unknown[] = []
  for (const lifecycle of [...activated].reverse()) {
    if (!lifecycle.disposer) continue
    try {
      await lifecycle.disposer()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function throwDisposalErrors(errors: readonly unknown[]): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Main runtime contribution disposal failed.')
  }
}

function parseActionGuardResult(
  value: unknown,
  contributionId: string
): Readonly<{
  allowed: boolean
  message?: string
  metadata?: DomainPackageJsonValue
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Action guard ${contributionId} returned a non-object result.`)
  }
  const result = value as Record<string, unknown>
  if (typeof result.allowed !== 'boolean') {
    throw new TypeError(`Action guard ${contributionId} returned an invalid allowed decision.`)
  }
  if (result.message !== undefined && typeof result.message !== 'string') {
    throw new TypeError(`Action guard ${contributionId} returned an invalid message.`)
  }
  const metadata = result.metadata === undefined
    ? undefined
    : domainPackageJsonValueSchema.safeParse(result.metadata)
  if (metadata && !metadata.success) {
    throw new TypeError(`Action guard ${contributionId} returned non-JSON-safe metadata.`)
  }
  return Object.freeze({
    allowed: result.allowed,
    ...(typeof result.message === 'string' && result.message.trim()
      ? { message: result.message.trim() }
      : {}),
    ...(metadata?.success ? { metadata: metadata.data } : {})
  })
}
