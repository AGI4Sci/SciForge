export type * from './types.js'
export type * from './visual-scene.js'
export {
  IMAGE_DRAWING_INTENTS,
  IMAGE_EDIT_MODES,
  IMAGE_GENERATION_MODES,
  IMAGE_OUTPUT_FORMATS
} from './types.js'
export { VISUAL_SCENE_VERSION } from './visual-scene.js'

export const IMAGE_GENERATION_MCP_FLAG = '--image-generation-mcp-server'

export const IMAGE_GENERATION_TOOL_SIDE_EFFECTS = {
  visual_generate: 'read',
  image_generation_status: 'read',
  image_generation_prepare: 'read',
  image_generation_render: 'controlled-write',
  image_generation_segment_components: 'controlled-write',
  image_generation_edit_components: 'controlled-write',
  image_generation_edit_from_visual_review_packet: 'controlled-write',
  image_generation_review_candidate: 'read'
} as const
