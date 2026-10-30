import type {
  CapabilityCallerContext,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityJsonValue
} from '../../shared/capability-broker'
import type {
  CapabilityAgentBroker,
  CapabilityAgentToolRequestContext
} from '../capabilities/agent-tools'
import type { DomainMainOrdinarySessionIdentity } from '@sciforge/domain-sdk/host'
import { appendFile } from 'node:fs/promises'

export const CAPABILITY_EVAL_FAULT_POLICY_ENV = 'SCIFORGE_CAPABILITY_EVAL_FAULT_POLICY'
export const CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV = 'SCIFORGE_CAPABILITY_EVAL_FAULT_MATCH_LOG'

export type CapabilityEvalFaultRule = Readonly<{
  id?: string
  caseId?: string
  actionId: string
  inputContains?: string
  failures: number | 'always'
  errorCode: string
  failureClass?: string
  retryable?: boolean
  providerStage?: string
}>

export type CapabilityEvalFaultPolicy = Readonly<{
  rules: readonly CapabilityEvalFaultRule[]
}>

export type CapabilityEvalFaultMatch = Readonly<{
  ruleId?: string
  caseId?: string
  actionId: string
  callerId: string
  attempt: number
  injected: boolean
  errorCode: string
}>

/**
 * Error shape intentionally mirrors the fields consumed by the Agent tool
 * surface. The underlying CapabilityBroker is not changed and is not called
 * for injected attempts, so the harness can model a provider-side fault while
 * keeping the normal invocation path untouched when no policy is configured.
 */
export class CapabilityEvalProviderFaultError extends Error {
  readonly code: string
  readonly failureClass: string
  readonly retryable: boolean
  readonly providerStage: string
  readonly details: CapabilityJsonValue

  constructor(input: Readonly<{
    actionId: string
    errorCode: string
    attempt: number
    caseId?: string
    failureClass?: string
    retryable?: boolean
    providerStage?: string
  }>) {
    super(`Capability Eval provider fault injected for ${input.actionId}: ${input.errorCode}.`)
    this.name = 'CapabilityEvalProviderFaultError'
    this.code = input.errorCode
    this.failureClass = input.failureClass ?? 'provider'
    this.retryable = input.retryable ?? true
    this.providerStage = input.providerStage ?? 'provider'
    this.details = {
      source: 'capability-eval-provider-fault-harness',
      actionId: input.actionId,
      attempt: input.attempt,
      ...(input.caseId ? { caseId: input.caseId } : {})
    }
  }
}

/**
 * Reads the explicit process-level policy used by a disposable eval Host.
 * Invalid configuration fails closed at Host startup rather than silently
 * running an uncontrolled scenario.
 */
export function readCapabilityEvalFaultPolicy(
  environment: NodeJS.ProcessEnv = process.env
): CapabilityEvalFaultPolicy | undefined {
  const raw = environment[CAPABILITY_EVAL_FAULT_POLICY_ENV]?.trim()
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${CAPABILITY_EVAL_FAULT_POLICY_ENV} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return parseCapabilityEvalFaultPolicy(parsed)
}

export function parseCapabilityEvalFaultPolicy(value: unknown): CapabilityEvalFaultPolicy {
  if (!isRecord(value) || !Array.isArray(value.rules) || value.rules.length > 128) {
    throw new Error('Capability Eval fault policy must be an object with at most 128 rules.')
  }
  const rules = value.rules.map((rawRule, index) => {
    if (!isRecord(rawRule)) throw new Error(`Capability Eval fault rule ${index} must be an object.`)
    const actionId = requiredString(rawRule.actionId, `rules[${index}].actionId`)
    const errorCode = requiredString(rawRule.errorCode, `rules[${index}].errorCode`)
    const failuresValue = rawRule.failures
    if (failuresValue !== 'always' && (
      typeof failuresValue !== 'number' ||
      !Number.isSafeInteger(failuresValue) ||
      failuresValue <= 0 ||
      failuresValue > 100
    )) {
      throw new Error(`Capability Eval fault rule ${index} failures must be a positive integer or "always".`)
    }
    const inputContains = optionalString(rawRule.inputContains, `rules[${index}].inputContains`)
    const failureClass = optionalString(rawRule.failureClass, `rules[${index}].failureClass`)
    const providerStage = optionalString(rawRule.providerStage, `rules[${index}].providerStage`)
    if (rawRule.retryable !== undefined && typeof rawRule.retryable !== 'boolean') {
      throw new Error(`Capability Eval fault rule ${index} retryable must be boolean.`)
    }
    const caseId = optionalString(rawRule.caseId, `rules[${index}].caseId`)
    const id = optionalString(rawRule.id, `rules[${index}].id`)
    return {
      ...(id ? { id } : {}),
      ...(caseId ? { caseId } : {}),
      actionId,
      ...(inputContains ? { inputContains } : {}),
      failures: failuresValue as number | 'always',
      errorCode,
      ...(failureClass ? { failureClass } : {}),
      ...(rawRule.retryable !== undefined ? { retryable: rawRule.retryable } : {}),
      ...(providerStage ? { providerStage } : {})
    }
  })
  return { rules: Object.freeze(rules) }
}

/**
 * Narrows a validated policy to one evaluation case. A rule without a case
 * scope is rejected so an isolated Host cannot accidentally inherit another
 * scenario's provider fault.
 */
