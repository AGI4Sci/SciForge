import { runComputerUseMcpServerFromArgv } from './main/mcp-server.js'

/** Standard package-owned runner consumed by generated domain composition. */
export async function runDomainRuntimeMcpServerFromArgv(argv: string[]): Promise<void> {
  const handled = await runComputerUseMcpServerFromArgv(argv)
  if (!handled) {
    throw new Error('Computer Use runtime MCP launch flag is missing.')
  }
}
