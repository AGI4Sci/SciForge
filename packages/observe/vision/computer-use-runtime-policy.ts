export const visionSenseTraceIds = {
  tool: 'local.vision-sense',
  runtime: 'vision-sense-generic-computer-use-loop',
  workspaceRuntime: 'sciforge.workspace-runtime.vision-sense-generic-loop',
  trace: 'vision-sense-trace',
  traceKind: 'vision-trace',
  traceSchema: 'sciforge.vision-trace.v1',
  execution: 'vision-sense-generic-execution',
} as const;

export const visionSenseGroundingIds = {
  windowCrossDisplayDrag: 'window-cross-display-drag',
  targetDescriptionWindowCenter: 'target-description-window-center',
  coarseToFine: 'coarse-to-fine',
  coarseToFineFocusRegion: 'coarse-to-fine-focus-region',
  kvGround: 'kv-ground',
  openAiCompatibleVisionGrounder: 'openai-compatible-vision-grounder',
} as const;

export function visionSenseFocusRegionGroundingId(base: unknown) {
  return `${String(base || 'grounder')}-focus-region`;
}
