import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { installedMainSourcePackageNames } from './modules/installed-main-source-packages'

describe('DSH production workspace delivery', () => {
  it('is a real root workspace dependency in lockfile and generated main bundle closure', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
    expect(pkg.workspaces).toContain('packages/workers/dsh-runtime')
    expect(pkg.dependencies['@sciforge/dsh-runtime']).toBe('0.1.0')
    expect(lock.packages[''].dependencies['@sciforge/dsh-runtime']).toBe('0.1.0')
    expect(lock.packages['node_modules/@sciforge/dsh-runtime']).toEqual({ resolved: 'packages/workers/dsh-runtime', link: true })
    expect(lock.packages['packages/workers/dsh-runtime'].dependencies).toEqual({ 'js-yaml': '4.3.0' })
    expect(installedMainSourcePackageNames).toContain('@sciforge/dsh-runtime')
    const packaging = readFileSync(new URL('../../electron-builder.config.cjs', import.meta.url), 'utf8')
    expect(packaging).toContain("from: 'packages/workers/dsh-runtime/artifacts'")
    expect(packaging).toContain("to: 'agent-runtimes/dsh'")
  })
})
