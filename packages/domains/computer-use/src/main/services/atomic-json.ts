import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const target = resolve(path)
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const parentStat = await lstat(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Computer Use status cache parent must be a real directory.')
  }
  await rejectSymbolicLink(target)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await rejectSymbolicLink(target)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error('Computer Use status cache cannot be a symbolic link.')
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return
    throw error
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}
