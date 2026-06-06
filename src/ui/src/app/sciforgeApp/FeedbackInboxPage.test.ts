import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { repairReadinessSummary, workspaceWriterReadinessRows, type RepairPeerReadinessByName } from './feedbackRepairReadiness';
import { buildBlockedRepairHandoffResultInput } from './feedbackBlockedRepairResult';
import type { FeedbackCommentRecord, PeerInstance, RuntimeCodexBrowserAcceptanceManifest, RuntimeProviderPreflightManifest } from '../../domain';

const feedbackInboxSource = readFileSync(new URL('./FeedbackInboxPage.tsx', import.meta.url), 'utf8');
const feedbackActionConfirmationSource = readFileSync(new URL('./FeedbackActionConfirmation.tsx', import.meta.url), 'utf8');
const feedbackInboxToolbarSource = readFileSync(new URL('./FeedbackInboxToolbar.tsx', import.meta.url), 'utf8');
const feedbackEvidenceReviewSource = readFileSync(new URL('./FeedbackEvidenceReview.tsx', import.meta.url), 'utf8');
const projectSource = readFileSync(new URL('../../../../../PROJECT.md', import.meta.url), 'utf8');
const feedbackInboxCss = readFileSync(new URL('../../styles/app-feedback.css', import.meta.url), 'utf8');
const directCodexTerminalSource = readFileSync(new URL('../../feedback/FeedbackCodexTerminalPanel.tsx', import.meta.url), 'utf8');
const feedbackRepairAuditPanelSource = readFileSync(new URL('../../feedback/FeedbackRepairAuditPanel.tsx', import.meta.url), 'utf8');
const githubFeedbackSource = readFileSync(new URL('../../feedback/githubFeedback.ts', import.meta.url), 'utf8');
const feedbackScreenshotPreviewSource = readFileSync(new URL('../../feedback/FeedbackScreenshotPreview.tsx', import.meta.url), 'utf8');
const sciForgeAppSource = readFileSync(new URL('../SciForgeApp.tsx', import.meta.url), 'utf8');
const sciForgeAppFeedbackActionsSource = readFileSync(new URL('../SciForgeAppFeedbackActions.ts', import.meta.url), 'utf8');
const workspaceServerSource = readFileSync(new URL('../../../../runtime/workspace-server.ts', import.meta.url), 'utf8');
const workspaceServerFeedbackCodexTerminalSource = readFileSync(new URL('../../../../runtime/workspace-server-feedback-codex-terminal.ts', import.meta.url), 'utf8');

const repairPeer: PeerInstance = {
  name: 'repair',
  appUrl: 'http://127.0.0.1:5174',
  workspaceWriterUrl: 'http://127.0.0.1:6174',
  workspacePath: '/tmp/sciforge-repair',
  role: 'repair',
  trustLevel: 'repair',
  enabled: true,
};

test('repair readiness requires live repair peer health instead of config-only peers', () => {
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    {},
  );

  assert.equal(summary.status, 'partial');
  assert.equal(summary.rows.find((row) => row.label === 'repair peers')?.state, 'partial');
  assert.match(summary.rows.find((row) => row.label === 'repair peers')?.detail ?? '', /checking/);
});

test('repair readiness blocks unhealthy peer even when provider preflight is ready', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'blocked',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['manifest missing capabilities: feedback-repair-result-record'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    readiness,
  );

  assert.equal(summary.status, 'partial');
  assert.equal(summary.rows.find((row) => row.label === 'repair peers')?.state, 'blocked');
  assert.match(summary.rows.find((row) => row.label === 'repair peers')?.detail ?? '', /manifest missing capabilities/);
});

test('repair readiness becomes ready only after peer, provider, and strict browser acceptance pass', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    readiness,
  );

  assert.equal(summary.status, 'ready');
  assert.equal(summary.executionReady, true);
  assert.equal(summary.releaseReady, true);
  assert.equal(summary.rows.find((row) => row.label === 'strict acceptance')?.state, 'ready');
});

test('repair readiness treats stale passed browser acceptance as partial release evidence', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance({ observedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    '',
    readiness,
  );

  assert.equal(summary.executionReady, true);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.status, 'partial');
  assert.match(summary.browserBlocker, /stale|invalid/);
  assert.equal(summary.rows.find((row) => row.label === 'strict acceptance')?.state, 'partial');
});

