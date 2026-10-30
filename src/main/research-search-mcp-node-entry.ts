import { runResearchSearchMcpServerFromArgv } from './research-search-mcp-server'

void runResearchSearchMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[research-search-mcp] missing --gui-research-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[research-search-mcp] server failed:', error)
    process.exit(1)
  })
