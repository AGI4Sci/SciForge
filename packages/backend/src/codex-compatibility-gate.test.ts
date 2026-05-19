import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCodexNoForkGate,
  CODEX_UPSTREAM_PATCH_LOG,
  UPSTREAM_CODEX_COMMAND,
} from './codex-compatibility-gate';

test('no-fork gate keeps upstream Codex as the default runtime boundary', () => {
  assert.deepEqual(assertCodexNoForkGate(), {
    codexCommand: UPSTREAM_CODEX_COMMAND,
    forkAllowed: false,
  });
});

test('no-fork gate rejects alternate Codex binaries without fork evidence', () => {
  assert.throws(
    () => assertCodexNoForkGate({ codexCommand: '/vendor/codex-fork/bin/codex' }),
    /must use upstream "codex"/,
  );
});

test('fork gate requires config, runtime profile, provider proxy, patch log, validation, and rollback evidence', () => {
  assert.throws(
    () => assertCodexNoForkGate({
      codexCommand: '/vendor/codex-fork/bin/codex',
      allowFork: true,
      configGateAttempted: true,
      runtimeProfileAttempted: true,
    }),
    /provider proxy gate.*Codex CLI internal blocker.*docs\/CodexUpstreamPatchLog\.md/,
  );
});

test('fork gate only opens after the documented last-resort conditions are present', () => {
  assert.deepEqual(assertCodexNoForkGate({
    codexCommand: '/vendor/codex-fork/bin/codex',
    allowFork: true,
    configGateAttempted: true,
    runtimeProfileAttempted: true,
    providerProxyAttempted: true,
    blockerConfirmedInCodexCli: true,
    upstreamPatchLogPath: CODEX_UPSTREAM_PATCH_LOG,
    upstreamCommit: 'upstream-commit-sha',
    changedFiles: ['codex-core/src/tool_dispatch.rs'],
    rebaseSteps: ['git fetch upstream && git rebase upstream/main'],
    validationCommands: ['npm run backend:codex-runtime:exec -- --prompt "Reply OK"'],
    rollbackStrategy: 'Return runtime command to upstream codex and remove vendor worktree.',
  }), {
    codexCommand: '/vendor/codex-fork/bin/codex',
    forkAllowed: true,
  });
});
