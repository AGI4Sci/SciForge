import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES,
  runWebSearchProductOrdinaryChatAcceptance,
  validateWebSearchProductAcceptanceManifest,
} from './helpers/web-search-product-acceptance-fixtures.js';
import {
  runDesktopWebSearchProductAcceptance,
} from '../../tools/desktop-web-search-product-acceptance.js';

const fixedNow = new Date('2026-06-10T08:00:00.000Z');

test('web_search product proof CLI documents the real ordinary-chat entrypoint', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    'tools/web-search-product-acceptance.ts',
    '--help',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: .*web-search-product-acceptance/i);
  assert.match(result.stdout, /ordinary-chat/i);
  assert.match(result.stdout, /live product proof/i);
  assert.match(result.stdout, /web_search evidence plus final source links/i);
  assert.match(result.stdout, /Read-required prompts still fail closed/i);
  assert.match(result.stdout, /config\.local\.json/i);
  assert.match(result.stdout, /Model Router/i);
  assert.match(result.stdout, /--route native\|fallback/i);
  assert.match(result.stdout, /SCIFORGE_WEB_SEARCH_MODE/i);
});

test('desktop web_search product proof CLI documents Electron UI WebSocket evidence', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    'tools/desktop-web-search-product-acceptance.ts',
    '--help',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Electron desktop ordinary-chat product proof/i);
  assert.match(result.stdout, /WebSocket current-run frames/i);
  assert.match(result.stdout, /web_search evidence plus final source links/i);
  assert.match(result.stdout, /visible source link/i);
  assert.match(result.stdout, /npm run desktop:build/i);
  assert.match(result.stdout, /--route native\|fallback/i);
  assert.match(result.stdout, /SCIFORGE_WEB_SEARCH_MODE/i);
});

test('desktop web_search product proof wrapper fails closed when built Electron artifacts are missing', async () => {
  const originalCwd = process.cwd();
  const emptyProjectRoot = await mkdtemp(join(tmpdir(), 'sciforge-desktop-web-search-empty-'));
  const outDir = join(emptyProjectRoot, 'out');
  try {
    process.chdir(emptyProjectRoot);
    const sidecar = await runDesktopWebSearchProductAcceptance({
      outDir,
      workspacePath: join(emptyProjectRoot, 'workspace'),
      taskClass: 'ordinary-web-lookup',
      commandText: '普通聊天入口：搜索并读取一个公开来源。',
      timeoutMs: 25,
      json: true,
    }, {});

    assert.equal(sidecar.status, 'blocked');
    assert.equal(sidecar.productProof, false);
    assert.equal(sidecar.releaseEligible, false);
    assert.equal(sidecar.desktop.launchedElectron, false);
    assert.equal(sidecar.uiWebSocket.observed, false);
    assert.match(sidecar.blockedReason ?? '', /desktop:build|built desktop artifacts/i);
    const persistedSidecar = JSON.parse(await readFile(join(outDir, 'desktop-sidecar.json'), 'utf8')) as typeof sidecar;
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as { productProof?: boolean; releaseEligible?: boolean; blockedReason?: string };
    assert.equal(persistedSidecar.status, 'blocked');
    assert.equal(manifest.productProof, false);
    assert.equal(manifest.releaseEligible, false);
    assert.match(manifest.blockedReason ?? '', /desktop:build|built desktop artifacts/i);
  } finally {
    process.chdir(originalCwd);
    await rm(emptyProjectRoot, { recursive: true, force: true });
  }
});

