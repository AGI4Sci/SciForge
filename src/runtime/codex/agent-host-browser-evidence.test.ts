import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentHostBrowserCompletionTruthFromEvaluation,
  agentHostBrowserAcceptanceSpecFromPrompt,
  agentHostBrowserSearchPlanFromPrompt,
  agentHostBrowserUserPromptFromCommandText,
  createAgentHostBrowserEvidenceLedger,
  evaluateAgentHostBrowserSearchDiscovery,
  evaluateAgentHostBrowserSearchQuery,
  evaluateAgentHostBrowserEvidence,
  recordAgentHostBrowserRefs,
  recordAgentHostBrowserToolResult,
} from './agent-host-browser-evidence.js';
import {
  BROWSER_PRIMITIVE_RESULT_SCHEMA,
  type BrowserPrimitiveEnvelope,
} from '../../../packages/actions/browser-runtime/index.js';

test('Agent Host Browser evidence evaluator treats search-only evidence as repairable, not satisfied', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserSearchEnvelope()),
    ['runtime-tool:browser_search:turn-1', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger);

  assert.equal(evaluation.status, 'repairable');
  assert.deepEqual(evaluation.satisfiedEvidenceRefs, []);
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-page-refs-missing'));
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-page-text-refs-missing'));
  assert.ok(evaluation.repairHints.some((hint) => hint.action === 'call-browser-read'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser evidence evaluator rejects final answers when candidate reads are blocked', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(
      recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserSearchEnvelope()),
      browserBlockedReadEnvelope(),
    ),
    [
      'runtime-tool:browser_search:turn-1',
      'runtime-tool:browser_read:turn-2',
      'codex.app-server.final-answer',
    ],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('请搜索最近一周 Browser primitives atlas，并列出实际读取来源。', {
      now: new Date('2026-06-08T12:00:00.000Z'),
    }),
  });

  assert.notEqual(evaluation.status, 'satisfied');
  assert.deepEqual(evaluation.satisfiedEvidenceRefs, []);
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-page-refs-missing'));
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-page-text-refs-missing'));
  assert.ok(evaluation.repairHints.some((hint) => hint.action === 'call-browser-read'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser evidence evaluator satisfies only current browser_read source and page text evidence with Codex App Server final-answer refs', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(
      recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserSearchEnvelope()),
      browserReadEnvelope(),
    ),
    ['runtime-tool:browser_search:turn-1', 'runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger);
  const completionTruth = agentHostBrowserCompletionTruthFromEvaluation(evaluation);

  assert.equal(evaluation.status, 'satisfied');
  assert.deepEqual(evaluation.issues, []);
  assert.ok(evaluation.satisfiedEvidenceRefs.includes('browser-host-session:current/source-pages/source-1.source.json'));
  assert.ok(evaluation.satisfiedEvidenceRefs.includes('browser-host-session:current/source-pages/source-1.txt'));
  assert.deepEqual(completionTruth, {
    schemaVersion: 'sciforge.agent-host.completion-truth.v1',
    scope: 'user-task',
    status: 'satisfied',
    validator: 'agent-host-browser-acceptance',
    evidenceRefs: evaluation.satisfiedEvidenceRefs,
    reason: 'Browser source/page text refs and Codex App Server final-answer evidence are present in the current run.',
  });
});

test('Agent Host Browser evidence evaluator keeps read evidence partial until final answer projection exists', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserReadEnvelope()),
    ['runtime-tool:browser_read:turn-2'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger);
  const completionTruth = agentHostBrowserCompletionTruthFromEvaluation(evaluation);

  assert.equal(evaluation.status, 'partial');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-final-answer-ref-missing'));
  assert.equal(completionTruth.status, 'partial');
  assert.match(completionTruth.reason ?? '', /Codex App Server final-answer/);
});

test('Agent Host Browser evidence ledger records resource state progression from every Browser tool result', () => {
  const ledger = recordAgentHostBrowserToolResult(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserSearchEnvelope()),
    browserReadEnvelope(),
  );

  assert.equal(ledger.resourceEvents.length, 5);
  assert.equal(ledger.resourcesByRef['browser:resource:web_page:atlas']?.status, 'read');
  assert.equal(ledger.resourcesByRef['browser:resource:web_page:atlas']?.originTool, 'browser.read');
  assert.equal(ledger.resourcesByRef['browser-host-session:current/source-pages/source-1.source.json']?.kind, 'source_page');
  assert.equal(ledger.resourcesByRef['browser-host-session:current/source-pages/source-1.txt']?.kind, 'page_text');
});

