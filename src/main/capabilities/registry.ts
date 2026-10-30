import { z } from 'zod'
import type { DomainMainOrdinarySessionIdentity } from '@sciforge/domain-sdk/host'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityCallerContextSchema,
  capabilityDescriptorSchema,
  capabilityDiscoveryQuerySchema,
  capabilityJsonValueSchema,
  type CapabilityAudience,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityDescriptor,
  type CapabilityDiscoveryQuery,
  type CapabilityJsonValue,
  type CapabilityProviderFamily,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'

export type CapabilityResourceObservation = {
  state: CapabilityJsonValue
  semanticRevision: string
  layoutRevision?: string
  operationIds?: string[]
}

export type CapabilityResourceObserver = (
  caller: CapabilityCallerContext,
  context: Readonly<{ signal?: AbortSignal }>
) => CapabilityResourceObservation | Promise<CapabilityResourceObservation>

export type CapabilityResourceProviderChange = Readonly<{
  semanticRevision: string
  layoutRevision?: string
}>

export type CapabilityResourceProviderChangeSubscription = (
  listener: (change: CapabilityResourceProviderChange) => void
) => () => void

export type CapabilityResourceRegistration = {
  resourceId: string
  resourceKind: string
  workspaceId?: string
  audiences?: readonly CapabilityAudience[]
  semanticRevision: string
  layoutRevision?: string
  observe: CapabilityResourceObserver
  /** Synchronously registers provider-originated resource changes and returns an idempotent disposer. */
  subscribeChanges?: CapabilityResourceProviderChangeSubscription
  /** Releases provider-owned state after the broker has retired every task binding. */
  dispose?: () => void | Promise<void>
  contentTransport?: {
    describeActionId: string
    readRangeActionId: string
  }
  /** Retire provider state after every issued handle expires and task retention reaches zero. */
  retireAfterLastHandleExpires?: boolean
  expiresInMs?: number
}

export type ResolvedCapabilityResource = {
  resourceId: string
  resourceRef: string
  resourceKind: string
  workspaceId?: string
  semanticRevision: string
  layoutRevision?: string
}

export type CapabilityHandlerContext = {
  caller: CapabilityCallerContext
  /** Broker-validated identity for this invocation, never supplied by a handler. */
  invocationId?: string
  /** Host-authenticated ordinary Agent Session; carries no domain authority. */
  ordinarySession?: DomainMainOrdinarySessionIdentity
  /** Immutable original tool context admitted by the Host Session runtime. */
  originalContext?: Readonly<Record<string, unknown>>
  /** Reauthorizes the captured Host Principal against the live Principal lease. */
  assertPrincipalCurrent: () => void
  resource?: ResolvedCapabilityResource
  issueResource: (registration: CapabilityResourceRegistration) => CapabilityResourceHandle
  signal?: AbortSignal
}

export type IssuedCapabilityResource = Readonly<{
  resource: CapabilityResourceHandle
  resourceRef: string
  /** Host-private rollback/cleanup hook for the exact issued resource state. */
  retire: (options: Readonly<{ deferWhileRetained: boolean }>) => Promise<void>
}>

export type CapabilityHandlerResult<Output> = {
  output: Output
  changed?: boolean
  retireResource?: boolean | 'defer-while-retained'
  semanticRevision?: string
  layoutRevision?: string
}

type AnyZodSchema = z.ZodType

export type CapabilityHandler<Input, Output> = {
  bivarianceHack(
    input: Input,
    context: CapabilityHandlerContext
  ): CapabilityHandlerResult<Output> | Promise<CapabilityHandlerResult<Output>>
}['bivarianceHack']

export type CapabilityDefinition<
  InputSchema extends AnyZodSchema = AnyZodSchema,
  OutputSchema extends AnyZodSchema = AnyZodSchema
> = Readonly<{
  descriptor: CapabilityDescriptor
  inputSchema: InputSchema
  outputSchema: OutputSchema
  handler: CapabilityHandler<z.output<InputSchema>, z.input<OutputSchema>>
}>

