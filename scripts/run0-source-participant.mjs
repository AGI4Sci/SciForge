#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { access, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..')
const EXPECTED_FORK = 'SCU-areszhang/SciForge_Loop'
const EXPECTED_BRANCH = 'codex/full-collaboration-loop-recovery'
const CLOUD_ORIGIN = 'https://cloud-test.sciforge.cn'
const OIDC_ISSUER = 'https://login-test.sciforge.cn/realms/SciForge'
const PROVIDER_PACKAGE_PATH =
  'packages/domains/opencontent-connector/package.json'
const LEGACY_PRIVATE_PROVIDER_PATH =
  '.sciforge/private/deployments/opencontent-connector.json'
const REQUIRED_BUILD_PATHS = Object.freeze([
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html'
])

export function parseRun0ParticipantOptions(argv) {
  const [command, ...remaining] = argv
  if (!['check', 'launch'].includes(command)) {
    throw new Error(
      'Usage: run0-source-participant.mjs check|launch ' +
      '--expected-commit <40-hex> [--role U0..U4] ' +
      '[--profile-dir /absolute/path]'
    )
  }
  const flags = new Map()
  for (let index = 0; index < remaining.length; index += 1) {
    const flag = remaining[index]
    if (!['--expected-commit', '--profile-dir', '--role'].includes(flag) ||
      flags.has(flag)) {
      throw new Error(`Unknown or duplicate Run-0 option: ${flag}`)
    }
    const value = remaining[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    flags.set(flag, value)
    index += 1
  }
  const expectedCommit = flags.get('--expected-commit') ?? ''
  if (!/^[a-f0-9]{40}$/u.test(expectedCommit)) {
    throw new Error('--expected-commit must be the exact 40-character lowercase Git commit.')
  }
  const role = flags.get('--role')
  if (role !== undefined && !/^U[0-4]$/u.test(role)) {
    throw new Error('--role must be one of U0, U1, U2, U3, or U4.')
  }
  const profileDir = flags.get('--profile-dir')
  if (profileDir !== undefined && !isAbsolute(profileDir)) {
    throw new Error('--profile-dir must be an absolute path.')
  }
  if (command === 'launch' && (!role || !profileDir)) {
    throw new Error('launch requires both --role and --profile-dir.')
  }
  return Object.freeze({
    command,
    expectedCommit,
    ...(profileDir ? { profileDir: resolve(profileDir) } : {}),
    ...(role ? { role } : {})
  })
}

export function githubRepositorySlug(remoteUrl) {
  const value = String(remoteUrl).trim().replace(/\.git$/u, '')
  const https = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/u)
  if (https) return https[1]
  const ssh = value.match(/^git@github\.com:([^/]+\/[^/]+)$/u)
  if (ssh) return ssh[1]
  return null
}

export function assertSupportedNodeVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/u)
  if (!match) throw new Error(`Unrecognized Node.js version: ${version}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!((major === 22 && minor >= 12) || major >= 24)) {
    throw new Error(
      `Run-0 requires Node.js 22.12+ on the 22.x LTS line, or Node.js 24+; found ${version}.`
    )
  }
  return version
}

export function pathIsInside(root, candidate) {
  const relation = relative(resolve(root), resolve(candidate))
  return relation === '' || (relation !== '..' &&
    !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

export function assertRun0CandidateContract(body, requestId) {
  if (body?.protocolVersion !== '1.0' ||
    body?.requestId !== requestId ||
    body?.error?.code !== 'authentication_required') {
    throw new Error(
      'SciForge Cloud does not expose the frozen candidate collaboration contract.'
    )
  }
  return 'worker.availability.list'
}

async function git(...args) {
  const { stdout } = await execute('git', args, {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout.trim()
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(REPOSITORY_ROOT, path), 'utf8'))
}

async function pathExists(path) {
  try {
    await access(resolve(REPOSITORY_ROOT, path))
    return true
  } catch {
    return false
  }
}

async function request(url, expectedStatus, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  })
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned HTTP ${response.status}; expected ${expectedStatus}.`)
  }
  return response
}

