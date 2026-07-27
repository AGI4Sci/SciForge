import { getModelAccessSettings, type AppSettingsV1 } from '../shared/app-settings'
import { ensureModelRouterSidecar } from './model-router-sidecar'
import { ensurePlanGatewaySidecar } from './plan-gateway-sidecar'
import { stopModelAccessGatewaySidecar } from './model-access-gateway-sidecar'

let modelAccessSynchronizationQueue = Promise.resolve()

export async function synchronizeModelAccessSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    env?: NodeJS.ProcessEnv
    resolveProxy?: (url: string) => Promise<string>
    logModelRouter?: (message: string) => void
    logPlanGateway?: (message: string) => void
  }
): Promise<void> {
  const next = modelAccessSynchronizationQueue.then(
    () => synchronizeModelAccessSidecarNow(settings, options),
    () => synchronizeModelAccessSidecarNow(settings, options)
  )
  modelAccessSynchronizationQueue = next.catch(() => undefined)
  return next
}

async function synchronizeModelAccessSidecarNow(
  settings: AppSettingsV1,
  options: Parameters<typeof synchronizeModelAccessSidecar>[1]
): Promise<void> {
  const access = getModelAccessSettings(settings)
  if (access?.mode === 'coding-plan') {
    await ensurePlanGatewaySidecar(settings, {
      userDataDir: options.userDataDir,
      appRoot: options.appRoot,
      resourcesPath: options.resourcesPath,
      execPath: options.execPath,
      isPackaged: options.isPackaged,
      env: options.env,
      resolveProxy: options.resolveProxy,
      log: options.logPlanGateway
    })
    return
  }
  if (access?.mode === 'api') {
    await ensureModelRouterSidecar(settings, {
      userDataDir: options.userDataDir,
      appRoot: options.appRoot,
      resourcesPath: options.resourcesPath,
      execPath: options.execPath,
      isPackaged: options.isPackaged,
      env: options.env,
      log: options.logModelRouter
    })
    return
  }
  await stopModelAccessGatewaySidecar({
    userDataDir: options.userDataDir,
    log: options.logModelRouter
  })
  options.logModelRouter?.('Model access setup is required; no model service was started.')
}
