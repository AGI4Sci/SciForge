import { randomBytes } from 'node:crypto'
import {
  DOMAIN_EXTERNAL_NAVIGATION_LIMITS,
  DomainExternalNavigationError,
  domainExternalNavigationIssueTargetInputSchema,
  domainExternalNavigationIssuedTargetSchema,
  domainExternalNavigationTargetHandleSchema,
  type DomainExternalNavigationIssuedTarget,
  type DomainExternalNavigationTargetHandle,
  type DomainMainExternalNavigationHost
} from '@sciforge/domain-sdk/external-navigation'
import {
  boundedHostResourceGrantOwnerId,
  defineHostResourceGrantCaller,
  requireActiveHostResourceGrantCaller,
  type HostResourceGrantCaller,
  type HostResourceGrantInvocationProvider
} from './host-resource-grants'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { samePrincipalSnapshot } from '@sciforge/domain-sdk/principal'

const DEFAULT_MAX_TARGET_TTL_MS = 5 * 60_000
const DEFAULT_MAX_TARGETS = 256

type PortalTarget = Readonly<{
  ownerId: string
  caller: HostResourceGrantCaller
  url: string
  expiresAt: number
}>

export type HostExternalNavigationServiceOptions = Readonly<{
  openExternal: (url: string) => Promise<void>
  /** The Host Principal Context must perform this live authorization check. */
  isPrincipalCurrent: (principal: PrincipalSnapshot) => boolean
  now?: () => Date
  maxTargetTtlMs?: number
  maxTargets?: number
}>

/** Principal-bound, bounded, one-shot external browser targets. */
export class HostExternalNavigationService {
  readonly #targets = new Map<DomainExternalNavigationTargetHandle, PortalTarget>()
  readonly #openExternal: (url: string) => Promise<void>
  readonly #isPrincipalCurrent: (principal: PrincipalSnapshot) => boolean
  readonly #now: () => Date
  readonly #maxTargetTtlMs: number
  readonly #maxTargets: number
  #activeDispatches = 0
  #disposed = false