test('web_search product proof runner writes live ordinary-chat current-run search-read evidence from app-server events', async () => {
  await withWorkspace('sciforge-web-search-product-runner-pass-', async ({ workspacePath, artifactDir }) => {
    const runId = 'ordinary-chat-product-proof-current';
    const source = await writeWebRuntimeArtifacts({
      workspacePath,
      runId,
      query: 'OpenAI API changelog latest',
      finalUrl: 'https://developers.openai.com/api/docs/changelog',
      title: 'OpenAI API changelog',
      pageText: 'OpenAI API changelog current page text read by web_read for product proof.',
      openedAt: fixedNow.toISOString(),
    });
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'news-latest',
      commandText: '普通聊天入口：搜索并读取 OpenAI API changelog，回答时列出来源链接。',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-product-proof',
        turnId: 'turn-product-proof',
        events: [
          toolCompleted('web_search', {
            refs: [source.searchResultRef, source.pageRef],
            data: {
              query: 'OpenAI API changelog latest',
              resultSetRef: source.searchResultRef,
              results: [{
                title: source.title,
                url: source.finalUrl,
                snippet: 'Candidate snippet that must be read.',
                resourceRef: source.pageRef,
              }],
            },
          }),
          toolCompleted('web_read', {
            refs: [source.sourcePageJsonRef, source.pageTextRef],
            data: {
              source: {
                requestedUrl: source.finalUrl,
                finalUrl: source.finalUrl,
                title: source.title,
                openedAt: source.openedAt,
                textSha1: source.textSha1,
                sourceRef: source.sourcePageJsonRef,
                pageTextRef: source.pageTextRef,
              },
              content: {
                preview: source.pageText,
                textRef: source.pageTextRef,
                textCharCount: source.pageText.length,
              },
            },
          }),
          assistantFinal(`已读取 OpenAI API changelog 并基于 web_read 页面文本回答。来源：${source.finalUrl}`, [source.sourcePageJsonRef, source.pageTextRef]),
        ],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.status, 'shape-valid');
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.releaseEligible, true);
    assert.equal(manifest.diagnosticOnly, false);
    assert.equal(manifest.ordinaryChat.entrypoint, 'desktop-default-chat');
    assert.equal(manifest.ordinaryChat.conversationId, 'thread-product-proof');
    assert.equal(manifest.ordinaryChat.assistantMessageId, 'turn-product-proof');
    assert.equal(manifest.currentRun.runId, runId);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');
    assert.ok(manifest.currentRun.refs.includes(source.searchResultRef));
    assert.ok(manifest.currentRun.refs.includes(source.pageRef));
    assert.ok(manifest.currentRun.refs.includes(source.sourcePageJsonRef));
    assert.ok(manifest.currentRun.refs.includes(source.pageTextRef));
    assert.equal(manifest.currentRun.sourcePages[0]?.textSha1, source.textSha1);
    assert.equal(manifest.currentRun.sourcePages[0]?.openedAt, source.openedAt);
    assert.equal(manifest.currentRun.sourcePages[0]?.finalUrl, source.finalUrl);
    assert.ok(manifest.finalAnswer.sourceLinks.includes(source.finalUrl));
    assert.ok(manifest.finalAnswer.text.includes(source.finalUrl));
    assert.ok(manifest.finalAnswer.verifiedSourcePageRefs.includes(source.sourcePageJsonRef));

    const persisted = JSON.parse(await readFile(join(artifactDir, 'manifest.json'), 'utf8')) as typeof manifest;
    assert.equal(persisted.productProof, true);
  });
});

test('web_search product proof runner writes live ordinary-chat current-run search-only evidence from app-server events', async () => {
  await withWorkspace('sciforge-web-search-product-runner-search-only-', async ({ workspacePath, artifactDir }) => {
    const runId = 'ordinary-chat-search-only-product-proof-current';
    const query = 'Iran situation latest five sources';
    const searchResultRef = `web-search:${runId}/search/search-results`;
    const searchResults = Array.from({ length: 5 }, (_, index) => ({
      title: `Iran situation current update ${index + 1}`,
      url: `https://example.com/iran-situation-current-${index + 1}`,
      snippet: `Current-run web_search result ${index + 1} for an ordinary Iran situation lookup.`,
      resourceRef: `web-page:${runId}/search/result-${index + 1}`,
    }));
    const finalAnswerText = [
      '基于当前 web_search 结果给出摘要。',
      ...searchResults.map((result, index) => `Source ${index + 1}: ${result.url}`),
    ].join('\n');
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'news-latest',
      commandText: '搜索一下伊朗局势，至少提供5条信息，并在最终回答里列出来源链接。',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-product-proof-search-only',
        turnId: 'turn-product-proof-search-only',
        events: [
          toolCompleted('web_search', {
            refs: [searchResultRef, ...searchResults.map((result) => result.resourceRef)],
            route: 'native',
            provider: 'codex-native-web-search',
            timings: { totalMs: 37 },
            data: {
              query,
              resultSetRef: searchResultRef,
              route: 'native',
              results: searchResults,
            },
          }),
          assistantFinal(finalAnswerText, [searchResultRef, ...searchResults.map((result) => result.resourceRef)]),
        ],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.releaseEligible, true);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search');
    assert.equal(manifest.currentRun.route.provider, 'native');
    assert.equal(manifest.currentRun.route.evidence, 'search-only');
    const topicRelevance = manifest.currentRun.search.topicRelevance;
    const timings = manifest.currentRun.timings;
    assert.ok(topicRelevance, 'search-only proof must record topic relevance');
    assert.ok(timings, 'search-only proof must record timings');
    assert.equal(manifest.currentRun.search.sourceCount, 5);
    assert.equal(topicRelevance.matched, true);
    assert.equal(topicRelevance.matchedSourceRefs.length, 5);
    assert.equal(timings.searchMs, 37);
    assert.equal(timings.totalMs, 37);
    assert.equal(manifest.finalAnswer.uiVisible, true);
    assert.equal(manifest.failureReason, undefined);
    assert.deepEqual(manifest.currentRun.sourcePages, []);
    assert.ok(manifest.currentRun.refs.includes(searchResultRef));
    assert.ok(manifest.currentRun.refs.includes(searchResults[0]?.resourceRef ?? ''));
    assert.equal(manifest.finalAnswer.sourceLinks.length, 5);
    assert.ok(manifest.finalAnswer.sourceLinks.includes(searchResults[0]?.url ?? ''));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(searchResultRef));
    assert.ok(manifest.finalAnswer.supportingRefs.includes(searchResults[0]?.resourceRef ?? ''));
  });
});

