import {
  recordAt,
  sanitizeDiagnosticText,
  stringAt,
  stringList,
  uniqueStrings,
} from './computer-use-chat-live-json.js';

export type ChatLiveExpectedStatus =
  | 'completed'
  | 'confirmed-approval-retry'
  | 'needs-confirmation'
  | 'repair-needed'
  | 'blocked';

export interface ChatLiveFailureDiagnostic {
  kind:
    | 'missing-final-artifact'
    | 'gui-present-final-artifact-binding'
    | 'canonical-l3-missing'
    | 'canonical-l3-blocked'
    | 'canonical-l3-producer-failure'
    | 'package-bridge-repair-needed'
    | 'package-bridge-process-failure';
  summary: string;
  refs: string[];
  recoverActions: string[];
}

export interface PackageBridgeCompletionGradeSummary {
  status: 'attached' | 'blocked' | 'missing';
  diagnosticRefs: string[];
  acceptanceManifestRefs: string[];
  acceptanceInputRefs: string[];
  completionEvidenceRefs: string[];
  producerDiagnosticRefs: string[];
  reason?: string;
  producerDiagnosticIssues: string[];
  sourceReadinessStatus: string[];
  sourceBlockedReasons: string[];
  processDiagnosticSummaries: string[];
}

export interface LiveAcceptanceBundleSummary {
  status?: string;
}

export function chatLiveFailureDiagnostics(input: {
  expectedStatus: ChatLiveExpectedStatus;
  artifactRefs: string[];
  displayedRefs: string[];
  auditRefs: string[];
  guiPresentation?: Record<string, unknown>;
}): ChatLiveFailureDiagnostic[] {
  if (input.expectedStatus !== 'completed') return [];
  const diagnostics: ChatLiveFailureDiagnostic[] = [];
  const finalArtifactRefs = input.artifactRefs.filter((ref) => !isCompletionControlEvidenceRef(ref));
  if (!finalArtifactRefs.length) {
    diagnostics.push({
      kind: 'missing-final-artifact',
      summary: 'Completed Computer Use status did not expose a current-run final artifact ref in the chat projection.',
      refs: uniqueStrings([...input.displayedRefs, ...input.auditRefs]).slice(0, 12),
      recoverActions: [
        'Rerun or continue with an instruction to create a visible local final artifact and include that artifact ref in gui.present.',
      ],
    });
  }
  const guiPresented = Boolean(input.guiPresentation);
  for (const ref of finalArtifactRefs) {
    if (!input.displayedRefs.includes(ref)) {
      diagnostics.push({
        kind: 'gui-present-final-artifact-binding',
        summary: `Final artifact ref was not displayed by gui.present: ${ref}`,
        refs: uniqueStrings([ref, ...input.displayedRefs, ...input.auditRefs]).slice(0, 12),
        recoverActions: [
          guiPresented
            ? 'Bind the current-run final artifact ref into gui.present displayedRefs before claiming completion.'
            : 'Emit a TUI Host gui.present action that displays the current-run final artifact ref before claiming completion.',
        ],
      });
    }
  }
  return diagnostics;
}

