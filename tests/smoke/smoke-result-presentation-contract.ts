import assert from 'node:assert/strict';

type PresentationModule = Record<string, unknown>;
type PresentationFixture = {
  id: string;
  title: string;
  input: Record<string, unknown>;
  expectedVisible: RegExp[];
  expectedHidden: RegExp[];
  expectFailureSummary?: boolean;
};

const materializer = await loadPresentationMaterializer();
const contractValidator = await loadPresentationValidator();

const fixtures: PresentationFixture[] = [
  {
    id: 'research-report',
    title: 'research report with inline paper and report refs',
    input: {
      request: {
        skillDomain: 'literature',
        prompt: 'Summarize recent AI agent papers and produce a cited report.',
        expectedArtifactTypes: ['paper-list', 'research-report'],
        selectedComponentIds: ['paper-card-list', 'report-viewer'],
      },
      harness: {
        profileId: 'research-grade',
        intentMode: 'fresh',
        presentationPolicy: {
          userRole: 'standard',
          debugMode: false,
          defaultVisibleLayers: ['answer', 'evidence', 'artifacts', 'next-actions'],
          defaultCollapsedLayers: ['process', 'trace', 'diagnostics', 'raw-payload'],
        },
      },
      payload: {
        message: 'Found 12 recent agent papers; 4 are high priority for tool-use evaluation.',
        confidence: 0.86,
        claimType: 'research-summary',
        evidenceLevel: 'report-plus-paper-metadata',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: searched provider, downloaded papers, produced report.',
        claims: [
          {
            id: 'claim-agent-benchmarks',
            text: 'Tool-use evaluation is the strongest theme in the current paper set.',
            statement: 'Tool-use evaluation is the strongest theme in the current paper set.',
            evidenceRefs: ['artifact::agent-report#key-themes', 'arxiv::2605.07926'],
            verificationState: 'supported',
          },
        ],
        artifacts: [
          {
            id: 'agent-paper-list',
            type: 'paper-list',
            title: 'Agent paper list',
            path: '.sciforge/sessions/2026-05-11_research/exports/papers.json',
          },
          {
            id: 'agent-report',
            type: 'research-report',
            title: 'Agent papers report',
            path: '.sciforge/sessions/2026-05-11_research/exports/report.md',
          },
        ],
        uiManifest: [{ componentId: 'report-viewer', artifactRef: 'agent-report' }],
        objectReferences: [
          { id: 'agent-report-ref', ref: 'artifact::agent-report', title: 'Agent papers report', kind: 'artifact' },
          { id: 'paper-2605-07926', ref: 'arxiv::2605.07926', title: 'AgentEscapeBench', kind: 'paper' },
        ],
        executionUnits: [
          {
            id: 'literature-search',
            status: 'done',
            nextStep: 'Open the report and inspect the cited high-priority papers.',
            stdoutRef: '.sciforge/logs/search.stdout.log',
            backendRouteDecision: 'openteam_agent',
          },
        ],
      },
    },
    expectedVisible: [/Tool-use evaluation/i, /Agent papers report/i, /AgentEscapeBench|2605\.07926/i],
    expectedHidden: [/RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i, /backendRouteDecision/i, /stdoutRef/i],
  },
  {
    id: 'data-table-plot',
    title: 'data table and plot result with row-level evidence',
    input: {
      request: {
        skillDomain: 'data-analysis',
        prompt: 'Analyze the uploaded measurements and explain the dominant trend.',
        expectedArtifactTypes: ['data-table', 'plot'],
        selectedComponentIds: ['table-viewer', 'plot-viewer'],
      },
      harness: {
        profileId: 'balanced-default',
        intentMode: 'fresh',
        presentationPolicy: { userRole: 'standard', debugMode: false },
      },
      payload: {
        message: 'Treatment B increased median signal by 18% relative to control.',
        confidence: 0.8,
        claimType: 'data-analysis-result',
        evidenceLevel: 'table-and-plot',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: calculated grouped medians and plotted trend.',
        claims: [
          {
            id: 'claim-treatment-b',
            text: 'Treatment B has the largest median increase.',
            statement: 'Treatment B has the largest median increase.',
            evidenceRefs: ['artifact::summary-table#row:treatment-b', 'artifact::dose-plot#series:treatment-b'],
            verificationState: 'supported',
          },
        ],
        artifacts: [
          {
            id: 'summary-table',
            type: 'data-table',
            title: 'Grouped medians',
            dataRef: '.sciforge/sessions/2026-05-11_data/artifacts/grouped-medians.json',
          },
          {
            id: 'dose-plot',
            type: 'plot',
            title: 'Dose response plot',
            imageRef: '.sciforge/sessions/2026-05-11_data/artifacts/dose-response.png',
          },
        ],
        uiManifest: [
          { componentId: 'table-viewer', artifactRef: 'summary-table' },
          { componentId: 'plot-viewer', artifactRef: 'dose-plot' },
        ],
        objectReferences: [
          { id: 'table-treatment-b', ref: 'artifact::summary-table#row:treatment-b', title: 'Treatment B row', kind: 'data-row' },
          { id: 'dose-plot-ref', ref: 'artifact::dose-plot', title: 'Dose response plot', kind: 'artifact' },
        ],
        executionUnits: [{
          id: 'python-analysis',
          status: 'done',
          nextStep: 'Inspect the grouped table and plot before reusing the result.',
          stderrRef: '.sciforge/logs/analysis.stderr.log',
        }],
      },
    },
    expectedVisible: [/18%|median/i, /Treatment B/i, /Dose response plot|Grouped medians/i],
    expectedHidden: [/RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i, /stderrRef/i],
  },
  {
    id: 'code-diff',
    title: 'code change result with diff and test evidence',
    input: {
      request: {
        skillDomain: 'coding',
        prompt: 'Fix the parser bug and summarize verification.',
        expectedArtifactTypes: ['code-diff', 'test-report'],
        selectedComponentIds: ['diff-viewer', 'report-viewer'],
      },
      harness: {
        profileId: 'balanced-default',
        intentMode: 'repair',
        presentationPolicy: { userRole: 'standard', debugMode: false },
      },
      payload: {
        message: 'Parser recovery now preserves quoted commas; the focused parser tests pass.',
        confidence: 0.84,
        claimType: 'code-repair-result',
        evidenceLevel: 'diff-plus-tests',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: inspected stack, edited parser, ran tests.',
        claims: [
          {
            id: 'claim-parser-quoted-comma',
            text: 'Quoted comma recovery no longer splits fields incorrectly.',
            statement: 'Quoted comma recovery no longer splits fields incorrectly.',
            evidenceRefs: ['artifact::parser-diff#CsvParser.ts', 'artifact::parser-test-report#quoted-comma'],
            verificationState: 'supported',
          },
        ],
        artifacts: [
          { id: 'parser-diff', type: 'code-diff', title: 'Parser diff', path: '.sciforge/sessions/2026-05-11_code/artifacts/parser.diff' },
          { id: 'parser-test-report', type: 'test-report', title: 'Parser test report', path: '.sciforge/sessions/2026-05-11_code/artifacts/test-report.md' },
        ],
        uiManifest: [
          { componentId: 'diff-viewer', artifactRef: 'parser-diff' },
          { componentId: 'report-viewer', artifactRef: 'parser-test-report' },
        ],
        objectReferences: [
          { id: 'parser-diff-ref', ref: 'artifact::parser-diff#CsvParser.ts', title: 'CsvParser diff', kind: 'code-diff' },
          { id: 'parser-test-ref', ref: 'artifact::parser-test-report#quoted-comma', title: 'Quoted comma test', kind: 'test' },
        ],
        executionUnits: [{
          id: 'npm-test',
          status: 'done',
          nextStep: 'Review the diff and keep the focused test report with the change.',
          command: 'npm test -- parser',
          stdoutRef: '.sciforge/logs/npm-test.stdout.log',
        }],
      },
    },
    expectedVisible: [/quoted commas?|Parser/i, /test/i, /Parser diff|test report/i],
    expectedHidden: [/RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i, /npm test -- parser/i, /stdoutRef/i],
  },
  {
    id: 'gui-action-result',
    title: 'GUI action result with screenshot evidence',
    input: {
      request: {
        skillDomain: 'computer-use',
        prompt: 'Open the settings page and turn on dark mode.',
        expectedArtifactTypes: ['screenshot', 'action-log'],
        selectedComponentIds: ['screenshot-viewer', 'execution-unit-table'],
      },
      harness: {
        profileId: 'fast-answer',
        intentMode: 'interactive',
        presentationPolicy: { userRole: 'standard', debugMode: false },
      },
      payload: {
        message: 'Dark mode is enabled in Settings.',
        confidence: 0.78,
        claimType: 'gui-action-result',
        evidenceLevel: 'screenshot-plus-action-log',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: clicked toolbar, opened settings, toggled dark mode.',
        claims: [
          {
            id: 'claim-dark-mode-on',
            text: 'The settings toggle shows dark mode enabled.',
            statement: 'The settings toggle shows dark mode enabled.',
            evidenceRefs: ['artifact::settings-screenshot#region:dark-mode-toggle', 'artifact::action-log#step:4'],
            verificationState: 'supported',
          },
        ],
        artifacts: [
          { id: 'settings-screenshot', type: 'screenshot', title: 'Settings after change', imageRef: '.sciforge/sessions/2026-05-11_gui/artifacts/settings.png' },
          { id: 'action-log', type: 'action-log', title: 'GUI action log', path: '.sciforge/sessions/2026-05-11_gui/artifacts/action-log.json' },
        ],
        uiManifest: [{ componentId: 'screenshot-viewer', artifactRef: 'settings-screenshot' }],
        objectReferences: [
          { id: 'toggle-region', ref: 'artifact::settings-screenshot#region:dark-mode-toggle', title: 'Dark mode toggle screenshot', kind: 'screenshot-region' },
          { id: 'action-step-4', ref: 'artifact::action-log#step:4', title: 'Toggle action', kind: 'action-step' },
        ],
        executionUnits: [{
          id: 'computer-use-session',
          status: 'done',
          nextStep: 'Confirm the screenshot before continuing with more GUI actions.',
          rawActionTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER',
        }],
      },
    },
    expectedVisible: [/Dark mode/i, /Settings after change|toggle/i],
    expectedHidden: [/RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i, /rawActionTrace/i],
  },
  {
    id: 'scientific-partial-failure',
    title: 'scientific reproduction partial result with missing data boundary',
    input: {
      request: {
        skillDomain: 'scientific-reproduction',
        prompt: 'Reproduce the paper figure from public data.',
        expectedArtifactTypes: ['dataset-inventory', 'negative-result-report', 'reproduction-report'],
        selectedComponentIds: ['report-viewer', 'table-viewer'],
      },
      harness: {
        profileId: 'research-grade',
        intentMode: 'fresh',
        presentationPolicy: { userRole: 'standard', debugMode: false },
      },
      payload: {
        message: 'Partial result: processed tables are available, but raw FASTQ data needed for the original peak-calling step is unavailable.',
        confidence: 0.67,
        claimType: 'scientific-reproduction-partial',
        evidenceLevel: 'inventory-plus-negative-result',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: searched accession mirrors, tried download, recorded missing boundary.',
        claims: [
          {
            id: 'claim-raw-data-missing',
            text: 'The original raw FASTQ inputs are not available through the declared accession mirrors.',
            statement: 'The original raw FASTQ inputs are not available through the declared accession mirrors.',
            evidenceRefs: ['artifact::dataset-inventory#missing:GSE999999', 'artifact::negative-report#raw-data-boundary'],
            verificationState: 'unverified',
            uncertaintyReason: 'Public mirrors returned no raw FASTQ files at smoke time.',
          },
        ],
        artifacts: [
          { id: 'dataset-inventory', type: 'dataset-inventory', title: 'Dataset inventory', path: '.sciforge/sessions/2026-05-11_repro/artifacts/dataset-inventory.json' },
          { id: 'negative-report', type: 'negative-result-report', title: 'Missing raw data report', path: '.sciforge/sessions/2026-05-11_repro/artifacts/negative-result.md' },
        ],
        verificationResults: [
          {
            id: 'verification-missing-data',
            verdict: 'unverified',
            confidence: 0.68,
            critique: 'Raw data boundary blocks full reproduction.',
            evidenceRefs: ['artifact::dataset-inventory#missing:GSE999999'],
            repairHints: ['Retry if accession mirror becomes available', 'Continue with processed tables only'],
          },
        ],
        uiManifest: [{ componentId: 'report-viewer', artifactRef: 'negative-report' }],
        objectReferences: [
          { id: 'missing-gse', ref: 'artifact::dataset-inventory#missing:GSE999999', title: 'Missing accession record', kind: 'dataset' },
          { id: 'negative-report-ref', ref: 'artifact::negative-report#raw-data-boundary', title: 'Raw data boundary', kind: 'report-section' },
        ],
        executionUnits: [{ id: 'accession-download', status: 'failed-with-reason', stderrRef: '.sciforge/logs/accession.stderr.log' }],
      },
    },
    expectedVisible: [/Partial result|raw FASTQ|unavailable/i, /Missing raw data report|Dataset inventory/i, /Retry|processed tables/i],
    expectedHidden: [/RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i, /stderrRef/i],
    expectFailureSummary: true,
  },
  {
    id: 'backend-failure-diagnostic',
    title: 'backend failure with human-readable recovery and collapsed diagnostic refs',
    input: {
      request: {
        skillDomain: 'general',
        prompt: 'Run the backend task and explain the outcome.',
        expectedArtifactTypes: ['runtime-diagnostic'],
        selectedComponentIds: ['runtime-diagnostic-viewer'],
      },
      harness: {
        profileId: 'balanced-default',
        intentMode: 'fresh',
        presentationPolicy: { userRole: 'standard', debugMode: false },
      },
      payload: {
        message: 'The task did not complete because the backend returned 429 Too Many Requests. Retry after the quota reset or switch backend.',
        confidence: 0.7,
        claimType: 'backend-failure-diagnostic',
        evidenceLevel: 'runtime-diagnostic',
        reasoningTrace: 'RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER: backendRouteDecision=hermes-agent secret-token-should-be-redacted',
        claims: [
          {
            id: 'claim-rate-limit',
            text: 'Backend rate limiting prevented completion.',
            statement: 'Backend rate limiting prevented completion.',
            evidenceRefs: ['artifact::runtime-diagnostic#rate-limit', 'log::backend-stderr'],
            verificationState: 'supported',
          },
        ],
        artifacts: [
          {
            id: 'runtime-diagnostic',
            type: 'runtime-diagnostic',
            title: 'Backend rate-limit diagnostic',
            data: {
              category: 'rate-limit',
              status: 429,
              sanitizedError: '429 Too Many Requests',
              rawError: 'secret-token-should-be-redacted',
            },
          },
        ],
        uiManifest: [{ componentId: 'runtime-diagnostic-viewer', artifactRef: 'runtime-diagnostic' }],
        objectReferences: [
          { id: 'runtime-diagnostic-ref', ref: 'artifact::runtime-diagnostic#rate-limit', title: 'Rate-limit diagnostic', kind: 'diagnostic' },
          { id: 'backend-stderr', ref: 'log::backend-stderr', title: 'Backend stderr', kind: 'log' },
        ],
        executionUnits: [
          {
            id: 'backend-run',
            status: 'repair-needed',
            recoverActions: ['Retry after quota reset', 'Switch backend'],
            stderrRef: '.sciforge/logs/backend.stderr.log',
          },
        ],
      },
    },
    expectedVisible: [/did not complete|429|Too Many Requests/i, /Retry|Switch backend|quota/i, /rate-limit diagnostic/i],
    expectedHidden: [/secret-token-should-be-redacted/i, /backendRouteDecision/i, /stderrRef/i, /RAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER/i],
    expectFailureSummary: true,
  },
];

