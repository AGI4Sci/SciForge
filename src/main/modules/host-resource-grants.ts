import {
  principalSnapshotSchema,
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  domainSystemWorkspaceTransferAuthorizationSchema,
  type DomainSystemWorkspaceTransferAuthorization
} from '@sciforge/domain-sdk/file-transfer'
import {
  capabilityIdSchema,
  type CapabilityApprovalMode,
  type CapabilityEffect,
  type CapabilityScope
} from '../../shared/capability-broker'

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
    /** Host-projected manifest authority; never accepted from package input. */
    capabilityGrants?: readonly string[]
    principalSnapshotDigest?: string
    executionContextDigest?: string
  }>
  actionId?: string
  invocationId?: string
  effect?: CapabilityEffect
  approval?: CapabilityApprovalMode
  approved?: boolean
  scope?: CapabilityScope
  autonomousWrite?: 'resource-authorized'
  /** Broker-resolved input resource; never copied from a package request. */
  authorizedResource?: Readonly<{
    resourceRef: string
    resourceKind: string
    workspaceId?: string
    semanticRevision: string
  }>
}>

type HostResourceGrantInvocationSnapshot = Readonly<{
  caller: HostResourceGrantCaller
  audience?: 'ui' | 'agent' | 'system'
  workspaceId?: string
  capabilityGrants?: readonly string[]
  principalSnapshotDigest?: string
  executionContextDigest?: string
  actionId?: string
  invocationId?: string
  effect?: CapabilityEffect
  approval?: CapabilityApprovalMode
  approved?: boolean
  scope?: CapabilityScope
  autonomousWrite?: 'resource-authorized'
  authorizedResource?: Readonly<{
    resourceRef: string
    resourceKind: string
    workspaceId?: string
    semanticRevision: string
  }>
}>

/** Exact Host-private execution lease; object identity distinguishes replays. */
export type HostResourceGrantInvocationLease = HostResourceGrantCaller & Readonly<{
  invocation: HostResourceGrantInvocation
  snapshot: HostResourceGrantInvocationSnapshot
}>

export type HostAgentWorkspaceResourceGrantCaller = HostResourceGrantInvocationLease & Readonly<{
  workspaceId: string
}>

export type HostWorkspaceResourceGrantCaller = HostResourceGrantInvocationLease & Readonly<{
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
  const lease = requireActiveHostResourceGrantInvocationLease(currentInvocation)
  return Object.freeze({ callerId: lease.callerId, principal: lease.principal })
}

export function requireActiveHostResourceGrantInvocationLease(
  currentInvocation: HostResourceGrantInvocationProvider
): HostResourceGrantInvocationLease {
  const invocation = currentInvocation()
  if (!invocation?.caller.principal) {
    throw new Error('An active capability invocation with a current Principal is required.')
  }
  const snapshot = hostResourceGrantInvocationSnapshot(invocation)
  return Object.freeze({
    ...snapshot.caller,
    invocation,
    snapshot
  })
}

export function assertActiveHostResourceGrantInvocationLease(
  currentInvocation: HostResourceGrantInvocationProvider,
  lease: HostResourceGrantInvocationLease
): void {
  const current = currentInvocation()
  if (
    current !== lease.invocation ||
    !current ||
    !sameHostResourceGrantInvocationSnapshot(
      lease.snapshot,
      hostResourceGrantInvocationSnapshot(current)
    )
  ) {
    throw new Error('The exact Host capability invocation lease is no longer active.')
  }
}

export function requireActiveAgentWorkspaceResourceGrantCaller(
  currentInvocation: HostResourceGrantInvocationProvider,
  direction: 'upload-source' | 'download-destination'
): HostAgentWorkspaceResourceGrantCaller {
  const lease = requireActiveHostResourceGrantInvocationLease(currentInvocation)
  const invocation = lease.invocation
  const workspaceId = invocation.caller.workspaceId?.trim()
  const invocationId = invocation.invocationId?.trim()
  const authorizedResource = invocation.authorizedResource
  const directionAuthorized = direction === 'upload-source'
    ? invocation?.effect === 'external-write' &&
      invocation.autonomousWrite === 'resource-authorized'
    : invocation?.effect === 'workspace-write' && invocation.autonomousWrite === undefined
  if (
    invocation?.caller.audience !== 'agent' || !workspaceId || !invocationId ||
    invocation.approval !== 'none' || invocation.approved !== true ||
    invocation.scope !== 'resource' ||
    !directionAuthorized ||
    !authorizedResource || authorizedResource.workspaceId !== workspaceId
  ) {
    throw new Error(
      'A Broker-authorized Agent resource write with an active Workspace is required.'
    )
  }
  return Object.freeze({
    ...lease,
    workspaceId
  })
}

/**
 * Canonical Workspace-transfer authority. Omitting system authorization keeps
 * the existing Agent/resource-scope branch. A system descriptor selects the
 * Broker-owned system/workspace branch and contributes only the exact
 * manifest grant that must already be projected on the current invocation.
 */
