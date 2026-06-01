import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  CHANNEL_DELIVERY_SCHEMA_VERSION,
  type ChannelHostPorts,
  type DeliveryEnvelope,
} from '../../../contracts/runtime/channel-plugin';
import {
  createFeishuChannelPlugin,
  feishuChannelPluginManifest,
} from '../index';
import {
  ingestFeishuCliEventRecords,
} from '../intake/cliEventStream';
import {
  LarkCliProvider,
  redactArgs,
  withForcedFormat,
} from '../larkCliProvider';
import {
  normalizeFeishuIncomingEvent,
} from '../intake/normalizeMessage';
import {
  parseFeishuApprovalReply,
} from '../confirmation/parseApprovalReply';
import {
  queryFeishuResource,
} from '../resources';
import {
  sendFeishuDelivery,
} from '../delivery/send';

test('Feishu manifest declares lark-cli-backed channel capabilities without GUI ownership', () => {
  assert.equal(feishuChannelPluginManifest.channelKind, 'feishu');
  assert.equal(feishuChannelPluginManifest.capabilities.intake, true);
  assert.equal(feishuChannelPluginManifest.capabilities.resource, true);
  assert.equal(feishuChannelPluginManifest.capabilities.delivery, true);
  assert.ok(feishuChannelPluginManifest.transports.includes('cli-event-stream'));
  assert.ok(feishuChannelPluginManifest.refPrefixes.includes('feishu:'));
  assert.ok(!JSON.stringify(feishuChannelPluginManifest).includes('renderer'));
});

test('lark-cli provider forces JSON formats and redacts secrets in command audit', async () => {
  assert.deepEqual(withForcedFormat(['im', 'messages', 'search', '--format', 'text'], 'json'), ['im', 'messages', 'search', '--format', 'json']);
  assert.deepEqual(redactArgs(['--tenant-token', 'secret-token', '--path=/Applications/workspace/foo']), ['--tenant-token', '[redacted]', '[redacted]']);

  const provider = new LarkCliProvider({
    now: () => '2026-06-01T00:00:00.000Z',
    runner: async (_command, args) => {
      assert.deepEqual(args.slice(-2), ['--format', 'json']);
      return { stdout: '{"items":[{"message_id":"om_1","text":"hello"}]}', stderr: 'tenant_access_token=secret', exitCode: 0 };
    },
  });
  const result = await provider.runJson(['im', 'messages', 'search', '--query', 'hello'], { operation: 'test.query', sideEffect: 'read' });
  assert.deepEqual(result.json, { items: [{ message_id: 'om_1', text: 'hello' }] });
  assert.match(result.audit.stderrPreview ?? '', /tenant_access_token=\[redacted\]/);
});

test('Feishu intake normalizes CLI events and appends ordinary user messages through Host ports', async () => {
  const appended: unknown[] = [];
  const ports: ChannelHostPorts = {
    async resolveSessionBinding(envelope) {
      return {
        bindingRef: 'binding:feishu:oc_1',
        channel: envelope.channel,
        accountId: envelope.accountId,
        externalConversationRef: envelope.conversationRef,
        sciForgeThreadRef: 'thread:1',
        policyRef: envelope.authScope.policyRef,
        createdAt: envelope.receivedAt,
      };
    },
    async appendThreadUserMessage(input) {
      appended.push(input);
      return { threadRef: input.binding.sciForgeThreadRef, messageId: input.message.id, eventRefs: ['event:1'] };
    },
    idempotency: {
      async claim(input) {
        return { status: 'claimed', idempotencyKey: input.key, auditRef: input.auditRef };
      },
    },
  };

  const results = await ingestFeishuCliEventRecords([{
    event: {
      message: {
        message_id: 'om_123',
        chat_id: 'oc_456',
        content: '{"text":"@SciForge 总结附件","file_key":"file_789"}',
        mentions: [{ open_id: 'ou_bot' }],
      },
      sender: { open_id: 'ou_user', name: 'Dr. Chen' },
    },
  }], ports, {
    accountId: 'tenant-a',
    policyRef: 'policy:feishu',
    now: () => '2026-06-01T00:00:00.000Z',
  });

  assert.equal(results.length, 1);
  const input = appended[0] as Parameters<ChannelHostPorts['appendThreadUserMessage']>[0];
  assert.equal(input.message.role, 'user');
  assert.equal(input.message.provenance?.kind, 'channel-message');
  assert.deepEqual(input.message.provenance?.source, { channel: 'feishu' });
  assert.ok(input.message.references?.some((ref) => ref.ref.startsWith('audit:feishu:intake:')));
  assert.ok(input.ledgerEvents.some((event) => event.type === 'channel.message.received'));
  assert.ok(input.ledgerEvents.some((event) => event.type === 'agent.thread.message.created'));
});

