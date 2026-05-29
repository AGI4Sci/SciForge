import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackActionConfirmation } from './FeedbackActionConfirmation';

test('feedback action confirmation renders shared alertdialog structure and rows', () => {
  const html = renderToStaticMarkup(
    <FeedbackActionConfirmation
      actionsClassName="feedback-queue-confirmation-actions"
      ariaLabel="确认本地队列操作"
      className="feedback-queue-confirmation"
      confirmLabel="确认软删除本地反馈"
      gridClassName="feedback-queue-confirmation-grid"
      impact="不会删除 GitHub Issue、repair audit、workspace patch、repair log evidence 或截图原始证据。"
      rows={[
        { label: 'Scope', value: '当前可见已选 2 条未删除反馈' },
        { label: 'Local effect', value: 'soft delete 2 local feedback item(s)' },
      ]}
      title="确认软删除本地反馈"
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  assert.match(html, /class="feedback-queue-confirmation" role="alertdialog" aria-label="确认本地队列操作"/);
  assert.match(html, /<strong>确认软删除本地反馈<\/strong>/);
  assert.match(html, /feedback-queue-confirmation-grid/);
  assert.match(html, /<span>Scope<\/span><code>当前可见已选 2 条未删除反馈<\/code>/);
  assert.match(html, /<button type="button">确认软删除本地反馈<\/button>/);
  assert.match(html, /<button type="button">取消<\/button>/);
});

test('feedback action confirmation can disable the primary action while busy', () => {
  const html = renderToStaticMarkup(
    <FeedbackActionConfirmation
      actionsClassName="feedback-github-confirmation-actions"
      ariaLabel="确认 GitHub 外部操作"
      className="feedback-github-confirmation"
      confirmDisabled
      confirmLabel="确认创建 GitHub Issue"
      gridClassName="feedback-github-confirmation-grid"
      impact="会把结构化 issue body 和公开 evidence refs 发送到 GitHub。"
      rows={[
        { label: 'Destination', value: 'owner/repo' },
      ]}
      title="确认创建 GitHub Issue"
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  assert.match(html, /class="feedback-github-confirmation" role="alertdialog" aria-label="确认 GitHub 外部操作"/);
  assert.match(html, /<button type="button" disabled="">确认创建 GitHub Issue<\/button>/);
});
