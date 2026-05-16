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

test('raw payload-only messages promote embedded human answer and fold payload metadata', () => {
  const content = [
    '```json',
    JSON.stringify({
      message: 'Analysis finished. The reusable output is artifact::analysis-report and the source table is file::data/results.csv.',
      confidence: 0.91,
      claimType: 'analysis-result',
      objects: [{ ref: 'artifact::analysis-report' }],
      executionUnits: [{ id: 'unit-1', backend: 'worker' }],
    }, null, 2),
    '```',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /Analysis finished/);
  assert.match(presentation.primaryContent, /artifact::analysis-report/);
  assert.match(presentation.primaryContent, /file::data\/results\.csv/);
  assert.doesNotMatch(presentation.primaryContent, /executionUnits/);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'raw-json');
});

test('generic ToolPayload and Received sections fold without hiding later result headings', () => {
  const content = [
    '# Result',
    'The requested change is complete in diff::main-change.',
    '',
    '## ToolPayload',
    'Received backend response with claimType=code-change confidence=0.86 routeDecision=backend.',
    '```json',
    '{"toolOutput":"verbose execution log","executionUnits":[{"id":"unit-1"}],"stdout":"line 1"}',
    '```',
    '',
    '## Next step',
    'Review artifact::verification-summary when you want the details.',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /# Result/);
  assert.match(presentation.primaryContent, /diff::main-change/);
  assert.match(presentation.primaryContent, /## Next step/);
  assert.match(presentation.primaryContent, /artifact::verification-summary/);
  assert.doesNotMatch(presentation.primaryContent, /claimType=code-change/);
  assert.doesNotMatch(presentation.primaryContent, /executionUnits/);
  assert.equal(presentation.auditSections.length, 2);
});

test('answer paragraphs with inline refs are preserved even when they mention verification', () => {
  const content = [
    'Result: the table is ready at artifact::data-table and verification::table-check explains the row-count check.',
    '',
    '- Key finding: the outlier row is file::data/results.csv#L42 and remains unverified until the source system is re-run.',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /artifact::data-table/);
  assert.match(presentation.primaryContent, /verification::table-check/);
  assert.match(presentation.primaryContent, /file::data\/results\.csv#L42/);
  assert.equal(presentation.auditSections.length, 0);
});

test('structured result presentation drives primary answer and folds diagnostics', () => {
  const presentation = splitFinalMessagePresentation('Received ToolPayload with executionUnits and raw diagnostics.', {
    answerBlocks: [{
      id: 'answer-1',
      kind: 'paragraph',
      text: 'The analysis completed with a reusable report.',
      citationIds: ['citation-report'],
    }],
    keyFindings: [{
      id: 'finding-1',
      statement: 'Treatment B increased the median signal.',
      citationIds: ['citation-table'],
      verificationState: 'supported',
    }],
    inlineCitations: [
      { id: 'citation-report', label: 'Report', kind: 'artifact', ref: 'artifact:analysis-report' },
      { id: 'citation-table', label: 'Table row', kind: 'file', ref: '.sciforge/data/table.csv#row-b' },
    ],
    artifactActions: [{ id: 'artifact-1', label: 'Open report', artifactType: 'research-report', ref: 'artifact:analysis-report' }],
    nextActions: [{ id: 'next-1', label: 'Inspect the cited table row.', kind: 'inspect' }],
    confidenceExplanation: { level: 'high', summary: 'Evidence is attached to the finding.', citationIds: ['citation-table'] },
    processSummary: { foldedByDefault: true, summary: 'Execution details are available for audit.' },
    diagnosticsRefs: [{ id: 'raw-1', label: 'Raw payload', kind: 'raw-payload', ref: '.sciforge/task-results/raw.json' }],
  });

  assert.match(presentation.primaryContent, /The analysis completed/);
  assert.match(presentation.primaryContent, /Treatment B/);
  assert.doesNotMatch(presentation.primaryContent, /artifact::analysis-report/);
  assert.doesNotMatch(presentation.primaryContent, /file::\.sciforge\/data\/table\.csv#row-b/);
  assert.doesNotMatch(presentation.primaryContent, /executionUnits|ToolPayload|raw diagnostics/i);
  assert.equal(presentation.auditSections.length, 2);
  assert.deepEqual(presentation.auditSections.map((section) => section.evidenceType), ['execution-audit', 'raw-json']);
});

test('structured result presentation references remain clickable', () => {
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content="Received ToolPayload with raw process."
      references={[]}
      resultPresentation={{
        answerBlocks: [{ id: 'answer-1', kind: 'paragraph', text: 'Open artifact::analysis-report.', citationIds: ['citation-report'] }],
        keyFindings: [],
        inlineCitations: [{ id: 'citation-report', label: 'Report', kind: 'artifact', ref: 'artifact:analysis-report' }],
        artifactActions: [{ id: 'artifact-1', label: 'Open report', ref: 'artifact:analysis-report' }],
        nextActions: [],
        diagnosticsRefs: [],
      }}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /data-sciforge-reference=/);
  assert.match(markup, /artifact::analysis-report/);
  assert.doesNotMatch(markup, /Received ToolPayload/);
});

test('structured result presentation references are deduped by canonical object identity', () => {
  const references: ObjectReference[] = [{
    id: 'existing-report',
    title: 'Existing report',
    kind: 'artifact',
    ref: 'artifact:analysis-report',
    actions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    status: 'available',
    provenance: { dataRef: 'analysis-report' },
  }];
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content="Open artifact::analysis-report."
      references={references}
      resultPresentation={{
        inlineCitations: [
          { id: 'citation-report', label: 'Report', kind: 'artifact', ref: 'artifact::analysis-report' },
        ],
        artifactActions: [
          { id: 'artifact-action-report', label: 'Open report', ref: 'artifact:analysis-report' },
        ],
      }}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/message-object-link/g) ?? []).length, 1);
});

