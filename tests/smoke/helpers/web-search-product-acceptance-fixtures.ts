import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  agentHostBrowserAcceptanceSpecFromPrompt,
  agentHostBrowserTopicTermMatchesText,
} from '../../../src/runtime/codex/agent-host-browser-evidence.js';

export const WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.web-search.product-acceptance.v1';
export const WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION = 'sciforge.web-search.product-source-page.v1';

export const WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES = [
  'news-latest',
  'ordinary-web-lookup',
  'academic-technical-docs',
] as const;

export const WEB_SEARCH_PRODUCT_ACCEPTANCE_NEGATIVE_CASE_IDS = [
  'read-required-search-only',
  'snippet-only',
  'stale-refs',
  'fixture-refs',
  'gui-projection',
  'screenshot-replay',
] as const;

type WebSearchProductAcceptanceNegativeCaseId = typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_NEGATIVE_CASE_IDS[number];
type WebSearchProductAcceptanceTaskClass = typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES[number];
type WebSearchProductToolName = 'web_search' | 'web_read';
type WebSearchProductStatus = 'shape-valid' | 'blocked' | 'failed';
type WebSearchProductOrdinaryChatEntrypoint = 'diagnostic-scaffold' | 'desktop-default-chat';
type WebSearchProductSearchProviderRoute = 'native' | 'fallback' | 'unknown';
type WebSearchProductEvidenceRoute = 'search-only' | 'search-read';
type WebSearchProductRouteEvidence = {
  provider: WebSearchProductSearchProviderRoute;
  evidence: WebSearchProductEvidenceRoute;
};
type WebSearchProductTopicRelevance = {
  topic: string;
  terms: string[];
  matched: boolean;
  matchedSourceRefs: string[];
};
type WebSearchProductTimingReport = {
  startedAt: string;
  completedAt: string;
  searchMs?: number;
  readMs?: number;
  totalMs: number;
};
type WebSearchProductFailureReason = {
  code: string;
  message: string;
  userVisible: boolean;
};

export type WebSearchProductAcceptanceManifest = {
  schemaVersion: typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION;
  status: WebSearchProductStatus;
  proofLevel: 'diagnostic-scaffold' | 'live-product-proof';
  diagnosticOnly: boolean;
  productProof: boolean;
  releaseEligible: boolean;
  observedAt: string;
  provider: {
    id?: string;
    kind: 'acceptance-scaffold' | 'live-provider';
    live: boolean;
  };
  ordinaryChat: WebSearchProductOrdinaryChatEvidence;
  currentRun: {
    runId: string;
    refs: string[];
    route: WebSearchProductRouteEvidence;
    toolTrace: WebSearchProductToolTraceEntry[];
    search: WebSearchProductSearchEvidence;
    sourcePages: WebSearchProductSourcePageEvidence[];
    timings?: WebSearchProductTimingReport;
  };
  finalAnswer: {
    text: string;
    sourceLinks: string[];
    supportingRefs: string[];
    finalAnswerPath: string;
    snippetOnly: boolean;
    verifiedSourcePageRefs: string[];
    uiVisible?: boolean;
  };
  rejectionSignals: {
    guiProjectionUsed: boolean;
    screenshotReplayUsed: boolean;
  };
  blockedReason?: string;
  failureReason?: WebSearchProductFailureReason;
  userRecoveryPath?: string;
  runner?: {
    entrypoint: 'ordinary-chat';
    currentRun: true;
    externalRunStatus: 'passed' | 'blocked';
    appServerEventCount: number;
  };
  evidence?: {
    screenshotPath?: string;
  };
};

type WebSearchProductOrdinaryChatEvidence = {
  entrypoint: WebSearchProductOrdinaryChatEntrypoint;
  taskClass: WebSearchProductAcceptanceTaskClass;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  finalAnswerMessageRef: string;
  userPrompt: string;
};

export type WebSearchProductAcceptanceValidationResult = {
  valid: boolean;
  productProof: boolean;
  releaseEligible: boolean;
  blockers: string[];
};

type WebSearchProductToolTraceEntry = {
  toolName: WebSearchProductToolName;
  runId: string;
  status: 'completed' | 'blocked' | 'failed';
  startedAt: string;
  completedAt: string;
  refs: string[];
};

type WebSearchProductSearchEvidence = {
  query: string;
  searchResultRef: string;
  searchResultPath: string;
  sourceCount?: number;
  topicRelevance?: WebSearchProductTopicRelevance;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    ref: string;
  }>;
};

type WebSearchProductSourcePageEvidence = {
  pageRef: string;
  sourcePageJsonRef: string;
  sourcePageJsonPath: string;
  pageTextRef: string;
  pageTextPath: string;
  textSha1: string;
  textChars: number;
  openedAt: string;
  finalUrl: string;
  title: string;
  httpStatus: number;
  readStatus: 'read' | 'blocked' | 'failed';
  sourceTool: 'web_read';
};

type WebSearchProductSourcePageJson = {
  schemaVersion: typeof WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION;
  runId: string;
  pageRef: string;
  pageTextRef: string;
  textSha1: string;
  textChars: number;
  openedAt: string;
  finalUrl: string;
  title: string;
  sourceTool: 'web_read';
};

type WriteWebSearchProductAcceptanceOptions = {
  artifactDir: string;
  now?: () => Date;
  runId?: string;
};

type WriteWebSearchProductAcceptanceFromCurrentRunOptions = {
  artifactDir: string;
  observedAt: string;
  taskClass: WebSearchProductAcceptanceTaskClass;
  ordinaryChat: Omit<WebSearchProductOrdinaryChatEvidence, 'taskClass'>;
  provider: {
    id?: string;
    kind: 'live-provider';
    live: true;
  };
  currentRun: WebSearchProductAcceptanceManifest['currentRun'];
  finalAnswer: WebSearchProductAcceptanceManifest['finalAnswer'];
  rejectionSignals?: WebSearchProductAcceptanceManifest['rejectionSignals'];
  evidence?: WebSearchProductAcceptanceManifest['evidence'];
};

type CodexAppServerClientLike = {
  startTurn(request: {
    threadId?: string;
    commandText: string;
    workspacePath: string;
    commandId: string;
    attemptId: string;
    guiExtension?: { enabled?: boolean };
  }): Promise<{
    threadId?: string;
    turnId?: string;
    provider?: string;
    model?: string;
    profile?: string;
    workspacePath?: string;
    events: AsyncIterable<unknown>;
  }>;
};

type RunWebSearchProductOrdinaryChatAcceptanceOptions = {
  workspacePath: string;
  artifactDir: string;
  taskClass: WebSearchProductAcceptanceTaskClass;
  commandText: string;
  commandId?: string;
  attemptId?: string;
  threadId?: string;
  appServerClient?: CodexAppServerClientLike;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  timeoutMs?: number;
};

export type MaterializeWebSearchProductAcceptanceFromEventsOptions = {
  workspacePath: string;
  artifactDir: string;
  taskClass: WebSearchProductAcceptanceTaskClass;
  commandText: string;
  commandId: string;
  attemptId?: string;
  threadId?: string;
  turnId?: string;
  providerId?: string;
  events: unknown[];
  observedAt?: string;
  now?: () => Date;
  evidence?: WebSearchProductAcceptanceManifest['evidence'];
};

type ValidateWebSearchProductAcceptanceOptions = {
  artifactRoot?: string;
  now?: Date;
  maxAgeMs?: number;
  requireProductProof?: boolean;
};

type WebToolCompletion = {
  toolName: WebSearchProductToolName;
  timestamp?: string;
  envelope: Record<string, unknown>;
  refs: string[];
};

type ExtractedOrdinaryChatProductProof = {
  refs: string[];
  route?: WebSearchProductRouteEvidence;
  toolTrace: WebSearchProductToolTraceEntry[];
  search?: WebSearchProductSearchEvidence;
  sourcePages: WebSearchProductSourcePageEvidence[];
  finalAnswer?: WebSearchProductAcceptanceManifest['finalAnswer'];
};

type MaterializedOrdinaryChatProductProof =
  | {
      ok: true;
      currentRun: WebSearchProductAcceptanceManifest['currentRun'];
      finalAnswer: WebSearchProductAcceptanceManifest['finalAnswer'];
      extracted: ExtractedOrdinaryChatProductProof;
    }
  | {
      ok: false;
      reason: string;
      extracted: ExtractedOrdinaryChatProductProof;
    };

