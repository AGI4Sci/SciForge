import { createHash } from 'node:crypto'

const DEFAULT_RETIREMENT_MS = 5 * 60_000
const MAX_ACTIVE_SECRETS = 512
const MAX_RETIRED_SECRETS = 512
const MAX_SECRET_CHARACTERS = 1_000_000

type RetiredSecret = Readonly<{
  identity: string
  value: string
  expiresAt: number
}>

/**
 * In-memory exact-value registry shared by managed logs and full trace.
 * It is deliberately non-durable and exposes no lookup by record identity.
 */
export class ManagedSecretRedactionRegistry {
  readonly #active = new Map<string, string>()
  readonly #retired = new Map<string, RetiredSecret>()
  readonly #now: () => number
  readonly #retirementMs: number

  constructor(options: Readonly<{
    now?: () => number
    retirementMs?: number
  }> = {}) {
    this.#now = options.now ?? Date.now
    this.#retirementMs = boundedRetirement(options.retirementMs ?? DEFAULT_RETIREMENT_MS)
  }

  activate(input: Readonly<{
    recordId: string
    secret: string
    replacedSecret?: string
  }>): void {
    const recordId = boundedRecordId(input.recordId)
    const secret = boundedSecret(input.secret)
    const previous = this.#active.get(recordId)
    if (previous && previous !== secret) this.#retireValue(previous)
    if (input.replacedSecret && input.replacedSecret !== secret) {
      this.#retireValue(boundedSecret(input.replacedSecret))
    }
    if (!this.#active.has(recordId) && this.#active.size >= MAX_ACTIVE_SECRETS) {
      throw new Error('Managed active-secret redaction capacity is exhausted.')
    }
    this.#active.set(recordId, secret)
  }

  retire(input: Readonly<{ recordId: string; secret: string }>): void {
    const recordId = boundedRecordId(input.recordId)
    const secret = boundedSecret(input.secret)
    if (this.#active.get(recordId) === secret) this.#active.delete(recordId)
    this.#retireValue(secret)
  }

  readonly values = (): string[] => {
    this.#prune()
    return [...new Set([
      ...this.#active.values(),
      ...[...this.#retired.values()].map(({ value }) => value)
    ])]
  }

  #retireValue(value: string): void {
    this.#prune()
    const identity = createHash('sha256').update(value).digest('hex')
    this.#retired.delete(identity)
    this.#retired.set(identity, Object.freeze({
      identity,
      value,
      expiresAt: this.#now() + this.#retirementMs
    }))
    while (this.#retired.size > MAX_RETIRED_SECRETS) {
      const oldest = this.#retired.keys().next().value as string | undefined
      if (!oldest) break
      this.#retired.delete(oldest)
    }
  }

  #prune(): void {
    const now = this.#now()
    for (const [identity, retired] of this.#retired) {
      if (retired.expiresAt <= now) this.#retired.delete(identity)
    }
  }
}

function boundedRecordId(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new TypeError('Managed secret record identity is invalid.')
  }
  return value
}

function boundedSecret(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SECRET_CHARACTERS) {
    throw new TypeError('Managed secret value is invalid.')
  }
  return value
}

function boundedRetirement(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60_000) {
    throw new TypeError('Managed secret retirement window is invalid.')
  }
  return value
}