test('Agent Host Browser acceptance spec records relative-window temporal constraints from recent-source prompts', () => {
  const spec = agentHostBrowserAcceptanceSpecFromPrompt('请搜索最近一周伊朗局势，并列出来源链接。', {
    now: new Date('2026-06-08T12:00:00.000Z'),
  });

  assert.equal(spec.schemaVersion, 'sciforge.agent-host.browser-acceptance-spec.v1');
  assert.equal(spec.source.minReadSources, 1);
  assert.equal(spec.source.requireSourcePageRefs, true);
  assert.equal(spec.source.requirePageTextRefs, true);
  assert.equal(spec.temporal?.kind, 'relative-window');
  assert.equal(spec.temporal?.windowDays, 7);
  assert.equal(spec.temporal?.startDate, '2026-06-01');
  assert.equal(spec.temporal?.endDate, '2026-06-08');
  assert.ok(spec.topicalTerms.includes('伊朗局势'));
});

test('Agent Host Browser acceptance spec strips Runtime Codex continuation scaffolding before topic extraction', () => {
  const prompt = [
    'Continue the active Runtime Codex session. Interpret relative references such as "previous turn", "last answer", or "that passphrase" against the immediately preceding non-seed user/assistant exchange in this native Codex session unless selected refs say otherwise.',
    '',
    '搜索一下伊朗局势',
  ].join('\n');
  const spec = agentHostBrowserAcceptanceSpecFromPrompt(prompt);

  assert.equal(agentHostBrowserUserPromptFromCommandText(prompt), '搜索一下伊朗局势');
  assert.deepEqual(spec.topicalTerms, ['伊朗局势']);
  assert.doesNotMatch(spec.taskSummary ?? '', /Continue the active Runtime Codex session|Interpret relative references/);
});

test('Agent Host Browser search guard rejects contaminated queries before Browser execution', () => {
  const plan = agentHostBrowserSearchPlanFromPrompt('帮我搜索一下伊朗局势，至少搜索5条信息。');
  const evaluation = evaluateAgentHostBrowserSearchQuery(
    'Use the visible desktop from the ordinary SciForge Desktop chat to complete the Computer Use acceptance task. Start from the product chat surface, bind the curr',
    plan,
  );

  assert.equal(evaluation.status, 'repairable');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-search-query-contaminated'));
  assert.ok(evaluation.repairHints.some((hint) => hint.action === 'collect-browser-evidence'));
});

test('Agent Host Browser search guard flags obviously unrelated discovery results before auto-read', () => {
  const plan = agentHostBrowserSearchPlanFromPrompt('帮我搜索一下伊朗局势，至少搜索5条信息。');
  const ledger = recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserUnrelatedSearchEnvelope());
  const evaluation = evaluateAgentHostBrowserSearchDiscovery(ledger, plan);

  assert.equal(evaluation.status, 'repairable');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-search-result-relevance-gap'));
  assert.deepEqual(evaluation.satisfiedEvidenceRefs, []);
});

test('Agent Host Browser search plan extracts task query and source requirements without workflow scaffolding', () => {
  const plan = agentHostBrowserSearchPlanFromPrompt(
    [
      'Continue the active Runtime Codex session. Interpret relative references such as "previous turn" against the immediately preceding exchange.',
      '',
      '请使用 SciForge 内置 Browser 搜索并读取 OpenAI 官方最近发布的一条产品更新，用中文简短总结，并列出实际读取来源链接。',
    ].join('\n'),
    { now: new Date('2026-06-08T12:00:00.000Z') },
  );

  assert.equal(plan.schemaVersion, 'sciforge.agent-host.browser-search-plan.v1');
  assert.equal(plan.search.primaryQuery, 'OpenAI 官方 产品更新');
  assert.deepEqual(plan.search.queryCandidates.slice(0, 2), [
    'site:openai.com OpenAI 官方 产品更新',
    'site:platform.openai.com OpenAI 官方 产品更新',
  ]);
  assert.equal(plan.search.maxDiscoveryAttemptsBeforeRead, 1);
  assert.ok(plan.acceptanceSpec.source.preferredDomains.includes('openai.com'));
  assert.ok(plan.acceptanceSpec.source.preferredDomains.includes('platform.openai.com'));
  assert.equal(plan.acceptanceSpec.temporal?.kind, 'latest');
  assert.deepEqual(plan.acceptanceSpec.topicalTerms, ['OpenAI', '产品更新']);
  assert.doesNotMatch(plan.search.primaryQuery, /SciForge|Browser|搜索|读取|来源链接|Continue the active Runtime Codex session/);
});