export async function writeWebSearchProductAcceptanceScaffold(
  options: WriteWebSearchProductAcceptanceOptions,
): Promise<WebSearchProductAcceptanceManifest> {
  const now = options.now?.() ?? new Date();
  const openedAt = now.toISOString();
  const runId = options.runId ?? 'web-search-product-current';
  const finalUrl = 'https://example.com/product-release';
  const query = 'ordinary chat product release evidence';
  const sourceText = [
    'Example product release notes.',
    'The product release page contains enough page text to verify the final answer from web_read evidence.',
    `Canonical source link: ${finalUrl}`,
  ].join('\n');
  const textSha1 = sha1(sourceText);
  const searchResultRef = `web-search:${runId}/search/search-results.json`;
  const searchResultPath = 'search/search-results.json';
  const pageRef = `web-page:${runId}/source-pages/source-1`;
  const sourcePageJsonRef = `web-source:${runId}/source-pages/source-1.source.json`;
  const sourcePageJsonPath = 'source-pages/source-1.source.json';
  const pageTextRef = `web-text:${runId}/source-pages/source-1.txt`;
  const pageTextPath = 'source-pages/source-1.txt';
  const finalAnswerPath = 'final-answer.md';

  await mkdir(join(options.artifactDir, 'search'), { recursive: true });
  await mkdir(join(options.artifactDir, 'source-pages'), { recursive: true });
  await writeFile(join(options.artifactDir, searchResultPath), `${JSON.stringify({
    query,
    runId,
    results: [{
      title: 'Example product release',
      url: finalUrl,
      snippet: 'A search snippet that is not sufficient by itself.',
      ref: pageRef,
    }],
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(options.artifactDir, pageTextPath), sourceText, 'utf8');
  await writeProductSourceJson(options.artifactDir, sourcePageJsonPath, {
    runId,
    pageRef,
    pageTextRef,
    textSha1,
    textChars: sourceText.length,
    openedAt,
    finalUrl,
    title: 'Example product release',
  });

  const finalAnswerText = `The ordinary chat answer cites the verified product release page. Source: ${finalUrl}`;
  await writeFile(join(options.artifactDir, finalAnswerPath), `${finalAnswerText}\n`, 'utf8');

  const sourcePageEvidence: WebSearchProductSourcePageEvidence = {
    pageRef,
    sourcePageJsonRef,
    sourcePageJsonPath,
    pageTextRef,
    pageTextPath,
    textSha1,
    textChars: sourceText.length,
    openedAt,
    finalUrl,
    title: 'Example product release',
    httpStatus: 200,
    readStatus: 'read',
    sourceTool: 'web_read',
  };

  const manifest: WebSearchProductAcceptanceManifest = {
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'shape-valid',
    proofLevel: 'diagnostic-scaffold',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    observedAt: openedAt,
    provider: {
      kind: 'acceptance-scaffold',
      live: false,
    },
    ordinaryChat: {
      entrypoint: 'diagnostic-scaffold',
      taskClass: 'ordinary-web-lookup',
      conversationId: `diagnostic-conversation:${runId}`,
      userMessageId: `diagnostic-message:${runId}:user`,
      assistantMessageId: `diagnostic-message:${runId}:assistant`,
      finalAnswerMessageRef: `diagnostic-message:${runId}:assistant-final`,
      userPrompt: 'Diagnostic scaffold for ordinary-chat web_search -> web_read evidence shape.',
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
        query,
        searchResultRef,
        searchResultPath,
        sourceCount: 1,
        topicRelevance: buildSearchTopicRelevance(query, query, [{
          title: 'Example product release',
          url: finalUrl,
          snippet: 'A search snippet that is not sufficient by itself.',
          ref: pageRef,
        }]),
        results: [{
          title: 'Example product release',
          url: finalUrl,
          snippet: 'A search snippet that is not sufficient by itself.',
          ref: pageRef,
        }],
      },
      sourcePages: [sourcePageEvidence],
      timings: {
        startedAt: openedAt,
        completedAt: openedAt,
        searchMs: 0,
        readMs: 0,
        totalMs: 0,
      },
    },
    finalAnswer: {
      text: finalAnswerText,
      sourceLinks: [finalUrl],
      supportingRefs: [sourcePageJsonRef, pageTextRef],
      finalAnswerPath,
      snippetOnly: false,
      verifiedSourcePageRefs: [sourcePageJsonRef],
      uiVisible: true,
    },
    rejectionSignals: {
      guiProjectionUsed: false,
      screenshotReplayUsed: false,
    },
  };

  await writeManifest(options.artifactDir, manifest);
  return manifest;
}

export async function writeWebSearchProductAcceptanceFromCurrentRun(
  options: WriteWebSearchProductAcceptanceFromCurrentRunOptions,
): Promise<WebSearchProductAcceptanceManifest> {
  const manifest: WebSearchProductAcceptanceManifest = {
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'shape-valid',
    proofLevel: 'live-product-proof',
    diagnosticOnly: false,
    productProof: true,
    releaseEligible: true,
    observedAt: options.observedAt,
    provider: options.provider,
    ordinaryChat: {
      ...options.ordinaryChat,
      taskClass: options.taskClass,
    },
    currentRun: normalizeCurrentRunEvidence(options.currentRun, options.ordinaryChat.userPrompt),
    finalAnswer: normalizeFinalAnswerEvidence(options.finalAnswer, true),
    rejectionSignals: options.rejectionSignals ?? {
      guiProjectionUsed: false,
      screenshotReplayUsed: false,
    },
    evidence: options.evidence,
  };

  const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
    artifactRoot: options.artifactDir,
    requireProductProof: true,
  });
  if (!validation.valid || !validation.productProof) {
    const failedManifest: WebSearchProductAcceptanceManifest = {
      ...manifest,
      status: 'failed',
      proofLevel: 'diagnostic-scaffold',
      diagnosticOnly: true,
      productProof: false,
      releaseEligible: false,
    };
    await writeManifest(options.artifactDir, failedManifest);
    throw new Error(`current-run product acceptance evidence is not release eligible:\n${validation.blockers.join('\n')}`);
  }

  await writeManifest(options.artifactDir, manifest);
  return manifest;
}

export async function runWebSearchProductOrdinaryChatAcceptance(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
): Promise<WebSearchProductAcceptanceManifest> {
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const runId = options.commandId ?? `ordinary-chat-web-search-product-${Date.now().toString(36)}`;
  const attemptId = options.attemptId ?? `${runId}-attempt-1`;
  const timeoutMs = options.timeoutMs
    ?? positiveIntegerFromEnv(options.env?.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_TIMEOUT_MS)
    ?? 180_000;
  await mkdir(options.artifactDir, { recursive: true });
  const events: unknown[] = [];
  let stream: Awaited<ReturnType<CodexAppServerClientLike['startTurn']>> | undefined;
  try {
    const client = options.appServerClient ?? await createDefaultCodexAppServerClient(options.env);
    const started = await withTimeout(client.startTurn({
      threadId: options.threadId,
      commandText: options.commandText,
      workspacePath: options.workspacePath,
      commandId: runId,
      attemptId,
      guiExtension: { enabled: false },
    }), timeoutMs, `ordinary-chat app-server startTurn timed out after ${timeoutMs}ms`);
    if (!started.ok) {
      return writeBlockedWebSearchProductAcceptanceManifest(options, {
        observedAt,
        runId,
        events,
        stream,
        reason: started.reason,
      });
    }
    stream = started.value;
    const collected = await collectEventsWithTimeout(stream.events, timeoutMs);
    events.push(...collected.events);
    if (collected.timedOut) {
      const extracted = await partialExtractedProof(options, {
        observedAt,
        runId,
        events,
        stream,
      });
      return writeBlockedWebSearchProductAcceptanceManifest(options, {
        observedAt,
        runId,
        events,
        stream,
        reason: `ordinary-chat app-server event stream timed out after ${timeoutMs}ms before web_search -> web_read product proof completed.`,
        extracted,
      });
    }
  } catch (error) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId,
      events,
      stream,
      reason: `ordinary-chat app-server run is blocked: ${messageFromError(error)}`,
    });
  }

  let proof: MaterializedOrdinaryChatProductProof;
  try {
    proof = await materializeOrdinaryChatProductProof(options, {
      observedAt,
      runId,
      events,
      stream,
    });
  } catch (error) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId,
      events,
      stream,
      reason: `ordinary-chat product proof extraction is blocked: ${messageFromError(error)}`,
    });
  }
  if (proof.ok === false) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId,
      events,
      stream,
      reason: proof.reason,
      extracted: proof.extracted,
    });
  }

  const manifest: WebSearchProductAcceptanceManifest = {
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'shape-valid',
    proofLevel: 'live-product-proof',
    diagnosticOnly: false,
    productProof: true,
    releaseEligible: true,
    observedAt,
    provider: {
      id: [stream?.provider, stream?.model, stream?.profile].filter(Boolean).join('/') || 'codex-app-server',
      kind: 'live-provider',
      live: true,
    },
    ordinaryChat: ordinaryChatEvidence(options, runId, stream),
    currentRun: normalizeCurrentRunEvidence(proof.currentRun, options.commandText),
    finalAnswer: normalizeFinalAnswerEvidence(proof.finalAnswer, true),
    rejectionSignals: {
      guiProjectionUsed: false,
      screenshotReplayUsed: false,
    },
    runner: {
      entrypoint: 'ordinary-chat',
      currentRun: true,
      externalRunStatus: 'passed',
      appServerEventCount: events.length,
    },
  };
  const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
    artifactRoot: options.artifactDir,
    now: options.now?.() ?? new Date(observedAt),
    requireProductProof: true,
  });
  if (!validation.valid || !validation.productProof) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId,
      events,
      stream,
      reason: `ordinary-chat current-run evidence did not satisfy product proof:\n${validation.blockers.join('\n')}`,
      extracted: proof.extracted,
    });
  }

  await writeManifest(options.artifactDir, manifest);
  return manifest;
}

async function partialExtractedProof(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  input: {
    observedAt: string;
    runId: string;
    events: unknown[];
    stream?: Awaited<ReturnType<CodexAppServerClientLike['startTurn']>>;
  },
): Promise<ExtractedOrdinaryChatProductProof> {
  try {
    const proof = await materializeOrdinaryChatProductProof(options, input);
    return proof.extracted;
  } catch {
    return emptyExtractedProof();
  }
}

export async function materializeWebSearchProductAcceptanceFromEvents(
  options: MaterializeWebSearchProductAcceptanceFromEventsOptions,
): Promise<WebSearchProductAcceptanceManifest> {
  const observedAt = options.observedAt ?? (options.now?.() ?? new Date()).toISOString();
  await mkdir(options.artifactDir, { recursive: true });
  let proof: MaterializedOrdinaryChatProductProof;
  try {
    proof = await materializeOrdinaryChatProductProof(options, {
      observedAt,
      runId: options.commandId,
      events: options.events,
    });
  } catch (error) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId: options.commandId,
      events: options.events,
      reason: `desktop UI current-run product proof extraction is blocked: ${messageFromError(error)}`,
      extracted: emptyExtractedProof(),
    });
  }
  if (proof.ok === false) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId: options.commandId,
      events: options.events,
      reason: proof.reason,
      extracted: proof.extracted,
    });
  }

  const manifest: WebSearchProductAcceptanceManifest = {
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'shape-valid',
    proofLevel: 'live-product-proof',
    diagnosticOnly: false,
    productProof: true,
    releaseEligible: true,
    observedAt,
    provider: {
      id: options.providerId ?? 'desktop-ui-runtime-codex',
      kind: 'live-provider',
      live: true,
    },
    ordinaryChat: {
      entrypoint: 'desktop-default-chat',
      taskClass: options.taskClass,
      conversationId: options.threadId ?? `desktop-ui:${options.commandId}`,
      userMessageId: `desktop-ui.user:${options.commandId}`,
      assistantMessageId: options.turnId ?? `desktop-ui.assistant:${options.commandId}`,
      finalAnswerMessageRef: `desktop-ui.final-answer:${options.commandId}`,
      userPrompt: options.commandText,
    },
    currentRun: normalizeCurrentRunEvidence(proof.currentRun, options.commandText),
    finalAnswer: normalizeFinalAnswerEvidence(proof.finalAnswer, true),
    rejectionSignals: {
      guiProjectionUsed: false,
      screenshotReplayUsed: false,
    },
    runner: {
      entrypoint: 'ordinary-chat',
      currentRun: true,
      externalRunStatus: 'passed',
      appServerEventCount: options.events.length,
    },
    ...(options.evidence ? { evidence: options.evidence } : {}),
  };
  const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
    artifactRoot: options.artifactDir,
    now: options.now?.() ?? new Date(observedAt),
    requireProductProof: true,
  });
  if (!validation.valid || !validation.productProof) {
    return writeBlockedWebSearchProductAcceptanceManifest(options, {
      observedAt,
      runId: options.commandId,
      events: options.events,
      reason: `desktop UI current-run evidence did not satisfy product proof:\n${validation.blockers.join('\n')}`,
      extracted: proof.extracted,
    });
  }

  await writeManifest(options.artifactDir, manifest);
  return manifest;
}

export async function buildWebSearchProductAcceptanceNegativeFixture(
  caseId: WebSearchProductAcceptanceNegativeCaseId,
  options: WriteWebSearchProductAcceptanceOptions,
): Promise<WebSearchProductAcceptanceManifest> {
  const manifest = await writeWebSearchProductAcceptanceScaffold(options);
  const runId = manifest.currentRun.runId;
  const staleRunId = `${runId}-previous`;

  switch (caseId) {
    case 'read-required-search-only':
      manifest.status = 'blocked';
      manifest.currentRun.route = {
        provider: 'native',
        evidence: 'search-only',
      };
      manifest.currentRun.toolTrace = manifest.currentRun.toolTrace.filter((entry) => entry.toolName === 'web_search');
      manifest.currentRun.refs = [manifest.currentRun.search.searchResultRef];
      manifest.currentRun.sourcePages = [];
      manifest.ordinaryChat.userPrompt = 'Read-required negative proof: use web_search, then use web_read to read one source page before answering.';
      manifest.finalAnswer = {
        ...manifest.finalAnswer,
        text: `Search result says: ${manifest.currentRun.search.results[0]?.snippet ?? ''}`,
        sourceLinks: [],
        supportingRefs: [manifest.currentRun.search.searchResultRef],
        snippetOnly: true,
        verifiedSourcePageRefs: [],
        uiVisible: true,
      };
      break;
    case 'snippet-only':
      manifest.finalAnswer = {
        ...manifest.finalAnswer,
        text: `Search result says: ${manifest.currentRun.search.results[0]?.snippet ?? ''}`,
        sourceLinks: [],
        supportingRefs: [manifest.currentRun.search.searchResultRef],
        snippetOnly: true,
        verifiedSourcePageRefs: [],
        uiVisible: true,
      };
      break;
    case 'stale-refs':
      makeSearchOnlyProductNegative(manifest);
      rewriteRefs(manifest, runId, staleRunId);
      break;
    case 'fixture-refs':
      makeSearchOnlyProductNegative(manifest);
      rewriteRefs(manifest, runId, 'fixture:web-search-product-acceptance');
      manifest.currentRun.refs = manifest.currentRun.refs.map((ref) => ref.replace(/^web-[^:]+:/, 'fixture:'));
      manifest.finalAnswer.supportingRefs = manifest.finalAnswer.supportingRefs.map((ref) => ref.replace(/^web-[^:]+:/, 'fixture:'));
      manifest.finalAnswer.verifiedSourcePageRefs = manifest.finalAnswer.verifiedSourcePageRefs.map((ref) => ref.replace(/^web-[^:]+:/, 'fixture:'));
      break;
    case 'gui-projection':
      makeSearchOnlyProductNegative(manifest);
      manifest.rejectionSignals.guiProjectionUsed = true;
      manifest.finalAnswer.supportingRefs.push(`gui.present:final-answer:${runId}`);
      break;
    case 'screenshot-replay':
      makeSearchOnlyProductNegative(manifest);
      manifest.rejectionSignals.screenshotReplayUsed = true;
      manifest.evidence = { screenshotPath: 'screenshots/final-answer.png' };
      manifest.finalAnswer.supportingRefs.push(`screenshot:${runId}/final-answer.png`);
      break;
    default:
      caseId satisfies never;
  }

  await writeManifest(options.artifactDir, manifest);
  return manifest;
}

export async function validateWebSearchProductAcceptanceManifest(
  manifest: WebSearchProductAcceptanceManifest,
  options: ValidateWebSearchProductAcceptanceOptions = {},
): Promise<WebSearchProductAcceptanceValidationResult> {
  const blockers: string[] = [];
  const runId = manifest.currentRun?.runId;

  if (manifest.schemaVersion !== WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION) {
    blockers.push(`manifest schemaVersion must be ${WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION}`);
  }
  if (!runId) blockers.push('currentRun.runId is required');

  const observedAtMs = Date.parse(manifest.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    blockers.push('manifest observedAt must be an ISO timestamp');
  } else if (options.now) {
    const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
    if (options.now.getTime() - observedAtMs > maxAgeMs) blockers.push('manifest is stale and must be produced by the current run');
  }

  const toolTrace = Array.isArray(manifest.currentRun?.toolTrace) ? manifest.currentRun.toolTrace : [];
  const completedToolNames = toolTrace.filter((entry) => entry.status === 'completed').map((entry) => entry.toolName);
  const route = normalizeRouteEvidence(manifest.currentRun?.route, manifest.currentRun);
  const expectsProductProof = options.requireProductProof
    || manifest.productProof === true
    || manifest.releaseEligible === true
    || manifest.proofLevel === 'live-product-proof';
  const readRequired = route.evidence === 'search-read' || manifestRequiresReadBackedEvidence(manifest);
  const completedSequence = completedToolNames.join(' -> ');
  if (readRequired && completedSequence !== 'web_search -> web_read') {
    blockers.push('read-required current-run completed tool trace must be web_search -> web_read');
  } else if (!readRequired && completedToolNames[0] !== 'web_search') {
    blockers.push('ordinary search product proof must include a completed current-run web_search call');
  } else if (!readRequired && completedToolNames.includes('web_read') && completedSequence !== 'web_search -> web_read') {
    blockers.push('current-run web_read evidence, when present, must follow web_search');
  }
  const webSearchTrace = toolTrace.find((entry) => entry.toolName === 'web_search' && entry.status === 'completed');
  const webReadTrace = toolTrace.find((entry) => entry.toolName === 'web_read' && entry.status === 'completed');
  for (const entry of toolTrace) {
    if (entry.runId !== runId) blockers.push(`tool trace entry ${entry.toolName} must belong to the current run`);
  }

  const allStrings = collectStrings(manifest);
  const allRefs = allStrings.filter(isEvidenceRef);
  if (allRefs.some((ref) => /^fixture:|fixture:\/\//i.test(ref))) blockers.push('fixture refs are not accepted as product acceptance evidence');
  if (manifest.rejectionSignals?.guiProjectionUsed || allRefs.some((ref) => /gui\.present|conversation-projection|browserVisibleState/i.test(ref))) {
    blockers.push('GUI projection evidence cannot satisfy web_search product acceptance');
  }
  if (
    manifest.rejectionSignals?.screenshotReplayUsed
    || Boolean(manifest.evidence?.screenshotPath)
    || allRefs.some((ref) => /screenshot:|\.png$|\.jpe?g$|image\/png|html2canvas/i.test(ref))
  ) {
    blockers.push('screenshot replay evidence cannot satisfy web_search product acceptance');
  }
  if (manifest.status === 'blocked' && (!manifest.failureReason?.code || !manifest.failureReason.message || manifest.failureReason.userVisible !== true)) {
    blockers.push('blocked product acceptance manifests must include a user-visible structured failure reason');
  }

  if (!manifest.currentRun?.search?.searchResultRef) {
    blockers.push('current-run web_search search result ref is required');
  } else if (webSearchTrace && !webSearchTrace.refs.includes(manifest.currentRun.search.searchResultRef)) {
    blockers.push('web_search trace refs must include the current-run search result ref');
  }
  if (manifest.currentRun?.search?.searchResultRef && !manifest.currentRun.refs.includes(manifest.currentRun.search.searchResultRef)) {
    blockers.push('currentRun.refs must include the current-run web_search search result ref');
  }
  validateCurrentRunWebRefs(manifest, blockers);
  await validateSearchEvidence(manifest, options, blockers, webSearchTrace, expectsProductProof);
  if (readRequired && !webReadTrace) blockers.push('read-required product proof requires completed current-run web_read evidence');
  if (manifest.finalAnswer?.snippetOnly) blockers.push('snippet-only answers must be rejected; current-run source evidence is required');

  const sourcePages = Array.isArray(manifest.currentRun?.sourcePages) ? manifest.currentRun.sourcePages : [];
  if (readRequired && sourcePages.length === 0) blockers.push('read-required product proof requires at least one current-run source page JSON and page text file');
  if (!readRequired && sourcePages.length > 0 && route.evidence === 'search-only') {
    blockers.push('search-only route must not claim source page evidence; use search-read when web_read evidence is present');
  }

  for (const source of sourcePages) {
    await validateSourcePage(source, manifest, options, blockers, webReadTrace);
  }

  const sourceLinks = manifest.finalAnswer?.sourceLinks ?? [];
  if (!sourceLinks.some((link) => /^https?:\/\//.test(link))) blockers.push('final answer must include at least one HTTP(S) source link');
  validatePromptMinimumSourceCoverage(manifest, blockers);
  const sourceUrls = sourcePages.map((source) => source.finalUrl).filter(Boolean);
  for (const finalUrl of sourceUrls) {
    if (!manifest.finalAnswer?.sourceLinks?.includes(finalUrl) || !manifest.finalAnswer?.text?.includes(finalUrl)) {
      blockers.push(`final answer must include source link ${finalUrl}`);
    }
  }
  if (!readRequired) validateSearchOnlyFinalAnswer(manifest, blockers);
  for (const source of sourcePages) {
    if (!manifest.finalAnswer?.supportingRefs?.includes(source.sourcePageJsonRef)) {
      blockers.push(`final answer must support source page JSON ref ${source.sourcePageJsonRef}`);
    }
    if (!manifest.finalAnswer?.supportingRefs?.includes(source.pageTextRef)) {
      blockers.push(`final answer must support page text ref ${source.pageTextRef}`);
    }
    if (!manifest.finalAnswer?.verifiedSourcePageRefs?.includes(source.sourcePageJsonRef)) {
      blockers.push(`final answer verified source page refs must include actual read source page JSON ref ${source.sourcePageJsonRef}`);
    }
  }
  for (const verifiedRef of manifest.finalAnswer?.verifiedSourcePageRefs ?? []) {
    if (!sourcePages.some((source) => source.sourcePageJsonRef === verifiedRef)) {
      blockers.push(`final answer verified source page ref ${verifiedRef} must come from actual current-run web_read evidence`);
    }
  }
  if (expectsProductProof) {
    validateLiveOrdinaryChatProductProofShape(manifest, blockers);
    validateProductTimingShape(manifest, blockers);
    blockers.push(...await sourceRelevanceBlockers(manifest, sourcePages, options));
  }

  const productProof = blockers.length === 0
    && manifest.productProof === true
    && manifest.releaseEligible === true
    && manifest.diagnosticOnly === false
    && manifest.proofLevel === 'live-product-proof'
    && manifest.provider?.kind === 'live-provider'
    && manifest.provider.live === true;

  if (options.requireProductProof && !productProof) {
    blockers.push('manifest does not contain live product proof; diagnostic scaffold evidence is not release eligible');
  }
  if (manifest.productProof === true && manifest.provider?.kind !== 'live-provider') {
    blockers.push('non-live scaffold evidence must not claim product proof');
  }

  return {
    valid: blockers.length === 0,
    productProof,
    releaseEligible: productProof,
    blockers,
  };
}

async function createDefaultCodexAppServerClient(
  env: NodeJS.ProcessEnv | undefined,
): Promise<CodexAppServerClientLike> {
  const module = await import('../../../src/runtime/codex/codex-app-server-client.js') as {
    createCodexAppServerClient(options?: { env?: NodeJS.ProcessEnv }): CodexAppServerClientLike;
  };
  return module.createCodexAppServerClient({ env });
}

async function materializeOrdinaryChatProductProof(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  input: {
    observedAt: string;
    runId: string;
    events: unknown[];
    stream?: Awaited<ReturnType<CodexAppServerClientLike['startTurn']>>;
  },
): Promise<MaterializedOrdinaryChatProductProof> {
  const blockers: string[] = [];
  const completedTools = input.events.flatMap(webToolCompletionFromEvent);
  const searchCompletion = completedTools.find((entry) => entry.toolName === 'web_search');
  const readCompletion = completedTools.find((entry) => entry.toolName === 'web_read');
  const readRequired = manifestCommandRequiresReadBackedEvidence(options.commandText);
  if (!searchCompletion) blockers.push('ordinary-chat current run did not complete web_search');
  if (!readCompletion && readRequired) blockers.push('read-required ordinary-chat current run did not complete web_read');

  const search = searchCompletion
    ? await materializeSearchEvidence(options, input, searchCompletion, blockers)
    : undefined;
  const sourcePages = search && readCompletion
    ? await materializeSourcePageEvidence(options, input, search, readCompletion, blockers)
    : [];
  const route = normalizeRouteEvidence({
    provider: searchProviderRouteFromCompletion(searchCompletion),
    evidence: readCompletion ? 'search-read' : 'search-only',
  });
  const finalAnswer = await materializeFinalAnswer(options.artifactDir, input.events, search, sourcePages, blockers);
  const timings = materializeProductTimings(input.observedAt, searchCompletion, readCompletion);
  const refs = uniqueStrings([
    ...(search ? [search.searchResultRef] : []),
    ...(search?.results.map((result) => result.ref) ?? []),
    ...sourcePages.flatMap((source) => [source.pageRef, source.sourcePageJsonRef, source.pageTextRef]),
    ...completedTools.flatMap((entry) => entry.refs),
    ...(finalAnswer?.supportingRefs ?? []),
  ]).filter(isEvidenceRef);
  const toolTrace: WebSearchProductToolTraceEntry[] = [
    ...(searchCompletion ? [{
      toolName: 'web_search' as const,
      runId: input.runId,
      status: 'completed' as const,
      startedAt: searchCompletion.timestamp ?? input.observedAt,
      completedAt: searchCompletion.timestamp ?? input.observedAt,
      refs: searchCompletion.refs,
    }] : []),
    ...(readCompletion ? [{
      toolName: 'web_read' as const,
      runId: input.runId,
      status: 'completed' as const,
      startedAt: readCompletion.timestamp ?? input.observedAt,
      completedAt: readCompletion.timestamp ?? input.observedAt,
      refs: uniqueStrings([
        ...readCompletion.refs,
        ...sourcePages.map((source) => source.pageRef),
      ]),
    }] : []),
  ];
  const extracted: ExtractedOrdinaryChatProductProof = {
    refs,
    route,
    toolTrace,
    search,
    sourcePages,
    finalAnswer,
  };

  if (!finalAnswer) blockers.push('ordinary-chat current run did not produce a completed final answer with source links');
  if (finalAnswer && sourcePages.length > 0) {
    for (const source of sourcePages) {
      if (!finalAnswer.sourceLinks.includes(source.finalUrl) || !finalAnswer.text.includes(source.finalUrl)) {
        blockers.push(`final answer is missing actual read source link ${source.finalUrl}`);
      }
      if (!finalAnswer.verifiedSourcePageRefs.includes(source.sourcePageJsonRef)) {
        blockers.push(`final answer is missing verified source page ref ${source.sourcePageJsonRef}`);
      }
    }
  }
  const completedSequence = toolTrace.map((entry) => entry.toolName).join(' -> ');
  if (readRequired && completedSequence !== 'web_search -> web_read') {
    blockers.push('ordinary-chat current run must complete web_search before web_read');
  } else if (!readRequired && readCompletion && completedSequence !== 'web_search -> web_read') {
    blockers.push('ordinary-chat current run must complete web_search before web_read when read evidence is present');
  } else if (!readRequired && !readCompletion && completedSequence !== 'web_search') {
    blockers.push('ordinary-chat search-only product proof must complete web_search');
  }

  if (blockers.length || !search || !finalAnswer) {
    return { ok: false, reason: uniqueStrings(blockers).join('\n') || 'ordinary-chat product proof extraction is incomplete', extracted };
  }
  return {
    ok: true,
    currentRun: {
      runId: input.runId,
      refs,
      route,
      toolTrace,
      search,
      sourcePages,
      timings,
    },
    finalAnswer,
    extracted,
  };
}

async function materializeSearchEvidence(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  input: { runId: string; observedAt: string },
  completion: WebToolCompletion,
  blockers: string[],
): Promise<WebSearchProductSearchEvidence | undefined> {
  const data = recordField(completion.envelope.data);
  const searchResultRef = stringField(data?.resultSetRef)
    ?? stringField(data?.searchResultRef)
    ?? completion.refs.find((ref) => ref.startsWith('web-search:'))
    ?? '';
  if (!searchResultRef) {
    blockers.push('web_search completed event did not include a web-search ref');
    return undefined;
  }

  const persisted = await readJsonIfExists(runtimeArtifactPath(options.workspacePath, 'web-search', searchResultRef, 'json'));
  const query = stringField(data?.query) ?? stringField(persisted?.query) ?? options.commandText;
  const eventResults = arrayField(data?.results).flatMap(searchResultFromUnknown);
  const persistedResults = arrayField(persisted?.results).flatMap(searchResultFromUnknown);
  const pageRefs = uniqueStrings([
    ...completion.refs.filter((ref) => ref.startsWith('web-page:')),
    ...eventResults.map((result) => result.ref),
    ...persistedResults.map((result) => result.ref),
    ...arrayField(persisted?.resultRefs).filter((ref): ref is string => typeof ref === 'string'),
  ]);
  const pageArtifactResults = await Promise.all(pageRefs.map((ref) => searchResultFromPageArtifact(options.workspacePath, ref)));
  const results = uniqueSearchResults([
    ...eventResults,
    ...persistedResults,
    ...pageArtifactResults.filter((result): result is WebSearchProductSearchEvidence['results'][number] => Boolean(result)),
  ]);
  if (results.length === 0) blockers.push('web_search result artifact did not include discovered web-page refs');

  const searchResultPath = 'search/search-results.json';
  await mkdir(join(options.artifactDir, 'search'), { recursive: true });
  await writeFile(join(options.artifactDir, searchResultPath), `${JSON.stringify({
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    runId: input.runId,
    observedAt: input.observedAt,
    query,
    searchResultRef,
    sourceCount: results.length,
    topicRelevance: buildSearchTopicRelevance(query, options.commandText, results),
    results,
  }, null, 2)}\n`, 'utf8');
  return {
    query,
    searchResultRef,
    searchResultPath,
    sourceCount: results.length,
    topicRelevance: buildSearchTopicRelevance(query, options.commandText, results),
    results,
  };
}

async function materializeSourcePageEvidence(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  input: { runId: string },
  search: WebSearchProductSearchEvidence,
  completion: WebToolCompletion,
  blockers: string[],
): Promise<WebSearchProductSourcePageEvidence[]> {
  const source = recordField(recordField(completion.envelope.data)?.source);
  const content = recordField(recordField(completion.envelope.data)?.content);
  const sourceRefs = uniqueStrings([
    stringField(source?.sourceRef),
    stringField(source?.sourcePageRef),
    ...completion.refs.filter((ref) => ref.startsWith('web-source:')),
  ].filter((ref): ref is string => Boolean(ref)));
  const textRefs = uniqueStrings([
    stringField(source?.pageTextRef),
    stringField(content?.textRef),
    ...completion.refs.filter((ref) => ref.startsWith('web-text:')),
  ].filter((ref): ref is string => Boolean(ref)));
  if (sourceRefs.length === 0) blockers.push('web_read completed event did not include source page JSON refs');
  if (textRefs.length === 0) blockers.push('web_read completed event did not include page text refs');

  const sourcePages: WebSearchProductSourcePageEvidence[] = [];
  for (const [index, sourcePageJsonRef] of sourceRefs.entries()) {
    const pageTextRef = textRefs[index] ?? textRefs[0] ?? '';
    if (!pageTextRef) continue;
    const sourceArtifact = await readJsonIfExists(runtimeArtifactPath(options.workspacePath, 'web-source', sourcePageJsonRef, 'json'));
    if (!sourceArtifact) {
      blockers.push(`source artifact is missing for ${sourcePageJsonRef}`);
      continue;
    }
    const pageText = await readRuntimePageText(options.workspacePath, pageTextRef, sourceArtifact);
    if (pageText === undefined) {
      blockers.push(`page text artifact is missing for ${pageTextRef}`);
      continue;
    }
    const finalUrl = stringField(sourceArtifact.finalUrl) ?? stringField(source?.finalUrl) ?? '';
    const openedAt = stringField(sourceArtifact.openedAt) ?? stringField(source?.openedAt) ?? '';
    const textSha1 = stringField(sourceArtifact.textSha1) ?? stringField(source?.textSha1) ?? '';
    const title = stringField(sourceArtifact.title) ?? stringField(source?.title) ?? finalUrl;
    const pageRef = stringField(sourceArtifact.sourcePageRef)
      ?? search.results.find((result) => result.url === finalUrl)?.ref
      ?? '';
    if (!pageRef) blockers.push(`source page ${sourcePageJsonRef} is not linked to a current-run web_search page ref`);
    if (!finalUrl) blockers.push(`source page ${sourcePageJsonRef} is missing finalUrl`);
    if (!openedAt) blockers.push(`source page ${sourcePageJsonRef} is missing openedAt`);
    if (!textSha1) blockers.push(`source page ${sourcePageJsonRef} is missing textSha1`);
    if (textSha1 && sha1(pageText) !== textSha1.toLowerCase()) blockers.push(`page text SHA-1 mismatch for ${pageTextRef}`);
    if (finalUrl && pageRef && !search.results.some((result) => result.ref === pageRef && /^https?:\/\//.test(result.url))) {
      blockers.push(`source page ${pageRef} must be discovered by the current-run web_search result before web_read`);
    }

    const sourcePageJsonPath = `source-pages/source-${index + 1}.source.json`;
    const pageTextPath = `source-pages/source-${index + 1}.txt`;
    await mkdir(join(options.artifactDir, 'source-pages'), { recursive: true });
    await writeFile(join(options.artifactDir, pageTextPath), pageText, 'utf8');
    await writeProductSourceJson(options.artifactDir, sourcePageJsonPath, {
      runId: input.runId,
      pageRef,
      pageTextRef,
      textSha1,
      textChars: pageText.length,
      openedAt,
      finalUrl,
      title,
    });
    sourcePages.push({
      pageRef,
      sourcePageJsonRef,
      sourcePageJsonPath,
      pageTextRef,
      pageTextPath,
      textSha1,
      textChars: pageText.length,
      openedAt,
      finalUrl,
      title,
      httpStatus: numberField(sourceArtifact.httpStatus) ?? numberField(sourceArtifact.statusCode) ?? 200,
      readStatus: 'read',
      sourceTool: 'web_read',
    });
  }
  return sourcePages;
}

async function materializeFinalAnswer(
  artifactDir: string,
  events: unknown[],
  search: WebSearchProductSearchEvidence | undefined,
  sourcePages: WebSearchProductSourcePageEvidence[],
  blockers: string[],
): Promise<WebSearchProductAcceptanceManifest['finalAnswer'] | undefined> {
  const final = finalAnswerFromEvents(events);
  if (!final?.text) return undefined;
  const sourceLinks = uniqueStrings(urlsFromText(final.text));
  if (sourceLinks.length === 0) blockers.push('ordinary-chat final answer must include a source link');
  const finalAnswerPath = 'final-answer.md';
  await writeFile(join(artifactDir, finalAnswerPath), `${final.text}\n`, 'utf8');
  const sourceEvidenceRefs = sourcePages.flatMap((source) => [source.sourcePageJsonRef, source.pageTextRef]);
  const linkedSearchResults = search
    ? search.results.filter((result) => sourceLinks.includes(result.url) || final.text.includes(result.url))
    : [];
  const searchEvidenceRefs = search
    ? [search.searchResultRef, ...linkedSearchResults.map((result) => result.ref)]
    : [];
  const supportingRefs = uniqueStrings([
    ...final.evidenceRefs.filter((ref) => sourceEvidenceRefs.includes(ref) || searchEvidenceRefs.includes(ref)),
    ...sourceEvidenceRefs,
    ...(sourcePages.length === 0 ? searchEvidenceRefs : []),
  ]);
  const verifiedSourcePageRefs = sourcePages
    .filter((source) => sourceLinks.includes(source.finalUrl) || final.text.includes(source.finalUrl))
    .map((source) => source.sourcePageJsonRef);
  return {
    text: final.text,
    sourceLinks,
    supportingRefs,
    finalAnswerPath,
    snippetOnly: false,
    verifiedSourcePageRefs,
    uiVisible: true,
  };
}

async function writeBlockedWebSearchProductAcceptanceManifest(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  input: {
    observedAt: string;
    runId: string;
    events: unknown[];
    stream?: Awaited<ReturnType<CodexAppServerClientLike['startTurn']>>;
    reason: string;
    extracted?: ExtractedOrdinaryChatProductProof;
  },
): Promise<WebSearchProductAcceptanceManifest> {
  const extracted = input.extracted ?? emptyExtractedProof();
  const finalAnswerPath = extracted.finalAnswer?.finalAnswerPath ?? 'final-answer.md';
  await mkdir(options.artifactDir, { recursive: true });
  if (extracted.finalAnswer?.text) await writeFile(join(options.artifactDir, finalAnswerPath), `${extracted.finalAnswer.text}\n`, 'utf8');
  const manifest: WebSearchProductAcceptanceManifest = {
    schemaVersion: WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    proofLevel: 'diagnostic-scaffold',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    observedAt: input.observedAt,
    provider: {
      id: [input.stream?.provider, input.stream?.model, input.stream?.profile].filter(Boolean).join('/') || 'codex-app-server',
      kind: 'acceptance-scaffold',
      live: false,
    },
    ordinaryChat: ordinaryChatEvidence(options, input.runId, input.stream),
    currentRun: normalizeCurrentRunEvidence({
      runId: input.runId,
      refs: extracted.refs,
      route: normalizeRouteEvidence(extracted.route, {
        sourcePages: extracted.sourcePages,
      }),
      toolTrace: extracted.toolTrace,
      search: extracted.search ?? emptySearchEvidence(),
      sourcePages: extracted.sourcePages,
    }, options.commandText),
    finalAnswer: normalizeFinalAnswerEvidence(extracted.finalAnswer ?? {
      text: '',
      sourceLinks: [],
      supportingRefs: [],
      finalAnswerPath,
      snippetOnly: true,
      verifiedSourcePageRefs: [],
    }, Boolean(extracted.finalAnswer?.text)),
    rejectionSignals: {
      guiProjectionUsed: false,
      screenshotReplayUsed: false,
    },
    blockedReason: input.reason,
    failureReason: {
      code: 'product_proof_blocked',
      message: input.reason,
      userVisible: true,
    },
    userRecoveryPath: 'Rerun the ordinary SciForge desktop/default chat product acceptance with a ready provider and inspect manifest.json plus source-pages artifacts.',
    runner: {
      entrypoint: 'ordinary-chat',
      currentRun: true,
      externalRunStatus: 'blocked',
      appServerEventCount: input.events.length,
    },
  };
  await writeManifest(options.artifactDir, manifest);
  await writeFile(join(options.artifactDir, 'blocked-web-search-product-acceptance.md'), [
    '# Web search product acceptance blocked',
    '',
    `Reason: ${input.reason}`,
    '',
    manifest.userRecoveryPath,
    '',
  ].join('\n'), 'utf8');
  return manifest;
}

function ordinaryChatEvidence(
  options: RunWebSearchProductOrdinaryChatAcceptanceOptions,
  runId: string,
  stream: Awaited<ReturnType<CodexAppServerClientLike['startTurn']>> | undefined,
): WebSearchProductOrdinaryChatEvidence {
  return {
    entrypoint: 'desktop-default-chat',
    taskClass: options.taskClass,
    conversationId: stream?.threadId ?? options.threadId ?? `ordinary-chat:${runId}`,
    userMessageId: `codex.app-server.user:${runId}`,
    assistantMessageId: stream?.turnId ?? `codex.app-server.assistant:${runId}`,
    finalAnswerMessageRef: `codex.app-server.final-answer:${runId}`,
    userPrompt: options.commandText,
  };
}

function webToolCompletionFromEvent(event: unknown): WebToolCompletion[] {
  if (!isRecord(event)) return [];
  const nested = recordField(recordField(event.raw)?.event);
  if (nested) return webToolCompletionFromEvent(nested);
  if (!isWebToolCompletionEvent(event)) return [];
  const envelope = webRuntimeEnvelopeFromEvent(event);
  if (!envelope || stringField(envelope.status) !== 'completed') return [];
  const envelopeToolName = normalizeWebToolName(stringField(envelope.tool));
  const toolNames = uniqueStrings([
    ...webToolNamesFromEvent(event),
    ...(envelopeToolName ? [envelopeToolName] : []),
  ]);
  return toolNames
    .filter((toolName): toolName is WebSearchProductToolName => toolName === 'web_search' || toolName === 'web_read')
    .map((toolName) => ({
      toolName,
      timestamp: timestampFromEvent(event),
      envelope,
      refs: uniqueStrings([
        ...structuredRefsFromUnknown(envelope),
        ...structuredRefsFromUnknown(event),
        ...structuredRefsFromUnknown(recordField(event.params)?.result),
        ...structuredRefsFromUnknown(recordField(event.params)?.output),
      ]).filter((ref) => /^web-(?:search|page|source|text):/i.test(ref)),
    }));
}

function isWebToolCompletionEvent(event: Record<string, unknown>): boolean {
  return stringField(event.method) === 'item/tool/completed'
    || (stringField(event.method) === 'item/completed' && stringField(recordField(recordField(event.params)?.item)?.type) === 'dynamicToolCall')
    || stringField(event.type) === 'tool_completed'
    || stringField(event.event) === 'tool_completed'
    || (stringField(recordField(event.payload)?.type) === 'function_call_output' && Boolean(webRuntimeEnvelopeFromEvent(event)));
}

function webToolNamesFromEvent(event: Record<string, unknown>): string[] {
  const params = recordField(event.params);
  const namespace = stringField(params?.namespace);
  const tool = stringField(params?.tool);
  const item = recordField(params?.item);
  const itemNamespace = stringField(item?.namespace);
  const itemTool = stringField(item?.tool);
  const rawItem = recordField(recordField(recordField(event.raw)?.params)?.item);
  const rawNamespace = stringField(rawItem?.namespace);
  const rawTool = stringField(rawItem?.tool);
  const eventTool = stringField(event.toolName) ?? stringField(event.tool);
  const names = [
    ...(tool ? [namespace ? `${namespace}.${tool}` : tool] : []),
    ...(itemTool ? [itemNamespace ? `${itemNamespace}.${itemTool}` : itemTool] : []),
    ...(rawTool ? [rawNamespace ? `${rawNamespace}.${rawTool}` : rawTool] : []),
    ...(eventTool ? [eventTool] : []),
  ];
  const args = parseRecord(params?.arguments)
    ?? parseRecord(item?.arguments)
    ?? parseRecord(rawItem?.arguments)
    ?? parseRecord(recordField(recordField(event.raw)?.params)?.arguments);
  const moduleId = stringField(args?.moduleId) ?? stringField(args?.module_id);
  const intent = stringField(args?.intent);
  if (moduleId === 'web' && intent === 'web.search') names.push('web_search');
  if (moduleId === 'web' && intent === 'web.read') names.push('web_read');
  return uniqueStrings(names.map(normalizeWebToolName));
}

function normalizeWebToolName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'web_search' || value.endsWith('.web_search') || value === 'web.search') return 'web_search';
  if (value === 'web_read' || value.endsWith('.web_read') || value === 'web.read') return 'web_read';
  return value;
}

function webRuntimeEnvelopeFromEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const params = recordField(event.params);
  const payload = recordField(event.payload);
  const item = recordField(params?.item);
  return webRuntimeEnvelope(params?.result)
    ?? webRuntimeEnvelope(params?.output)
    ?? webRuntimeEnvelope(item?.result)
    ?? webRuntimeEnvelope(item?.output)
    ?? webRuntimeEnvelopeFromContentItems(item?.contentItems)
    ?? webRuntimeEnvelope(recordField(recordField(recordField(event.raw)?.params)?.item)?.result)
    ?? webRuntimeEnvelope(recordField(recordField(recordField(event.raw)?.params)?.item)?.output)
    ?? webRuntimeEnvelopeFromJsonText(stringField(payload?.output))
    ?? webRuntimeEnvelopeFromContentItems(payload?.content)
    ?? webRuntimeEnvelopeFromJsonText(stringField(event.resultSummary))
    ?? webRuntimeEnvelopeFromJsonText(stringField(event.outputSummary))
    ?? webRuntimeEnvelopeFromContentItems(recordField(recordField(recordField(event.raw)?.params)?.item)?.contentItems);
}

function webRuntimeEnvelope(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion === 'sciforge.web-runtime.result.v1' || stringField(value.tool)?.startsWith('web_')) return value;
  return webRuntimeEnvelope(value.value) ?? webRuntimeEnvelope(value.result);
}

function webRuntimeEnvelopeFromJsonText(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return webRuntimeEnvelope(parseRecord(value));
}

function webRuntimeEnvelopeFromContentItems(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const parsed = webRuntimeEnvelopeFromJsonText(stringField(recordField(item)?.text));
    if (parsed) return parsed;
  }
  return undefined;
}

function finalAnswerFromEvents(events: unknown[]): { text: string; evidenceRefs: string[] } | undefined {
  for (const event of [...events].reverse()) {
    if (!isRecord(event)) continue;
    if (stringField(event.method) === 'item/tool/completed') continue;
    const type = stringField(event.type);
    const status = stringField(event.status);
    const payload = recordField(event.payload);
    const payloadText = stringField(payload?.type) === 'message'
      ? textFromMessageContent(payload?.content)
      : undefined;
    const text = stringField(event.text) ?? stringField(event.message) ?? stringField(recordField(event.params)?.text) ?? payloadText;
    if (!text || (type && type !== 'message' && type !== 'response_item') || (status && status !== 'completed')) continue;
    return {
      text,
      evidenceRefs: structuredRefsFromUnknown(event).filter((ref) => /^web-(?:source|text):/i.test(ref)),
    };
  }
  return undefined;
}

function textFromMessageContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((item) => {
      const record = recordField(item);
      return stringField(record?.text) ?? stringField(record?.output_text);
    })
    .filter((item): item is string => Boolean(item))
    .join('\n')
    .trim();
  return text || undefined;
}

function searchResultFromUnknown(value: unknown): WebSearchProductSearchEvidence['results'][number][] {
  if (!isRecord(value)) return [];
  const ref = stringField(value.ref) ?? stringField(value.resourceRef);
  const url = stringField(value.url);
  if (url?.startsWith('[redacted-url:')) return [];
  if (!ref || !url) return [];
  return [{
    title: stringField(value.title) ?? url,
    url,
    snippet: stringField(value.snippet) ?? '',
    ref,
  }];
}

async function searchResultFromPageArtifact(
  workspacePath: string,
  pageRef: string,
): Promise<WebSearchProductSearchEvidence['results'][number] | undefined> {
  const page = await readJsonIfExists(runtimeArtifactPath(workspacePath, 'web-page', pageRef, 'json'));
  if (!page) return undefined;
  const url = stringField(page.url);
  if (!url) return undefined;
  return {
    title: stringField(page.title) ?? url,
    url,
    snippet: stringField(page.snippet) ?? '',
    ref: pageRef,
  };
}

function uniqueSearchResults(
  results: WebSearchProductSearchEvidence['results'],
): WebSearchProductSearchEvidence['results'] {
  const seen = new Set<string>();
  const unique: WebSearchProductSearchEvidence['results'] = [];
  for (const result of results) {
    const key = `${result.ref}\n${result.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

async function readRuntimePageText(
  workspacePath: string,
  pageTextRef: string,
  sourceArtifact: Record<string, unknown>,
): Promise<string | undefined> {
  const textPath = stringField(sourceArtifact.textPath);
  const explicit = textPath
    ? await readTextIfExists(isAbsolute(textPath) ? textPath : join(workspacePath, textPath))
    : undefined;
  if (explicit !== undefined) return explicit;
  const candidates = [
    runtimeArtifactPath(workspacePath, 'web-text', pageTextRef, 'md'),
    runtimeArtifactPath(workspacePath, 'web-text', pageTextRef, 'txt'),
    legacyWebReadArtifactPath(workspacePath, 'web-text', pageTextRef, 'txt'),
  ];
  for (const candidate of candidates) {
    const text = await readTextIfExists(candidate);
    if (text !== undefined) return text;
  }
  return undefined;
}

function runtimeArtifactPath(
  workspacePath: string,
  kind: 'web-search' | 'web-page' | 'web-source' | 'web-text',
  ref: string,
  extension: 'json' | 'md' | 'txt',
): string {
  const id = refId(kind, ref);
  const dir = kind === 'web-search'
    ? 'searches'
    : kind === 'web-page'
      ? 'pages'
      : kind === 'web-source'
        ? 'sources'
        : 'texts';
  return join(workspacePath, '.sciforge', 'web-search', dir, `${id}.${extension}`);
}

function legacyWebReadArtifactPath(
  workspacePath: string,
  kind: 'web-source' | 'web-text',
  ref: string,
  extension: 'json' | 'txt',
): string {
  const id = refId(kind, ref);
  const dir = kind === 'web-source' ? 'sources' : 'texts';
  const prefix = kind === 'web-source' ? 'source-' : 'text-';
  return join(workspacePath, '.sciforge', 'web-read', dir, `${prefix}${id}.${extension}`);
}

function refId(kind: 'web-search' | 'web-page' | 'web-source' | 'web-text', ref: string): string {
  const prefix = `${kind}:`;
  const id = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
  if (id.includes('..') || id.startsWith('/') || id.startsWith('\\')) {
    throw new Error(`unsafe web evidence ref id: ${ref}`);
  }
  return id;
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function webSearchRuntimeRefsFromValue(value: unknown): string[] {
  if (typeof value === 'string' && /^web-(?:search|page|source|text):/i.test(value)) return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(webSearchRuntimeRefsFromValue);
  return Object.values(value as Record<string, unknown>).flatMap(webSearchRuntimeRefsFromValue);
}

function structuredRefsFromUnknown(value: unknown): string[] {
  const refs = webSearchRuntimeRefsFromValue(value);
  if (isRecord(value)) {
    refs.push(...arrayField(value.refs).flatMap(webSearchRuntimeRefsFromValue));
    refs.push(...arrayField(value.evidenceRefs).flatMap(webSearchRuntimeRefsFromValue));
  }
  return uniqueStrings(refs);
}

function timestampFromEvent(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  return stringField(event.timestamp) ?? stringField(event.createdAt) ?? stringField(recordField(event.params)?.timestamp);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emptyExtractedProof(): ExtractedOrdinaryChatProductProof {
  return {
    refs: [],
    toolTrace: [],
    search: emptySearchEvidence(),
    sourcePages: [],
  };
}

function emptySearchEvidence(): WebSearchProductSearchEvidence {
  return {
    query: '',
    searchResultRef: '',
    searchResultPath: 'search/search-results.json',
    sourceCount: 0,
    topicRelevance: {
      topic: '',
      terms: [],
      matched: false,
      matchedSourceRefs: [],
    },
    results: [],
  };
}

async function validateSourcePage(
  source: WebSearchProductSourcePageEvidence,
  manifest: WebSearchProductAcceptanceManifest,
  options: ValidateWebSearchProductAcceptanceOptions,
  blockers: string[],
  webReadTrace: WebSearchProductToolTraceEntry | undefined,
): Promise<void> {
  const runId = manifest.currentRun.runId;
  if (source.sourceTool !== 'web_read' || source.readStatus !== 'read') blockers.push('source page evidence must come from a completed web_read');
  if (!source.sourcePageJsonRef || !source.pageTextRef) blockers.push('source page JSON ref and page text ref are required');
  if (!source.pageRef?.startsWith('web-page:')) blockers.push('source page ref must be a web-page ref from the current run');
  if (!source.sourcePageJsonRef?.startsWith('web-source:')) blockers.push('source page JSON ref must be a web-source ref from the current run');
  if (!source.pageTextRef?.startsWith('web-text:')) blockers.push('page text ref must be a web-text ref from the current run');
  if (!manifest.currentRun.refs.includes(source.pageRef)) blockers.push(`currentRun.refs must include source page ref ${source.pageRef}`);
  if (!manifest.currentRun.refs.includes(source.sourcePageJsonRef)) blockers.push(`currentRun.refs must include source page JSON ref ${source.sourcePageJsonRef}`);
  if (!manifest.currentRun.refs.includes(source.pageTextRef)) blockers.push(`currentRun.refs must include page text ref ${source.pageTextRef}`);
  if (webReadTrace && !webReadTrace.refs.includes(source.pageRef)) blockers.push(`web_read trace refs must include source page ref ${source.pageRef}`);
  if (webReadTrace && !webReadTrace.refs.includes(source.sourcePageJsonRef)) blockers.push(`web_read trace refs must include source page JSON ref ${source.sourcePageJsonRef}`);
  if (webReadTrace && !webReadTrace.refs.includes(source.pageTextRef)) blockers.push(`web_read trace refs must include page text ref ${source.pageTextRef}`);
  if (!manifest.currentRun.search.results.some((result) => result.ref === source.pageRef && /^https?:\/\//.test(result.url))) {
    blockers.push(`source page ${source.pageRef} must be discovered by the current-run web_search result before web_read`);
  }
  if (!/^[a-f0-9]{40}$/.test(source.textSha1)) blockers.push('source page textSha1 must be a SHA-1 hex digest');
  if (!Number.isFinite(Date.parse(source.openedAt))) {
    blockers.push('source page openedAt must be an ISO timestamp');
  } else if (options.now) {
    const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
    if (options.now.getTime() - Date.parse(source.openedAt) > maxAgeMs) blockers.push('source page openedAt is stale and must be produced by the current run');
  }
  if (!/^https?:\/\//.test(source.finalUrl)) blockers.push('source page finalUrl must be an HTTP(S) URL');

  const sourcePageJsonPath = resolveArtifactPath(options.artifactRoot, source.sourcePageJsonPath);
  const pageTextPath = resolveArtifactPath(options.artifactRoot, source.pageTextPath);
  if (!sourcePageJsonPath || !pageTextPath) {
    blockers.push('artifactRoot is required to verify source page JSON and page text files');
    return;
  }

  let sourceJson: WebSearchProductSourcePageJson | undefined;
  try {
    sourceJson = JSON.parse(await readFile(sourcePageJsonPath, 'utf8')) as WebSearchProductSourcePageJson;
  } catch (error) {
    blockers.push(`source page JSON file must exist and parse: ${messageFromError(error)}`);
  }

  let pageText = '';
  try {
    pageText = await readFile(pageTextPath, 'utf8');
  } catch (error) {
    blockers.push(`page text file must exist: ${messageFromError(error)}`);
  }

  if (sourceJson) {
    if (sourceJson.schemaVersion !== WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION) blockers.push(`source page JSON schemaVersion must be ${WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION}`);
    if (sourceJson.runId !== runId) blockers.push('source page JSON must belong to the current run');
    if (sourceJson.pageRef !== source.pageRef) blockers.push('source page JSON current run pageRef must match manifest page ref');
    if (sourceJson.pageTextRef !== source.pageTextRef) blockers.push('source page JSON current run pageTextRef must match manifest page text ref');
    if (sourceJson.textSha1 !== source.textSha1) blockers.push('source page JSON textSha1 must match manifest textSha1');
    if (sourceJson.openedAt !== source.openedAt) blockers.push('source page JSON openedAt must match manifest openedAt');
    if (sourceJson.finalUrl !== source.finalUrl) blockers.push('source page JSON finalUrl must match manifest finalUrl');
  }

  if (pageText) {
    const actualSha1 = sha1(pageText);
    if (actualSha1 !== source.textSha1) blockers.push('page text file SHA-1 must match manifest textSha1');
    if (pageText.length !== source.textChars) blockers.push('page text file length must match manifest textChars');
  }
}

function validateCurrentRunWebRefs(
  manifest: WebSearchProductAcceptanceManifest,
  blockers: string[],
): void {
  const runId = manifest.currentRun?.runId;
  if (!runId) return;
  const refs = uniqueStrings(collectStrings({
    refs: manifest.currentRun.refs,
    toolTrace: manifest.currentRun.toolTrace,
    search: manifest.currentRun.search,
    sourcePages: manifest.currentRun.sourcePages,
    finalAnswer: manifest.finalAnswer,
  }).filter(isWebEvidenceRef));
  for (const ref of refs) {
    if (!webEvidenceRefBelongsToRun(ref, runId)) {
      blockers.push(`web evidence ref ${ref} must belong to the current run ${runId}`);
    }
  }
}

async function validateSearchEvidence(
  manifest: WebSearchProductAcceptanceManifest,
  options: ValidateWebSearchProductAcceptanceOptions,
  blockers: string[],
  webSearchTrace: WebSearchProductToolTraceEntry | undefined,
  expectsProductProof: boolean,
): Promise<void> {
  const runId = manifest.currentRun.runId;
  const search = manifest.currentRun.search;
  if (!search.searchResultRef?.startsWith('web-search:')) blockers.push('search result ref must be a web-search ref from the current run');
  if (search.searchResultRef && !webEvidenceRefBelongsToRun(search.searchResultRef, runId)) {
    blockers.push(`search result ref ${search.searchResultRef} must belong to the current run ${runId}`);
  }
  if (webSearchTrace && !webSearchTrace.refs.includes(search.searchResultRef)) {
    blockers.push(`web_search trace refs must include search result ref ${search.searchResultRef}`);
  }
  if (!Array.isArray(search.results) || search.results.length === 0) {
    blockers.push('web_search evidence must include at least one discovered source result');
  }
  if (expectsProductProof) {
    const route = normalizeRouteEvidence(manifest.currentRun.route, manifest.currentRun);
    const minimumSourceCount = minimumSearchSourceCountFromPrompt(manifest.ordinaryChat?.userPrompt ?? '');
    if (route.provider !== 'native' && route.provider !== 'fallback') {
      blockers.push('product proof must record a native or fallback web_search provider route');
    }
    if (!Number.isInteger(search.sourceCount) || search.sourceCount !== (search.results ?? []).length) {
      blockers.push('product proof must record web_search sourceCount matching current-run source results');
    }
    if (!search.topicRelevance?.topic || search.topicRelevance.matched !== true || search.topicRelevance.matchedSourceRefs.length === 0) {
      blockers.push('product proof must record matched web_search topic relevance for current-run source results');
    }
    if (minimumSourceCount !== undefined && (search.results ?? []).length < minimumSourceCount) {
      blockers.push(`ordinary search prompt requires at least ${minimumSourceCount} sources; currentRun.search.results has ${(search.results ?? []).length}`);
    }
    if (minimumSourceCount !== undefined && (!Number.isInteger(search.sourceCount) || (search.sourceCount ?? 0) < minimumSourceCount)) {
      blockers.push(`ordinary search prompt requires at least ${minimumSourceCount} sources; currentRun.search.sourceCount is ${search.sourceCount ?? 0}`);
    }
  }

  for (const result of search.results ?? []) {
    if (!/^https?:\/\//.test(result.url)) blockers.push(`web_search result URL must be HTTP(S): ${result.url}`);
    if (!result.ref?.startsWith('web-page:')) blockers.push(`web_search result ${result.url} must include a web-page ref`);
    if (result.ref && !webEvidenceRefBelongsToRun(result.ref, runId)) {
      blockers.push(`web_search result ref ${result.ref} must belong to the current run ${runId}`);
    }
    if (result.ref && !manifest.currentRun.refs.includes(result.ref)) {
      blockers.push(`currentRun.refs must include web_search result ref ${result.ref}`);
    }
  }

  const searchResultPath = resolveArtifactPath(options.artifactRoot, search.searchResultPath);
  if (!searchResultPath) {
    blockers.push('artifactRoot is required to verify web_search result artifacts');
    return;
  }

  let searchJson: Record<string, unknown> | undefined;
  try {
    searchJson = JSON.parse(await readFile(searchResultPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    blockers.push(`web_search result artifact must exist and parse: ${messageFromError(error)}`);
    return;
  }

  const artifactRunId = stringField(searchJson.runId);
  if (artifactRunId && artifactRunId !== runId) blockers.push('web_search result artifact must belong to the current run');
  const persistedResults = arrayField(searchJson.results).flatMap(searchResultFromUnknown);
  if (persistedResults.length === 0) blockers.push('web_search result artifact must include source result URLs and refs');
  for (const result of search.results ?? []) {
    if (!persistedResults.some((persisted) => persisted.ref === result.ref && persisted.url === result.url)) {
      blockers.push(`web_search result artifact must include current-run result ${result.ref}`);
    }
  }
}

function validateSearchOnlyFinalAnswer(
  manifest: WebSearchProductAcceptanceManifest,
  blockers: string[],
): void {
  const linkedResults = linkedSearchResultsFromFinalAnswer(manifest);
  if (linkedResults.length === 0) {
    blockers.push('search-only product proof requires final source links that match current-run web_search result URLs');
    return;
  }
  if (!manifest.finalAnswer.supportingRefs.includes(manifest.currentRun.search.searchResultRef)) {
    blockers.push('search-only final answer must support the current-run web_search result ref');
  }
  for (const result of linkedResults) {
    if (!manifest.finalAnswer.supportingRefs.includes(result.ref)) {
      blockers.push(`search-only final answer must support current-run web_search result ref ${result.ref}`);
    }
  }
}

function validatePromptMinimumSourceCoverage(
  manifest: WebSearchProductAcceptanceManifest,
  blockers: string[],
): void {
  const minimumSourceCount = minimumSearchSourceCountFromPrompt(manifest.ordinaryChat?.userPrompt ?? '');
  if (minimumSourceCount === undefined) return;
  const sourceLinks = uniqueStrings((manifest.finalAnswer?.sourceLinks ?? []).filter((link) => /^https?:\/\//.test(link)));
  if (sourceLinks.length < minimumSourceCount) {
    blockers.push(`ordinary search prompt requires at least ${minimumSourceCount} source links; finalAnswer.sourceLinks has ${sourceLinks.length}`);
  }
  const linkedResults = linkedSearchResultsFromFinalAnswer(manifest);
  const supportedLinkedResults = linkedResults.filter((result) => manifest.finalAnswer?.supportingRefs?.includes(result.ref));
  if (supportedLinkedResults.length < minimumSourceCount) {
    blockers.push(`ordinary search prompt requires at least ${minimumSourceCount} supported source refs; finalAnswer.supportingRefs supports ${supportedLinkedResults.length}`);
  }
}

function linkedSearchResultsFromFinalAnswer(
  manifest: WebSearchProductAcceptanceManifest,
): WebSearchProductSearchEvidence['results'] {
  const links = new Set(manifest.finalAnswer?.sourceLinks ?? []);
  const text = manifest.finalAnswer?.text ?? '';
  return (manifest.currentRun?.search?.results ?? [])
    .filter((result) => links.has(result.url) && text.includes(result.url));
}

async function sourceRelevanceBlockers(
  manifest: WebSearchProductAcceptanceManifest,
  sourcePages: WebSearchProductSourcePageEvidence[],
  options: ValidateWebSearchProductAcceptanceOptions,
): Promise<string[]> {
  const spec = agentHostBrowserAcceptanceSpecFromPrompt(manifest.ordinaryChat?.userPrompt);
  const terms = spec.topicalTerms.filter((term) => productProofTopicTermIsConcrete(term));
  if (terms.length === 0 || sourcePages.length === 0) return [];
  const searchResults = manifest.currentRun?.search?.results ?? [];
  const finalAnswerText = manifest.finalAnswer?.text ?? '';
  const sourceTexts = await Promise.all(sourcePages.map(async (source) => {
    const pageTextPath = resolveArtifactPath(options.artifactRoot, source.pageTextPath);
    return pageTextPath ? await readTextIfExists(pageTextPath) ?? '' : '';
  }));
  const matched = sourcePages.some((source, index) => {
    const relatedSearchResults = searchResults.filter((result) => result.ref === source.pageRef);
    const corpus = [
      source.title,
      source.finalUrl,
      finalAnswerText,
      sourceTexts[index],
      ...relatedSearchResults.flatMap((result) => [result.title, result.url, result.snippet]),
    ].join(' ');
    return terms.some((term) => agentHostBrowserTopicTermMatchesText(term, corpus));
  });
  if (matched) return [];
  return [`source relevance gate failed: current-run web_read source must match at least one concrete prompt topic signal (${terms.join(', ')})`];
}

function productProofTopicTermIsConcrete(term: string): boolean {
  const normalized = term.toLowerCase().normalize('NFKC').trim();
  if (!normalized) return false;
  if (/[\p{Script=Han}]/u.test(normalized)) return normalized.length >= 2;
  if (PRODUCT_PROOF_BRAND_ONLY_TOPIC_TERMS.has(normalized)) return false;
  if (PRODUCT_PROOF_TOPIC_STOP_TERMS.has(normalized)) return false;
  return normalized.length >= 3;
}

function normalizeRouteEvidence(
  route: unknown,
  currentRun?: Partial<WebSearchProductAcceptanceManifest['currentRun']>,
): WebSearchProductRouteEvidence {
  const record = recordField(route);
  return {
    provider: searchProviderRouteFromValue(record?.provider) ?? 'unknown',
    evidence: evidenceRouteFromValue(record?.evidence)
      ?? ((currentRun?.sourcePages?.length ?? 0) > 0 ? 'search-read' : 'search-only'),
  };
}

function normalizeCurrentRunEvidence(
  currentRun: WebSearchProductAcceptanceManifest['currentRun'],
  userPrompt: string,
): WebSearchProductAcceptanceManifest['currentRun'] {
  const route = normalizeRouteEvidence(currentRun.route, currentRun);
  return {
    ...currentRun,
    route,
    search: normalizeSearchEvidenceFields(currentRun.search, userPrompt),
    timings: normalizeProductTimings(currentRun.timings, currentRun.toolTrace),
  };
}

function normalizeSearchEvidenceFields(
  search: WebSearchProductSearchEvidence,
  userPrompt: string,
): WebSearchProductSearchEvidence {
  const results = Array.isArray(search.results) ? search.results : [];
  return {
    ...search,
    results,
    sourceCount: Number.isInteger(search.sourceCount) ? search.sourceCount : results.length,
    topicRelevance: search.topicRelevance ?? buildSearchTopicRelevance(search.query, userPrompt, results),
  };
}

function normalizeFinalAnswerEvidence(
  finalAnswer: WebSearchProductAcceptanceManifest['finalAnswer'],
  uiVisible: boolean,
): WebSearchProductAcceptanceManifest['finalAnswer'] {
  return {
    ...finalAnswer,
    uiVisible: finalAnswer.uiVisible ?? uiVisible,
  };
}

function normalizeProductTimings(
  value: unknown,
  toolTrace: WebSearchProductToolTraceEntry[],
): WebSearchProductTimingReport {
  const record = recordField(value);
  const searchMs = numberField(record?.searchMs) ?? durationMsForTool(toolTrace, 'web_search');
  const readMs = numberField(record?.readMs) ?? durationMsForTool(toolTrace, 'web_read');
  const startedAt = stringField(record?.startedAt)
    ?? toolTrace.map((entry) => entry.startedAt).find((timestamp) => Number.isFinite(Date.parse(timestamp)))
    ?? new Date(0).toISOString();
  const completedAt = stringField(record?.completedAt)
    ?? [...toolTrace].reverse().map((entry) => entry.completedAt).find((timestamp) => Number.isFinite(Date.parse(timestamp)))
    ?? startedAt;
  const totalMs = numberField(record?.totalMs)
    ?? [searchMs, readMs].filter((duration): duration is number => Number.isFinite(duration)).reduce((total, duration) => total + duration, 0);
  return {
    startedAt,
    completedAt,
    ...(searchMs !== undefined ? { searchMs } : {}),
    ...(readMs !== undefined ? { readMs } : {}),
    totalMs,
  };
}

function materializeProductTimings(
  observedAt: string,
  searchCompletion: WebToolCompletion | undefined,
  readCompletion: WebToolCompletion | undefined,
): WebSearchProductTimingReport {
  const searchMs = completionTotalMs(searchCompletion);
  const readMs = completionTotalMs(readCompletion);
  const startedAt = searchCompletion?.timestamp ?? observedAt;
  const completedAt = readCompletion?.timestamp ?? searchCompletion?.timestamp ?? observedAt;
  const totalMs = [searchMs, readMs].filter((duration): duration is number => Number.isFinite(duration)).reduce((total, duration) => total + duration, 0);
  return {
    startedAt,
    completedAt,
    ...(searchMs !== undefined ? { searchMs } : {}),
    ...(readMs !== undefined ? { readMs } : {}),
    totalMs,
  };
}

function completionTotalMs(completion: WebToolCompletion | undefined): number | undefined {
  return numberField(recordField(completion?.envelope.timings)?.totalMs);
}

function durationMsForTool(
  toolTrace: WebSearchProductToolTraceEntry[],
  toolName: WebSearchProductToolName,
): number | undefined {
  const entry = toolTrace.find((candidate) => candidate.toolName === toolName);
  if (!entry) return undefined;
  const startedAtMs = Date.parse(entry.startedAt);
  const completedAtMs = Date.parse(entry.completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) return undefined;
  return Math.max(0, completedAtMs - startedAtMs);
}

function buildSearchTopicRelevance(
  query: string,
  userPrompt: string,
  results: WebSearchProductSearchEvidence['results'],
): WebSearchProductTopicRelevance {
  const queryTerms = topicTermsFromText(query);
  const promptTerms = topicTermsFromText(userPrompt).filter((term) => query.toLowerCase().includes(term.toLowerCase()));
  const terms = uniqueStrings([...queryTerms, ...promptTerms]).slice(0, 8);
  const matchedSourceRefs = terms.length === 0
    ? results.map((result) => result.ref)
    : results
      .filter((result) => {
        const corpus = [query, result.title, result.url, result.snippet].join(' ');
        return terms.some((term) => agentHostBrowserTopicTermMatchesText(term, corpus));
      })
      .map((result) => result.ref);
  return {
    topic: query || userPrompt,
    terms,
    matched: matchedSourceRefs.length > 0,
    matchedSourceRefs: uniqueStrings(matchedSourceRefs),
  };
}

function topicTermsFromText(value: string): string[] {
  return agentHostBrowserAcceptanceSpecFromPrompt(value)
    .topicalTerms
    .filter((term) => productProofTopicTermIsConcrete(term));
}

function evidenceRouteFromValue(value: unknown): WebSearchProductEvidenceRoute | undefined {
  if (value === 'search-only' || value === 'search-read') return value;
  return undefined;
}

function searchProviderRouteFromCompletion(
  completion: WebToolCompletion | undefined,
): WebSearchProductSearchProviderRoute {
  if (!completion) return 'unknown';
  const envelope = completion.envelope;
  const data = recordField(envelope.data);
  const candidates = [
    envelope.route,
    envelope.providerRoute,
    envelope.searchRoute,
    envelope.provider,
    data?.route,
    data?.providerRoute,
    data?.searchRoute,
    data?.provider,
  ];
  for (const candidate of candidates) {
    const route = searchProviderRouteFromValue(candidate);
    if (route && route !== 'unknown') return route;
  }
  return 'unknown';
}

function searchProviderRouteFromValue(value: unknown): WebSearchProductSearchProviderRoute | undefined {
  if (value !== 'native' && value !== 'fallback' && typeof value !== 'string') return undefined;
  if (value === 'native' || value === 'fallback') return value;
  const normalized = value.toLowerCase();
  if (normalized === 'unknown') return 'unknown';
  if (/\bnative\b|codex-native|codex\.native/.test(normalized)) return 'native';
  if (/\bfallback\b|searx|sciforge|web-worker|provider-route/.test(normalized)) return 'fallback';
  return normalized.trim() ? 'fallback' : 'unknown';
}

function manifestRequiresReadBackedEvidence(
  manifest: WebSearchProductAcceptanceManifest,
): boolean {
  return manifestCommandRequiresReadBackedEvidence(manifest.ordinaryChat?.userPrompt ?? '');
}

function manifestCommandRequiresReadBackedEvidence(commandText: string): boolean {
  const normalized = commandText.toLowerCase().normalize('NFKC');
  const directiveText = normalized
    .replace(/(?:除非|unless)[^。.!?；;\n]{0,120}(?:不要|不必|无需|不需要|不能|不得|别|do not|don't|dont|without requiring|not required)[^。.!?；;\n]{0,120}(?:web_read|web read)/g, '')
    .replace(/(?:不要|不必|无需|不需要|不能|不得|别)[^。.!?；;\n]{0,80}(?:web_read|web read)/g, '')
    .replace(/(?:do not|don't|dont|no need to|without requiring|not required to)[^。.!?;\n]{0,80}(?:web_read|web read|read)/g, '');
  return /\bweb_read\b|\bweb read\b|source\/page text|page text refs?|actual read|read-required/.test(directiveText)
    || /读取.{0,24}(网页|页面|来源|正文|url|http)/.test(directiveText)
    || /\bread\s+(?:the\s+|a\s+|an\s+|one\s+)?(?:source|page|webpage|url|http)/.test(directiveText)
    || /\bopen\s+(?:the\s+|a\s+|an\s+)?(?:source|page|webpage|url|http)/.test(directiveText);
}

function minimumSearchSourceCountFromPrompt(prompt: string): number | undefined {
  const normalized = prompt.toLowerCase().normalize('NFKC');
  const match = normalized.match(/(?:至少|不少于|不少於)[^\d一二两兩三四五六七八九十]{0,12}([1-9]\d?|[一二两兩三四五六七八九十]{1,3})\s*(?:条|條|个|個|篇|则|則|项|項|sources?|links?|results?)/u)
    ?? normalized.match(/(?:at least|minimum of|no fewer than)\s+([1-9]\d?)\s+(?:sources?|links?|results?|items?)/u);
  if (!match) return undefined;
  const value = numberFromPromptCount(match[1] ?? '');
  return value && value > 1 ? value : undefined;
}

function numberFromPromptCount(value: string): number | undefined {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return chineseSmallNumber(value);
}

function chineseSmallNumber(value: string): number | undefined {
  const normalized = value.replace(/兩/g, '两');
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === '十') return 10;
  if (normalized.endsWith('十')) {
    const prefix = normalized.slice(0, -1);
    return (digits[prefix] ?? 1) * 10;
  }
  const tenIndex = normalized.indexOf('十');
  if (tenIndex >= 0) {
    const prefix = normalized.slice(0, tenIndex);
    const suffix = normalized.slice(tenIndex + 1);
    return (digits[prefix] ?? 1) * 10 + (digits[suffix] ?? 0);
  }
  return digits[normalized];
}

function webEvidenceRefBelongsToRun(ref: string, runId: string): boolean {
  const id = ref.slice(ref.indexOf(':') + 1);
  return id.startsWith(`${runId}/`);
}

const PRODUCT_PROOF_BRAND_ONLY_TOPIC_TERMS = new Set(['openai']);
const PRODUCT_PROOF_TOPIC_STOP_TERMS = new Set([
  'acceptance',
  'api',
  'auto',
  'auto-read',
  'chat',
  'codex',
  'current',
  'default',
  'desktop',
  'diagnostic',
  'docs',
  'documentation',
  'entrypoint',
  'evidence',
  'official',
  'ordinary',
  'page',
  'pages',
  'product',
  'proof',
  'read',
  'run',
  'runtime',
  'scaffold',
  'sciforge',
  'search',
  'source',
  'sources',
  'web',
  'web-read',
  'web-search',
  'web_read',
  'web_search',
]);

function validateLiveOrdinaryChatProductProofShape(
  manifest: WebSearchProductAcceptanceManifest,
  blockers: string[],
): void {
  if (manifest.proofLevel !== 'live-product-proof') blockers.push('product proof must use proofLevel live-product-proof');
  if (manifest.diagnosticOnly !== false) blockers.push('product proof must not be diagnostic-only');
  if (manifest.provider?.kind !== 'live-provider' || manifest.provider.live !== true) blockers.push('product proof must come from a live provider, not an acceptance scaffold');
  if (manifest.ordinaryChat?.entrypoint !== 'desktop-default-chat') blockers.push('product proof must come from the ordinary chat desktop-default-chat entrypoint');
  if (!isProductTaskClass(manifest.ordinaryChat?.taskClass)) blockers.push(`ordinary chat task class must be one of: ${WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.join(', ')}`);
  if (!manifest.ordinaryChat?.conversationId || !manifest.ordinaryChat.userMessageId || !manifest.ordinaryChat.assistantMessageId) {
    blockers.push('product proof must include ordinary chat conversation and message ids');
  }
  if (!manifest.ordinaryChat?.finalAnswerMessageRef) blockers.push('product proof must include the ordinary chat final answer message ref');
  if (!manifest.ordinaryChat?.userPrompt) blockers.push('product proof must include the ordinary chat user prompt');
  if (manifest.finalAnswer?.uiVisible !== true) blockers.push('product proof must record a UI-visible final answer');
}

function validateProductTimingShape(
  manifest: WebSearchProductAcceptanceManifest,
  blockers: string[],
): void {
  const timings = manifest.currentRun?.timings;
  if (!timings) {
    blockers.push('product proof must record current-run web_search timing information');
    return;
  }
  if (!Number.isFinite(Date.parse(timings.startedAt)) || !Number.isFinite(Date.parse(timings.completedAt))) {
    blockers.push('product proof timings must include ISO startedAt and completedAt');
  }
  if (!Number.isFinite(timings.totalMs) || timings.totalMs < 0) {
    blockers.push('product proof timings must include non-negative totalMs');
  }
  if (!Number.isFinite(timings.searchMs) || (timings.searchMs ?? -1) < 0) {
    blockers.push('product proof timings must include non-negative searchMs');
  }
}

async function writeProductSourceJson(
  artifactDir: string,
  sourcePageJsonPath: string,
  input: Omit<WebSearchProductSourcePageJson, 'schemaVersion' | 'sourceTool'>,
): Promise<void> {
  const sourcePageJson: WebSearchProductSourcePageJson = {
    schemaVersion: WEB_SEARCH_PRODUCT_SOURCE_PAGE_SCHEMA_VERSION,
    sourceTool: 'web_read',
    ...input,
  };
  await writeFile(join(artifactDir, sourcePageJsonPath), `${JSON.stringify(sourcePageJson, null, 2)}\n`, 'utf8');
}

async function writeManifest(artifactDir: string, manifest: WebSearchProductAcceptanceManifest): Promise<void> {
  await writeFile(join(artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function makeSearchOnlyProductNegative(manifest: WebSearchProductAcceptanceManifest): void {
  const linkedResult = manifest.currentRun.search.results[0];
  manifest.currentRun.route = {
    provider: 'native',
    evidence: 'search-only',
  };
  manifest.currentRun.toolTrace = manifest.currentRun.toolTrace.filter((entry) => entry.toolName === 'web_search');
  manifest.currentRun.sourcePages = [];
  manifest.currentRun.refs = uniqueStrings([
    manifest.currentRun.search.searchResultRef,
    ...(linkedResult ? [linkedResult.ref] : []),
  ]);
  manifest.finalAnswer = {
    text: linkedResult ? `Current-run search-only answer cites ${linkedResult.url}` : manifest.finalAnswer.text,
    sourceLinks: linkedResult ? [linkedResult.url] : manifest.finalAnswer.sourceLinks,
    supportingRefs: manifest.currentRun.refs,
    finalAnswerPath: manifest.finalAnswer.finalAnswerPath,
    snippetOnly: false,
    verifiedSourcePageRefs: [],
    uiVisible: true,
  };
}

function rewriteRefs(manifest: WebSearchProductAcceptanceManifest, fromRunId: string, toRunId: string): void {
  const rewrite = (ref: string) => ref.replaceAll(`${fromRunId}/`, `${toRunId}/`);
  manifest.currentRun.refs = manifest.currentRun.refs.map(rewrite);
  manifest.currentRun.toolTrace = manifest.currentRun.toolTrace.map((entry) => ({
    ...entry,
    refs: entry.refs.map(rewrite),
  }));
  manifest.currentRun.search = {
    ...manifest.currentRun.search,
    searchResultRef: rewrite(manifest.currentRun.search.searchResultRef),
    topicRelevance: manifest.currentRun.search.topicRelevance ? {
      ...manifest.currentRun.search.topicRelevance,
      matchedSourceRefs: manifest.currentRun.search.topicRelevance.matchedSourceRefs.map(rewrite),
    } : undefined,
    results: manifest.currentRun.search.results.map((result) => ({
      ...result,
      ref: rewrite(result.ref),
    })),
  };
  manifest.currentRun.sourcePages = manifest.currentRun.sourcePages.map((source) => ({
    ...source,
    pageRef: rewrite(source.pageRef),
    sourcePageJsonRef: rewrite(source.sourcePageJsonRef),
    pageTextRef: rewrite(source.pageTextRef),
  }));
  manifest.finalAnswer = {
    ...manifest.finalAnswer,
    supportingRefs: manifest.finalAnswer.supportingRefs.map(rewrite),
    verifiedSourcePageRefs: manifest.finalAnswer.verifiedSourcePageRefs.map(rewrite),
  };
}

function resolveArtifactPath(artifactRoot: string | undefined, path: string): string | undefined {
  if (!path) return undefined;
  if (isAbsolute(path)) return path;
  if (!artifactRoot) return undefined;
  return join(artifactRoot, path);
}

function isEvidenceRef(value: string): boolean {
  return /^(web-search|web-page|web-source|web-text|fixture|gui\.present|screenshot):/i.test(value)
    || /conversation-projection|browserVisibleState|html2canvas|image\/png/i.test(value);
}

function isWebEvidenceRef(value: string): boolean {
  return /^(web-search|web-page|web-source|web-text):/i.test(value);
}

function isProductTaskClass(value: unknown): value is WebSearchProductAcceptanceTaskClass {
  return typeof value === 'string' && WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.includes(value as WebSearchProductAcceptanceTaskClass);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function urlsFromText(value: string): string[] {
  return [...value.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0].replace(/[.,;]+$/, ''));
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false; reason: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, reason }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function collectEventsWithTimeout(
  iterable: AsyncIterable<unknown>,
  timeoutMs: number,
): Promise<{ timedOut: boolean; events: unknown[] }> {
  const iterator = iterable[Symbol.asyncIterator]();
  const events: unknown[] = [];
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      await closeIteratorBestEffort(iterator);
      return { timedOut: true, events };
    }
    const next = await iteratorNextWithTimeout(iterator, remainingMs);
    if (next.kind === 'timeout') {
      await closeIteratorBestEffort(iterator);
      return { timedOut: true, events };
    }
    if (next.value.done) return { timedOut: false, events };
    events.push(next.value.value);
  }
}

async function closeIteratorBestEffort(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    const returned = iterator.return?.();
    if (returned) {
      await Promise.race([
        Promise.resolve(returned).catch(() => undefined),
        delay(100),
      ]);
    }
  } catch {
    // Best-effort cleanup only; the blocked manifest is the product-visible result.
  }
}

async function iteratorNextWithTimeout(
  iterator: AsyncIterator<unknown>,
  timeoutMs: number,
): Promise<{ kind: 'next'; value: IteratorResult<unknown> } | { kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next().then((value) => ({ kind: 'next' as const, value })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function positiveIntegerFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}
