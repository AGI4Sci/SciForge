import { runScientificSkillsMcpServerFromArgv } from './scientific-skills-mcp-server.js'
import { runScientificPlottingMcpServerFromArgv } from './scientific-plotting-mcp-server.js'

const handled = await runScientificSkillsMcpServerFromArgv(process.argv)
  || await runScientificPlottingMcpServerFromArgv(process.argv)

if (!handled) {
  console.error('[scientific-plotting] missing MCP launch flag')
  process.exit(1)
}