test('Agent Host Browser search plan requires multiple sources for comparison and verification tasks', () => {
  const plan = agentHostBrowserSearchPlanFromPrompt('对比两家媒体关于伊朗局势的最新报道，给出来源。', {
    now: new Date('2026-06-08T12:00:00.000Z'),
  });

  assert.equal(plan.acceptanceSpec.source.minReadSources, 2);
  assert.equal(plan.acceptanceSpec.source.requireIndependentSources, true);
  assert.equal(plan.search.maxDiscoveryAttemptsBeforeRead, 1);
  assert.ok(plan.search.primaryQuery.includes('伊朗局势'));
  assert.ok(plan.search.primaryQuery.includes('媒体'));
});

test('Agent Host Browser acceptance spec ignores generic English Browser workflow words', () => {
  const spec = agentHostBrowserAcceptanceSpecFromPrompt('Search, read, and answer from Browser evidence.');

  assert.deepEqual(spec.topicalTerms, []);
});

test('Agent Host Browser acceptance spec ignores SciForge Browser workflow words around the real topic', () => {
  const spec = agentHostBrowserAcceptanceSpecFromPrompt(
    '请使用 SciForge 内置 Browser 搜索并读取一个最近的新闻来源页面，主题是 OpenAI 或人工智能的最新动态。必须先调用 browser_search，再调用 browser_read 读取网页正文/source refs，然后用中文简短总结这一条新闻，并列出实际读取来源链接。不要只凭记忆回答，不要只给搜索结果或引用编号。',
  );

  assert.ok(spec.topicalTerms.includes('OpenAI'));
  assert.ok(spec.topicalTerms.includes('人工智能'));
  assert.doesNotMatch(spec.topicalTerms.join(' '), /SciForge|Browser|browser_search|browser_read|source|refs|网页正文|必须先调用|不要只凭记忆回答|不要只给|引用编号/);
});

test('Agent Host Browser acceptance blocks low-information read pages even when refs and Codex App Server final-answer refs exist', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserLowInformationReadEnvelope()),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('总结这篇论文并列出来源。'),
  });
  const completionTruth = agentHostBrowserCompletionTruthFromEvaluation(evaluation);

  assert.equal(evaluation.status, 'blocked');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-low-information'));
  assert.equal(completionTruth.status, 'blocked');
});

test('Agent Host Browser acceptance returns a relevance gap for read sources unrelated to the prompt topic', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserReadEnvelope()),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('搜索伊朗局势的最新进展。'),
  });

  assert.equal(evaluation.status, 'partial');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-relevance-gap'));
  assert.ok(evaluation.repairHints.some((hint) => hint.action === 'call-browser-read'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser acceptance returns a temporal gap for sources outside the requested recent window', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserDatedIranReadEnvelope('2026-05-12')),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('请搜索最近一周伊朗局势，并列出来源链接。', {
      now: new Date('2026-06-08T12:00:00.000Z'),
    }),
  });

  assert.equal(evaluation.status, 'partial');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-temporal-gap'));
  assert.ok(evaluation.repairHints.some((hint) => hint.action === 'call-browser-read'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser acceptance returns a temporal gap when latest sources are stale', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserDatedIranReadEnvelope('2026-05-12')),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('请搜索伊朗局势的最新进展。', {
      now: new Date('2026-06-08T12:00:00.000Z'),
    }),
  });

  assert.equal(evaluation.status, 'partial');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-temporal-gap'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser acceptance requires searchable source metadata for topical prompts', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserSparseReadEnvelope()),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('搜索伊朗局势的最新进展。'),
  });

  assert.equal(evaluation.status, 'partial');
  assert.ok(evaluation.issues.some((issue) => issue.code === 'browser-source-relevance-evidence-missing'));
  assert.notEqual(agentHostBrowserCompletionTruthFromEvaluation(evaluation).status, 'satisfied');
});

