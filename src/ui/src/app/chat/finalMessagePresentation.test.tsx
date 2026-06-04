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
  assert.match(markup, /final-answer-prose/);
  assert.match(markup, /data-sciforge-reference=/);
  assert.match(markup, /final-message-audit-fold/);
  assert.match(markup, /More activity/);
  assert.doesNotMatch(markup, /过程与诊断|execution-audit|raw-json|log-output|tool-output|diagnostic|Supporting detail|Detail/);
  assert.doesNotMatch(markup, /<details class="message-fold depth-2 final-message-audit-fold" open/);
});

test('plain failure diagnostics are folded out of the primary chat answer', () => {
  const content = [
    'failureReason: AgentServer generation request failed after repeated full-file reads; stderrRef=agentserver://run/stderr; stdoutRef=agentserver://run/stdout.',
    'recoverActions=retry with bounded context and inspect the referenced stderr before sending the next multi-turn follow-up.',
  ].join(' ');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /The task did not finish/);
  assert.match(presentation.primaryContent, /Next step: retry with bounded context/i);
  assert.match(presentation.primaryContent, /folded diagnostics/i);
  assert.doesNotMatch(presentation.primaryContent, /stderrRef=/);
  assert.doesNotMatch(presentation.primaryContent, /AgentServer|agentserver:\/\/|stdout|stderr/i);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'execution-audit');
  assert.match(presentation.auditSections[0].text, /failureReason/);
});

test('raw failure payloads expose a sanitized recovery step without provider diagnostics', () => {
  const content = [
    '```json',
    JSON.stringify({
      status: 'failed',
      finalText: 'HTTP 401 Unauthorized from https://provider.example.invalid/v1/chat using token sk-secret-123 stdoutRef=.sciforge/logs/stdout.log',
      recoverActions: [
        'Rotate the workspace credential and retry from the preserved request.',
        'Inspect stderrRef=.sciforge/logs/stderr.log before resending.',
      ],
      runtimeEventsRef: '.sciforge/sessions/session-a/runtime-events.json',
    }, null, 2),
    '```',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /The task did not finish/);
  assert.match(presentation.primaryContent, /Next step: Rotate the workspace credential and retry from the preserved request/i);
  assert.doesNotMatch(presentation.primaryContent, /401|provider\.example|https?:\/\/|sk-secret|stdoutRef|stderrRef|runtimeEventsRef|\.sciforge/i);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'raw-json');
});

test('python tracebacks from failed research runs collapse behind a concise failure summary', () => {
  const content = [
    '0 0 Traceback (most recent call last):',
    '  File "/opt/homebrew/Caskroom/miniconda/base/lib/python3.13/site-packages/urllib3/connectionpool.py", line 787, in urlopen',
    '    response = self._make_request(conn)',
    'http.client.RemoteDisconnected: Remote end closed connection without response',
    '',
    'The above exception was the direct cause of the following exception:',
    '',
    'urllib3.exceptions.MaxRetryError: HTTPSConnectionPool(host="export.arxiv.org", port=443): Max retries exceeded with url: /api/query (Caused by ProxyError("Unable to connect to proxy"))',
    '',
    'During handling of the above exception, another exception occurred:',
    '',
    'Traceback (most recent call last):',
    '  File "<string>", line 1, in <module>',
    'requests.exceptions.ProxyError: HTTPSConnectionPool(host="export.arxiv.org", port=443): Max retries exceeded',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /The task did not finish/);
  assert.doesNotMatch(presentation.primaryContent, /Traceback|urllib3|\/opt\/homebrew|export\.arxiv\.org/i);
  assert.ok(presentation.auditSections.length >= 3);
  assert.equal(new Set(presentation.auditSections.map((section) => section.evidenceType)).has('execution-audit'), true);
  assert.match(presentation.auditSections.map((section) => section.text).join('\n'), /requests\.exceptions\.ProxyError/);
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

  assert.match(presentation.primaryContent, /The task did not finish/);
  assert.doesNotMatch(presentation.primaryContent, /Workspace Runtime/);
  assert.equal(presentation.auditSections.length, 2);
  assert.deepEqual(presentation.auditSections.map((section) => section.evidenceType), ['execution-audit', 'execution-audit']);
  assert.match(presentation.auditSections.map((section) => section.text).join('\n'), /Workspace Runtime/);
});