  constructor(options: HostExternalNavigationServiceOptions) {
    if (typeof options.openExternal !== 'function') {
      throw new TypeError('External navigation requires a Host browser opener.')
    }
    if (typeof options.isPrincipalCurrent !== 'function') {
      throw new TypeError('External navigation requires a live Principal verifier.')
    }
    this.#openExternal = options.openExternal
    this.#isPrincipalCurrent = options.isPrincipalCurrent
    this.#now = options.now ?? (() => new Date())
    this.#maxTargetTtlMs = boundedPositiveInteger(
      options.maxTargetTtlMs ?? DEFAULT_MAX_TARGET_TTL_MS,
      DEFAULT_MAX_TARGET_TTL_MS,
      'The external target lifetime bound is invalid.'
    )
    this.#maxTargets = boundedPositiveInteger(
      options.maxTargets ?? DEFAULT_MAX_TARGETS,
      65_536,
      'The external target capacity is invalid.'
    )
  }

  /** Package-facing facade with Host-derived caller and current Principal. */
  forOwner(
    ownerId: string,
    currentInvocation: HostResourceGrantInvocationProvider
  ): DomainMainExternalNavigationHost {
    const owner = boundedHostResourceGrantOwnerId(ownerId)
    const activeCaller = () => {
      try {
        return requireActiveHostResourceGrantCaller(currentInvocation)
      } catch {
        throw new DomainExternalNavigationError(
          'principal_changed',
          'An active capability invocation with a current Principal is required.'
        )
      }
    }
    return Object.freeze({
      issueTarget: (input) => this.#issueTarget({
        ...input,
        ownerId: owner,
        caller: activeCaller()
      }),
      openTarget: (input) => this.#openTarget({
        ...input,
        ownerId: owner,
        caller: activeCaller()
      })
    })
  }

  #issueTarget(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    url: string
    expiresAt: string
  }>): DomainExternalNavigationIssuedTarget {
    this.#assertAvailable()
    const caller = defineHostResourceGrantCaller(input.caller)
    this.#assertCurrent(caller)
    const parsedInput = domainExternalNavigationIssueTargetInputSchema.safeParse({
      url: input.url,
      expiresAt: input.expiresAt
    })
    if (!parsedInput.success) {
      throw new DomainExternalNavigationError(
        'invalid_target',
        'The external portal target request is invalid.'
      )
    }
    const now = this.#now().getTime()
    const expiresAt = Date.parse(parsedInput.data.expiresAt)
    const url = safeHttpsUrl(parsedInput.data.url)
    if (
      !Number.isFinite(expiresAt) || expiresAt <= now ||
      expiresAt > now + this.#maxTargetTtlMs
    ) {
      throw new DomainExternalNavigationError(
        'invalid_target',
        'The external portal target expiration is invalid.'
      )
    }
    this.#sweep(now)
    if (this.#targets.size + this.#activeDispatches >= this.#maxTargets) {
      throw new DomainExternalNavigationError(
        'capacity_exceeded',
        'The bounded Host external target table is full.'
      )
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const handle = domainExternalNavigationTargetHandleSchema.parse(
        `portal_${randomBytes(24).toString('base64url')}`
      )
      if (this.#targets.has(handle)) continue
      this.#targets.set(handle, Object.freeze({
        ownerId: input.ownerId,
        caller,
        url,
        expiresAt
      }))
      return domainExternalNavigationIssuedTargetSchema.parse({
        handle,
        expiresAt: new Date(expiresAt).toISOString()
      })
    }
    throw new DomainExternalNavigationError(
      'capacity_exceeded',
      'The Host could not allocate a unique external target handle.'
    )
  }

  async #openTarget(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    handle: DomainExternalNavigationTargetHandle
    signal?: AbortSignal
  }>): Promise<void> {
    this.#assertAvailable()
    const caller = defineHostResourceGrantCaller(input.caller)
    const parsed = domainExternalNavigationTargetHandleSchema.safeParse(input.handle)
    if (!parsed.success) {
      throw new DomainExternalNavigationError(
        'invalid_target',
        'The external target handle is invalid.'
      )
    }
    const target = this.#targets.get(parsed.data)
    if (!target) {
      throw new DomainExternalNavigationError(
        'target_unavailable',
        'The Host-owned external target handle is unavailable.'
      )
    }
    if (target.expiresAt <= this.#now().getTime()) {
      this.#targets.delete(parsed.data)
      throw new DomainExternalNavigationError(
        'target_unavailable',
        'The Host-owned external target handle is unavailable.'
      )
    }
    // Guessed handles do not let another owner or caller consume a valid
    // target. The exact lease consumes it before live reauthorization and OS
    // dispatch, so those later failures remain one-shot and cannot be retried.
    if (
      target.ownerId !== input.ownerId ||
      target.caller.callerId !== caller.callerId
    ) {
      throw new DomainExternalNavigationError(
        'target_unavailable',
        'The Host-owned external target handle is unavailable.'
      )
    }
    if (!samePrincipalSnapshot(target.caller.principal, caller.principal)) {
      this.#targets.delete(parsed.data)
      throw new DomainExternalNavigationError(
        'principal_changed',
        'The current Principal no longer matches the external target grant.'
      )
    }
    if (input.signal?.aborted) {
      throw new DomainExternalNavigationError(
        'cancelled',
        'The external portal dispatch was cancelled before it started.'
      )
    }
    this.#targets.delete(parsed.data)
    this.#assertCurrent(caller)
    if (input.signal?.aborted) {
      throw new DomainExternalNavigationError(
        'cancelled',
        'The external portal dispatch was cancelled before it started.'
      )
    }
    this.#activeDispatches += 1
    try {
      let dispatchFailed = false
      let dispatchError: unknown
      try {
        await this.#openExternal(safeHttpsUrl(target.url))
      } catch (error) {
        dispatchFailed = true
        dispatchError = error
      }
      try {
        if (input.signal?.aborted) {
          throw new DomainExternalNavigationError(
            'cancelled',
            'The external portal dispatch was cancelled while its outcome was pending.'
          )
        }
        this.#assertCurrent(caller)
      } catch {
        throw new DomainExternalNavigationError(
          'outcome_unknown',
          'The external portal may have opened after authorization changed.'
        )
      }
      if (dispatchFailed) {
        if (dispatchError instanceof DomainExternalNavigationError) throw dispatchError
        throw new DomainExternalNavigationError(
          'open_failed',
          'The operating system could not open the external target.'
        )
      }
    } finally {
      this.#activeDispatches -= 1
    }
  }

  revokeCaller(callerId: string): void {
    const normalized = callerId.trim()
    if (!normalized) return
    for (const [handle, target] of this.#targets) {
      if (target.caller.callerId === normalized) this.#targets.delete(handle)
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#targets.clear()
  }

  #assertAvailable(): void {
    if (this.#disposed) {
      throw new DomainExternalNavigationError(
        'target_unavailable',
        'External navigation targets are unavailable.'
      )
    }
  }

  #assertCurrent(caller: HostResourceGrantCaller): void {
    let current = false
    try {
      current = this.#isPrincipalCurrent(caller.principal)
    } catch {
      throw new DomainExternalNavigationError(
        'principal_changed',
        'The current Principal could not be reauthorized.'
      )
    }
    if (!current) {
      throw new DomainExternalNavigationError(
        'principal_changed',
        'The current Principal no longer matches the external target grant.'
      )
    }
  }

  #sweep(now: number): void {
    for (const [handle, target] of this.#targets) {
      if (target.expiresAt <= now) this.#targets.delete(handle)
    }
  }
}

function safeHttpsUrl(raw: string): string {
  if (
    typeof raw !== 'string' || raw.length < 1 ||
    raw.length > DOMAIN_EXTERNAL_NAVIGATION_LIMITS.maxUrlCharacters ||
    raw !== raw.trim() || hasUnsafeUrlCharacter(raw)
  ) {
    throw new DomainExternalNavigationError(
      'invalid_target',
      'The external portal target is invalid.'
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DomainExternalNavigationError(
      'invalid_target',
      'The external portal target is not a valid URL.'
    )
  }
  const authority = rawAuthority(raw)
  if (
    url.protocol !== 'https:' || !raw.toLowerCase().startsWith('https://') ||
    !authority || url.username || url.password || authority.includes('@') || !url.hostname ||
    raw.includes('#') || url.hash
  ) {
    throw new DomainExternalNavigationError(
      'invalid_target',
      'Only HTTPS portal targets without userinfo or fragment data are allowed.'
    )
  }
  // Parsing is validation only. Re-serialization can alter case, escapes, a
  // default port, or query encoding and thereby invalidate a signed target.
  return raw
}

function rawAuthority(value: string): string {
  const authorityStart = value.indexOf('//') + 2
  let authorityEnd = value.length
  for (const delimiter of ['/', '?', '#']) {
    const index = value.indexOf(delimiter, authorityStart)
    if (index >= 0 && index < authorityEnd) authorityEnd = index
  }
  return value.slice(authorityStart, authorityEnd)
}

function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x20 || codePoint === 0x7f || character === '\\') return true
  }
  return false
}

function boundedPositiveInteger(value: number, maximum: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(message)
  }
  return value
}