export function requireActiveWorkspaceResourceGrantCaller(
  currentInvocation: HostResourceGrantInvocationProvider,
  direction: 'upload-source' | 'download-destination',
  systemAuthorization?: DomainSystemWorkspaceTransferAuthorization
): HostWorkspaceResourceGrantCaller {
  if (!systemAuthorization) {
    return requireActiveAgentWorkspaceResourceGrantCaller(currentInvocation, direction)
  }

  const authorization = domainSystemWorkspaceTransferAuthorizationSchema.parse(
    systemAuthorization
  )
  const lease = requireActiveHostResourceGrantInvocationLease(currentInvocation)
  const invocation = lease.invocation
  const workspaceId = invocation.caller.workspaceId
  const invocationId = invocation.invocationId
  const directionAuthorized = direction === 'upload-source'
    ? invocation.effect === 'external-write'
    : invocation.effect === 'workspace-write'
  if (
    invocation.caller.audience !== 'system' ||
    !isCanonicalBoundedIdentifier(workspaceId, 1_024) ||
    !isCanonicalBoundedIdentifier(invocationId, 256) ||
    !isCanonicalCapabilityId(invocation.actionId) ||
    invocation.approval !== 'none' || invocation.approved !== true ||
    invocation.scope !== 'workspace' || !directionAuthorized ||
    invocation.autonomousWrite !== undefined || invocation.authorizedResource !== undefined ||
    !isCanonicalDigest(invocation.caller.principalSnapshotDigest) ||
    !isCanonicalDigest(invocation.caller.executionContextDigest) ||
    !invocation.caller.capabilityGrants?.includes(
      authorization.requiredSystemCapabilityGrant
    )
  ) {
    throw new Error(
      'A Broker-authorized system Workspace transfer with the required Host grant is required.'
    )
  }
  return Object.freeze({
    ...lease,
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

function hostResourceGrantInvocationSnapshot(
  invocation: HostResourceGrantInvocation
): HostResourceGrantInvocationSnapshot {
  const caller = defineHostResourceGrantCaller({
    callerId: invocation.caller.callerId,
    principal: invocation.caller.principal!
  })
  const authorizedResource = invocation.authorizedResource
    ? Object.freeze({
        resourceRef: invocation.authorizedResource.resourceRef,
        resourceKind: invocation.authorizedResource.resourceKind,
        ...(invocation.authorizedResource.workspaceId
          ? { workspaceId: invocation.authorizedResource.workspaceId }
          : {}),
        semanticRevision: invocation.authorizedResource.semanticRevision
      })
    : undefined
  const capabilityGrants = invocation.caller.capabilityGrants
    ? Object.freeze([...invocation.caller.capabilityGrants])
    : undefined
  return Object.freeze({
    caller,
    ...(invocation.caller.audience ? { audience: invocation.caller.audience } : {}),
    ...(invocation.caller.workspaceId ? { workspaceId: invocation.caller.workspaceId } : {}),
    ...(capabilityGrants ? { capabilityGrants } : {}),
    ...(invocation.caller.principalSnapshotDigest
      ? { principalSnapshotDigest: invocation.caller.principalSnapshotDigest }
      : {}),
    ...(invocation.caller.executionContextDigest
      ? { executionContextDigest: invocation.caller.executionContextDigest }
      : {}),
    ...(invocation.actionId ? { actionId: invocation.actionId } : {}),
    ...(invocation.invocationId ? { invocationId: invocation.invocationId } : {}),
    ...(invocation.effect ? { effect: invocation.effect } : {}),
    ...(invocation.approval ? { approval: invocation.approval } : {}),
    ...(invocation.approved !== undefined ? { approved: invocation.approved } : {}),
    ...(invocation.scope ? { scope: invocation.scope } : {}),
    ...(invocation.autonomousWrite
      ? { autonomousWrite: invocation.autonomousWrite }
      : {}),
    ...(authorizedResource ? { authorizedResource } : {})
  })
}

function sameHostResourceGrantInvocationSnapshot(
  left: HostResourceGrantInvocationSnapshot,
  right: HostResourceGrantInvocationSnapshot
): boolean {
  return left.caller.callerId === right.caller.callerId &&
    samePrincipalSnapshot(left.caller.principal, right.caller.principal) &&
    left.audience === right.audience &&
    left.workspaceId === right.workspaceId &&
    sameOptionalStringArray(left.capabilityGrants, right.capabilityGrants) &&
    left.principalSnapshotDigest === right.principalSnapshotDigest &&
    left.executionContextDigest === right.executionContextDigest &&
    left.actionId === right.actionId &&
    left.invocationId === right.invocationId &&
    left.effect === right.effect &&
    left.approval === right.approval &&
    left.approved === right.approved &&
    left.scope === right.scope &&
    left.autonomousWrite === right.autonomousWrite &&
    sameAuthorizedResource(left.authorizedResource, right.authorizedResource)
}

function sameOptionalStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isCanonicalBoundedIdentifier(
  value: string | undefined,
  maximumLength: number
): value is string {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= maximumLength && value === value.trim()
}

function isCanonicalCapabilityId(value: string | undefined): value is string {
  const result = capabilityIdSchema.safeParse(value)
  return result.success && result.data === value
}

function isCanonicalDigest(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function sameAuthorizedResource(
  left: HostResourceGrantInvocationSnapshot['authorizedResource'],
  right: HostResourceGrantInvocationSnapshot['authorizedResource']
): boolean {
  if (!left || !right) return left === right
  return left.resourceRef === right.resourceRef &&
    left.resourceKind === right.resourceKind &&
    left.workspaceId === right.workspaceId &&
    left.semanticRevision === right.semanticRevision
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}
