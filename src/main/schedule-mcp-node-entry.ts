import { runScheduleMcpServerFromArgv } from './schedule-mcp-server'

void runScheduleMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[schedule-mcp] missing --gui-schedule-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[schedule-mcp] server failed:', error)
    process.exit(1)
  })