test('web_search product proof runner extracts Codex response_item web_search outputs', async () => {
  await withWorkspace('sciforge-web-search-product-runner-response-item-', async ({ workspacePath, artifactDir }) => {
    const runId = 'ordinary-chat-response-item-product-proof-current';
    const query = 'Iran situation latest five sources';
    const searchResultRef = `web-search:${runId}/search/search-results`;
    const searchResults = Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      title: `Iran situation response item update ${index + 1}`,
      url: `https://example.com/iran-response-item-${index + 1}`,
      snippet: `Current-run response_item web_search result ${index + 1}.`,
      resourceRef: `web-page:${runId}/search/result-${index + 1}`,
      provider: 'searxng',
    }));
    const finalAnswerText = [
      '基于当前 web_search 结果给出摘要。',
      ...searchResults.map((result, index) => `Source ${index + 1}: ${result.url}`),
    ].join('\n');
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'news-latest',
      commandText: '搜索一下伊朗局势，至少提供5条信息，并在最终回答里列出来源链接。',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-response-item-search-only',
        turnId: 'turn-response-item-search-only',
        events: [{
          type: 'response_item',
          timestamp: fixedNow.toISOString(),
          payload: {
            type: 'function_call_output',
            output: JSON.stringify({
              moduleId: 'web',
              ok: true,
              value: {
                schemaVersion: 'sciforge.web-runtime.result.v1',
                ok: true,
                status: 'completed',
                tool: 'web_search',
                provider: 'searxng',
                refs: [searchResultRef, ...searchResults.map((result) => result.resourceRef)],
                timings: { totalMs: 25, providerMs: 20, persistMs: 1, parseMs: 1 },
                data: {
                  query,
                  resultSetRef: searchResultRef,
                  route: 'fallback',
                  results: searchResults,
                },
              },
            }),
          },
        }, {
          type: 'response_item',
          timestamp: fixedNow.toISOString(),
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: finalAnswerText }],
          },
        }],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.currentRun.route.provider, 'fallback');
    assert.equal(manifest.currentRun.search.results.length, 5);
    assert.ok(manifest.finalAnswer.supportingRefs.includes(searchResults[0]!.resourceRef));
  });
});

test('web_search product proof runner extracts app-server item completed dynamic tool outputs', async () => {
  await withWorkspace('sciforge-web-search-product-runner-item-completed-', async ({ workspacePath, artifactDir }) => {
    const runId = 'ordinary-chat-item-completed-product-proof-current';
    const query = 'Iran situation latest five sources';
    const searchResultRef = `web-search:${runId}/search/search-results`;
    const searchResults = Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      title: `Iran situation item completed update ${index + 1}`,
      url: `https://example.com/iran-item-completed-${index + 1}`,
      snippet: `Current-run item/completed web_search result ${index + 1}.`,
      resourceRef: `web-page:${runId}/search/result-${index + 1}`,
      provider: 'searxng',
    }));
    const finalAnswerText = [
      '基于当前 web_search 结果给出摘要。',
      ...searchResults.map((result, index) => `Source ${index + 1}: ${result.url}`),
    ].join('\n');
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'news-latest',
      commandText: '搜索一下伊朗局势，至少提供5条信息，并在最终回答里列出来源链接。',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-item-completed-search-only',
        turnId: 'turn-item-completed-search-only',
        events: [{
          method: 'item/completed',
          params: {
            item: {
              type: 'dynamicToolCall',
              tool: 'web_search',
              status: 'completed',
              contentItems: [{
                type: 'inputText',
                text: JSON.stringify({
                  moduleId: 'web',
                  ok: true,
                  value: {
                    schemaVersion: 'sciforge.web-runtime.result.v1',
                    ok: true,
                    status: 'completed',
                    tool: 'web_search',
                    provider: 'searxng',
                    refs: [searchResultRef, ...searchResults.map((result) => result.resourceRef)],
                    timings: { totalMs: 31, providerMs: 25, persistMs: 1, parseMs: 1 },
                    data: {
                      query,
                      resultSetRef: searchResultRef,
                      route: 'fallback',
                      results: searchResults,
                    },
                  },
                }),
              }],
            },
          },
        }, assistantFinal(finalAnswerText, [searchResultRef, ...searchResults.map((result) => result.resourceRef)])],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.currentRun.route.provider, 'fallback');
    assert.equal(manifest.currentRun.search.results.length, 5);
  });
});

