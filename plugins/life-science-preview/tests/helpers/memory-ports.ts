/**
 * In-memory port fakes for driving the plugin core without touching disk.
 * `createRealDataPorts` fills the data ports with the REAL workspace-*
 * services (the "pure packages ride with the plugin" case); file-port
 * behavior is asserted through the recorded call log.
 */
import { dirname, resolve, sep } from 'node:path'
import {
  LifeSciencePortError,
  type LifeScienceDataPorts,
  type LifeSciencePorts,
  type WorkspaceFileReadPorts,
  type WorkspaceFileWritePorts
} from '../../src/ports/index.js'
import { createRealDataPorts } from '../../src/dsh-adapter/data-services.js'

export { createRealDataPorts }

export function makePorts(files: Record<string, string | Uint8Array>, workspaceRoot: string): {
  ports: LifeSciencePorts
  memory: MemoryFilePorts
} {
  const memory = createMemoryFilePorts({ workspaceRoot, files })
  return { ports: { files: memory.read, writes: memory.write, data: createRealDataPorts() }, memory }
}

export type MemoryFilePorts = Readonly<{
  read: WorkspaceFileReadPorts
  write: WorkspaceFileWritePorts
  calls: string[]
  /** Resolve a workspace-relative path the same way the ports do (for assertions). */
  resolveInWorkspace(path: string): string
}>

/**
 * Containment-enforcing in-memory file ports. `files` keys are workspace-
 * relative or absolute paths inside the workspace; everything outside the
 * workspace root is rejected with LifeSciencePortError 'path-escape'.
 */
export function createMemoryFilePorts(options: {
  workspaceRoot: string
  files?: Record<string, string | Uint8Array>
}): MemoryFilePorts {
  const calls: string[] = []
  const root = resolve(options.workspaceRoot)
  const files = new Map<string, Uint8Array>()
  const toBytes = (value: string | Uint8Array) =>
    typeof value === 'string' ? new TextEncoder().encode(value) : value
  for (const [path, contents] of Object.entries(options.files ?? {})) {
    files.set(resolveContained(root, path), toBytes(contents))
  }

  function resolveContained(workspaceRoot: string, path: string): string {
    const resolvedRoot = resolve(workspaceRoot)
    const candidate = resolve(resolvedRoot, path)
    if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + sep)) {
      throw new LifeSciencePortError(
        'path-escape',
        `Path ${candidate} escapes workspace root ${resolvedRoot}.`
      )
    }
    return candidate
  }

  function resolveExisting(workspaceRoot: string, path: string): string {
    const candidate = resolveContained(workspaceRoot, path)
    if (!files.has(candidate)) {
      throw new LifeSciencePortError('not-found', `Workspace file not found: ${candidate}.`)
    }
    return candidate
  }

  const read: WorkspaceFileReadPorts = {
    stat(input) {
      calls.push(`stat:${input.path}`)
      const candidate = resolveExisting(input.workspaceRoot, input.path)
      return Promise.resolve({ size: files.get(candidate)!.length, isFile: true })
    },
    readPrefix(input) {
      calls.push(`readPrefix:${input.path}:${input.maxBytes}`)
      const candidate = resolveExisting(input.workspaceRoot, input.path)
      const bytes = files.get(candidate)!
      const length = Math.min(bytes.length, input.maxBytes)
      return Promise.resolve({
        bytes: bytes.slice(0, length),
        bytesRead: length,
        truncated: bytes.length > length
      })
    }
  }

  const write: WorkspaceFileWritePorts = {
    resolveSafeWriteTarget(input) {
      calls.push(`resolveSafeWriteTarget:${input.path}`)
      const candidate = resolveContained(input.workspaceRoot, input.path)
      return Promise.resolve({
        path: candidate,
        parentPath: dirname(candidate),
        workspaceRoot: resolve(input.workspaceRoot)
      })
    },
    copyExclusive(input) {
      calls.push(`copyExclusive:${input.sourcePath}->${input.targetPath}`)
      const source = files.get(resolve(input.sourcePath))
      if (source === undefined) {
        return Promise.reject(new LifeSciencePortError('not-found', `Source not found: ${input.sourcePath}.`))
      }
      const target = resolve(input.targetPath)
      if (files.has(target)) {
        return Promise.reject(new LifeSciencePortError('io-error', `Target already exists: ${target}.`))
      }
      files.set(target, source)
      return Promise.resolve()
    },
    exists(path) {
      calls.push(`exists:${path}`)
      return Promise.resolve(files.has(resolve(path)))
    }
  }

  return {
    read,
    write,
    calls,
    resolveInWorkspace: (path) => resolveContained(root, path)
  }
}
