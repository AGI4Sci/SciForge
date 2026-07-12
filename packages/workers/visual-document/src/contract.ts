export { VISUAL_ARTIFACT_KINDS, VISUAL_DOCUMENT_SCHEMA_VERSION } from './types.js'
export type * from './types.js'

export const SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG = '--sciforge-visual-document-mcp-server'

export const SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS = {
  sciforge_visual_document_status: 'read',
  sciforge_visual_document_open_or_create: 'controlled-write',
  sciforge_visual_document_insert_artifact: 'controlled-write',
  sciforge_visual_document_update_context: 'controlled-write',
  sciforge_visual_document_save_annotations: 'controlled-write',
  sciforge_visual_document_export_review_packet: 'controlled-write',
  sciforge_visual_document_create_candidate: 'controlled-write',
  sciforge_visual_document_accept_candidate: 'controlled-write',
  sciforge_visual_document_reject_candidate: 'controlled-write'
} as const