test('web_search product proof runner extracts desktop normalized WebSocket tool completions', async () => {
  await withWorkspace('sciforge-web-search-product-desktop-normalized-', async ({ workspacePath, artifactDir }) => {
    const runId = 'desktop-normalized-current';
    const source = await writeWebRuntimeArtifacts({
      workspacePath,
      runId,
      query: 'OpenAI API changelog latest',
      finalUrl: 'https://developers.openai.com/api/docs/changelog',
      title: 'OpenAI API changelog',
      pageText: 'Desktop normalized WebSocket page text read by web_read for product proof.',
      openedAt: fixedNow.toISOString(),
    });
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'ordinary-web-lookup',
      commandText: 'desktop normalized websocket product proof',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-desktop-normalized',
        turnId: 'turn-desktop-normalized',
        events: [
          normalizedToolCompleted('web_search', {
            refs: [source.searchResultRef, source.pageRef],
            data: {
              query: source.query,
              resultSetRef: source.searchResultRef,
              results: [{
                title: source.title,
                url: source.finalUrl,
                snippet: 'Candidate snippet that must be read.',
                resourceRef: source.pageRef,
              }],
            },
          }),
          normalizedToolCompleted('web_read', {
            refs: [source.sourcePageJsonRef, source.pageTextRef],
            data: {
              source: {
                requestedUrl: source.finalUrl,
                finalUrl: source.finalUrl,
                title: source.title,
                openedAt: source.openedAt,
                textSha1: source.textSha1,
                sourceRef: source.sourcePageJsonRef,
                pageTextRef: source.pageTextRef,
              },
              content: {
                preview: source.pageText,
                textRef: source.pageTextRef,
                textCharCount: source.pageText.length,
              },
            },
          }),
          assistantFinal(`Desktop normalized proof cites ${source.finalUrl} and web_read refs.`, [source.sourcePageJsonRef, source.pageTextRef]),
        ],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');
    assert.ok(manifest.currentRun.refs.includes(source.searchResultRef));
    assert.ok(manifest.currentRun.refs.includes(source.sourcePageJsonRef));
    assert.ok(manifest.finalAnswer.verifiedSourcePageRefs.includes(source.sourcePageJsonRef));
  });
});

test('web_search product proof runner extracts Agent Host auto-read as web_read evidence', async () => {
  await withWorkspace('sciforge-web-search-product-auto-read-', async ({ workspacePath, artifactDir }) => {
    const runId = 'desktop-auto-read-current';
    const source = await writeWebRuntimeArtifacts({
      workspacePath,
      runId,
      query: 'OpenAI API models documentation',
      finalUrl: 'https://platform.openai.com/docs/models',
      title: 'OpenAI API models',
      pageText: 'Agent Host auto-read materialized this OpenAI models page text via web_read.',
      openedAt: fixedNow.toISOString(),
    });
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'ordinary-web-lookup',
      commandText: 'desktop auto-read product proof',
      commandId: runId,
      attemptId: `${runId}-attempt-1`,
      now: () => fixedNow,
      appServerClient: appServerClientWithEvents({
        threadId: 'thread-desktop-auto-read',
        turnId: 'turn-desktop-auto-read',
        events: [
          normalizedToolCompleted('web_search', {
            refs: [source.searchResultRef, source.pageRef],
            data: {
              query: source.query,
              resultSetRef: source.searchResultRef,
              results: [{
                title: source.title,
                url: source.finalUrl,
                snippet: 'Candidate snippet that must be read.',
                resourceRef: source.pageRef,
              }],
            },
          }),
          normalizedAutoReadCompleted(source),
          assistantFinal(`Auto-read proof cites ${source.finalUrl} and web_read refs.`, [source.sourcePageJsonRef, source.pageTextRef]),
        ],
      }),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(manifest.productProof, true);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');
    assert.ok(manifest.currentRun.toolTrace[1]?.refs.includes(source.sourcePageJsonRef));
    assert.equal(manifest.currentRun.sourcePages[0]?.pageRef, source.pageRef);
    assert.ok(manifest.finalAnswer.verifiedSourcePageRefs.includes(source.sourcePageJsonRef));
  });
});

