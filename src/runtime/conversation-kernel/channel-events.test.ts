import assert from 'node:assert/strict';
import test from 'node:test';

import { CHANNEL_MESSAGE_SCHEMA_VERSION, type ChannelMessageEnvelope, type ChannelSessionBinding } from '@sciforge-ui/runtime-contract';
import { appendConversationEvent, createConversationEventLog } from './event-log';
import { channelEnvelopeConversationEvents } from './channel-events';
import { projectConversation } from './projection';
import { replayConversationState } from './state-machine';

const envelope: ChannelMessageEnvelope = {
  schemaVersion: CHANNEL_MESSAGE_SCHEMA_VERSION,
  messageId: 'feishu-msg-1',
  channel: 'feishu',
  accountId: 'tenant-a',
  conversationRef: 'feishu:chat:oc_1',
  externalMessageRef: 'feishu:message:om_1',
  senderRef: 'feishu:user:ou_1',
  senderDisplayName: 'Dr. Chen',
  text: 'Summarize the attached protocol.',
  attachmentRefs: ['feishu:file:file_1'],
  rawEventRef: 'audit:feishu:raw:om_1',
  auditRef: 'audit:feishu:intake:om_1',
  dedupeKey: 'feishu:tenant-a:om_1',
  receivedAt: '2026-06-01T00:00:00.000Z',
  authScope: { policyRef: 'policy:feishu' },
};

const binding: ChannelSessionBinding = {
  bindingRef: 'binding:feishu:oc_1',
  channel: 'feishu',
  accountId: 'tenant-a',
  externalConversationRef: 'feishu:chat:oc_1',
  sciForgeThreadRef: 'thread:sciforge-1',
  policyRef: 'policy:feishu',
  createdAt: '2026-06-01T00:00:00.000Z',
};

test('channel envelope appends refs-first intake event plus ordinary TurnReceived user event', () => {
  const [received, turn] = channelEnvelopeConversationEvents(envelope, binding);

  assert.equal(received.type, 'ChannelMessageReceived');
  assert.equal(received.storage, 'ref');
  assert.ok(received.storage === 'ref' && received.payload.refs.some((ref) => ref.ref === 'audit:feishu:intake:om_1'));
  assert.equal(turn.type, 'TurnReceived');
  assert.equal(turn.actor, 'user');
  assert.equal(turn.storage, 'inline');
  assert.deepEqual(turn.payload.source, { channel: 'feishu' });
  assert.equal(turn.payload.conversationRef, 'feishu:chat:oc_1');
  assert.deepEqual(turn.payload.attachmentRefs, ['feishu:file:file_1']);
  assert.equal(turn.payload.auditRef, 'audit:feishu:intake:om_1');

  let log = createConversationEventLog('thread:sciforge-1');
  for (const event of [received, turn]) {
    const appended = appendConversationEvent(log, event);
    assert.equal(appended.rejected, undefined);
    log = appended.log;
  }

  const state = replayConversationState(log);
  const projection = projectConversation(log, state);
  assert.equal(state.status, 'planned');
  assert.equal(projection.currentTurn?.prompt, 'Summarize the attached protocol.');
  assert.ok(projection.auditRefs.includes('audit:feishu:intake:om_1'));
});
