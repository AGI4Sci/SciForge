import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID,
  assertLiteratureCurrentAndSelectedReportCase,
  assertRlit01CurrentRetrieval,
  assertRlit03SelectedReportScoping,
  buildLiteratureCurrentAndSelectedReportCase,
  type LiteratureCurrentAndSelectedReportCaseResult,
} from './literature-current-and-selected-report.js';

test('R-LIT-01 and R-LIT-03 model current arXiv retrieval and selected-report follow-up as an offline Web E2E contract', () => {
  const result = buildLiteratureCurrentAndSelectedReportCase();

  assert.equal(result.input.expected.caseId, LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID);
  assertLiteratureCurrentAndSelectedReportCase(result);
  assert.equal(result.input.expected.providerManifestRef, 'offline-web-e2e-fixture://offline-fixture/provider-manifest/literature-current-selected');
  assert.equal(result.input.expected.artifactDelivery.primaryArtifactRefs[0], 'artifact:r-lit-03-evidence-matrix');
  assert.ok(result.input.expected.runAuditRefs.includes('artifact:r-lit-03-selected-scope-audit'));
});

test('R-LIT-01 verification fails if the fixture claims a live arXiv pass', () => {
  const result = buildLiteratureCurrentAndSelectedReportCase();
  const session = result.workspaceState.sessionsByScenario[result.input.expected.scenarioId];
  const exportRun = session.runs.find((run) => run.id === 'run-r-lit-01-export-status');
  assert.ok(exportRun);
  const exportOutput = fixtureOutput(exportRun);
  assert.ok(exportOutput);
  const broken = {
    ...result,
    workspaceState: {
      ...result.workspaceState,
      sessionsByScenario: {
        ...result.workspaceState.sessionsByScenario,
        [result.input.expected.scenarioId]: {
          ...session,
          runs: session.runs.map((run) => run.id === exportRun.id
            ? {
              ...run,
              raw: {
                ...(isRecord(run.raw) ? run.raw : {}),
                fixtureOutput: { ...exportOutput, live: true },
              },
            }
            : run),
        },
      },
    },
  } satisfies LiteratureCurrentAndSelectedReportCaseResult;

  assert.throws(
    () => assertRlit01CurrentRetrieval(broken),
    /must not claim live retrieval/,
  );
});

test('R-LIT-01 verification fails if methods environments evidence benchmarks limitations reorder axes are dropped', () => {
  const result = buildLiteratureCurrentAndSelectedReportCase();
  const session = result.workspaceState.sessionsByScenario[result.input.expected.scenarioId];
  const brokenSession = {
    ...session,
    artifacts: session.artifacts.map((artifact) => artifact.id === 'r-lit-01-reordered-report'
      ? { ...artifact, metadata: { ...(artifact.metadata as Record<string, unknown>), reorderAxes: ['methods', 'benchmarks'] } }
      : artifact),
  };
  const broken = {
    ...result,
    workspaceState: {
      ...result.workspaceState,
      sessionsByScenario: {
        ...result.workspaceState.sessionsByScenario,
        [result.input.expected.scenarioId]: brokenSession,
      },
    },
  } satisfies LiteratureCurrentAndSelectedReportCaseResult;

  assert.throws(
    () => assertRlit01CurrentRetrieval(broken),
    /reordered report must keep the requested ordering axes/,
  );
});

test('R-LIT-03 verification fails if old selected-report follow-up uses the latest artifact', () => {
  const result = buildLiteratureCurrentAndSelectedReportCase();
  const broken = {
    ...result,
    selectedRefAudit: {
      ...result.selectedRefAudit,
      oldFollowup: {
        ...result.selectedRefAudit.oldFollowup,
        answerRefs: [
          ...result.selectedRefAudit.oldFollowup.answerRefs,
          'artifact:r-lit-01-chinese-report',
        ],
      },
    },
  } satisfies LiteratureCurrentAndSelectedReportCaseResult;

  assert.throws(
    () => assertRlit03SelectedReportScoping(broken),
    /forbidden latest\/unselected ref/,
  );
});

test('R-LIT-03 verification fails if evidence matrix treats latest artifact as selected evidence', () => {
  const result = buildLiteratureCurrentAndSelectedReportCase();
  const broken = {
    ...result,
    evidenceMatrix: result.evidenceMatrix.map((row, index) => index === 0
      ? { ...row, latestArtifactUsed: true }
      : row),
  } satisfies LiteratureCurrentAndSelectedReportCaseResult;

  assert.throws(
    () => assertRlit03SelectedReportScoping(broken),
    /not latest artifact/,
  );
});

function fixtureOutput(run: unknown): Record<string, unknown> | undefined {
  if (!isRecord(run)) return undefined;
  const raw = isRecord(run.raw) ? run.raw : undefined;
  return isRecord(raw?.fixtureOutput) ? raw.fixtureOutput : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
