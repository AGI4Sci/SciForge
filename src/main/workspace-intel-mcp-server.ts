import {
  createWorkspaceIntelService,
  workspaceIntelConfigFromEnv,
  type WorkspaceIntelServiceOptions
} from '../../packages/workers/workspace-intel/src/service'
import { startWorkspaceIntelMcpServer } from '../../packages/workers/workspace-intel/src/mcp-server'

export const GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG = '--gui-workspace-intel-mcp-server'

export async function runWorkspaceIntelMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG)) return false
  await startWorkspaceIntelMcpServer(createWorkspaceIntelService(workspaceIntelOptionsFromArgv(argv)))
  return true
}

function workspaceIntelOptionsFromArgv(argv: string[]): WorkspaceIntelServiceOptions {
  const options = workspaceIntelConfigFromEnv()
  const workspaceRoot = argValue(argv, '--workspace-root')
  if (workspaceRoot) options.workspaceRoot = workspaceRoot
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
