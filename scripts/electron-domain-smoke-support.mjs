import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CAPABILITY_BROKER_CONTRACT_VERSION } from '../src/shared/capability-broker-contract-version.mjs'

const TEMPORARY_DIRECTORY_PREFIX = 'sciforge-electron-domain-smoke-'
const DEFAULT_TIMEOUT_MS = 45_000
export const IDENTITY_SMOKE_CAPABILITY_IDS = Object.freeze([
  'identity.local.inspect',
  'identity.local.list-accounts',
  'identity.local.create-account',
  'identity.local.select-account',
  'identity.local.rename-account',
  'identity.local.exit-account',
  'identity.local.dismiss-first-prompt',
  'identity.local.backup-and-reset'
])
export const CLOUD_IDENTITY_SMOKE_CAPABILITY_IDS = Object.freeze([
  'identity.cloud.inspect',
  'identity.cloud.login',
  'identity.cloud.reauthenticate',
  'identity.cloud.logout',
  'identity.cloud.enroll-device',
  'identity.cloud.refresh-devices',
  'identity.cloud.revoke-device'
])
export const CONTENT_SPACE_SMOKE_CAPABILITY_IDS = Object.freeze([
  'content-space.list-provider-instances',
  'content-space.describe-capabilities',
  'content-space.list-containers',
  'content-space.list-entries',
  'content-space.observe-entry',
  'content-space.create-folder',
  'content-space.upload-new',
  'content-space.download',
  'content-space.resolve-portal-target',
  'content-space.open-portal-target',
  'content-space.observe-immutable-version'
])
export const COLLABORATION_SMOKE_CAPABILITY_IDS = Object.freeze([
  'collaboration.status.read',
  'collaboration.connection.configure',
  'collaboration.connection.connect',
  'collaboration.endpoint.challenge.start',
  'collaboration.endpoint.challenge.poll',
  'collaboration.agent.register',
  'collaboration.participant.primary-agent.select',
  'collaboration.projection.link',
  'collaboration.projection.update',
  'collaboration.projection.share',
  'collaboration.sync.retry',
  'collaboration.task.list',
  'collaboration.worker.acceptance-policy.update',
  'collaboration.task.offer.decide',
  'collaboration.managed-container.inspect',
  'collaboration.managed-container.provision',
  'collaboration.managed-container.archive'
])
export const PROJECT_COORDINATOR_SMOKE_CAPABILITY_IDS = Object.freeze([
  'project-coordinator.workspace.read',
  'project-coordinator.project.create',
  'project-coordinator.plan-draft.read',
  'project-coordinator.plan-draft.generate',
  'project-coordinator.plan-draft.edit',
  'project-coordinator.plan.submit',
  'project-coordinator.plan.confirm-activate',
  'project-coordinator.content-provisioning.plan',
  'project-coordinator.content-provisioning.apply',
  'project-coordinator.content-recovery.observe-link',
  'project-coordinator.content-recovery.abandon',
  'project-coordinator.content-recovery.retry-successor',
  'project-coordinator.membership.add',
  'project-coordinator.membership.remove',
  'project-coordinator.human-needed.create',
  'project-coordinator.human-needed.answer',
  'project-coordinator.coordinator.transfer',
  'project-coordinator.artifact-review.prepare',
  'project-coordinator.result.review',
  'project-coordinator.project.complete'
])
export const REQUIRED_CAPABILITY_IDS = Object.freeze([
  ...IDENTITY_SMOKE_CAPABILITY_IDS,
  ...CLOUD_IDENTITY_SMOKE_CAPABILITY_IDS,
  ...CONTENT_SPACE_SMOKE_CAPABILITY_IDS,
  ...COLLABORATION_SMOKE_CAPABILITY_IDS,
  ...PROJECT_COORDINATOR_SMOKE_CAPABILITY_IDS,
  'browser-preview.open',
  'browser-preview.read',
  'browser-preview.navigate',
  'browser-preview.back',
  'browser-preview.forward',
  'browser-preview.reload',
  'browser-preview.click',
  'browser-preview.fill',
  'browser-preview.select',
  'browser-preview.press',
  'paper-radar.status',
  'paper-radar.profiles.list',
  'paper-radar.profiles.save',
  'create-loop.build-dataset',
  'create-loop.read',
  'dataset-api.materialize',
  'workspace-preview.list',
  'workspace-preview.open',
  'workspace-preview.apply-edit',
  'workspace-preview.release',
  'artifact-versions.commit',
  'artifact-versions.observe',
  'artifact-versions.read',
  'artifact-versions.list',
  'artifact-versions.materialize',
  'artifact-versions.restore-as-new',
  'artifact-versions.compare',
  'artifact-versions.bundle.export',
  'artifact-versions.bundle.import',
  'artifact-versions.bundle.verify',
  'artifact-versions.events.list',
  'artifact-versions.lifecycle.refresh',
  'evidence-dag.view',
  'evidence-dag.update',
  'evidence-dag.priority',
  'evidence-dag.resolve-evidence-preview',
  'evidence-dag.export-snapshot-products',
  'scientific-plotting.status',
  'scientific-plotting.map-data',
  'scientific-plotting.render',
  'scientific-plotting.rerun',
  'scientific-plotting.compare',
  'visual-review.open',
  'visual-review.read-document',
  'visual-review.accept-candidate',
  'visual-review.reject-candidate'
])
const PROCESS_FAILURE_PATTERNS = Object.freeze([
  /\[sciforge\] failed to load preload/iu,
  /\[sciforge\] startup failed/iu,
  /render-process-gone/iu,
  /did-fail-load/iu
])

export function createIdentitySmokeInvocationId(createUuid = randomUUID) {
  const uuid = createUuid()
  if (typeof uuid !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(uuid)) {
    throw new Error('Identity smoke invocation UUID is invalid.')
  }
  return `electron-smoke-identity-create-${uuid}`
}

