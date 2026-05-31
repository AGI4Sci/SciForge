import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addRightPaneTabLifecycleState, backendRepairStates, cancelWorkspaceFileEditorEdit, closeRightPaneTabLifecycleState, coerceReportPayload, contractValidationFailures, removeWorkspaceFileEditorForTab, renderRegisteredWorkbenchSlot, requestOpenDebugAuditThroughUserActionApi, requestRecoverCommandTextAction, ResultsRenderer, runAuditRefs, runRecoverActions, setWorkspaceFileEditorForTab, shouldOpenRunAuditDetails, shouldTryRepoRootWorkspaceFallback, workspaceFileFocusRequestKey, type WorkspaceFileEditorState } from './ResultsRenderer';
import { ArtifactInspectorDrawer } from './results-renderer-artifact-inspector';
import { MarkdownBlock } from './results/reportContent';
import { nextPinnedObjectReferences, performObjectReferenceAction, resolveObjectReferenceActionPlan, resultTabForObjectReference } from './results-renderer-object-actions';
import { RegistrySlot } from './results-renderer-registry-slot';
import { createResultsRendererViewModel } from './results-renderer-view-model';
import { applyBackgroundCompletionEventToSession } from './chat/sessionTransforms';
import { conversationProjectionMigrationAuditFixtureForRun } from './conversation-projection-view-model';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import type { ObjectReference, RuntimeArtifact, RuntimeExecutionUnit, SciForgeConfig, SciForgeRun, SciForgeSession } from '../domain';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test('coerceReportPayload extracts report refs from backend ToolPayload text instead of rendering raw JSON', () => {
  const payloadText = [
    'Let me inspect the prior attempts before returning the result.',
    '',
    'Returning the existing result as a ToolPayload.',
    '',
    '```json',
    '{',
    '  "message": "成功检索 10 篇论文，生成详细 Markdown 阅读报告。",',
    '  "uiManifest": [{"componentId": "paper-card-list"}],',
    '  "artifacts": [{',
    '    "id": "research-report",',
    '    "type": "research-report",',
    '    "data": {',
    '      "markdownRef": ".sciforge/tasks/generated-literature/report/arxiv-agent-reading-report.md"',
    '    }',
    '  }]',
    '}',
    '```',
  ].join('\n');
  const artifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: payloadText },
  };

  const report = coerceReportPayload({ markdown: payloadText }, artifact);

  assert.equal(report.reportRef, '.sciforge/tasks/generated-literature/report/arxiv-agent-reading-report.md');
  assert.match(report.markdown ?? '', /Markdown report/);
  assert.doesNotMatch(report.markdown ?? '', /"uiManifest"/);
});

test('coerceReportPayload keeps normal markdown report bodies unchanged', () => {
  const markdown = '# Real Report\n\nThis is the user-facing paper reading report.';
  const report = coerceReportPayload({ markdown });

  assert.equal(report.markdown, markdown);
  assert.equal(report.reportRef, undefined);
});

test('right pane markdown block folds traceback diagnostics like chat answers', () => {
  const markdown = [
    'Traceback (most recent call last):',
    '  File "/opt/homebrew/Caskroom/miniconda/base/lib/python3.13/site-packages/requests/adapters.py", line 644, in send',
    '    resp = conn.urlopen(method=request.method)',
    'urllib3.exceptions.MaxRetryError: HTTPSConnectionPool(host="export.arxiv.org", port=443): Max retries exceeded',
    '',
    'During handling of the above exception, another exception occurred:',
    '',
    'requests.exceptions.ProxyError: HTTPSConnectionPool(host="export.arxiv.org", port=443): Max retries exceeded',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(MarkdownBlock, { markdown }));
  const foldStart = html.indexOf('final-message-audit-fold');
  const primaryHtml = foldStart >= 0 ? html.slice(0, foldStart) : html;

  assert.match(primaryHtml, /The task did not finish/);
  assert.doesNotMatch(primaryHtml, /Traceback|urllib3|requests\.exceptions|export\.arxiv|\/opt\/homebrew/i);
  assert.match(html, /Process/);
});

test('ResultsRenderer exposes stable browser runtime state hook from Projection', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    sessionId: 'session-runtime-hook',
    runs: [{
      ...completedRun('run-runtime-hook'),
      raw: {
        resultPresentation: projectionResultPresentation('run-runtime-hook', ['artifact:research-report']),
      },
    }],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { runId: 'run-runtime-hook' },
      data: { markdown: 'Ready provider report' },
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-runtime-hook' });

  assert.match(html, /data-testid="runtime-visible-state"/);
  assert.match(html, /data-projection-status="satisfied"/);
  assert.match(html, /data-presentation-kind="ready"/);
  assert.match(html, /data-t-terminal-projection-ms="60000"/);
  assert.match(html, /data-projection-wait-at-terminal="false"/);
  assert.match(html, /data-fallback-used="false"/);
  assert.match(html, /data-diagnostic-leak="false"/);
  assert.doesNotMatch(html, /data-session-id=/);
  assert.doesNotMatch(html, /data-run-id=/);
});

test('coerceReportPayload prefers markdown refs over JSON data refs', () => {
  const artifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/task-results/run-output.json',
    metadata: {
      markdownRef: '.sciforge/artifacts/run/research-report.md',
      outputRef: '.sciforge/task-results/run-output.json',
    },
    data: { summary: 'fallback summary' },
  };

  const report = coerceReportPayload({ dataRef: artifact.dataRef }, artifact);

  assert.equal(report.reportRef, '.sciforge/artifacts/run/research-report.md');
  assert.notEqual(report.reportRef, '.sciforge/task-results/run-output.json');
});

test('coerceReportPayload synthesizes readable report sections from related artifacts', () => {
  const reportArtifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { reportRef: 'agentserver://run/output' },
  };
  const paperList: RuntimeArtifact = {
    id: 'paper-list',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      papers: [{
        title: 'Agentic Retrieval for Scientific Discovery',
        authors: ['A. Researcher', 'B. Scientist'],
        year: 2026,
        url: 'https://arxiv.org/abs/2601.00001',
        summary: 'Introduces an agent workflow for literature triage.',
      }],
    },
  };
  const evidenceMatrix: RuntimeArtifact = {
    id: 'evidence-matrix',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      rows: [{ claim: 'Agents improve triage', evidence: 'benchmark', confidence: 0.72 }],
    },
  };

  const report = coerceReportPayload({ reportRef: 'agentserver://run/output' }, reportArtifact, [paperList, evidenceMatrix]);

  assert.match(report.markdown ?? '', /Agentic Retrieval for Scientific Discovery/);
  assert.match(report.markdown ?? '', /Agents improve triage/);
  assert.doesNotMatch(report.markdown ?? '', /ENOENT/);
});

test('completed runs with partial retrieval notes do not open failure audit by default', () => {
  const session = {
    schemaVersion: 2,
    sessionId: 'session-partial-retrieval',
    scenarioId: 'literature-evidence-review',
    title: 'partial retrieval',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'project-literature-evidence-review-run',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'fetch papers',
      response: 'completed with partial PDF retrieval',
      createdAt: '2026-05-09T00:00:00.000Z',
      completedAt: '2026-05-09T00:01:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'fetch-full-text',
      tool: 'arxiv.fetch',
      params: '{}',
      status: 'partial' as never,
      hash: 'hash-partial',
      runId: 'project-literature-evidence-review-run',
      failureReason: 'Some papers could not be fully retrieved',
      outputRef: '.sciforge/task-results/project-literature-evidence-review-run.json',
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:01:00.000Z',
  } as SciForgeSession;

  assert.equal(shouldOpenRunAuditDetails(session, session.runs[0]), false);
});

test('failure audit extracts ContractValidationFailure recover actions, related refs, and backend repair state', () => {
  const session = contractFailureSession();

  assert.equal(shouldOpenRunAuditDetails(session, session.runs[0]), true);
  assert.equal(contractValidationFailures(session, session.runs[0]).length, 0);
  assert.deepEqual(runRecoverActions(session, session.runs[0]), []);
  assert.ok(runAuditRefs(session, session.runs[0]).includes('execution-unit:EU-report'));
  assert.ok(runAuditRefs(session, session.runs[0]).includes('agentserver://repair/stderr'));
  assert.equal(backendRepairStates(session, session.runs[0]).length, 0);
});

test('ResultsRenderer keeps raw ContractValidationFailure audit-only without synthesizing a main failure state', () => {
  const session = contractFailureSession();
  const html = renderToStaticMarkup(createElement(ResultsRenderer, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    defaultSlots: [],
    onArtifactHandoff: () => undefined,
    collapsed: false,
    onToggleCollapse: () => undefined,
    activeRunId: 'run-contract-failure',
    onActiveRunChange: () => undefined,
    onFocusedObjectChange: () => undefined,
    workspaceFileEditor: null,
    onWorkspaceFileEditorChange: () => undefined,
  }));

  assert.match(html, /Nothing to preview yet/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.match(html, /More/);
  assert.doesNotMatch(stripRuntimeStateHook(html), /structured audit|audit ref|EU-report|ContractValidationFailure|Backend repair|debug/i);
  assert.doesNotMatch(stripRuntimeStateHook(html), /raw JSONL|stdout|stderr|provider|run id|ConversationProjection|ArtifactDelivery|ExecutionUnit|modules|refs/i);
  assert.doesNotMatch(html, /Completed report|ready result/);
});

test('ResultsRenderer empty right pane exposes Cursor-like browser terminal and files tools', () => {
  const html = renderResultsRenderer(emptySession());

  assert.match(html, /class="result-tabstrip"/);
  assert.match(html, /data-right-pane-tab-layout="scroll-tabs-fixed-actions"/);
  assert.match(html, /data-overflow-policy="horizontal-scroll"/);
  assert.match(html, /class="result-new-tab-button"/);
  assert.match(html, /data-fixed-action="new"/);
  assert.match(html, /data-fixed-action="close"/);
  assert.match(html, /data-fixed-action="focus-mode"/);
  assert.match(html, /aria-label="New right pane page"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, />New</);
  assert.match(html, /role="tab"/);
  assert.match(html, /data-right-pane-tool="browser"/);
  assert.match(html, /data-right-pane-tool="screen"/);
  assert.match(html, /data-right-pane-tool="terminal"/);
  assert.match(html, /data-right-pane-tool="files"/);
  assert.match(html, />Browser</);
  assert.match(html, /Virtual Screen|虚拟屏幕/);
  assert.match(html, />Terminal</);
  assert.match(html, />Files</);
  assert.match(html, /Nothing to preview yet/);
});

test('ResultsRenderer right pane lifecycle activates New Browser Terminal and Files tabs', () => {
  const browserState = addRightPaneTabLifecycleState({
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
  }, 'browser', undefined, 101);
  const terminalState = addRightPaneTabLifecycleState(browserState, 'terminal', undefined, 102);
  const filesState = addRightPaneTabLifecycleState(terminalState, 'files', undefined, 103);

  assert.equal(browserState.activeTabId, 'custom:browser:101:1');
  assert.deepEqual(browserState.focusTarget, { kind: 'tab', tabId: 'custom:browser:101:1' });
  assert.equal(browserState.tabs[0]?.label, 'Browser');
  assert.equal(terminalState.activeTabId, 'custom:terminal:102:1');
  assert.deepEqual(terminalState.focusTarget, { kind: 'tab', tabId: 'custom:terminal:102:1' });
  assert.equal(terminalState.tabs.at(-1)?.label, 'Terminal');
  assert.equal(filesState.activeTabId, 'custom:files:103:1');
  assert.deepEqual(filesState.focusTarget, { kind: 'tab', tabId: 'custom:files:103:1' });
  assert.equal(filesState.tabs.at(-1)?.label, 'Files');
});