test('local path-only context listings stay folded out of the primary answer', () => {
  const content = [
    '/Applications/workspace/ailab/research/app/SciForge/repair-evidence/README.md',
    '/Applications/workspace/ailab/research/app/SciForge/node_modules/pkce-challenge/README.md',
    '/Applications/workspace/ailab/research/app/SciForge/node_modules/pkce-challenge/package.json',
    '/Users/alice/private/SciForge/.sciforge/raw/runtime.json',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /project context/i);
  assert.doesNotMatch(presentation.primaryContent, /\/Applications|\/Users|node_modules|\.sciforge/);
  assert.equal(presentation.auditSections.length, 1);
});

test('final message presentation repairs CJK soft wraps in primary prose', () => {
  const presentation = splitFinalMessagePresentation([
    '**',
    '简洁直',
    '给，',
    '少说',
    '废话**',
    '回复',
    '直奔',
    '主题。',
  ].join('\n'));

  assert.equal(presentation.primaryContent, '**简洁直给，少说废话** 回复直奔主题。');
  assert.equal(presentation.auditSections.length, 0);
});

test('final message presentation removes redacted path planning leaks and repairs split technical identifiers', () => {
  const presentation = splitFinalMessagePresentation([
    '[local path] [local path] [local path] Now let me also check the architecture docs.好的。回答如下：',
    '',
    '**两句结论**',
    '',
    'Sci Forge 要更像 C ursor Agent，Run ExecutionProcess 的 recorded 过程和 normal ization 输出要稳定。',
    '点击 appro val 行时，右侧画布只展示 refs-first 详情。',
  ].join('\n'));

  assert.doesNotMatch(presentation.primaryContent, /\[local path\]|Now let me/i);
  assert.match(presentation.primaryContent, /SciForge/);
  assert.match(presentation.primaryContent, /Cursor Agent/);
  assert.match(presentation.primaryContent, /RunExecutionProcess/);
  assert.match(presentation.primaryContent, /recorded/);
  assert.match(presentation.primaryContent, /normalization/);
  assert.match(presentation.primaryContent, /approval/);
  assert.equal(presentation.auditSections.length, 0);
});

test('final message presentation repairs spaced markdown emphasis from streamed answers', () => {
  const presentation = splitFinalMessagePresentation([
    '** 两句结论**',
    '',
    'Sci Forge 要像 Cursor Agent 一样，把回复写成连续页面，而不是网页块。',
    '** 展开态** 只展示真实过程行。',
  ].join('\n'));

  assert.match(presentation.primaryContent, /\*\*两句结论\*\*/);
  assert.match(presentation.primaryContent, /\*\*展开态\*\*/);
  assert.doesNotMatch(presentation.primaryContent, /\*\*\s+两句结论|\*\*\s+展开态/);

  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content={presentation.primaryContent}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );
  assert.match(markup, /<strong>两句结论<\/strong>/);
  assert.match(markup, /<strong>展开态<\/strong>/);
  assert.doesNotMatch(markup, /\*\* 两句结论|\*\* 展开态/);
});

