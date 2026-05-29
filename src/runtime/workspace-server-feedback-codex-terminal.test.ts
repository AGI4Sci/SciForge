import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildFeedbackCodexTerminalPrompt,
  buildFeedbackCodexTerminalRepairRun,
  feedbackCodexPtyArgs,
  feedbackCodexSystemTerminalLaunchRef,
  feedbackCodexTerminalDir,
  feedbackCodexTerminalManifestRef,
  feedbackCodexTerminalMirrorRef,
  feedbackCodexTerminalPromptRef,
  feedbackCodexTerminalPublicSession,
  feedbackCodexTerminalStatus,
  feedbackCodexTerminalTransport,
  feedbackPromptEvidenceRefs,
  quoteShellArg,
  repairRunStatusForCodexTerminal,
  repairRunStatusForResult,
  resolveCodexPtyCommand,
  systemTerminalCodexCommandPreview,
  systemTerminalCodexShellCommand,
  systemTerminalLaunchScript,
  systemTerminalRuntimeEnvExports,
  systemTerminalRuntimeKeyReaderScript,
  withCodexPtyPath,
  type FeedbackCodexTerminalSession,
} from './workspace-server-feedback-codex-terminal.js';

function fixtureSession(overrides: Partial<FeedbackCodexTerminalSession> = {}): FeedbackCodexTerminalSession {
  return {
    schemaVersion: 1,
    id: 'codex-pty-terminal-feedback-1',
    issueId: 'feedback-1',
    repairRunId: 'repair-run-1',
    status: 'running',
    workspacePath: '/workspace',
    terminalMirrorRef: '/workspace/.sciforge/repair-results/repair-run-1/terminal-mirror.ndjson',
    promptRef: '/workspace/.sciforge/repair-results/repair-run-1/feedback-codex-prompt.md',
    promptPreview: 'repair the issue',
    codexSessionId: 'codex-session-1',
    startedAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:01:00.000Z',
    message: 'running',
    runtimeProfile: 'runtime-profile',
    allowOpenAiRuntime: false,
    transport: 'websocket-pty',
    webSocketPath: '/api/sciforge/feedback/codex-pty/codex-pty-terminal-feedback-1/ws',
    ...overrides,
  };
}

test('feedback terminal status and transport normalizers preserve only supported values', () => {
  assert.equal(feedbackCodexTerminalStatus('starting'), 'starting');
  assert.equal(feedbackCodexTerminalStatus('running'), 'running');
  assert.equal(feedbackCodexTerminalStatus('idle'), 'idle');
  assert.equal(feedbackCodexTerminalStatus('failed'), 'failed');
  assert.equal(feedbackCodexTerminalStatus('cancelled'), 'cancelled');
  assert.equal(feedbackCodexTerminalStatus('unknown'), 'idle');

  assert.equal(feedbackCodexTerminalTransport('system-terminal'), 'system-terminal');
  assert.equal(feedbackCodexTerminalTransport('websocket-pty'), 'websocket-pty');
  assert.equal(feedbackCodexTerminalTransport('bogus'), 'websocket-pty');
});

test('feedbackCodexTerminalPublicSession projects durable public fields', () => {
  const session = {
    ...fixtureSession({ status: 'not-a-status' as FeedbackCodexTerminalSession['status'] }),
    ptyProcess: { kill() {} },
    ptyBacklog: ['private output'],
  };

  const projected = feedbackCodexTerminalPublicSession(session);
  assert.equal(projected.status, 'idle');
  assert.equal(projected.id, session.id);
  assert.equal(projected.terminalMirrorRef, session.terminalMirrorRef);
  assert.equal('ptyProcess' in projected, false);
  assert.equal('ptyBacklog' in projected, false);
});

test('repair run status mappings match feedback result and terminal outcomes', () => {
  assert.equal(repairRunStatusForResult({ verdict: 'fixed' }), 'fixed');
  assert.equal(repairRunStatusForResult({ verdict: 'partially-fixed' }), 'needs-human-verification');
  assert.equal(repairRunStatusForResult({ verdict: 'needs-follow-up' }), 'needs-human-verification');
  assert.equal(repairRunStatusForResult({ verdict: 'rejected' }), 'blocked');
  assert.equal(repairRunStatusForResult({}), 'blocked');

  assert.equal(repairRunStatusForCodexTerminal('starting'), 'running');
  assert.equal(repairRunStatusForCodexTerminal('running'), 'running');
  assert.equal(repairRunStatusForCodexTerminal('idle'), 'needs-human-verification');
  assert.equal(repairRunStatusForCodexTerminal('failed'), 'blocked');
  assert.equal(repairRunStatusForCodexTerminal('cancelled'), 'blocked');
});