export async function createSourceSmokeConfiguration(repositoryRoot) {
  const root = resolve(repositoryRoot)
  for (const path of [
    join(root, 'out/main/index.js'),
    join(root, 'out/main/codex-pre-tool-use-governance-node-entry.js'),
    join(root, 'out/preload/index.cjs'),
    join(root, 'out/renderer/index.html')
  ]) {
    await access(path, fsConstants.R_OK)
  }
  return {
    applicationPath: root,
    expectedRendererUrl: pathToFileURL(join(root, 'out/renderer/index.html')).href,
    label: 'source/out'
  }
}

export async function locatePackagedExecutable({
  distDirectory,
  platform = process.platform,
  arch = process.arch,
  productName = 'SciForge'
}) {
  const root = resolve(distDirectory)
  const candidates = await collectExecutableCandidates(root, { platform, productName })
  if (candidates.length === 0) {
    throw new Error(
      `No unpacked ${platform}/${arch} ${productName} executable was found under ${root}. ` +
      'Build an unpacked distributable first or pass --executable explicitly.'
    )
  }
  const inspected = await Promise.all(candidates.map(async (path) => ({
    architectures: await detectExecutableArchitectures(path, platform),
    path
  })))
  const architectureCandidates = inspected.filter(({ architectures, path }) =>
    path.split(/[\\/]/u).some((segment) => segment.includes(arch)) &&
    (architectures.size === 0 || architectures.has(arch))
  )
  const detectedCandidates = inspected.filter(({ architectures }) => architectures.has(arch))
  const unknownCandidates = inspected.filter(({ architectures }) => architectures.size === 0)
  const compatible = (
    architectureCandidates.length > 0
      ? architectureCandidates
      : detectedCandidates.length > 0
        ? detectedCandidates
        : unknownCandidates
  ).map(({ path }) => path)
  if (compatible.length === 0) {
    throw new Error(
      `No unpacked ${productName} executable compatible with ${platform}/${arch} was found under ${root}. ` +
      `Candidates: ${candidates.join(', ')}.`
    )
  }
  if (compatible.length !== 1) {
    throw new Error(
      `Multiple unpacked ${productName} executables match ${platform}/${arch}: ` +
      `${compatible.join(', ')}. Pass --executable explicitly.`
    )
  }
  await assertExecutable(compatible[0], platform)
  return compatible[0]
}

