import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WEB_SEARCH_PRODUCT_ACCEPTANCE_NEGATIVE_CASE_IDS,
  WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES,
  WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION,
  buildWebSearchProductAcceptanceNegativeFixture,
  validateWebSearchProductAcceptanceManifest,
  writeWebSearchProductAcceptanceFromCurrentRun,
  writeWebSearchProductAcceptanceScaffold,
} from './helpers/web-search-product-acceptance-fixtures.js';

const fixedNow = new Date('2026-06-10T08:00:00.000Z');

test('web_search product acceptance scaffold writes current-run search-read evidence without product proof', async () => {
  await withArtifactDir('sciforge-web-search-product-acceptance-', async (artifactDir) => {
    const manifest = await writeWebSearchProductAcceptanceScaffold({
      artifactDir,
      now: () => fixedNow,
      runId: 'web-search-product-current',
    });

    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
    });
    const strictValidation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(validation.productProof, false);
    assert.equal(manifest.releaseEligible, false);
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');
    assert.ok(manifest.currentRun.toolTrace.every((entry) => entry.runId === manifest.currentRun.runId));

    const source = manifest.currentRun.sourcePages[0];
    assert.ok(source, 'scaffold must include one source page');
    assert.match(source.sourcePageJsonRef, /^web-source:web-search-product-current\//);
    assert.match(source.pageTextRef, /^web-text:web-search-product-current\//);
    assert.match(source.textSha1, /^[a-f0-9]{40}$/);
    assert.equal(source.openedAt, '2026-06-10T08:00:00.000Z');
    assert.equal(source.finalUrl, 'https://example.com/product-release');

    const sourcePageJson = JSON.parse(await readFile(join(artifactDir, source.sourcePageJsonPath), 'utf8')) as Record<string, unknown>;
    assert.equal(sourcePageJson.textSha1, source.textSha1);
    assert.equal(sourcePageJson.openedAt, source.openedAt);
    assert.equal(sourcePageJson.finalUrl, source.finalUrl);
    assert.match(await readFile(join(artifactDir, source.pageTextPath), 'utf8'), /product release/i);

    assert.ok(manifest.finalAnswer.text.includes(source.finalUrl), 'final answer must contain a source link');
    assert.ok(manifest.finalAnswer.sourceLinks.includes(source.finalUrl));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(source.sourcePageJsonRef));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(source.pageTextRef));
    assert.equal(strictValidation.valid, false);
    assert.match(strictValidation.blockers.join('\n'), /does not contain live product proof/i);
  });
});

test('web_search product acceptance validator rejects read-required search-only snippets stale refs fixtures GUI projection and screenshots', async () => {
  const expectedBlocker: Record<typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_NEGATIVE_CASE_IDS[number], RegExp> = {
    'read-required-search-only': /web_read|read-required/i,
    'snippet-only': /snippet-only|source page/i,
    'stale-refs': /current run/i,
    'fixture-refs': /fixture/i,
    'gui-projection': /GUI projection/i,
    'screenshot-replay': /screenshot/i,
  };

  for (const caseId of WEB_SEARCH_PRODUCT_ACCEPTANCE_NEGATIVE_CASE_IDS) {
    await withArtifactDir(`sciforge-web-search-product-acceptance-${caseId}-`, async (artifactDir) => {
      const manifest = await buildWebSearchProductAcceptanceNegativeFixture(caseId, {
        artifactDir,
        now: () => fixedNow,
        runId: `web-search-product-negative-${caseId}`,
      });
      const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
      });

      assert.equal(validation.valid, false, `${caseId} must be rejected as product acceptance evidence`);
      assert.equal(validation.productProof, false, `${caseId} must not become product proof`);
      assert.match(validation.blockers.join('\n'), expectedBlocker[caseId], `${caseId} blocker should explain the rejection`);
    });
  }
});

