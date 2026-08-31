import { chmod, mkdir } from 'node:fs/promises'

type PrivateWorkspaceRootOptions = Readonly<{
  platform?: NodeJS.Platform
  mkdir?: typeof mkdir
  chmod?: typeof chmod
}>

export async function ensurePrivateWorkspaceRoot(
  workspaceRoot: string,
  options: PrivateWorkspaceRootOptions = {}
): Promise<void> {
  const makeDirectory = options.mkdir ?? mkdir
  await makeDirectory(workspaceRoot, { recursive: true, mode: 0o700 })

  if ((options.platform ?? process.platform) !== 'win32') {
    const setMode = options.chmod ?? chmod
    await setMode(workspaceRoot, 0o700)
  }
}