test('workspace writer readiness surfaces stale capabilities before repair acceptance', () => {
  const stale = workspaceWriterReadinessRows({
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: 123,
    startedAt: '2026-05-07T00:00:00.000Z',
    capabilities: ['workspace-snapshot', 'runtime-provider-preflight-manifest'],
  }, '', 'http://127.0.0.1:6173/');
  assert.equal(stale[0].state, 'blocked');
  assert.equal(stale[0].value, 'stale-capabilities');
  assert.match(stale[0].detail ?? '', /url=http:\/\/127\.0\.0\.1:6173/);
  assert.match(stale[0].detail ?? '', /runtime-codex-browser-acceptance-manifest/);

  const current = workspaceWriterReadinessRows({
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: 124,
    startedAt: '2026-05-07T00:01:00.000Z',
    capabilities: [
      'repair-handoff-runner',
      'feedback-direct-codex-terminal-websocket-pty',
      'feedback-direct-codex-terminal-system-terminal',
      'feedback-repair-terminal-mirror-tail',
      'runtime-provider-preflight-manifest',
      'runtime-codex-browser-acceptance-manifest',
    ],
  }, '', 'http://127.0.0.1:6173/');
  assert.equal(current[0].state, 'ready');
  assert.equal(current[0].value, 'current');
  assert.match(current[0].detail ?? '', /url=http:\/\/127\.0\.0\.1:6173/);

  const unreachable = workspaceWriterReadinessRows(undefined, 'Workspace Writer 未连接：http://127.0.0.1:6199 无法访问', 'http://127.0.0.1:6199/');
  assert.equal(unreachable[0].state, 'blocked');
  assert.equal(unreachable[0].value, 'unreachable');
  assert.match(unreachable[0].detail ?? '', /url=http:\/\/127\.0\.0\.1:6199/);
  assert.match(unreachable[0].detail ?? '', /Workspace Writer 未连接/);
});

test('blocked provider handoff builds durable repair audit payload', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const provider = blockedProviderPreflight();
  const browser = blockedBrowserAcceptance();
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    provider,
    '',
    browser,
    '',
    readiness,
  );
  const result = buildBlockedRepairHandoffResultInput({
    item: feedbackComment(),
    failureKind: 'runtime-provider-preflight-blocked',
    message: summary.providerBlocker,
    completedAt: '2026-05-07T01:00:00.000Z',
    target: repairPeer,
    repairReadiness: summary,
    peerReadinessByName: readiness,
    runtimePreflightManifest: provider,
    browserAcceptanceManifest: browser,
    sourceWorkspacePath: '/tmp/source',
  });

  assert.equal(result.verdict, 'needs-follow-up');
  assert.equal(result.status, 'blocked');
  assert.match(result.summary, /provider preflight is not release-ready/);
  assert.deepEqual(result.changedFiles, []);
  assert.ok(result.evidenceRefs?.includes('docs/test-artifacts/runtime-provider-preflight/manifest.json'));
  assert.ok(result.evidenceRefs?.includes('.sciforge/feedback/feedback-1/comment.json'));
  assert.equal(result.testResults?.[0]?.status, 'failed');
  assert.equal(result.humanVerification?.status, 'not-run');
  assert.equal(result.metadata?.failureKind, 'runtime-provider-preflight-blocked');
  assert.equal((result.metadata?.repairReadiness as { providerReady?: boolean }).providerReady, false);
  assert.equal((result.metadata?.runtimePreflightManifest as RuntimeProviderPreflightManifest).category, 'config-secret-source');
  assert.equal(result.metadata?.targetWorkspaceWriterUrl, repairPeer.workspaceWriterUrl);
  assert.equal((result.metadata?.confirmationPolicy as { commit?: string }).commit, 'requires-user-confirmation');
});

test('feedback inbox keeps search field wired to no-match empty state copy', () => {
  assert.match(feedbackInboxSource, /searchQuery=\{searchQuery\}/);
  assert.match(feedbackInboxSource, /onSearchQueryChange=\{setSearchQuery\}/);
  assert.match(feedbackInboxToolbarSource, /value=\{searchQuery\}/);
  assert.match(feedbackInboxToolbarSource, /onChange=\{\(event\) => onSearchQueryChange\(event\.target\.value\)\}/);
  assert.match(feedbackInboxToolbarSource, /aria-label="搜索反馈、GitHub Issue 或证据 ref"/);
  assert.match(feedbackInboxToolbarSource, /placeholder="搜索反馈、Issue、ref\.\.\."/);
  assert.match(feedbackInboxSource, /没有匹配当前筛选或搜索的反馈/);
  assert.match(feedbackInboxSource, /调整状态筛选、清空搜索/);
  assert.match(feedbackInboxSource, /点击顶栏“注释”打开反馈侧栏/);
  assert.match(feedbackInboxSource, /小改动可快捷处理/);
  assert.match(feedbackInboxSource, /隐藏选择不会参与当前操作/);
});

