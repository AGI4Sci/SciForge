export { SCIENTIFIC_PLOTTING_TEMPLATES } from './types.js'
export type * from './types.js'

export const SCIENTIFIC_SKILLS_MCP_FLAG = '--scientific-skills-mcp-server'
export const SCIENTIFIC_PLOTTING_MCP_FLAG = '--scientific-plotting-mcp-server'

export const SCIENTIFIC_SKILLS_TOOL_SIDE_EFFECTS = {
  scientific_skills_status: 'read',
  scientific_skills_search: 'read',
  scientific_skills_read: 'read',
  scientific_skills_plan: 'read'
} as const

export const SCIENTIFIC_PLOTTING_TOOL_SIDE_EFFECTS = {
  scientific_plotting_status: 'read',
  scientific_plotting_style_profiles: 'read',
  scientific_plotting_research_brief: 'read',
  scientific_visual_plan: 'read',
  scientific_plotting_map_data: 'read',
  scientific_plotting_render: 'controlled-write',
  scientific_plotting_prepare_reference: 'controlled-write',
  scientific_plotting_review_packet: 'controlled-write'
} as const