test('web_search product proof runner supports every required ordinary-chat task class', async () => {
  for (const taskClass of WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES) {
    await withWorkspace(`sciforge-web-search-product-runner-${taskClass}-`, async ({ workspacePath, artifactDir }) => {
      const runId = `ordinary-chat-${taskClass}-current`;
      const source = await writeWebRuntimeArtifacts({
        workspacePath,
        runId,
        query: `${taskClass} current source`,
        finalUrl: `https://example.com/${taskClass}`,
        title: `${taskClass} source`,
        pageText: `${taskClass} page text read by web_read for product proof.`,
        openedAt: fixedNow.toISOString(),
      });
      const manifest = await runWebSearchProductOrdinaryChatAcceptance({
        workspacePath,
        artifactDir,
        taskClass,
        commandText: `普通聊天入口 ${taskClass} product proof`,
        commandId: runId,
        attemptId: `${runId}-attempt-1`,
        now: () => fixedNow,
        appServerClient: appServerClientWithEvents({
          threadId: `thread-${taskClass}`,
          turnId: `turn-${taskClass}`,
          events: [
            toolCompleted('web_search', {
              refs: [source.searchResultRef, source.pageRef],
              data: {
                query: source.query,
                resultSetRef: source.searchResultRef,
                results: [{ title: source.title, url: source.finalUrl, resourceRef: source.pageRef }],
              },
            }),
            toolCompleted('web_read', {
              refs: [source.sourcePageJsonRef, source.pageTextRef],
              data: {
                source: {
                  finalUrl: source.finalUrl,
                  title: source.title,
                  openedAt: source.openedAt,
                  textSha1: source.textSha1,
                  sourceRef: source.sourcePageJsonRef,
                  pageTextRef: source.pageTextRef,
                },
                content: { preview: source.pageText, textRef: source.pageTextRef, textCharCount: source.pageText.length },
              },
            }),
            assistantFinal(`基于读取来源回答。Source: ${source.finalUrl}`, [source.sourcePageJsonRef, source.pageTextRef]),
          ],
        }),
      });
      const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
        requireProductProof: true,
      });

      assert.equal(validation.valid, true, validation.blockers.join('\n'));
      assert.equal(manifest.ordinaryChat.taskClass, taskClass);
      assert.equal(manifest.productProof, true);
    });
  }
});

test('web_search product proof runner blocks external app-server/provider failures instead of passing', async () => {
  await withWorkspace('sciforge-web-search-product-runner-blocked-', async ({ workspacePath, artifactDir }) => {
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'ordinary-web-lookup',
      commandText: '普通聊天入口：搜索并读取一个公开来源。',
      commandId: 'ordinary-chat-provider-blocked',
      attemptId: 'ordinary-chat-provider-blocked-attempt-1',
      now: () => fixedNow,
      appServerClient: {
        async startTurn() {
          throw new Error('provider preflight is not ready');
        },
      },
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.productProof, false);
    assert.equal(manifest.releaseEligible, false);
    assert.match(manifest.blockedReason ?? '', /provider preflight is not ready/);
    assert.match(manifest.userRecoveryPath ?? '', /rerun/i);
    assert.equal(validation.valid, false);
    assert.equal(validation.productProof, false);
    assert.match(validation.blockers.join('\n'), /live product proof|web_read|source page/i);
  });
});

