import { isAbsolute, join } from 'node:path'

import { APP_PRODUCT_NAME } from '../shared/app-brand'

const DEVELOPMENT_WORKSPACE_ID_PATTERN = /^[a-f0-9]{16}$/u

export function resolveDevelopmentUserDataPath(input: Readonly<{
  isPackaged: boolean
  appDataPath: string
  workspaceId: string | undefined
  argv: readonly string[]
}>): string | undefined {
  if (input.isPackaged || hasExplicitUserDataDirectory(input.argv)) return undefined
  const workspaceId = input.workspaceId?.trim()
  if (!workspaceId || !DEVELOPMENT_WORKSPACE_ID_PATTERN.test(workspaceId)) return undefined
  if (!isAbsolute(input.appDataPath)) return undefined
  return join(input.appDataPath, `${APP_PRODUCT_NAME} Development`, workspaceId)
}

function hasExplicitUserDataDirectory(argv: readonly string[]): boolean {
  return argv.some((argument) =>
    argument === '--user-data-dir' || argument.startsWith('--user-data-dir='))
}
