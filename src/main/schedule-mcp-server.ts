import {
  createScheduleService,
  startScheduleMcpServer
} from '../../packages/workers/schedule/src'

export const GUI_SCHEDULE_MCP_LAUNCH_FLAG = '--gui-schedule-mcp-server'

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value?.trim() || undefined
}

export async function runScheduleMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_SCHEDULE_MCP_LAUNCH_FLAG)) {
    return false
  }

  await startScheduleMcpServer(createScheduleService({
    baseUrl: parseArgValue(argv, '--base-url') ?? 'http://127.0.0.1:8787',
    secret: parseArgValue(argv, '--secret')
  }))
  return true
}

/**
 * List of MCP tool names that used to act as the GUI plan bridge. The
 * names are kept here as a single source of truth for migration
 * scripts; the actual tools are no longer registered.
 */
export const RETIRED_GUI_PLAN_TOOL_NAMES: readonly string[] = ['gui_plan_create'] as const
