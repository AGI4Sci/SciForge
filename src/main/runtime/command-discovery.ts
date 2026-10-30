import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, readdir, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, posix, win32 } from 'node:path'

export function splitCommandSearchPath(pathValue: string, platform: NodeJS.Platform): string[] {
  return pathValue
    .split(platform === 'win32' || /^[A-Za-z]:\\/.test(pathValue) ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function windowsCommandNames(command: string): string[] {
  if (/\.(?:exe|cmd|bat|com)$/i.test(command)) return [command]
  // npm and Windows app bundles can contain an extensionless Unix companion
  // that Windows cannot launch. Prefer only native executable and shim forms.
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, `${command}.com`]
}

export async function findExecutableCommand(
  command: string,
  directories: readonly string[],
  platform: NodeJS.Platform,
  isExecutable: (path: string) => Promise<boolean>
): Promise<string | null> {
  for (const directory of new Set(directories)) {
    const names = platform === 'win32'
      ? windowsCommandNames(command)
      : [command]
    for (const name of names) {
      const candidate = platform === 'win32' || /^[A-Za-z]:\\/.test(directory)
        ? win32.join(directory, name) : posix.join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return null
}

export function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false)
}

export async function executableFileExists(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    // Windows does not expose POSIX executable bits; existence is sufficient.
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function expandHomeFrom(
  raw: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (raw === '~') return homeDir
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return (platform === 'win32' ? win32.join : posix.join)(homeDir, raw.slice(2))
  }
  return raw
}

const LOGIN_SHELL_PATH_START = '\u001e'
const LOGIN_SHELL_PATH_END = '\u001f'
const PRINT_LOGIN_SHELL_PATH = `exec /bin/sh -c 'printf "\\036%s\\037" "$PATH"'`

// GUI-launched apps do not inherit a login shell's PATH. Read it through the
// account's actual Unix shell, falling back to the standard system shells.
export async function readLoginShellPath(env: NodeJS.ProcessEnv, homeDir: string): Promise<string> {
  const shellCandidates = new Set<string>()
  if (env.SHELL?.trim()) shellCandidates.add(expandHomeFrom(env.SHELL.trim(), homeDir))
  try {
    const accountShell = userInfo().shell
    if (accountShell?.trim()) shellCandidates.add(accountShell.trim())
  } catch {
    // Fall through to standard macOS shells when account metadata is unavailable.
  }
  shellCandidates.add('/bin/zsh')
  shellCandidates.add('/bin/bash')
  shellCandidates.add('/bin/sh')

  const shellEnv: NodeJS.ProcessEnv = {
    ...env,
    HOME: env.HOME || homeDir
  }
  for (const shell of shellCandidates) {
    const shellPath = await readLoginShellPathFrom(shell, shellEnv)
    if (shellPath) return shellPath
  }
  return ''
}

function readLoginShellPathFrom(shell: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', PRINT_LOGIN_SHELL_PATH],
      {
        encoding: 'utf8',
        env,
        maxBuffer: 1024 * 1024,
        timeout: 4_000
      },
      (error, stdout) => {
        if (error) {
          resolve('')
          return
        }
        const start = stdout.lastIndexOf(LOGIN_SHELL_PATH_START)
        const end = start < 0 ? -1 : stdout.indexOf(LOGIN_SHELL_PATH_END, start + 1)
        resolve(start >= 0 && end > start ? stdout.slice(start + 1, end).trim() : '')
      }
    )
  })
}

export async function macOSCommandSearchDirectories(
  homeDir: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const expandEnvDir = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim()
    return trimmed ? expandHomeFrom(trimmed, homeDir) : undefined
  }
  const nvmDir = expandEnvDir(env.NVM_DIR) ?? join(homeDir, '.nvm')
  const asdfDir = expandEnvDir(env.ASDF_DATA_DIR) ?? join(homeDir, '.asdf')
  const voltaDir = expandEnvDir(env.VOLTA_HOME) ?? join(homeDir, '.volta')
  const bunDir = expandEnvDir(env.BUN_INSTALL) ?? join(homeDir, '.bun')
  const nvmVersionBins = await versionManagerBinDirectories(join(nvmDir, 'versions', 'node'))

  return [
    expandEnvDir(env.NVM_BIN),
    expandEnvDir(env.PNPM_HOME),
    join(homeDir, '.local', 'bin'),
    join(asdfDir, 'shims'),
    join(asdfDir, 'bin'),
    join(voltaDir, 'bin'),
    join(homeDir, 'Library', 'pnpm'),
    join(homeDir, '.local', 'share', 'pnpm'),
    join(bunDir, 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    ...nvmVersionBins,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ].filter((directory): directory is string => Boolean(directory))
}

async function versionManagerBinDirectories(versionsDir: string): Promise<string[]> {
  try {
    const versions = await readdir(versionsDir, { withFileTypes: true })
    return versions
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => join(versionsDir, version, 'bin'))
  } catch {
    return []
  }
}

// GUI apps launched from Explorer do not always inherit the same PATH as an
// interactive shell. Cover the standard npm and standalone locations.
export function windowsCommandSearchDirectories(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const directories: string[] = []
  const appData = env.APPDATA
  const localAppData = env.LOCALAPPDATA
  if (appData) directories.push(join(appData, 'npm'))
  if (localAppData) {
    directories.push(join(localAppData, 'Programs'), join(localAppData, 'Microsoft', 'WinGet', 'Packages'))
  }
  directories.push(join(homeDir, '.local', 'bin'), join(homeDir, '.cargo', 'bin'))
  return directories
}

export function unixCommandSearchDirectories(homeDir: string): string[] {
  return [join(homeDir, '.local', 'bin'), '/usr/local/bin', '/usr/bin']
}
