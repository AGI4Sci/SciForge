import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinalMessageContent } from './FinalMessageContent';
import { splitFinalMessagePresentation } from './finalMessagePresentation';
import type { ObjectReference } from '../../domain';

test('final message presentation keeps answer body ahead of raw execution evidence', () => {
  const content = [
    '# Findings',
    '',
    'The analysis completed. Open artifact::summary-report for the report.',
    '',
    '## Raw tool output',
    '```json',
    JSON.stringify({
      toolOutput: 'long stdout',
      executionUnits: [{ id: 'eu-1', stdoutRef: 'logs/stdout.log' }],
      artifacts: [{ id: 'summary-report' }],
    }, null, 2),
    '```',
    '',
    '## Execution audit',
    '- stdout: file::.sciforge/runs/run-1/stdout.log',
    '- stderr: file::.sciforge/runs/run-1/stderr.log',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /The analysis completed/);
  assert.match(presentation.primaryContent, /artifact::summary-report/);
  assert.doesNotMatch(presentation.primaryContent, /executionUnits/);
  assert.equal(presentation.auditSections.length, 2);
  assert.deepEqual(presentation.auditSections.map((section) => section.evidenceType), ['raw-json', 'execution-audit']);
});

test('final message audit details render collapsed while object references stay clickable', () => {
  const references: ObjectReference[] = [{
    id: 'artifact-summary-report',
    title: 'summary-report',
    kind: 'artifact',
    ref: 'artifact::summary-report',
    actions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    status: 'available',
  }];
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content={[
        'Result: artifact::summary-report is ready.',
        '',
        '```json',
        '{"raw":true,"toolOutput":"hidden by default","executionUnits":[{"id":"eu"}]}',
        '```',
      ].join('\n')}
      references={references}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /Result:/);
  assert.match(markup, /data-sciforge-reference=/);
  assert.match(markup, /final-message-audit-fold/);
  assert.doesNotMatch(markup, /<details class="message-fold depth-2 final-message-audit-fold" open/);
});

test('plain failure diagnostics are folded out of the primary chat answer', () => {
  const content = [
    'failureReason: AgentServer generation request failed after repeated full-file reads; stderrRef=agentserver://run/stderr; stdoutRef=agentserver://run/stdout.',
    'recoverActions=retry with bounded context and inspect the referenced stderr before sending the next multi-turn follow-up.',
  ].join(' ');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /任务未完成/);
  assert.doesNotMatch(presentation.primaryContent, /stderrRef=/);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'execution-audit');
  assert.match(presentation.auditSections[0].text, /failureReason/);
});

test('timeout work-process transcripts stay collapsed behind a concise failure summary', () => {
  const content = [
    'SciForge project tool 超时：30000ms 内没有完成。流式面板已显示最后一个真实事件。',
    '',
    '工作过程摘要:',
    '- 项目工具: SciForge literature-evidence-review project tool started',
    '- Workspace Runtime: agentserver-generation',
    '- 计划: Plan: implement via codex',
    '- AgentServer 状态: Calling local model bailian/deepseek-v4-flash',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /任务未完成/);
  assert.doesNotMatch(presentation.primaryContent, /Workspace Runtime/);
  assert.equal(presentation.auditSections.length, 2);
  assert.deepEqual(presentation.auditSections.map((section) => section.evidenceType), ['execution-audit', 'execution-audit']);
  assert.match(presentation.auditSections.map((section) => section.text).join('\n'), /Workspace Runtime/);
});
