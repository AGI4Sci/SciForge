import {
  principalSnapshotSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

/** Host-private lease. Domain packages and renderer payloads never construct it. */
export type HostResourceGrantCaller = Readonly<{
  callerId: string
  principal: PrincipalSnapshot
}>

export type HostResourceGrantInvocation = Readonly<{
  caller: Readonly<{
    callerId: string
    principal?: PrincipalSnapshot
  }>
}>

export type HostResourceGrantInvocationProvider = () =>
  HostResourceGrantInvocation | undefined

export function defineHostResourceGrantCaller(
  input: HostResourceGrantCaller
): HostResourceGrantCaller {
  const callerId = input.callerId.trim()
  if (
    !callerId || callerId !== input.callerId || callerId.length > 256 ||
    hasAsciiControlCharacter(callerId)
  ) {
    throw new TypeError('The Host resource grant caller is invalid.')
  }
  return Object.freeze({
    callerId,
    principal: principalSnapshotSchema.parse(input.principal)
  })
}

export function requireActiveHostResourceGrantCaller(
  currentInvocation: HostResourceGrantInvocationProvider
): HostResourceGrantCaller {
  const invocation = currentInvocation()
  if (!invocation?.caller.principal) {
    throw new Error('An active capability invocation with a current Principal is required.')
  }
  return defineHostResourceGrantCaller({
    callerId: invocation.caller.callerId,
    principal: invocation.caller.principal
  })
}

export function boundedHostResourceGrantOwnerId(value: string): string {
  const normalized = value.trim()
  if (
    !normalized || normalized !== value || normalized.length > 256 ||
    hasAsciiControlCharacter(normalized)
  ) {
    throw new TypeError('The Host resource grant owner is invalid.')
  }
  return normalized
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}