for (const fixture of fixtures) {
  const contract = await materializer(fixture.input);
  assertContractShape(contract, fixture);
  if (contractValidator) {
    assertValidatorOk(await contractValidator(contract), fixture.id);
  }
}

console.log(`[ok] result presentation contract smoke covered ${fixtures.length} generic scenes`);

async function loadPresentationMaterializer() {
  const candidates = [
    {
      path: '../../src/runtime/gateway/result-presentation-contract.js',
      exportName: 'materializeResultPresentationContract',
      wrap: (fn: (input: unknown) => unknown | Promise<unknown>) => fn,
    },
    {
      path: '../../src/runtime/gateway/result-presentation-adapter.js',
      exportName: 'adaptToolPayloadToResultPresentation',
      wrap: (fn: (payload: unknown, options?: unknown) => unknown | Promise<unknown>) => {
        return (input: unknown) => {
          assert.ok(isRecord(input) && isRecord(input.payload), 'adapter smoke input must contain payload');
          return fn(input.payload, {
            rawPayloadRef: '.sciforge/task-results/raw-payload.json',
            schemaDiagnostics: ['smoke schema diagnostics should stay folded'],
          });
        };
      },
    },
  ];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const module = await import(candidate.path) as PresentationModule;
      const value = module[candidate.exportName];
      if (typeof value === 'function') {
        return candidate.wrap(value as never);
      }
      failures.push(`${candidate.path} did not export ${candidate.exportName}`);
    } catch (error) {
      failures.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.fail([
    'Expected an R015 result presentation materializer.',
    'Worker A/B should provide materializeResultPresentationContract or adaptToolPayloadToResultPresentation.',
    ...failures,
  ].join('\n'));
}