test('ResultsRenderer right pane close-all reaches empty state and New recovers', () => {
  const browserState = addRightPaneTabLifecycleState({
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
  }, 'browser', undefined, 201);
  const terminalState = addRightPaneTabLifecycleState(browserState, 'terminal', undefined, 202);
  const filesState = addRightPaneTabLifecycleState({
    ...terminalState,
    browserTabAddresses: {
      [browserState.activeTabId]: 'http://localhost:5173',
    },
  }, 'files', undefined, 203);
  const closedFiles = closeRightPaneTabLifecycleState(filesState, filesState.activeTabId);
  const closedTerminal = closeRightPaneTabLifecycleState(closedFiles, terminalState.activeTabId);
  const emptyState = closeRightPaneTabLifecycleState(closedTerminal, browserState.activeTabId);
  const recovered = addRightPaneTabLifecycleState(emptyState, 'files', undefined, 204);

  assert.equal(closedFiles.activeTabId, terminalState.activeTabId);
  assert.deepEqual(closedFiles.focusTarget, { kind: 'tab', tabId: terminalState.activeTabId });
  assert.equal(closedTerminal.activeTabId, browserState.activeTabId);
  assert.deepEqual(emptyState, {
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
    focusTarget: { kind: 'new-button' },
  });
  assert.equal(recovered.activeTabId, 'custom:files:204:1');
  assert.equal(recovered.tabs.length, 1);
  assert.deepEqual(recovered.focusTarget, { kind: 'tab', tabId: 'custom:files:204:1' });
});

