type ElectronPermissionsApi = Pick<
  typeof import('electron'),
  'desktopCapturer' | 'shell' | 'systemPreferences'
>

async function loadElectronPermissionsApi(): Promise<ElectronPermissionsApi> {
  return await import('electron')
}
export const MACOS_SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export type ComputerUsePermissionState = 'granted' | 'denied' | 'unknown'

export type ComputerUsePermissions = {
  platform: NodeJS.Platform
  supported: boolean
  needsPermission: boolean
  accessibility: ComputerUsePermissionState
  screenRecording: ComputerUsePermissionState
  accessibilityNeedsRestart: boolean
}

type MacPermissions = {
  getAuthStatus(type: 'accessibility' | 'screen'): string
  askForAccessibilityAccess(): unknown
  askForScreenCaptureAccess(openPreferences?: boolean): unknown
}

let macPermissionsLoaded = false
let macPermissions: MacPermissions | null = null

async function loadMacPermissions(): Promise<MacPermissions | null> {
  if (!macPermissionsLoaded) {
    macPermissionsLoaded = true
    try {
      const specifier = '@computer-use/node-mac-permissions'
      const ns = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
      macPermissions = ((ns as { default?: unknown }).default ?? ns) as MacPermissions
    } catch {
      macPermissions = null
    }
  }
  return macPermissions
}

function normalizeState(status: string | undefined): ComputerUsePermissionState {
  if (status === 'authorized' || status === 'granted') return 'granted'
  if (status === 'not determined' || status === 'not-determined' || status === undefined) return 'unknown'
  return 'denied'
}

export async function getComputerUsePermissions(): Promise<ComputerUsePermissions> {
  const platform = process.platform
  if (platform !== 'darwin') {
    return {
      platform,
      supported: true,
      needsPermission: false,
      accessibility: 'granted',
      screenRecording: 'granted',
      accessibilityNeedsRestart: false
    }
  }

  let liveTrust = false
  try {
    const { systemPreferences } = await loadElectronPermissionsApi()
    liveTrust = systemPreferences.isTrustedAccessibilityClient(false)
  } catch {
    liveTrust = false
  }

  let accessibilityGrantedInSettings = false
  try {
    const native = await loadMacPermissions()
    accessibilityGrantedInSettings = native?.getAuthStatus('accessibility') === 'authorized'
  } catch {
    accessibilityGrantedInSettings = false
  }

  let screenRecording: ComputerUsePermissionState = 'unknown'
  try {
    const { systemPreferences } = await loadElectronPermissionsApi()
    screenRecording = normalizeState(systemPreferences.getMediaAccessStatus('screen'))
  } catch {
    screenRecording = 'unknown'
  }

  return {
    platform,
    supported: true,
    needsPermission: true,
    accessibility: liveTrust ? 'granted' : 'denied',
    screenRecording,
    accessibilityNeedsRestart: !liveTrust && accessibilityGrantedInSettings
  }
}

export async function requestComputerUsePermission(
  kind: 'accessibility' | 'screenRecording'
): Promise<ComputerUsePermissions> {
  if (process.platform !== 'darwin') return getComputerUsePermissions()
  const native = await loadMacPermissions()
  try {
    const { desktopCapturer, systemPreferences } = await loadElectronPermissionsApi()
    if (kind === 'accessibility') {
      if (native?.askForAccessibilityAccess) {
        native.askForAccessibilityAccess()
      } else {
        systemPreferences.isTrustedAccessibilityClient(true)
      }
    } else {
      if (native?.askForScreenCaptureAccess) {
        native.askForScreenCaptureAccess(true)
      } else {
        try {
          await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1, height: 1 }
          })
        } catch {
          // Best effort enrollment only.
        }
      }
      await openSystemSettingsPane(MACOS_SCREEN_RECORDING_SETTINGS_URL)
    }
  } catch {
    // Permission prompts are best-effort; return the refreshed state below.
  }
  return getComputerUsePermissions()
}

export async function openSystemSettingsPane(url: string): Promise<void> {
  if (url !== MACOS_SCREEN_RECORDING_SETTINGS_URL) {
    throw new Error('Unsupported system settings URL.')
  }
  const { shell } = await loadElectronPermissionsApi()
  await shell.openExternal(url)
}