test('web_search product acceptance writer accepts ordinary current-run search evidence with final source links', async () => {
  await withArtifactDir('sciforge-web-search-product-acceptance-search-only-', async (artifactDir) => {
    const liveInput = await writeLiveCurrentRunSearchOnlyArtifacts({ artifactDir });
    const manifest = await writeWebSearchProductAcceptanceFromCurrentRun(liveInput);
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(validation.productProof, true);
    assert.equal(validation.releaseEligible, true);
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.releaseEligible, true);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search');
    assert.equal((manifest.currentRun as { route?: { provider?: string; evidence?: string } }).route?.provider, 'native');
    assert.equal((manifest.currentRun as { route?: { provider?: string; evidence?: string } }).route?.evidence, 'search-only');
    const topicRelevance = manifest.currentRun.search.topicRelevance;
    const timings = manifest.currentRun.timings;
    assert.ok(topicRelevance, 'search-only proof must record topic relevance');
    assert.ok(timings, 'search-only proof must record timings');
    assert.equal(manifest.currentRun.search.sourceCount, 1);
    assert.equal(topicRelevance.matched, true);
    assert.deepEqual(topicRelevance.matchedSourceRefs, [liveInput.currentRun.search.results[0]?.ref]);
    assert.equal(timings.searchMs, 12);
    assert.equal(timings.totalMs, 12);
    assert.equal(manifest.finalAnswer.uiVisible, true);
    assert.equal(manifest.failureReason, undefined);
    assert.deepEqual(manifest.currentRun.sourcePages, []);
    assert.ok(manifest.currentRun.refs.includes(liveInput.currentRun.search.searchResultRef));
    assert.ok(manifest.currentRun.refs.includes(liveInput.currentRun.search.results[0]?.ref ?? ''));
    assert.ok(manifest.finalAnswer.sourceLinks.includes(liveInput.currentRun.search.results[0]?.url ?? ''));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(liveInput.currentRun.search.searchResultRef));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(liveInput.currentRun.search.results[0]?.ref ?? ''));
  });
});

test('web_search product acceptance validator rejects ordinary search proof below prompt source minimum', async () => {
  await withArtifactDir('sciforge-web-search-product-acceptance-search-count-negative-', async (artifactDir) => {
    const liveInput = await writeLiveCurrentRunSearchOnlyArtifacts({ artifactDir });
    const manifest = await writeWebSearchProductAcceptanceFromCurrentRun(liveInput);
    manifest.ordinaryChat.userPrompt = '搜索一下伊朗局势，至少提供5条信息，并在最终回答里列出来源链接。';
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, false, 'one current-run source must not satisfy a prompt asking for at least 5');
    assert.equal(validation.productProof, false);
    assert.match(validation.blockers.join('\n'), /至少|minimum|5|source/i);
  });
});

test('web_search product acceptance validator treats do-not-force web_read copy as ordinary search-only', async () => {
  await withArtifactDir('sciforge-web-search-product-acceptance-search-only-no-read-required-', async (artifactDir) => {
    const liveInput = await writeLiveCurrentRunSearchOnlyArtifacts({ artifactDir });
    const manifest = await writeWebSearchProductAcceptanceFromCurrentRun(liveInput);
    manifest.ordinaryChat.userPrompt = '搜索一下伊朗局势，并在最终回答里列出来源链接。除非任务明确要求读取页面正文，不要强制使用 web_read。';
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true);
    assert.equal(validation.productProof, true);
    assert.doesNotMatch(validation.blockers.join('\n'), /read-required|web_read/i);
  });
});

test('web_search product acceptance writer accepts live ordinary-chat proof for each required task class', async () => {
  for (const taskClass of WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES) {
    await withArtifactDir(`sciforge-web-search-product-acceptance-${taskClass}-`, async (artifactDir) => {
      const liveInput = await writeLiveCurrentRunArtifacts({ artifactDir, taskClass });
      const manifest = await writeWebSearchProductAcceptanceFromCurrentRun(liveInput);
      const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
        requireProductProof: true,
      });

      assert.equal(validation.valid, true, validation.blockers.join('\n'));
      assert.equal(validation.productProof, true);
      assert.equal(validation.releaseEligible, true);
      assert.equal(manifest.proofLevel, 'live-product-proof');
      assert.equal(manifest.diagnosticOnly, false);
      assert.equal(manifest.ordinaryChat.entrypoint, 'desktop-default-chat');
      assert.equal(manifest.ordinaryChat.taskClass, taskClass);
      assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');

      const source = manifest.currentRun.sourcePages[0];
      assert.ok(source, 'product proof must include a source page');
      const webReadTrace = manifest.currentRun.toolTrace.find((entry) => entry.toolName === 'web_read');
      assert.ok(webReadTrace?.refs.includes(source.sourcePageJsonRef), 'web_read trace must include source page JSON ref');
      assert.ok(webReadTrace?.refs.includes(source.pageTextRef), 'web_read trace must include page text ref');
      assert.ok(manifest.finalAnswer.verifiedSourcePageRefs.includes(source.sourcePageJsonRef));
      assert.ok(manifest.finalAnswer.sourceLinks.includes(source.finalUrl));
      assert.ok(manifest.finalAnswer.text.includes(source.finalUrl));
    });
  }
});

