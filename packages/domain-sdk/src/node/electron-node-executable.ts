import { posix } from 'node:path'

/**
 * Resolves the executable that can run Electron with ELECTRON_RUN_AS_NODE.
 *
 * Packaged macOS applications must use the bundled Helper executable. Windows
 * and Linux can use Electron's application executable directly.
 */
export function resolveElectronRunAsNodeExecutable(
  execPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'darwin') return execPath
  if (!execPath.includes('/Contents/MacOS/')) return execPath

  const appContentsDir = posix.dirname(posix.dirname(execPath))
  const appName = posix.basename(execPath)
  const helperName = `${appName} Helper`
  return posix.join(
    appContentsDir,
    'Frameworks',
    `${helperName}.app`,
    'Contents',
    'MacOS',
    helperName
  )
}
