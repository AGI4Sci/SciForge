import assert from 'node:assert/strict';

import {
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
  runtimeConfigToml,
} from '../../packages/backend/src/runtime-home.js';

type CodexFixtureRecord =
  | { type: 'delta'; text: string }
  | { type: 'done'; exitCode: 0 }
  | { type: 'failed'; exitCode: number; message: string }
  | { type: 'stderr'; text: string }
  | { type: 'audit'; message: string; raw: unknown }
  | { type: 'cancel'; reason: string };

type RuntimeAuditMeta = {
  provider: string;
  model: string;
  profile: string;
  workspace: string;
  commandId: string;
};

type NormalizedRuntimeEvent =
  | { type: 'answer.delta'; text: string; audit: RuntimeAuditMeta }
  | { type: 'run.done'; exitCode: 0; audit: RuntimeAuditMeta }
  | { type: 'run.failed'; exitCode: number; message: string; audit: RuntimeAuditMeta }
  | { type: 'run.cancelled'; reason: string; audit: RuntimeAuditMeta }
  | { type: 'audit'; channel: 'stderr' | 'raw-jsonl'; foldedByDefault: true; message: string; raw?: unknown; audit: RuntimeAuditMeta };

type GuiToolResult = {
  ok: boolean;
  appliedRevision: number | null;
  deferred: boolean;
  reason: string | null;
  suggestions: Array<Record<string, unknown>>;
};

const runtimeAudit: RuntimeAuditMeta = {
  provider: RUNTIME_PROVIDER,
  model: RUNTIME_MODEL,
  profile: RUNTIME_PROFILE,
  workspace: '/tmp/sciforge-runtime-workspace',
  commandId: 'cmd-runtime-codex-final-acceptance',
};

const codexFixture: CodexFixtureRecord[] = [
  { type: 'delta', text: 'Runtime Codex answered with a user-facing summary.' },
  { type: 'stderr', text: 'RAW_STDERR_SHOULD_STAY_FOLDED' },
  { type: 'audit', message: 'raw JSONL captured for audit', raw: { secretShape: 'RAW_JSONL_SHOULD_STAY_FOLDED' } },
  { type: 'done', exitCode: 0 },
  { type: 'failed', exitCode: 17, message: 'fixture failure for nonzero exit mapping' },
  { type: 'cancel', reason: 'user cancelled fixture turn' },
];

const normalized = codexFixture.flatMap((record) => normalizeCodexFixtureRecord(record, runtimeAudit));

assert.deepEqual(
  normalized.map((event) => event.type),
  ['answer.delta', 'audit', 'audit', 'run.done', 'run.failed', 'run.cancelled'],
);
assert.ok(normalized.every((event) => hasRuntimeAuditVisibility(event.audit)));
assert.equal(normalized.find((event) => event.type === 'run.done')?.exitCode, 0);
assert.equal(normalized.find((event) => event.type === 'run.failed')?.exitCode, 17);
assert.equal(normalized.find((event) => event.type === 'run.cancelled')?.reason, 'user cancelled fixture turn');
assert.ok(normalized.filter((event) => event.type === 'audit').every((event) => event.foldedByDefault));

const config = runtimeConfigToml();
assertRuntimeProfileFailClosed(config);
assert.equal(runtimeProviderAllowed({ provider: RUNTIME_PROVIDER, allowOpenAiRuntime: false }), true);
assert.equal(runtimeProviderAllowed({ provider: 'openai', allowOpenAiRuntime: false }), false);
assert.equal(runtimeProviderAllowed({ provider: 'openai', allowOpenAiRuntime: true }), true);
assert.throws(() => assertRuntimeProfileFailClosed(withoutRuntimeProfile(config)), /missing runtime profile/);
assert.throws(() => assertRuntimeProfileFailClosed(withoutRuntimeKeyEnv(config)), /missing runtime key env/);

