import {
  createWorkspaceIntelService,
  workspaceIntelConfigFromEnv,
  type WorkspaceIntelService,
  type WorkspaceIntelServiceOptions
} from '../../packages/workers/workspace-intel/src/service'
import { createWorkspaceIntelMcpServer } from '../../packages/workers/workspace-intel/src/mcp-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  registerBiologyRoomMcpTools,
  type BiologyRoomMcpService
} from './biology-room-mcp-tools'
import { BiologyRoomService } from './services/biology-room-service'

export const GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG = '--gui-workspace-intel-mcp-server'

export async function runWorkspaceIntelMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG)) return false
  const options = workspaceIntelOptionsFromArgv(argv)
  const server = createGuiWorkspaceIntelMcpServer(options)
  await server.connect(new StdioServerTransport())
  return true
}

export function createGuiWorkspaceIntelMcpServer(
  options: WorkspaceIntelServiceOptions = {},
  workspaceService: WorkspaceIntelService = createWorkspaceIntelService(options),
  biologyRoomService: BiologyRoomMcpService = new BiologyRoomService()
) {
  const server = createWorkspaceIntelMcpServer(workspaceService)
  registerBiologyRoomMcpTools(server, biologyRoomService, {
    visibleContextPath: options.visibleContextPath
  })
  return server
}

function workspaceIntelOptionsFromArgv(argv: string[]): WorkspaceIntelServiceOptions {
  const options = workspaceIntelConfigFromEnv()
  const workspaceRoot = argValue(argv, '--workspace-root')
  const visibleContextPath = argValue(argv, '--visible-context-path')
  if (workspaceRoot) options.workspaceRoot = workspaceRoot
  if (visibleContextPath) options.visibleContextPath = visibleContextPath
  for (const skillRoot of argValues(argv, '--skill-root')) {
    options.skillRoots = [...(options.skillRoots ?? []), skillRoot]
  }
  if (argv.includes('--include-global-skills')) {
    options.includeGlobalSkillRoots = true
  }
  return options
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

function argValues(argv: string[], flag: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1])
      index += 1
    }
  }
  return values
}
