export type VisionSenseTraceOutputViewRefs = {
  execution?: string;
  trace?: string;
};

const VISION_SENSE_TRACE_VIEW_IDS = {
  execution: 'execution-unit-table',
  trace: 'unknown-artifact-inspector',
} as const;

const VISION_SENSE_TRACE_VIEW_TITLES = {
  execution: 'Execution units',
  trace: 'Vision trace',
} as const;

export function visionSenseTraceOutputViews(options: {
  includeTrace?: boolean;
  refs?: VisionSenseTraceOutputViewRefs;
} = {}) {
  const executionRef = options.refs?.execution ?? 'vision-sense-generic-execution';
  const traceRef = options.refs?.trace ?? 'vision-sense-trace';
  const views: Array<Record<string, unknown>> = [{
    componentId: VISION_SENSE_TRACE_VIEW_IDS.execution,
    title: VISION_SENSE_TRACE_VIEW_TITLES.execution,
    artifactRef: executionRef,
    priority: 1,
  }];
  if (options.includeTrace) {
    views.push({
      componentId: VISION_SENSE_TRACE_VIEW_IDS.trace,
      title: VISION_SENSE_TRACE_VIEW_TITLES.trace,
      artifactRef: traceRef,
      priority: 2,
    });
  }
  return views;
}