test('final message presentation drops leading scratchpad and repairs inline headings', () => {
  const presentation = splitFinalMessagePresentation([
    '让我先看看当前工作目录的内容，了解项目背景。Let me look at the project architecture more deeply. Let me trace the full capability query flow.',
    '好问题。我通读了 SciForge 的源码，梳理清楚了 GUI 查询能力和 TUI 之间的关系。###结论不需要。GUI 的能力查询不应该问 TUI，它们走的是两条路径： ###1️⃣能力查询路径 GUI 发起查询。',
    '',
    '###2️⃣ TUI 的职责 T UI 只在修复/执行类任务中被调用。',
    '',
    '###3️⃣核心架构图```GUI -> AgentServer``` **所以你的直觉是对的**。',
    '',
    '###流程',
    '- GUI 发送 terminal-equivalent text。',
    '- TUI 通过 module.query/read 查询能力目录。',
  ].join('\n'));

  assert.doesNotMatch(presentation.primaryContent, /Let me|让我先看看|trace the full capability/i);
  assert.match(presentation.primaryContent, /^好问题/);
  assert.match(presentation.primaryContent, /\n\n### 结论/);
  assert.match(presentation.primaryContent, /\n\n不需要。GUI 的能力查询/);
  assert.match(presentation.primaryContent, /\n\n### 1️⃣能力查询路径/);
  assert.match(presentation.primaryContent, /\n\nGUI 发起查询。/);
  assert.match(presentation.primaryContent, /\n\n### 2️⃣ TUI 的职责/);
  assert.match(presentation.primaryContent, /\n\nTUI 只在修复/);
  assert.match(presentation.primaryContent, /\n\n### 3️⃣核心架构图/);
  assert.match(presentation.primaryContent, /\n\n```\nGUI -> AgentServer\n```/);
  assert.match(presentation.primaryContent, /\n\n\*\*所以你的直觉是对的\*\*。/);
  assert.match(presentation.primaryContent, /\n\n### 流程/);
});

test('final message presentation removes project-inspection scratchpad and opens dense section breaks', () => {
  const presentation = splitFinalMessagePresentation([
    'Let me explore the project to understand what SciForge is. **SciForge** 是一个为科学研究打造的自治化多模态 Agent 工作台。## 核心理念-**Agent 不只回答问题**，它能看见科学对象、操作软件并生成可审计的产物。## 独特性 1. 前端是 GUI，2. 后端是 Codex app-server，3. 证据对象包括论文卡片、分子序列和知识图谱。典型用途-文献综述、复现实验和交互式分析。',
  ].join('\n'));

  assert.doesNotMatch(presentation.primaryContent, /Let me explore/i);
  assert.match(presentation.primaryContent, /^\*\*SciForge\*\* 是一个/);
  assert.match(presentation.primaryContent, /工作台。\n\n## 核心理念\n\n\*\*Agent 不只回答问题\*\*/);
  assert.match(presentation.primaryContent, /产物。\n\n## 独特性\n\n1\. 前端/);
  assert.match(presentation.primaryContent, /GUI\n2\. 后端/);
  assert.match(presentation.primaryContent, /知识图谱。\n\n典型用途/);
});

test('final message presentation keeps scientific single-letter terms readable', () => {
  const presentation = splitFinalMessagePresentation('T cell and B cells remain separate while Cursor Agent identifiers stay repaired.');

  assert.match(presentation.primaryContent, /T cell/);
  assert.match(presentation.primaryContent, /B cells/);
  assert.doesNotMatch(presentation.primaryContent, /Tcell|Bcells/);
});

test('final message rendering preserves legitimate scientific model wording', () => {
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content="The perturbation model is a statistical model for single-cell response prediction, not runtime configuration."
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /perturbation model/);
  assert.match(markup, /statistical model/);
  assert.doesNotMatch(markup, /perturbation runtime|statistical runtime/);
});

test('raw payload-only messages promote embedded human answer and fold payload metadata', () => {
  const content = [
    '```json',
    JSON.stringify({
      message: 'Analysis finished. The reusable output is artifact::analysis-report and the source table is file::data/results.csv.',
      confidence: 0.91,
      claimType: 'analysis-result',
      objects: [{ ref: 'artifact::analysis-report' }],
      recoverActions: ['Archive this successful run for later comparison.'],
      executionUnits: [{ id: 'unit-1', backend: 'worker' }],
    }, null, 2),
    '```',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /Analysis finished/);
  assert.match(presentation.primaryContent, /artifact::analysis-report/);
  assert.match(presentation.primaryContent, /file::data\/results\.csv/);
  assert.doesNotMatch(presentation.primaryContent, /The task did not finish/);
  assert.doesNotMatch(presentation.primaryContent, /executionUnits/);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'raw-json');
});

test('runtime JSONL stdout and stderr stay folded out of the main answer DOM', () => {
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content={[
        'Done: artifact::analysis-report contains the user-facing result.',
        '',
        '## Runtime event',
        '```jsonl',
        '{"type":"stdout","data":"RAW_STDOUT_SHOULD_NOT_RENDER","line":1}',
        '{"type":"stderr","data":"RAW_STDERR_SHOULD_NOT_RENDER","line":2}',
        '{"type":"debug","raw_jsonl":"RAW_JSONL_SHOULD_NOT_RENDER"}',
        '```',
      ].join('\n')}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );
  const foldStart = markup.indexOf('final-message-audit-fold');
  const mainDom = foldStart >= 0 ? markup.slice(0, foldStart) : markup;

  assert.match(markup, /final-message-audit-fold/);
  assert.doesNotMatch(markup, /<details class="message-fold depth-2 final-message-audit-fold" open/);
  assert.match(mainDom, /Done:/);
  assert.doesNotMatch(mainDom, /RAW_STDOUT_SHOULD_NOT_RENDER|RAW_STDERR_SHOULD_NOT_RENDER|RAW_JSONL_SHOULD_NOT_RENDER/);
});

test('Runtime Codex plugin and transport warnings stay out of the main answer DOM', () => {
  const pluginWarning = Array.from({ length: 24 }, (_, index) => (
    `warn plugin manifest ${index}: failed to load plugin manifest from /private/tmp/sciforge-plugin-${index}.json`
  )).join('\n');
  const markup = renderToStaticMarkup(
    <FinalMessageContent
      content={[
        'Done: artifact::analysis-report contains the user-facing result.',
        '',
        '## Runtime stderr',
        '```stderr',
        pluginWarning,
        '<!DOCTYPE html><html><title>Attention Required! Cloudflare</title><body>CF-RAY RAW_HTML_SHOULD_NOT_RENDER</body></html>',
        '{"type":"raw_jsonl","rawJsonl":"RAW_JSONL_SHOULD_NOT_RENDER"}',
        '```',
      ].join('\n')}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );
  const foldStart = markup.indexOf('final-message-audit-fold');
  const mainDom = foldStart >= 0 ? markup.slice(0, foldStart) : markup;

  assert.match(markup, /final-message-audit-fold/);
  assert.match(mainDom, /Done:/);
  assert.doesNotMatch(mainDom, /plugin manifest|failed to load plugin|Attention Required|CF-RAY|RAW_JSONL_SHOULD_NOT_RENDER/i);
});

test('plain raw webpage and search dumps fold out while later answer prose remains primary', () => {
  const content = [
    '<!DOCTYPE html><html lang="en"><head><title>RAW_HTML_SHOULD_NOT_RENDER</title></head><body>',
    'quick links Login Help Pages About Search API',
    '--- Paper 1 ---',
    'ID: 2605.30001',
    'Title: RAW_TITLE_ONE_SHOULD_NOT_RENDER',
    'Authors: Example Team',
    'Abstract: A long raw abstract copied from a public search page.',
    'URL: https://arxiv.org/abs/2605.30001',
    '--- Paper 2 ---',
    'ID: 2605.30002',
    'Title: RAW_TITLE_TWO_SHOULD_NOT_RENDER',
    'Authors: Example Team',
    'Abstract: Another raw abstract copied from a public search page.',
    'URL: https://arxiv.org/abs/2605.30002',
    Array.from({ length: 12 }, (_, index) => `Raw search result line ${index}: metadata copied verbatim.`).join('\n'),
    '</body></html>',
    '',
    '总结：I actually opened the public abstract pages and found two relevant candidates.',
    '',
    '| Title | Date | Confidence |',
    '| --- | --- | --- |',
    '| Candidate A | 2026-05-30 | medium |',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);
  const markup = renderToStaticMarkup(
    <FinalMessageContent content={content} references={[]} onObjectFocus={() => undefined} />,
  );
  const foldStart = markup.indexOf('final-message-audit-fold');
  const mainDom = foldStart >= 0 ? markup.slice(0, foldStart) : markup;

  assert.match(presentation.primaryContent, /I actually opened/);
  assert.match(presentation.primaryContent, /Candidate A/);
  assert.doesNotMatch(presentation.primaryContent, /RAW_HTML_SHOULD_NOT_RENDER|quick links|Paper 2|RAW_TITLE_TWO_SHOULD_NOT_RENDER/i);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'tool-output');
  assert.match(mainDom, /I actually opened/);
  assert.doesNotMatch(mainDom, /RAW_HTML_SHOULD_NOT_RENDER|quick links|Paper 2|RAW_TITLE_TWO_SHOULD_NOT_RENDER/i);
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

test('user-facing planning risk registers remain in primary answer', () => {
  const content = [
    'Planning register from the selected reference; no new workspace task was started.',
    '',
    '## Budget',
    '- Personnel and analysis support: $52,000-$70,000',
    '- Discovery assay/platform fees: $43,000-$57,000',
    '',
    '## Timeline',
    '- Month 9: Package final report, repository, release notes, and unresolved-risk register.',
    '',
    '## Risk Register',
    '- R1: Compressed 9-month timeline leaves less recovery time. Mitigation: define an early go/no-go check and fallback scope. Owner: PI/project lead.',
    '- R2: Reduced $180,000 budget may force scope cuts. Mitigation: define an early go/no-go check and fallback scope. Owner: technical lead.',
    '- R3: Xenium access removed; platform-dependent aims must be redesigned. Mitigation: replace platform-dependent assays. Owner: validation owner.',
    '- R4: Input quality or access fails. Mitigation: add a fallback cohort and QC gate. Owner: PI/project lead.',
    '',
    '## Constraint Dependencies',
    '- Updated hard timeline: 9 months.',
    '- Updated hard budget cap: $180,000.',
    '- Updated platform constraint: no Xenium access; dependent aims and assays require replacement.',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /## Risk Register/);
  assert.match(presentation.primaryContent, /R1: Compressed 9-month timeline/);
  assert.match(presentation.primaryContent, /R4: Input quality or access fails/);
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
    confidenceExplanation: {
      level: 'high',
      evidenceLevel: 'tool-backed',
      sourceScore: 0.91,
      evidenceDefault: 0.82,
      evidenceCap: 0.94,
      penalties: [{ reason: 'One source remains unreplicated.', delta: 0.03 }],
      summary: 'Evidence is attached to the finding.',
      citationIds: ['citation-table'],
    },
    processSummary: { foldedByDefault: true, summary: 'Execution details are available for audit.' },
    diagnosticsRefs: [{ id: 'raw-1', label: 'Raw payload', kind: 'raw-payload', ref: '.sciforge/task-results/raw.json' }],
  });

  assert.match(presentation.primaryContent, /The analysis completed/);
  assert.match(presentation.primaryContent, /Treatment B/);
  assert.match(presentation.primaryContent, /sourceScore: 0.91/);
  assert.match(presentation.primaryContent, /One source remains unreplicated/);
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
        inlineCitations: [
          { id: 'citation-report', label: 'Report', kind: 'artifact', ref: 'artifact:analysis-report' },
          { id: 'citation-table', label: 'Internal table row', kind: 'file', ref: '.sciforge/data/table.csv#row-b' },
        ],
        artifactActions: [{ id: 'artifact-1', label: 'Open report', ref: 'artifact:analysis-report' }],
        nextActions: [],
        diagnosticsRefs: [],
      }}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /data-sciforge-reference=/);
  assert.match(markup, /artifact::analysis-report/);
  assert.doesNotMatch(markup, /\.sciforge\/data\/table\.csv|Internal table row/);
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

  assert.match(presentation.primaryContent, /The task (?:did not finish|returned)/);
  assert.doesNotMatch(presentation.primaryContent, /Invalid token|https?:\/\/|stdoutRef|stderrRef|runtimeEventsRef/);
  assert.equal(presentation.auditSections.length, 1);
  assert.ok(['raw-json', 'execution-audit'].includes(presentation.auditSections[0]?.evidenceType ?? ''));
});

test('inline session conflict diagnostics before the answer stay folded', () => {
  const content = [
    '"schemaVersion": 1, "id": "session-conflict-mpeebed3-hxplmg", "kind": "ordering-conflict",',
    '"expectedBaseRevision": "39269b24", "actualBaseRevision": "b3e08dd8",',
    '"conflictingFields": ["messages"], "recoverableActions": ["Reload the current session state.", "Reapply the attempted changes."]}',
    '否，这次是简单的只读观察任务，不需要把 session conflict payload 放进主回答。',
  ].join(' ');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /^否，这次是简单的只读观察任务/);
  assert.doesNotMatch(presentation.primaryContent, /session-conflict|expectedBaseRevision|recoverableActions/);
  assert.equal(presentation.auditSections.length, 1);
  assert.equal(presentation.auditSections[0].evidenceType, 'execution-audit');
  assert.match(presentation.auditSections[0].text, /session-conflict/);
});

