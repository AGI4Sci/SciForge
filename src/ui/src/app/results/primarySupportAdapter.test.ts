import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { RuntimeCompatibilityDiagnostic, SciForgeSession } from '../../domain';
import { runtimeCompatibilityDiagnosticsForPresentation } from './primaryRunStatusAdapter';

function sessionFixture(diagnostics: unknown[]): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-primary-support',
    scenarioId: 'research' as never,
    title: 'Primary support fixture',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-current',
      scenarioId: 'research' as never,
      status: 'completed',
      prompt: 'show result',
      response: '',
      createdAt: '2026-06-01T00:10:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    runtimeCompatibilityDiagnostics: diagnostics as RuntimeCompatibilityDiagnostic[],
  };
}

function diagnosticFixture(id: string, createdAt: string): RuntimeCompatibilityDiagnostic {
  return {
    schemaVersion: 1,
    id,
    kind: 'capability-version-drift',
    severity: 'warning',
    reason: `Capability changed for ${id}`,
    current: {
      schemaVersion: 1,
      appStateSchemaVersion: 1,
      sessionSchemaVersion: 2,
      compatibilityVersion: 'current',
      capabilityFingerprints: [`capability:${id}`],
    },
    persisted: {
      schemaVersion: 1,
      appStateSchemaVersion: 1,
      sessionSchemaVersion: 2,
      compatibilityVersion: 'previous',
      capabilityFingerprints: [`capability:${id}:old`],
    },
    affectedSessionId: 'session-primary-support',
    affectedScenarioId: 'research' as never,
    recoverable: true,
    recoverableActions: [`review ${id}`],
    createdAt,
  };
}

test('primary support adapter owns support rendering extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./primarySupportAdapter.tsx', import.meta.url), 'utf8');
  const runStatusSource = readFileSync(new URL('./primaryRunStatusAdapter.tsx', import.meta.url), 'utf8');
  const primaryAdapterSource = readFileSync(new URL('./primaryResultAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function PrimarySupportDetails/);
  assert.match(adapterSource, /from '.\/primaryRunStatusAdapter'/);
  assert.doesNotMatch(adapterSource, /function RunStatusSummary/);
  assert.doesNotMatch(adapterSource, /function RunPresentationStateSummary|function RunProgressSummary|function RuntimeCompatibilityDiagnosticSummary/);
  assert.match(runStatusSource, /export function RunStatusSummary/);
  assert.match(runStatusSource, /export function RuntimeCompatibilityDetails/);
  assert.match(runStatusSource, /export function runtimeCompatibilityDiagnosticsForPresentation/);
  assert.match(adapterSource, /function ViewPlanDetails/);
  assert.match(primaryAdapterSource, /from '.\/primarySupportAdapter'/);
  assert.doesNotMatch(rendererSource, /from '.\/results\/primarySupportAdapter'/);
  assert.doesNotMatch(rendererSource, /function RunStatusSummary/);
  assert.doesNotMatch(rendererSource, /function ViewPlanDetails/);
});

test('runtime compatibility diagnostics are run-scoped, typed, and bounded', () => {
  const diagnostics = [
    diagnosticFixture('stale', '2026-06-01T00:00:00.000Z'),
    { schemaVersion: 1, id: 'invalid', reason: 'missing current', recoverableActions: [] },
    diagnosticFixture('a', '2026-06-01T00:11:00.000Z'),
    diagnosticFixture('b', '2026-06-01T00:12:00.000Z'),
    diagnosticFixture('c', '2026-06-01T00:13:00.000Z'),
    diagnosticFixture('d', '2026-06-01T00:14:00.000Z'),
    diagnosticFixture('e', '2026-06-01T00:15:00.000Z'),
  ];
  const session = sessionFixture(diagnostics);
  const projected = runtimeCompatibilityDiagnosticsForPresentation(session, session.runs[0]);

  assert.deepEqual(projected.map((item) => item.id), ['a', 'b', 'c', 'd']);
});