test('ResultsRenderer right pane narrow overflow keeps tablist actions accessible', () => {
  const shellSource = readFileSync(new URL('./results/ResultShell.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../styles/app-04.css', import.meta.url), 'utf8');

  assert.match(shellSource, /role="tablist"/);
  assert.match(shellSource, /role="tabpanel"/);
  assert.match(shellSource, /role="menu"/);
  assert.match(shellSource, /role="menuitem"/);
  assert.match(shellSource, /aria-orientation="horizontal"/);
  assert.match(shellSource, /aria-controls=\{resultTabPanelId\(tab\.id\)\}/);
  assert.match(shellSource, /data-right-pane-tab-layout="scroll-tabs-fixed-actions"/);
  assert.match(shellSource, /data-overflow-policy="horizontal-scroll"/);
  assert.match(shellSource, /data-fixed-action="new"/);
  assert.match(shellSource, /data-fixed-action="close"/);
  assert.match(shellSource, /data-fixed-action="focus-mode"/);
  assert.match(cssSource, /\.result-tabstrip\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(cssSource, /\.result-tabs\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(cssSource, /\.result-tabs \[data-fixed-action\]\s*\{[\s\S]*flex:\s*0 0 auto/);
});

test('ResultsRenderer tool tabs render package-owned browser terminal and file modules', () => {
  const browserHtml = renderResultsRenderer(emptySession(), { initialResultTab: 'browser' });
  const screenHtml = renderResultsRenderer(emptySession(), { initialResultTab: 'screen' });
  const terminalHtml = renderResultsRenderer(emptySession(), { initialResultTab: 'terminal' });
  const filesHtml = renderResultsRenderer(emptySession(), { initialResultTab: 'files' });

  assert.match(browserHtml, /data-testid="right-pane-browser-tool"/);
  assert.match(browserHtml, /data-component-id="browser-workbench"/);
  assert.match(browserHtml, /data-render-boundary="presentation-only"/);
  assert.match(browserHtml, /name="browser-url"/);
  assert.match(browserHtml, /\/browser open/);
  assert.match(browserHtml, /data-browser-state="(?:idle|loading)"/);
  assert.match(screenHtml, /data-testid="right-pane-virtual-screen-tool"/);
  assert.match(screenHtml, /data-component-id="virtual-screen-viewer"/);
  assert.match(screenHtml, /data-render-boundary="presentation-only"/);
  assert.match(screenHtml, /data-status="empty"/);
  assert.match(screenHtml, /Virtual screen refs are not attached/);
  assert.doesNotMatch(screenHtml, /computer-use:screen\/right-pane\/blocked\/no-current-frame|computer-use:session\/right-pane|providerRoute|executorLease|desktopBridge/);
  assert.match(terminalHtml, /data-testid="right-pane-terminal-tool"/);
  assert.match(terminalHtml, /data-component-id="terminal-session-viewer"/);
  assert.match(terminalHtml, /data-render-boundary="presentation-only"/);
  assert.match(terminalHtml, /name="terminal-input"/);
  assert.match(filesHtml, /data-testid="right-pane-files-tool"/);
  assert.match(filesHtml, /data-component-id="workspace-file-viewer"/);
  assert.match(filesHtml, /data-render-boundary="presentation-only"/);
  assert.match(filesHtml, /workspace-file-viewer-tree/);
});

test('ResultsRenderer screen pane renders active Computer Use frame source and refs-first state', () => {
  const screenRef = 'computer-use:session/run-screen/virtual-screens.json#screen-1';
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [completedRun('run-screen')],
    artifacts: [{
      id: 'computer-use-screen-run',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      metadata: { runId: 'run-screen' },
      data: {
        title: 'Computer Use Screen',
        status: 'blocked',
        sessionRef: 'computer-use:session/run-screen/manifest.json',
        displayGroupRef: 'computer-use:session/run-screen/display-group.json',
        screenRef,
        visibleScreenRefs: [screenRef],
        visibleCursorRefs: ['computer-use:session/run-screen/cursors/agent.json'],
        frameRefs: [{
          ref: 'computer-use:session/run-screen/frames/after.png',
          screenRef,
          frameUrl: '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter.png',
          frameDataRef: 'computer-use:session/run-screen/frame-data/after.json',
          beforeEvidenceRef: 'computer-use:session/run-screen/evidence/before.json',
          afterEvidenceRef: 'computer-use:session/run-screen/evidence/after.json',
          cursorOverlayRefs: ['computer-use:session/run-screen/overlays/cursors.json'],
          leaseOwnerRefs: ['computer-use:session/run-screen/leases/screen-1.json'],
          proposalRef: 'computer-use:session/run-screen/proposals/click.json',
        }],
        replayRef: 'computer-use:session/run-screen/replay.json',
        leaseOwnerRefs: [{ ref: 'computer-use:session/run-screen/leases/screen-1.json', status: 'held', ownerRef: 'computer-use:session/run-screen/actors/agent.json' }],
        proposals: [{ ref: 'computer-use:session/run-screen/proposals/click.json', status: 'needs-confirmation', frameRef: 'computer-use:session/run-screen/frames/after.png' }],
        completionEvidenceRef: 'computer-use:session/run-screen/evidence/completion.json',
        validationRef: 'computer-use:session/run-screen/validation.json',
        currentBundleRef: 'computer-use:session/run-screen/current-bundle.json',
        evidenceBundleIndexRef: 'computer-use:session/run-screen/evidence/index.json',
        sidecarBindingRef: 'computer-use:session/run-screen/sidecar/binding.json',
        sidecarCapabilitiesRef: 'computer-use:session/run-screen/sidecar/capabilities.json',
        sidecarDiscoveryRef: 'computer-use:session/run-screen/sidecar/discovery.json',
        runSummary: {
          status: 'blocked',
          screenCount: 2,
          actorCursorCount: 3,
          frameCount: 1,
          sidecarBindingKind: 'macos-native-virtual-screen',
          validationStatus: 'accepted',
          validationOk: true,
          realNativeSidecarExecuted: false,
          completionEligible: false,
        },
        blockedRef: 'computer-use:session/run-screen/blocked/permission.json',
        blockedReason: 'Screen recording permission pending.',
        permissionRef: 'computer-use:permission/run-screen.json',
        permissionStatus: 'blocked',
        permissionRequired: true,
        permissionGranted: false,
        sharedInputAllowed: false,
        leaseStatus: 'held',
        stopRef: 'computer-use:stop/run-screen',
        cancelLeaseRef: 'computer-use:lease/run-screen',
        screen: { width: 1280, height: 720, label: 'screen-1' },
        actorCursors: [{ actorId: 'agent', cursorId: 'cursor-agent', label: 'Agent', x: 480, y: 260, state: 'lease-held' }],
        rawScreenshot: 'RAW_SCREENSHOT_SHOULD_NOT_RENDER',
      },
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-screen', initialResultTab: 'screen' });

  assert.match(html, /data-testid="right-pane-virtual-screen-tool"/);
  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter\.png"/);
  assert.match(html, /data-frame-data-ref="computer-use:session\/run-screen\/frame-data\/after\.json"/);
  assert.match(html, /computer-use:session\/run-screen\/replay\.json/);
  assert.match(html, /computer-use:session\/run-screen\/overlays\/cursors\.json/);
  assert.match(html, /computer-use:session\/run-screen\/leases\/screen-1\.json/);
  assert.match(html, /data-cursor-state="lease-held"/);
  assert.match(html, /data-proposal-status="needs-confirmation"/);
  assert.match(html, /data-control-flag="permission status"/);
  assert.match(html, /class="virtual-screen-run-summary"/);
  assert.match(html, /data-run-summary-field="screens">screens: <strong>2<\/strong>/);
  assert.match(html, /data-run-summary-field="actor cursors">actor cursors: <strong>3<\/strong>/);
  assert.match(html, /data-run-summary-field="sidecar">sidecar: <strong>macos-native-virtual-screen<\/strong>/);
  assert.match(html, /data-run-summary-field="validation">validation: <strong>accepted<\/strong>/);
  assert.match(html, /data-run-summary-field="validation ok">validation ok: <strong>true<\/strong>/);
  assert.match(html, /computer-use:session\/run-screen\/validation\.json/);
  assert.match(html, /computer-use:session\/run-screen\/evidence\/index\.json/);
  assert.match(html, /data-status-reason="blocked"/);
  assert.match(html, /Screen recording permission pending/);
  assert.match(html, /\/computer-use stop --stop-ref/);
  assert.doesNotMatch(html, /RAW_SCREENSHOT_SHOULD_NOT_RENDER|data:image|providerRoute|desktopBridge/);
});

test('ResultsRenderer right pane terminal renders execution transcript', () => {
  const executionUnits: RuntimeExecutionUnit[] = [{
    id: 'EU-raw-id-should-not-be-command',
    tool: 'shell_command',
    params: '{"cmd":"npm test -- --watch=false"}',
    code: 'npm test -- --watch=false',
    status: 'failed',
    hash: 'hash-terminal',
    runId: 'run-terminal',
    stdoutRef: 'artifact:terminal-stdout',
    stderrRef: 'artifact:terminal-stderr',
    outputRef: 'artifact:terminal-output',
    failureReason: 'unit test failed',
    time: '2026-05-31T08:00:00.000Z',
    attempt: 2,
  }];
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      id: 'run-terminal',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'run tests',
      response: 'failed',
      createdAt: '2026-05-31T08:00:00.000Z',
    }],
    executionUnits,
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-terminal', initialResultTab: 'terminal' });

  assert.match(html, /data-testid="right-pane-terminal-tool"/);
  assert.match(html, /data-status="error"/);
  assert.match(html, /\$ npm test -- --watch=false/);
  assert.match(html, /\[stderr\] artifact:terminal-stderr/);
  assert.match(html, /\[stdout\] artifact:terminal-stdout/);
  assert.match(html, /\[output\] artifact:terminal-output/);
  assert.match(html, /\[failed\] unit test failed/);
  assert.match(html, /<dt>Mode<\/dt>\s*<dd>transcript<\/dd>/);
  assert.match(html, /data-mode="transcript"/);
  assert.match(html, /data-terminal-session-adapter="host-owned-terminal-session"/);
  assert.match(html, /data-session-id="run-terminal"/);
  assert.match(html, /data-transcript-ref="artifact:terminal-stdout"/);
  assert.match(html, /data-pty-transcript-ref="pty-transcript:hash-terminal"/);
  assert.doesNotMatch(html, /\$ EU-raw-id-should-not-be-command/);
});

test('ResultsRenderer terminal tab contains only terminal session surface', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      id: 'run-terminal-only',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'run command',
      response: 'done',
      createdAt: '2026-05-31T08:00:00.000Z',
    }],
    executionUnits: [{
      id: 'EU-terminal-only',
      tool: 'shell_command',
      params: '{"cmd":"git status --short"}',
      code: 'git status --short',
      status: 'done',
      hash: 'terminal-only',
      runId: 'run-terminal-only',
      stdoutRef: 'artifact:terminal-only-stdout',
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-terminal-only', initialResultTab: 'terminal' });

  assert.match(html, /data-testid="right-pane-terminal-tool"/);
  assert.match(html, /data-component-id="terminal-session-viewer"/);
  assert.match(html, /data-status="completed"/);
  assert.match(html, /\$ git status --short/);
  assert.doesNotMatch(html, /Active result|当前结果/);
  assert.doesNotMatch(html, /data-component-id="execution-provenance-table"|audit-details-panel|NotebookTimeline/);
});

test('ResultsRenderer terminal tab falls back to transcript controls without live output', () => {
  const html = renderResultsRenderer(emptySession(), { initialResultTab: 'terminal' });

  assert.match(html, /data-testid="right-pane-terminal-tool"/);
  assert.match(html, /data-component-id="terminal-session-viewer"/);
  assert.match(html, /data-status="stopped"/);
  assert.match(html, /data-mode="transcript"/);
  assert.match(html, /data-requested-mode="transcript"/);
  assert.match(html, /data-terminal-session-adapter="host-owned-terminal-session"/);
  assert.match(html, /data-transcript-ref="terminal-transcript:right-pane"/);
  assert.match(html, /data-pty-transcript-ref="pty-transcript:right-pane"/);
  assert.match(html, /\$ ask --help/);
  assert.match(html, /Waiting for an attached terminal session or run output/);
  assert.match(html, /name="terminal-input"[^>]*disabled=""/);
  assert.match(html, /data-terminal-event="copy-request"/);
  assert.match(html, /data-terminal-event="download-request"/);
  assert.doesNotMatch(html, /data-terminal-live-surface="host-owned"/);
});

test('ResultsRenderer right pane terminal callbacks use terminal-equivalent commands', () => {
  const source = readFileSync(new URL('./ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/terminal input --session/);
  assert.match(source, /\/terminal paste --session/);
  assert.match(source, /\/terminal resize --session/);
  assert.match(source, /\/terminal copy --session/);
  assert.match(source, /\/terminal download --session/);
  assert.match(source, /\/terminal stop --session/);
  assert.match(source, /\/terminal focus --session/);
  assert.doesNotMatch(source, /navigator\.clipboard\?\.writeText\(buffer\)/);
});

test('ResultsRenderer screen tab derives Computer Use frame and replay refs from current run artifacts', () => {
  const artifact: RuntimeArtifact = {
    id: 'cu-screen-run',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-cu-screen' },
    data: {
      sessionRef: 'computer-use:session/run-cu-screen/session.json',
      screenRef: 'computer-use:screen/run-cu-screen/screen-1.json',
      frameRefs: ['.sciforge/computer-use/run-cu-screen/latest.png'],
      replayRef: 'computer-use:replay/run-cu-screen/replay.json',
      validationRef: 'computer-use:validation/run-cu-screen/validation.json',
      evidenceBundleIndexRef: 'computer-use:evidence/run-cu-screen/index.json',
      sidecarBindingKind: 'diagnostic-local',
      validationStatus: 'accepted',
      validationOk: true,
      realNativeSidecarExecuted: false,
      completionEligible: false,
      visibleCursorRefs: ['computer-use:cursor/run-cu-screen/agent.json'],
      actorCursors: [{ actorId: 'agent-1', label: 'Agent', x: 42, y: 64, state: 'watching' }],
      isolation: { sharedSystemInputUsed: false, systemPointerMoved: false, systemKeyboardEventsSent: false, inputExecuted: false, diagnosticOnly: true },
      screen: { width: 100, height: 80, label: 'screen-1' },
    },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [completedRun('run-cu-screen')],
    artifacts: [artifact],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-cu-screen', initialResultTab: 'screen' });

  assert.match(html, /data-testid="right-pane-virtual-screen-tool"/);
  assert.match(html, /data-status="ready"/);
  assert.match(html, /.sciforge\/computer-use\/run-cu-screen\/latest\.png/);
  assert.match(html, /computer-use:replay\/run-cu-screen\/replay\.json/);
  assert.match(html, /data-run-summary-status="ready"/);
  assert.match(html, /computer-use:validation\/run-cu-screen\/validation\.json/);
  assert.match(html, /computer-use:evidence\/run-cu-screen\/index\.json/);
  assert.match(html, /data-run-summary-field="sidecar">sidecar: <strong>diagnostic-local<\/strong>/);
  assert.match(html, /data-run-summary-field="validation">validation: <strong>accepted<\/strong>/);
  assert.match(html, /\/computer-use observe --screen-ref &quot;computer-use:screen\/run-cu-screen\/screen-1\.json&quot;/);
  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=.sciforge%2Fcomputer-use%2Frun-cu-screen%2Flatest\.png&amp;workspacePath=%2Ftmp%2Fsciforge"/);
  assert.match(html, /Agent/);
  assert.doesNotMatch(html, /virtual-desktop-session-manifest\.json/);
  assert.doesNotMatch(html, /providerRoute|executorLease|desktopBridge|rawScreenshot|base64/);
});

test('ResultsRenderer screen tab does not reuse old session screen when active run has no screen artifact', () => {
  const oldArtifact: RuntimeArtifact = {
    id: 'cu-screen-old-run',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-old-screen' },
    data: {
      sessionRef: 'computer-use:session/run-old-screen/session.json',
      screenRef: 'computer-use:screen/run-old-screen/screen-1.json',
      frameRefs: ['.sciforge/computer-use/run-old-screen/latest.png'],
      replayRef: 'computer-use:replay/run-old-screen/replay.json',
      screen: { width: 100, height: 80, label: 'old-screen' },
    },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [
      completedRun('run-old-screen'),
      { ...completedRun('run-current-no-screen'), status: 'running' },
    ],
    artifacts: [oldArtifact],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-current-no-screen', initialResultTab: 'screen' });

  assert.match(html, /data-testid="right-pane-virtual-screen-tool"/);
  assert.match(html, /data-status="empty"/);
  assert.match(html, /Virtual screen refs are not attached/);
  assert.doesNotMatch(html, /run-old-screen|old-screen|latest\.png|computer-use:replay\/run-old-screen/);
});

test('ResultsRenderer references tab is an object ref inspector with focus/open actions', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-ref',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-refs' },
    data: { markdown: '# Report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-refs'),
      objectReferences: [{
        id: 'file-ref',
        kind: 'file',
        title: 'PROJECT.md',
        ref: 'file:PROJECT.md',
        status: 'available',
        actions: ['focus-right-pane', 'copy-path'],
      }],
    }],
    artifacts: [artifact],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-refs', initialResultTab: 'evidence' });

  assert.match(html, /data-testid="right-pane-references-tool"/);
  assert.match(html, /data-reference-kind="artifact"/);
  assert.match(html, /data-reference-kind="file"/);
  assert.match(html, /data-focus-target="primary"/);
  assert.match(html, /data-focus-target="files"/);
  assert.match(html, />Open<\/button>/);
  assert.match(html, /PROJECT\.md/);
  assert.doesNotMatch(html, /supportingRefs|opposingRefs|raw JSON/i);
});

test('ResultsRenderer browser tool uses normalized urls and typed Browser state', () => {
  const browserHtml = renderResultsRenderer(emptySession(), { initialResultTab: 'browser' });

  assert.match(browserHtml, /\/browser open &quot;about:blank&quot; --surface workbench/);
  assert.match(browserHtml, /data-browser-state="idle"/);
  assert.doesNotMatch(browserHtml, /src="localhost:/);
});

test('ResultsRenderer restores right pane tabs and Browser address from localStorage', () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  storage.setItem('sciforge.right-pane-state.v1./tmp/sciforge', JSON.stringify({
    tabs: [
      { id: 'base:primary', kind: 'primary', label: 'Results', closable: true },
      { id: 'base:browser', kind: 'browser', label: 'Browser', closable: true },
      { id: 'custom:browser:test:2', kind: 'browser', label: 'Browser 2', closable: true },
    ],
    activeTabId: 'custom:browser:test:2',
    browserTabAddresses: {
      'custom:browser:test:2': 'https://example.org',
    },
  }));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    const html = renderResultsRenderer(emptySession());

    assert.match(html, /data-result-tab="browser"/);
    assert.match(html, />Browser 2</);
    assert.match(html, /aria-selected="true"[^>]*><span>Browser 2<\/span>/);
    assert.match(html, /value="https:\/\/example\.org"/);
    assert.match(html, /data-browser-state="blocked"/);
    assert.match(html, /X-Frame-Options or Content-Security-Policy/);
    assert.match(html, /data-browser-state-action="open-external"/);
    assert.match(html, /data-browser-state-action="proxy-fallback"/);
    assert.match(html, /href="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Fexample\.org"/);
    assert.match(html, /\/browser open-external &quot;https:\/\/example\.org&quot; --approval required/);
    assert.doesNotMatch(html, /src="about:blank"/);
    assert.doesNotMatch(html, /src="https:\/\/example\.org"/);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('ResultsRenderer restores an explicitly empty right pane without recreating default tabs', () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  storage.setItem('sciforge.right-pane-state.v1./tmp/sciforge', JSON.stringify({
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {
      'custom:browser:closed:1': 'https://closed.example.test',
    },
  }));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    const html = renderResultsRenderer(emptySession());

    assert.match(html, /data-testid="right-pane-empty-workspace"/);
    assert.match(html, /No pages open/);
    assert.match(html, /class="result-new-tab-button"/);
    assert.doesNotMatch(html, /role="tab"/);
    assert.doesNotMatch(html, /class="result-active-tab-close"/);
    assert.doesNotMatch(html, /closed\.example\.test|Nothing to preview yet|aria-selected="true"/);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('ResultsRenderer keeps Browser URLs independent per restored tab', () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  const persistedTabs = [
    { id: 'custom:browser:first:1', kind: 'browser', label: 'Browser', closable: true },
    { id: 'custom:browser:second:2', kind: 'browser', label: 'Browser 2', closable: true },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    storage.setItem('sciforge.right-pane-state.v1./tmp/sciforge', JSON.stringify({
      tabs: persistedTabs,
      activeTabId: 'custom:browser:second:2',
      browserTabAddresses: {
        'custom:browser:first:1': 'localhost:4173/first',
        'custom:browser:second:2': 'https://example.org/second',
      },
    }));
    const secondHtml = renderResultsRenderer(emptySession());

    assert.match(secondHtml, /aria-selected="true"[^>]*><span>Browser 2<\/span>/);
    assert.match(secondHtml, /value="https:\/\/example\.org\/second"/);
    assert.match(secondHtml, /\/browser open-external &quot;https:\/\/example\.org\/second&quot; --approval required/);
    assert.doesNotMatch(secondHtml, /value="localhost:4173\/first"|src="http:\/\/localhost:4173\/first"/);

    storage.setItem('sciforge.right-pane-state.v1./tmp/sciforge', JSON.stringify({
      tabs: persistedTabs,
      activeTabId: 'custom:browser:first:1',
      browserTabAddresses: {
        'custom:browser:first:1': 'localhost:4173/first',
        'custom:browser:second:2': 'https://example.org/second',
      },
    }));
    const firstHtml = renderResultsRenderer(emptySession());

    assert.match(firstHtml, /aria-selected="true"[^>]*><span>Browser<\/span>/);
    assert.match(firstHtml, /value="localhost:4173\/first"/);
    assert.match(firstHtml, /src="http:\/\/localhost:4173\/first"/);
    assert.doesNotMatch(firstHtml, /value="https:\/\/example\.org\/second"|\/browser open-external &quot;https:\/\/example\.org\/second/);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('ResultsRenderer restores persisted New/Close state and Browser URL without closed pages', () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  storage.setItem('sciforge.right-pane-state.v1./tmp/sciforge', JSON.stringify({
    tabs: [
      { id: 'custom:browser:persisted:2', kind: 'browser', label: 'Browser 2', closable: true },
    ],
    activeTabId: 'custom:browser:persisted:2',
    browserTabAddresses: {
      'custom:browser:persisted:2': 'localhost:4173/preview',
      'custom:browser:closed:3': 'https://closed.example.test',
    },
  }));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    const html = renderResultsRenderer(emptySession());

    assert.match(html, /class="result-new-tab-button"/);
    assert.match(html, /aria-label="New right pane page"/);
    assert.match(html, /class="result-active-tab-close"[^>]*aria-label="Close Browser 2"/);
    assert.match(html, /aria-selected="true"[^>]*><span>Browser 2<\/span>/);
    assert.match(html, /value="localhost:4173\/preview"/);
    assert.match(html, /src="http:\/\/localhost:4173\/preview"/);
    assert.match(html, /\/browser open &quot;http:\/\/localhost:4173\/preview&quot; --surface workbench/);
    assert.doesNotMatch(html, /closed\.example\.test|result-tab-base-primary/);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('ResultsRenderer shows clicked workspace files as editable right-pane tree view', () => {
  const fileReference: ObjectReference = {
    id: 'file-project',
    kind: 'file',
    title: 'PROJECT.md',
    ref: 'file:PROJECT.md',
    status: 'available',
    actions: ['focus-right-pane'],
  };
  const html = renderResultsRenderer(emptySession(), {
    focusedObjectReference: fileReference,
    workspaceFileEditor: {
      file: {
        path: '/tmp/sciforge/PROJECT.md',
        name: 'PROJECT.md',
        content: '# Project\n',
        size: 10,
        language: 'markdown',
      },
      draft: '# Project\n\nEdited draft.\n',
    },
  });

  assert.match(html, /workspace-file-viewer/);
  assert.match(html, /workspace-file-viewer-tree/);
  assert.match(html, /workspace-file-viewer-editor/);
  assert.match(html, /data-component-id="workspace-file-viewer"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /PROJECT\.md/);
  assert.match(html, /textarea/);
  assert.match(html, /Edited draft/);
  assert.doesNotMatch(html, /workspace-file-inline-viewer/);
});

test('ResultsRenderer files tab exposes read, edit, and save affordances for selected workspace files', () => {
  const html = renderResultsRenderer(emptySession(), {
    initialResultTab: 'files',
    workspaceFileEditor: {
      file: {
        path: '/tmp/sciforge/src/app/ResultsRenderer.tsx',
        name: 'ResultsRenderer.tsx',
        content: 'export const before = true;\n',
        size: 28,
        language: 'typescript',
      },
      draft: 'export const after = true;\n',
      workspacePath: '/tmp/sciforge',
    },
  });

  assert.match(html, /data-testid="right-pane-files-tool"/);
  assert.match(html, /data-component-id="workspace-file-viewer"/);
  assert.match(html, /workspace-file-viewer-tree/);
  assert.match(html, /workspace-file-viewer-editor/);
  assert.match(html, /ResultsRenderer\.tsx/);
  assert.match(html, /textarea/);
  assert.match(html, /export const after = true/);
  assert.match(html, /Read only/);
  assert.match(html, /Unsaved/);
  assert.match(html, /aria-label="Edit"/);
  assert.match(html, /aria-label="Save file"/);
  assert.match(html, /aria-label="Close file view"/);
  assert.match(html, /aria-label="Copy path"/);
  assert.match(html, /aria-label="Copy contents"/);
  assert.doesNotMatch(html, /workspace-file-inline-viewer/);
});

test('ResultsRenderer scopes cursor process file views to the originating run workspace', () => {
  const fileReference: ObjectReference = {
    id: 'file-project',
    kind: 'file',
    title: 'PROJECT.md',
    ref: 'file:PROJECT.md',
    runId: 'run-with-workspace',
    status: 'available',
    provenance: { path: 'PROJECT.md', producer: 'cursor-agent-process' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      id: 'run-with-workspace',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'read file',
      response: 'done',
      createdAt: '2026-05-09T00:00:00.000Z',
      raw: {
        streamProcess: {
          events: [{
            type: 'workspace-runtime-event',
            native: { workspace: '/tmp/runtime-root', rawType: 'run_started' },
          }],
        },
      },
    }],
  };
  const html = renderResultsRenderer(session, {
    activeRunId: 'run-with-workspace',
    focusedObjectReference: fileReference,
    workspaceFileEditor: {
      file: {
        path: '/tmp/runtime-root/PROJECT.md',
        name: 'PROJECT.md',
        content: '# Project\n',
        size: 10,
        language: 'markdown',
      },
      draft: '# Project\n',
    },
  });

  assert.match(html, /runtime-root/);
  assert.doesNotMatch(html, /tmp\/sciforge/);
});

test('ResultsRenderer uses resolved file editor workspace root for fallback previews', () => {
  const html = renderResultsRenderer(emptySession(), {
    workspaceFileEditor: {
      file: {
        path: '/tmp/sciforge-repo/src/runtime/gateway/agentserver-stream.ts',
        name: 'agentserver-stream.ts',
        content: 'export const ok = true;\n',
        size: 24,
        language: 'typescript',
      },
      draft: 'export const ok = true;\n',
      workspacePath: '/tmp/sciforge-repo',
    },
  });

  assert.match(html, /sciforge-repo/);
  assert.match(html, /agentserver-stream\.ts/);
  assert.doesNotMatch(html, /tmp\/sciforge"/);
});

test('ResultsRenderer allows repo-root fallback for safe relative file references from replies', () => {
  const replyReference: ObjectReference = {
    id: 'reply-file',
    kind: 'file',
    title: 'agentserver-stream.ts',
    ref: 'file:src/runtime/gateway/agentserver-stream.ts',
    status: 'available',
    provenance: { path: 'src/runtime/gateway/agentserver-stream.ts', producer: 'message-inline-reference' },
  };

  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, 'src/runtime/gateway/agentserver-stream.ts'), true);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '../config.local.json'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '.env'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '.sciforge/workspace-state.json'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '/Applications/workspace/SciForge/PROJECT.md'), false);
});

test('ResultsRenderer focus request keys stay stable while the file viewer browses another file', () => {
  const reference: ObjectReference = {
    id: 'process-file',
    kind: 'file',
    title: 'agentserver-stream.ts',
    ref: 'file:src/runtime/gateway/agentserver-stream.ts',
    runId: 'run-a',
    status: 'available',
    provenance: { path: 'src/runtime/gateway/agentserver-stream.ts', producer: 'cursor-agent-process' },
  };
  const key = workspaceFileFocusRequestKey(reference, 'src/runtime/gateway/agentserver-stream.ts');
  const browsedEditor: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge-repo/src/runtime/gateway/capability-broker.ts',
      name: 'capability-broker.ts',
      content: 'export {};\n',
      size: 11,
      language: 'typescript',
    },
    draft: 'export {};\n',
    workspacePath: '/tmp/sciforge-repo',
    focusRequestKey: key,
  };

  assert.equal(browsedEditor.focusRequestKey, key);
  assert.notEqual(browsedEditor.file.path, '/tmp/sciforge-repo/src/runtime/gateway/agentserver-stream.ts');
  assert.notEqual(workspaceFileFocusRequestKey({ ...reference, id: 'other-file' }, 'src/runtime/gateway/agentserver-stream.ts'), key);
});

test('ResultsRenderer scopes Files editor state by right-pane tab id', () => {
  const first: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/first.md',
      name: 'first.md',
      content: '# First\n',
      size: 8,
      language: 'markdown',
    },
    draft: '# First draft\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  };
  const second: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/second.md',
      name: 'second.md',
      content: '# Second\n',
      size: 9,
      language: 'markdown',
    },
    draft: '# Second draft\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  };
  const withFirst = setWorkspaceFileEditorForTab({}, 'base:files', first);
  const withBoth = setWorkspaceFileEditorForTab(withFirst, 'custom:files:2', second);
  const changedFirst = setWorkspaceFileEditorForTab(withBoth, 'base:files', { ...first, draft: '# First changed\n' });
  const closedFirst = removeWorkspaceFileEditorForTab(changedFirst, 'base:files');

  assert.equal(changedFirst['base:files']?.draft, '# First changed\n');
  assert.equal(changedFirst['custom:files:2']?.draft, '# Second draft\n');
  assert.equal(closedFirst['base:files'], undefined);
  assert.equal(closedFirst['custom:files:2']?.file.path, '/tmp/sciforge/second.md');
});

