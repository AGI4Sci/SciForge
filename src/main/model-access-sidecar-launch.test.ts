import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveModelAccessSidecarProcessLaunch } from './model-access-sidecar-launch'

describe('model access sidecar process launch', () => {
  it.each([
    ['model-router', 'out/main/model-router-sidecar-node-entry.js'],
    ['plan-gateway', 'out/main/plan-gateway-sidecar-node-entry.js']
  ] as const)('uses the built Node entry for %s in development', (worker, nodeEntry) => {
    expect(resolveModelAccessSidecarProcessLaunch(worker, ['--quiet'], {
      appRoot: '/repo/sciforge',
      execPath: '/opt/electron',
      env: { KEEP: 'yes' }
    })).toEqual({
      command: '/opt/electron',
      args: ['--env-file-if-exists=.env', join('/repo/sciforge', nodeEntry), '--quiet'],
      cwd: '/repo/sciforge',
      env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' }
    })
  })

  it.each([
    ['model-router', 'out/main/model-router-sidecar-node-entry.js'],
    ['plan-gateway', 'out/main/plan-gateway-sidecar-node-entry.js']
  ] as const)('uses the built Node entry for %s in development when a Node executable is provided', (worker, nodeEntry) => {
    const launch = resolveModelAccessSidecarProcessLaunch(worker, ['--quiet'], {
      appRoot: '/repo/sciforge',
      nodeExecPath: '/tools/node.exe',
      env: { KEEP: 'yes' }
    })

    expect(launch).toEqual({
      command: '/tools/node.exe',
      args: ['--env-file-if-exists=.env', join('/repo/sciforge', nodeEntry), '--quiet'],
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
      env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '0' }
    })

    expect(launch.command).toBe('/opt/SciForge')
    expect(launch.command).not.toContain('npm')
    expect(launch.cwd).toBe(
      join('/Applications/SciForge.app/Contents/Resources', 'app.asar.unpacked')
    )
    expect(launch.args).toEqual([
      join('/Applications/SciForge.app/Contents/Resources', 'app.asar.unpacked/out/main', entry),
      '--quiet'
    ])
    expect(launch.env).toEqual({ KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' })
  })
})