const resources = createGuiResourceTree();
assert.deepEqual(guiList(resources, '/gui').sort(), ['/gui/hot-region.json', '/gui/intent-log.json', '/gui/shell.json']);
assert.match(guiRead(resources, '/gui/shell.json'), /"focusedPanel": "chat"/);
assert.match(guiRead(resources, '/gui/hot-region.json'), /"interactionMode": "idle"/);
assert.deepEqual(guiSearch(resources, 'Runtime Codex'), ['/gui/hot-region.json', '/gui/intent-log.json']);
assert.deepEqual(guiStat(resources, '/gui/intent-log.json'), {
  path: '/gui/intent-log.json',
  revision: 8,
  disclosure: 'shell',
  permission: 'read-only',
  sizeBytes: guiRead(resources, '/gui/intent-log.json').length,
});

for (const result of [
  guiPresent(),
  guiNotify(),
  guiSetStatus(),
  guiDeferredResult('user-editing'),
]) {
  assertGuiToolResultSchema(result);
}

const surface = renderAcceptanceSurface(normalized);
assert.match(surface.mainAnswerDom, /Runtime Codex answered/);
assert.doesNotMatch(surface.mainAnswerDom, /RAW_STDERR_SHOULD_STAY_FOLDED|RAW_JSONL_SHOULD_STAY_FOLDED/);
assert.equal(surface.auditPanel.foldedByDefault, true);
assert.match(JSON.stringify(surface.auditPanel.events), /RAW_STDERR_SHOULD_STAY_FOLDED|RAW_JSONL_SHOULD_STAY_FOLDED/);

console.log('[ok] Runtime Codex final acceptance contracts cover mock JSONL delta/done/failed/stderr/audit/cancel, fail-closed profile config, OpenAI opt-in, provider/model/profile audit visibility, GUI resources, intent result schema, and audit folding');

function normalizeCodexFixtureRecord(
  record: CodexFixtureRecord,
  audit: RuntimeAuditMeta,
): NormalizedRuntimeEvent[] {
  switch (record.type) {
    case 'delta':
      return [{ type: 'answer.delta', text: record.text, audit }];
    case 'done':
      return [{ type: 'run.done', exitCode: record.exitCode, audit }];
    case 'failed':
      return [{ type: 'run.failed', exitCode: record.exitCode, message: record.message, audit }];
    case 'stderr':
      return [{ type: 'audit', channel: 'stderr', foldedByDefault: true, message: record.text, audit }];
    case 'audit':
      return [{ type: 'audit', channel: 'raw-jsonl', foldedByDefault: true, message: record.message, raw: record.raw, audit }];
    case 'cancel':
      return [{ type: 'run.cancelled', reason: record.reason, audit }];
  }
}

function hasRuntimeAuditVisibility(audit: RuntimeAuditMeta): boolean {
  return Boolean(audit.provider && audit.model && audit.profile && audit.workspace && audit.commandId);
}

function assertRuntimeProfileFailClosed(config: string): void {
  if (!config.includes(`[profiles.${RUNTIME_PROFILE}]`)) throw new Error('missing runtime profile');
  if (!config.includes(RUNTIME_PROVIDER)) throw new Error('missing runtime provider');
  if (!config.includes(RUNTIME_MODEL)) throw new Error('missing runtime model');
  if (!config.includes(RUNTIME_KEY_ENV)) throw new Error('missing runtime key env');
  assert.doesNotMatch(config, /model_provider\s*=\s*"openai"/i);
}

function withoutRuntimeProfile(config: string): string {
  return config
    .split(`profile = "${RUNTIME_PROFILE}"`).join('profile = "missing-runtime-profile"')
    .split(`[profiles.${RUNTIME_PROFILE}]`).join('[profiles.missing-runtime-profile]');
}

function withoutRuntimeKeyEnv(config: string): string {
  return config.split(RUNTIME_KEY_ENV).join('MISSING_RUNTIME_KEY_ENV');
}

