/**
 * Builds Node `--permission` execArgv flags for a plugin/extension host process.
 *
 * Ported from `eval-cases/spike-plugin-permissions/driver/build-permission-flags.mjs`,
 * where this exact function was verified against a real Node v22.23.2 runtime
 * (P0-P7 of `汇报_权限治理spike.md`, 8/8 passed).
 *
 * Two non-obvious things this function exists to get right (both discovered the
 * hard way during the spike, both undocumented by Node as of v22.23.2):
 *
 * 1. Node's `--allow-fs-read`/`--allow-fs-write` do NOT accept a comma-joined list
 *    of paths in one flag (`--allow-fs-read=a,b,c`). Doing so silently grants access
 *    to only the first path — no error, no warning. Each path needs its own flag.
 * 2. The entry script's own path must be included in the read allow-list, or Node
 *    refuses to load its own entry module ("Access to this API has been restricted").
 *    Callers of this function are responsible for including the entry script path
 *    in `read` — this function does not know which path is the entry script.
 */

export type BuildPermissionFlagsInput = Readonly<{
  read?: readonly string[]
  write?: readonly string[]
}>

export function buildPermissionFlags(
  { read = [], write = [] }: BuildPermissionFlagsInput = {}
): string[] {
  if (read.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new Error('buildPermissionFlags: every read path must be a non-empty string')
  }
  if (write.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new Error('buildPermissionFlags: every write path must be a non-empty string')
  }
  return [
    '--permission',
    ...read.map((path) => `--allow-fs-read=${path}`),
    ...write.map((path) => `--allow-fs-write=${path}`)
  ]
}
