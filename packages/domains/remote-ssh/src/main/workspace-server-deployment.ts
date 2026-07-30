import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  workspaceHostArtifactManifestSchema as remoteWorkspaceServerArtifactManifestSchema,
  type WorkspaceHostArtifact as RemoteWorkspaceServerArtifact,
  type WorkspaceHostArtifactManifest as RemoteWorkspaceServerArtifactManifest
} from '@sciforge/domain-sdk/workspace-host'

const WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME = 'manifest.json'
const INSTALLED_PROBE_MARKER = 'SCIFORGE_WORKSPACE_HOST_INSTALLED'

export {
  remoteWorkspaceServerArtifactManifestSchema,
  type RemoteWorkspaceServerArtifact,
  type RemoteWorkspaceServerArtifactManifest
}

export type RemoteWorkspaceServerPlatform = Readonly<{
  platform: 'linux'
  arch: 'x64'
}>

export type RemoteWorkspaceServerDeploymentPlan = Readonly<{
  installKey: string
  installDirectory: string
  entrypointPath: string
  manifestPath: string
  stagingDirectory: string
}>

export type RemoteWorkspaceServerDeploymentTransport = Readonly<{
  runCommand(
    script: string,
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>
  ): Promise<Readonly<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>>
  uploadFile(
    localPath: string,
    remotePath: string,
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>
  ): Promise<Readonly<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>>
}>

export type RemoteWorkspaceSshFailureCode =
  | 'workspace_server_artifact_invalid'
  | 'workspace_server_platform_unsupported'
  | 'workspace_server_deployment_failed'
  | 'workspace_server_incompatible'
  | 'workspace_server_attach_failed'
  | 'workspace_server_connection_lost'
  | 'workspace_server_replay_gap'
  | 'workspace_server_session_unauthorized'
  | 'workspace_server_cancelled'

export class RemoteWorkspaceSshError extends Error {
  readonly code: RemoteWorkspaceSshFailureCode
  readonly retryable: boolean

  constructor(
    code: RemoteWorkspaceSshFailureCode,
    message: string,
    options: Readonly<{ retryable?: boolean; cause?: unknown }> = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RemoteWorkspaceSshError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

export async function verifyRemoteWorkspaceServerArtifact(
  artifact: RemoteWorkspaceServerArtifact
): Promise<RemoteWorkspaceServerArtifactManifest> {
  const manifest = parseRemoteWorkspaceServerArtifactManifest(artifact.manifest)
  const paths = new Set<string>()
  for (const file of manifest.files) {
    if (paths.has(file.path)) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_artifact_invalid',
        `Workspace server artifact repeats file ${file.path}.`
      )
    }
    paths.add(file.path)
    const absolutePath = artifactFilePath(artifact.directory, file.path)
    const info = await stat(absolutePath).catch((cause) => {
      throw new RemoteWorkspaceSshError(
        'workspace_server_artifact_invalid',
        `Workspace server artifact file is unavailable: ${file.path}.`,
        { cause }
      )
    })
    if (!info.isFile() || info.size !== file.sizeBytes) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_artifact_invalid',
        `Workspace server artifact size does not match its manifest: ${file.path}.`
      )
    }
    const actual = await sha256File(absolutePath)
    if (actual !== file.sha256) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_artifact_invalid',
        `Workspace server artifact digest does not match its manifest: ${file.path}.`
      )
    }
  }
  if (!paths.has(manifest.entrypoint)) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server artifact does not contain its declared entrypoint.'
    )
  }
  return manifest
}

export function parseRemoteWorkspaceServerPlatform(output: string): RemoteWorkspaceServerPlatform {
  const [kernel, machine, ...extra] = output.trim().split(/\s+/)
  if (extra.length > 0 || kernel !== 'Linux' || !['x86_64', 'amd64'].includes(machine ?? '')) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_platform_unsupported',
      'Remote Workspace currently requires a Linux x64 target.'
    )
  }
  return { platform: 'linux', arch: 'x64' }
}