async function loadPresentationValidator() {
  const candidates = [
    { path: '../../src/runtime/gateway/result-presentation-contract.js', exportName: 'validateResultPresentationContract' },
    { path: '../../src/runtime/gateway/result-presentation-adapter.js', exportName: 'validateResultPresentationContract' },
  ];
  for (const candidate of candidates) {
    try {
      const module = await import(candidate.path) as PresentationModule;
      const value = module[candidate.exportName];
      if (typeof value === 'function') return value as (input: unknown) => unknown | Promise<unknown>;
    } catch {
      // Optional while Worker A/B converge on the validator export. The smoke assertions below remain the guard.
    }
  }
  return undefined;
}

function assertContractShape(contract: unknown, fixture: PresentationFixture) {
  assert.ok(isRecord(contract), `${fixture.id}: materializer must return an object`);
  assert.ok(
    contract.schemaVersion === 'sciforge.result-presentation-contract.v1'
      || contract.schemaVersion === 'sciforge.result-presentation.v1',
    `${fixture.id}: schema version`,
  );

  const answerBlocks = requiredArray(contract, 'answerBlocks', fixture.id);
  const keyFindings = requiredArray(contract, 'keyFindings', fixture.id);
  const inlineCitations = requiredArray(contract, 'inlineCitations', fixture.id);
  const artifactActions = requiredArray(contract, 'artifactActions', fixture.id);
  const nextActions = requiredArray(contract, 'nextActions', fixture.id);
  const defaultExpandedSections = requiredArray(contract, 'defaultExpandedSections', fixture.id);

  assert.ok(answerBlocks.length > 0, `${fixture.id}: answerBlocks must be non-empty`);
  assert.ok(keyFindings.length > 0, `${fixture.id}: keyFindings must be non-empty`);
  assert.ok(inlineCitations.length > 0, `${fixture.id}: inlineCitations must be non-empty`);
  assert.ok(artifactActions.length > 0, `${fixture.id}: artifactActions must be non-empty`);
  assert.ok(nextActions.length > 0, `${fixture.id}: nextActions must be non-empty`);
  assert.ok(
    isRecord(contract.confidenceExplanation) || typeof contract.confidenceExplanation === 'string',
    `${fixture.id}: confidenceExplanation must be present`,
  );
  assert.ok(isRecord(contract.processSummary), `${fixture.id}: processSummary must be structured and collapsible`);
  assert.equal(contract.processSummary.foldedByDefault, true, `${fixture.id}: processSummary must fold by default`);
  assert.ok(Array.isArray(contract.diagnosticsRefs), `${fixture.id}: diagnosticsRefs must be an array`);

  for (const section of ['answer', 'evidence', 'artifacts', 'next-actions']) {
    assert.ok(defaultExpandedSections.includes(section), `${fixture.id}: ${section} should be expanded by default`);
  }
  for (const section of ['process', 'trace', 'diagnostics', 'raw-payload', 'raw']) {
    assert.ok(!defaultExpandedSections.includes(section), `${fixture.id}: ${section} should be collapsed by default`);
  }

  const citationIds = new Set(inlineCitations.map((citation, index) => {
    assert.ok(isRecord(citation), `${fixture.id}: inlineCitations[${index}] must be an object`);
    assert.equal(typeof citation.id, 'string', `${fixture.id}: inlineCitations[${index}].id`);
    assert.equal(typeof citation.label, 'string', `${fixture.id}: inlineCitations[${index}].label`);
    assert.equal(typeof citation.ref, 'string', `${fixture.id}: inlineCitations[${index}].ref`);
    return citation.id;
  }));
  for (const [index, finding] of keyFindings.entries()) {
    assert.ok(isRecord(finding), `${fixture.id}: keyFindings[${index}] must be an object`);
    assert.ok(
      typeof finding.statement === 'string' || typeof finding.text === 'string',
      `${fixture.id}: keyFindings[${index}] must expose human-readable text`,
    );
    const findingCitationIds = citationIdsFromFinding(finding);
    const explicitlyUnverified = ['unverified', 'speculative'].includes(String(finding.verificationState ?? finding.status ?? ''));
    assert.ok(
      findingCitationIds.some((id) => citationIds.has(id)) || explicitlyUnverified || Boolean(finding.uncertainty),
      `${fixture.id}: keyFindings[${index}] must cite inline evidence or be explicitly unverified/speculative`,
    );
  }

  if (fixture.expectFailureSummary) {
    assert.ok(
      hasHumanFailureSummary(contract),
      `${fixture.id}: failure/partial contracts must expose human-readable failure reason, impact, and recovery actions`,
    );
  }

  const visibleText = visibleContractText(contract);
  for (const pattern of fixture.expectedVisible) {
    assert.match(visibleText, pattern, `${fixture.id}: expected visible text ${pattern}`);
  }
  for (const pattern of fixture.expectedHidden) {
    assert.doesNotMatch(visibleText, pattern, `${fixture.id}: raw/process diagnostic leaked into default visible text: ${pattern}`);
  }
  assert.doesNotMatch(visibleText, /ToolPayload|executionUnits|uiManifest|reasoningTrace/i, `${fixture.id}: default view should not expose protocol labels`);
}