export async function runElectronDomainSmoke({
  executablePath,
  applicationPath,
  expectedRendererUrl,
  expectedDeployment,
  label,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  loadElectron = loadPlaywrightElectron,
  removeTemporaryDirectory = removeElectronSmokeTemporaryDirectory,
  reportCleanupError = defaultReportCleanupError
}) {
  await assertExecutable(executablePath, process.platform)
  const temporaryDirectory = await createElectronSmokeTemporaryDirectory()
  const userDataDirectory = join(temporaryDirectory, 'user-data')
  const workspaceDirectory = join(temporaryDirectory, 'workspace')
  const workspaceFile = join(workspaceDirectory, 'notes.md')
  await mkdir(userDataDirectory, { recursive: true })
  await mkdir(workspaceDirectory, { recursive: true })
  await writeFile(workspaceFile, 'hello\nworld\n', 'utf8')

  let electronApp
  let visualRouterStub
  let interruptedBy
  let primaryError
  let phase = 'launch'
  const signalHandlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      interruptedBy = signal
      void electronApp?.close().catch(() => undefined)
    }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }

  try {
    visualRouterStub = await startDeterministicVisualRouterStub()
    await writeFile(
      join(userDataDirectory, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        modelRouter: {
          enabled: true,
          autoStart: false,
          baseUrl: visualRouterStub.baseUrl,
          publicModelAlias: 'electron-smoke-vision',
          runtimeApiKey: visualRouterStub.apiKey
        }
      }),
      'utf8'
    )
    const electron = await loadElectron()
    electronApp = await electron.launch({
      executablePath: resolve(executablePath),
      cwd: applicationPath ? resolve(applicationPath) : dirname(resolve(executablePath)),
      args: [
        ...(applicationPath ? [resolve(applicationPath)] : []),
        `--user-data-dir=${userDataDirectory}`,
        '--hidden'
      ],
      env: {
        ...process.env,
        ...(expectedDeployment ? {
          SCIFORGE_CLOUD_BASE_URL: expectedDeployment.cloudOrigin,
          SCIFORGE_OIDC_ISSUER: expectedDeployment.oidcIssuer
        } : {}),
        SCIFORGE_DEV_BROWSER_BRIDGE: '0',
        SCIFORGE_ELECTRON_SMOKE: '1',
        SCIFORGE_STARTUP_TRACE: '1'
      },
      timeout: timeoutMs
    })
    phase = 'first window'
    const processOutput = collectProcessOutput(electronApp.process())
    const rendererFailures = []
    const attachedPages = new WeakSet()
    const attachPage = (page) => {
      if (attachedPages.has(page)) return
      attachedPages.add(page)
      page.on('pageerror', (error) => rendererFailures.push(`Renderer page error: ${error.message}`))
      page.on('crash', () => rendererFailures.push('Renderer page crashed.'))
    }
    electronApp.on('window', attachPage)

    const earlyExit = new Promise((_, reject) => {
      electronApp.process().once('exit', (code, signal) => {
        reject(new Error(
          `Electron exited before the smoke completed (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`
        ))
      })
    })
    const operation = async () => {
      const window = await electronApp.firstWindow({ timeout: timeoutMs })
      phase = 'main-process diagnostics'
      await installMainProcessDiagnostics(electronApp)
      const deploymentEnvironment = await electronApp.evaluate(() => ({
        cloudOrigin: process.env.SCIFORGE_CLOUD_BASE_URL ?? null,
        oidcIssuer: process.env.SCIFORGE_OIDC_ISSUER ?? null
      }))
      attachPage(window)
      phase = 'renderer load'
      await window.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
      phase = 'preload bridge readiness'
      await window.waitForFunction(
        () => document.readyState === 'complete' &&
          typeof globalThis.sciforge?.capabilities?.invoke === 'function',
        undefined,
        { timeout: timeoutMs }
      )
      phase = 'native visual workflow'
      const nativeVisual = await electronApp.evaluate(
        async (_electron, { workspaceDirectory: smokeWorkspaceDirectory }) => {
          const run = globalThis.__SCIFORGE_ELECTRON_DOMAIN_NATIVE_VISUAL_SMOKE__
          if (typeof run !== 'function') {
            throw new Error('The main process did not install the native visual smoke driver.')
          }
          return await run({ workspaceDirectory: smokeWorkspaceDirectory })
        },
        { workspaceDirectory }
      )
      phase = 'Codex PreToolUse hook probe'
      const codexPreToolUseHook = await electronApp.evaluate(
        async (_electron, { workspaceDirectory: smokeWorkspaceDirectory }) => {
          const run = globalThis.__SCIFORGE_ELECTRON_DOMAIN_CODEX_HOOK_SMOKE__
          if (typeof run !== 'function') {
            throw new Error('The main process did not install the Codex hook smoke driver.')
          }
          return await run({ workspaceDirectory: smokeWorkspaceDirectory })
        },
        { workspaceDirectory }
      )
      phase = 'capability workflow'
      const result = await window.evaluate(smokeRendererWorkflow, {
        expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
        expectCloudConfigured: Boolean(expectedDeployment),
        identityInvocationId: createIdentitySmokeInvocationId(),
        requiredCapabilityIds: REQUIRED_CAPABILITY_IDS,
        workspaceDirectory
      })
      validateSmokeResult(
        { ...result, deploymentEnvironment, nativeVisual, codexPreToolUseHook },
        { expectedDeployment, expectedRendererUrl }
      )

      phase = 'lifecycle diagnostics'
      const mainFailures = await readMainProcessDiagnostics(electronApp)
      const outputFailures = processOutput.failures()
      if (rendererFailures.length > 0 || mainFailures.length > 0 || outputFailures.length > 0) {
        throw new Error([...rendererFailures, ...mainFailures, ...outputFailures].join(' | '))
      }
      phase = 'persistence verification'
      const editedText = await readFile(workspaceFile, 'utf8')
      if (editedText !== 'hello\nSciForge\n') {
        throw new Error(`Workspace Preview edit did not persist: ${JSON.stringify(editedText)}`)
      }
      const storedProfiles = JSON.parse(await readFile(
        join(userDataDirectory, 'paper-radar', 'profiles.json'),
        'utf8'
      ))
      if (!Array.isArray(storedProfiles) || !storedProfiles.some((profile) => profile?.name === 'electron_smoke')) {
        throw new Error('Paper Radar profile was not persisted inside the isolated userData directory.')
      }
      await verifyPersistedNativeVisualArtifact(workspaceDirectory, nativeVisual)
      return {
        mode: label,
        executablePath: resolve(executablePath),
        deploymentEnvironment,
        ...result,
        nativeVisual,
        codexPreToolUseHook,
        workspaceEditPersisted: true,
        paperRadarProfilePersisted: true
      }
    }

    const result = await withTimeout(
      Promise.race([operation(), earlyExit]),
      timeoutMs,
      () => `Electron ${label} smoke timed out during ${phase} after ${timeoutMs} ms.`
    )
    if (interruptedBy) throw new Error(`Electron smoke interrupted by ${interruptedBy}.`)
    return result
  } catch (error) {
    const output = electronApp ? collectBufferedOutput(electronApp.process()).trim() : ''
    primaryError = new Error(
      `${error instanceof Error ? error.message : String(error)}${output ? `\nElectron output:\n${output}` : ''}`,
      { cause: error }
    )
    throw primaryError
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
    await cleanupElectronSmoke({
      electronApp,
      visualRouterStub,
      temporaryDirectory,
      removeTemporaryDirectory,
      reportCleanupError,
      primaryError
    })
  }
}

export async function cleanupElectronSmoke({
  electronApp,
  visualRouterStub,
  temporaryDirectory,
  removeTemporaryDirectory = removeElectronSmokeTemporaryDirectory,
  reportCleanupError = defaultReportCleanupError,
  primaryError
}) {
  const cleanupErrors = []
  for (const cleanup of [
    () => closeElectron(electronApp),
    () => visualRouterStub?.close(),
    () => removeTemporaryDirectory(temporaryDirectory)
  ]) {
    try {
      await cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length === 0) return
  const cleanupError = new AggregateError(cleanupErrors, 'Electron smoke cleanup failed.')
  if (primaryError) {
    reportCleanupError(cleanupError)
    return
  }
  throw cleanupError
}

export async function createElectronSmokeTemporaryDirectory(
  runDirectory = process.env.SCIFORGE_E2E_RUN_DIRECTORY
) {
  const normalizedRunDirectory = typeof runDirectory === 'string' ? runDirectory.trim() : ''
  if (!normalizedRunDirectory) return mkdtemp(join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX))
  const owner = resolve(normalizedRunDirectory)
  const target = resolve(owner, 'profiles/electron-domain-smoke')
  const relation = relative(owner, target)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Electron smoke profile directory escapes the supervisor run directory.')
  }
  await mkdir(target, { recursive: true })
  return target
}

