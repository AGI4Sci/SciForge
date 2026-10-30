export const PPT_MASTER_MCP_FLAG = '--ppt-master-mcp-server'

export const PPT_MASTER_TOOL_SIDE_EFFECTS = {
  ppt_master_status: 'read',
  ppt_master_project_status: 'read',
  ppt_master_convert_source: 'open-world',
  ppt_master_init_project: 'controlled-write',
  ppt_master_sciforge_intake: 'controlled-write',
  ppt_master_split_notes: 'controlled-write',
  ppt_master_quality_check: 'read',
  ppt_master_finalize_svg: 'controlled-write',
  ppt_master_export_pptx: 'controlled-write'
} as const