test('feedback inbox labels annotation records as intent-first inbox entries', () => {
  assert.match(feedbackInboxSource, /ANNOTATION_PLAN_SOURCE/);
  assert.match(feedbackInboxSource, /feedbackAnnotationPlanMetadata\(item\)/);
  assert.match(feedbackInboxSource, /<Badge variant="info">annotation-plan<\/Badge>/);
  assert.match(feedbackInboxSource, /inbox audit ready/);
});

test('feedback inbox exposes comment-only history editing without raw evidence payloads', () => {
  const editPathSource = feedbackInboxSource.match(/editingCommentDraft[\s\S]*?FeedbackEvidenceReview/)?.[0] ?? feedbackInboxSource;

  assert.match(feedbackInboxSource, /onCommentEdit/);
  assert.match(feedbackInboxSource, /aria-label=\{`编辑反馈 \$\{item\.id\}`\}/);
  assert.match(feedbackInboxSource, /textarea[\s\S]*value=\{editingCommentDraft\}/);
  assert.match(feedbackInboxSource, /onCommentEdit\(item\.id, editingCommentDraft\)/);
  assert.match(sciForgeAppFeedbackActionsSource, /updateFeedbackCommentText\(current, id, comment, nowIso\(\)\)/);
  assert.match(sciForgeAppSource, /onCommentEdit=\{feedbackActions\.updateFeedbackCommentText\}/);
  assert.doesNotMatch(editPathSource, /rawDataUrl|annotatedDataUrl|windowCandidates|providerPayload/);
});

