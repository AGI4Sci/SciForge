import { stat, symlink as fsSymlink } from 'node:fs/promises'

/** Exercise directory escapes with real Windows reparse points without an
 * administrator token. File symlinks still require OS permission: propagate
 * that failure rather than silently skipping the security assertion. */
export async function symlink(target: string, path: string, type?: 'dir' | 'file' | 'junction'): Promise<void> {
  const directory = type === 'dir' || (await stat(target).catch(() => undefined))?.isDirectory()
  await fsSymlink(target, path, process.platform === 'win32' && directory ? 'junction' : type)
}