export function createRemoteWorkspaceServerDeploymentPlan(
  manifest: RemoteWorkspaceServerArtifactManifest,
  nonce = randomUUID().replaceAll('-', '')
): RemoteWorkspaceServerDeploymentPlan {
  const parsed = parseRemoteWorkspaceServerArtifactManifest(manifest)
  const cohortDigest = createHash('sha256')
    .update(JSON.stringify(parsed))
    .digest('hex')
    .slice(0, 16)
  const installKey = `${parsed.serverVersion}-${parsed.protocolVersion}-${cohortDigest}`
  const installDirectory = `.sciforge/server/${installKey}`
  return {
    installKey,
    installDirectory,
    entrypointPath: `${installDirectory}/${parsed.entrypoint}`,
    manifestPath: `${installDirectory}/manifest.json`,
    stagingDirectory: `.sciforge/server/.staging/${installKey}-${safeNonce(nonce)}`
  }
}

export async function ensureRemoteWorkspaceServerDeployed(input: Readonly<{
  artifact: RemoteWorkspaceServerArtifact
  transport: RemoteWorkspaceServerDeploymentTransport
  signal?: AbortSignal
}>): Promise<RemoteWorkspaceServerDeploymentPlan> {
  throwIfAborted(input.signal)
  const manifest = await verifyRemoteWorkspaceServerArtifact(input.artifact)
  const probe = await input.transport.runCommand('uname -s\nuname -m\n', {
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: 15_000
  })
  requireSuccessfulPhase(probe, 'probe the remote platform')
  parseRemoteWorkspaceServerPlatform(probe.stdout)

  const plan = createRemoteWorkspaceServerDeploymentPlan(manifest)
  const manifestDigest = await sha256File(
    resolve(input.artifact.directory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME)
  )
  const installed = await input.transport.runCommand(
    deploymentInstalledProbeScript(plan, manifest, manifestDigest),
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 60_000 }
  )
  if (installed.timedOut || installed.exitCode === null) {
    requireSuccessfulPhase(installed, 'verify the installed workspace server')
  }
  if (
    installed.exitCode === 0 &&
    installed.stdout.trim() === INSTALLED_PROBE_MARKER
  ) {
    return plan
  }

  const prepare = await input.transport.runCommand(
    deploymentPrepareScript(plan, manifest),
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 30_000 }
  )
  requireSuccessfulPhase(prepare, 'prepare the private server directory')

  for (const file of manifest.files) {
    throwIfAborted(input.signal)
    const result = await input.transport.uploadFile(
      artifactFilePath(input.artifact.directory, file.path),
      `${plan.stagingDirectory}/${file.path}`,
      {
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: deploymentUploadTimeoutMilliseconds(file.sizeBytes)
      }
    )
    requireSuccessfulPhase(result, `upload ${file.path}`)
  }
  const manifestUpload = await input.transport.uploadFile(
    resolve(input.artifact.directory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME),
    `${plan.stagingDirectory}/manifest.json`,
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 30_000 }
  )
  requireSuccessfulPhase(manifestUpload, 'upload the server manifest')

  const install = await input.transport.runCommand(
    deploymentInstallScript(plan, manifest, manifestDigest),
    { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 60_000 }
  )
  requireSuccessfulPhase(install, 'verify and install the workspace server')

  for (const probe of manifest.readinessProbes) {
    throwIfAborted(input.signal)
    const readiness = await input.transport.runCommand(
      deploymentReadinessScript(plan, probe),
      { ...(input.signal ? { signal: input.signal } : {}), timeoutMs: 30_000 }
    )
    requireSuccessfulReadinessProbe(readiness, probe.id, probe.expectedStdout)
  }
  return plan
}

export function deploymentUploadTimeoutMilliseconds(sizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server artifact upload size is invalid.'
    )
  }
  const transferAt128KiBPerSecond = Math.ceil(sizeBytes / (128 * 1_024)) * 1_000
  return Math.min(
    2 * 60 * 60_000,
    Math.max(5 * 60_000, transferAt128KiBPerSecond + 60_000)
  )
}

