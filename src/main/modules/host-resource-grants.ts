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
    audience?: 'ui' | 'agent' | 'system'
    workspaceId?: string
  }>
  effect?: string
  approval?: string
  approved?: boolean
}>

export type HostAgentWorkspaceResourceGrantCaller = HostResourceGrantCaller & Readonly<{
  workspaceId: string
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

export function requireActiveAgentWorkspaceResourceGrantCaller(
  currentInvocation: HostResourceGrantInvocationProvider
): HostAgentWorkspaceResourceGrantCaller {
  const invocation = currentInvocation()
  const workspaceId = invocation?.caller.workspaceId?.trim()
  if (
    invocation?.caller.audience !== 'agent' || !workspaceId ||
    invocation.effect !== 'external-write' ||
    invocation.approval !== 'confirmation' || invocation.approved !== true
  ) {
    throw new Error(
      'An approved Agent external-write invocation with an active Workspace is required.'
    )
  }
  return Object.freeze({
    ...requireActiveHostResourceGrantCaller(currentInvocation),
    workspaceId
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
