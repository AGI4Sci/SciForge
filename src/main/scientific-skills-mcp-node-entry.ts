import { runScientificSkillsMcpServerFromArgv } from './scientific-skills-mcp-server'

void runScientificSkillsMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[scientific-skills-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[scientific-skills-mcp] server failed:', error)
    process.exit(1)
  })