test('sub-agent result sections aggregate into a table and bounded notes without raw transcripts', () => {
  const content = [
    '# Result',
    'Overall: combine the bounded child outcomes before closing the turn.',
    '',
    '## Sub-agent: Explorer check',
    'Status: completed',
    'Summary: Found the final answer aggregation gap.',
    'Result ref: artifact:subagent-result-explorer',
    'Transcript ref: agent-transcript:explorer-trace',
    'Raw transcript:',
    '```jsonl',
    '{"type":"stdout","text":"RAW_TRANSCRIPT_SHOULD_NOT_RENDER","stdoutRef":".sciforge/raw/stdout.log"}',
    '{"type":"debug","commandExecution":"COMMAND_EXECUTION_SHOULD_NOT_RENDER"}',
    '```',
    '',
    '## Worker: Review check',
    'Status: blocked',
    'Result summary: Needs live desktop verification before closure.',
    'Refs: artifact:subagent-result-review, agent-transcript:review-trace',
    'provider.local https://provider.local/v1 token=sk-private /Users/alice/private should stay private.',
    '',
    '## Next step',
    'Open artifact:subagent-result-review for the bounded blocker summary.',
  ].join('\n');

  const presentation = splitFinalMessagePresentation(content);

  assert.match(presentation.primaryContent, /# Result/);
  assert.match(presentation.primaryContent, /Overall: combine the bounded child outcomes/);
  assert.match(presentation.primaryContent, /## sub-agent results/i);
  assert.match(presentation.primaryContent, /\| Task \| Status \| Summary \| Refs \|/);
  assert.match(presentation.primaryContent, /Explorer check \| completed \| Found the final answer aggregation gap\. \| artifact:subagent-result-explorer, agent-transcript:explorer-trace/);
  assert.match(presentation.primaryContent, /Review check \| blocked \| Needs live desktop verification before closure\. \| artifact:subagent-result-review, agent-transcript:review-trace/);
  assert.match(presentation.primaryContent, /## sub-agent notes/i);
  assert.match(presentation.primaryContent, /### Explorer check/);
  assert.match(presentation.primaryContent, /### Review check/);
  assert.match(presentation.primaryContent, /## Next step/);
  assert.doesNotMatch(presentation.primaryContent, /Raw transcript|RAW_TRANSCRIPT_SHOULD_NOT_RENDER|COMMAND_EXECUTION_SHOULD_NOT_RENDER|stdoutRef|provider\.local|sk-private|\/Users\/alice/i);
  assert.doesNotMatch(presentation.auditSections.map((section) => section.text).join('\n'), /RAW_TRANSCRIPT_SHOULD_NOT_RENDER|COMMAND_EXECUTION_SHOULD_NOT_RENDER|provider\.local|sk-private|\/Users\/alice/i);
});
