import { runVisualDocumentMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../packages/workers/visual-document/src/visual-document-mcp-server'
import { SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG } from '../../packages/workers/visual-document/src/contract'

export const GUI_VISUAL_DOCUMENT_MCP_LAUNCH_FLAG = SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG

export async function runVisualDocumentMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