export function parseSmokeCliOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (![
      '--repository-root',
      '--dist-dir',
      '--executable',
      '--timeout-ms',
      '--expected-cloud-origin',
      '--expected-oidc-issuer'
    ].includes(flag)) {
      throw new Error(`Unknown Electron smoke option: ${flag}`)
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
    } else if (flag === '--expected-cloud-origin') {
      options.expectedCloudOrigin = requireAbsoluteHttpsOrigin(value, flag)
    } else if (flag === '--expected-oidc-issuer') {
      options.expectedOidcIssuer = requireAbsoluteHttpsUrl(value, flag)
    } else {
      options.executablePath = resolve(value)
    }
  }
  if (Boolean(options.expectedCloudOrigin) !== Boolean(options.expectedOidcIssuer)) {
    throw new Error(
      '--expected-cloud-origin and --expected-oidc-issuer must be supplied together.'
    )
  }
  if (options.expectedCloudOrigin) {
    options.expectedDeployment = Object.freeze({
      cloudOrigin: options.expectedCloudOrigin,
      oidcIssuer: options.expectedOidcIssuer
    })
  }
  return options
}

async function smokeRendererWorkflow({
  expectedContractVersion,
  expectCloudConfigured,
  identityInvocationId,
  requiredCapabilityIds,
  workspaceDirectory
}) {
  const api = globalThis.sciforge
  if (!api) throw new Error('Preload did not expose window.sciforge.')
  if (Object.prototype.hasOwnProperty.call(api, 'paperRadar')) {
    throw new Error('Retired Paper Radar preload namespace is still exposed.')
  }
  const readiness = await api.capabilities.readiness({
    workspaceId: workspaceDirectory,
    expectedContractVersion,
    requiredCapabilityIds
  })
  if (readiness.status !== 'ready') throw new Error(readiness.message)

  const identityAccount = await api.capabilities.invoke({
    request: {
      actionId: 'identity.local.create-account',
      invocationId: identityInvocationId,
      input: { username: 'electron_smoke' }
    }
  })
  if (identityAccount.actionId !== 'identity.local.create-account' ||
    identityAccount.output?.status !== 'available' ||
    identityAccount.output.currentAccount?.username !== 'electron_smoke') {
    throw new Error('Identity did not create and select the isolated smoke account.')
  }

  const cloudIdentity = await api.capabilities.invoke({
    request: { actionId: 'identity.cloud.inspect', input: {} }
  })
  const cloudSnapshot = cloudIdentity.output?.snapshot
  if (cloudIdentity.actionId !== 'identity.cloud.inspect' ||
    cloudSnapshot?.identity?.state !== 'signed-out' ||
    cloudSnapshot?.device?.state !== 'signed-out') {
    throw new Error('Cloud Identity did not expose the isolated pre-login state.')
  }
  if (expectCloudConfigured && cloudSnapshot.error) {
    throw new Error(
      `Cloud Identity pre-login readiness failed: ${cloudSnapshot.error.code ?? cloudSnapshot.error.source}.`
    )
  }

  const contentSpaceProviders = await api.capabilities.invoke({
    request: { actionId: 'content-space.list-provider-instances', input: {} }
  })
  const providerInstances = contentSpaceProviders.output?.ok
    ? contentSpaceProviders.output.value?.items
    : undefined
  const providerInstanceRefs = Array.isArray(providerInstances)
    ? providerInstances.map(({ providerInstanceRef }) => providerInstanceRef)
    : []
  if (contentSpaceProviders.actionId !== 'content-space.list-provider-instances' ||
    providerInstanceRefs.length === 0 ||
    providerInstanceRefs.some((providerInstanceRef) =>
      typeof providerInstanceRef !== 'string' || providerInstanceRef.length === 0
    ) ||
    new Set(providerInstanceRefs).size !== providerInstanceRefs.length) {
    throw new Error('Content Space did not expose a unique installed Provider Instance directory.')
  }

  const collaborationStatus = await api.capabilities.invoke({
    request: { actionId: 'collaboration.status.read', input: {} }
  })
  if (collaborationStatus.actionId !== 'collaboration.status.read' ||
    collaborationStatus.output?.connection?.configured !== false ||
    collaborationStatus.output?.connection?.state !== 'unconfigured') {
    throw new Error('Collaboration did not preserve the isolated profile as unconfigured.')
  }

  const projectCoordinatorWorkspace = await api.capabilities.invoke({
    request: { actionId: 'project-coordinator.workspace.read', input: {} }
  })
  const expectedProjectCoordinatorState = expectCloudConfigured
    ? 'identity_required'
    : 'cloud_unavailable'
  if (projectCoordinatorWorkspace.actionId !== 'project-coordinator.workspace.read' ||
    projectCoordinatorWorkspace.output?.connection?.state !== expectedProjectCoordinatorState ||
    !Array.isArray(projectCoordinatorWorkspace.output?.projects) ||
    projectCoordinatorWorkspace.output.projects.length !== 0) {
    throw new Error(
      'Project Coordinator did not stop at the expected pre-login Cloud identity boundary.'
    )
  }

  const paperRadarStatus = await api.capabilities.invoke({
    request: { actionId: 'paper-radar.status', input: {} }
  })
  const profileSaveRequest = {
    actionId: 'paper-radar.profiles.save',
    invocationId: 'electron-smoke-profile-save',
    input: {
      name: 'electron_smoke',
      description: 'Isolated Electron domain smoke profile.',
      keywords: ['smoke'],
      excludeKeywords: [],
      arxivCategories: [],
      biorxivSubjects: []
    }
  }
  let unconfirmedSaveRejected = false
  try {
    await api.capabilities.invoke({ request: profileSaveRequest })
  } catch (error) {
    unconfirmedSaveRejected = String(error).includes('requires confirmation approval')
  }
  if (!unconfirmedSaveRejected) {
    throw new Error('Paper Radar profile save did not enforce invocation-scoped confirmation.')
  }
  const savedProfile = await api.capabilities.invoke({
    request: profileSaveRequest,
    approval: { mode: 'confirmation' }
  })
  const listedProfiles = await api.capabilities.invoke({
    request: { actionId: 'paper-radar.profiles.list', input: {} }
  })
  if (!savedProfile.output?.ok || !listedProfiles.output?.ok ||
      !listedProfiles.output.data.profiles.some((profile) => profile.name === 'electron_smoke')) {
    throw new Error('Paper Radar profile did not survive save/list through the capability transport.')
  }

  const datasetLoopRequest = {
    actionId: 'create-loop.build-dataset',
    invocationId: 'electron-smoke-dataset-loop-build',
    input: {
      name: 'Electron smoke dataset loop',
      objective: 'Create one grounded protein question for runtime composition verification.',
      sourceIds: ['uniprot'],
      outputSchema: {
        question: { type: 'string', required: true },
        answer: { type: 'string', required: true },
        evidence: { type: 'array', required: true }
      },
      quality: {
        criteria: ['The answer must be grounded in the selected source.'],
        targetCount: 1,
        maxIterations: 2,
        minQualityScore: 0.7,
        minStrongScore: 0.7,
        maxWeakScore: 0.4,
        minScoreGap: 0.3,
        maxDuplicateFraction: 0
      },
      output: {
        datasetName: 'electron-smoke-dataset',
        fileName: 'electron-smoke-dataset.jsonl',
        format: 'jsonl'
      },
      humanReview: false,
      run: false
    }
  }
  const builtDatasetLoop = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: datasetLoopRequest,
    approval: { mode: 'confirmation' }
  })
  const createLoopSnapshot = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: { actionId: 'create-loop.read', input: {} }
  })
  const builtWorkflowIds = [
    builtDatasetLoop.output?.workflowId,
    builtDatasetLoop.output?.iterationWorkflowId
  ]
  const savedWorkflows = createLoopSnapshot.output?.settings?.workflows
  if (builtDatasetLoop.output?.created !== true ||
      builtWorkflowIds.some((id) => typeof id !== 'string') ||
      !Array.isArray(savedWorkflows) ||
      !builtWorkflowIds.every((id) => savedWorkflows.some((workflow) => workflow.id === id)) ||
      createLoopSnapshot.output?.settings?.presets?.length !== 0) {
    throw new Error(`Dynamic Dataset Create Loop was not saved as two editable workflows without a preset: ${JSON.stringify({
      created: builtDatasetLoop.output?.created,
      builtWorkflowIds,
      savedWorkflowIds: Array.isArray(savedWorkflows) ? savedWorkflows.map((workflow) => workflow.id) : null,
      presetCount: createLoopSnapshot.output?.settings?.presets?.length
    })}`)
  }

  const plugins = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: { actionId: 'workspace-preview.list', input: {} }
  })
  const opened = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: {
      actionId: 'workspace-preview.open',
      input: { workspaceRoot: workspaceDirectory, path: 'notes.md', mode: 'edit' }
    }
  })
  if (!opened.output?.ok || !opened.output.resource) throw new Error('Workspace Preview open failed.')
  const observed = await api.capabilities.observe({
    workspaceId: workspaceDirectory,
    request: { resource: opened.output.resource }
  })
  const edited = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: {
      actionId: 'workspace-preview.apply-edit',
      invocationId: 'electron-smoke-text-edit',
      resource: observed.resource,
      expectedRevision: observed.semanticRevision,
      input: {
        operation: {
          kind: 'text.replaceRange',
          path: 'notes.md',
          range: {
            start: { line: 2, column: 1 },
            end: { line: 2, column: 6 }
          },
          text: 'SciForge'
        }
      }
    }
  })
  if (!edited.changed || !edited.output?.ok || !edited.resource) {
    throw new Error('Workspace Preview apply-edit did not report a persisted change.')
  }
  const observedAfterEdit = await api.capabilities.observe({
    workspaceId: workspaceDirectory,
    request: { resource: edited.resource }
  })
  if (!String(observedAfterEdit.state?.observation?.visibleText ?? '').includes('SciForge')) {
    throw new Error('Workspace Preview observe did not return the edited text.')
  }
  const released = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: {
      actionId: 'workspace-preview.release',
      invocationId: 'electron-smoke-preview-release',
      resource: observedAfterEdit.resource,
      input: {}
    }
  })
  if (released.output !== true) throw new Error('Workspace Preview release failed.')

  const artifactHistory = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: { actionId: 'artifact-versions.list', input: { limit: 1 } }
  })
  if (!artifactHistory.output?.ok || !Array.isArray(artifactHistory.output.value?.items)) {
    throw new Error('Artifact Versions did not return workspace-scoped history.')
  }
  const plottingStatus = await api.capabilities.invoke({
    request: { actionId: 'scientific-plotting.status', input: {} }
  })
  if (plottingStatus.actionId !== 'scientific-plotting.status' || !plottingStatus.output) {
    throw new Error('Scientific Plotting status was not reachable through the capability broker.')
  }
  const evidenceView = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: { actionId: 'evidence-dag.view', input: {} }
  })
  if (evidenceView.actionId !== 'evidence-dag.view' || !evidenceView.output?.status) {
    throw new Error('Evidence DAG view was not reachable through the workspace capability path.')
  }
  const visualReview = await api.capabilities.invoke({
    workspaceId: workspaceDirectory,
    request: {
      actionId: 'visual-review.open',
      invocationId: 'electron-smoke-visual-review-open',
      input: { documentId: 'electron-smoke-review' }
    }
  })
  if (visualReview.actionId !== 'visual-review.open' || !visualReview.output?.document) {
    throw new Error('Visual Review did not open through the workspace capability path.')
  }

  return {
    title: document.title,
    url: location.href,
    platform: document.documentElement.dataset.platform,
    version: await api.getAppVersion(),
    readiness: readiness.status,
    capabilityCount: readiness.availableCapabilityIds.length,
    identityActionId: identityAccount.actionId,
    identityAccountUsername: identityAccount.output.currentAccount.username,
    cloudIdentityActionId: cloudIdentity.actionId,
    cloudIdentityState: cloudSnapshot.identity.state,
    cloudDeviceState: cloudSnapshot.device.state,
    cloudIdentityErrorCode: cloudSnapshot.error?.code ?? null,
    contentSpaceProviderActionId: contentSpaceProviders.actionId,
    contentSpaceProviderInstanceRef: providerInstanceRefs[0],
    contentSpaceProviderInstanceCount: providerInstanceRefs.length,
    collaborationActionId: collaborationStatus.actionId,
    collaborationConfigured: collaborationStatus.output.connection.configured,
    collaborationConnectionState: collaborationStatus.output.connection.state,
    projectCoordinatorActionId: projectCoordinatorWorkspace.actionId,
    projectCoordinatorConnectionState: projectCoordinatorWorkspace.output.connection.state,
    projectCoordinatorProjectCount: projectCoordinatorWorkspace.output.projects.length,
    datasetLoopCreated: true,
    datasetLoopWorkflowCount: builtWorkflowIds.length,
    paperRadarActionId: paperRadarStatus.actionId,
    paperRadarProfileCount: listedProfiles.output.data.profiles.length,
    workspacePreviewActionId: plugins.actionId,
    previewPluginCount: Array.isArray(plugins.output) ? plugins.output.length : null,
    workspacePreviewPluginId: opened.output.session?.pluginId,
    workspacePreviewReleased: released.output,
    artifactVersionsActionId: artifactHistory.actionId,
    evidenceDagActionId: evidenceView.actionId,
    scientificPlottingActionId: plottingStatus.actionId,
    visualReviewActionId: visualReview.actionId
  }
}

