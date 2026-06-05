import type { WorkEvidence } from '../gateway/work-evidence-types.js';
import type { CodexAgentHostComputerUseCompletionTruth } from './agent-host-turn-loop.js';

const COMPLETION_TRUTH_SCHEMA = 'sciforge.computer-use.completion-truth.v1';
const COMPLETION_TRUTH_VALIDATOR = 'current-run-live-acceptance-bundle';
const PACKAGE_BRIDGE_PROVIDER = 'computer-use-package-bridge';
const ACCEPTANCE_MANIFEST = 'cu-user-acceptance-manifest.json';
const ACCEPTANCE_INPUT = 'cu-user-acceptance-input.json';
const COMPLETION_EVIDENCE = 'isolated-desktop-l3-workflow-evidence.json';
const COMPLETION_DIAGNOSTIC = 'completion-grade-diagnostics.json';
const VISION_TRACE = 'vision-trace.json';
const TUI_HOST_RUN_TASK_CHAIN = 'tui-host-run-task-chain.json';

export function completionTruthFromPackageBridgeWorkEvidence(input: {
  evidenceRefs?: string[];
  workEvidence?: Array<WorkEvidence | Record<string, unknown>>;
}): CodexAgentHostComputerUseCompletionTruth | undefined {
  const workEvidence = (input.workEvidence ?? []).filter(isPackageBridgeCompletionWorkEvidence);
  if (!workEvidence.length) return undefined;

  const baseRefs = stringList(input.evidenceRefs).filter(runtimeOwnedCompletionRef);
  const currentRunDir = currentRunDirFromRefs(baseRefs);
  const evidence = workEvidence.find((record) => record.status === 'verified') ?? workEvidence[0];
  const evidenceRefs = stringList(evidence.evidenceRefs).filter(runtimeOwnedCompletionRef);
  const sameRunRefs = currentRunDir
    ? uniqueStrings([...baseRefs, ...evidenceRefs].filter((ref) => ref.startsWith(`${currentRunDir}/`)))
    : [];
  const anchorRefs = sameRunRefs.filter((ref) => ref.endsWith(`/${VISION_TRACE}`) || ref.endsWith(`/${TUI_HOST_RUN_TASK_CHAIN}`));
  const manifestRef = sameRunRefs.find((ref) => ref.endsWith(`/${ACCEPTANCE_MANIFEST}`));
  const completionEvidenceRef = sameRunRefs.find((ref) => ref.endsWith(`/${COMPLETION_EVIDENCE}`));

  if (evidence.status === 'verified' && currentRunDir && manifestRef && completionEvidenceRef) {
    return {
      schemaVersion: COMPLETION_TRUTH_SCHEMA,
      scope: 'workflow',
      status: 'satisfied',
      validator: COMPLETION_TRUTH_VALIDATOR,
      evidenceRefs: uniqueStrings([
        ...anchorRefs,
        manifestRef,
        completionEvidenceRef,
      ]),
    };
  }

  const diagnosticRefs = sameRunRefs.filter((ref) => ref.endsWith(`/${COMPLETION_DIAGNOSTIC}`));
  const reason = blockedReason(evidence, {
    currentRunDir,
    manifestRef,
    completionEvidenceRef,
  });
  return {
    schemaVersion: COMPLETION_TRUTH_SCHEMA,
    scope: 'workflow',
    status: 'blocked',
    validator: COMPLETION_TRUTH_VALIDATOR,
    evidenceRefs: uniqueStrings([
      ...anchorRefs,
      ...diagnosticRefs,
    ]),
    reason,
  };
}

function isPackageBridgeCompletionWorkEvidence(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.provider !== PACKAGE_BRIDGE_PROVIDER) return false;
  const status = typeof value.status === 'string' ? value.status : '';
  if (!status) return false;
  const refs = stringList(value.evidenceRefs);
  if (refs.some((ref) => ref.includes(ACCEPTANCE_MANIFEST) || ref.includes(COMPLETION_EVIDENCE) || ref.includes(COMPLETION_DIAGNOSTIC))) {
    return true;
  }
  const id = stringField(value.id);
  const summary = stringField(value.outputSummary);
  return Boolean(
    id?.includes('completion')
    || summary?.toLowerCase().includes('completion-grade')
    || summary?.toLowerCase().includes('completion evidence'),
  );
}

function currentRunDirFromRefs(refs: string[]): string | undefined {
  const anchorRef = refs.find((ref) => ref.endsWith(`/${VISION_TRACE}`))
    ?? refs.find((ref) => ref.endsWith(`/${TUI_HOST_RUN_TASK_CHAIN}`));
  if (!anchorRef) return undefined;
  const marker = anchorRef.endsWith(`/${VISION_TRACE}`) ? `/${VISION_TRACE}` : `/${TUI_HOST_RUN_TASK_CHAIN}`;
  return anchorRef.slice(0, -marker.length);
}

function blockedReason(
  evidence: Record<string, unknown>,
  refs: {
    currentRunDir?: string;
    manifestRef?: string;
    completionEvidenceRef?: string;
  },
): string {
  const sourceReason = firstSafeDiagnosticText([
    evidence.failureReason,
    evidence.nextStep,
    stringList(evidence.recoverActions).join(' '),
    evidence.outputSummary,
  ]);
  const missing = [
    refs.currentRunDir ? undefined : 'current-run trace refs',
    refs.manifestRef ? undefined : ACCEPTANCE_MANIFEST,
    refs.completionEvidenceRef ? undefined : COMPLETION_EVIDENCE,
  ].filter((item): item is string => Boolean(item));
  const missingText = missing.length
    ? `Package bridge completion evidence is missing same current-run ${missing.join(' and ')}.`
    : 'Package bridge completion evidence did not verify.';
  return boundedDiagnosticText(sourceReason ? `${missingText} ${sourceReason}` : missingText);
}

function firstSafeDiagnosticText(values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringField(value);
    if (text && !unsafeDiagnosticText(text)) return boundedDiagnosticText(text);
  }
  return undefined;
}

function runtimeOwnedCompletionRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  if (!/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  return [
    ACCEPTANCE_MANIFEST,
    ACCEPTANCE_INPUT,
    COMPLETION_EVIDENCE,
    COMPLETION_DIAGNOSTIC,
    VISION_TRACE,
    TUI_HOST_RUN_TASK_CHAIN,
  ].some((fileName) => trimmed.endsWith(`/${fileName}`));
}

function boundedDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

function unsafeDiagnosticText(value: string): boolean {
  return /https?:\/\/|data:image|base64|<html|raw\b|payload\b|secret|token|password|api[-_]?key|bearer/i.test(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 24);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
