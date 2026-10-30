import { describe, expect, it } from 'vitest'
import {
  BGC_DISCOVERY_MCP_FLAG,
  BGC_DISCOVERY_TOOL_SIDE_EFFECTS
} from '../../packages/workers/bgc-discovery/src/contract'
import {
  bgcDiscoveryMcpEnabledTools,
  buildBgcDiscoveryMcpConfigFragment,
  resolveBgcDiscoveryMcpCommand,
  type BgcDiscoveryMcpLaunchConfig
} from './bgc-discovery-mcp-config'

const launch: BgcDiscoveryMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('BGC discovery MCP config', () => {
  it('builds a workspace-trusted marketplace fragment', () => {
    const fragment = buildBgcDiscoveryMcpConfigFragment(launch, '/tmp/workspace')
    expect(fragment).toMatchObject({
      servers: {
        bgc_discovery: {
          enabled: true,
          transport: 'stdio',
          command: resolveBgcDiscoveryMcpCommand(launch),
          args: [
            '/Applications/SciForge.app/out/main/bgc-discovery-mcp-node-entry.js',
            BGC_DISCOVERY_MCP_FLAG,
            '--workspace-root',
            '/tmp/workspace'
          ],
          trustScope: 'workspace',
          trustedWorkspaceRoots: ['/tmp/workspace']
        }
      }
    })
  })

  it('derives enabled tools from the worker contract', () => {
    expect(bgcDiscoveryMcpEnabledTools()).toEqual(Object.keys(BGC_DISCOVERY_TOOL_SIDE_EFFECTS))
  })
})