test('Agent Host Browser acceptance treats common CJK request fillers as non-topic text', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserDatedIranReadEnvelope('2026-06-07')),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('帮我搜索一下伊朗局势，并列出来源。'),
  });

  assert.equal(evaluation.status, 'satisfied');
  assert.deepEqual(evaluation.issues, []);
});

test('Agent Host Browser acceptance recognizes Chinese and English news dates in source previews', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(createAgentHostBrowserEvidenceLedger(), browserDatedOpenAiReadEnvelope()),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('请搜索 OpenAI 最新动态并列出来源。', {
      now: new Date('2026-06-08T12:00:00.000Z'),
    }),
  });

  assert.equal(evaluation.status, 'satisfied');
  assert.deepEqual(evaluation.issues, []);
});

test('Agent Host Browser acceptance recognizes Chinese news dates without English fallback dates', () => {
  const ledger = recordAgentHostBrowserRefs(
    recordAgentHostBrowserToolResult(
      createAgentHostBrowserEvidenceLedger(),
      browserDatedOpenAiReadEnvelope('2026年6月6日 OpenAI 发布了 ChatGPT Enterprise/EDU updates for Codex plugin sharing.'),
    ),
    ['runtime-tool:browser_read:turn-2', 'codex.app-server.final-answer'],
  );

  const evaluation = evaluateAgentHostBrowserEvidence(ledger, {
    acceptanceSpec: agentHostBrowserAcceptanceSpecFromPrompt('请搜索 OpenAI 最新动态并列出来源。', {
      now: new Date('2026-06-08T12:00:00.000Z'),
    }),
  });

  assert.equal(evaluation.status, 'satisfied');
  assert.deepEqual(evaluation.issues, []);
});

function browserSearchEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'search',
    status: 'completed',
    output: {
      query: 'Browser primitives atlas',
      results: [{
        title: 'Browser Primitives Atlas',
        url: 'https://example.test/browser-primitives-atlas',
        snippet: 'Candidate result; page body has not been read.',
      }],
      searchResultRef: 'browser:search-result:turn-1',
    },
    resources: [{
      ref: 'browser:search-result:turn-1',
      kind: 'search_result_set',
      status: 'discovered',
      originTool: 'browser.search',
      confidence: 'candidate',
    }, {
      ref: 'browser:resource:web_page:atlas',
      kind: 'web_page',
      status: 'discovered',
      originTool: 'browser.search',
      locator: { url: 'https://example.test/browser-primitives-atlas' },
      confidence: 'candidate',
    }],
    evidenceState: {
      completed: ['Discovered 1 candidate web page resource(s).'],
      unknown: ['Candidate page bodies have not been read or materialized as source/page text refs.'],
      boundary: 'Search results and snippets are not source evidence until browser.read materializes page text/source refs.',
    },
    refs: ['browser:search-result:turn-1'],
    diagnostics: [],
    budget: {},
  };
}

function browserUnrelatedSearchEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'search',
    status: 'completed',
    output: {
      query: 'Use the visible desktop from the ordinary SciForge Desktop chat to complete the Computer Use acceptance task',
      results: [{
        title: '内蒙古农业大学研究生院',
        url: 'https://yjsy.imau.edu.cn/index.htm',
        snippet: '内蒙古农业大学研究生院招生、培养和学位管理信息。',
      }],
      searchResultRef: 'browser:search-result:wrong-topic',
    },
    resources: [{
      ref: 'browser:search-result:wrong-topic',
      kind: 'search_result_set',
      status: 'discovered',
      originTool: 'browser.search',
      confidence: 'candidate',
      title: '内蒙古农业大学研究生院',
      snippet: '内蒙古农业大学研究生院招生、培养和学位管理信息。',
    }, {
      ref: 'browser:resource:web_page:imau-yjs',
      kind: 'web_page',
      status: 'discovered',
      originTool: 'browser.search',
      locator: { url: 'https://yjsy.imau.edu.cn/index.htm' },
      title: '内蒙古农业大学研究生院',
      snippet: '内蒙古农业大学研究生院招生、培养和学位管理信息。',
      confidence: 'candidate',
    }],
    evidenceState: {
      completed: ['Discovered 1 candidate web page resource(s).'],
      unknown: ['Candidate page bodies have not been read or materialized as source/page text refs.'],
      boundary: 'Search results and snippets are not source evidence until browser.read materializes page text/source refs.',
    },
    refs: ['browser:search-result:wrong-topic'],
    diagnostics: [],
    budget: {},
  };
}

function browserReadEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'completed',
    output: {
      finalUrl: 'https://example.test/browser-primitives-atlas',
      title: 'Browser Primitives Atlas',
      sourcePageRef: 'browser-host-session:current/source-pages/source-1.source.json',
      pageTextRef: 'browser-host-session:current/source-pages/source-1.txt',
      textCharCount: 1200,
      textSha1: '1b4b2f6dd2f8f4cb8d9f6eddf6c5d9f7e0812345',
    },
    resources: [{
      ref: 'browser:resource:web_page:atlas',
      kind: 'web_page',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/browser-primitives-atlas' },
      title: 'Browser Primitives Atlas',
      snippet: 'A technical atlas for browser runtime primitive contracts.',
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/source-1.source.json',
      kind: 'source_page',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/browser-primitives-atlas' },
      title: 'Browser Primitives Atlas',
      snippet: 'A technical atlas for browser runtime primitive contracts.',
      metadata: {
        textPreview: 'Browser primitives provide search, read, extract, and download contracts for runtime evidence.',
      },
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/source-1.txt',
      kind: 'page_text',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/browser-primitives-atlas' },
      title: 'Browser Primitives Atlas',
      metadata: {
        textPreview: 'Browser primitives provide search, read, extract, and download contracts for runtime evidence.',
      },
      confidence: 'materialized',
    }],
    evidenceState: {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['Task-level synthesis and verifier acceptance remain outside Browser Runtime.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    },
    refs: [
      'browser-host-session:current/source-pages/source-1.source.json',
      'browser-host-session:current/source-pages/source-1.txt',
    ],
    diagnostics: [],
    budget: {},
  };
}

function browserBlockedReadEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'blocked',
    output: {
      finalUrl: 'https://example.test/browser-primitives-atlas',
      title: 'Browser Primitives Atlas',
    },
    resources: [{
      ref: 'browser:resource:web_page:atlas',
      kind: 'web_page',
      status: 'discovered',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/browser-primitives-atlas' },
      title: 'Browser Primitives Atlas',
      confidence: 'candidate',
    }],
    evidenceState: {
      completed: [],
      unknown: ['Candidate page body could not be read or materialized as source/page text refs.'],
      boundary: 'Blocked reads are not source evidence for task completion.',
    },
    refs: ['browser:resource:web_page:atlas'],
    diagnostics: [{
      code: 'network',
      severity: 'error',
      message: 'source_page_read_failed: HTTP 403',
    }],
    budget: {},
  };
}

function browserSparseReadEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'completed',
    output: {
      finalUrl: 'https://example.test/sparse-source',
      title: 'Sparse Source',
      sourcePageRef: 'browser-host-session:current/source-pages/sparse.source.json',
      pageTextRef: 'browser-host-session:current/source-pages/sparse.txt',
      textCharCount: 1200,
    },
    resources: [{
      ref: 'browser-host-session:current/source-pages/sparse.source.json',
      kind: 'source_page',
      status: 'read',
      originTool: 'browser.read',
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/sparse.txt',
      kind: 'page_text',
      status: 'read',
      originTool: 'browser.read',
      confidence: 'materialized',
    }],
    evidenceState: {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['Task-level synthesis and verifier acceptance remain outside Browser Runtime.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    },
    refs: [
      'browser-host-session:current/source-pages/sparse.source.json',
      'browser-host-session:current/source-pages/sparse.txt',
    ],
    diagnostics: [],
    budget: {},
  };
}