export function completionGradeFailureDiagnostics(input: {
  expectedStatus: ChatLiveExpectedStatus;
  packageBridgeCompletionGrade: PackageBridgeCompletionGradeSummary;
  liveAcceptanceBundle?: LiveAcceptanceBundleSummary;
  refs: string[];
}): ChatLiveFailureDiagnostic[] {
  if (input.expectedStatus !== 'completed') return [];
  const grade = input.packageBridgeCompletionGrade;
  if (grade.status === 'attached') return [];
  const diagnosticRefs = uniqueStrings([
    ...grade.diagnosticRefs,
    ...grade.producerDiagnosticRefs,
    ...grade.acceptanceManifestRefs,
    ...grade.acceptanceInputRefs,
    ...grade.completionEvidenceRefs,
  ]);
  if (grade.status === 'missing') {
    return [{
      kind: 'canonical-l3-missing',
      summary: 'Current completed chat run is missing package bridge completion-grade attachment for canonical isolated-desktop-l3-workflow-evidence.json.',
      refs: uniqueStrings([...diagnosticRefs, ...input.refs]).slice(0, 12),
      recoverActions: [
        'Produce canonical isolated-desktop-l3-workflow-evidence.json and cu-user-acceptance-manifest.json in the same Computer Use run directory.',
      ],
    }];
  }
  const producerFailed = grade.producerDiagnosticRefs.length > 0 || grade.producerDiagnosticIssues.length > 0 || grade.sourceBlockedReasons.length > 0;
  const sourceDetails = uniqueStrings([
    ...grade.producerDiagnosticIssues.map(safeIssueText),
    ...grade.processDiagnosticSummaries.map((summary) => `process ${safeIssueText(summary)}`),
    ...grade.sourceReadinessStatus.map((status) => `source readiness ${safeIssueText(status)}`),
    ...grade.sourceBlockedReasons.map((reason) => `source blocker ${safeIssueText(reason)}`),
  ]);
  return [{
    kind: producerFailed ? 'canonical-l3-producer-failure' : 'canonical-l3-blocked',
    summary: sourceDetails.length
      ? `Canonical L3 completion-grade is blocked: ${sourceDetails.slice(0, 8).join(' | ')}`
      : `Canonical L3 completion-grade is blocked${grade.reason ? `: ${safeIssueText(grade.reason)}` : '.'}`,
    refs: diagnosticRefs,
    recoverActions: [
      producerFailed
        ? 'Open the producer diagnostics refs and fix the listed L3 backend/readiness blockers, then rerun with the same-run completion evidence producer enabled.'
        : 'Open completion-grade-diagnostics.json and bind the canonical L3 evidence to the current final artifact and gui.present record.',
      ...(input.liveAcceptanceBundle?.status === 'missing'
        ? ['Do not treat readiness manifests, pseudo refs, or old run dirs as completion evidence.']
        : []),
    ],
  }];
}

export function isCompletionControlEvidenceRef(ref: string) {
  return /(?:^|\/)(?:vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|completion-grade-diagnostics|embedded-l3-completion-producer-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier|isolated-desktop-l3-workflow-evidence)\.json$/i.test(ref)
    || /^(?:artifact|audit|workEvidence|EU):/i.test(ref);
}

export function uniqueFailureDiagnostics(diagnostics: ChatLiveFailureDiagnostic[]): ChatLiveFailureDiagnostic[] {
  const seen = new Set<string>();
  const output: ChatLiveFailureDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.kind}:${diagnostic.summary}:${diagnostic.refs.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...diagnostic,
      refs: uniqueStrings(diagnostic.refs),
      recoverActions: uniqueStrings(diagnostic.recoverActions),
    });
  }
  return output;
}

export function packageBridgeProcessFailureDiagnosticsFromTrace(input: {
  trace: Record<string, unknown>;
  ref?: string;
}): ChatLiveFailureDiagnostic[] {
  const packageResult = recordAt(input.trace, 'packageResult');
  const failureDiagnostics = recordAt(packageResult, 'failureDiagnostics');
  if (!failureDiagnostics) return [];
  const failedStage = stringAt(failureDiagnostics, 'failedStage') ?? stringAt(packageResult, 'status') ?? 'package-bridge';
  const summaries = invocationProcessDiagnosticSummaries(
    recordAt(failureDiagnostics, 'process'),
    failureDiagnostics,
    failedStage,
  );
  if (!summaries.length) return [];
  return [{
    kind: 'package-bridge-process-failure',
    summary: `Computer Use package bridge process failure: ${summaries.join(' | ')}`,
    refs: input.ref ? [input.ref] : [],
    recoverActions: [
      'Open the current-run vision trace and fix the package bridge process failure before treating the chat run as completed.',
    ],
  }];
}

