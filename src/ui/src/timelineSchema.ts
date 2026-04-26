import type { TimelineDecisionStatus, TimelineEventRecord, TimelineVisibility } from './domain';

export const timelineEventSchemaVersion = '1.0.0';

export const timelineActionPrefixes = ['package', 'run', 'artifact', 'handoff', 'failure', 'export'] as const;

export type TimelineActionPrefix = typeof timelineActionPrefixes[number];

export const timelineVisibilityValues: TimelineVisibility[] = [
  'private-draft',
  'team-visible',
  'project-record',
  'restricted-sensitive',
];

export const timelineDecisionStatusValues: TimelineDecisionStatus[] = [
  'supported',
  'not-supported',
  'inconclusive',
  'needs-repeat',
  'not-a-decision',
];

export interface TimelineEventSchema {
  schemaVersion: typeof timelineEventSchemaVersion;
  requiredFields: Array<keyof TimelineEventRecord>;
  actionPrefixes: readonly TimelineActionPrefix[];
  visibilityValues: TimelineVisibility[];
  decisionStatusValues: TimelineDecisionStatus[];
  coveredEventKinds: Record<TimelineActionPrefix, string[]>;
}

export const timelineEventSchema: TimelineEventSchema = {
  schemaVersion: timelineEventSchemaVersion,
  requiredFields: [
    'id',
    'actor',
    'action',
    'subject',
    'artifactRefs',
    'executionUnitRefs',
    'beliefRefs',
    'visibility',
    'decisionStatus',
    'createdAt',
  ],
  actionPrefixes: timelineActionPrefixes,
  visibilityValues: timelineVisibilityValues,
  decisionStatusValues: timelineDecisionStatusValues,
  coveredEventKinds: {
    package: ['package.import', 'package.publish', 'package.archive', 'package.restore'],
    run: ['run.completed', 'run.failed', 'run.running'],
    artifact: ['artifact.created', 'artifact.updated', 'artifact.inspected'],
    handoff: ['handoff.created', 'handoff.accepted', 'artifact.handoff'],
    failure: ['failure.runtime', 'failure.validation', 'failure.backend-unavailable'],
    export: ['export.package', 'export.bundle', 'export.branch'],
  },
};

export function isTimelineEventRecord(value: unknown): value is TimelineEventRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<TimelineEventRecord>;
  return typeof record.id === 'string'
    && typeof record.actor === 'string'
    && typeof record.action === 'string'
    && isTimelineAction(record.action)
    && typeof record.subject === 'string'
    && Array.isArray(record.artifactRefs)
    && record.artifactRefs.every((item) => typeof item === 'string')
    && Array.isArray(record.executionUnitRefs)
    && record.executionUnitRefs.every((item) => typeof item === 'string')
    && Array.isArray(record.beliefRefs)
    && record.beliefRefs.every((item) => typeof item === 'string')
    && (record.branchId === undefined || typeof record.branchId === 'string')
    && typeof record.visibility === 'string'
    && timelineVisibilityValues.includes(record.visibility)
    && typeof record.decisionStatus === 'string'
    && timelineDecisionStatusValues.includes(record.decisionStatus)
    && typeof record.createdAt === 'string';
}

export function isTimelineAction(action: string) {
  const prefix = action.split('.')[0];
  return timelineActionPrefixes.some((item) => item === prefix) || action === 'artifact.handoff';
}
