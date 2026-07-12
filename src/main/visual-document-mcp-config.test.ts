import { describe, expect, it } from 'vitest'
import {
  SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG,
  SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS
} from '../../packages/workers/visual-document/src/contract'
import {
  buildVisualDocumentMcpConfigFragment,
  visualDocumentMcpEnabledTools,
  type VisualDocumentMcpLaunchConfig
} from './visual-document-mcp-config'

const launch: VisualDocumentMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('VisualDocument MCP config', () => {
  it('builds the only public VisualDocument server and workspace-scoped launch', () => {
    expect(buildVisualDocumentMcpConfigFragment(launch, '/tmp/workspace')).toMatchObject({
      servers: {
        visual_document: {
          enabled: true,
          transport: 'stdio',
          command: '/Applications/SciForge.app/Contents/Frameworks/SciForge Helper.app/Contents/MacOS/SciForge Helper',
          args: [
            '/Applications/SciForge.app/out/main/visual-document-mcp-node-entry.js',
            SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG,
            '--workspace-root',
            '/tmp/workspace'
          ],
          trustScope: 'user',
          trustedWorkspaceRoots: ['/tmp/workspace']
        }
      }
    })
  })

  it('derives enabled tools from the VisualDocument worker contract', () => {
    expect(visualDocumentMcpEnabledTools()).toEqual(
      Object.keys(SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS)
    )
  })
})