async function verifyRepository(expectedCommit) {
  const [head, branch, origin, status, remoteLine] = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('branch', '--show-current'),
    git('remote', 'get-url', 'origin'),
    git('status', '--porcelain=v1', '--untracked-files=all'),
    git('ls-remote', '--exit-code', 'origin', `refs/heads/${EXPECTED_BRANCH}`)
  ])
  if (head !== expectedCommit) {
    throw new Error(`Local HEAD ${head} does not equal the frozen Run-0 commit ${expectedCommit}.`)
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`Run-0 must use ${EXPECTED_BRANCH}; found ${branch || 'detached HEAD'}.`)
  }
  if (githubRepositorySlug(origin) !== EXPECTED_FORK) {
    throw new Error(`origin must be the team Fork ${EXPECTED_FORK}; found ${origin}.`)
  }
  if (status !== '') {
    throw new Error('Run-0 checkout must be clean before launch.')
  }
  const remoteCommit = remoteLine.split(/\s+/u)[0]
  if (remoteCommit !== expectedCommit) {
    throw new Error(
      `Fork branch points to ${remoteCommit || 'nothing'}, not frozen commit ${expectedCommit}.`
    )
  }
  return Object.freeze({ branch, commit: head, originRepository: EXPECTED_FORK })
}

async function verifyBuildAndProvider() {
  for (const path of REQUIRED_BUILD_PATHS) {
    if (!await pathExists(path)) {
      throw new Error(`Missing source build output ${path}; run npm ci and npm run build.`)
    }
  }
  const packageManifest = await readJson(PROVIDER_PACKAGE_PATH)
  const descriptor = packageManifest.sciforgeDeploymentConfiguration
  if (descriptor?.contractVersion !== 1 || descriptor.publicRelease !== 'allowed' ||
    typeof descriptor.sourceRelativePath !== 'string') {
    throw new Error('OpenContent Provider is not using its public deployment configuration.')
  }
  const provider = await readJson(descriptor.sourceRelativePath)
  if (provider.contractVersion !== 1 ||
    provider.providerInstanceRef !== 'opencontent-edoc2-demo' ||
    typeof provider.origin !== 'string') {
    throw new Error('OpenContent public Provider configuration is invalid.')
  }
  const providerUrl = new URL(provider.origin)
  if (providerUrl.protocol !== 'https:' || providerUrl.origin !== provider.origin) {
    throw new Error('OpenContent public Provider origin must be one absolute HTTPS origin.')
  }
  if (await pathExists(LEGACY_PRIVATE_PROVIDER_PATH)) {
    throw new Error(
      `Fresh Run-0 clones must not carry the retired private Provider sidecar ${LEGACY_PRIVATE_PROVIDER_PATH}.`
    )
  }
  return Object.freeze({
    buildOutputs: REQUIRED_BUILD_PATHS.length,
    providerInstanceRef: provider.providerInstanceRef,
    providerOrigin: provider.origin,
    privateSkillRequired: false
  })
}