function runtimeProviderAllowed(input: { provider: string; allowOpenAiRuntime: boolean }): boolean {
  if (/^openai(?:$|-|_|\.)/i.test(input.provider)) return input.allowOpenAiRuntime;
  return true;
}

function createGuiResourceTree(): Map<string, { revision: number; body: string }> {
  return new Map([
    ['/gui/shell.json', {
      revision: 8,
      body: JSON.stringify({
        schemaVersion: 'sciforge.gui-context.v1',
        revision: 8,
        focusedPanel: 'chat',
        availableGuiTools: ['gui.present', 'gui.ask_user', 'gui.notify', 'gui.set_status', 'gui.apply_batch', 'gui.get_context', 'gui.list', 'gui.read', 'gui.search', 'gui.stat', 'gui.watch'],
      }, null, 2),
    }],
    ['/gui/hot-region.json', {
      revision: 8,
      body: JSON.stringify({
        hotRegion: {
          panel: 'chat',
          interactionMode: 'idle',
          selectedRefs: [],
          availableActions: [{ label: 'Submit via Runtime Codex', commandText: '/runtime-codex submit' }],
          visibleText: 'Runtime Codex provider/model/profile visible in header',
        },
      }, null, 2),
    }],
    ['/gui/intent-log.json', {
      revision: 8,
      body: JSON.stringify({
        entries: [
          { tool: 'gui.present', ok: true, summary: 'Runtime Codex answer rendered in main chat' },
          { tool: 'gui.notify', ok: true, summary: 'Provider/model/profile audit visibility recorded' },
        ],
      }, null, 2),
    }],
  ]);
}

function guiList(resources: Map<string, { revision: number; body: string }>, path: string): string[] {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return [...resources.keys()].filter((resourcePath) => resourcePath.startsWith(prefix));
}

function guiRead(resources: Map<string, { revision: number; body: string }>, path: string): string {
  const resource = resources.get(path);
  assert.ok(resource, `${path} must exist`);
  return resource.body;
}

function guiSearch(resources: Map<string, { revision: number; body: string }>, query: string): string[] {
  return [...resources.entries()]
    .filter(([, resource]) => resource.body.includes(query))
    .map(([path]) => path);
}

function guiStat(resources: Map<string, { revision: number; body: string }>, path: string) {
  const resource = resources.get(path);
  assert.ok(resource, `${path} must exist`);
  return {
    path,
    revision: resource.revision,
    disclosure: 'shell',
    permission: 'read-only',
    sizeBytes: resource.body.length,
  };
}

function guiPresent(): GuiToolResult {
  return { ok: true, appliedRevision: 9, deferred: false, reason: null, suggestions: [] };
}

function guiNotify(): GuiToolResult {
  return { ok: true, appliedRevision: 10, deferred: false, reason: null, suggestions: [] };
}

function guiSetStatus(): GuiToolResult {
  return { ok: true, appliedRevision: 11, deferred: false, reason: null, suggestions: [] };
}

function guiDeferredResult(reason: string): GuiToolResult {
  return {
    ok: false,
    appliedRevision: null,
    deferred: true,
    reason,
    suggestions: [{ action: 'defer', until: 'editing-complete' }],
  };
}

function assertGuiToolResultSchema(result: GuiToolResult): void {
  assert.equal(typeof result.ok, 'boolean');
  assert.ok('appliedRevision' in result);
  assert.equal(typeof result.deferred, 'boolean');
  assert.ok('reason' in result);
  assert.ok(Array.isArray(result.suggestions));
}

function renderAcceptanceSurface(events: NormalizedRuntimeEvent[]) {
  const mainAnswerDom = events
    .filter((event): event is Extract<NormalizedRuntimeEvent, { type: 'answer.delta' }> => event.type === 'answer.delta')
    .map((event) => event.text)
    .join('');
  const auditEvents = events.filter((event) => event.type === 'audit');
  return {
    mainAnswerDom,
    auditPanel: {
      foldedByDefault: true,
      events: auditEvents,
    },
  };
}
