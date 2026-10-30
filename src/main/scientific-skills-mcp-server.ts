import { runScientificSkillsMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../packages/workers/scientific-plotting/src/scientific-skills-mcp-server'
import { SCIENTIFIC_SKILLS_MCP_FLAG } from '../../packages/workers/scientific-plotting/src/contract'

export const GUI_SCIENTIFIC_SKILLS_MCP_LAUNCH_FLAG = SCIENTIFIC_SKILLS_MCP_FLAG

export async function runScientificSkillsMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