async function installMainProcessDiagnostics(electronApp) {
  await electronApp.evaluate(({ app, BrowserWindow }) => {
    const state = { failures: [], attached: new WeakSet() }
    globalThis.__SCIFORGE_ELECTRON_SMOKE_DIAGNOSTICS__ = state
    const attach = (contents) => {
      if (state.attached.has(contents)) return
      state.attached.add(contents)
      contents.on('preload-error', (_event, path, error) => {
        state.failures.push(`Preload error at ${path}: ${error?.message ?? String(error)}`)
      })
      contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) state.failures.push(`Main frame load failed ${code} at ${url}: ${description}`)
      })
      contents.on('render-process-gone', (_event, detail) => {
        state.failures.push(`Renderer process gone: ${detail?.reason ?? 'unknown'}`)
      })
      contents.on('unresponsive', () => state.failures.push('Renderer became unresponsive.'))
    }
    app.on('web-contents-created', (_event, contents) => attach(contents))
    for (const window of BrowserWindow.getAllWindows()) attach(window.webContents)
  })
}

async function readMainProcessDiagnostics(electronApp) {
  return await electronApp.evaluate(() => [
    ...(globalThis.__SCIFORGE_ELECTRON_SMOKE_DIAGNOSTICS__?.failures ?? [])
  ])
}

