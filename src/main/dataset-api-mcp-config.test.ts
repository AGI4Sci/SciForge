import { describe, expect, it } from 'vitest'
import {
  buildDatasetApiMcpConfigFragment,
  datasetApiMcpEnabledTools,
  GUI_DATASET_API_MCP_SERVER_NAME
} from './dataset-api-mcp-config'

describe('dataset API MCP config', () => {
  it('builds a workspace-trusted first-party MCP config', () => {
    const fragment = buildDatasetApiMcpConfigFragment({
      appPath: '/Applications/SciForge.app',
      execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
      isPackaged: false
    }, '/tmp/workspace')
    const server = (fragment.servers as Record<string, Record<string, unknown>>)[GUI_DATASET_API_MCP_SERVER_NAME]
    expect(server.command).toBe('/Applications/SciForge.app/Contents/Frameworks/SciForge Helper.app/Contents/MacOS/SciForge Helper')
    expect(server.args).toContain('--dataset-api-mcp-server')
    expect(server.args).toContain('/tmp/workspace')
    expect(server.trustedWorkspaceRoots).toEqual(['/tmp/workspace'])
    expect(datasetApiMcpEnabledTools()).toEqual([
      'dataset_api_catalog',
      'dataset_api_register_provider',
      'dataset_api_list',
      'dataset_api_register',
      'dataset_api_metadata',
      'dataset_api_raw_data',
      'dataset_prepare_plan',
      'dataset_profile',
      'dataset_filter',
      'dataset_select_columns',
      'dataset_deduplicate',
      'dataset_validate',
      'dataset_publish'
    ])
  })
})
