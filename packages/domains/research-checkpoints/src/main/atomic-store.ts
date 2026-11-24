import filesystem, { chmod, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directoryPath = dirname(path)
  await mkdir(directoryPath, { recursive: true, mode: 0o700 })
  await chmod(directoryPath, 0o700)
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    // The owner serializes checkpoint writes. Retry only replacement of the
    // same fsynced file when a transient share lock refuses the atomic rename;
    // never unlink the current store or reconstruct the payload from live files.
    const delays = [25, 75, 150]
    for (let attempt = 0; ; attempt++) {
      try { await filesystem.rename(temporary, path); break }
      catch (error) {
        if (attempt >= delays.length || !isNodeError(error) || !['EPERM', 'EBUSY'].includes(error.code ?? '')) throw error
        await new Promise<void>(resolve => setTimeout(resolve, delays[attempt]))
      }
    }
    await chmod(path, 0o600)
    const directory = await open(directoryPath, 'r')
    try {
      try {
        await directory.sync()
      } catch (error) {
        if (!isUnsupportedDirectorySync(error)) throw error
      }
    } finally {
      await directory.close()
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return isNodeError(error) && (
    ['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code ?? '') ||
    (process.platform === 'win32' && error.code === 'EPERM')
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
