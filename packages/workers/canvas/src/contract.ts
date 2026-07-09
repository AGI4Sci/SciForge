export { SCIFORGE_CANVAS_ARTIFACT_KINDS } from './types.js'
export type * from './types.js'

export const SCIFORGE_CANVAS_MCP_FLAG = '--sciforge-canvas-mcp-server'

export const SCIFORGE_CANVAS_TOOL_SIDE_EFFECTS = {
  sciforge_canvas_status: 'read',
  sciforge_canvas_open_or_create: 'controlled-write',
  sciforge_canvas_insert_artifact: 'controlled-write',
  sciforge_canvas_split_artifact_components: 'controlled-write',
  sciforge_canvas_get_selection: 'read',
  sciforge_canvas_import_recent_artifacts: 'controlled-write',
  sciforge_canvas_export_review_packet: 'controlled-write'
} as const
