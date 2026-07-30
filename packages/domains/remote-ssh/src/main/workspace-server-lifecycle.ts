import { posix } from 'node:path'
import { z } from 'zod'
import type { WorkspaceHostLifecycleMode } from '@sciforge/domain-sdk/workspace-host'
import {
  RemoteWorkspaceSshError,
  type RemoteWorkspaceServerDeploymentPlan,
  type RemoteWorkspaceServerDeploymentTransport
} from './workspace-server-deployment.js'

const daemonProbeSchema = z.discriminatedUnion('supported', [
  z.object({ supported: z.literal(true) }).strict(),
  z.object({
    supported: z.literal(false),
    reason: z.string().trim().min(1).max(1_024)
  }).strict()
])

const daemonStartSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  socketPath: z.string().trim().min(1).max(4_096),
  lifecycle: z.literal('persistent-daemon'),
  reused: z.boolean()
}).strict()

export type RemoteWorkspaceServerLifecyclePlan = Readonly<{
  mode: WorkspaceHostLifecycleMode
  runtimeDirectory?: string
  fallbackReason?: string
}>

export async function prepareRemoteWorkspaceServerLifecycle(input: Readonly<{
  transport: RemoteWorkspaceServerDeploymentTransport
  plan: RemoteWorkspaceServerDeploymentPlan
  workspaceRoot: string
  signal?: AbortSignal
}>): Promise<RemoteWorkspaceServerLifecyclePlan> {
  const home = await resolveRemoteHome(input.transport, input.signal)
  const runtimeDirectory = posix.join(home, '.sciforge', 'runtime')
  const runtimeDirectoryBase64 = encodeBase64Url(runtimeDirectory)
  const probe = await input.transport.runCommand(
    remoteEntrypointScript(input.plan, [
      'probe-daemon',
      '--runtime-dir-base64',
      runtimeDirectoryBase64
    ]),
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 15_000 }
  )
  requireSuccessfulLifecycleCommand(probe, 'probe the Workspace Host daemon')
  const probeResult = parseDaemonOutput(daemonProbeSchema, probe.stdout, 'daemon probe')
  if (!probeResult.supported) {
    return {
      mode: 'connection-session',
      fallbackReason: probeResult.reason
    }
  }

  const start = await input.transport.runCommand(
    remoteEntrypointScript(input.plan, [
      'start-daemon',
      '--workspace-root-base64',
      encodeBase64Url(input.workspaceRoot),
      '--runtime-dir-base64',
      runtimeDirectoryBase64
    ]),
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 30_000 }
  )
  requireSuccessfulLifecycleCommand(start, 'start the Workspace Host daemon')
  const started = parseDaemonOutput(daemonStartSchema, start.stdout, 'daemon start')
  if (
    !posix.isAbsolute(started.socketPath) ||
    !started.socketPath.startsWith(`${runtimeDirectory}/`)
  ) {
    throw incompatibleLifecycleOutput('Workspace Host daemon start')
  }
  return {
    mode: started.lifecycle,
    runtimeDirectory
  }
}

function resolveRemoteHome(
  transport: RemoteWorkspaceServerDeploymentTransport,
  signal?: AbortSignal
): Promise<string> {
  return transport.runCommand(
    'set -eu\nprintf \'%s\\n\' "$HOME"\n',
    { ...(signal ? { signal } : {}), timeoutMs: 15_000 }
  ).then((result) => {
    requireSuccessfulLifecycleCommand(result, 'resolve the remote home directory')
    const home = result.stdout.trim()
    if (
      !posix.isAbsolute(home) ||
      home.includes('\0') ||
      home.includes('\n') ||
      home.length > 4_096
    ) {
      throw incompatibleLifecycleOutput('Remote home directory')
    }
    return home
  })
}

function remoteEntrypointScript(
  plan: RemoteWorkspaceServerDeploymentPlan,
  argv: readonly string[]
): string {
  assertSafeRelativePath(plan.entrypointPath)
  return [
    'set -eu',
    `exec "$HOME/${plan.entrypointPath}" ${argv.map(shellArgument).join(' ')}`
  ].join('\n') + '\n'
}

function shellArgument(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace Host lifecycle argument is invalid.'
    )
  }
  return `'${value}'`
}

function assertSafeRelativePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    !/^[A-Za-z0-9.][A-Za-z0-9._/-]*$/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace Host lifecycle entrypoint is invalid.'
    )
  }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function parseDaemonOutput<Output>(
  schema: z.ZodType<Output>,
  stdout: string,
  phase: string
): Output {
  try {
    return schema.parse(JSON.parse(stdout.trim()))
  } catch (cause) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_incompatible',
      `Workspace Host ${phase} output is invalid.`,
      { cause }
    )
  }
}

function requireSuccessfulLifecycleCommand(
  result: Readonly<{ exitCode: number | null; timedOut: boolean }>,
  phase: string
): void {
  if (result.exitCode === 0 && !result.timedOut) return
  throw new RemoteWorkspaceSshError(
    'workspace_server_attach_failed',
    `Failed to ${phase}.`,
    { retryable: true }
  )
}

function incompatibleLifecycleOutput(phase: string): RemoteWorkspaceSshError {
  return new RemoteWorkspaceSshError(
    'workspace_server_incompatible',
    `${phase} output is invalid.`
  )
}
