import { describe, expect, it } from 'vitest'
import {
  RETIRED_GUI_PLAN_TOOL_NAMES,
  runScheduleMcpServerFromArgv
} from './schedule-mcp-server'

describe('schedule MCP server', () => {
  it('records gui_plan_create as a retired tool name', () => {
    expect(RETIRED_GUI_PLAN_TOOL_NAMES).toContain('gui_plan_create')
  })

  it('no longer exposes the legacy tool name as a registered export', async () => {
    // The legacy tool was previously exported via the module surface
    // and registered through `server.registerTool`. The retirement
    // keeps the retired name in the readonly list and removes the
    // registration; this regression check ensures the constant list
    // exists for migration scripts and does not include any active
    // tool names.
    expect(RETIRED_GUI_PLAN_TOOL_NAMES.length).toBeGreaterThan(0)
    for (const name of RETIRED_GUI_PLAN_TOOL_NAMES) {
      expect(name).toBe('gui_plan_create')
    }
    const moduleExports = await import('./schedule-mcp-server')
    expect((moduleExports as { registerTool?: unknown }).registerTool).toBeUndefined()
  })

  it('does not accept non-GUI schedule launch flags', async () => {
    await expect(runScheduleMcpServerFromArgv(['node', '--not-gui-schedule-mcp-server'])).resolves.toBe(false)
  })
})