test('ResultsRenderer cancel edit restores the original file draft without closing the Files tab', () => {
  const file = {
    path: '/tmp/sciforge/PROJECT.md',
    name: 'PROJECT.md',
    content: '# Original\n',
    size: 11,
    language: 'markdown',
  };
  const cancelled = cancelWorkspaceFileEditorEdit({
    file,
    draft: '# Changed\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  });

  assert.equal(cancelled.file, file);
  assert.equal(cancelled.draft, '# Original\n');
  assert.equal(cancelled.editMode, false);
});

test('ResultsRenderer keeps raw failure text out of the first-screen main summary while preserving audit details', () => {
  const session = contractFailureSession();
  const longReason = [
    'ContractValidationFailure work-evidence; contractId=sciforge.work-evidence.v1; schemaPath=packages/contracts/runtime/work-evidence-policy.ts#evaluateWorkEvidencePolicy;',
    'reason=Contract validation failed because generated work evidence did not include durable evidenceRefs and rawRef for a completed external retrieval.',
    'Previous failure: External retrieval returned zero results while the task marked itself completed.',
    'Treat this as repair-needed until the task records provider status, query/url, retry/fallback attempts, rate-limit diagnostics, and durable refs.',
  ].join(' ');
  session.executionUnits[0]!.failureReason = longReason;
  session.runs[0]!.raw = {
    ...session.runs[0]!.raw as Record<string, unknown>,
    blocker: longReason,
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-contract-failure' });
  const supportHtml = stripRuntimeStateHook(html);
  const auditStart = supportHtml.indexOf('<details class="result-details-panel audit-details-panel"');
  const summaryHtml = supportHtml.slice(0, auditStart);

  assert.doesNotMatch(summaryHtml, /External retrieval returned zero results while the task marked itself completed/);
  assert.doesNotMatch(summaryHtml, /retry\/fallback attempts, rate-limit diagnostics, and durable refs/);
  assert.doesNotMatch(supportHtml, /retry\/fallback attempts, rate-limit diagnostics, and durable refs/);
  assert.match(supportHtml, /More/);
  assert.doesNotMatch(html, /raw payload|ToolPayload|stdout|stderr|task attempts|handoff JSON/i);
  assert.doesNotMatch(html, /<details class="result-details-panel audit-details-panel" open/);
});

test('hidden result slots are scoped to the active run when a run is selected', () => {
  const runA = {
    ...completedRun('run-a'),
    raw: {
      resultPresentation: projectionResultPresentation('run-a', ['artifact:report-a']),
      uiManifest: [{ componentId: 'report-viewer', artifactRef: 'report', title: 'Report' }],
      artifacts: [{
        id: 'report-a',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { runId: 'run-a' },
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:report',
          role: 'primary-deliverable',
          declaredMediaType: 'text/markdown',
          declaredExtension: 'md',
          contentShape: 'raw-file',
          readableRef: '.sciforge/artifacts/run-a/report.md',
          previewPolicy: 'inline',
        },
        data: { markdown: '# Report A' },
      }],
    },
  };
  const runB = {
    ...completedRun('run-b'),
    raw: {
      resultPresentation: projectionResultPresentation('run-b', ['artifact:report-b']),
      uiManifest: [{ componentId: 'report-viewer', artifactRef: 'report', title: 'Report' }],
      artifacts: [{
        id: 'report-b',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { runId: 'run-b' },
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:report',
          role: 'primary-deliverable',
          declaredMediaType: 'text/markdown',
          declaredExtension: 'md',
          contentShape: 'raw-file',
          readableRef: '.sciforge/artifacts/run-b/report.md',
          previewPolicy: 'inline',
        },
        data: { markdown: '# Report B' },
      }],
    },
  };
  const session: SciForgeSession = withMaterializedProjectionFixture({
    ...emptySession(),
    runs: [runA, runB],
    artifacts: [
      (runA.raw as { artifacts: RuntimeArtifact[] }).artifacts[0],
      (runB.raw as { artifacts: RuntimeArtifact[] }).artifacts[0],
    ],
  });
  const runAView = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [],
    activeRun: runA,
    focusMode: 'all',
  });
  assert.ok(runAView.visibleItems.length > 0);
  const hiddenSession = {
    ...session,
    hiddenResultSlotIds: runAView.viewPlan.allItems.map((item) => `${runA.id}:${item.id}`),
  };

  const hiddenA = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session: hiddenSession,
    defaultSlots: [],
    activeRun: runA,
    focusMode: 'all',
  });
  const visibleB = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session: hiddenSession,
    defaultSlots: [],
    activeRun: runB,
    focusMode: 'all',
  });

  assert.equal(hiddenA.visibleItems.length, 0);
  assert.ok(visibleB.visibleItems.length > 0);
});

