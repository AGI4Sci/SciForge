import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

/** Workspace-relative local reads, bounded on the opened handle. Recheck path and
 * file identity before returning bytes. This detects ordinary concurrent changes;
 * it is not an OS sandbox against a hostile process mutating ancestor directories. */
export async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  maxBytes: number
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid file size limit.')
  // Reject drive-relative paths, UNC/device paths and NTFS alternate streams on every OS.
  if (!relativePath || isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes(':')) {
    throw new Error('The path must be relative to the workspace.')
  }
  const root = await realpath(resolve(workspaceRoot))
  const requested = resolve(root, relativePath)
  const target = await realpath(requested).catch(() => {
    throw new Error('The file was not found in the workspace.')
  })
  const inside = relative(root, target)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('The file is outside the workspace.')
  }
  const before = await lstat(target)
  if (!before.isFile()) throw new Error('The path is not a regular file.')
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw new Error('The file changed while opening.')
    if (info.size > maxBytes) throw new Error(`The file is larger than ${maxBytes} bytes.`)
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
    }
    if (total > maxBytes) throw new Error(`The file is larger than ${maxBytes} bytes.`)
    const after = await handle.stat()
    const current = await lstat(target)
    if (await realpath(requested) !== target || await realpath(resolve(workspaceRoot)) !== root ||
        current.dev !== info.dev || current.ino !== info.ino ||
        after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || total !== info.size) {
      throw new Error('The file changed while reading; retry with a stable file.')
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}
