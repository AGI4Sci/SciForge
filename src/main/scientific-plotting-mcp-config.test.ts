import { describe, expect, it } from 'vitest'
import {
  SCIENTIFIC_PLOTTING_MCP_FLAG,
  SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
  buildScientificPlottingMcpArgs,
  buildScientificPlottingMcpConfigFragment,
  buildScientificPlottingMcpServerConfig,
  resolveScientificPlottingMcpCommand,
  resolveScientificPlottingMcpNodeEntryPath,
  type ScientificPlottingMcpLaunchConfig
} from './scientific-plotting-mcp-config'

const launch: ScientificPlottingMcpLaunchConfig = {
  appPath: '/Applications/DeepSeek GUI.app',
  execPath: '/Applications/DeepSeek GUI.app/Contents/MacOS/DeepSeek GUI',
  isPackaged: true
}

describe('scientific plotting MCP config', () => {
  it('uses the scientific plotting node entry and launch flag', () => {
    expect(resolveScientificPlottingMcpNodeEntryPath(launch)).toBe(
      '/Applications/DeepSeek GUI.app/out/main/scientific-plotting-mcp-node-entry.js'
    )
    expect(buildScientificPlottingMcpArgs(launch, '/tmp/workspace')).toEqual([
      resolveScientificPlottingMcpNodeEntryPath(launch),
      SCIENTIFIC_PLOTTING_MCP_FLAG,
      '--workspace-root',
      '/tmp/workspace'
    ])
  })

  it('uses the macOS Electron helper command like other first-party MCP servers', () => {
    expect(resolveScientificPlottingMcpCommand(launch, 'darwin')).toBe(
      '/Applications/DeepSeek GUI.app/Contents/Frameworks/DeepSeek GUI Helper.app/Contents/MacOS/DeepSeek GUI Helper'
    )
  })

  it('builds a workspace-scoped server fragment for plugin marketplace writes', () => {
    const server = buildScientificPlottingMcpServerConfig(launch, '/tmp/workspace')
    expect(server).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: resolveScientificPlottingMcpCommand(launch),
      args: [
        resolveScientificPlottingMcpNodeEntryPath(launch),
        SCIENTIFIC_PLOTTING_MCP_FLAG,
        '--workspace-root',
        '/tmp/workspace'
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/workspace'],
      timeoutMs: 60_000
    })

    expect(buildScientificPlottingMcpConfigFragment(launch, '/tmp/workspace')).toMatchObject({
      servers: {
        [SCIENTIFIC_PLOTTING_MCP_SERVER_NAME]: server
      }
    })
  })
})