export function validateSmokeResult(result, { expectedDeployment, expectedRendererUrl }) {
  if (!result || typeof result !== 'object') throw new Error('Electron smoke returned no renderer result.')
  if (result.readiness !== 'ready') throw new Error(`Capability readiness was ${String(result.readiness)}.`)
  if (result.identityActionId !== 'identity.local.create-account' ||
    result.identityAccountUsername !== 'electron_smoke') {
    throw new Error('Identity account creation did not establish the isolated smoke Principal.')
  }
  if (result.cloudIdentityActionId !== 'identity.cloud.inspect' ||
    result.cloudIdentityState !== 'signed-out' || result.cloudDeviceState !== 'signed-out') {
    throw new Error('Cloud Identity pre-login state was not available through the capability path.')
  }
  if (expectedDeployment) {
    if (result.deploymentEnvironment?.cloudOrigin !== expectedDeployment.cloudOrigin ||
      result.deploymentEnvironment?.oidcIssuer !== expectedDeployment.oidcIssuer) {
      throw new Error('Packaged deployment environment does not match the frozen Cloud/OIDC endpoints.')
    }
    if (result.cloudIdentityErrorCode !== null) {
      throw new Error('Cloud Identity was not ready at the frozen pre-login boundary.')
    }
  }
  if (result.contentSpaceProviderActionId !== 'content-space.list-provider-instances' ||
    typeof result.contentSpaceProviderInstanceRef !== 'string' ||
    result.contentSpaceProviderInstanceRef.length === 0 ||
    !Number.isSafeInteger(result.contentSpaceProviderInstanceCount) ||
    result.contentSpaceProviderInstanceCount < 1) {
    throw new Error('Content Space Provider Instance directory was not available.')
  }
  if (result.collaborationActionId !== 'collaboration.status.read' ||
    result.collaborationConfigured !== false ||
    result.collaborationConnectionState !== 'unconfigured') {
    throw new Error('Collaboration isolated profile did not remain unconfigured.')
  }
  const expectedProjectCoordinatorState = expectedDeployment
    ? 'identity_required'
    : 'cloud_unavailable'
  if (result.projectCoordinatorActionId !== 'project-coordinator.workspace.read' ||
    result.projectCoordinatorConnectionState !== expectedProjectCoordinatorState ||
    result.projectCoordinatorProjectCount !== 0) {
    throw new Error('Project Coordinator did not preserve the expected pre-login identity boundary.')
  }
  if (result.paperRadarActionId !== 'paper-radar.status') throw new Error('Paper Radar status action mismatch.')
  if (result.workspacePreviewActionId !== 'workspace-preview.list') throw new Error('Workspace Preview list action mismatch.')
  if (result.workspacePreviewPluginId !== 'markdown') throw new Error('Workspace Preview did not select Markdown.')
  if (result.workspacePreviewReleased !== true) throw new Error('Workspace Preview session was not released.')
  if (result.artifactVersionsActionId !== 'artifact-versions.list') {
    throw new Error('Artifact Versions capability path mismatch.')
  }
  if (result.evidenceDagActionId !== 'evidence-dag.view') {
    throw new Error('Evidence DAG capability path mismatch.')
  }
  if (result.scientificPlottingActionId !== 'scientific-plotting.status') {
    throw new Error('Scientific Plotting capability path mismatch.')
  }
  if (result.visualReviewActionId !== 'visual-review.open') {
    throw new Error('Visual Review capability path mismatch.')
  }
  if (result.datasetLoopCreated !== true || result.datasetLoopWorkflowCount !== 2) {
    throw new Error('Dynamic Dataset Create Loop creation did not pass the real capability transport.')
  }
  if (!Number.isSafeInteger(result.previewPluginCount) || result.previewPluginCount < 1) {
    throw new Error('Workspace Preview returned no registered plugins.')
  }
  if (result.platform === 'unknown' || !result.platform) throw new Error('Renderer platform initialization did not complete.')
  const nativeVisual = result.nativeVisual
  if (!nativeVisual || typeof nativeVisual !== 'object') {
    throw new Error('Native visual smoke returned no result.')
  }
  if (
    !Array.isArray(nativeVisual.toolNames) ||
    !nativeVisual.toolNames.includes('sciforge_look') ||
    !nativeVisual.toolNames.includes('sciforge_capture')
  ) {
    throw new Error('Native visual smoke did not discover both native visual tools.')
  }
  if (
    nativeVisual.cropped !== true ||
    nativeVisual.nativeImageBindingValidated !== true ||
    nativeVisual.proofChainValidated !== true ||
    nativeVisual.datasetLoopCapabilitiesDiscoverable !== true ||
    nativeVisual.unavailableRouteFailedVisibly !== true
  ) {
    throw new Error('Native visual smoke did not validate capture, bindings, proofs, dataset Loop discovery, and failure behavior.')
  }
  const codexHook = result.codexPreToolUseHook
  if (
    !codexHook ||
    codexHook.denied !== true ||
    typeof codexHook.reason !== 'string' ||
    !codexHook.reason.startsWith('sciforge_hook_deny_challenge:')
  ) {
    throw new Error('Codex PreToolUse hook did not pass the real deny challenge.')
  }
  if (expectedRendererUrl) {
    if (result.url !== expectedRendererUrl) {
      throw new Error(`Renderer loaded ${result.url}; expected ${expectedRendererUrl}.`)
    }
  } else {
    const url = new URL(result.url)
    if (url.protocol !== 'file:' || !url.pathname.endsWith('/out/renderer/index.html')) {
      throw new Error(`Packaged renderer loaded an unexpected URL: ${result.url}.`)
    }
  }
}

