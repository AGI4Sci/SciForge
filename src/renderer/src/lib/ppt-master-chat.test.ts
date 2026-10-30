import { describe, expect, it, vi } from 'vitest'
import {
  PPT_MASTER_MCP_SERVER_ID,
  buildPptMasterMcpConfigFromExistingConfig,
  diagnosticsHasConnectedPptMaster,
  ensurePptMasterMcpForChat,
  isPptDeckRequest
} from './ppt-master-chat'

describe('ppt-master chat bootstrap', () => {
  it('detects explicit PPT deliverable requests without matching casual mentions', () => {
    expect(isPptDeckRequest('做一个ppt给我')).toBe(true)
    expect(isPptDeckRequest('把这份调研整理成 slides')).toBe(true)
    expect(isPptDeckRequest('这里的 PPT 工具为什么没出现')).toBe(false)
  })

  it('adds the ppt_master MCP server when a PPT request is sent', async () => {
    const writeConfig = vi.fn(async () => undefined)
    const result = await ensurePptMasterMcpForChat({
      text: '生成一个 PPT',
      workspaceRoot: '/tmp/workspace',
      readConfig: async () => ({ content: '{"servers":{"gui_schedule":{"command":"electron"}}}' }),
      writeConfig,
      buildConfig: async (workspaceRoot) => ({
        ok: true,
        config: {
          servers: {
            [PPT_MASTER_MCP_SERVER_ID]: {
              enabled: true,
              transport: 'stdio',
              command: 'npm',
              trustScope: 'workspace',
              trustedWorkspaceRoots: [workspaceRoot]
            }
          }
        }
      }),
      getToolDiagnostics: async () => ({
        mcpServers: [{ id: PPT_MASTER_MCP_SERVER_ID, status: 'connected' }]
      }),
      waitTimeoutMs: 1,
      pollIntervalMs: 1
    })

    expect(result).toEqual({ status: 'installed', runtimeConnected: true })
    expect(writeConfig).toHaveBeenCalledTimes(1)
    const writtenConfig = writeConfig.mock.calls.at(0)?.at(0)
    expect(typeof writtenConfig).toBe('string')
    expect(JSON.parse(String(writtenConfig)).servers).toHaveProperty(PPT_MASTER_MCP_SERVER_ID)
  })

  it('does not rewrite config when ppt_master is already connected', async () => {
    const writeConfig = vi.fn(async () => undefined)
    const result = await ensurePptMasterMcpForChat({
      text: '帮我做个 pptx',
      readConfig: async () => ({ content: '{"servers":{"ppt_master":{"command":"npm"}}}' }),
      writeConfig,
      buildConfig: async () => ({ ok: false, message: 'should not be called' }),
      getToolDiagnostics: async () => ({
        mcpServers: [{ id: PPT_MASTER_MCP_SERVER_ID, status: 'connected' }]
      })
    })

    expect(result).toEqual({ status: 'configured', runtimeConnected: true })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('refreshes ppt_master trusted roots for the active workspace', async () => {
    const writeConfig = vi.fn(async () => undefined)
    const result = await ensurePptMasterMcpForChat({
      text: '帮我做个 pptx',
      workspaceRoot: '/tmp/new-workspace',
      readConfig: async () => ({
        content: JSON.stringify({
          servers: {
            [PPT_MASTER_MCP_SERVER_ID]: {
              command: 'old-npm',
              trustScope: 'workspace',
              trustedWorkspaceRoots: ['/tmp/old-workspace']
            }
          }
        })
      }),
      writeConfig,
      buildConfig: async (workspaceRoot) => ({
        ok: true,
        config: {
          servers: {
            [PPT_MASTER_MCP_SERVER_ID]: {
              command: 'npm',
              trustScope: 'workspace',
              trustedWorkspaceRoots: [workspaceRoot]
            }
          }
        }
      }),
      getToolDiagnostics: async () => ({
        mcpServers: [{ id: PPT_MASTER_MCP_SERVER_ID, status: 'connected' }]
      }),
      waitTimeoutMs: 1,
      pollIntervalMs: 1
    })

    expect(result).toEqual({ status: 'configured', runtimeConnected: true })
    expect(writeConfig).toHaveBeenCalledTimes(1)
    const writtenConfig = JSON.parse(String(writeConfig.mock.calls.at(0)?.at(0))) as Record<string, any>
    expect(writtenConfig.servers.ppt_master.command).toBe('npm')
    expect(writtenConfig.servers.ppt_master.trustedWorkspaceRoots).toEqual([
      '/tmp/old-workspace',
      '/tmp/new-workspace'
    ])
  })

  it('falls back when the dev app bridge does not expose the ppt-master config channel', async () => {
    const writeConfig = vi.fn(async () => undefined)
    const result = await ensurePptMasterMcpForChat({
      text: '做一个ppt给我',
      workspaceRoot: '/tmp/workspace',
      readConfig: async () => ({
        content: JSON.stringify({
          servers: {
            gui_schedule: {
              command: '/Applications/Electron Helper',
              args: ['/repo/SciForge/out/main/schedule-mcp-node-entry.js']
            }
          }
        })
      }),
      writeConfig,
      buildConfig: async () => {
        throw new Error('Unknown app bridge channel: mcp:ppt-master-config')
      },
      getToolDiagnostics: async () => ({
        mcpServers: [{ id: PPT_MASTER_MCP_SERVER_ID, status: 'connected' }]
      }),
      waitTimeoutMs: 1,
      pollIntervalMs: 1
    })

    expect(result).toEqual({ status: 'installed', runtimeConnected: true })
    const writtenConfig = JSON.parse(String(writeConfig.mock.calls.at(0)?.at(0))) as Record<string, any>
    expect(writtenConfig.servers.ppt_master).toMatchObject({
      command: 'npm',
      args: ['--prefix', '/repo/SciForge', '--workspace', 'sciforge-ppt-master-mcp-service', 'run', 'start'],
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/workspace']
    })
  })

  it('recognizes connected ppt_master diagnostics', () => {
    expect(diagnosticsHasConnectedPptMaster({
      mcpServers: [{ id: 'other', status: 'connected' }]
    })).toBe(false)
    expect(diagnosticsHasConnectedPptMaster({
      mcpServers: [{ id: PPT_MASTER_MCP_SERVER_ID, status: 'connected' }]
    })).toBe(true)
  })

  it('builds a fallback ppt-master config from an existing dev MCP server path', () => {
    const fallback = buildPptMasterMcpConfigFromExistingConfig(
      '{"servers":{"gui_schedule":{"args":["/repo/App/out/main/schedule-mcp-node-entry.js"]}}}',
      '/workspace'
    )

    expect(fallback?.servers).toHaveProperty(PPT_MASTER_MCP_SERVER_ID)
  })
})