test('ResultsRenderer empty completed run is presented as empty rather than ready', () => {
  const session = {
    ...emptySession(),
    runs: [completedRun('run-empty-artifacts')],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-empty-artifacts' });

  assert.match(html, /Nothing to preview yet/);
  assert.match(html, /The main answer stays in chat\. Previewable files and artifacts appear here when available\./);
  assert.doesNotMatch(html, /重新运行或要求生成可展示 artifact/);
  assert.doesNotMatch(html, /ready result/);
});

test('ResultsRenderer support pane summarizes projection tracebacks instead of showing raw error text', () => {
  const traceback = [
    'Traceback (most recent call last):',
    '  File "/opt/homebrew/Caskroom/miniconda/base/lib/python3.13/site-packages/urllib3/connectionpool.py", line 787, in urlopen',
    '    response = self._make_request(conn)',
    'urllib3.exceptions.MaxRetryError: HTTPSConnectionPool(host="export.arxiv.org", port=443): Max retries exceeded',
  ].join('\n');
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-projection-traceback'),
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-traceback',
            visibleAnswer: {
              status: 'visible-not-live-acceptance',
              text: traceback,
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-projection-traceback' });

  assert.match(html, /Answer shown/);
  assert.match(html, /The task did not finish/);
  assert.doesNotMatch(stripRuntimeStateHook(html), /Traceback|urllib3|export\.arxiv|\/opt\/homebrew/i);
});

test('ResultsRenderer keeps plain native answers in chat instead of duplicating them in the right pane', () => {
  const answer = '简洁直给，少说废话。回复直奔主题，先给结论再展开。';
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-plain-native-answer'),
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-plain-answer',
            visibleAnswer: {
              status: 'visible-not-live-acceptance',
              text: answer,
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-plain-native-answer' });

  assert.match(html, /Nothing to preview yet/);
  assert.doesNotMatch(html, /Answer shown/);
  assert.doesNotMatch(html, /简洁直给/);
});

test('ResultsRenderer keeps satisfied plain text answers out of the right pane', () => {
  const answer = '过程入口要轻，普通文字回答留在聊天里。';
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-satisfied-plain-answer'),
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-satisfied-plain-answer',
            visibleAnswer: {
              status: 'satisfied',
              text: answer,
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-satisfied-plain-answer' });

  assert.match(html, /Nothing to preview yet/);
  assert.doesNotMatch(html, /Answer shown|过程入口要轻/);
});

test('ResultsRenderer lets projection satisfied state suppress raw failed run and execution unit UI', () => {
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-projection-visible-ready'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        failureReason: 'LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER',
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-visible-ready',
            currentTurn: { id: 'turn-ready', prompt: 'summarize refs' },
            visibleAnswer: {
              status: 'satisfied',
              text: 'Projection-visible answer is authoritative.',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: ['run:projection-visible-ready'],
            diagnostics: [],
          },
        },
      },
    }],
    executionUnits: [{
      id: 'EU-legacy-failed',
      tool: 'legacy.raw',
      params: '{}',
      status: 'repair-needed',
      hash: 'legacy',
      failureReason: 'LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER',
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-projection-visible-ready' });

  assert.match(html, /Nothing to preview yet/);
  assert.doesNotMatch(html, /Projection-visible answer is authoritative/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.doesNotMatch(html, /LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(html, /LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(html, /audit-details-panel/);
});

test('ResultsRenderer restores projection from ConversationEventLog before stale raw projection', () => {
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-event-log-authoritative'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        displayIntent: {
          conversationEventLog: {
            schemaVersion: 'sciforge.conversation-event-log.v1',
            conversationId: 'conversation-event-log-authoritative',
            events: [
              {
                id: 'turn-event-log',
                type: 'TurnReceived',
                storage: 'inline',
                actor: 'user',
                timestamp: '2026-05-13T00:00:00.000Z',
                turnId: 'turn-event-log',
                payload: { prompt: 'restore from event log' },
              },
              {
                id: 'blocked-event-log',
                type: 'ExternalBlocked',
                storage: 'ref',
                actor: 'runtime',
                timestamp: '2026-05-13T00:00:01.000Z',
                turnId: 'turn-event-log',
                runId: 'run-event-log-authoritative',
                payload: {
                  summary: 'provider transport failed',
                  reason: 'RECORDED_EVENT_LOG_FAILURE',
                  refs: [{ ref: 'log:event-log-provider-stderr', digest: 'sha256:event-log' }],
                },
              },
            ],
          },
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'stale-projection',
            visibleAnswer: {
              status: 'satisfied',
              text: 'STALE_RAW_PROJECTION_SHOULD_NOT_RENDER',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-event-log-authoritative' });
  const mainHtml = stripRuntimeStateHook(html);

  assert.match(html, /RECORDED_EVENT_LOG_FAILURE/);
  assert.doesNotMatch(mainHtml, /STALE_RAW_PROJECTION_SHOULD_NOT_RENDER/);
});

test('ResultsRenderer uses projection execution process instead of raw execution units in execution focus', () => {
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-projection-execution'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-projection-execution',
            currentTurn: { id: 'turn-projection-execution', prompt: 'summarize refs' },
            visibleAnswer: {
              status: 'satisfied',
              text: 'Projection-visible answer is authoritative.',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [{
              eventId: 'event-projection-output',
              type: 'OutputMaterialized',
              summary: 'Projection output was materialized from event log.',
              timestamp: '2026-05-13T00:00:01.000Z',
            }],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: ['execution-unit:EU-legacy-raw'],
            diagnostics: [],
          },
        },
      },
    }],
    executionUnits: [{
      id: 'EU-legacy-raw',
      tool: 'legacy.raw.execution',
      params: '{}',
      status: 'repair-needed',
      hash: 'legacy',
      failureReason: 'LEGACY_RAW_EU_SHOULD_NOT_RENDER_IN_MAIN_EXECUTION_FOCUS',
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-projection-execution', initialFocusMode: 'execution' });
  const model = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [{ componentId: 'report-viewer', artifactRef: 'missing-report' }] as never,
    activeRun: session.runs[0],
    focusMode: 'all',
  });

  assert.match(html, /Activity/);
  assert.match(html, /Output: Projection output was materialized from event log/);
  assert.doesNotMatch(html, /legacy\.raw\.execution/);
  assert.doesNotMatch(html, /LEGACY_RAW_EU_SHOULD_NOT_RENDER_IN_MAIN_EXECUTION_FOCUS/);
  assert.equal(model.viewPlan.allItems.some((item) => item.module.moduleId === 'execution-provenance-table'), false);
});

test('ResultsRenderer renders Computer Use control plane without executor private params', () => {
  const controlArtifact: RuntimeArtifact = {
    id: 'computer-use-control-plane-run-visible',
    type: 'computer-use-control-plane',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.user-control-plane.presentation.v1',
    metadata: { title: 'Computer Use controls', presentationRole: 'supporting-evidence' },
    data: {
      schemaVersion: 'sciforge.computer-use.user-control-plane.presentation.v1',
      sessionPermissionRef: 'computer-use:permission/right-pane.json',
      allowedAppRefs: ['computer-use:allowlist/apps/presentation.json'],
      allowedWindowRefs: ['computer-use:allowlist/windows/deck-editor.json'],
      forbiddenAppRefs: ['computer-use:allowlist/forbidden/messages.json'],
      riskPreviewRef: 'computer-use:risk/right-pane.json',
      dataVisibilityRef: 'computer-use:data-visibility/right-pane.json',
      stopRef: 'computer-use:stop/right-pane',
      cancelLeaseRef: 'computer-use:lease/right-pane',
      approvalMode: 'required',
      status: 'needs-confirmation',
      approvalRef: 'approval:computer-use:right-pane',
      providerRoute: 'SHOULD_NOT_RENDER',
      executorLease: { screenId: 'SHOULD_NOT_RENDER' },
      schedulerParams: { leaseScope: 'SHOULD_NOT_RENDER' },
    },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:computer-use-control-plane-run-visible',
      role: 'supporting-evidence',
      declaredMediaType: 'application/vnd.sciforge.computer-use-control-plane+json',
      declaredExtension: '.json',
      contentShape: 'external-ref',
      readableRef: 'artifact:computer-use-control-plane-run-visible',
      previewPolicy: 'inline',
    },
  };
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-computer-use-control-plane'),
      raw: {
        resultPresentation: projectionResultPresentation('run-computer-use-control-plane', ['artifact:computer-use-control-plane-run-visible']),
      },
    }],
    artifacts: [controlArtifact],
    uiManifest: [{
      componentId: 'computer-use-control-plane',
      artifactRef: 'computer-use-control-plane-run-visible',
      priority: 1,
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-computer-use-control-plane' });

  assert.match(html, /computer-use-control-plane/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /computer-use:permission\/right-pane\.json/);
  assert.match(html, /\/computer-use stop --stop-ref/);
  assert.match(html, /\/computer-use approve --approval-ref/);
  assert.doesNotMatch(html, /SHOULD_NOT_RENDER|providerRoute|executorLease|schedulerParams|screenId|leaseScope/);
});

test('ResultsRenderer surfaces runtime compatibility drift without rerunning old sessions', () => {
  const session = {
    ...emptySession(),
    messages: [{ id: 'msg-old-session', role: 'user', content: 'continue old work', createdAt: '2026-05-09T00:00:00.000Z' }],
    runtimeCompatibilityDiagnostics: [{
      schemaVersion: 1,
      id: 'runtime-drift-session-empty',
      kind: 'capability-version-drift',
      severity: 'warning',
      reason: 'Historical session contract differs from the current runtime.',
      current: {
        schemaVersion: 1,
        appStateSchemaVersion: 2,
        sessionSchemaVersion: 2,
        compatibilityVersion: 'current-runtime',
        capabilityFingerprints: ['objectReferenceKinds:abc'],
      },
      persisted: {
        schemaVersion: 1,
        appStateSchemaVersion: 2,
        sessionSchemaVersion: 2,
        compatibilityVersion: 'old-runtime',
        capabilityFingerprints: ['objectReferenceKinds:old'],
      },
      affectedSessionId: 'session-empty',
      affectedScenarioId: 'literature-evidence-review',
      recoverable: true,
      recoverableActions: ['Migrate the session payload', 'Start a new run when drift blocks safe recovery'],
      createdAt: '2026-05-09T00:00:00.000Z',
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session);

  assert.match(html, /More/);
  assert.doesNotMatch(html, /capability-version-drift/);
  assert.doesNotMatch(html, /Historical session contract differs/);
  assert.doesNotMatch(html, /persisted: old-runtime/);
  assert.doesNotMatch(html, /Migrate the session payload/);
  assert.doesNotMatch(html, /正在重新运行|auto.?resume/i);
});

test('ResultsRenderer does not let raw running progress drive the main summary without projection', () => {
  const session = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-partial-first'),
      status: 'running',
      response: 'partial report is available',
      raw: {
        backgroundCompletion: {
          status: 'running',
          stages: [
            { stageId: 'metadata', status: 'completed', ref: 'run:run-partial-first#metadata' },
            { stageId: 'fulltext', status: 'running', ref: 'run:run-partial-first#fulltext' },
          ],
        },
        resultPresentation: {
          processSummary: { status: 'running', currentStage: 'fulltext', summary: 'Partial report is available.' },
          nextActions: [{ kind: 'continue', label: 'Use completed refs', ref: 'artifact:partial-report' }],
        },
      },
      objectReferences: [{ kind: 'artifact', id: 'obj-partial-report', ref: 'artifact:partial-report', title: 'Partial report' }] as never,
    }],
    executionUnits: [
      { id: 'EU-metadata', tool: 'metadata.fetch', params: '{}', status: 'done', hash: 'metadata', outputRef: 'artifact:partial-report' },
      { id: 'EU-fulltext', tool: 'fulltext.download', params: '{}', status: 'running', hash: 'fulltext', stdoutRef: 'run:run-partial-first/fulltext.log' },
    ],
    artifacts: [{
      id: 'partial-report',
      type: 'report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Partial report', runId: 'run-partial-first' },
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-partial-first' });

  assert.match(html, /Nothing to preview yet/);
  assert.match(html, /The main answer stays in chat\. Previewable files and artifacts appear here when available\./);
  assert.doesNotMatch(html, /report: Partial report/);
  assert.doesNotMatch(html, /Partial results ready|Still running/);
  assert.doesNotMatch(html, /Current stage: stage fulltext · running|Current stage: fulltext · running/);
  assert.doesNotMatch(html, /safe · Stop current background task/);
  assert.doesNotMatch(html, /safe · Use completed refs/);
});

test('ResultsRenderer execution focus renders only execution unit body', () => {
  const session = contractFailureSession();
  session.notebook = [{
    id: 'note-1',
    scenario: 'literature-evidence-review',
    time: '2026-05-09 00:01',
    title: 'Notebook note',
    desc: 'should be hidden in execution focus',
    claimType: 'fact',
    confidence: 0.4,
  }];

  const html = renderResultsRenderer(session, { activeRunId: 'run-contract-failure', initialFocusMode: 'execution' });

  assert.match(html, /Activity/);
  assert.match(html, /Needs recovery/);
  assert.doesNotMatch(html, /<h2>结果视图<\/h2>/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.doesNotMatch(html, /Notebook note/);
  assert.doesNotMatch(html, /Raw JSON \/ stdout \/ stderr refs/);
  assert.doesNotMatch(html, /展示摘要/);
});

test('ResultsRenderer execution focus shows background artifact stages as execution units', () => {
  const session = applyBackgroundCompletionEventToSession(emptySession(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-stage-update',
    runId: 'run-bg-render',
    stageId: 'stage-report',
    ref: 'run:run-bg-render#stage-report',
    status: 'running',
    message: '后台 report artifact 已写入。',
    artifacts: [{
      id: 'artifact-bg-render-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: '# Background report' },
    }],
    verificationResults: [{ id: 'verify-bg-render', verdict: 'pass' }],
    updatedAt: '2026-05-09T00:02:00.000Z',
  });

  const html = renderResultsRenderer(session, { activeRunId: 'run-bg-render', initialFocusMode: 'execution' });

  assert.match(html, /Activity/);
  assert.match(html, /Running/);
  assert.match(html, /Check passed/);
  assert.doesNotMatch(html, /EU-run-bg-render-stage-report|sciforge\.background-completion|audit ref\(s\) retained|verification:verify-bg-render|verdict=pass|run-bg-render|stage-report/);
});

test('ResultsRenderer execution table separates verification states from completed status', () => {
  const session = {
    ...emptySession(),
    runs: [completedRun('run-verification-states')],
    executionUnits: [
      { id: 'EU-ordinary', tool: 'report.emit', params: '{}', status: 'done', hash: 'ordinary', outputRef: 'run:run-verification-states#ordinary' },
      { id: 'EU-unverified', tool: 'report.emit', params: '{}', status: 'done', hash: 'unverified', outputRef: 'run:run-verification-states#unverified', verificationVerdict: 'unverified', verificationRef: 'verification:unverified' },
      { id: 'EU-verifying', tool: 'report.emit', params: '{}', status: 'running', hash: 'verifying', outputRef: 'run:run-verification-states#partial' },
      { id: 'EU-verification-failed', tool: 'verifier.run', params: '{}', status: 'done', hash: 'failed', outputRef: 'run:run-verification-states#failed', verificationVerdict: 'fail', verificationRef: 'verification:failed' },
      { id: 'EU-release-verified', tool: 'verifier.run', params: '{}', status: 'done', hash: 'passed', outputRef: 'run:run-verification-states#passed', verificationVerdict: 'pass', verificationRef: 'verification:passed' },
    ],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { activeRunId: 'run-verification-states', initialFocusMode: 'execution' });

  assert.match(html, /No check requested/);
  assert.match(html, /Not checked/);
  assert.match(html, /Checking/);
  assert.match(html, /Check failed/);
  assert.match(html, /Check passed/);
  assert.match(html, /Check: This step did not request verification/);
  assert.match(html, /Check: The result has not been verified/);
  assert.match(html, /Check: Verification is still running/);
  assert.match(html, /Check: The result did not pass verification/);
  assert.match(html, /Check: The result passed verification/);
  assert.doesNotMatch(html, /verificationStatus=|runtime verification|verification:unverified|verification:failed|verification:passed/);
});

test('ResultsRenderer renders shell execution activity through terminal-session-viewer package', () => {
  const session = {
    ...emptySession(),
    executionUnits: [{
      id: 'EU-shell-terminal',
      tool: 'shell_command',
      params: '{"cmd":"npm test -- --watch=false"}',
      code: 'npm test -- --watch=false',
      language: 'bash',
      status: 'done',
      hash: 'shell-hash',
      stdoutRef: 'artifact:shell-stdout',
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { initialFocusMode: 'execution' });

  assert.match(html, /terminal-session-viewer/);
  assert.match(html, /data-component-id="terminal-session-viewer"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /\$ npm test -- --watch=false/);
  assert.match(html, /\[ref\] stdout: artifact:shell-stdout/);
});

test('ResultsRenderer terminal activity avoids exposing raw execution unit ids as session labels', () => {
  const session = {
    ...emptySession(),
    executionUnits: [{
      id: 'EU-internal-shell-id',
      tool: 'shell_command',
      params: '{"cmd":"git status --short"}',
      code: 'git status --short',
      language: 'bash',
      status: 'running',
      hash: 'internal-shell-hash',
    }],
  } as SciForgeSession;

  const html = renderResultsRenderer(session, { initialFocusMode: 'execution' });

  assert.match(html, /terminal-session-viewer/);
  assert.match(html, /Terminal session terminal:activity-1/);
  assert.doesNotMatch(html, /Terminal session execution-unit:EU-internal-shell-id/);
});

test('ResultsRenderer execution focus scopes execution units to the active run', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [
      {
        ...completedRun('run-old'),
        objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report' }],
      },
      {
        ...completedRun('run-new'),
        objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
      },
    ] as never,
    executionUnits: [
      { id: 'EU-old', tool: 'old.tool', params: '{}', status: 'done', hash: 'old', outputRef: 'run:run-old#old-report' },
      { id: 'EU-new', tool: 'new.tool', params: '{}', status: 'done', hash: 'new', outputRef: 'run:run-new#new-report' },
    ],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-old', initialFocusMode: 'execution' });

  assert.match(html, /<code>old<\/code>/);
  assert.match(html, /Done/);
  assert.doesNotMatch(html, /EU-new/);
  assert.doesNotMatch(html, /new\.tool/);
});

test('ResultsRenderer failed run audit renders execution units from failed payload', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      id: 'run-failed-payload',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'probe page',
      response: 'failed-with-reason',
      createdAt: '2026-05-12T00:00:00.000Z',
      completedAt: '2026-05-12T00:01:00.000Z',
      raw: {
        payload: {
          executionUnits: [{
            id: 'EU-failed-payload',
            tool: 'web.probe',
            params: '{}',
            status: 'failed-with-reason',
            hash: 'failed-payload',
            outputRef: 'run:run-failed-payload#EU-failed-payload',
            failureReason: 'probe failed before rendering',
          }],
        },
      },
    }],
    executionUnits: [],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-failed-payload' });

  assert.match(html, /Nothing to preview yet/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.match(html, /More/);
  assert.doesNotMatch(stripRuntimeStateHook(html), /1 EU|EU-failed-payload|web\.probe|probe failed before rendering/);
  assert.doesNotMatch(html, /等待真实 ExecutionUnit/);
  assert.doesNotMatch(html, /0 EU/);
});

test('paper-card-list workbench slot is rendered by package policy', () => {
  const artifact: RuntimeArtifact = {
    id: 'papers',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      papers: [
        { title: 'Package-owned paper renderer', journal: 'SciForge Journal', year: 2026, evidenceLevel: 'review' },
      ],
    },
  };
  const session = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const html = renderToStaticMarkup(createElement(() => renderRegisteredWorkbenchSlot({
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    slot: { componentId: 'paper-card-list', artifactRef: 'papers' } as never,
    artifact,
  })));

  assert.match(html, /Package-owned paper renderer/);
  assert.match(html, /SciForge Journal/);
  assert.doesNotMatch(html, /缺少 papers\/rows 数组/);
});

test('registry slot renders browser, terminal, and workspace file package modules in the right pane', () => {
  const artifacts: RuntimeArtifact[] = [
    {
      id: 'browser-runtime',
      type: 'browser-runtime-projection',
      producerScenario: 'browser-runtime',
      schemaVersion: '1',
      data: {
        session: {
          id: 'browser-session',
          mode: 'agent-headless',
          providerId: 'sciforge.observe.browser-runtime',
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'http://127.0.0.1:5175', title: 'SciForge', status: 'ready' }],
        },
        snapshot: {
          schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
          url: 'http://127.0.0.1:5175',
          title: 'SciForge',
          textPreview: 'Browser runtime projection in the right pane.',
          screenshotRef: 'artifact:browser-screenshot',
        },
        traceRefs: [{ kind: 'screenshot', ref: 'artifact:browser-screenshot' }],
      },
    },
    {
      id: 'terminal-session',
      type: 'terminal-session',
      producerScenario: 'runtime-terminal',
      schemaVersion: '1',
      data: {
        sessionRef: 'terminal:run-1',
        status: 'running',
        buffer: '$ npm test\nok 1 right-pane terminal',
      },
    },
    {
      id: 'workspace-file-view',
      type: 'workspace-file-view',
      producerScenario: 'workspace-file-preview',
      schemaVersion: '1',
      data: {
        rootPath: '/workspace/SciForge',
        rootLabel: 'SciForge',
        expandedFolderPaths: ['/workspace/SciForge'],
        selectedPath: '/workspace/SciForge/PROJECT.md',
        entriesByFolder: {
          '/workspace/SciForge': [
            { kind: 'file', name: 'PROJECT.md', path: '/workspace/SciForge/PROJECT.md', size: 42 },
          ],
        },
        file: {
          path: '/workspace/SciForge/PROJECT.md',
          name: 'PROJECT.md',
          content: '# Project',
          size: 9,
          language: 'markdown',
        },
        draft: '# Project',
      },
    },
  ];
  const session = {
    ...emptySession(),
    artifacts,
  };
  const html = artifacts.map((artifact) => renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    item: {
      id: `slot-${artifact.id}`,
      slot: {
        componentId: artifact.type === 'browser-runtime-projection'
          ? 'browser-workbench'
          : artifact.type === 'terminal-session'
            ? 'terminal-session-viewer'
            : 'workspace-file-viewer',
        artifactRef: artifact.id,
      },
      artifact,
      section: 'primary',
      status: 'ready',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }))).join('\n');

  assert.match(html, /browser-workbench/);
  assert.match(html, /terminal-session-viewer/);
  assert.match(html, /workspace-file-viewer/);
  assert.match(html, /right-pane terminal/);
  assert.match(html, /PROJECT\.md/);
  assert.doesNotMatch(html, /fallback renderer|未注册组件/);
});