function deploymentPrepareScript(
  plan: RemoteWorkspaceServerDeploymentPlan,
  manifest: RemoteWorkspaceServerArtifactManifest
): string {
  const stage = shellHomePath(plan.stagingDirectory)
  const nestedDirectories = [...new Set(manifest.files.flatMap((file) => {
    const segments = file.path.split('/')
    return segments.slice(0, -1).map((_segment, index) =>
      segments.slice(0, index + 1).join('/')
    )
  }))].sort()
  return [
    'set -eu',
    'umask 077',
    `mkdir -p "$HOME/.sciforge/server/.staging"`,
    `rm -rf ${stage}`,
    `mkdir -p ${stage}`,
    ...nestedDirectories.map((directory) =>
      `mkdir -p ${shellHomePath(`${plan.stagingDirectory}/${directory}`)}`
    )
  ].join('\n') + '\n'
}

function deploymentInstallScript(
  plan: RemoteWorkspaceServerDeploymentPlan,
  manifest: RemoteWorkspaceServerArtifactManifest,
  manifestDigest: string
): string {
  const stage = shellHomePath(plan.stagingDirectory)
  const install = shellHomePath(plan.installDirectory)
  const replaced = shellHomePath(`${plan.installDirectory}.replaced`)
  const stagedVerifications = [
    ...manifest.files.flatMap((file) => {
      const path = shellHomePath(`${plan.stagingDirectory}/${file.path}`)
      return [
        `test -f ${path}`,
        `test "$(wc -c < ${path} | tr -d '[:space:]')" = '${file.sizeBytes}'`,
        `test "$(sha256sum ${path} | awk '{print $1}')" = '${file.sha256}'`
      ]
    }),
    `test "$(sha256sum ${shellHomePath(`${plan.stagingDirectory}/manifest.json`)} | ` +
      `awk '{print $1}')" = '${manifestDigest}'`
  ]
  return [
    'set -eu',
    'umask 077',
    ...stagedVerifications,
    ...manifest.files.map((file) =>
      `chmod ${file.executable ? '700' : '600'} ` +
      shellHomePath(`${plan.stagingDirectory}/${file.path}`)
    ),
    `chmod 600 ${shellHomePath(`${plan.stagingDirectory}/manifest.json`)}`,
    `if ${installedArtifactVerificationCommands(plan, manifest, manifestDigest).join(' && ')}; then`,
    `  rm -rf ${stage}`,
    'else',
    `  mkdir -p "$HOME/.sciforge/server"`,
    `  rm -rf ${replaced}`,
    `  if test -e ${install}; then mv ${install} ${replaced}; fi`,
    `  if mv ${stage} ${install}; then`,
    `    rm -rf ${replaced}`,
    '  else',
    `    if test -e ${replaced}; then mv ${replaced} ${install}; fi`,
    '    exit 1',
    '  fi',
    'fi',
    ...installedArtifactVerificationCommands(plan, manifest, manifestDigest)
  ].join('\n') + '\n'
}

function deploymentInstalledProbeScript(
  plan: RemoteWorkspaceServerDeploymentPlan,
  manifest: RemoteWorkspaceServerArtifactManifest,
  manifestDigest: string
): string {
  return [
    'set -eu',
    ...installedArtifactVerificationCommands(plan, manifest, manifestDigest),
    `printf '%s\\n' '${INSTALLED_PROBE_MARKER}'`
  ].join('\n') + '\n'
}

