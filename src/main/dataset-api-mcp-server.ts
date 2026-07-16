import { runDatasetApiMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../packages/workers/dataset-api/src/mcp-server'

export async function runDatasetApiMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
