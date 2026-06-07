import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeRun, SciForgeSession } from '../domain';
import { conversationProjectionForSession } from './conversation-projection-view-model';

test('conversation projection runtime metadata normalizes private workspace paths for visible UI', () => {
  const run = {
    id: 'run-runtime-metadata',
    status: 'completed',
    createdAt: '2026-06-07T00:00:00.000Z',
    raw: {
      displayIntent: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'runtime-codex:codex-command-visible',
          visibleAnswer: {
            status: 'visible-not-live-acceptance',
            text: 'Visible answer.',
            artifactRefs: [],
          },
          artifacts: [],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'unverified' },
          runtimeMetadata: {
            provider: 'https://provider.example.test/v1?api_key=sk-provider-secret-1234567890',
            model: 'deepseek Authorization: Bearer sk-model-secret-1234567890',
            profile: 'runtime token=sk-profile-secret-1234567890',
            workspace: '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
            commandId: 'codex-command-visible',
            foldedAudit: true,
          },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
  } as unknown as SciForgeRun;
  const session = { runs: [run] } as unknown as SciForgeSession;

  const projection = conversationProjectionForSession(session, run);
  const metadata = projection?.runtimeMetadata;
  const serialized = JSON.stringify(metadata);

  assert.equal(metadata?.provider, '[redacted-provider]');
  assert.equal(metadata?.model, '[redacted-model]');
  assert.equal(metadata?.profile, '[redacted-profile]');
  assert.equal(metadata?.workspace, '[redacted-workspace]');
  assert.equal(metadata?.commandId, 'codex-command-visible');
  assert.equal(metadata?.foldedAudit, true);
  assert.doesNotMatch(serialized, /provider\.example|sk-provider-secret|sk-model-secret|sk-profile-secret|\/Applications\/workspace|Bearer/i);
});