test('registry slot renders unknown component fallback with artifact diagnostics', () => {
  const html = renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session: emptySession(),
    item: {
      id: 'slot-unknown',
      slot: {
        componentId: 'missing-widget',
        artifactRef: 'ghost-artifact',
        title: 'Custom fallback slot',
      },
      section: 'primary',
      status: 'missing-artifact',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }));

  assert.match(html, /Custom fallback slot/);
  assert.match(html, /missing-widget/);
  assert.match(html, /result reference not found: ghost-result/);
  assert.match(html, /Waiting for results/);
  assert.doesNotMatch(html, /artifactRef|no runtime artifact|runtime-artifact/);
});

test('registry slot uses unknown component artifact fallback without dropping artifact payload context', () => {
  const artifact: RuntimeArtifact = {
    id: 'fallback-table',
    type: 'runtime-artifact',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/fallback-table.json',
    data: {
      rows: [
        { gene: 'TP53', score: 0.91 },
        { gene: 'BRCA1', score: 0.77 },
      ],
      downloads: [{
        name: 'fallback-table.csv',
        contentType: 'text/csv',
        content: 'gene,score\nTP53,0.91',
        rowCount: 2,
      }],
    },
  };
  const session = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const html = renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    item: {
      id: 'slot-unknown-existing-artifact',
      slot: {
        componentId: 'lab-specific-widget',
        artifactRef: 'fallback-table',
        title: 'Lab-specific table',
      },
      artifact,
      section: 'primary',
      status: 'fallback',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }));

  assert.match(html, /Lab-specific table/);
  assert.match(html, /lab-specific-widget/);
  assert.match(html, /Result/);
  assert.match(html, /supporting record saved/);
  assert.match(html, /fallback-table\.csv · 2 rows/);
  assert.match(html, /TP53/);
  assert.doesNotMatch(html, /artifactRef 未找到/);
  assert.doesNotMatch(html, /no runtime artifact|runtime-artifact|\.sciforge\/artifacts/);
});