async function verifyPublicServices(providerOrigin) {
  const health = await request(`${CLOUD_ORIGIN}/healthz`, 200)
  const ready = await request(`${CLOUD_ORIGIN}/readyz`, 200)
  const me = await request(`${CLOUD_ORIGIN}/v1/me`, 401)
  const [healthBody, readyBody, meBody] = await Promise.all([
    health.json(), ready.json(), me.json()
  ])
  if (healthBody?.ok !== true || readyBody?.ok !== true ||
    typeof meBody !== 'object' || meBody === null) {
    throw new Error('SciForge Cloud public gate returned an unexpected body.')
  }
  const candidateRequestId = 'req_Run0Candidate01'
  const candidateContractResponse = await request(
    `${CLOUD_ORIGIN}/v1/commands`,
    401,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '1.0',
        requestId: candidateRequestId,
        type: 'worker.availability.list',
        limit: 1
      })
    }
  )
  const candidateContract = await candidateContractResponse.json()
  const candidateContractType = assertRun0CandidateContract(
    candidateContract,
    candidateRequestId
  )
  const discoveryResponse = await request(
    `${OIDC_ISSUER}/.well-known/openid-configuration`,
    200
  )
  const discovery = await discoveryResponse.json()
  if (discovery.issuer !== OIDC_ISSUER ||
    typeof discovery.authorization_endpoint !== 'string' ||
    typeof discovery.token_endpoint !== 'string' ||
    typeof discovery.jwks_uri !== 'string') {
    throw new Error('OIDC discovery does not match the frozen SciForge issuer.')
  }
  const providerResponse = await request(providerOrigin, 200)
  if (new URL(providerResponse.url).protocol !== 'https:') {
    throw new Error('OpenContent Provider redirected outside HTTPS.')
  }
  return Object.freeze({
    cloud: Object.freeze({
      candidateContract: candidateContractType,
      healthz: 200,
      meWithoutToken: 401,
      readyz: 200
    }),
    oidc: Object.freeze({ discovery: 200, issuer: OIDC_ISSUER }),
    opencontent: Object.freeze({ reachable: true, status: 200 })
  })
}

export async function runParticipantPreflight(options) {
  assertSupportedNodeVersion(process.versions.node)
  const repository = await verifyRepository(options.expectedCommit)
  const application = await verifyBuildAndProvider()
  const services = await verifyPublicServices(application.providerOrigin)
  return Object.freeze({
    status: 'ready_for_human_login',
    node: process.versions.node,
    repository,
    application,
    services,
    humanActionsStillRequired: Object.freeze([
      'OIDC login and ACTIVE Device confirmation',
      'local Runtime/model configuration',
      'Agent registration and Collaboration connection',
      'current user OpenContent account binding and ACL check'
    ])
  })
}

async function prepareProfileDirectory(profileDir) {
  if (pathIsInside(REPOSITORY_ROOT, profileDir)) {
    throw new Error('Run-0 profile directory must be outside the Git checkout.')
  }
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const entry = await lstat(profileDir)
  if (!entry.isDirectory() || entry.isSymbolicLink() ||
    await realpath(profileDir) !== resolve(profileDir)) {
    throw new Error('Run-0 profile directory must be one canonical real directory.')
  }
  return profileDir
}

async function launchParticipant(options, preflight) {
  const profileDir = await prepareProfileDirectory(options.profileDir)
  const executablePath = require('electron')
  process.stdout.write(`${JSON.stringify({
    status: 'launching',
    role: options.role,
    commit: options.expectedCommit,
    profileDir,
    services: preflight.services
  }, null, 2)}\n`)
  const child = spawn(executablePath, [
    REPOSITORY_ROOT,
    `--user-data-dir=${profileDir}`
  ], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      SCIFORGE_CLOUD_BASE_URL: CLOUD_ORIGIN,
      SCIFORGE_OIDC_ISSUER: OIDC_ISSUER,
      SCIFORGE_DEV_BROWSER_BRIDGE: '0'
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32'
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      try {
        if (process.platform === 'win32') child.kill(signal)
        else process.kill(-child.pid, signal)
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    })
  }
  return new Promise((resolveLaunch, rejectLaunch) => {
    child.once('error', rejectLaunch)
    child.once('exit', (code, signal) => {
      if (signal) rejectLaunch(new Error(`SciForge exited after ${signal}.`))
      else if (code === 0) resolveLaunch()
      else rejectLaunch(new Error(`SciForge exited with code ${code ?? 'unknown'}.`))
    })
  })
}

async function main(argv) {
  const options = parseRun0ParticipantOptions(argv)
  const preflight = await runParticipantPreflight(options)
  if (options.command === 'check') {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`)
    return
  }
  await launchParticipant(options, preflight)
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[run0-source-participant] ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
