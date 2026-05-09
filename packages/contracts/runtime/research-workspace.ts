export const BELIEF_NODE_KINDS = ['claim', 'evidence', 'artifact', 'assumption', 'decision'] as const;
export type BeliefNodeKind = typeof BELIEF_NODE_KINDS[number];

export const BELIEF_EDGE_KINDS = ['supports', 'opposes', 'depends-on', 'derived-from', 'supersedes'] as const;
export type BeliefEdgeKind = typeof BELIEF_EDGE_KINDS[number];

export const RESEARCHER_DECISION_STATUSES = ['supported', 'not-supported', 'inconclusive', 'needs-repeat'] as const;
export type ResearcherDecisionStatus = typeof RESEARCHER_DECISION_STATUSES[number];

export const DECISION_REVISION_STATUSES = ['original', 'supersede', 'retract', 'amend', 'reaffirm'] as const;
export type DecisionRevisionStatus = typeof DECISION_REVISION_STATUSES[number];

export const TIMELINE_VISIBILITIES = ['private-draft', 'team-visible', 'project-record', 'restricted-sensitive'] as const;
export type TimelineVisibility = typeof TIMELINE_VISIBILITIES[number];

export const TIMELINE_VARIANT_KINDS = ['parameter', 'method', 'hypothesis'] as const;
export type TimelineVariantKind = typeof TIMELINE_VARIANT_KINDS[number];

export const TIMELINE_DECISION_STATUSES = [...RESEARCHER_DECISION_STATUSES, 'not-a-decision'] as const;
export type TimelineDecisionStatus = typeof TIMELINE_DECISION_STATUSES[number];

export const FEEDBACK_COMMENT_STATUSES = ['open', 'triaged', 'planned', 'fixed', 'needs-discussion', 'wont-fix'] as const;
export type FeedbackCommentStatus = typeof FEEDBACK_COMMENT_STATUSES[number];

export const FEEDBACK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type FeedbackPriority = typeof FEEDBACK_PRIORITIES[number];

function stringIn<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isTimelineVisibility(value: unknown): value is TimelineVisibility {
  return stringIn(TIMELINE_VISIBILITIES, value);
}

export function isTimelineDecisionStatus(value: unknown): value is TimelineDecisionStatus {
  return stringIn(TIMELINE_DECISION_STATUSES, value);
}

export function isFeedbackCommentStatus(value: unknown): value is FeedbackCommentStatus {
  return stringIn(FEEDBACK_COMMENT_STATUSES, value);
}
