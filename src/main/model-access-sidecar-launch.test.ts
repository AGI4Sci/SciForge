import { describe, expect, it } from 'vitest'
import { resolveModelAccessSidecarProcessLaunch } from './model-access-sidecar-launch'

describe('model access sidecar process launch', () => {
  it.each([
    ['model-router', '@sciforge/model-router'],
    ['plan-gateway', '@sciforge/plan-gateway']
  ] as const)('uses the workspace script for %s in development', (worker, workspace) => {
    expect(resolveModelAccessSidecarProcessLaunch(worker, ['--quiet'], {
      appRoot: '/repo/sciforge',
      npmCommand: 'npm',
      env: { KEEP: 'yes' }
    })).toEqual({
      command: 'npm',
      args: ['--workspace', workspace, 'run', 'start', '--', '--quiet'],
      cwd: '/repo/sciforge',
      env: { KEEP: 'yes' }
    })
  })

  it.each([
    ['model-router', 'model-router-sidecar-node-entry.js'],
    ['plan-gateway', 'plan-gateway-sidecar-node-entry.js']
  ] as const)('uses the packaged Electron Node entry for %s without npm', (worker, entry) => {
    const launch = resolveModelAccessSidecarProcessLaunch(worker, ['--quiet'], {
      resourcesPath: '/Applications/SciForge.app/Contents/Resources',
      execPath: '/opt/SciForge',
      isPackaged: true,
      npmCommand: 'must-not-be-used',
      env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '0' }
    })

    expect(launch.command).toBe('/opt/SciForge')
    expect(launch.command).not.toContain('npm')
    expect(launch.cwd).toBe(
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked'
    )
    expect(launch.args).toEqual([
      `/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/${entry}`,
      '--quiet'
    ])
    expect(launch.env).toEqual({ KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' })
  })
})