test('feedback inbox defaults repair to system Terminal with optional Web Viewer', () => {
  assert.match(feedbackInboxSource, /import \{ FeedbackCodexTerminalPanel \} from '..\/..\/feedback\/FeedbackCodexTerminalPanel'/);
  assert.match(feedbackInboxSource, /<FeedbackCodexTerminalPanel/);
  assert.match(feedbackInboxSource, /providerReady=\{repairReadiness\.providerReady === true\}/);
  assert.match(feedbackInboxSource, /providerBlocker=\{repairReadiness\.providerBlocker\}/);
  assert.match(feedbackInboxSource, /gitMode=\{gitOperationMode\}/);
  assert.doesNotMatch(feedbackInboxSource, /repairReadiness\.providerReady !== true/);
  assert.match(feedbackInboxSource, /onRepairRunWritten=\{onRepairRunWritten\}/);
  assert.doesNotMatch(feedbackInboxSource, /高级 repair 交接与 audit/);
  assert.match(feedbackInboxSource, /feedbackShouldShowRepairAudit/);
  assert.match(feedbackInboxSource, /修复审计 · \{audit\.label\}/);
  assert.match(directCodexTerminalSource, /startFeedbackCodexPtyTerminal/);
  assert.match(directCodexTerminalSource, /startRuntimeServices/);
  assert.match(directCodexTerminalSource, /isWorkspaceConnectionError/);
  assert.match(directCodexTerminalSource, /stopFeedbackCodexPtyTerminal/);
  assert.match(directCodexTerminalSource, /feedbackCodexPtyWebSocketUrl/);
  assert.match(directCodexTerminalSource, /renderTerminalSessionViewer/);
  assert.match(directCodexTerminalSource, /componentId: 'terminal-session-viewer'/);
  assert.match(directCodexTerminalSource, /liveSurfaceRef: xtermHostRef/);
  assert.match(directCodexTerminalSource, /terminalViewerStatus/);
  assert.match(directCodexTerminalSource, /@xterm\/xterm/);
  assert.match(directCodexTerminalSource, /打开系统 Terminal/);
  assert.match(directCodexTerminalSource, /启动 Web Viewer/);
  assert.match(directCodexTerminalSource, /launchSurface/);
  assert.match(directCodexTerminalSource, /system-terminal/);
  assert.doesNotMatch(directCodexTerminalSource, /startFeedbackCodexTerminal/);
  assert.doesNotMatch(directCodexTerminalSource, /sendFeedbackCodexTerminalInput/);
  assert.doesNotMatch(directCodexTerminalSource, /loadFeedbackCodexTerminalTail/);
  assert.doesNotMatch(directCodexTerminalSource, /stopFeedbackCodexTerminal/);
  assert.doesNotMatch(directCodexTerminalSource, /HTTP writer|启动并发送/);
  assert.match(directCodexTerminalSource, /系统 Terminal 是推荐控制面/);
  assert.match(directCodexTerminalSource, /Web Viewer 只是 attach/);
  assert.match(directCodexTerminalSource, /provider 状态只展示，不改变 repair 目标路由/);
  assert.match(workspaceServerFeedbackCodexTerminalSource, /SCIFORGE_RUNTIME_API_KEY=<from config\.local\.json>/);
  assert.match(workspaceServerFeedbackCodexTerminalSource, /systemTerminalRuntimeKeyReaderScript/);
  assert.match(workspaceServerFeedbackCodexTerminalSource, /systemTerminalCodexShellCommand/);
  assert.match(workspaceServerSource, /startFeedbackCodexPtyTerminal/);
  assert.equal((directCodexTerminalSource.match(/startPtyTerminal\('system-terminal'\)/g) ?? []).length >= 2, true);
  assert.equal((directCodexTerminalSource.match(/startPtyTerminal\('web-viewer'\)/g) ?? []).length, 1);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal\s*\{/);
  assert.match(feedbackInboxCss, /@import '@xterm\/xterm\/css\/xterm\.css';/);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal \.terminal-session-viewer\s*\{/);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal \.terminal-session-viewer-screen\s*\{/);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal \.terminal-session-viewer-live-surface\s*\{/);
  assert.doesNotMatch(directCodexTerminalSource, /feedback-codex-xterm-shell/);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal-preflight\s*\{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(feedbackInboxCss, /\.feedback-codex-terminal-input\s*\{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto auto;/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-codex-terminal-input\s*\{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);/);
});

test('RT-06 repair handoff carries structured evidence and audit refs without user restatement', () => {
  assert.match(feedbackInboxSource, /loadFeedbackIssueHandoffBundle\(config, item\.id\)/);
  assert.match(feedbackInboxSource, /handoffBundle: bundle/);
  assert.match(feedbackInboxSource, /evidenceRefs: feedbackEvidenceRefList\(item\)/);
  assert.match(feedbackInboxSource, /item\.evidenceBundleRef/);
  assert.match(feedbackInboxSource, /item\.screenshotRef/);
  assert.match(feedbackInboxSource, /item\.rawScreenshotRef/);
  assert.match(feedbackInboxSource, /item\.annotatedScreenshotRef/);
  assert.match(feedbackInboxSource, /item\.screenshot\?\.rawScreenshotRef/);
  assert.match(feedbackInboxSource, /item\.screenshot\?\.annotatedScreenshotRef/);
  assert.match(feedbackInboxSource, /terminalMirrorRef/);
  assert.match(feedbackInboxSource, /planRef/);
  assert.match(feedbackInboxSource, /DEFAULT_FEEDBACK_REPAIR_TESTS/);
  assert.match(feedbackInboxSource, /providerReadinessNotice:\s*\{[\s\S]*?displayOnly: true,[\s\S]*?\}/);
  assert.match(feedbackInboxSource, /GitHub sync trace/);
  assert.doesNotMatch(feedbackInboxSource, /用户不需要重复描述/);
});

test('RT-06 treats terminal transcript as an evidence ref, not a completion verdict or GitHub body source', () => {
  assert.match(feedbackRepairAuditPanelSource, /terminalMirrorRef/);
  assert.match(feedbackRepairAuditPanelSource, /copyText = entries\.map/);
  assert.match(feedbackRepairAuditPanelSource, /写入 GitHub 或 audit summary 前仍需 bounded scrub/);
  assert.match(feedbackRepairAuditPanelSource, /repairEvidenceCompleteness/);
  assert.match(feedbackRepairAuditPanelSource, /label: 'log'/);
  assert.match(feedbackRepairAuditPanelSource, /label: 'tests'/);
  assert.match(feedbackRepairAuditPanelSource, /label: 'guard-digests'/);
  assert.match(feedbackInboxSource, /Runtime Codex repair finished: \$\{result\.verdict\}/);
  assert.doesNotMatch(feedbackInboxSource, /terminalMirror(?:Ref)?[\s\S]{0,160}verdict|verdict[\s\S]{0,160}terminalMirror(?:Ref)?/);
  assert.match(githubFeedbackSource, /Sync rule: GitHub metadata may be updated, but local annotations, screenshot refs, evidence bundles, and repair audit records remain the product source of truth/);
  assert.doesNotMatch(githubFeedbackSource, /terminalMirror|terminal buffer|Codex CLI terminal|PTY/);
});

test('RT-06 repair result closure asks only solved or remaining problem feedback', () => {
  assert.match(feedbackInboxSource, /const \[remainingProblemById, setRemainingProblemById\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(feedbackInboxSource, /const \[pendingRepairClosure, setPendingRepairClosure\]/);
  assert.match(feedbackInboxSource, /function requestFeedbackCompletionClosure\(/);
  assert.match(feedbackInboxSource, /function recordRepairResolutionFeedback\(/);
  assert.match(feedbackInboxSource, /buildFeedbackRepairClosureReport/);
  assert.match(feedbackInboxSource, /syncFeedbackRepairClosure/);
  assert.match(feedbackInboxSource, /repairResolutionVerificationForResult/);
  assert.match(feedbackInboxSource, /aria-label="repair result user closure"/);
  assert.match(feedbackInboxSource, /只需要确认这个问题是否已解决；仍有问题时再补充剩余现象。/);
  assert.match(feedbackInboxSource, /问题已解决/);
  assert.match(feedbackInboxSource, /仍有问题/);
  assert.match(feedbackInboxSource, /placeholder="如果仍未解决，写下现在还存在的问题\.\.\."/);
  assert.match(feedbackInboxSource, /aria-label="记录修复后仍然存在的问题"/);
  assert.match(feedbackInboxSource, /请先写下仍然存在的问题，再记录为未解决。/);
  assert.match(feedbackInboxSource, /remaining-problem feedback is the next repair input/);
  assert.match(feedbackInboxSource, /action: 'browser-recheck'/);
  assert.match(feedbackInboxSource, /status: 'failed'/);
  assert.match(feedbackInboxSource, /status: evidenceRefs\.length && browserManifestSupportsPassedRecheck\(browserManifest\) \? 'passed' : 'pending'/);
  assert.match(feedbackInboxSource, /aria-label="确认修复闭环"/);
  assert.match(feedbackInboxSource, /确认完成并关闭 Issue/);
  assert.match(feedbackInboxSource, /audit\.latestResult/);
  assert.match(feedbackInboxSource, /同步并关闭 Issue/);
  assert.match(feedbackInboxSource, /只标记本地 fixed/);
  assert.match(githubFeedbackSource, /export function buildFeedbackRepairClosureReport/);
  assert.match(githubFeedbackSource, /export async function syncFeedbackRepairClosure/);
  assert.match(githubFeedbackSource, /export function markFeedbackGithubIssueClosed/);
});

test('PROJECT.md records the current Browser and Computer Use task board with GUI-host boundaries', () => {
  assert.match(projectSource, /当前任务板：默认 Browser Search \/ Computer Use/);
  assert.match(projectSource, /docs\/superpowers\/specs\/2026-06-05-default-browser-computer-use-design\.md/);
  assert.match(projectSource, /默认 Browser search 或 Computer Use preflight/);
  assert.match(projectSource, /默认档位是 `High Autonomy`/);
  assert.match(projectSource, /hard-confirm UI 必须展示 action、target、impact、evidence refs、authorization profile、Confirm \/ Cancel/);
  assert.match(projectSource, /GUI 只展示状态、收集授权/);
  assert.doesNotMatch(projectSource, /当前任务板：Model Router MVP/);
  assert.match(sciForgeAppSource, /runAnnotationPlanOnlyTurn/);
  assert.match(sciForgeAppSource, /runAnnotationQuickAction/);
  assert.match(sciForgeAppSource, /runPromptOrchestrator/);
  assert.match(sciForgeAppSource, /turnMode: 'annotation-plan-only'/);
  assert.match(sciForgeAppSource, /turnMode: 'annotation-quick-action'/);
  assert.match(sciForgeAppSource, /conversationEnvelope: buildAnnotationPlanOnlyEnvelope/);
  assert.match(sciForgeAppSource, /conversationEnvelope: buildAnnotationQuickActionEnvelope/);
});

test('feedback inbox keeps visible selection scope hints and GitHub sync trace visible', () => {
  assert.match(feedbackInboxSource, /selectedVisibleActiveComments\.length \? selectedVisibleActiveComments : visibleComments\.filter/);
  assert.match(feedbackInboxSource, /当前列表已选 \$\{visibleSelectedCount\} 条；另有 \$\{hiddenSelectedCount\} 条隐藏选择不参与当前操作/);
  assert.match(feedbackInboxToolbarSource, /选择当前筛选和搜索结果中的所有反馈；隐藏选择不会参与当前操作。/);
  assert.match(feedbackInboxToolbarSource, /只把当前可见且已选的未删除反馈标记为下拉框中的共享状态；隐藏选择不会被修改。/);
  assert.match(feedbackInboxToolbarSource, /导出当前可见已选反馈；如果当前列表没有可见选择，则导出当前筛选和搜索结果。/);
  assert.match(feedbackInboxSource, /aria-label="GitHub sync trace"/);
  assert.match(feedbackInboxSource, /local <code>\{item\.id\}<\/code>/);
  assert.match(feedbackInboxSource, /sync <strong>\{githubTrace\.syncStatus\}<\/strong>/);
  assert.match(feedbackInboxSource, /issue <strong>\{githubTrace\.issueLabel\}<\/strong>/);
  assert.match(feedbackInboxSource, /state <strong>\{githubTrace\.state\}<\/strong>/);
  assert.match(feedbackInboxSource, /evidence <code>\{githubTrace\.publicEvidenceRef\}<\/code>/);
});

test('feedback inbox keeps hero stats concise without diagnostics panel', () => {
  assert.doesNotMatch(feedbackInboxSource, /<FeedbackInboxDiagnostics/);
  assert.doesNotMatch(feedbackInboxSource, /feedback-repair-readiness/);
  assert.match(feedbackInboxSource, /className="feedback-stats"/);
  assert.match(feedbackInboxSource, /<strong>\{activeComments\.length\}<\/strong> active/);
  assert.match(feedbackInboxSource, /item\.status === 'open'/);
  assert.match(feedbackInboxSource, /<strong>\{githubSyncedOpenIssues\.length\}<\/strong> GitHub open/);
  assert.match(feedbackInboxSource, /<strong>\{statusCounts\.blocked \?\? 0\}<\/strong> blocked/);
  assert.doesNotMatch(feedbackInboxSource, /statusCounts\.comment/);
  assert.doesNotMatch(feedbackInboxSource, /statusCounts\.request/);
  assert.doesNotMatch(feedbackInboxSource, /\{requests\.length\}/);
  assert.doesNotMatch(feedbackInboxSource, /statusCounts\.deleted/);
});

test('feedback screenshot preview explains missing images instead of disappearing', () => {
  assert.match(feedbackInboxSource, /<FeedbackEvidenceReview item=\{item\} config=\{config\} \/>/);
  assert.match(feedbackEvidenceReviewSource, /function FeedbackEvidenceReview/);
  assert.match(feedbackEvidenceReviewSource, /aria-label="截图证据、用户评论和期望实际"/);
  assert.match(feedbackInboxCss, /\.feedback-evidence-review\s*\{[\s\S]*?grid-template-columns: minmax\(280px, 0\.95fr\) minmax\(260px, 1\.05fr\);/);
  assert.match(feedbackScreenshotPreviewSource, /className=\{cx\('feedback-screenshot-empty', evidenceStatus\)\} role="status"/);
  assert.match(feedbackScreenshotPreviewSource, /截图预览缺失/);
  assert.match(feedbackScreenshotPreviewSource, /function missingScreenshotFallback/);
  assert.match(feedbackScreenshotPreviewSource, /仅找到 evidence ref/);
  assert.match(feedbackScreenshotPreviewSource, /重新评论该元素可补采截图/);
  assert.match(feedbackInboxCss, /\.feedback-screenshot-empty\.missing\s*\{[\s\S]*?border-color: rgba\(255, 117, 117, 0\.36\);/);
});

test('feedback inbox confirms destructive local queue actions inside the inbox', () => {
  const softDeleteRequest = feedbackInboxSource.match(/function requestSoftDeleteSelected\(ids: string\[\]\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  const softDeleteConfirm = feedbackInboxSource.match(/function confirmPendingQueueAction\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(feedbackInboxSource, /type PendingQueueActionKind = 'soft-delete'/);
  assert.match(feedbackInboxSource, /const \[pendingQueueAction, setPendingQueueAction\]/);
  assert.match(feedbackInboxSource, /function requestSoftDeleteSelected\(ids: string\[\]\)/);
  assert.doesNotMatch(softDeleteRequest, /window\.confirm/);
  assert.doesNotMatch(softDeleteConfirm, /window\.confirm/);
  assert.match(feedbackInboxSource, /<FeedbackActionConfirmation/);
  assert.match(feedbackInboxSource, /ariaLabel="确认本地队列操作"/);
  assert.match(feedbackActionConfirmationSource, /role="alertdialog" aria-label=\{ariaLabel\}/);
  assert.match(feedbackInboxSource, /确认软删除本地反馈/);
  assert.match(feedbackInboxSource, /不会删除 GitHub Issue、repair audit、workspace patch、repair log evidence 或截图原始证据/);
  assert.match(feedbackInboxSource, /已取消本地队列操作/);
  assert.match(feedbackInboxSource, /onSoftDeleteSelected=\{\(\) => requestSoftDeleteSelected\(selectedVisibleActiveComments\.map/);
  assert.match(feedbackInboxCss, /\.feedback-queue-confirmation\s*\{/);
  assert.match(feedbackInboxCss, /\.feedback-queue-confirmation-grid,[\s\S]*?\.feedback-github-confirmation-grid\s*\{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-queue-confirmation-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test('feedback inbox requires confirmation before GitHub external actions', () => {
  assert.match(feedbackInboxSource, /type PendingGithubActionKind = 'submit-issue' \| 'sync-open-issues'/);
  assert.doesNotMatch(feedbackInboxSource, /requestGithubAction\('upload-evidence'\)/);
  assert.doesNotMatch(feedbackInboxSource, /上传 Evidence/);
  assert.match(feedbackInboxSource, /const \[pendingGithubAction, setPendingGithubAction\]/);
  assert.match(feedbackInboxSource, /function requestGithubAction\(kind: PendingGithubActionKind\)/);
  assert.match(feedbackInboxSource, /ariaLabel="确认 GitHub 外部操作"/);
  assert.match(feedbackActionConfirmationSource, /role="alertdialog" aria-label=\{ariaLabel\}/);
  assert.match(feedbackInboxSource, /confirmDisabled=\{githubSubmitBusy \|\| githubSyncBusy \|\| evidenceUploadBusy\}/);
  assert.match(feedbackInboxSource, /确认创建 GitHub Issue/);
  assert.match(feedbackInboxSource, /会把结构化 issue body 和公开 evidence refs 发送到 GitHub/);
  assert.match(feedbackInboxSource, /await uploadEvidenceForComments\(targetComments, 'github-submit'\)/);
  assert.match(feedbackInboxSource, /onRequestGithubAction=\{requestGithubAction\}/);
  assert.match(feedbackInboxToolbarSource, /onClick=\{\(\) => onRequestGithubAction\('submit-issue'\)\}/);
  assert.match(feedbackInboxToolbarSource, /onClick=\{\(\) => onRequestGithubAction\('sync-open-issues'\)\}/);
  assert.match(feedbackInboxSource, /已取消 GitHub 外部操作/);
  assert.match(feedbackInboxSource, /function githubActionCancelImpact/);
  assert.match(feedbackInboxSource, /没有向 GitHub 发起读取请求，也没有发送 token 或改动本地同步缓存/);
  assert.match(feedbackInboxCss, /\.feedback-github-confirmation\s*\{/);
  assert.match(feedbackInboxCss, /\.feedback-github-confirmation-grid\s*\{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-github-confirmation-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test('feedback inbox keeps narrow layout safeguards for queue and terminal controls', () => {
  assert.match(feedbackInboxCss, /\.feedback-toolbar\s*\{[\s\S]*?flex-wrap: wrap;/);
  assert.match(feedbackInboxCss, /\.feedback-toolbar select,[\s\S]*?\.feedback-toolbar-token-note\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(feedbackInboxCss, /\.feedback-toolbar button\s*\{[\s\S]*?max-width: 100%;[\s\S]*?white-space: normal;/);
  assert.match(feedbackInboxCss, /\.delayed-help-popover\s*\{[\s\S]*?display: none;[\s\S]*?max-width: calc\(100vw - 24px\);[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(feedbackInboxCss, /\.delayed-help-control:hover:not\(\.is-disabled\) \.delayed-help-popover,[\s\S]*?\.delayed-help-control:focus-within:not\(\.is-disabled\) \.delayed-help-popover\s*\{[\s\S]*?opacity: 1;/);
  assert.match(feedbackInboxCss, /\.feedback-toolbar input\[type='search'\]\s*\{[\s\S]*?flex: 1 1 220px;[\s\S]*?min-width: min\(220px, 100%\);/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-toolbar select,[\s\S]*?\.feedback-toolbar input\[type='search'\],[\s\S]*?\.feedback-selection-count,[\s\S]*?\.feedback-toolbar-token-note,[\s\S]*?\.feedback-queue-hint,[\s\S]*?\.feedback-github-hint\s*\{[\s\S]*?flex-basis: 100%;/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-toolbar \.delayed-help-control\s*\{[\s\S]*?flex: 1 1 128px;/);
  assert.match(feedbackInboxCss, /\.feedback-card-section > summary\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(feedbackInboxCss, /\.feedback-repair-audit > \*,[\s\S]*?\.feedback-repair-thread-strip > \*\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(feedbackInboxCss, /\.feedback-repair-audit-title > \*,[\s\S]*?\.feedback-repair-thread-item > div > \*\s*\{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(feedbackInboxCss, /\.feedback-repair-terminal-head\s*\{[\s\S]*?flex-wrap: wrap;/);
  assert.match(feedbackInboxCss, /\.feedback-repair-terminal-actions,[\s\S]*?\.feedback-repair-boundary-grid\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(feedbackInboxCss, /\.feedback-repair-terminal-line\s*\{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(feedbackInboxCss, /\.feedback-repair-guidance-boundary\s*\{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-repair-guidance-boundary\s*\{[\s\S]*?grid-column: 2;/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-repair-terminal-line\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(feedbackInboxCss, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.feedback-repair-safe-mode\s*\{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);/);
});

function readyProviderPreflight(): RuntimeProviderPreflightManifest {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:00:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'env',
    upstreamBaseUrlSourceKind: 'env',
    category: 'ready',
    owner: 'environment',
    policyViolations: [],
    missingEnv: [],
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: [],
  };
}

function blockedProviderPreflight(): RuntimeProviderPreflightManifest {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:00:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: false,
    upstreamKeySourceKind: 'config-debug-fallback',
    upstreamBaseUrlSourceKind: 'missing',
    category: 'config-secret-source',
    owner: 'environment',
    policyViolations: ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance'],
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: [],
  };
}

function passedBrowserAcceptance(overrides: Partial<RuntimeCodexBrowserAcceptanceManifest> = {}): RuntimeCodexBrowserAcceptanceManifest {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: new Date().toISOString(),
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: true,
    currentRunEvidenceScope: 'live-browser-current-run',
    releaseBlocking: false,
    releaseEligible: true,
    ...overrides,
  };
}

function blockedBrowserAcceptance(): RuntimeCodexBrowserAcceptanceManifest {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt: '2026-05-07T00:00:00.000Z',
    startedFromDefaultChatEntry: false,
    submittedThroughRuntimeCodex: false,
    providerModelProfileVisible: false,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: false,
    currentRunEvidenceScope: 'preflight-only',
    releaseBlocking: true,
    releaseEligible: false,
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
  };
}

function feedbackComment(): FeedbackCommentRecord {
  return {
    schemaVersion: 1,
    id: 'feedback-1',
    authorId: 'tester',
    authorName: 'Tester',
    comment: 'Runtime repair should block before provider dispatch.',
    status: 'github-open',
    priority: 'normal',
    tags: ['feedback'],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    target: {
      selector: '[data-testid="repair"]',
      path: 'body > button',
      text: 'Repair',
      tagName: 'button',
      rect: { x: 1, y: 2, width: 100, height: 30 },
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    runtime: { page: 'feedback', url: 'http://127.0.0.1:5173/', scenarioId: 'default', sessionId: 'session-1' },
    evidenceBundleRef: '.sciforge/feedback/feedback-1',
    rawScreenshotRef: '.sciforge/feedback/feedback-1/raw-screenshot.data-url',
    annotatedScreenshotRef: '.sciforge/feedback/feedback-1/annotated-screenshot.data-url',
    screenshotRef: '.sciforge/feedback/feedback-1/comment.json',
  };
}