test('web_search product proof runner blocks hung ordinary-chat event streams before global timeout', { timeout: 1000 }, async () => {
  await withWorkspace('sciforge-web-search-product-runner-timeout-', async ({ workspacePath, artifactDir }) => {
    const manifest = await runWebSearchProductOrdinaryChatAcceptance({
      workspacePath,
      artifactDir,
      taskClass: 'ordinary-web-lookup',
      commandText: '普通聊天入口：搜索并读取一个公开来源。',
      commandId: 'ordinary-chat-timeout',
      attemptId: 'ordinary-chat-timeout-attempt-1',
      now: () => fixedNow,
      timeoutMs: 25,
      appServerClient: {
        async startTurn() {
          return {
            threadId: 'thread-timeout',
            turnId: 'turn-timeout',
            provider: 'live-provider-under-test',
            model: 'live-model-under-test',
            profile: 'sciforge-runtime-default',
            workspacePath,
            events: neverCompletes(),
          };
        },
      },
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.productProof, false);
    assert.match(manifest.blockedReason ?? '', /timed out/i);
    assert.equal(manifest.runner?.appServerEventCount, 0);
  });
});

test('web_search product proof runner blocks read-required search-only missing-artifact and stale-ref ordinary-chat evidence', async () => {
  await withWorkspace('sciforge-web-search-product-runner-negative-', async ({ workspacePath, artifactDir }) => {
    const runId = 'ordinary-chat-negative-current';
    const source = await writeWebRuntimeArtifacts({
      workspacePath,
      runId,
      query: 'negative search only',
      finalUrl: 'https://example.com/negative',
      title: 'Negative source',
      pageText: 'Negative source text.',
      openedAt: fixedNow.toISOString(),
    });
    const cases = [{
      label: 'read-required-search-only',
      commandText: '普通聊天入口：使用 web_search 后必须用 web_read 读取一个公开来源。',
      events: [
        toolCompleted('web_search', { refs: [source.searchResultRef, source.pageRef], data: { query: source.query, resultSetRef: source.searchResultRef } }),
        assistantFinal('Search snippet only answer.', [source.searchResultRef]),
      ],
      expected: /web_read|source page/i,
    }, {
      label: 'missing artifact',
      events: [
        toolCompleted('web_search', { refs: [source.searchResultRef, source.pageRef], data: { query: source.query, resultSetRef: source.searchResultRef, results: [{ title: source.title, url: source.finalUrl, resourceRef: source.pageRef }] } }),
        toolCompleted('web_read', { refs: ['web-source:missing-artifact', 'web-text:missing-artifact'], data: { source: { finalUrl: source.finalUrl, sourceRef: 'web-source:missing-artifact', pageTextRef: 'web-text:missing-artifact', openedAt: source.openedAt, textSha1: source.textSha1 } } }),
        assistantFinal(`Source: ${source.finalUrl}`, ['web-source:missing-artifact', 'web-text:missing-artifact']),
      ],
      expected: /source artifact|page text/i,
    }, {
      label: 'stale refs',
      events: [
        toolCompleted('web_search', { refs: [source.searchResultRef, source.pageRef], data: { query: source.query, resultSetRef: source.searchResultRef, results: [{ title: source.title, url: source.finalUrl, resourceRef: source.pageRef }] } }),
        toolCompleted('web_read', { refs: [source.sourcePageJsonRef.replace(runId, 'previous-run'), source.pageTextRef.replace(runId, 'previous-run')], data: { source: { finalUrl: source.finalUrl, sourceRef: source.sourcePageJsonRef.replace(runId, 'previous-run'), pageTextRef: source.pageTextRef.replace(runId, 'previous-run'), openedAt: source.openedAt, textSha1: source.textSha1 } } }),
        assistantFinal(`Source: ${source.finalUrl}`, [source.sourcePageJsonRef.replace(runId, 'previous-run'), source.pageTextRef.replace(runId, 'previous-run')]),
      ],
      expected: /current run|source artifact|page text/i,
    }, {
      label: 'topic mismatch',
      commandText: '普通聊天入口：搜索并读取 OpenAI API models documentation。',
      events: [
        toolCompleted('web_search', { refs: [source.searchResultRef, source.pageRef], data: { query: 'OpenAI API models documentation', resultSetRef: source.searchResultRef, results: [{ title: source.title, url: source.finalUrl, resourceRef: source.pageRef }] } }),
        toolCompleted('web_read', { refs: [source.sourcePageJsonRef, source.pageTextRef], data: { source: { finalUrl: source.finalUrl, title: source.title, sourceRef: source.sourcePageJsonRef, pageTextRef: source.pageTextRef, openedAt: source.openedAt, textSha1: source.textSha1 } } }),
        assistantFinal(`Source: ${source.finalUrl}`, [source.sourcePageJsonRef, source.pageTextRef]),
      ],
      expected: /source relevance|topic signal/i,
    }];

    for (const item of cases) {
      const caseDir = join(artifactDir, item.label);
      const manifest = await runWebSearchProductOrdinaryChatAcceptance({
        workspacePath,
        artifactDir: caseDir,
        taskClass: 'ordinary-web-lookup',
        commandText: item.commandText ?? `普通聊天入口 negative ${item.label}`,
        commandId: runId,
        attemptId: `${runId}-${item.label}`,
        now: () => fixedNow,
        appServerClient: appServerClientWithEvents({
          threadId: `thread-${item.label}`,
          turnId: `turn-${item.label}`,
          events: item.events,
        }),
      });

      const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
        artifactRoot: caseDir,
        now: fixedNow,
        requireProductProof: true,
      });
      assert.equal(manifest.status, 'blocked', `${item.label} must block`);
      assert.equal(manifest.productProof, false, `${item.label} must not claim product proof`);
      assert.equal(validation.valid, false, `${item.label} validation must fail`);
      assert.match([manifest.blockedReason, ...validation.blockers].join('\n'), item.expected, item.label);
    }
  });
});