export function packageBridgeRepairNeededDiagnosticsFromSidecars(input: {
  blockedManifest?: { record: Record<string, unknown>; ref?: string };
  repairHint?: { record: Record<string, unknown>; ref?: string };
  continuationRequest?: { record: Record<string, unknown>; ref?: string };
}): ChatLiveFailureDiagnostic[] {
  const blocked = input.blockedManifest?.record;
  const repairHint = input.repairHint?.record;
  const continuationRequest = input.continuationRequest?.record;
  if (!blocked && !repairHint) return [];
  const failedStage = stringAt(blocked, 'failedStage') ?? 'repair-needed';
  const reason = safeIssueText(stringAt(blocked, 'reason') ?? stringAt(repairHint, 'reason') ?? 'Computer Use package bridge returned repair-needed.');
  const continuationRequestRef = input.continuationRequest?.ref
    ?? stringAt(blocked, 'continuationRequestRef')
    ?? stringAt(repairHint, 'continuationRequestRef');
  const refs = uniqueStrings([
    input.blockedManifest?.ref,
    input.repairHint?.ref,
    input.continuationRequest?.ref,
    stringAt(blocked, 'traceRef'),
    stringAt(blocked, 'requestRef'),
    stringAt(blocked, 'tuiHostRunTaskChainRef'),
    stringAt(blocked, 'repairHintRef'),
    stringAt(blocked, 'continuationRequestRef'),
    stringAt(repairHint, 'blockedManifestRef'),
    recordAt(repairHint, 'nextAttempt') ? stringAt(recordAt(repairHint, 'nextAttempt'), 'reuseTraceRef') : undefined,
    recordAt(repairHint, 'nextAttempt') ? stringAt(recordAt(repairHint, 'nextAttempt'), 'reuseRunTaskChainRef') : undefined,
    stringAt(continuationRequest, 'blockedManifestRef'),
    stringAt(continuationRequest, 'repairHintRef'),
    stringAt(continuationRequest, 'sameTraceSessionRef'),
  ]).slice(0, 12);
  return [{
    kind: 'package-bridge-repair-needed',
    summary: `Computer Use package bridge returned repair-needed after submission: failedStage=${safeIssueText(failedStage)}; reason=${reason}`,
    refs,
    recoverActions: [
      continuationRequestRef
        ? `/computer-use continue --continuation-request-ref "${continuationRequestRef}"`
        : 'Open the current-run blocked-manifest and repair-hint refs, then rerun after resolving the listed Computer Use package bridge blocker.',
    ],
  }];
}

export function invocationProcessDiagnosticSummaries(
  processRecord: Record<string, unknown> | undefined,
  fallbackRecord: Record<string, unknown> | undefined,
  label: string,
): string[] {
  const stdout = stringAt(fallbackRecord, 'stdout') ?? stringAt(processRecord, 'stdout');
  const stderr = stringAt(fallbackRecord, 'stderr') ?? stringAt(processRecord, 'stderr');
  const command = stringAt(processRecord, 'command');
  const args = sanitizedProcessArgs(stringList(processRecord?.args)).join(' ');
  const code = scalarText(processRecord?.code);
  const signal = scalarText(processRecord?.signal);
  const timedOut = typeof processRecord?.timedOut === 'boolean' ? processRecord.timedOut : undefined;
  const timeoutMs = scalarText(processRecord?.timeoutMs);
  const processParts = [
    command ? `command=${command}` : undefined,
    args ? `args=${args}` : undefined,
    code !== undefined ? `exit=${code}` : undefined,
    signal ? `signal=${signal}` : undefined,
    timedOut !== undefined ? `timedOut=${timedOut}` : undefined,
    timeoutMs ? `timeoutMs=${timeoutMs}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return uniqueStrings([
    processParts.length ? `${label} process: ${processParts.join(' ')}` : undefined,
    stdout ? `${label} stdout: ${stdout}` : undefined,
    stderr ? `${label} stderr: ${stderr}` : undefined,
  ].filter((summary): summary is string => Boolean(summary))
    .map((summary) => clipDiagnosticSummary(summary, 360)));
}

export function safeIssueText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeDiagnosticText(message).slice(0, 400);
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function sanitizedProcessArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1] ?? '';
    if (isSensitiveProcessArg(previous)) return '[redacted-secret]';
    return sanitizeDiagnosticText(arg);
  });
}

function isSensitiveProcessArg(arg: string): boolean {
  return /^(?:--)?[A-Za-z0-9_.-]*(?:api[_-]?key|apiKey|authorization|auth[_-]?token|authToken|base[_-]?url|baseUrl|provider[_-]?url|providerUrl|model|password|passwd|secret|token)[A-Za-z0-9_.-]*$/i.test(arg);
}

function clipDiagnosticSummary(value: string, maxChars: number): string {
  const sanitized = sanitizeDiagnosticText(value.replace(/\s+/g, ' ').trim());
  return sanitized.length > maxChars ? `${sanitized.slice(0, maxChars - 14).trim()}...[truncated]` : sanitized;
}