function browserDatedIranReadEnvelope(publishedAt: string): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'completed',
    output: {
      finalUrl: 'https://example.test/iran-situation',
      title: '伊朗局势最新进展',
      sourcePageRef: 'browser-host-session:current/source-pages/iran.source.json',
      pageTextRef: 'browser-host-session:current/source-pages/iran.txt',
      textCharCount: 1200,
    },
    resources: [{
      ref: 'browser-host-session:current/source-pages/iran.source.json',
      kind: 'source_page',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/iran-situation' },
      title: '伊朗局势最新进展',
      metadata: {
        publishedAt,
        textPreview: `伊朗局势报道，发布时间 ${publishedAt}，包含地区安全与外交动态。`,
      },
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/iran.txt',
      kind: 'page_text',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/iran-situation' },
      title: '伊朗局势最新进展',
      metadata: {
        publishedAt,
        textPreview: `伊朗局势报道，发布时间 ${publishedAt}，包含地区安全与外交动态。`,
      },
      confidence: 'materialized',
    }],
    evidenceState: {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['Task-level synthesis and verifier acceptance remain outside Browser Runtime.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    },
    refs: [
      'browser-host-session:current/source-pages/iran.source.json',
      'browser-host-session:current/source-pages/iran.txt',
    ],
    diagnostics: [],
    budget: {},
  };
}

function browserDatedOpenAiReadEnvelope(
  textPreview = 'Last updated: 2026年6月6日. June 5, 2026 OpenAI 发布了 ChatGPT Enterprise/EDU updates for Codex plugin sharing.',
): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'completed',
    output: {
      finalUrl: 'https://example.test/openai-news',
      title: 'OpenAI 最新动态',
      sourcePageRef: 'browser-host-session:current/source-pages/openai.source.json',
      pageTextRef: 'browser-host-session:current/source-pages/openai.txt',
      textPreview,
      textCharCount: 1200,
    },
    resources: [{
      ref: 'browser-host-session:current/source-pages/openai.source.json',
      kind: 'source_page',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/openai-news' },
      title: 'OpenAI 最新动态',
      metadata: {
        textPreview,
      },
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/openai.txt',
      kind: 'page_text',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://example.test/openai-news' },
      title: 'OpenAI 最新动态',
      metadata: {
        textPreview,
      },
      confidence: 'materialized',
    }],
    evidenceState: {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['Task-level synthesis and verifier acceptance remain outside Browser Runtime.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    },
    refs: [
      'browser-host-session:current/source-pages/openai.source.json',
      'browser-host-session:current/source-pages/openai.txt',
    ],
    diagnostics: [],
    budget: {},
  };
}

function browserLowInformationReadEnvelope(): BrowserPrimitiveEnvelope {
  return {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: 'browser',
    primitive: 'read',
    status: 'completed',
    output: {
      finalUrl: 'https://arxiv.org/login',
      title: 'Login',
      sourcePageRef: 'browser-host-session:current/source-pages/login.source.json',
      pageTextRef: 'browser-host-session:current/source-pages/login.txt',
      textCharCount: 80,
    },
    resources: [{
      ref: 'browser-host-session:current/source-pages/login.source.json',
      kind: 'source_page',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://arxiv.org/login' },
      title: 'Login',
      snippet: 'Skip to main content. Sign in to continue.',
      metadata: {
        discoveryOnly: true,
        textPreview: 'Skip to main content. Login. Sign in to continue.',
      },
      confidence: 'materialized',
    }, {
      ref: 'browser-host-session:current/source-pages/login.txt',
      kind: 'page_text',
      status: 'read',
      originTool: 'browser.read',
      locator: { url: 'https://arxiv.org/login' },
      title: 'Login',
      metadata: {
        discoveryOnly: true,
        textPreview: 'Skip to main content. Login. Sign in to continue.',
      },
      confidence: 'materialized',
    }],
    evidenceState: {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['The page is a low-information navigation/login page.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    },
    refs: [
      'browser-host-session:current/source-pages/login.source.json',
      'browser-host-session:current/source-pages/login.txt',
    ],
    diagnostics: [],
    budget: {},
  };
}
