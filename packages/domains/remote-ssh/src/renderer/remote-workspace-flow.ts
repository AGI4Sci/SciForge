import {
  workspaceNetworkEgressAllowlistSchema,
  type WorkspaceHostOpenRemoteSessionInput,
  type WorkspaceNetworkEgressAllowlist,
  type WorkspaceNetworkEgressSelection
} from '@sciforge/domain-sdk/workspace-host'
import {
  remoteSshWorkspaceRootSchema,
  type RemoteSshTargetHandle
} from '../contract.js'
import type {
  RemoteSshCapabilityClient,
  RemoteSshMutationConfirmation
} from './remote-ssh-capability-client.js'

export type RemoteSshWorkspaceEgressRequest =
  | Readonly<{ mode: 'none' }>
  | Readonly<{
      mode: 'local'
      allowlist: WorkspaceNetworkEgressAllowlist
    }>
  | Readonly<{
      mode: 'remote-target'
      targetId: string
      resource: RemoteSshTargetHandle
      allowlist: WorkspaceNetworkEgressAllowlist
    }>

export type OpenRemoteSshWorkspaceInput = Readonly<{
  capabilityClient: Pick<
    RemoteSshCapabilityClient,
    'openEgressSession' | 'openWorkspaceHostSession'
  >
  workspaceId: string
  workspaceTargetId: string
  workspaceTargetResource: RemoteSshTargetHandle
  workspaceRoot: string
  egress: RemoteSshWorkspaceEgressRequest
  confirmation: RemoteSshMutationConfirmation
  openRemoteSession: (input: WorkspaceHostOpenRemoteSessionInput) => Promise<void>
}>

export type OpenRemoteSshWorkspaceResult = Readonly<{
  targetId: string
  workspaceRoot: string
  egressMode: WorkspaceNetworkEgressSelection['mode']
}>

export function normalizedRemoteWorkspaceRoot(value: string): string | null {
  const parsed = remoteSshWorkspaceRootSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Parses one exact lowercase `host:port[,port]` rule per non-empty line.
 * Wildcards, schemes, paths, uppercase hosts, duplicate hosts/ports, and
 * out-of-range ports are rejected by the canonical SDK schema.
 */
export function parseRemoteWorkspaceEgressAllowlist(
  value: string
): WorkspaceNetworkEgressAllowlist | null {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  const rules: Array<{ host: string; ports: number[] }> = []
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator < 1 || line.indexOf(':', separator + 1) !== -1) return null
    const host = line.slice(0, separator).trim()
    const rawPorts = line.slice(separator + 1).split(',').map((port) => port.trim())
    if (
      rawPorts.length === 0 ||
      rawPorts.some((port) => !/^[1-9]\d{0,4}$/u.test(port))
    ) {
      return null
    }
    rules.push({ host, ports: rawPorts.map(Number) })
  }
  const parsed = workspaceNetworkEgressAllowlistSchema.safeParse({ rules })
  return parsed.success ? parsed.data : null
}

/**
 * Authorizes the package-owned SSH sessions and immediately hands their opaque
 * identities to the generic Workspace Host. No authorization identity is
 * returned to callers or retained in renderer state.
 */
export async function openRemoteSshWorkspace(
  input: OpenRemoteSshWorkspaceInput
): Promise<OpenRemoteSshWorkspaceResult> {
  const workspaceRoot = remoteSshWorkspaceRootSchema.parse(input.workspaceRoot)
  let egress: WorkspaceNetworkEgressSelection
  if (input.egress.mode === 'remote-target') {
    if (input.egress.targetId === input.workspaceTargetId) {
      throw new Error('Remote network egress must use another authorized target.')
    }
    const authorizedEgress = await input.capabilityClient.openEgressSession(
      input.egress.resource,
      input.workspaceId,
      input.confirmation
    )
    egress = {
      mode: 'remote-target',
      authorizedSessionId: authorizedEgress.authorizedSessionId,
      allowlist: input.egress.allowlist
    }
  } else {
    egress = input.egress.mode === 'local'
      ? { mode: 'local', allowlist: input.egress.allowlist }
      : { mode: 'none' }
  }

  const authorizedWorkspace = await input.capabilityClient.openWorkspaceHostSession(
    input.workspaceTargetResource,
    { workspaceRoot, egress },
    input.workspaceId,
    input.confirmation
  )
  await input.openRemoteSession({
    providerId: authorizedWorkspace.providerId,
    authorizedSessionId: authorizedWorkspace.authorizedSessionId
  })

  return Object.freeze({
    targetId: input.workspaceTargetId,
    workspaceRoot,
    egressMode: input.egress.mode
  })
}