function requireAbsoluteHttpsOrigin(value, label) {
  const url = requireAbsoluteHttpsUrl(value, label)
  if (url !== new URL(url).origin) {
    throw new Error(`${label} must be an absolute HTTPS origin with no path.`)
  }
  return url
}

function requireAbsoluteHttpsUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an absolute HTTPS URL without credentials, query, or fragment.`)
  }
  return url.toString().replace(/\/$/u, '')
}

async function verifyPersistedNativeVisualArtifact(workspaceDirectory, nativeVisual) {
  const artifactPath = resolve(workspaceDirectory, nativeVisual.artifactRelativePath)
  const relativeArtifactPath = relative(workspaceDirectory, artifactPath)
  if (!relativeArtifactPath || relativeArtifactPath.startsWith('..') || isAbsolute(relativeArtifactPath)) {
    throw new Error('Native visual smoke returned an artifact outside the workspace.')
  }
  const bytes = await readFile(artifactPath)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Native visual smoke persistence verification did not find a valid PNG.')
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== nativeVisual.artifactSha256) {
    throw new Error('Native visual smoke persistence verification found a digest mismatch.')
  }
}

async function startDeterministicVisualRouterStub() {
  const apiKey = 'electron-smoke-local-router'
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
      return
    }
    const body = await readBoundedRequestBody(request)
    if (body.includes('electron-domain-smoke:fail-visible')) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'deterministic visual route unavailable' } }))
      return
    }
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid json' } }))
      return
    }
    if (!JSON.stringify(payload).includes('"type":"input_image"')) {
      response.writeHead(422, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'visual input missing' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'The fixture target is visible and bounded.',
        claims: [{
          kind: 'observation',
          text: 'Colored fixture target',
          artifactId: 'source',
          region: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
          confidence: 1
        }],
        uncertainties: []
      })
    }))
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Deterministic visual router did not bind a TCP port.')
  }
  return {
    apiKey,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  }
}

async function readBoundedRequestBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > 4 * 1024 * 1024) throw new Error('Visual router smoke request exceeded 4 MiB.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function collectExecutableCandidates(root, { platform, productName }) {
  if (!await pathExists(root)) return []
  const candidates = []
  const normalizedProduct = normalizeExecutableName(productName)
  const visit = async (directory, depth) => {
    if (depth > 1) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (platform === 'darwin' && entry.name.endsWith('.app')) {
        const executable = join(path, 'Contents', 'MacOS', productName)
        if (await pathExists(executable)) candidates.push(executable)
        continue
      }
      if (platform !== 'darwin' && depth === 0 && /unpacked$/u.test(entry.name)) {
        for (const child of await readdir(path, { withFileTypes: true })) {
          if (!child.isFile()) continue
          const normalizedName = normalizeExecutableName(child.name)
          const expected = platform === 'win32' ? `${normalizedProduct}exe` : normalizedProduct
          if (normalizedName === expected) candidates.push(join(path, child.name))
        }
        continue
      }
      await visit(path, depth + 1)
    }
  }
  await visit(root, 0)
  return candidates.sort()
}

function normalizeExecutableName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

async function detectExecutableArchitectures(path, platform) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(4_096)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const bytes = header.subarray(0, bytesRead)
    if (platform === 'darwin') return detectMachOArchitectures(bytes)
    if (platform === 'win32') return detectPeArchitectures(bytes)
    if (platform === 'linux') return detectElfArchitectures(bytes)
    return new Set()
  } finally {
    await handle.close()
  }
}

function detectMachOArchitectures(bytes) {
  if (bytes.length < 8) return new Set()
  const magic = bytes.readUInt32BE(0)
  const thinEndian = magic === 0xfeedface || magic === 0xfeedfacf
    ? 'big'
    : magic === 0xcefaedfe || magic === 0xcffaedfe
      ? 'little'
      : null
  if (thinEndian) {
    const architecture = machOCpuArchitecture(readUInt32(bytes, 4, thinEndian))
    return new Set(architecture ? [architecture] : [])
  }

  const fatEndian = magic === 0xcafebabe || magic === 0xcafebabf
    ? 'big'
    : magic === 0xbebafeca || magic === 0xbfbafeca
      ? 'little'
      : null
  if (!fatEndian) return new Set()
  const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca
  const count = readUInt32(bytes, 4, fatEndian)
  const recordSize = fat64 ? 32 : 20
  const architectures = new Set()
  for (let index = 0; index < count && 8 + (index + 1) * recordSize <= bytes.length; index += 1) {
    const architecture = machOCpuArchitecture(readUInt32(bytes, 8 + index * recordSize, fatEndian))
    if (architecture) architectures.add(architecture)
  }
  return architectures
}

function detectPeArchitectures(bytes) {
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return new Set()
  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset + 6 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x00004550) return new Set()
  const architecture = new Map([
    [0x014c, 'ia32'],
    [0x8664, 'x64'],
    [0xaa64, 'arm64']
  ]).get(bytes.readUInt16LE(peOffset + 4))
  return new Set(architecture ? [architecture] : [])
}

function detectElfArchitectures(bytes) {
  if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return new Set()
  }
  const endian = bytes[5] === 1 ? 'little' : bytes[5] === 2 ? 'big' : null
  if (!endian) return new Set()
  const machine = endian === 'little' ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
  const architecture = new Map([
    [0x03, 'ia32'],
    [0x28, 'arm'],
    [0x3e, 'x64'],
    [0xb7, 'arm64']
  ]).get(machine)
  return new Set(architecture ? [architecture] : [])
}

function machOCpuArchitecture(cpuType) {
  return new Map([
    [0x00000007, 'ia32'],
    [0x01000007, 'x64'],
    [0x0000000c, 'arm'],
    [0x0100000c, 'arm64']
  ]).get(cpuType)
}

function readUInt32(bytes, offset, endian) {
  return endian === 'little' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)
}

async function assertExecutable(path, platform) {
  const resolved = resolve(path)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`Electron executable is not a file: ${resolved}`)
  await access(resolved, platform === 'win32' ? fsConstants.R_OK : fsConstants.R_OK | fsConstants.X_OK)
}

function collectProcessOutput(child) {
  let output = ''
  const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_000_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.__sciforgeSmokeOutput = () => output
  return {
    failures: () => PROCESS_FAILURE_PATTERNS
      .filter((pattern) => pattern.test(output))
      .map((pattern) => `Electron reported fatal lifecycle output matching ${pattern}.`)
  }
}

function collectBufferedOutput(child) {
  return child.__sciforgeSmokeOutput?.() ?? ''
}

async function loadPlaywrightElectron() {
  try {
    const playwright = await import('playwright-core')
    return playwright._electron
  } catch (error) {
    throw new Error(
      'Electron smoke requires the playwright-core development dependency. ' +
      'Install it without downloading browser binaries.',
      { cause: error }
    )
  }
}

async function closeElectron(electronApp) {
  if (!electronApp) return
  const child = electronApp.process()
  await Promise.race([
    electronApp.close().catch(() => undefined),
    delay(5_000)
  ])
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (await waitForExit(child, 3_000)) return
  child.kill('SIGKILL')
  await waitForExit(child, 2_000)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolvePromise(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolvePromise(true)
    }
    child.once('exit', onExit)
  })
}

export async function removeElectronSmokeTemporaryDirectory(
  path,
  runDirectory = process.env.SCIFORGE_E2E_RUN_DIRECTORY
) {
  const resolvedPath = resolve(path)
  const normalizedRunDirectory = typeof runDirectory === 'string' ? runDirectory.trim() : ''
  if (normalizedRunDirectory) {
    const supervisedPath = resolve(
      normalizedRunDirectory,
      'profiles/electron-domain-smoke'
    )
    if (resolvedPath !== supervisedPath) {
      throw new Error(
        `Electron smoke profile is outside the supervisor-owned directory: ${resolvedPath}`
      )
    }
    return
  }
  if (dirname(resolvedPath) !== resolve(tmpdir()) || !basename(resolvedPath).startsWith(TEMPORARY_DIRECTORY_PREFIX)) {
    throw new Error(`Refusing to remove unsafe Electron smoke directory: ${resolvedPath}`)
  }
  await rm(resolvedPath, electronSmokeRemoveOptions())
}

export function electronSmokeRemoveOptions(platform = process.platform) {
  return {
    recursive: true,
    force: true,
    ...(platform === 'win32' ? { maxRetries: 5, retryDelay: 100 } : {})
  }
}

function defaultReportCleanupError(error) {
  console.error(`[electron-domain-smoke cleanup] ${error instanceof Error ? error.message : String(error)}`)
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        typeof message === 'function' ? message() : message
      )), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function makeExecutableForTest(path) {
  await chmod(path, 0o755)
}
