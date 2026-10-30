/**
 * Workspace file read/write port types for the life-science-preview core.
 *
 * These ports replace the production domain backend's direct node:fs usage
 * (packages/domains/life-science-preview/src/backend/providers.ts:
 * readTextPrefix/readBinaryPrefix/readBinaryIfWithinLimit and the
 * exportSourceCopy write path). The core never touches node:fs; adapter
 * implementations (dsh-adapter/node-file-ports.ts for the real runtime,
 * tests/helpers for fakes) supply the governance semantics.
 *
 * Port semantics that matter for the plugin-shaped runtime:
 * - Read ports MUST resolve the candidate path and workspaceRoot (symlinks
 *   included) and reject any path that escapes workspaceRoot with
 *   LifeSciencePortError(code === 'path-escape'). In the trusted host process
 *   the host pre-validated WorkspacePreviewFileState; in a plugin child
 *   process this containment check is the core's only governance line
 *   (gap-1 workspace governance, lsp-interface-requirements-20261016.md).
 * - Oversize governance is stat-first: the core rejects files over the
 *   binary limit after stat() and before any read.
 */

/** Read limits carried over verbatim from the production domain backend. */
export const LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES = 2_000_000
export const LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES = 4 * 1024 * 1024

export type LifeSciencePortErrorCode =
  | 'path-escape'
  | 'not-found'
  | 'not-a-file'
  | 'io-error'

/**
 * Structured rejection raised by port implementations. The core maps these
 * onto WorkspacePreviewProvider*Result failure unions; they must never cross
 * the future host<->plugin channel as raw Error objects (the gap-1 channel
 * still owes a structured rejection code for workspace-governance denials;
 * today they map to 'worker-error' with the code in the message).
 */
export class LifeSciencePortError extends Error {
  readonly code: LifeSciencePortErrorCode

  constructor(code: LifeSciencePortErrorCode, message: string) {
    super(message)
    this.name = 'LifeSciencePortError'
    this.code = code
  }
}

export type WorkspaceFileInfo = Readonly<{
  size: number
  isFile: boolean
}>

export type WorkspaceBoundedRead = Readonly<{
  bytes: Uint8Array
  bytesRead: number
  truncated: boolean
}>

export type WorkspaceFileReadPorts = Readonly<{
  /**
   * stat() a workspace file. Implementations MUST resolve the candidate path
   * and workspaceRoot (symlinks included) and raise LifeSciencePortError
   * 'path-escape' when the file is not inside the workspace.
   */
  stat(input: Readonly<{ path: string; workspaceRoot: string }>): Promise<WorkspaceFileInfo>
  /**
   * Read at most maxBytes from the start of the file. The implementation
   * performs the same containment enforcement as stat().
   */
  readPrefix(
    input: Readonly<{ path: string; workspaceRoot: string; maxBytes: number }>
  ): Promise<WorkspaceBoundedRead>
}>

export type WorkspaceWriteTarget = Readonly<{
  path: string
  parentPath: string
  workspaceRoot: string
}>

/**
 * Write-side ports replacing the production backend's direct use of
 * @sciforge/domain-sdk/node/workspace-paths resolveSafeWorkspaceWriteTarget
 * + node:fs copyFile/constants.COPYFILE_EXCL. The real adapter delegates the
 * full symlink/ancestor validation to the domain-sdk implementation.
 */
export type WorkspaceFileWritePorts = Readonly<{
  /**
   * Resolve a workspace-relative (or absolute-but-inside) candidate into a
   * safe write target, optionally creating parent directories. MUST reject
   * escapes with LifeSciencePortError 'path-escape'.
   */
  resolveSafeWriteTarget(
    input: Readonly<{
      path: string
      workspaceRoot: string
      createParentDirectories: boolean
      targetKind: 'file' | 'directory'
    }>
  ): Promise<WorkspaceWriteTarget>
  /** copyFile with exclusive-create semantics (fail if the target exists). */
  copyExclusive(input: Readonly<{ sourcePath: string; targetPath: string }>): Promise<void>
  exists(path: string): Promise<boolean>
}>