export function scopeCapabilityEvalFaultPolicy(
  policy: CapabilityEvalFaultPolicy,
  caseId: string
): CapabilityEvalFaultPolicy {
  if (!caseId.trim()) throw new Error('Capability Eval fault policy caseId must be non-empty.')
  const unscoped = policy.rules.filter((rule) => rule.caseId === undefined)
  if (unscoped.length > 0) {
    throw new Error('Every Capability Eval fault rule must declare caseId before it can be used for a live run.')
  }
  return {
    rules: Object.freeze(policy.rules.filter((rule) => rule.caseId === caseId))
  }
}

/**
 * Adds a fault policy only to the Agent-facing broker surface. With no policy
 * this returns the original broker object, avoiding any behavioral change for
 * normal application runs and for UI/system callers.
 */
export function createCapabilityEvalFaultBroker(
  broker: CapabilityAgentBroker,
  policy = readCapabilityEvalFaultPolicy()
): CapabilityAgentBroker {
  if (!policy || policy.rules.length === 0) return broker
  return new CapabilityEvalFaultBroker(broker, policy)
}

class CapabilityEvalFaultBroker implements CapabilityAgentBroker {
  readonly #broker: CapabilityAgentBroker
  readonly #policy: CapabilityEvalFaultPolicy
  readonly #attempts = new Map<string, number>()
  readonly #matchLogPath = process.env[CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV]?.trim()
  #matchLogWrite: Promise<void> = Promise.resolve()

  constructor(broker: CapabilityAgentBroker, policy: CapabilityEvalFaultPolicy) {
    this.#broker = broker
    this.#policy = policy
  }

  discover: CapabilityAgentBroker['discover'] = (caller, query, options) => (
    this.#broker.discover(caller, query, options)
  )

  observe: CapabilityAgentBroker['observe'] = (caller, request) => (
    this.#broker.observe(caller, request)
  )

  bindResourceRef: CapabilityAgentBroker['bindResourceRef'] = (caller, resourceRef) => (
    this.#broker.bindResourceRef(caller, resourceRef)
  )

  describeResourceHandle: CapabilityAgentBroker['describeResourceHandle'] = (caller, resource) => (
    this.#broker.describeResourceHandle(caller, resource)
  )

  listEvents: CapabilityAgentBroker['listEvents'] = (caller, query) => (
    this.#broker.listEvents(caller, query)
  )

  async invoke(
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest,
    options?: { signal?: AbortSignal; context?: CapabilityAgentToolRequestContext }
  ): Promise<CapabilityInvocationResult> {
    await this.#throwIfFaulted(caller, request)
    return this.#broker.invoke(caller, request, options)
  }

  async invokeOrdinarySession(
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest,
    ordinarySession: DomainMainOrdinarySessionIdentity,
    options?: Parameters<NonNullable<CapabilityAgentBroker['invokeOrdinarySession']>>[3]
  ): Promise<CapabilityInvocationResult> {
    await this.#throwIfFaulted(caller, request)
    if (!this.#broker.invokeOrdinarySession) {
      throw new Error('The wrapped Capability Broker ordinary Session route is unavailable.')
    }
    return await this.#broker.invokeOrdinarySession(caller, request, ordinarySession, options)
  }

  abortTurn(...args: Parameters<NonNullable<CapabilityAgentBroker['abortTurn']>>): number {
    return this.#broker.abortTurn?.(...args) ?? 0
  }

  async #throwIfFaulted(
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest
  ): Promise<void> {
    const rule = this.#policy.rules.find((candidate) => (
      candidate.actionId === request.actionId && matchesInput(candidate, request.input)
    ))
    if (!rule) return

    const key = [
      caller.callerId,
      request.actionId,
      rule.inputContains ?? '*'
    ].join('\u0000')
    const attempt = (this.#attempts.get(key) ?? 0) + 1
    const shouldFail = rule.failures === 'always' || attempt <= rule.failures
    this.#attempts.set(key, attempt)
    await this.#recordMatch({
      ...(rule.id ? { ruleId: rule.id } : {}),
      ...(rule.caseId ? { caseId: rule.caseId } : {}),
      actionId: request.actionId,
      callerId: caller.callerId,
      attempt,
      injected: shouldFail,
      errorCode: rule.errorCode
    })
    if (!shouldFail) return
    throw new CapabilityEvalProviderFaultError({
      actionId: request.actionId,
      errorCode: rule.errorCode,
      attempt,
      ...(rule.caseId ? { caseId: rule.caseId } : {}),
      ...(rule.failureClass ? { failureClass: rule.failureClass } : {}),
      ...(rule.retryable !== undefined ? { retryable: rule.retryable } : {}),
      ...(rule.providerStage ? { providerStage: rule.providerStage } : {})
    })
  }

  async #recordMatch(match: CapabilityEvalFaultMatch): Promise<void> {
    if (!this.#matchLogPath) return
    this.#matchLogWrite = this.#matchLogWrite.then(() => (
      appendFile(this.#matchLogPath!, `${JSON.stringify(match)}\n`, 'utf8')
    ))
    await this.#matchLogWrite
  }
}

function matchesInput(rule: CapabilityEvalFaultRule, input: CapabilityJsonValue): boolean {
  return !rule.inputContains || JSON.stringify(input).includes(rule.inputContains)
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new Error(`Capability Eval fault policy ${path} must be a non-empty string of at most 256 characters.`)
  }
  return value.trim()
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