async function withWorkspace<T>(
  prefix: string,
  run: (input: { workspacePath: string; artifactDir: string }) => Promise<T>,
): Promise<T> {
  const workspacePath = await mkdtemp(join(tmpdir(), `${prefix}workspace-`));
  const artifactDir = join(workspacePath, 'product-proof');
  try {
    return await run({ workspacePath, artifactDir });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

function appServerClientWithEvents(input: {
  threadId: string;
  turnId: string;
  events: unknown[];
}) {
  return {
    async startTurn() {
      return {
        threadId: input.threadId,
        turnId: input.turnId,
        provider: 'live-provider-under-test',
        model: 'live-model-under-test',
        profile: 'sciforge-runtime-default',
        workspacePath: '/redacted/workspace',
        events: asyncIterable(input.events),
      };
    },
  };
}

async function* asyncIterable(values: unknown[]): AsyncIterable<unknown> {
  for (const value of values) yield value;
}

async function* neverCompletes(): AsyncIterable<unknown> {
  await new Promise(() => undefined);
}

function toolCompleted(tool: 'web_search' | 'web_read', value: Record<string, unknown>) {
  return {
    method: 'item/tool/completed',
    params: {
      tool,
      result: {
        schemaVersion: 'sciforge.web-runtime.result.v1',
        ok: true,
        status: 'completed',
        tool,
        provider: 'live-provider-under-test',
        timings: { totalMs: 1 },
        warnings: [],
        diagnostics: [],
        ...value,
      },
    },
  };
}

function normalizedToolCompleted(tool: 'web_search' | 'web_read', value: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    schemaVersion: 'sciforge.web-runtime.result.v1',
    ok: true,
    status: 'completed',
    tool,
    provider: 'live-provider-under-test',
    timings: { totalMs: 1 },
    warnings: [],
    diagnostics: [],
    ...value,
  };
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'tool_completed',
    timestamp: fixedNow.toISOString(),
    toolName: tool,
    status: 'completed',
    refs: Array.isArray(result.refs) ? result.refs : [],
    resultSummary: JSON.stringify(result),
    raw: {
      method: 'item/completed',
      params: {
        item: {
          type: 'dynamicToolCall',
          tool,
          status: 'completed',
          contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
          success: true,
          durationMs: 1,
        },
      },
    },
  };
}