function assertValidatorOk(result: unknown, fixtureId: string) {
  if (result === true || result === undefined) return;
  if (Array.isArray(result)) {
    assert.deepEqual(result, [], `${fixtureId}: validator returned errors`);
    return;
  }
  assert.ok(isRecord(result), `${fixtureId}: validator must return true, undefined, [], or a structured result`);
  if ('ok' in result) {
    assert.equal(result.ok, true, `${fixtureId}: validator result ok`);
    return;
  }
  if ('valid' in result) {
    assert.equal(result.valid, true, `${fixtureId}: validator result valid`);
    return;
  }
  if ('errors' in result) {
    assert.deepEqual(result.errors, [], `${fixtureId}: validator errors`);
    return;
  }
  assert.fail(`${fixtureId}: unsupported validator result shape`);
}

function requiredArray(record: Record<string, unknown>, key: string, fixtureId: string) {
  const value = record[key];
  assert.ok(Array.isArray(value), `${fixtureId}: ${key} must be an array`);
  return value;
}

function citationIdsFromFinding(finding: Record<string, unknown>) {
  const values = [
    finding.citationIds,
    finding.inlineCitationIds,
    finding.citations,
    finding.referenceIds,
    finding.refs,
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return values.flatMap((value) => {
    if (typeof value === 'string') return [value];
    if (isRecord(value) && typeof value.id === 'string') return [value.id];
    return [];
  });
}

function hasHumanFailureSummary(contract: Record<string, unknown>) {
  const answerText = visibleContractText(contract);
  const hasReason = /failed|failure|did not complete|partial|unavailable|missing|blocked|未完成|失败|缺失/i.test(answerText);
  const hasImpact = /impact|because|needed|blocks?|cannot|无法|原因|影响/i.test(answerText);
  const hasRecovery = /retry|switch|continue|next|recover|quota|稍后|重试|继续|切换/i.test(answerText);
  return hasReason && hasImpact && hasRecovery;
}

function visibleContractText(contract: Record<string, unknown>) {
  return [
    contract.answerBlocks,
    contract.keyFindings,
    contract.inlineCitations,
    contract.artifactActions,
    contract.confidenceExplanation,
    contract.nextActions,
  ].map(publicTextFromValue).join('\n');
}

function publicTextFromValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(publicTextFromValue).join('\n');
  if (!isRecord(value)) return '';
  return Object.entries(value)
    .filter(([key]) => ![
      'raw',
      'rawPayload',
      'toolPayload',
      'executionUnits',
      'uiManifest',
      'processSummary',
      'diagnostics',
      'diagnosticsRefs',
      'trace',
      'reasoningTrace',
      'stdoutRef',
      'stderrRef',
      'backendRouteDecision',
    ].includes(key))
    .map(([, nested]) => publicTextFromValue(nested))
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