test('terminal ref builders keep sessions under normalized repair-results directory', () => {
  const root = '/tmp/sciforge workspace';
  const sessionId = '../codex session:feedback/1';
  const dir = feedbackCodexTerminalDir(root, sessionId);
  assert.equal(dir, join(root, '.sciforge', 'repair-results', '_codex_session_feedback_1'));
  assert.equal(feedbackCodexTerminalMirrorRef(root, sessionId), join(dir, 'terminal-mirror.ndjson'));
  assert.equal(feedbackCodexTerminalPromptRef(root, sessionId), join(dir, 'feedback-codex-prompt.md'));
  assert.equal(feedbackCodexSystemTerminalLaunchRef(root, sessionId), join(dir, 'system-terminal-launch.command'));
  assert.equal(feedbackCodexTerminalManifestRef(root, sessionId), join(dir, 'direct-codex-terminal.json'));
});

test('feedbackPromptEvidenceRefs collects durable refs from comment and assets uniquely', () => {
  const refs = feedbackPromptEvidenceRefs({
    evidenceBundleRef: ' bundle.json ',
    screenshotRef: 'screenshot.png',
    rawScreenshotRef: 'screenshot.png',
    annotatedScreenshotRef: '',
    evidenceAssets: [
      {
        ref: 'asset-ref',
        localRef: ' local-asset ',
        publicUrl: 'https://example.test/asset.png',
        markdownImageUrl: 'https://example.test/asset.png',
        metadata: { manifestRef: 'manifest.json' },
      },
      { ref: 'asset-ref' },
      'not-record',
    ],
  });

  assert.deepEqual(refs, [
    'bundle.json',
    'screenshot.png',
    'asset-ref',
    'local-asset',
    'https://example.test/asset.png',
    'manifest.json',
  ]);
});

test('buildFeedbackCodexTerminalPrompt renders issue, target, runtime, guidance, and evidence', () => {
  const prompt = buildFeedbackCodexTerminalPrompt({
    root: '/workspace/project',
    issueId: 'feedback-1',
    userGuidance: 'Start with the narrow button regression.',
    bundle: {
      title: 'Button regression',
      comment: {
        comment: 'Clicking Save does nothing.',
        expectedBehavior: 'Save should persist.',
        actualBehavior: 'No request is sent.',
        screenshotRef: 'screens/save.png',
      },
      request: { title: 'Fix save button' },
      target: {
        selector: 'button[data-testid="save"]',
        path: 'App > SaveButton',
        tagName: 'BUTTON',
        text: 'Save',
        rect: { x: 10, y: 20, width: 120, height: 32 },
      },
      runtime: {
        page: 'FeedbackInbox',
        url: 'http://localhost:5173/feedback',
        scenarioId: 'feedback-save',
        sessionId: 'session-1',
        activeRunId: 'run-1',
      },
    },
  });

  assert.match(prompt, /Workspace: \/workspace\/project/);
  assert.match(prompt, /Feedback issue: feedback-1/);
  assert.match(prompt, /- Comment: Clicking Save does nothing\./);
  assert.match(prompt, /- Expected: Save should persist\./);
  assert.match(prompt, /- Request: Fix save button/);
  assert.match(prompt, /- Initial guidance: Start with the narrow button regression\./);
  assert.match(prompt, /- Selector: button\[data-testid="save"\]/);
  assert.match(prompt, /- Rect: x=10 y=20 w=120 h=32/);
  assert.match(prompt, /- Page: FeedbackInbox/);
  assert.match(prompt, /- screens\/save\.png/);
  assert.match(prompt, /Do not commit, push, create a PR, merge/);
});

test('buildFeedbackCodexTerminalPrompt includes an explicit empty evidence fallback', () => {
  const prompt = buildFeedbackCodexTerminalPrompt({
    root: '/workspace/project',
    issueId: 'feedback-2',
    bundle: {
      title: 'Missing evidence case',
      comment: {},
    },
  });

  assert.match(prompt, /- Comment: Missing evidence case/);
  assert.match(prompt, /No durable screenshot\/evidence refs were recorded/);
});

test('feedbackCodexPtyArgs builds Codex CLI args with network config and prompt as final arg', () => {
  const args = feedbackCodexPtyArgs({
    profile: 'sciforge-runtime-deepseek',
    workspace: '/workspace/project',
    sandbox: 'workspace-write',
    prompt: 'repair prompt',
  });

  assert.deepEqual(args.slice(0, 2), ['--config', 'sandbox_workspace_write.network_access=true']);
  assert.deepEqual(args.slice(2, -1), [
    '--profile',
    'sciforge-runtime-deepseek',
    '--cd',
    '/workspace/project',
    '--sandbox',
    'workspace-write',
    '--ask-for-approval',
    'never',
    '--no-alt-screen',
  ]);
  assert.equal(args.at(-1), 'repair prompt');
});

test('shell command rendering quotes args and reads the generated prompt from disk', () => {
  const prompt = 'full prompt body should not be embedded';
  const command = systemTerminalCodexShellCommand({
    codexCommand: '/opt/homebrew/bin/codex',
    args: ['--cd', "/workspace/that's mine", prompt],
    prompt,
    promptRef: "/tmp/prompt file's.md",
  });

  assert.equal(quoteShellArg("that's mine"), "'that'\\''s mine'");
  assert.equal(
    command,
    "'/opt/homebrew/bin/codex' '--cd' '/workspace/that'\\''s mine' \"$(cat '/tmp/prompt file'\\''s.md')\"",
  );
  assert.equal(command.includes(prompt), false);
});

