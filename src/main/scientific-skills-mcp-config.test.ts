import { describe, expect, it } from 'vitest'
import {
  SCIENTIFIC_SKILLS_MCP_FLAG,
  SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
  buildScientificSkillsMcpArgs,
  buildScientificSkillsMcpConfigFragment,
  buildScientificSkillsMcpServerConfig,
  resolveScientificSkillsMcpCommand,
  resolveScientificSkillsMcpNodeEntryPath,
  type ScientificSkillsMcpLaunchConfig
} from './scientific-skills-mcp-config'

const launch: ScientificSkillsMcpLaunchConfig = {
  appPath: '/Applications/DeepSeek GUI.app',
  execPath: '/Applications/DeepSeek GUI.app/Contents/MacOS/DeepSeek GUI',
  isPackaged: true
}

describe('scientific skills MCP config', () => {
  it('uses the scientific skills node entry and launch flag', () => {
    expect(resolveScientificSkillsMcpNodeEntryPath(launch)).toBe(
      '/Applications/DeepSeek GUI.app/out/main/scientific-skills-mcp-node-entry.js'
    )
    expect(buildScientificSkillsMcpArgs(launch, '/tmp/workspace')).toEqual([
      resolveScientificSkillsMcpNodeEntryPath(launch),
      SCIENTIFIC_SKILLS_MCP_FLAG,
      '--workspace-root',
      '/tmp/workspace'
    ])
  })

  it('uses the macOS Electron helper command just like first-party schedule MCP', () => {
    expect(resolveScientificSkillsMcpCommand(launch, 'darwin')).toBe(
      '/Applications/DeepSeek GUI.app/Contents/Frameworks/DeepSeek GUI Helper.app/Contents/MacOS/DeepSeek GUI Helper'
    )
  })

  it('builds a workspace-scoped server fragment for plugin marketplace writes', () => {
    const server = buildScientificSkillsMcpServerConfig(launch, '/tmp/workspace')
    expect(server).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: resolveScientificSkillsMcpCommand(launch),
      args: [
        resolveScientificSkillsMcpNodeEntryPath(launch),
        SCIENTIFIC_SKILLS_MCP_FLAG,
        '--workspace-root',
        '/tmp/workspace'
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/workspace'],
      timeoutMs: 30_000
    })

    expect(buildScientificSkillsMcpConfigFragment(launch, '/tmp/workspace')).toMatchObject({
      servers: {
        [SCIENTIFIC_SKILLS_MCP_SERVER_NAME]: server
      }
    })
  })
})