export type DefineCapabilityOptions<
  InputSchema extends AnyZodSchema,
  OutputSchema extends AnyZodSchema
> = Omit<
  CapabilityDescriptor,
  'contractVersion' | 'inputSchema' | 'outputSchema' | 'resourceKinds' | 'producedResourceKinds' | 'tags'
> & {
  resourceKinds?: string[]
  producedResourceKinds?: string[]
  tags?: string[]
  inputSchema: InputSchema
  outputSchema: OutputSchema
  handler: CapabilityHandler<z.output<InputSchema>, z.input<OutputSchema>>
}

export class CapabilityRegistrationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CapabilityRegistrationError'
    this.code = code
  }
}

function schemaToWireValue(schema: AnyZodSchema, label: string): CapabilityJsonValue {
  try {
    return capabilityJsonValueSchema.parse(z.toJSONSchema(schema, {
      target: 'draft-07',
      unrepresentable: 'throw'
    }))
  } catch (error) {
    throw new CapabilityRegistrationError(
      'invalid_schema',
      `Capability ${label} cannot be represented as JSON Schema: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

export function defineCapability<
  InputSchema extends AnyZodSchema,
  OutputSchema extends AnyZodSchema
>(options: DefineCapabilityOptions<InputSchema, OutputSchema>): CapabilityDefinition<InputSchema, OutputSchema> {
  if (typeof options.handler !== 'function') {
    throw new CapabilityRegistrationError('missing_handler', `Capability ${options.id} must have exactly one handler.`)
  }

  const descriptor = capabilityDescriptorSchema.parse({
    contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    id: options.id,
    version: options.version,
    title: options.title,
    description: options.description,
    audiences: options.audiences,
    scope: options.scope,
    resourceKinds: options.resourceKinds ?? [],
    ...(options.producedResourceKinds ? { producedResourceKinds: options.producedResourceKinds } : {}),
    effect: options.effect,
    approval: options.approval,
    ...(options.delegatedBatchGrant
      ? { delegatedBatchGrant: options.delegatedBatchGrant }
      : {}),
    ...(options.autonomousWrite ? { autonomousWrite: options.autonomousWrite } : {}),
    concurrency: options.concurrency,
    ...(options.principalTransition ? { principalTransition: options.principalTransition } : {}),
    inputSchema: schemaToWireValue(options.inputSchema, `${options.id} input`),
    outputSchema: schemaToWireValue(options.outputSchema, `${options.id} output`),
    tags: options.tags ?? []
  })

  return Object.freeze({
    descriptor: deepFreeze(descriptor),
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    handler: options.handler
  })
}

export class CapabilityRegistry {
  #definitions = new Map<string, CapabilityDefinition>()
  #staging: Map<string, CapabilityDefinition> | undefined
  #expectedRegistration: CapabilityDefinition | undefined

  #assertNotPublishing(): void {
    if (this.#staging) throw new CapabilityRegistrationError('reentrant_mutation', 'Registry mutation during Host publication policy is not allowed.')
  }

  constructor(definitions: readonly CapabilityDefinition[] = []) {
    for (const definition of definitions) this.register(definition)
  }

  register<
    InputSchema extends AnyZodSchema,
    OutputSchema extends AnyZodSchema
  >(definition: CapabilityDefinition<InputSchema, OutputSchema>): this {
    if (this.#staging) {
      if (this.#expectedRegistration !== definition) this.#assertNotPublishing()
      // Exactly one base registration is permitted for the current policy call.
      // Any nested mutation, including a second super.register, must reject.
      this.#expectedRegistration = undefined
    }
    if (!definition || typeof definition !== 'object') {
      throw new CapabilityRegistrationError('invalid_definition', 'Capability definition must be an object.')
    }
    if (typeof definition.handler !== 'function') {
      throw new CapabilityRegistrationError(
        'missing_handler',
        `Capability ${definition.descriptor?.id ?? '<unknown>'} must have exactly one handler.`
      )
    }

    const descriptorResult = capabilityDescriptorSchema.safeParse(definition.descriptor)
    if (!descriptorResult.success) {
      throw new CapabilityRegistrationError(
        'invalid_descriptor',
        `Capability descriptor is invalid: ${descriptorResult.error.message}`
      )
    }
    if (!(definition.inputSchema instanceof z.ZodType) || !(definition.outputSchema instanceof z.ZodType)) {
      throw new CapabilityRegistrationError(
        'invalid_schema',
        `Capability ${descriptorResult.data.id} must bind executable Zod input and output schemas.`
      )
    }
    const boundInputSchema = schemaToWireValue(definition.inputSchema, `${descriptorResult.data.id} input`)
    const boundOutputSchema = schemaToWireValue(definition.outputSchema, `${descriptorResult.data.id} output`)
    if (JSON.stringify(boundInputSchema) !== JSON.stringify(descriptorResult.data.inputSchema)
      || JSON.stringify(boundOutputSchema) !== JSON.stringify(descriptorResult.data.outputSchema)) {
      throw new CapabilityRegistrationError(
        'schema_binding_mismatch',
        `Capability ${descriptorResult.data.id} descriptor schemas do not match its executable Zod schemas.`
      )
    }
    const target = this.#staging ?? this.#definitions
    if (target.has(descriptorResult.data.id)) {
      throw new CapabilityRegistrationError(
        'duplicate_capability',
        `Capability ${descriptorResult.data.id} is already registered.`
      )
    }

    target.set(descriptorResult.data.id, Object.freeze({
      descriptor: deepFreeze(descriptorResult.data),
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      handler: definition.handler
    }))
    return this
  }

  registerAll(definitions: readonly CapabilityDefinition[]): this {
    this.#assertNotPublishing()
    for (const definition of definitions) this.register(definition)
    return this
  }

  /** Host-only composition operation: validate the whole next generation before publishing.
   * A previous definition is a reference lease, not an ID-based replacement grant.
   * Packages cannot supply these references across the child process boundary.
   * Synchronous policy overrides must call base register exactly once with the
   * supplied candidate. Their reads observe the complete old map; all other
   * reentrant mutations reject (including independent IDs). No write is accepted
   * and later revoked by outer rollback. Policy failure discards only this write
   * set, preserving every live definition's exact identity. No callback runs
   * between fallible owner preparation and the final assignment-only commits.
   */
  replaceOwned(
    previous: readonly CapabilityDefinition[],
    definitions: readonly CapabilityDefinition[],
    options: Readonly<{
      validateOnly?: boolean
      /** Fallible owner preparation; returned commit must be assignment-only. */
      beforePublish?: (definitions: readonly CapabilityDefinition[]) => (() => void) | undefined
    }> = {}
  ): readonly CapabilityDefinition[] {
    this.#assertNotPublishing()
    const owned = new Map(previous.map((definition) => [definition.descriptor.id, definition]))
    for (const [id, definition] of owned) {
      if (this.#definitions.get(id) !== definition) {
        throw new CapabilityRegistrationError('duplicate_capability', `Capability ${id} ownership changed; stale generation cannot replace it.`)
      }
    }
    // Detached validation includes schema consistency, duplicate IDs, and normalization.
    const staged = new CapabilityRegistry(definitions)
    const next = [...staged.#definitions.values()]
    for (const definition of next) {
      const id = definition.descriptor.id
      if (this.#definitions.has(id) && !owned.has(id)) {
        throw new CapabilityRegistrationError('duplicate_capability', `Capability ${id} is already registered.`)
      }
    }
    if (options.validateOnly) return next
    // Host register policy runs against a detached write set. Reads keep seeing the
    // complete old generation until the single map-reference publication below.
    const stagedPublication = new Map(this.#definitions)
    for (const id of owned.keys()) stagedPublication.delete(id)
    this.#staging = stagedPublication
    try {
      for (const definition of next) {
        this.#expectedRegistration = definition
        this.register(definition)
        if (this.#expectedRegistration) throw new CapabilityRegistrationError('invalid_definition', 'Host registration policy did not register the candidate.')
      }
      const published = next.map((definition) => stagedPublication.get(definition.descriptor.id)!)
      const commitOwners = options.beforePublish?.(published)
      // The detached owner commit and this map assignment are the only final
      // boundary. Both are assignment-only; all fallible policy work is above.
      commitOwners?.()
      this.#definitions = stagedPublication
      return published
    } finally {
      this.#expectedRegistration = undefined
      this.#staging = undefined
    }
  }

  unregister(id: string): boolean {
    this.#assertNotPublishing()
    return this.#definitions.delete(id)
  }

  has(id: string): boolean {
    return this.#definitions.has(id)
  }

  get(id: string): CapabilityDefinition | undefined {
    return this.#definitions.get(id)
  }

  require(id: string): CapabilityDefinition {
    const definition = this.get(id)
    if (!definition) {
      throw new CapabilityRegistrationError('unknown_capability', `Capability ${id} is not registered.`)
    }
    return definition
  }

  list(): CapabilityDescriptor[] {
    return [...this.#definitions.values()]
      .map((definition) => definition.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  discover(
    rawCaller: CapabilityCallerContextInput,
    rawQuery: CapabilityDiscoveryQuery | undefined = undefined
  ): CapabilityDescriptor[] {
    const caller = capabilityCallerContextSchema.parse(rawCaller)
    const query = rawQuery ? capabilityDiscoveryQuerySchema.parse(rawQuery) : undefined
    return discoverCapabilityDescriptors(this.list(), caller, query, 'native')
  }
}

/**
 * Canonical capability discovery filter and ranking used by native registry
 * entries and managed provider projections. Provider adapters supply their
 * family explicitly; the query never infers one from text or resource fields.
 */
export function discoverCapabilityDescriptors(
  descriptors: readonly CapabilityDescriptor[],
  rawCaller: CapabilityCallerContextInput,
  rawQuery: CapabilityDiscoveryQuery | undefined = undefined,
  providerFamily: CapabilityProviderFamily = 'native'
): CapabilityDescriptor[] {
  const caller = capabilityCallerContextSchema.parse(rawCaller)
  const query = rawQuery ? capabilityDiscoveryQuerySchema.parse(rawQuery) : undefined
  if (query?.providerFamily && query.providerFamily !== providerFamily) return []

  const queryTokens = query?.text ? normalizedTokens(query.text) : []
  const ranked = descriptors.flatMap((descriptor) => {
    if (!descriptor.audiences.includes(caller.audience)) return []
    if (query?.capabilityId && descriptor.id !== query.capabilityId) return []
    if (query?.scope && descriptor.scope !== query.scope) return []
    if (
      query?.acceptedResourceKind
      && (descriptor.scope !== 'resource' || !descriptor.resourceKinds.includes(query.acceptedResourceKind))
    ) return []
    if (
      query?.producedResourceKind
      && !descriptor.producedResourceKinds?.includes(query.producedResourceKind)
    ) return []
    if (query?.effects && !query.effects.includes(descriptor.effect)) return []
    if (query?.tags && !query.tags.every((tag) => descriptor.tags.includes(tag))) return []

    const score = discoveryTextScore(
      descriptor,
      query?.capabilityId ? undefined : query?.text,
      query?.capabilityId ? [] : queryTokens
    )
    if (score === undefined) return []
    return [{ descriptor, score }]
  })

  ranked.sort((left, right) => (
    right.score - left.score
    || left.descriptor.id.localeCompare(right.descriptor.id)
  ))
  const limit = query?.limit
  return (limit ? ranked.slice(0, limit) : ranked).map(({ descriptor }) => descriptor)
}

function discoveryTextScore(
  descriptor: CapabilityDescriptor,
  text: string | undefined,
  queryTokens: readonly string[]
): number | undefined {
  if (!text) return 0
  const normalizedText = normalizeDiscoveryText(text)
  const fields = {
    id: normalizeDiscoveryText(descriptor.id),
    title: normalizeDiscoveryText(descriptor.title),
    description: normalizeDiscoveryText(descriptor.description),
    tags: descriptor.tags.map(normalizeDiscoveryText)
  }
  // Keep the original token for exact/diagnostic matching, while also
  // indexing conservative English inflections. Models commonly ask for
  // "update" while a descriptor says "updates" (or "task" vs "tasks").
  // Discovery is metadata-only, so this broadens recall without changing
  // authorization or the explicit scope/resource/provider filters.
  const fieldTokens = {
    id: new Set(descriptorDiscoveryTokens(descriptor.id)),
    title: new Set(descriptorDiscoveryTokens(descriptor.title)),
    description: new Set(descriptorDiscoveryTokens(descriptor.description)),
    tags: new Set(descriptor.tags.flatMap(descriptorDiscoveryTokens))
  }
  const allTokens = new Set([
    ...fieldTokens.id,
    ...fieldTokens.title,
    ...fieldTokens.description,
    ...fieldTokens.tags
  ])
  const matchedTokens = queryTokens.filter((token) => (
    discoveryTokenVariants(token).some((variant) => allTokens.has(variant))
  ))
  const minimumMatches = queryTokens.length <= 2
    ? queryTokens.length
    : Math.ceil(queryTokens.length / 2)
  if (matchedTokens.length < minimumMatches) return undefined

  let score = 0
  if (fields.id === normalizedText) score += 10_000
  if (fields.title === normalizedText) score += 5_000
  if (fields.id.includes(normalizedText)) score += 1_000
  if (fields.title.includes(normalizedText)) score += 800
  if (fields.tags.includes(normalizedText)) score += 600
  if (fields.description.includes(normalizedText)) score += 200
  for (const token of matchedTokens) {
    const variants = discoveryTokenVariants(token)
    if (variants.some((variant) => fieldTokens.id.has(variant))) score += 100
    if (variants.some((variant) => fieldTokens.title.has(variant))) score += 80
    if (variants.some((variant) => fieldTokens.tags.has(variant))) score += 60
    if (variants.some((variant) => fieldTokens.description.has(variant))) score += 20
  }
  score += Math.round((matchedTokens.length / queryTokens.length) * 100)
  score -= (queryTokens.length - matchedTokens.length) * 10
  return score
}

function normalizedTokens(value: string): string[] {
  const normalized = normalizeDiscoveryText(value)
  const tokens = (normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
    // A whitespace-free CJK sentence is not a useful single token for
    // ranked discovery, but a short CJK word is. Keep the exact run and
    // add overlapping bigrams below.
    .filter((token) => !/[\u3400-\u9fff]/u.test(token))
  // CJK text has no whitespace boundaries. Index each contiguous CJK run as
  // the exact run plus overlapping character bigrams so a natural Chinese
  // request can match CJK text inside English-named capability descriptions,
  // instead of relying on a hard-coded keyword list.
  const cjkRuns = normalized.match(/[\u3400-\u9fff]+/gu) ?? []
  for (const run of cjkRuns) {
    tokens.push(run)
    if (run.length > 1) {
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.push(run.slice(index, index + 2))
      }
    }
  }
  return [...new Set(tokens)]
}

function descriptorDiscoveryTokens(value: string): string[] {
  return [...new Set(normalizedTokens(value).flatMap(discoveryTokenVariants))]
}

function discoveryTokenVariants(token: string): string[] {
  const variants = [token]
  // These intentionally conservative variants cover common English plural
  // and verb forms without applying a general-purpose stemmer to Chinese or
  // to short/ambiguous words.
  if (token.length > 4 && token.endsWith('ies')) variants.push(`${token.slice(0, -3)}y`)
  if (token.length > 4 && token.endsWith('s') && !/(?:ss|is|us)$/u.test(token)) {
    variants.push(token.slice(0, -1))
  }
  if (token.length > 5 && token.endsWith('ing')) variants.push(token.slice(0, -3))
  if (token.length > 4 && token.endsWith('ed')) variants.push(token.slice(0, -2))
  return [...new Set(variants)]
}

function normalizeDiscoveryText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}
