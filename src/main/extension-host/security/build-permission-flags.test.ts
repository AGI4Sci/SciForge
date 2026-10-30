import { describe, expect, it } from 'vitest'
import { buildPermissionFlags } from './build-permission-flags'

// Regression coverage for the two Node v22.23.2 behaviors this function exists
// to get right (both discovered and fixed against a real `node --permission`
// process during `eval-cases/spike-plugin-permissions/`, then ported here
// unchanged). Because this repo's vitest cannot execute in every development
// environment (see `eval-cases/plugin-runtime-isolation-impl/`'s note on
// native esbuild/rollup binaries), these same assertions were also re-run
// directly with plain `node` against this exact file — see that folder's
// `run-smoke-test.ts` output for the end-to-end version, and the "verified"
// note in this file's git history/PR description for the direct one.

describe('buildPermissionFlags', () => {
  it('emits one --allow-fs-read flag per path, never comma-joined', () => {
    const flags = buildPermissionFlags({ read: ['/a', '/b', '/c'] })
    expect(flags).toContain('--allow-fs-read=/a')
    expect(flags).toContain('--allow-fs-read=/b')
    expect(flags).toContain('--allow-fs-read=/c')
    expect(flags.some((flag) => flag.includes(','))).toBe(false)
  })

  it('emits one --allow-fs-write flag per path', () => {
    const flags = buildPermissionFlags({ write: ['/x', '/y'] })
    expect(flags).toContain('--allow-fs-write=/x')
    expect(flags).toContain('--allow-fs-write=/y')
  })

  it('always leads with --permission', () => {
    expect(buildPermissionFlags()[0]).toBe('--permission')
  })

  it('defaults to no read/write flags beyond --permission', () => {
    expect(buildPermissionFlags()).toEqual(['--permission'])
  })

  it('rejects an empty-string path', () => {
    expect(() => buildPermissionFlags({ read: [''] })).toThrow()
    expect(() => buildPermissionFlags({ write: [''] })).toThrow()
  })
})
