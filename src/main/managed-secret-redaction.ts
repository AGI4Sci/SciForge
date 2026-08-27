const MAX_ACTIVE_SECRETS = 512
const MAX_SECRET_CHARACTERS = 1_000_000

/**
 * In-memory exact-value registry shared by managed logs and full trace.
 * It is deliberately non-durable and exposes no lookup by record identity.
 */
export class ManagedSecretRedactionRegistry {
  readonly #active = new Map<string, string>()

  activate(input: Readonly<{
    recordId: string
    secret: string
  }>): void {
    const recordId = boundedRecordId(input.recordId)
    const secret = boundedSecret(input.secret)
    if (!this.#active.has(recordId) && this.#active.size >= MAX_ACTIVE_SECRETS) {
      throw new Error('Managed active-secret redaction capacity is exhausted.')
    }
    this.#active.set(recordId, secret)
  }

  release(input: Readonly<{ recordId: string; secret: string }>): void {
    const recordId = boundedRecordId(input.recordId)
    const secret = boundedSecret(input.secret)
    if (this.#active.get(recordId) === secret) this.#active.delete(recordId)
  }

  readonly values = (): string[] => {
    return [...new Set(this.#active.values())]
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
