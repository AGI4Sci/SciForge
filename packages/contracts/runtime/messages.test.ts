import assert from 'node:assert/strict';
import test from 'node:test';
import { isLiveRuntimeCodexMessage, isSeedDemoOrFixtureMessage } from './messages';

test('runtime message provenance classifies native Runtime Codex as live lineage but not live acceptance', () => {
  const message = {
    id: 'seed-looking-native-message',
    role: 'scenario' as const,
    provenance: {
      kind: 'live-runtime-codex',
      source: 'codex.native-message:codex-command-native',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  };

  assert.equal(isSeedDemoOrFixtureMessage(message), false);
  assert.equal(isLiveRuntimeCodexMessage(message), false);
});

test('runtime message provenance keeps explicit seed demo messages excluded', () => {
  assert.equal(isSeedDemoOrFixtureMessage({
    id: 'seed-demo',
    role: 'scenario',
    provenance: {
      kind: 'seed-demo',
      source: 'scenarioDemoData:literature',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  }), true);
});

test('non-live runtime and system messages are not seed demos just because replay eligibility is false', () => {
  assert.equal(isSeedDemoOrFixtureMessage({
    id: 'system-runtime-status',
    role: 'system',
    provenance: {
      kind: 'system-ui',
      source: 'background-completion:run-incomplete',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  }), false);

  assert.equal(isSeedDemoOrFixtureMessage({
    id: 'runtime-failure-message',
    role: 'scenario',
    provenance: {
      kind: 'live-runtime-codex',
      source: 'codex.runtime-failure:codex-command-failed',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  }), false);
});
