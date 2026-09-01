import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

const TEMPORARY_DIRECTORY_PREFIX = 'sciforge-provider-credential-smoke-'
const DEFAULT_TIMEOUT_MS = 45_000
const PHASES = Object.freeze(['store', 'rotate', 'delete', 'restart-absent'])

export async function runProviderCredentialElectronSmoke({
  executablePath,
  applicationPath,
  label,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  await assertExecutable(executablePath)
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), TEMPORARY_DIRECTORY_PREFIX))
  const userDataDirectory = resolve(temporaryDirectory, 'user-data')
  const results = []
  try {
    for (const [index, phase] of PHASES.entries()) {
      results.push(await runPhase({
        executablePath,
        applicationPath,
        userDataDirectory,
        phase,
        createIdentity: index === 0,
        timeoutMs
      }))
    }
    const platforms = new Set(results.map((result) => result.platform))
    const packagedStates = new Set(results.map((result) => result.packaged))
    if (platforms.size !== 1 || packagedStates.size !== 1) {
      throw new Error('Provider credential acceptance changed runtime identity across restarts.')
    }
    return Object.freeze({
      mode: label,
      executablePath: resolve(executablePath),
      platform: results[0].platform,
      packaged: results[0].packaged,
      phases: Object.freeze(results.map((result) => result.phase)),
      verified: results.every((result) => result.verified === true)
    })
  } finally {
    await removeTemporaryDirectory(temporaryDirectory)
  }
}

export function parseProviderCredentialSmokeCli(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--repository-root', '--dist-dir', '--executable', '--timeout-ms'].includes(flag)) {
      throw new Error(`Unknown provider credential smoke option: ${flag}`)
    }
    const value = argv[index + 1]?.trim()
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    index += 1
    if (flag === '--timeout-ms') {
      const timeoutMs = Number(value)
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
        throw new Error('--timeout-ms must be an integer between 1000 and 300000.')
      }
      options.timeoutMs = timeoutMs
    } else if (flag === '--repository-root') {
      options.repositoryRoot = resolve(value)
    } else if (flag === '--dist-dir') {
      options.distDirectory = resolve(value)
    } else {
      options.executablePath = resolve(value)
    }
  }
  return options
}

async function runPhase({
  executablePath,
  applicationPath,
  userDataDirectory,
  phase,
  createIdentity,
  timeoutMs
}) {
  const { _electron: electron } = await import('playwright-core')
  let electronApp
  try {
    electronApp = await electron.launch({
      executablePath: resolve(executablePath),
      cwd: applicationPath ? resolve(applicationPath) : dirname(resolve(executablePath)),
      args: providerCredentialSmokeLaunchArgs({
        applicationPath,
        userDataDirectory
      }),
      env: {
        ...process.env,
        SCIFORGE_DEV_BROWSER_BRIDGE: '0',
        SCIFORGE_PROVIDER_CREDENTIAL_ACCEPTANCE: '1'
      },
      timeout: timeoutMs
    })
    const window = await electronApp.firstWindow({ timeout: timeoutMs })
    await window.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
    await window.waitForFunction(
      () => typeof globalThis.sciforge?.capabilities?.invoke === 'function',
      undefined,
      { timeout: timeoutMs }
    )
    if (createIdentity) {
      await window.evaluate(async () => {
        await globalThis.sciforge.capabilities.invoke({
          request: {
            actionId: 'identity.local.create-account',
            invocationId: 'provider-credential-acceptance-create-account',
            input: { username: 'provider_credential_acceptance' }
          }
        })
      })
    }
    const result = await electronApp.evaluate(async (_electron, acceptancePhase) => {
      const run = globalThis.__SCIFORGE_PROVIDER_CREDENTIAL_ACCEPTANCE__
      if (typeof run !== 'function') {
        throw new Error('The main process did not install provider credential acceptance.')
      }
      return await run(acceptancePhase)
    }, phase)
    if (result.phase !== phase || result.verified !== true) {
      throw new Error(`Provider credential acceptance ${phase} returned an invalid result.`)
    }
    return result
  } finally {
    await closeElectron(electronApp)
  }
}

export function providerCredentialSmokeLaunchArgs({
  applicationPath,
  userDataDirectory,
  platform = process.platform
}) {
  return [
    ...(applicationPath ? [resolve(applicationPath)] : []),
    `--user-data-dir=${resolve(userDataDirectory)}`,
    // Playwright otherwise appends this after process startup. Passing it to the
    // executable keeps unsigned/ad-hoc packaged acceptance runs from blocking on
    // an interactive macOS Keychain authorization prompt.
    ...(platform === 'darwin' ? ['--use-mock-keychain'] : []),
    '--hidden'
  ]
}

async function closeElectron(electronApp) {
  if (!electronApp) return
  const child = electronApp.process()
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
  ])
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

async function assertExecutable(path) {
  const resolved = resolve(path)
  await access(resolved, process.platform === 'win32'
    ? fsConstants.R_OK
    : fsConstants.R_OK | fsConstants.X_OK)
}

async function removeTemporaryDirectory(path) {
  const resolved = resolve(path)
  if (dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith(TEMPORARY_DIRECTORY_PREFIX)) {
    throw new Error(`Refusing to remove unsafe provider credential smoke directory: ${resolved}`)
  }
  await rm(resolved, { recursive: true, force: true })
}
