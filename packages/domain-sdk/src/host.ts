import type { z } from 'zod'

import type { TrustedDomainProcessEntryInput } from './process-entry.js'

/**
 * Main-process services available to every trusted domain package.
 *
 * Capability definitions deliberately cross this boundary as unknown values:
 * the application host owns their concrete type and performs the authoritative
 * validation when the definition enters its registry.
 */
export type DomainMainHost = Readonly<{
  getUserDataDir: () => string
  defineCapability: (options: unknown) => unknown
}>

export type DomainRendererCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

/** Structurally matches an opaque capability resource handle issued by the host. */
export type DomainCapabilityResourceHandle = Readonly<{
  token: string
  semanticRevision: string
  expiresAt: string
}>

export type DomainRendererCapabilityObservationContract<TState> = Readonly<{
  resourceKind: string
  stateSchema: z.ZodType<TState>
}>

export type DomainRendererCapabilityObservation<TState> = Readonly<{
  resource: DomainCapabilityResourceHandle
  resourceRef: string
  resourceKind: string
  semanticRevision: string
  layoutRevision?: string
  observedAt: string
  state: TState
}>

export type DomainRendererCapabilityInvoker = Readonly<{
  observe<TState>(
    contract: DomainRendererCapabilityObservationContract<TState>,
    resource: DomainCapabilityResourceHandle,
    options?: Readonly<{ workspaceId?: string }>
  ): Promise<DomainRendererCapabilityObservation<TState>>
  invoke<TInput, TOutput>(
    contract: DomainRendererCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      resource?: DomainCapabilityResourceHandle
      expectedRevision?: string
      approval?: Readonly<{ mode: 'confirmation' }>
    }>
  ): Promise<TOutput>
}>

/** Renderer-safe services available to every trusted domain package. */
export type DomainRendererHost = Readonly<{
  capabilityInvoker: DomainRendererCapabilityInvoker
  openExternal: (url: string) => void | Promise<void>
}>

export type DomainMainEntryFactory<Value = unknown> = (
  host: DomainMainHost
) => TrustedDomainProcessEntryInput<Value>

export type DomainRendererEntryFactory<Value = unknown> = (
  host: DomainRendererHost
) => TrustedDomainProcessEntryInput<Value>