function normalizedAutoReadCompleted(source: Awaited<ReturnType<typeof writeWebRuntimeArtifacts>>) {
  const readResult = {
    moduleId: 'web',
    ok: true,
    value: {
      schemaVersion: 'sciforge.web-runtime.result.v1',
      ok: true,
      status: 'completed',
      tool: 'web_read',
      provider: 'live-provider-under-test',
      refs: [source.sourcePageJsonRef, source.pageTextRef],
      timings: { totalMs: 1 },
      warnings: [],
      diagnostics: [],
      data: {
        source: {
          requestedUrl: source.finalUrl,
          finalUrl: source.finalUrl,
          title: source.title,
          openedAt: source.openedAt,
          textSha1: source.textSha1,
          sourceRef: source.sourcePageJsonRef,
          pageTextRef: source.pageTextRef,
        },
        content: {
          preview: source.pageText,
          textRef: source.pageTextRef,
          textCharCount: source.pageText.length,
        },
      },
    },
    refs: [source.sourcePageJsonRef, source.pageTextRef],
    schemaVersion: 'sciforge.module-contract.v1',
  };
  const result = {
    schemaVersion: 'sciforge.agent-host.browser-auto-read-result.v1',
    ok: true,
    status: 'completed',
    moduleId: 'browser',
    attemptedIntent: 'browser.search',
    dispatchedIntent: 'browser.read',
    dispatchedTool: 'web_read',
    reason: 'Repeated Web discovery without source evidence was repaired by Agent Host dispatching web_read.',
    candidateResource: {
      ref: source.pageRef,
      kind: 'web_page',
      status: 'discovered',
      originTool: 'web.search',
      title: source.title,
      resourceRef: source.pageRef,
      url: source.finalUrl,
      readArguments: { resourceRef: source.pageRef },
    },
    result: readResult,
    refs: [source.pageRef, source.sourcePageJsonRef, source.pageTextRef],
  };
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'tool_completed',
    timestamp: fixedNow.toISOString(),
    toolName: 'web_search',
    status: 'completed',
    refs: result.refs,
    resultSummary: JSON.stringify(result),
    raw: {
      method: 'item/completed',
      params: {
        item: {
          type: 'dynamicToolCall',
          tool: 'web_search',
          status: 'completed',
          contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
          success: true,
          durationMs: 1,
        },
      },
    },
  };
}

function assistantFinal(text: string, evidenceRefs: string[]) {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'message',
    status: 'completed',
    message: text,
    text,
    evidenceRefs,
  };
}

async function writeWebRuntimeArtifacts(input: {
  workspacePath: string;
  runId: string;
  query: string;
  finalUrl: string;
  title: string;
  pageText: string;
  openedAt: string;
}) {
  const base = join(input.workspacePath, '.sciforge', 'web-search');
  await mkdir(join(base, 'searches'), { recursive: true });
  await mkdir(join(base, 'pages'), { recursive: true });
  await mkdir(join(base, 'sources'), { recursive: true });
  await mkdir(join(base, 'texts'), { recursive: true });
  const textSha1 = sha1(input.pageText);
  const searchResultRef = `web-search:${input.runId}/search/search-results`;
  const pageRef = `web-page:${input.runId}/source-pages/source-1`;
  const sourcePageJsonRef = `web-source:${input.runId}/source-pages/source-1.source`;
  const pageTextRef = `web-text:${input.runId}/source-pages/source-1`;
  const searchPath = join(base, 'searches', `${searchResultRef.slice('web-search:'.length)}.json`);
  const pagePath = join(base, 'pages', `${pageRef.slice('web-page:'.length)}.json`);
  const sourcePath = join(base, 'sources', `${sourcePageJsonRef.slice('web-source:'.length)}.json`);
  const textPath = join(base, 'texts', `${pageTextRef.slice('web-text:'.length)}.md`);
  await Promise.all([
    mkdir(dirname(searchPath), { recursive: true }),
    mkdir(dirname(pagePath), { recursive: true }),
    mkdir(dirname(sourcePath), { recursive: true }),
    mkdir(dirname(textPath), { recursive: true }),
  ]);
  await writeFile(searchPath, JSON.stringify({
    schemaVersion: 'sciforge.web-runtime.result.v1',
    ref: searchResultRef,
    query: input.query,
    provider: 'live-provider-under-test',
    discoveredAt: input.openedAt,
    results: [{ title: input.title, url: input.finalUrl, resourceRef: pageRef }],
  }, null, 2), 'utf8');
  await writeFile(pagePath, JSON.stringify({
    schemaVersion: 'sciforge.web-runtime.result.v1',
    ref: pageRef,
    searchRef: searchResultRef,
    discoveredAt: input.openedAt,
    rank: 1,
    title: input.title,
    url: input.finalUrl,
    provider: 'live-provider-under-test',
  }, null, 2), 'utf8');
  await writeFile(sourcePath, JSON.stringify({
    schemaVersion: 'sciforge.web-runtime.result.v1',
    ref: sourcePageJsonRef,
    sourceRef: sourcePageJsonRef,
    textRef: pageTextRef,
    requestedUrl: input.finalUrl,
    finalUrl: input.finalUrl,
    title: input.title,
    openedAt: input.openedAt,
    textSha1,
    textCharCount: input.pageText.length,
    provider: 'live-provider-under-test',
    sourcePageRef: pageRef,
  }, null, 2), 'utf8');
  await writeFile(textPath, input.pageText, 'utf8');
  return {
    ...input,
    textSha1,
    searchResultRef,
    pageRef,
    sourcePageJsonRef,
    pageTextRef,
  };
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