test('registry slot redacts sensitive data object previews while preserving safe refs', () => {
  const artifact: RuntimeArtifact = {
    id: 'sensitive-data-object',
    type: 'runtime-artifact',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      rows: [{
        ref: 'artifact:safe-table',
        token: 'sk-row-secret-1234567890',
        endpoint: 'https://provider.example.test/v1?api_key=abc123',
        path: '/Applications/workspace/private/config.local.json',
      }],
      rawProviderPayload: { body: 'RAW_PROVIDER_BODY_SHOULD_NOT_RENDER' },
    },
  };
  const session = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const html = renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    item: {
      id: 'slot-sensitive-data-object',
      slot: {
        componentId: 'lab-specific-widget',
        artifactRef: 'sensitive-data-object',
        title: 'Sensitive data object',
      },
      artifact,
      section: 'primary',
      status: 'fallback',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }));

  assert.match(html, /artifact:safe-table/);
  assert.match(html, /redacted-secret|redacted-url|redacted-local-path/);
  assert.doesNotMatch(html, /sk-row-secret|provider\.example|api_key=abc123|\/Applications\/workspace|RAW_PROVIDER_BODY/);
});

test('ResultsRenderer explains missing ArtifactDelivery through the package empty-state fallback', () => {
  const artifact: RuntimeArtifact = {
    id: 'broken-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-broken-report' },
    data: { notes: 'contract drift: markdown was not produced' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
    runs: [completedRun('run-broken-report')],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'broken-report', title: 'Report' }],
  };
  const html = renderResultsRenderer(session, { activeRunId: 'run-broken-report' });

  assert.match(html, /Nothing to preview yet/);
  assert.match(html, /The main answer stays in chat\. Previewable files and artifacts appear here when available\./);
  assert.doesNotMatch(html, /Awaiting research-report/);
  assert.doesNotMatch(html, /contract drift: markdown was not produced/);
});

test('ResultsRenderer falls back from mismatched manifest component to artifact-owned report renderer', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-owned-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-mismatch' },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report-owned-artifact',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/artifacts/report-owned-artifact.md',
      previewPolicy: 'inline',
    },
  };
  const session = withMaterializedProjectionFixture({
    ...emptySession(),
    artifacts: [artifact],
    runs: [{
      ...completedRun('run-mismatch'),
      raw: {
        resultPresentation: projectionResultPresentation('run-mismatch', ['artifact:report-owned-artifact']),
      },
    }],
    uiManifest: [{
      componentId: 'paper-card-list',
      artifactRef: 'report-owned-artifact',
      title: 'Backend requested paper cards',
    }],
  });
  const html = renderResultsRenderer(session, { activeRunId: 'run-mismatch' });
  const model = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [],
    activeRun: session.runs[0],
    focusMode: 'all',
  });

  assert.match(html, /Loading Markdown report/);
  assert.match(html, /\.sciforge\/artifacts\/report-owned-artifact\.md/);
  assert.doesNotMatch(html, /当前 paper-list artifact 缺少 papers\/rows 数组/);
  assert.ok(model.viewPlan.diagnostics.some((item) => item.includes('paper-card-list -> research-report 已改由 report-viewer 渲染')));
  assert.ok(model.viewPlan.allItems.some((item) => item.slot.componentId === 'report-viewer' && item.artifact?.id === 'report-owned-artifact'));
});

test('results renderer view model projects hidden result empty state and manifest diagnostics', () => {
  const artifact: RuntimeArtifact = {
    id: 'report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/artifacts/report.md',
      previewPolicy: 'inline',
    },
  };
  const session = withMaterializedProjectionFixture({
    ...emptySession(),
    artifacts: [artifact],
    runs: [{
      ...completedRun('run-view-model-report'),
      raw: {
        resultPresentation: projectionResultPresentation('run-view-model-report', ['artifact:report']),
      },
    }],
  });
  const initial = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [],
    activeRun: session.runs[0],
    focusMode: 'all',
  });
  assert.ok(initial.visibleItems.length > 0);
  assert.equal(initial.emptyState, undefined);
  assert.ok(initial.manifestDiagnostics.some((item) => item.status === 'bound'));

  const hiddenSession: SciForgeSession = {
    ...session,
    hiddenResultSlotIds: initial.viewPlan.allItems.map((item) => item.id),
  };
  const hidden = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session: hiddenSession,
    defaultSlots: [],
    activeRun: hiddenSession.runs[0],
    focusMode: 'all',
  });

  assert.equal(hidden.visibleItems.length, 0);
  assert.equal(hidden.emptyState?.dismissedAllInFilter, true);
  assert.equal(hidden.emptyState?.title, 'All views are hidden for this filter');
});

test('object reference action helper resolves pin and workspace path plans without UI state', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: '.sciforge/artifacts/report.md',
    data: { markdown: '# Report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const reference: ObjectReference = {
    id: 'ref-report',
    title: 'Report artifact',
    kind: 'artifact',
    ref: 'artifact:report-artifact',
    artifactType: 'research-report',
    actions: ['pin', 'copy-path', 'open-external'],
  };
  const olderPins = ['a', 'b', 'c', 'd'].map((id): ObjectReference => ({
    id,
    title: id,
    kind: 'file',
    ref: `file:${id}.txt`,
  }));

  assert.deepEqual(nextPinnedObjectReferences(olderPins, reference).map((item) => item.id), ['b', 'c', 'd', 'ref-report']);
  assert.deepEqual(nextPinnedObjectReferences([reference], reference), []);

  const pinPlan = resolveObjectReferenceActionPlan({
    action: 'pin',
    pinnedObjectReferences: olderPins,
    reference,
    session,
  });
  if (pinPlan.kind !== 'pin') assert.fail(`Expected pin plan, got ${pinPlan.kind}`);
  assert.equal(pinPlan.pinnedObjectReferences.at(-1)?.id, 'ref-report');

  const copyPlan = resolveObjectReferenceActionPlan({
    action: 'copy-path',
    pinnedObjectReferences: [],
    reference,
    session,
  });
  if (copyPlan.kind !== 'copy-path') assert.fail(`Expected copy-path plan, got ${copyPlan.kind}`);
  assert.equal(copyPlan.path, '.sciforge/artifacts/report.md');
  assert.equal(copyPlan.notice, '已复制路径：.sciforge/artifacts/report.md');
});

test('object reference focus routes open refs to typed right-pane tabs', () => {
  assert.equal(resultTabForObjectReference({ id: 'file', kind: 'file', title: 'File', ref: 'file:PROJECT.md' }), 'files');
  assert.equal(resultTabForObjectReference({ id: 'url', kind: 'url', title: 'URL', ref: 'url:https://example.org' }), 'browser');
  assert.equal(resultTabForObjectReference({ id: 'terminal', kind: 'execution-unit', title: 'Shell', ref: 'execution-unit:EU-shell' }), 'terminal');
  assert.equal(resultTabForObjectReference({ id: 'screen', kind: 'artifact', title: 'Screen', ref: 'computer-use:frame/latest.png', artifactType: 'computer-use-virtual-screen' }), 'screen');
  assert.equal(resultTabForObjectReference({ id: 'artifact', kind: 'artifact', title: 'Report', ref: 'artifact:report' }), 'primary');
});

test('object reference selection actions route through UserActionApi', async () => {
  const artifact: RuntimeArtifact = {
    id: 'report-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: '.sciforge/artifacts/report.md',
    data: { markdown: '# Report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const reference: ObjectReference = {
    id: 'ref-report',
    title: 'Report artifact',
    kind: 'artifact',
    ref: 'artifact:report-artifact',
    artifactType: 'research-report',
    actions: ['inspect', 'pin', 'copy-path'],
  };
  const calls: Array<{ objectRef: string; intent: string }> = [];

  const result = await performObjectReferenceAction({
    action: 'inspect',
    config: testConfig(),
    pinnedObjectReferences: [],
    reference,
    session,
    userActionApi: {
      async selectObject(input) {
        calls.push({ objectRef: input.objectRef, intent: input.intent });
        return {
          accepted: true,
          action: {
            kind: 'UIAction',
            type: 'select-object',
            id: 'select-object-test',
            sessionId: input.session.sessionId,
            scenarioId: input.session.scenarioId,
            createdAt: '2026-05-17T00:00:00.000Z',
            objectRef: input.objectRef,
            intent: input.intent,
          },
        };
      },
    },
  });

  assert.equal(result.inspectedArtifact?.id, 'report-artifact');
  assert.equal(result.sourceAction?.type, 'select-object');
  assert.deepEqual(calls, [{ objectRef: 'artifact:report-artifact', intent: 'inspect' }]);

  const copiedPaths: string[] = [];
  const copyResult = await performObjectReferenceAction({
    action: 'copy-path',
    config: testConfig(),
    pinnedObjectReferences: [],
    reference,
    session,
    userActionApi: {
      async selectObject() {
        assert.fail('copy-path must not be recorded as a selected-object action');
      },
    },
    writeClipboard: async (text) => {
      copiedPaths.push(text);
    },
  });

  assert.equal(copyResult.sourceAction, undefined);
  assert.deepEqual(copiedPaths, ['.sciforge/artifacts/report.md']);

  const openResult = await performObjectReferenceAction({
    action: 'open-external',
    config: testConfig(),
    pinnedObjectReferences: [],
    reference,
    session,
    userActionApi: {
      async selectObject() {
        assert.fail('open-external must not be recorded as a selected-object action');
      },
    },
  });

  assert.equal(openResult.commandTextAction?.type, 'command-text');
  assert.equal(openResult.commandTextAction?.source, 'open');
  assert.equal(openResult.commandTextAction?.commandText, 'open ".sciforge/artifacts/report.md"');
});

test('artifact inspector drawer renders lineage, reproducible refs, preview, and handoff targets', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/report.json',
    metadata: {
      producerSkillId: 'report.writer',
      createdAt: '2026-05-09T00:00:00.000Z',
      handoffTargets: ['structure-exploration'],
      derivation: {
        schemaVersion: 'sciforge.artifact-derivation.v1',
        kind: 'summary',
        parentArtifactRef: 'artifact:source-report',
        sourceRefs: ['artifact:source-report', 'provider:openalex:openalex-w1'],
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        verificationStatus: 'unverified',
      },
    },
    data: { markdown: '# Inspector report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
    executionUnits: [{
      id: 'EU-inspector',
      tool: 'report.generate',
      params: '{}',
      status: 'done',
      hash: 'hash-inspector',
      artifacts: ['report-artifact'],
      codeRef: '.sciforge/runs/EU-inspector/code.ts',
      stdoutRef: '.sciforge/runs/EU-inspector/stdout.txt',
      outputRef: 'artifact:report-artifact',
    }],
  };
  const html = renderToStaticMarkup(createElement(ArtifactInspectorDrawer, {
    scenarioId: 'literature-evidence-review',
    session,
    artifact,
    onClose: () => undefined,
    onArtifactHandoff: () => undefined,
  }));

  assert.match(html, /Result details/);
  assert.match(html, /report-artifact/);
  assert.match(html, /Generated by: report.writer/);
  assert.match(html, /Activity status: supporting activity matched/);
  assert.match(html, /Derivation: summary/);
  assert.match(html, /Parent result: saved/);
  assert.match(html, /Source results: 2 saved/);
  assert.match(html, /Result: source file saved/);
  assert.match(html, /Inspector report/);
  assert.doesNotMatch(html, /Artifact Inspector|execution unit|EU-inspector|provider:openalex|dataRef:|audit ref\(s\) retained|\.sciforge\/artifacts/);
  assert.match(html, /Inspector report/);
  assert.match(html, /结构探索/);
});