test('Feishu resources use lark-cli and return feishu/artifact/audit refs', async () => {
  const provider = new LarkCliProvider({
    now: () => '2026-06-01T00:00:00.000Z',
    runner: async (_command, args) => {
      assert.ok(args.includes('--format'));
      return { stdout: '{"items":[{"message_id":"om_1","text":"hello"}],"next_cursor":"cursor-2"}', stderr: '', exitCode: 0 };
    },
  });
  const result = await queryFeishuResource(provider, {
    channel: 'feishu',
    accountId: 'tenant-a',
    kind: 'message',
    query: 'hello',
    policyRef: 'policy:feishu',
  });

  assert.equal(result.schemaVersion, 'sciforge.channel-resource-result.v1');
  assert.ok(result.refs.some((ref) => ref.startsWith('feishu:message:')));
  assert.ok(result.refs.some((ref) => ref.startsWith('artifact:feishu-message-')));
  assert.ok(result.refs.some((ref) => ref.startsWith('audit:feishu:lark-cli:')));
});

test('Feishu delivery blocks send without Host approval and sends only after approval and idempotency', async () => {
  const delivery: DeliveryEnvelope = {
    schemaVersion: CHANNEL_DELIVERY_SCHEMA_VERSION,
    channel: 'feishu',
    accountId: 'tenant-a',
    targetConversationRef: 'feishu:chat:oc_1',
    text: 'reply',
    idempotencyKey: 'delivery:feishu:1',
    auditRef: 'audit:feishu:delivery:1',
    policyRef: 'policy:feishu',
  };
  const provider = new LarkCliProvider({
    now: () => '2026-06-01T00:00:00.000Z',
    runner: async (_command, args) => {
      assert.ok(args.includes('--idempotency-key'));
      return { stdout: '{"ok":true}', stderr: '', exitCode: 0 };
    },
  });

  const blocked = await sendFeishuDelivery(provider, delivery, {});
  assert.equal(blocked.status, 'blocked');

  const sent = await sendFeishuDelivery(provider, delivery, {
    approval: {
      async authorizeDelivery() {
        return { status: 'approved', approvalRef: 'approval:1', auditRef: 'audit:approval:1' };
      },
    },
    idempotency: {
      async claim(input) {
        return { status: 'claimed', idempotencyKey: input.key, auditRef: 'audit:idempotency:1' };
      },
    },
    audit: {
      async record() {
        return { status: 'recorded', auditRef: 'audit:host:1', redacted: true };
      },
    },
  });
  assert.equal(sent.status, 'sent');
  assert.equal(sent.approvalRef, 'approval:1');
  assert.ok(sent.auditRefs.includes('audit:host:1'));
});

test('confirmation parser maps Feishu approval replies into approval results', () => {
  const event = normalizeFeishuIncomingEvent({
    message_id: 'om_confirm',
    chat_id: 'oc_1',
    sender_id: 'ou_1',
    text: '确认',
  }, {
    accountId: 'tenant-a',
    policyRef: 'policy:feishu',
    now: () => '2026-06-01T00:00:00.000Z',
  });
  assert.equal(parseFeishuApprovalReply(event)?.status, 'approved');
});

test('Feishu plugin implements ChannelPlugin without exposing provider details to callers', () => {
  const plugin = createFeishuChannelPlugin({ accountId: 'tenant-a', policyRef: 'policy:feishu' });
  assert.equal(plugin.describe().pluginId, 'sciforge.channel.feishu');
  assert.equal(typeof plugin.queryResource, 'function');
  assert.equal(typeof plugin.draftDelivery, 'function');
});

test('Web UI boundary does not import Feishu plugin, SDK, or lark-cli', async () => {
  const root = process.cwd();
  const chatPanel = await readFile(join(root, 'src/ui/src/app/ChatPanel.tsx'), 'utf8');
  const uiSources = await readFile(join(root, 'src/ui/src/domain.ts'), 'utf8');
  assert.doesNotMatch(`${chatPanel}\n${uiSources}`, /packages\/connectors\/feishu|connectors\/feishu|lark-cli|@larksuite|lark-oapi|feishu\/plugin/i);
});