test('web_search product acceptance product gate rejects non-ordinary-chat and non-read-backed source links', async () => {
  await withArtifactDir('sciforge-web-search-product-acceptance-live-negative-', async (artifactDir) => {
    const liveInput = await writeLiveCurrentRunArtifacts({ artifactDir, taskClass: 'ordinary-web-lookup' });
    const liveManifest = await writeWebSearchProductAcceptanceFromCurrentRun(liveInput);

    const diagnosticEntrypoint = structuredClone(liveManifest);
    diagnosticEntrypoint.ordinaryChat.entrypoint = 'diagnostic-scaffold';

    const searchOnlyLink = structuredClone(liveManifest);
    searchOnlyLink.finalAnswer.text = 'This answer cites only the search candidate. Source: https://search.example.invalid/result';
    searchOnlyLink.finalAnswer.sourceLinks = ['https://search.example.invalid/result'];
    searchOnlyLink.finalAnswer.verifiedSourcePageRefs = [];

    const missingReadRefs = structuredClone(liveManifest);
    const readTrace = missingReadRefs.currentRun.toolTrace.find((entry) => entry.toolName === 'web_read');
    if (readTrace) readTrace.refs = [missingReadRefs.currentRun.sourcePages[0]?.pageRef ?? ''];

    const invalidTaskClass = structuredClone(liveManifest);
    invalidTaskClass.ordinaryChat.taskClass = 'fixture-demo' as typeof invalidTaskClass.ordinaryChat.taskClass;

    const cases = [
      { label: 'diagnostic entrypoint', manifest: diagnosticEntrypoint, expected: /ordinary chat|desktop-default-chat/i },
      { label: 'search-only source link', manifest: searchOnlyLink, expected: /actual read|verified source page|source link/i },
      { label: 'missing read refs', manifest: missingReadRefs, expected: /web_read trace.*source page JSON|web_read trace.*page text/i },
      { label: 'invalid task class', manifest: invalidTaskClass, expected: /task class/i },
    ];

    for (const { label, manifest, expected } of cases) {
      const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
        requireProductProof: true,
      });

      assert.equal(validation.valid, false, `${label} must not satisfy product proof`);
      assert.equal(validation.productProof, false, `${label} must be product-proof false`);
      assert.match(validation.blockers.join('\n'), expected, `${label} blocker should explain the rejection`);
    }
  });
});

async function withArtifactDir<T>(prefix: string, run: (artifactDir: string) => Promise<T>): Promise<T> {
  const artifactDir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(artifactDir);
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}

