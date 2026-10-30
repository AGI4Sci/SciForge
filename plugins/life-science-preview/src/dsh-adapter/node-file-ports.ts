/**
 * node:fs implementation of the workspace file read/write ports — the
 * production-grade version of the spike's tests/helpers/node-ports.ts.
 *
 * Read side: realpath-based containment (symlinks resolved on both the root
 * and the candidate) raising LifeSciencePortError 'path-escape'/'not-found',
 * matching @sciforge/domain-sdk/node/workspace-paths governance semantics.
 *
 * Write side: the lexical escape check is enforced at the port boundary (so
 * path-escape is a structured port rejection, testable like the read side),
 * then the full symlink/ancestor validation and parent creation are delegated
 * to the domain-sdk resolveSafeWorkspaceWriteTarget implementation rather
 * than re-written here (spike README §3.5).
 */
import { constants } from 'node:fs'
import { copyFile, mkdir, open, realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import {
  resolveSafeWorkspaceWriteTarget
} from '@sciforge/domain-sdk/node/workspace-paths'
import {
  LifeSciencePortError,
  type WorkspaceFileReadPorts,
  type WorkspaceFileWritePorts
} from '../ports/index.js'

async function containedCandidate(
  workspaceRoot: string,
  path: string
): Promise<{ root: string; candidate: string }> {
  const root = await realpath(resolve(workspaceRoot))
  const resolved = resolve(root, path)
  let candidate: string
  try {
    candidate = await realpath(resolved)
  } catch (error) {
    if (isFsError(error) && error.code === 'ENOENT') {
      throw new LifeSciencePortError('not-found', `Workspace file not found: ${resolved}.`)
    }
    throw error
  }
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new LifeSciencePortError(
      'path-escape',
      `Path ${candidate} escapes workspace root ${root}.`
    )
  }
  return { root, candidate }
}

function isFsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export function createNodeFilePorts(): {
  read: WorkspaceFileReadPorts
  write: WorkspaceFileWritePorts
} {
  const read: WorkspaceFileReadPorts = {
    async stat(input) {
      const { candidate } = await containedCandidate(input.workspaceRoot, input.path)
      const info = await stat(candidate)
      return { size: info.size, isFile: info.isFile() }
    },
    async readPrefix(input) {
      const { candidate } = await containedCandidate(input.workspaceRoot, input.path)
      const handle = await open(candidate, 'r')
      try {
        const buffer = Buffer.alloc(Math.max(0, input.maxBytes))
        const { bytesRead } = await handle.read(buffer, 0, input.maxBytes, 0)
        const info = await handle.stat()
        return {
          bytes: new Uint8Array(buffer.subarray(0, bytesRead)),
          bytesRead,
          truncated: info.size > bytesRead
        }
      } finally {
        await handle.close()
      }
    }
  }

  const write: WorkspaceFileWritePorts = {
    async resolveSafeWriteTarget(input) {
      const root = resolve(input.workspaceRoot)
      const candidate = resolve(root, input.path)
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        throw new LifeSciencePortError(
          'path-escape',
          `Write target ${candidate} escapes workspace root ${root}.`
        )
      }
      if (input.createParentDirectories) {
        await mkdir(dirname(candidate), { recursive: true })
      }
      return resolveSafeWorkspaceWriteTarget(input.path, input.workspaceRoot, {
        createParentDirectories: input.createParentDirectories,
        targetKind: input.targetKind
      })
    },
    copyExclusive(input) {
      return copyFile(input.sourcePath, input.targetPath, constants.COPYFILE_EXCL)
    },
    async exists(path) {
      try {
        await stat(path)
        return true
      } catch (error) {
        if (isFsError(error) && error.code === 'ENOENT') return false
        throw error
      }
    }
  }

  return { read, write }
}
