import assert from 'node:assert/strict';
import test from 'node:test';

import type { SciForgeSession } from '../../domain';
import { createUpdateCapabilityPreferenceUIAction, recordUIActionInSession } from '../uiActionBoundary';
import { composerDeclaredIntentsForSession } from './composerDeclaredIntents';

const baseSession: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-composer-intents',
  scenarioId: 'literature-evidence-review',
  title: 'Composer intents',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
  hiddenResultSlotIds: [],
};

test('composer declared intents extract the latest public model picker choice', () => {
  const first = createUpdateCapabilityPreferenceUIAction({
    id: 'ui-action-model-fast',
    session: baseSession,
    createdAt: '2026-06-01T00:00:01.000Z',
    preference: {
      intent: 'composer-model-selection',
      source: 'composer-model-menu',
      modelIntentId: 'assistant-fast',
      publicLabel: 'Assistant Fast',
      mode: 'assistant',
      capabilityTier: 'fast',
    },
  });
  const second = createUpdateCapabilityPreferenceUIAction({
    id: 'ui-action-model-deep',
    session: baseSession,
    createdAt: '2026-06-01T00:00:02.000Z',
    preference: {
      intent: 'composer-model-selection',
      source: 'composer-model-menu',
      modelIntentId: 'assistant-deep',
      publicLabel: 'Assistant Deep',
      mode: 'assistant',
      capabilityTier: 'deep',
    },
  });
  const session = [first, second].reduce((current, action) => recordUIActionInSession(current, action), baseSession);

  assert.deepEqual(composerDeclaredIntentsForSession(session), {
    schemaVersion: 'sciforge.composer-declared-intents.v1',
    source: 'ui-action-audit-log',
    model: {
      modelIntentId: 'assistant-deep',
      publicLabel: 'Assistant Deep',
      mode: 'assistant',
      capabilityTier: 'deep',
      actionId: 'ui-action-model-deep',
      declaredAt: '2026-06-01T00:00:02.000Z',
    },
  });
});

test('composer declared intents fail closed for private or malformed picker data', () => {
  const privateLabelAction = createUpdateCapabilityPreferenceUIAction({
    id: 'ui-action-model-private',
    session: baseSession,
    createdAt: '2026-06-01T00:00:03.000Z',
    preference: {
      intent: 'composer-model-selection',
      source: 'composer-model-menu',
      modelIntentId: 'assistant-balanced',
      publicLabel: 'https://provider.local/v1 token secret',
      mode: 'assistant',
      capabilityTier: 'balanced',
      providerUrl: 'https://provider.local/v1',
      apiKey: 'sk-private',
    },
  });
  const session = recordUIActionInSession(baseSession, privateLabelAction);

  assert.equal(composerDeclaredIntentsForSession(session)?.model?.publicLabel, 'Assistant Balanced');
  assert.doesNotMatch(JSON.stringify(composerDeclaredIntentsForSession(session)), /provider|token|secret|sk-private/i);

  const malformedAction = createUpdateCapabilityPreferenceUIAction({
    id: 'ui-action-model-raw',
    session: baseSession,
    createdAt: '2026-06-01T00:00:04.000Z',
    preference: {
      intent: 'composer-model-selection',
      source: 'composer-model-menu',
      modelIntentId: 'bailian/deepseek-v4',
      publicLabel: 'DeepSeek private',
      mode: 'provider-route',
      capabilityTier: 'custom',
    },
  });

  assert.equal(composerDeclaredIntentsForSession(recordUIActionInSession(baseSession, malformedAction)), undefined);
});
