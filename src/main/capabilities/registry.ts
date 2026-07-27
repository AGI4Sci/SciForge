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
  type CapabilityResourceHandle
} from '../../shared/capability-broker'

export type CapabilityResourceObservation = {
  state: CapabilityJsonValue
  semanticRevision: string
  layoutRevision?: string
  operationIds?: string[]
}

export type CapabilityResourceObserver = (
  caller: CapabilityCallerContext
) => CapabilityResourceObservation | Promise<CapabilityResourceObservation>

export type CapabilityResourceRegistration = {
  resourceId: string
  resourceKind: string
  workspaceId?: string
  audiences?: CapabilityAudience[]
  semanticRevision: string
  layoutRevision?: string
  observe: CapabilityResourceObserver
  contentTransport?: {
    describeActionId: string
    readRangeActionId: string
  }
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
  resource?: ResolvedCapabilityResource
  issueResource: (registration: CapabilityResourceRegistration) => CapabilityResourceHandle
  signal?: AbortSignal
}

export type CapabilityHandlerResult<Output> = {
  output: Output
  changed?: boolean
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
  'contractVersion' | 'inputSchema' | 'outputSchema' | 'resourceKinds' | 'tags'
> & {
  resourceKinds?: string[]
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
    effect: options.effect,
    approval: options.approval,
    concurrency: options.concurrency,
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
    const text = query?.text?.toLocaleLowerCase()

    return this.list().filter((descriptor) => {
      if (!descriptor.audiences.includes(caller.audience)) return false
      if (query?.resourceKind) {
        if (descriptor.scope !== 'resource' || !descriptor.resourceKinds.includes(query.resourceKind)) return false
      }
      if (query?.effects && !query.effects.includes(descriptor.effect)) return false
      if (query?.tags && !query.tags.every((tag) => descriptor.tags.includes(tag))) return false
      if (text) {
        const haystack = `${descriptor.id}\n${descriptor.title}\n${descriptor.description}\n${descriptor.tags.join(' ')}`.toLocaleLowerCase()
        if (!haystack.includes(text)) return false
      }
      return true
    })
  }
}
