import type {
  CuNextTaskId,
  CuNextTaskMapping,
} from './task-map.js';

export type { CuNextTaskId, CuNextTaskMapping } from './task-map.js';

export type CuNextLiveAcceptanceMarkerKind =
  | 'briefing-deck'
  | 'chart-report'
  | 'needs-confirmation'
  | 'file-index'
  | 'desktop-file-save'
  | 'repair-continuity'
  | 'approval-ref'
  | 'dense-grounding';

export interface CuNextLiveAcceptanceTaskRule {
  taskId: CuNextTaskId;
  markerKind: CuNextLiveAcceptanceMarkerKind;
  label: string;
}

export interface CuNextLiveAcceptanceValidationInput {
  taskId: CuNextTaskId;
  evidence: unknown;
  taskMappings?: readonly CuNextTaskMapping[];
  refRecords?: Record<string, unknown>;
}

export interface CuNextLiveAcceptanceIssue {
  id: string;
  reason: string;
  path?: string;
}

export interface CuNextLiveAcceptanceValidation {
  ok: boolean;
  taskId: CuNextTaskId;
  scenarioIds: string[];
  markerKind?: CuNextLiveAcceptanceMarkerKind;
  markerFound: boolean;
  issues: CuNextLiveAcceptanceIssue[];
  checks: {
    exactTaskId: boolean;
    scenarioMapped: boolean;
    requiredRefs: boolean;
    disqualifiersClean: boolean;
    taskMarker: boolean;
  };
}

export interface MarkerCandidate {
  path: string;
  record: Record<string, unknown>;
}

export const CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES: readonly CuNextLiveAcceptanceTaskRule[] = [
  { taskId: 'CU-NEXT-01', markerKind: 'briefing-deck', label: 'briefing deck' },
  { taskId: 'CU-NEXT-02', markerKind: 'chart-report', label: 'chart report' },
  { taskId: 'CU-NEXT-03', markerKind: 'needs-confirmation', label: 'needs-confirmation' },
  { taskId: 'CU-NEXT-04', markerKind: 'file-index', label: 'file index' },
  { taskId: 'CU-NEXT-05', markerKind: 'repair-continuity', label: 'repair continuity' },
  { taskId: 'CU-NEXT-06', markerKind: 'approval-ref', label: 'approvalRef' },
  { taskId: 'CU-NEXT-07', markerKind: 'dense-grounding', label: 'dense grounding' },
  { taskId: 'CU-NEXT-08', markerKind: 'desktop-file-save', label: 'desktop file save' },
] as const;

export const taskRulesById = new Map(CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES.map((rule) => [rule.taskId, rule]));
export const shortcutClaimKinds = new Set(['dom', 'playwright', 'accessibility', 'generated-file-only']);
export const domAxHintClaimKinds = new Set(['dom', 'playwright', 'accessibility']);
export const browserRuntimeDomAxObservationSchema = 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1';
export const forbiddenLegacyBackendPattern = /\b(?:docker|no-?vnc|novnc|vnc|rdp|container)\b/i;
export const markerAliases: Record<CuNextLiveAcceptanceMarkerKind, readonly string[]> = {
  'briefing-deck': ['briefing-deck', 'briefingdeck', 'deck-briefing', 'literature-briefing-deck'],
  'chart-report': ['chart-report', 'chartreport', 'spreadsheet-chart-report'],
  'needs-confirmation': ['needs-confirmation', 'needsconfirmation', 'confirmation-required', 'approval-request'],
  'file-index': ['file-index', 'fileindex', 'directory-index', 'workspace-file-index'],
  'desktop-file-save': ['desktop-file-save', 'desktopfilesave', 'desktop-local-document-save', 'local-document-save', 'gui-file-save'],
  'repair-continuity': ['repair-continuity', 'repaircontinuity', 'continuation-repair'],
  'approval-ref': ['approval-ref', 'approvalref', 'human-approval-ref'],
  'dense-grounding': ['dense-grounding', 'densegrounding', 'visual-grounding-pressure-test'],
};