test('structured citations stay out of markdown text and render as deduped inline object links', () => {
  const presentation = splitFinalMessagePresentation('Received ToolPayload.', {
    answerBlocks: [{
      id: 'answer-1',
      kind: 'paragraph',
      text: '已生成报告。',
      citationIds: ['citation-report', 'citation-report-copy'],
    }],
    keyFindings: [],
    inlineCitations: [
      { id: 'citation-report', label: 'Agentic RL 研究脉络：综述与前沿进展', kind: 'artifact', ref: 'artifact:research-report', status: 'available' },
      { id: 'citation-report-copy', label: 'Agentic RL 研究脉络：综述与前沿进展', kind: 'artifact', ref: 'artifact:research-report', status: 'available' },
    ],
    artifactActions: [],
    nextActions: [],
    diagnosticsRefs: [],
  });

  assert.equal(presentation.primaryContent, '已生成报告。');
  assert.doesNotMatch(presentation.primaryContent, /available/);
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content="Received ToolPayload."
      references={[]}
      resultPresentation={{
        answerBlocks: [{
          id: 'answer-1',
          kind: 'paragraph',
          text: '已生成报告。',
          citationIds: ['citation-report', 'citation-report-copy'],
        }],
        keyFindings: [],
        inlineCitations: [
          { id: 'citation-report', label: 'Agentic RL 研究脉络：综述与前沿进展', kind: 'artifact', ref: 'artifact:research-report', status: 'available' },
          { id: 'citation-report-copy', label: 'Agentic RL 研究脉络：综述与前沿进展', kind: 'artifact', ref: 'artifact:research-report', status: 'available' },
        ],
        artifactActions: [],
        nextActions: [],
        diagnosticsRefs: [],
      }}
      onObjectFocus={() => undefined}
    />,
  );
  assert.equal((markup.match(/message-object-link/g) ?? []).length, 1);
  assert.match(markup, /Agentic RL 研究脉络：综述与前沿进展/);
  assert.doesNotMatch(markup, />available</);
});

test('raw HTTP diagnostic payload-only messages stay folded behind a concise summary', () => {
  const content = JSON.stringify({
    status: 'failed',
    finalText: 'HTTP 401 Unauthorized: Invalid token for https://api.example.invalid/v1/chat stdoutRef=.sciforge/logs/stdout.log stderrRef=.sciforge/logs/stderr.log',
    runtimeEventsRef: '.sciforge/sessions/session-a/runtime-events.json',
  }, null, 2);

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /任务未完成|任务已返回/);
  assert.doesNotMatch(presentation.primaryContent, /Invalid token|https?:\/\/|stdoutRef|stderrRef|runtimeEventsRef/);
  assert.equal(presentation.auditSections.length, 1);
  assert.ok(['raw-json', 'execution-audit'].includes(presentation.auditSections[0]?.evidenceType ?? ''));
});