test('artifact inspector drawer uses refs-first redacted previews for artifact data', () => {
  const artifact: RuntimeArtifact = {
    id: 'sensitive-inspector-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'Sensitive inspector artifact' },
    data: {
      sourceRef: 'artifact:public-evidence',
      markdown: [
        '# Sensitive inspector body',
        'Authorization: Bearer sk-inspector-secret-1234567890',
        'https://provider.example.test/v1?api_key=abc123',
        '/Users/alice/private/config.local.json',
      ].join('\n'),
      rawProviderPayload: { body: 'RAW_INSPECTOR_BODY_SHOULD_NOT_RENDER' },
    },
  };
  const html = renderToStaticMarkup(createElement(ArtifactInspectorDrawer, {
    scenarioId: 'literature-evidence-review',
    session: { ...emptySession(), artifacts: [artifact] },
    artifact,
    onClose: () => undefined,
    onArtifactHandoff: () => undefined,
  }));
  const refIndex = html.indexOf('artifact:public-evidence');
  const bodyIndex = html.indexOf('Sensitive inspector body');

  assert.ok(refIndex >= 0);
  assert.ok(bodyIndex > refIndex);
  assert.match(html, /redacted-secret|redacted-url|redacted-local-path|right-pane-sensitive-object/);
  assert.doesNotMatch(html, /sk-inspector-secret|provider\.example|api_key=abc123|\/Users\/alice|RAW_INSPECTOR_BODY/);
});

test('requestRecoverCommandTextAction routes result recover buttons to terminal-equivalent commandText', async () => {
  const session = contractFailureSession();
  const action = await requestRecoverCommandTextAction({
    session,
    activeRun: session.runs[0],
    recoverAction: 'regenerate report artifact with markdownRef',
  });

  assert.equal(action?.type, 'command-text');
  assert.equal(action?.source, 'recover');
  assert.equal(action?.runId, 'run-contract-failure');
  assert.match(action?.commandText ?? '', /^\/recover "run-contract-failure" --with-evidence --action "regenerate report artifact with markdownRef"/);
  assert.ok(action?.auditRefs.includes('execution-unit:EU-report'));
  assert.ok(action?.auditRefs.includes('artifact:research-report'));
});

test('requestOpenDebugAuditThroughUserActionApi routes audit expansion through UserActionApi', async () => {
  const session = contractFailureSession();
  const action = await requestOpenDebugAuditThroughUserActionApi({
    session,
    activeRun: session.runs[0],
    userActionApi: {
      async openDebugAudit(input) {
        assert.equal(input.runId, 'run-contract-failure');
        return {
          accepted: true,
          action: {
            type: 'open-debug-audit',
            id: 'open-debug-audit-test',
            kind: 'UIAction',
            createdAt: '2026-05-17T00:00:00.000Z',
            sessionId: input.session.sessionId,
            scenarioId: input.session.scenarioId,
            runId: input.runId,
            auditRefs: ['execution-unit:EU-report', 'artifact:research-report'],
          },
        };
      },
    },
  });

  assert.equal(action?.type, 'open-debug-audit');
  assert.deepEqual(action?.type === 'open-debug-audit' ? action.auditRefs : [], ['execution-unit:EU-report', 'artifact:research-report']);
});

test('ResultsRenderer shows capability discovery plan summary without exposing unsafe debug refs', () => {
  const run = {
    ...completedRun('run-discovery-plan'),
    raw: {
      capabilityDiscoveryToolResults: [{
        toolName: 'capability_discovery.plan',
        status: 'done',
        auditRefs: [
          'records/capability-discovery/plan-audit.json',
          'http://127.0.0.1:18080/internal',
          '/Applications/workspace/ailab/research/app/SciForge/.secret',
          'token=abc123',
        ],
        result: {
          summary: 'Use literature search, pdf extraction, and evidence validation.',
          steps: [
            { capabilityId: 'web_search' },
            { capabilityId: 'pdf_extract' },
            { capabilityId: 'evidence_matrix_validate' },
          ],
          completionEvidence: 'not-evidence',
        },
      }],
    },
  };
  const session = {
    ...emptySession(),
    runs: [run],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-discovery-plan' });

  assert.match(html, /More/);
  assert.doesNotMatch(html, /Selected capabilities|Use literature search/);
  assert.doesNotMatch(html, /Use literature search, pdf extraction, and evidence validation/);
  assert.doesNotMatch(html, /web_search|records\/capability-discovery\/plan-audit\.json/);
  assert.doesNotMatch(html, /not completion evidence/);
  assert.doesNotMatch(html, /127\.0\.0\.1|Applications\/workspace|token=abc123/);
});

test('ResultsRenderer collapsed support pane summaries avoid internal runtime vocabulary', () => {
  const session = contractFailureSession();
  const html = stripRuntimeStateHook(renderResultsRenderer(session, { activeRunId: 'run-contract-failure' }));

  assert.match(html, /Nothing to preview yet/);
  assert.match(html, /More/);
  assert.doesNotMatch(html, /raw audit|raw JSONL|stdout|stderr|provider|run id|ConversationProjection|ArtifactDelivery|ExecutionUnit|modules|refs|EU|failure/i);
  assert.doesNotMatch(html, /ContractValidationFailure|Backend repair|sourceRunId|repairRunId|relatedRef|nextStep/);
});

function contractFailureSession(): SciForgeSession {
  const failure: ContractValidationFailure = {
    contract: 'sciforge.contract-validation-failure.v1',
    schemaPath: '/artifacts/0/data',
    contractId: 'research-report.v1',
    capabilityId: 'report-viewer',
    failureKind: 'artifact-schema',
    expected: { required: ['markdown'] },
    actual: { summary: 'only summary' },
    missingFields: ['data.markdown'],
    invalidRefs: ['artifact:research-report'],
    unresolvedUris: ['file::.sciforge/missing/report.md'],
    failureReason: 'research-report artifact is missing markdown content.',
    recoverActions: ['regenerate report artifact with markdownRef'],
    nextStep: 'Repair the artifact payload before showing the report.',
    relatedRefs: ['execution-unit:EU-report', 'artifact:research-report'],
    issues: [{ path: '/data/markdown', message: 'required field missing', missingField: 'data.markdown' }],
    createdAt: '2026-05-09T00:00:00.000Z',
  };
  return {
    schemaVersion: 2,
    sessionId: 'session-contract-failure',
    scenarioId: 'literature-evidence-review',
    title: 'contract failure',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-contract-failure',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'generate report',
      response: `failed-with-reason: ${failure.failureReason}`,
      createdAt: '2026-05-09T00:00:00.000Z',
      completedAt: '2026-05-09T00:01:00.000Z',
      raw: {
        contractValidationFailure: failure,
        acceptanceRepair: {
          sourceRunId: 'run-contract-failure',
          repairRunId: 'run-repair-1',
          failureReason: 'backend artifact repair timed out',
          recoverActions: ['inspect repair stderr and rerun bounded validator'],
          refs: [{ ref: 'agentserver://repair/stderr' }],
          repairHistory: [{
            attempt: 1,
            action: 'artifact-contract-repair',
            status: 'failed-with-reason',
            startedAt: '2026-05-09T00:00:10.000Z',
            completedAt: '2026-05-09T00:00:40.000Z',
            sourceRunId: 'run-contract-failure',
            repairRunId: 'run-repair-1',
            reason: 'backend artifact repair timed out',
          }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-report',
      tool: 'report.validate',
      params: '{}',
      status: 'repair-needed',
      hash: 'hash-report',
      failureReason: 'data.markdown is missing',
      outputRef: 'artifact:research-report',
      recoverActions: ['rerun validator after artifact repair'],
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:01:00.000Z',
  };
}

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}

function completedRun(id: string): SciForgeRun {
  return {
    id,
    scenarioId: 'literature-evidence-review',
    status: 'completed' as const,
    prompt: 'render result',
    response: 'completed',
    createdAt: '2026-05-09T00:00:00.000Z',
    completedAt: '2026-05-09T00:01:00.000Z',
  };
}

function projectionResultPresentation(runId: string, artifactRefs: string[]) {
  return {
    conversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      runId,
      visibleAnswer: { status: 'satisfied', text: 'Projection result ready.', artifactRefs },
      artifacts: artifactRefs.map((ref) => ({ ref, label: ref.replace(/^artifact::?/, '') })),
      executionProcess: [],
      diagnostics: [],
      auditRefs: [],
    },
  };
}

function renderResultsRenderer(session: SciForgeSession, options: {
  activeRunId?: string;
  initialFocusMode?: 'all' | 'visual' | 'evidence' | 'execution';
  initialResultTab?: 'primary' | 'browser' | 'screen' | 'terminal' | 'files' | 'evidence';
  focusedObjectReference?: ObjectReference;
  workspaceFileEditor?: WorkspaceFileEditorState | null;
} = {}) {
  const effectiveSession = withMaterializedProjectionFixture(session);
  return renderToStaticMarkup(createElement(ResultsRenderer, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session: effectiveSession,
    defaultSlots: [],
    onArtifactHandoff: () => undefined,
    collapsed: false,
    onToggleCollapse: () => undefined,
    activeRunId: options.activeRunId,
    onActiveRunChange: () => undefined,
    focusedObjectReference: options.focusedObjectReference,
    onFocusedObjectChange: () => undefined,
    workspaceFileEditor: options.workspaceFileEditor ?? null,
    onWorkspaceFileEditorChange: () => undefined,
    initialFocusMode: options.initialFocusMode,
    initialResultTab: options.initialResultTab,
  }));
}

function stripRuntimeStateHook(html: string) {
  return html.replace(/<div class="runtime-visible-state-hook"[\s\S]*?<\/div>/g, '');
}

function withMaterializedProjectionFixture(session: SciForgeSession): SciForgeSession {
  const projections = Object.fromEntries(session.runs.flatMap((run) => {
    const projection = conversationProjectionMigrationAuditFixtureForRun(run);
    return projection ? [[run.id, projection]] : [];
  }));
  return Object.keys(projections).length ? { ...session, materializedConversationProjections: projections } as SciForgeSession : session;
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:5174',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5175',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'openai',
    modelBaseUrl: '',
    modelName: 'test-model',
    apiKey: '',
    requestTimeoutMs: 30000,
    maxContextWindowTokens: 128000,
    visionAllowSharedSystemInput: false,
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}
