import { homedir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'
import {
  createDiscoveredDshDeployment,
  createPinnedDshDeployment,
  DSH_RELEASE_PINS,
  DshRuntimeError,
  type DshDeploymentTarget
} from '@sciforge/dsh-runtime'
import type { AppSettingsV1 } from '../../../shared/app-settings'
import { getDshRuntimeSettings, isDshCommandExecutionEnabled } from '../../../shared/app-settings-dsh'
import {
  executableFileExists,
  expandHomeFrom,
  findExecutableCommand,
  macOSCommandSearchDirectories,
  pathExists,
  readLoginShellPath,
  splitCommandSearchPath,
  unixCommandSearchDirectories,
  windowsCommandSearchDirectories
} from '../command-discovery'

const DSH_PACKAGED_VERSION = '0.2.0-rc.2'

export type DshExecutableDiscoveryOptions = {
  resourcesDirectory: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  arch?: string
  isExecutable?: (path: string) => Promise<boolean>
  fileExists?: (path: string) => Promise<boolean>
  getLoginShellPath?: (env: NodeJS.ProcessEnv, homeDir: string) => Promise<string>
}

/** Reviewed DSH discovery policy. Resolution order: explicit user-configured
 * path, inherited PATH, login-shell PATH (macOS), per-platform common install
 * locations, then the packaged pinned artifact as the only bundled fallback.
 * User-installed executables carry no byte pin; their approval boundary is a
 * parseable --version, the composed-config safety invariants and the ACP
 * identity handshake enforced by @sciforge/dsh-runtime. */
export function createDshDeploymentTargetResolver(
  options: DshExecutableDiscoveryOptions
): (input?: { command?: string; settings?: unknown; refresh?: boolean }) => Promise<DshDeploymentTarget> {
  const verifiers = new Map<boolean, ReturnType<typeof createDiscoveredDshDeployment>>()
  /** The approved composition mode is part of the target: a discovered install is
   * verified against the closure its own switch state requested. */
  const discoveredVerifier = (commandExecution: boolean) => {
    const existing = verifiers.get(commandExecution)
    if (existing) return existing
    const created = createDiscoveredDshDeployment(commandExecution)
    verifiers.set(commandExecution, created)
    return created
  }
  // Discovered installs keep their own default ACP route and get a patch
  // derived from their own entry list: the release-audited provider/model and
  // static entry ids may not exist in the user's installed version.
  const discoveredTarget = (executable: string, source: DshDeploymentTarget['source'], commandExecution: boolean): DshDeploymentTarget => ({
    executable, source, defaultAcpRoute: null, safetyPatch: 'derived', commandExecution,
    verifyDeployment: discoveredVerifier(commandExecution).verifyDeployment
  })
  // Discovery touches the filesystem and may fork a login shell to read its
  // PATH, while a session resolves a target for every (re)connect. Cache the
  // successful resolutions of this process, keyed by the command they resolved:
  // editing the command in settings changes the key, an explicit probe passes
  // `refresh` to re-read the disk, and a failed lookup is never cached so a
  // later install is found without any invalidation.
  const resolved = new Map<string, Promise<DshDeploymentTarget>>()
  const resolve = async (raw: string, commandExecution: boolean): Promise<DshDeploymentTarget> => {
    const platform = options.platform ?? process.platform
    const arch = options.arch ?? process.arch
    const env = options.env ?? process.env
    const homeDir = options.homeDir ?? homedir()
    const isExecutable = options.isExecutable ?? ((path: string) => executableFileExists(path, platform))
    const fileExists = options.fileExists ?? (options.isExecutable ? isExecutable : pathExists)

    const expanded = expandHomeFrom(raw, homeDir, platform)
    const pathIsAbsolute = platform === 'win32' ? win32.isAbsolute(expanded) : isAbsolute(expanded)
    if (pathIsAbsolute || expanded.includes('/') || expanded.includes('\\')) {
      if (!pathIsAbsolute) throw new DshRuntimeError('runtime_path_invalid')
      if (!(await fileExists(expanded))) throw new DshRuntimeError('runtime_path_invalid')
      if (!(await isExecutable(expanded))) throw new DshRuntimeError('runtime_not_executable')
      return discoveredTarget(expanded, 'user-configured', commandExecution)
    }

    const inheritedPathMatch = await findExecutableCommand(
      raw,
      splitCommandSearchPath(env.PATH ?? env.Path ?? env.path ?? '', platform),
      platform,
      isExecutable
    )
    if (inheritedPathMatch) {
      return discoveredTarget(inheritedPathMatch, 'process-path', commandExecution)
    }

    if (platform === 'darwin') {
      const getLoginShellPath = options.getLoginShellPath ?? readLoginShellPath
      const loginShellPath = await getLoginShellPath(env, homeDir).catch(() => '')
      const loginShellMatch = await findExecutableCommand(
        raw,
        splitCommandSearchPath(loginShellPath, platform),
        platform,
        isExecutable
      )
      if (loginShellMatch) {
        return discoveredTarget(loginShellMatch, 'login-shell-path', commandExecution)
      }
      const fallbackMatch = await findExecutableCommand(
        raw,
        await macOSCommandSearchDirectories(homeDir, env),
        platform,
        isExecutable
      )
      if (fallbackMatch) {
        return discoveredTarget(fallbackMatch, 'common-install-location', commandExecution)
      }
    } else if (platform === 'win32') {
      const windowsPathMatch = await findExecutableCommand(
        raw,
        windowsCommandSearchDirectories(env, homeDir),
        platform,
        isExecutable
      )
      if (windowsPathMatch) {
        return discoveredTarget(windowsPathMatch, 'common-install-location', commandExecution)
      }
    } else {
      const unixPathMatch = await findExecutableCommand(
        raw,
        unixCommandSearchDirectories(homeDir),
        platform,
        isExecutable
      )
      if (unixPathMatch) {
        return discoveredTarget(unixPathMatch, 'common-install-location', commandExecution)
      }
    }

    const artifactDirectory = join(
      options.resourcesDirectory, 'agent-runtimes', 'dsh', DSH_PACKAGED_VERSION, `${platform}-${arch}`
    )
    const executable = join(artifactDirectory, platform === 'win32' ? 'dsh.exe' : 'dsh')
    if (await executableFileExists(executable, platform)) {
      const pin = DSH_RELEASE_PINS.find(release => release.platform === platform && release.arch === arch)?.pin
      return {
        executable,
        artifactRoot: artifactDirectory,
        // The packaged release is pinned twice: expectedVersion fails fast at
        // --version, then the compiled pin re-verifies version/config/bytes.
        expectedVersion: DSH_PACKAGED_VERSION,
        // The pin's configDigest is the release-audited composition, so the
        // packaged artifact keeps the audited closure: enabling the shell there
        // would produce a different composition than the release review sealed,
        // and a review that has not happened cannot be asserted at runtime.
        ...createPinnedDshDeployment({ artifactDirectory, executable, pin }),
        commandExecution: false,
        source: 'packaged-application'
      }
    }
    throw new DshRuntimeError('runtime_not_found')
  }
  return async input => {
    const raw = input?.command?.trim()
      ? input.command.trim()
      : getDshRuntimeSettings((input?.settings ?? {}) as AppSettingsV1).command
    // The approved composition mode is Host-owned and per attempt, so it is part
    // of the cache key: flipping the switch must never reuse a target that was
    // approved under the other mode.
    const commandExecution = isDshCommandExecutionEnabled(input?.settings)
    const cacheKey = `${raw}\u0000${commandExecution}`
    if (input?.refresh) resolved.delete(cacheKey)
    const pending = resolved.get(cacheKey)
    if (pending) return pending
    const attempt = resolve(raw, commandExecution).catch(error => {
      if (resolved.get(cacheKey) === attempt) resolved.delete(cacheKey)
      throw error
    })
    resolved.set(cacheKey, attempt)
    return attempt
  }
}
