import { runPptMasterMcpServerFromArgv } from './server.js'

const handled = await runPptMasterMcpServerFromArgv(process.argv)
if (!handled) {
  console.error('[ppt-master-mcp] missing --ppt-master-mcp-server launch flag')
  process.exit(1)
}
