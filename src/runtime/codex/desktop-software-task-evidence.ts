export interface DesktopSoftwareTaskEvidenceInput {
  targetWindowRef?: string;
  beforeEvidenceRefs?: string[];
  actionGroundingRefs?: string[];
  executorEventRefs?: string[];
  afterEvidenceRefs?: string[];
  artifactRefs?: string[];
  artifactValidationRefs?: string[];
  finalAnswerRefs?: string[];
  fileCreationOwner?: string;
  sharedSystemInputUsed?: boolean;
  workspaceWriterUsed?: boolean;
  shellWriterUsed?: boolean;
}

export interface DesktopSoftwareTaskEvidenceGate {
  schemaVersion: 'sciforge.desktop-software-task-evidence.v1';
  status: 'passed' | 'blocked';
  missing: string[];
  checkedSlots: string[];
  boundedRefsOnly: true;
}

const REQUIRED_SLOTS = [
  'target-window',
  'before-evidence',
  'action-grounding',
  'executor-event',
  'after-evidence',
  'artifact',
  'artifact-validation',
  'final-answer',
] as const;

export function validateDesktopSoftwareTaskEvidence(
  input: DesktopSoftwareTaskEvidenceInput,
): DesktopSoftwareTaskEvidenceGate {
  const missing = [
    safeDesktopSoftwareEvidenceRef(input.targetWindowRef) ? undefined : 'target-window-ref',
    hasSafeRef(input.beforeEvidenceRefs, /before|observ/i) ? undefined : 'before-evidence-ref',
    hasSafeRef(input.actionGroundingRefs, /action[-_/]?grounding|gui[-_/]?save[-_/]?command|command[-_/]?intent/i) ? undefined : 'action-grounding-ref',
    hasSafeRef(input.executorEventRefs, /executor|webdriver[-_/]?session|event/i) ? undefined : 'executor-event-ref',
    hasSafeRef(input.afterEvidenceRefs, /after|source[-_/]?read|ax|screenshot/i) ? undefined : 'after-evidence-ref',
    hasSafeRef(input.artifactRefs, /artifact/i) ? undefined : 'artifact-ref',
    hasSafeRef(input.artifactValidationRefs, /artifact[-_/]?validator|artifact[-_/]?validation|content[-_/]?match/i) ? undefined : 'artifact-validation-ref',
    hasSafeRef(input.finalAnswerRefs, /final[-_/]?answer/i) ? undefined : 'final-answer-ref',
    input.fileCreationOwner === 'scoped-gui-save' || input.fileCreationOwner === 'native-gui-save'
      ? undefined
      : 'scoped-gui-save-owner',
    input.sharedSystemInputUsed === true ? 'shared-system-input-not-allowed' : undefined,
    input.workspaceWriterUsed === true ? 'workspace-writer-not-allowed' : undefined,
    input.shellWriterUsed === true ? 'shell-writer-not-allowed' : undefined,
  ].filter((item): item is string => Boolean(item));
  return {
    schemaVersion: 'sciforge.desktop-software-task-evidence.v1',
    status: missing.length ? 'blocked' : 'passed',
    missing,
    checkedSlots: [...REQUIRED_SLOTS],
    boundedRefsOnly: true,
  };
}

export function safeDesktopSoftwareEvidenceRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => safeDesktopSoftwareEvidenceRef(value))));
}

function hasSafeRef(values: string[] | undefined, pattern: RegExp): boolean {
  return safeDesktopSoftwareEvidenceRefs(values ?? []).some((ref) => pattern.test(ref));
}

function safeDesktopSoftwareEvidenceRef(value: string | undefined): value is string {
  if (!value || value.length > 240) return false;
  if (/https?:\/\/|file:\/\/|\/tmp|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token|password|api[-_]?key|bearer/i.test(value)) {
    return false;
  }
  return /^(appium-mac2:textedit|window-action-session:t1-textedit-live|window-action-session:textedit-live)\//.test(value);
}
