import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackRepairResolutionComposer } from './FeedbackRepairResolutionComposer';

test('feedback repair resolution composer renders browser verification and remaining problem context', () => {
  const html = renderToStaticMarkup(
    <FeedbackRepairResolutionComposer
      browserVerificationLabel="browser passed"
      remainingProblem="Button still overlaps the toolbar."
      onSolved={() => undefined}
      onRemaining={() => undefined}
      onRemainingProblemChange={() => undefined}
    />,
  );

  assert.match(html, /确认修复结果/);
  assert.match(html, /browser passed/);
  assert.match(html, /问题已解决/);
  assert.match(html, /仍有问题/);
  assert.match(html, /Button still overlaps the toolbar/);
  assert.match(html, /aria-label="记录修复后仍然存在的问题"/);
  assert.doesNotMatch(html, /<button type="button" disabled="">仍有问题<\/button>/);
});

test('feedback repair resolution composer keeps unresolved action disabled until text is present', () => {
  const html = renderToStaticMarkup(
    <FeedbackRepairResolutionComposer
      remainingProblem="   "
      onSolved={() => undefined}
      onRemaining={() => undefined}
      onRemainingProblemChange={() => undefined}
    />,
  );

  assert.match(html, /<button type="button" disabled="">仍有问题<\/button>/);
});

test('feedback repair resolution composer disables review controls while repair is busy', () => {
  const html = renderToStaticMarkup(
    <FeedbackRepairResolutionComposer
      busy
      remainingProblem="Still broken."
      onSolved={() => undefined}
      onRemaining={() => undefined}
      onRemainingProblemChange={() => undefined}
    />,
  );

  assert.match(html, /<button type="button" disabled="">问题已解决<\/button>/);
  assert.match(html, /<button type="button" disabled="">仍有问题<\/button>/);
  assert.match(html, /<textarea[^>]*disabled="">Still broken\.<\/textarea>/);
});