function installedArtifactVerificationCommands(
  plan: RemoteWorkspaceServerDeploymentPlan,
  manifest: RemoteWorkspaceServerArtifactManifest,
  manifestDigest: string
): string[] {
  return [
    `test -f ${shellHomePath(plan.manifestPath)}`,
    `test "$(sha256sum ${shellHomePath(plan.manifestPath)} | awk '{print $1}')" = '${manifestDigest}'`,
    ...manifest.files.flatMap((file) => {
      const path = shellHomePath(`${plan.installDirectory}/${file.path}`)
      return [
        `test -f ${path}`,
        `test "$(wc -c < ${path} | tr -d '[:space:]')" = '${file.sizeBytes}'`,
        `test "$(sha256sum ${path} | awk '{print $1}')" = '${file.sha256}'`,
        file.executable ? `test -x ${path}` : `test ! -x ${path}`
      ]
    }),
    ...manifest.readinessProbes.map((probe) => {
      const executable = shellHomePath(
        `${plan.installDirectory}/${probe.executablePath}`
      )
      const args = probe.arguments.map(shellLiteral).map((argument) =>
        ` ${argument}`
      ).join('')
      return `test "$(${executable}${args})" = ${shellValue(probe.expectedStdout.trim())}`
    })
  ]
}

function deploymentReadinessScript(
  plan: RemoteWorkspaceServerDeploymentPlan,
  probe: RemoteWorkspaceServerArtifactManifest['readinessProbes'][number]
): string {
  const executable = shellHomePath(
    `${plan.installDirectory}/${probe.executablePath}`
  )
  return [
    'set -eu',
    `test -x ${executable}`,
    `exec ${executable}${probe.arguments.map(shellLiteral).map((argument) =>
      ` ${argument}`
    ).join('')}`
  ].join('\n') + '\n'
}

function parseRemoteWorkspaceServerArtifactManifest(
  value: unknown
): RemoteWorkspaceServerArtifactManifest {
  try {
    return remoteWorkspaceServerArtifactManifestSchema.parse(value)
  } catch (cause) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server artifact manifest is invalid.',
      { cause }
    )
  }
}

function artifactFilePath(directory: string, relativePath: string): string {
  assertSafeRelativePath(relativePath)
  return resolve(directory, relativePath)
}

function shellHomePath(relativePath: string): string {
  assertSafeRelativePath(relativePath)
  return `"$HOME/${relativePath}"`
}

function shellLiteral(value: string): string {
  if (!/^--?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server readiness probe argument is invalid.'
    )
  }
  return `'${value}'`
}

function shellValue(value: string): string {
  if (value.includes('\0')) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server readiness probe output is invalid.'
    )
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function safeNonce(value: string): string {
  if (!/^[A-Za-z0-9]{8,128}$/.test(value)) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server deployment nonce is invalid.'
    )
  }
  return value
}

function assertSafeRelativePath(path: string): void {
  if (
    !path ||
    path.length > 4_096 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    !/^[A-Za-z0-9.][A-Za-z0-9._/-]*$/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_artifact_invalid',
      'Workspace server artifact contains an unsafe path.'
    )
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

function requireSuccessfulPhase(
  result: Readonly<{ exitCode: number | null; stderr: string; timedOut: boolean }>,
  phase: string
): void {
  if (result.exitCode === 0 && !result.timedOut) return
  throw new RemoteWorkspaceSshError(
    'workspace_server_deployment_failed',
    `Failed to ${phase}.`,
    { retryable: true }
  )
}

function requireSuccessfulReadinessProbe(
  result: Readonly<{
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
  }>,
  probeId: string,
  expectedStdout: string
): void {
  if (result.timedOut || result.exitCode === null) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_deployment_failed',
      `Workspace server runtime readiness probe did not complete: ${probeId}.`,
      { retryable: true }
    )
  }
  if (
    result.exitCode !== 0
    || result.stdout.trim() !== expectedStdout.trim()
  ) {
    throw new RemoteWorkspaceSshError(
      'workspace_server_incompatible',
      `Workspace server runtime is unavailable or incompatible: ${probeId}.`
    )
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new RemoteWorkspaceSshError(
    'workspace_server_cancelled',
    'Remote Workspace connection was cancelled.'
  )
}
