import { createHash } from 'node:crypto'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import type { z } from 'zod'
import {
  CHANGE_INSPECTOR_CAPABILITY_IDS,
  CHANGE_INSPECTOR_RESOURCE_KIND,
  changeInspectorOpenInputSchema,
  changeInspectorOpenOutputSchema,
  type ChangeInspectorOpenInput,
  type ChangeInspectorSnapshot
} from './contract.js'
import {
  CHANGE_INSPECTOR_CAPABILITY_FACTORY_CONTRIBUTION,
  CHANGE_INSPECTOR_DOMAIN_MODULE_ID,
  CHANGE_INSPECTOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import { projectSessionChangeSnapshot } from './change-observation.js'

type ChangeInspectorCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'workspace'
  effect: 'read'
  approval: 'none'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: ChangeInspectorCapabilityHandlerContext
  ) => Promise<Readonly<{ output: unknown }>>
}>

type ChangeInspectorCapabilityHandlerContext = Readonly<{
  caller: Readonly<{
    workspaceId?: string
    principal?: PrincipalSnapshot
    principalContextVersion?: number
  }>
  issueResource: (registration: Readonly<{
    resourceId: string
    resourceKind: string
    workspaceId?: string
    audiences: readonly ('ui' | 'agent' | 'system')[]
    semanticRevision: string
    observe: ChangeInspectorResourceObserver
    dispose: () => void
    retireAfterLastHandleExpires: true
  }>) => unknown
}>

type ChangeInspectorResourceObserver = () => Promise<{
  state: ChangeInspectorSnapshot
  semanticRevision: string
  operationIds: readonly string[]
}>

type ChangeInspectorResourceBinding = Readonly<{
  observe: ChangeInspectorResourceObserver
  dispose: () => void
}> & {
  pendingReservations: number
  registered: boolean
}

type ChangeInspectorResourceBindingReservation = Readonly<{
  binding: ChangeInspectorResourceBinding
  assertCurrent: () => void
  commit: () => void
  rollback: () => void
}>

const MAX_CHANGE_INSPECTOR_RESOURCE_BINDINGS = 512

export type ChangeInspectorCapabilityFactory<CapabilityDefinition = unknown> =
  Readonly<{
    moduleId: typeof CHANGE_INSPECTOR_DOMAIN_MODULE_ID
    policy: Readonly<{
      id: 'change-inspector'
      title: 'Change Inspector'
      directTransportPrefixes: readonly []
      allowedDirectTransports: readonly []
    }>
    createDefinitions: () => readonly CapabilityDefinition[]
    dispose: () => void
  }>

class ChangeInspectorRuntime {
  #context: DomainMainRuntimeLifecycleContext | null = null

  activate(context: DomainMainRuntimeLifecycleContext): () => void {
    if (this.#context) throw new Error('Change Inspector runtime is already active.')
    this.#context = context
    return () => {
      if (this.#context === context) this.#context = null
    }
  }

  async snapshot(
    input: ChangeInspectorOpenInput,
    workspaceRoot: string
  ): Promise<ChangeInspectorSnapshot> {
    const context = this.#context
    if (!context) throw new Error('Change Inspector runtime lifecycle is not active.')
    const detail = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.sessionId
    })
    const observedWorkspace = detail.workspaceRoot?.trim()
    if (observedWorkspace && normalizePath(observedWorkspace) !== normalizePath(workspaceRoot)) {
      throw new Error('The requested session belongs to another workspace.')
    }
    return projectSessionChangeSnapshot(input.sessionId, detail)
  }
}

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<
  ChangeInspectorCapabilityFactory<CapabilityDefinition> |
  DomainMainRuntimeLifecycleContribution
> {
  const runtime = new ChangeInspectorRuntime()
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => runtime.activate(context)
  })
  const capabilityFactory = createChangeInspectorCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: ChangeInspectorCapabilityOptions
    ) => CapabilityDefinition,
    snapshot: (input, workspaceRoot) => runtime.snapshot(input, workspaceRoot)
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...CHANGE_INSPECTOR_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory,
        onDispose: () => capabilityFactory.dispose()
      },
      {
        ...CHANGE_INSPECTOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle
      }
    ]
  }
}

