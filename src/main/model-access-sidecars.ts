import { getModelAccessSettings, type AppSettingsV1 } from '../shared/app-settings'
import { ensureModelRouterSidecar, stopModelRouterSidecar } from './model-router-sidecar'
import { ensurePlanGatewaySidecar, stopPlanGatewaySidecar } from './plan-gateway-sidecar'

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
  const access = getModelAccessSettings(settings)
  if (access?.mode === 'coding-plan') {
    await stopModelRouterSidecar()
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
  await stopPlanGatewaySidecar({
    userDataDir: options.userDataDir,
    log: options.logPlanGateway
  })
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
  await stopModelRouterSidecar()
  options.logModelRouter?.('Model access setup is required; no model service was started.')
}
