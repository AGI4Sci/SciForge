export type * from './types.js'
export {
  IMAGE_DRAWING_INTENTS,
  IMAGE_EDIT_MODES,
  IMAGE_GENERATION_MODES,
  IMAGE_OUTPUT_FORMATS
} from './types.js'

export const IMAGE_GENERATION_MCP_FLAG = '--image-generation-mcp-server'

export const IMAGE_GENERATION_TOOL_SIDE_EFFECTS = {
  image_generation_status: 'read',
  image_generation_plan: 'read',
  image_generation_render: 'controlled-write',
  image_generation_edit_from_canvas_packet: 'controlled-write',
  image_generation_review: 'read',
  image_generation_review_packet: 'controlled-write'
} as const
