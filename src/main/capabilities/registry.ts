import { z } from 'zod'
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
  audiences?: CapabilityAudience[]
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
  readonly #definitions = new Map<string, CapabilityDefinition>()

  constructor(definitions: readonly CapabilityDefinition[] = []) {
    for (const definition of definitions) this.register(definition)
  }

  register<
    InputSchema extends AnyZodSchema,
    OutputSchema extends AnyZodSchema
  >(definition: CapabilityDefinition<InputSchema, OutputSchema>): this {
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
    if (this.#definitions.has(descriptorResult.data.id)) {
      throw new CapabilityRegistrationError(
        'duplicate_capability',
        `Capability ${descriptorResult.data.id} is already registered.`
      )
    }

    this.#definitions.set(descriptorResult.data.id, Object.freeze({
      descriptor: deepFreeze(descriptorResult.data),
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      handler: definition.handler
    }))
    return this
  }

  registerAll(definitions: readonly CapabilityDefinition[]): this {
    for (const definition of definitions) this.register(definition)
    return this
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
  const fieldTokens = {
    id: new Set(normalizedTokens(descriptor.id)),
    title: new Set(normalizedTokens(descriptor.title)),
    description: new Set(normalizedTokens(descriptor.description)),
    tags: new Set(descriptor.tags.flatMap(normalizedTokens))
  }
  const allTokens = new Set([
    ...fieldTokens.id,
    ...fieldTokens.title,
    ...fieldTokens.description,
    ...fieldTokens.tags
  ])
  const matchedTokens = queryTokens.filter((token) => allTokens.has(token))
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
    if (fieldTokens.id.has(token)) score += 100
    if (fieldTokens.title.has(token)) score += 80
    if (fieldTokens.tags.has(token)) score += 60
    if (fieldTokens.description.has(token)) score += 20
  }
  score += Math.round((matchedTokens.length / queryTokens.length) * 100)
  score -= (queryTokens.length - matchedTokens.length) * 10
  return score
}

function normalizedTokens(value: string): string[] {
  return [...new Set(normalizeDiscoveryText(value).match(/[\p{L}\p{N}]+/gu) ?? [])]
}

function normalizeDiscoveryText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}
