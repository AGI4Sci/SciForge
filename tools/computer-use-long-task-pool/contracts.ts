export const allowedActionTypes = new Set(['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait']);
export const requiredPipeline = ['WindowTarget', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier', 'vision-trace'];
export const requiredTraceMetadata = [
  'windowTarget',
  'window screenshot refs',
  'window-local coordinates',
  'input channel',
  'scheduler metadata',
];

export interface ComputerUseLongTaskPool {
  schemaVersion: '1.0';
  taskId: 'T084';
  title: string;
  commonPrinciples: string[];
  scenarios: ComputerUseLongScenario[];
}

export interface ComputerUseLongScenario {
  id: string;
  title: string;
  goal: string;
  minRounds: number;
  requiredPipeline: string[];
  safetyBoundary: {
    noDomAccessibility: boolean;
    fileRefOnlyImageMemory: boolean;
    failClosedHighRiskActions: boolean;
    appSpecificShortcutsAllowed: false;
  };
  rounds: ComputerUseLongRound[];
  acceptance: string[];
  failureRecord: string[];
  requiredEvidence: string[];
}

export interface ComputerUseLongRound {
  round: number;
  prompt: string;
  expectedTrace: string[];
}

export interface ComputerUseLongTraceValidation {
  ok: boolean;
  scenarioId: string;
  tracePath: string;
  checkedScreenshotRefs: string[];
  issues: string[];
  metrics: {
    stepCount: number;
    actionCount: number;
    nonWaitActionCount: number;
    effectiveNonWaitActionCount: number;
    screenshotCount: number;
    blockedCount: number;
    failedCount: number;
  };
}

export interface PreparedComputerUseLongRun {
  schemaVersion: '1.0';
  taskId: 'T084';
  scenarioId: string;
  title: string;
  status: 'not-run' | 'running' | 'passed' | 'repair-needed' | 'failed';
  run: {
    id: string;
    startedAt: string;
    workspacePath: string;
    appUrl?: string;
    backend?: string;
    operator?: string;
    windowTarget: {
      mode: 'required';
      expectedScope: 'active-window-or-selected-window';
      coordinateSpace: 'window-local';
    };
    inputChannel: {
      mode: 'generic-mouse-keyboard';
      allowedActionTypes: string[];
    };
    scheduler: {
      mode: 'serialized-window-actions';
      requiresBeforeAfterScreenshots: true;
    };
  };
  universalPipeline: string[];
  validationContract: {
    requiredTraceMetadata: string[];
    screenshotScope: 'window';
    coordinateSpace: 'window-local';
    inputChannel: 'generic-mouse-keyboard';
    scheduler: 'serialized-window-actions';
  };
  safetyBoundary: ComputerUseLongScenario['safetyBoundary'];
  rounds: Array<{
    round: number;
    prompt: string;
    expectedTrace: string[];
    status: 'not-run' | 'passed' | 'repair-needed' | 'failed';
    visionTraceRef?: string;
    screenshotRefs: string[];
    actionLedgerRefs: string[];
    failureDiagnosticsRefs: string[];
    observedBehavior?: string;
  }>;
  acceptance: string[];
  failureRecord: string[];
  requiredEvidence: string[];
  notes: string;
}

export interface ComputerUseLongRoundRunResult {
  manifestPath: string;
  scenarioId: string;
  round: number;
  status: PreparedComputerUseLongRun['rounds'][number]['status'];
  tracePath?: string;
  validation?: ComputerUseLongTraceValidation;
  actionLedgerPath: string;
  failureDiagnosticsPath: string;
  payloadMessage: string;
}

export interface ComputerUseLongScenarioRunResult {
  manifestPath: string;
  scenarioId: string;
  status: PreparedComputerUseLongRun['status'];
  attemptedRounds: number[];
  passedRounds: number[];
  repairNeededRound?: number;
  summaryPath: string;
  roundResults: ComputerUseLongRoundRunResult[];
}

export interface ComputerUseLongRunValidation {
  ok: boolean;
  manifestPath: string;
  scenarioId: string;
  summaryPath?: string;
  checkedRounds: number[];
  issues: string[];
  metrics: {
    passedRounds: number;
    traceCount: number;
    realTraceCount: number;
    actionCount: number;
    nonWaitActionCount: number;
    screenshotRefCount: number;
    actionLedgerCount: number;
    failureDiagnosticsCount: number;
  };
}

export interface ComputerUseLongMatrixRunResult {
  summaryPath: string;
  status: 'passed' | 'repair-needed';
  scenarioIds: string[];
  passedScenarioIds: string[];
  repairNeededScenarioIds: string[];
  executionPlan?: {
    mode: 'parallel-analysis' | 'serialized-real-gui';
    maxConcurrency: number;
    realGuiSerialized: boolean;
    reason: string;
  };
  preflight?: ComputerUseLongPreflightResult;
  results: Array<{
    scenarioId: string;
    manifestPath: string;
    runStatus: PreparedComputerUseLongRun['status'];
    validationOk: boolean;
    summaryPath?: string;
    issues: string[];
  }>;
}

export interface ComputerUseLongMatrixReport {
  ok: boolean;
  summaryPath: string;
  reportPath: string;
  markdown: string;
  issueCategories: Record<string, number>;
}

export interface ComputerUseLongMatrixValidation {
  ok: boolean;
  summaryPath: string;
  scenarioIds: string[];
  issues: string[];
  metrics: {
    resultCount: number;
    passedScenarios: number;
    repairNeededScenarios: number;
    preflightFailedChecks: number;
    validatedRuns: number;
  };
}

export interface ComputerUseLongRepairPlan {
  ok: boolean;
  summaryPath: string;
  planPath: string;
  markdown: string;
  actionCount: number;
}

export interface ComputerUseLongPreflightResult {
  ok: boolean;
  scenarioIds: string[];
  dryRun: boolean;
  checks: Array<{
    id: string;
    status: 'pass' | 'warn' | 'fail';
    category: string;
    message: string;
    repairAction?: string;
  }>;
  reportPath?: string;
}
