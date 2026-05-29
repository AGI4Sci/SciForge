import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackInboxToolbar } from './FeedbackInboxToolbar';

test('feedback inbox toolbar preserves selection, search, GitHub, and repair controls', () => {
  const html = renderToolbar();

  assert.match(html, /aria-label="按反馈状态筛选"/);
  assert.match(html, /全部未删除 \(3\)/);
  assert.match(html, /aria-label="搜索反馈、GitHub Issue 或证据 ref"/);
  assert.match(html, /placeholder="搜索反馈、Issue、ref\.\.\."/);
  assert.match(html, /已选择 1 条/);
  assert.match(html, /aria-label="git operation mode"/);
  assert.match(html, /手动操作/);
  assert.match(html, /选择当前列表/);
  assert.match(html, /批量标记/);
  assert.match(html, /恢复选中/);
  assert.match(html, /软删除/);
  assert.match(html, /生成 Request/);
  assert.match(html, /修复选中/);
  assert.match(html, /导出 Bundle/);
  assert.match(html, /提交到 GitHub/);
  assert.match(html, /从 GitHub 同步/);
  assert.match(html, /未配置 Token：点「提交 \/ 同步」将打开设置并提示填写 PAT/);
  assert.match(html, /role="status">queue ready/);
  assert.match(html, /role="status">github ready/);
});

test('feedback inbox toolbar disables unsafe actions without an active visible selection', () => {
  const html = renderToolbar({
    allVisibleSelected: true,
    issueScopeCommentsLength: 0,
    queueActionHint: '',
    selectedDeletedCount: 0,
    selectedRepairCandidateId: undefined,
    selectedVisibleActiveCount: 0,
    selectionSummary: '当前列表 2 条',
  });

  assert.match(html, /<button type="button" disabled="">选择当前列表<\/button>/);
  assert.match(html, /<button type="button" disabled="">.*批量标记<\/button>/s);
  assert.match(html, /<button type="button" class="danger" disabled="">.*软删除<\/button>/s);
  assert.match(html, /<button type="button" disabled="">.*生成 Request<\/button>/s);
  assert.match(html, /<button type="button" disabled="">.*修复选中<\/button>/s);
  assert.match(html, /<button type="button" class="feedback-github-primary" disabled="">提交到 GitHub<\/button>/);
});

test('feedback inbox toolbar shows repair and GitHub busy states without changing copy', () => {
  const html = renderToolbar({
    githubSubmitBusy: true,
    githubSyncBusy: true,
    selectedRepairBusy: true,
  });

  assert.match(html, /<button type="button" disabled="">.*修复选中<\/button>/s);
  assert.match(html, /feedback-inline-spin/);
  assert.match(html, /提交到 GitHub/);
  assert.match(html, /从 GitHub 同步/);
});

function renderToolbar(overrides: Partial<Parameters<typeof FeedbackInboxToolbar>[0]> = {}) {
  return renderToStaticMarkup(
    <FeedbackInboxToolbar
      activeCommentsLength={3}
      allVisibleSelected={false}
      bulkStatus="triaged"
      effectiveGithubRepo="owner/repo"
      feedbackGithubToken=""
      gitOperationMode="manual"
      githubActionHint="github ready"
      githubDryRun={false}
      githubSubmitBusy={false}
      githubSyncBusy={false}
      issueScopeCommentsLength={1}
      queueActionHint="queue ready"
      searchQuery="toolbar"
      selectedDeletedCount={1}
      selectedRepairBusy={false}
      selectedRepairCandidateId="feedback-1"
      selectedVisibleActiveCount={1}
      selectionSummary="已选择 1 条"
      statusCounts={{ comment: 2, request: 1 }}
      statusFilter="all"
      visibleIdsLength={2}
      onBulkStatusChange={() => undefined}
      onCreateRequest={() => undefined}
      onExportBundle={() => undefined}
      onGitOperationModeChange={() => undefined}
      onMarkSelected={() => undefined}
      onRepairSelected={() => undefined}
      onRequestGithubAction={() => undefined}
      onRestoreSelected={() => undefined}
      onSearchQueryChange={() => undefined}
      onSelectCurrentList={() => undefined}
      onSoftDeleteSelected={() => undefined}
      onStatusFilterChange={() => undefined}
      {...overrides}
    />,
  );
}