export function createChangeInspectorCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: ChangeInspectorCapabilityOptions
    ) => CapabilityDefinition
    snapshot: (
      input: ChangeInspectorOpenInput,
      workspaceRoot: string
    ) => Promise<ChangeInspectorSnapshot>
  }>
): ChangeInspectorCapabilityFactory<CapabilityDefinition> {
  const bindings = new Map<string, ChangeInspectorResourceBinding>()
  let lifecycleEpoch = 0

  const reserveBinding = (
    caller: ChangeInspectorCapabilityHandlerContext['caller'],
    workspaceRoot: string,
    resourceId: string,
    input: ChangeInspectorOpenInput
  ): ChangeInspectorResourceBindingReservation => {
    const reservationEpoch = lifecycleEpoch
    const key = JSON.stringify([
      workspaceRoot,
      CHANGE_INSPECTOR_RESOURCE_KIND,
      resourceId,
      caller.principalContextVersion ?? caller.principal?.identityVersion ?? 0,
      caller.principal
        ? [
            caller.principal.authority,
            caller.principal.subject,
            caller.principal.assurance,
            caller.principal.deviceId,
            caller.principal.identityVersion
          ]
        : null
    ])
    let binding = bindings.get(key)
    if (!binding) {
      if (bindings.size >= MAX_CHANGE_INSPECTOR_RESOURCE_BINDINGS) {
        throw new Error('Change Inspector resource capacity is exhausted.')
      }
      binding = {
        observe: async () => {
          if (reservationEpoch !== lifecycleEpoch) {
            throw new Error('Change Inspector resource binding is retired.')
          }
          const snapshot = await options.snapshot(input, workspaceRoot)
          return {
            state: snapshot,
            semanticRevision: snapshot.revision,
            operationIds: []
          }
        },
        dispose: () => {
          binding!.registered = false
          if (
            binding!.pendingReservations === 0 &&
            bindings.get(key) === binding
          ) {
            bindings.delete(key)
          }
        },
        pendingReservations: 0,
        registered: false
      }
      bindings.set(key, binding)
    }
    binding.pendingReservations += 1
    let settled = false
    const settle = (registered: boolean): void => {
      if (settled) return
      settled = true
      if (reservationEpoch !== lifecycleEpoch) return
      binding!.pendingReservations -= 1
      if (registered) binding!.registered = true
      if (
        !binding!.registered &&
        binding!.pendingReservations === 0 &&
        bindings.get(key) === binding
      ) {
        bindings.delete(key)
      }
    }
    return Object.freeze({
      binding,
      assertCurrent: () => {
        if (reservationEpoch !== lifecycleEpoch) {
          throw new Error('Change Inspector resource binding lifecycle changed.')
        }
      },
      commit: () => settle(true),
      rollback: () => settle(false)
    })
  }

  return Object.freeze({
    moduleId: CHANGE_INSPECTOR_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'change-inspector' as const,
      title: 'Change Inspector' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      options.defineCapability({
        id: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession,
        version: '1.0.0',
        title: 'Observe session changes',
        description: 'Issues a read-only resource for one session change snapshot.',
        audiences: ['ui'],
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['session', 'changes', 'diff', 'audit'],
        inputSchema: changeInspectorOpenInputSchema,
        outputSchema: changeInspectorOpenOutputSchema,
        handler: async (rawInput, context) => {
          const input = changeInspectorOpenInputSchema.parse(rawInput)
          const workspaceRoot = context.caller.workspaceId?.trim()
          if (!workspaceRoot) throw new Error('Change Inspector requires an active workspace.')
          const resourceId = changeInspectorResourceId(input)
          const reservation = reserveBinding(
            context.caller,
            workspaceRoot,
            resourceId,
            input
          )
          try {
            const initial = await options.snapshot(input, workspaceRoot)
            reservation.assertCurrent()
            const resource = context.issueResource({
              resourceId,
              resourceKind: CHANGE_INSPECTOR_RESOURCE_KIND,
              workspaceId: workspaceRoot,
              audiences: ['ui'],
              semanticRevision: initial.revision,
              observe: reservation.binding.observe,
              dispose: reservation.binding.dispose,
              retireAfterLastHandleExpires: true
            })
            reservation.commit()
            return {
              output: changeInspectorOpenOutputSchema.parse({
                resource,
                sessionId: input.sessionId
              })
            }
          } catch (error) {
            reservation.rollback()
            throw error
          }
        }
      })
    ],
    dispose: () => {
      lifecycleEpoch += 1
      bindings.clear()
    }
  })
}

function changeInspectorResourceId(input: ChangeInspectorOpenInput): string {
  // JSON's array encoding is an unambiguous canonical tuple for two strings;
  // hashing keeps the Broker-visible identity bounded and avoids delimiter
  // collisions such as ["a:b", "c"] versus ["a", "b:c"].
  const canonicalTuple = JSON.stringify([input.runtimeId, input.sessionId])
  return `session-changes:${createHash('sha256').update(canonicalTuple).digest('hex')}`
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}