async function writeLiveCurrentRunSearchOnlyArtifacts(options: {
  artifactDir: string;
}): Promise<Parameters<typeof writeWebSearchProductAcceptanceFromCurrentRun>[0]> {
  const runId = 'ordinary-chat-search-only-current';
  const observedAt = fixedNow.toISOString();
  const query = 'Iran situation latest five sources';
  const searchResultRef = `web-search:${runId}/search/search-results.json`;
  const searchResultPath = 'search/search-results.json';
  const pageRef = `web-page:${runId}/search/result-1`;
  const finalUrl = 'https://example.com/iran-situation-current';
  const title = 'Iran situation current update';
  const finalAnswerPath = 'final-answer.md';
  const finalAnswerText = `Here is an ordinary search answer grounded in current web_search evidence. Source: ${finalUrl}`;

  await mkdir(join(options.artifactDir, 'search'), { recursive: true });
  await writeFile(join(options.artifactDir, searchResultPath), `${JSON.stringify({
    query,
    runId,
    route: { provider: 'native', evidence: 'search-only' },
    results: [{
      title,
      url: finalUrl,
      snippet: 'Current-run search result summary with enough ordinary lookup context.',
      ref: pageRef,
    }],
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(options.artifactDir, finalAnswerPath), `${finalAnswerText}\n`, 'utf8');

  return {
    artifactDir: options.artifactDir,
    observedAt,
    taskClass: 'news-latest',
    ordinaryChat: {
      entrypoint: 'desktop-default-chat',
      conversationId: `conversation-${runId}`,
      userMessageId: `message-${runId}-user`,
      assistantMessageId: `message-${runId}-assistant`,
      finalAnswerMessageRef: `chat-message:${runId}/assistant-final`,
      userPrompt: '搜索一下伊朗局势，并在最终回答里列出来源链接。',
    },
    provider: {
      kind: 'live-provider',
      live: true,
      id: 'codex.native.web_search.live',
    },
    currentRun: {
      runId,
      refs: [searchResultRef, pageRef],
      route: {
        provider: 'native',
        evidence: 'search-only',
      },
      toolTrace: [{
        toolName: 'web_search',
        runId,
        status: 'completed',
        startedAt: observedAt,
        completedAt: observedAt,
        refs: [searchResultRef, pageRef],
      }],
      search: {
        query,
        searchResultRef,
        searchResultPath,
        results: [{
          title,
          url: finalUrl,
          snippet: 'Current-run search result summary with enough ordinary lookup context.',
          ref: pageRef,
        }],
      },
      sourcePages: [],
      timings: {
        startedAt: observedAt,
        completedAt: observedAt,
        searchMs: 12,
        totalMs: 12,
      },
    },
    finalAnswer: {
      text: finalAnswerText,
      sourceLinks: [finalUrl],
      supportingRefs: [searchResultRef, pageRef],
      finalAnswerPath,
      snippetOnly: false,
      verifiedSourcePageRefs: [],
      uiVisible: true,
    },
  };
}

async function writeLiveCurrentRunArtifacts(options: {
  artifactDir: string;
  taskClass: typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES[number];
}): Promise<Parameters<typeof writeWebSearchProductAcceptanceFromCurrentRun>[0]> {
  const scenario = liveTaskScenarios[options.taskClass];
  const runId = `ordinary-chat-${options.taskClass}-current`;
  const openedAt = fixedNow.toISOString();
  const searchResultRef = `web-search:${runId}/search/search-results.json`;
  const searchResultPath = 'search/search-results.json';
  const pageRef = `web-page:${runId}/source-pages/source-1`;
  const sourcePageJsonRef = `web-source:${runId}/source-pages/source-1.source.json`;
  const sourcePageJsonPath = 'source-pages/source-1.source.json';
  const pageTextRef = `web-text:${runId}/source-pages/source-1.txt`;
  const pageTextPath = 'source-pages/source-1.txt';
  const finalAnswerPath = 'final-answer.md';
  const textSha1 = sha1(scenario.sourceText);
  const finalAnswerText = `${scenario.answer} Source: ${scenario.finalUrl}`;

  await mkdir(join(options.artifactDir, 'search'), { recursive: true });
  await mkdir(join(options.artifactDir, 'source-pages'), { recursive: true });
  await writeFile(join(options.artifactDir, searchResultPath), `${JSON.stringify({
    query: scenario.query,
    runId,
    results: [{
      title: scenario.title,
      url: scenario.finalUrl,
      snippet: 'Search discovery only; the answer must use web_read page text.',
      ref: pageRef,
    }],
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(options.artifactDir, pageTextPath), scenario.sourceText, 'utf8');
  await writeFile(join(options.artifactDir, sourcePageJsonPath), `${JSON.stringify({
    schemaVersion: WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION,
    runId,
    pageRef,
    pageTextRef,
    textSha1,
    textChars: scenario.sourceText.length,
    openedAt,
    finalUrl: scenario.finalUrl,
    title: scenario.title,
    sourceTool: 'web_read',
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(options.artifactDir, finalAnswerPath), `${finalAnswerText}\n`, 'utf8');

  return {
    artifactDir: options.artifactDir,
    observedAt: openedAt,
    taskClass: options.taskClass,
    ordinaryChat: {
      entrypoint: 'desktop-default-chat',
      conversationId: `conversation-${runId}`,
      userMessageId: `message-${runId}-user`,
      assistantMessageId: `message-${runId}-assistant`,
      finalAnswerMessageRef: `chat-message:${runId}/assistant-final`,
      userPrompt: scenario.prompt,
    },
    provider: {
      kind: 'live-provider',
      live: true,
      id: 'sciforge.web_search.web_read.live',
    },
    currentRun: {
      runId,
      refs: [searchResultRef, pageRef, sourcePageJsonRef, pageTextRef],
      route: {
        provider: 'fallback',
        evidence: 'search-read',
      },
      toolTrace: [{
        toolName: 'web_search',
        runId,
        status: 'completed',
        startedAt: openedAt,
        completedAt: openedAt,
        refs: [searchResultRef],
      }, {
        toolName: 'web_read',
        runId,
        status: 'completed',
        startedAt: openedAt,
        completedAt: openedAt,
        refs: [pageRef, sourcePageJsonRef, pageTextRef],
      }],
      search: {
        query: scenario.query,
        searchResultRef,
        searchResultPath,
        results: [{
          title: scenario.title,
          url: scenario.finalUrl,
          snippet: 'Search discovery only; the answer must use web_read page text.',
          ref: pageRef,
        }],
      },
      sourcePages: [{
        pageRef,
        sourcePageJsonRef,
        sourcePageJsonPath,
        pageTextRef,
        pageTextPath,
        textSha1,
        textChars: scenario.sourceText.length,
        openedAt,
        finalUrl: scenario.finalUrl,
        title: scenario.title,
        httpStatus: 200,
        readStatus: 'read',
        sourceTool: 'web_read',
      }],
    },
    finalAnswer: {
      text: finalAnswerText,
      sourceLinks: [scenario.finalUrl],
      supportingRefs: [sourcePageJsonRef, pageTextRef],
      finalAnswerPath,
      snippetOnly: false,
      verifiedSourcePageRefs: [sourcePageJsonRef],
    },
  };
}

const liveTaskScenarios: Record<typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES[number], {
  prompt: string;
  query: string;
  title: string;
  finalUrl: string;
  sourceText: string;
  answer: string;
}> = {
  'news-latest': {
    prompt: 'What is the latest public status of the OpenAI API platform changelog?',
    query: 'latest OpenAI API platform changelog June 2026',
    title: 'OpenAI API platform changelog',
    finalUrl: 'https://platform.openai.com/docs/changelog',
    sourceText: [
      'OpenAI API platform changelog current updates.',
      'The page contains dated release notes and enough text for a news/latest answer.',
      'The ordinary chat run must cite this source after web_read, not the search snippet.',
    ].join('\n'),
    answer: 'The latest status should be grounded in the read changelog page.',
  },
  'ordinary-web-lookup': {
    prompt: 'Find the official Python about page and summarize what Python is.',
    query: 'official Python about page what is Python',
    title: 'About Python',
    finalUrl: 'https://www.python.org/about/',
    sourceText: [
      'Python is a programming language used for web, software, mathematics, and system scripting.',
      'The ordinary lookup source has enough page text to support a concise final answer.',
    ].join('\n'),
    answer: 'Python is a general-purpose programming language according to the read source.',
  },
  'academic-technical-docs': {
    prompt: 'Look up the TypeScript handbook docs and summarize what generics are for.',
    query: 'TypeScript handbook generics documentation',
    title: 'TypeScript Handbook Generics',
    finalUrl: 'https://www.typescriptlang.org/docs/handbook/2/generics.html',
    sourceText: [
      'The TypeScript handbook explains generics as a way to create reusable components.',
      'This technical documentation source is read through web_read and persisted as page text.',
    ].join('\n'),
    answer: 'Generics let TypeScript APIs stay reusable while preserving type information.',
  },
};

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