test('system terminal preview and script avoid embedding runtime API key values', () => {
  const prompt = 'repair prompt with sensitive context';
  const input = {
    workspace: '/workspace/project',
    codexCommand: '/opt/homebrew/bin/codex',
    args: ['--profile', 'runtime', prompt],
    prompt,
    promptRef: '/workspace/.sciforge/repair-results/run/feedback-codex-prompt.md',
    codexHome: '/tmp/codex home',
    configPath: '/workspace/config.local.json',
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'SECRET_FROM_ENV',
      SCIFORGE_RUNTIME_MODEL: 'model-name',
      SCIFORGE_RUNTIME_BASE_URL: 'https://provider.example/v1',
      SCIFORGE_RUNTIME_CODEX_COMMAND: 'codex',
      PATH: '/custom/bin',
    },
    path: '/custom/bin:/usr/bin',
  };

  const preview = systemTerminalCodexCommandPreview(input);
  assert.match(preview, /SCIFORGE_RUNTIME_API_KEY=<from config\.local\.json>/);
  assert.match(preview, /\$\(cat '\/workspace\/\.sciforge\/repair-results\/run\/feedback-codex-prompt\.md'\)/);
  assert.equal(preview.includes('SECRET_FROM_ENV'), false);
  assert.equal(preview.includes(prompt), false);

  const exports = systemTerminalRuntimeEnvExports(input);
  assert.ok(exports.includes("export SCIFORGE_CONFIG_PATH='/workspace/config.local.json'"));
  assert.ok(exports.includes("export SCIFORGE_RUNTIME_MODEL='model-name'"));
  assert.ok(exports.includes("export SCIFORGE_RUNTIME_BASE_URL='https://provider.example/v1'"));
  assert.equal(exports.some((line) => line.includes('SECRET_FROM_ENV')), false);

  const script = systemTerminalLaunchScript(input);
  assert.match(script, /^#!\/bin\/zsh\nset -e\n/);
  assert.match(script, /cd '\/workspace\/project'/);
  assert.match(script, /export CODEX_HOME='\/tmp\/codex home'/);
  assert.match(script, /export PATH='\/custom\/bin:\/usr\/bin'/);
  assert.match(script, /read "\?Press Return to close this window\.\.\."/);
  assert.equal(script.includes('SECRET_FROM_ENV'), false);
  assert.equal(script.includes(prompt), false);
});

test('runtime key reader script is generated without reading local config during tests', () => {
  const script = systemTerminalRuntimeKeyReaderScript();
  assert.match(script, /const fs = require\("fs"\);/);
  assert.match(script, /apiKey/);
  assert.match(script, /runtimeCodexProxy/);
});

test('withCodexPtyPath preserves existing PATH entries and appends unique fallbacks', () => {
  const env = withCodexPtyPath({ PATH: '/custom/bin:/usr/bin:/custom/bin' });
  assert.equal(env.PATH, '/custom/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/bin');
});

test('resolveCodexPtyCommand resolves through injectable fileExists and preserves explicit paths', async () => {
  const checked: string[] = [];
  const env = { PATH: '/missing:/tools:/later' };
  const result = await resolveCodexPtyCommand('codex', env, {
    fileExists: async (candidate) => {
      checked.push(candidate);
      return candidate === '/tools/codex';
    },
  });

  assert.equal(result, '/tools/codex');
  assert.deepEqual(checked, ['/missing/codex', '/tools/codex']);

  const explicit = await resolveCodexPtyCommand('./node_modules/.bin/codex', env, {
    fileExists: () => {
      throw new Error('fileExists should not run for explicit paths');
    },
  });
  assert.equal(explicit, './node_modules/.bin/codex');
});

test('buildFeedbackCodexTerminalRepairRun projects terminal metadata without launching anything', () => {
  const run = buildFeedbackCodexTerminalRepairRun({
    session: fixtureSession({ transport: 'system-terminal', systemTerminalLaunchRef: '/tmp/run.command' }),
    comment: { screenshotRef: 'screens/issue.png' },
    body: { initialMessage: 'Please keep this scoped.', gitMode: 'manual-only' },
    instanceId: 'p1',
    instanceRole: 'main',
  });

  assert.equal(run.id, 'repair-run-1');
  assert.equal(run.actor, 'system-terminal-codex');
  assert.equal(run.externalInstanceId, 'p1');
  assert.equal(run.externalInstanceName, 'main');
  assert.equal(run.metadata.terminalMode, 'system-terminal-codex');
  assert.deepEqual(run.metadata.evidenceRefs, ['screens/issue.png']);
  assert.equal(run.metadata.initialTerminalGuidance, 'Please keep this scoped.');
  assert.equal(run.metadata.userGitMode, 'manual-only');
});
