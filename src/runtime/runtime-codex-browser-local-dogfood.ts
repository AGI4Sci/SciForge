import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readRequiredLocalProviderSettings, type LocalProviderSettings } from '../../packages/backend/src/local-provider-config.js';
import {
  BrowserHostSessionManager,
  createPlaywrightBrowserHostDriverFactory,
  defaultBrowserHostSessionManager,
  type BrowserHostDiscoveryOutput,
} from './browser-host-session.js';
import { sha1 } from './workspace-task-runner.js';

export const RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION = 'sciforge.runtime-codex.browser-local-dogfood.v1' as const;

export interface RuntimeCodexBrowserLocalDogfoodManifest {
  schemaVersion: typeof RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION;
  status: 'passed' | 'blocked' | 'failed';
  source: 'codex-in-app-browser-local-dogfood';
  observedAt: string;
  taskPromptDigest: BoundedTextEvidence;
  localConfig: {
    present: boolean;
    providerPresent: boolean;
    modelPresent: boolean;
    upstreamBaseUrlPresent: boolean;
    apiKeyPresent: boolean;
    source: 'config.local.json';
    secretValuesRedacted: true;
  };
  browserSessionRef?: string;
  playwrightAdapterTraceRef?: string;
  searchResultRef?: string;
  sourcePageRefs: string[];
  pageTextRefs: string[];
  finalAnswerRef?: string;
  finalAnswer?: string;
  actuallyReadPages: Array<{
    title: string;
    url: string;
    sourcePageRef: string;
    textRef: string;
  }>;
  blockedReason?: string;
  releaseGate: {
    status: 'local-dogfood-only';
    strictReleaseStillRequiresServiceEnv: true;
    retestCommand: string;
  };
}

export interface BoundedTextEvidence {
  length: number;
  sha1: string;
}

export interface RunRuntimeCodexBrowserLocalDogfoodOptions {
  workspacePath?: string;
  configPath?: string;
  outputDir?: string;
  prompt?: string;
  query?: string;
  manager?: BrowserHostSessionManager;
  now?: () => Date;
}

const DEFAULT_PROMPT = '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新：打开官方来源页，读取内容，给出 5 条以内中文摘要，列出来源链接，并明确说明哪些页面被实际读取。';
const DEFAULT_QUERY = 'site:developers.openai.com/api/docs/changelog OpenAI API changelog latest product update official';
const OFFICIAL_OPENAI_PREFERRED_RESULTS = [
  {
    title: 'OpenAI API changelog',
    url: 'https://platform.openai.com/docs/changelog',
    snippet: 'Official OpenAI API product changelog.',
  },
  {
    title: 'OpenAI models documentation',
    url: 'https://platform.openai.com/docs/models',
    snippet: 'Official OpenAI models documentation.',
  },
];

export async function runRuntimeCodexBrowserLocalDogfood(
  options: RunRuntimeCodexBrowserLocalDogfoodOptions = {},
): Promise<RuntimeCodexBrowserLocalDogfoodManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'evolve', 'runs', 'runtime-codex-browser-local-dogfood'));
  const now = options.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const query = options.query ?? DEFAULT_QUERY;
  let settings: LocalProviderSettings;
  try {
    settings = readRequiredLocalProviderSettings(options.configPath);
  } catch (error) {
    const blockedReason = error instanceof Error ? error.message : String(error);
    const manifest = blockedManifest({ observedAt, prompt, blockedReason });
    await writeLocalDogfoodArtifacts(outputDir, manifest);
    return manifest;
  }

  try {
    const manager = options.manager ?? createLocalDogfoodBrowserHostSessionManager();
    const closeOwnedSession = options.manager ? undefined : async (sessionId: string) => {
      await manager.act(workspacePath, sessionId, { action: 'close', capture: 'none', timeoutMs: 5_000 }).catch(() => undefined);
    };
    const output = await manager.search(workspacePath, {
      query,
      limit: 5,
      sourcePageLimit: 3,
      timeoutMs: 90_000,
      preferredResults: OFFICIAL_OPENAI_PREFERRED_RESULTS,
    });
    const readPages = officialOpenAiReadSourcePages(output);
    if (!readPages.length) {
      const manifest = failedManifest({
        observedAt,
        prompt,
        settings,
        output,
        blockedReason: 'BrowserHostSession browser.search + browser.read did not return any non-empty official source page text refs.',
      });
      await writeLocalDogfoodArtifacts(outputDir, manifest);
      await closeOwnedSession?.(output.session.id);
      return manifest;
    }

    const finalAnswer = localDogfoodFinalAnswer({
      query,
      readPages,
    });
    const finalAnswerRef = await writeFinalAnswer(outputDir, finalAnswer);
    const manifest: RuntimeCodexBrowserLocalDogfoodManifest = {
      schemaVersion: RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION,
      status: 'passed',
      source: 'codex-in-app-browser-local-dogfood',
      observedAt,
      taskPromptDigest: boundedTextEvidence(prompt),
      localConfig: localConfigEvidence(settings),
      browserSessionRef: `browser-host-session:${output.session.id}`,
      playwrightAdapterTraceRef: output.session.automationSummary?.refs.find((ref) => /browser-host-session:/i.test(ref.ref))?.ref,
      searchResultRef: output.searchResultRef,
      sourcePageRefs: readPages.map((page) => page.sourcePageRef).filter((ref): ref is string => Boolean(ref)),
      pageTextRefs: readPages.map((page) => page.textRef).filter((ref): ref is string => Boolean(ref)),
      finalAnswerRef,
      finalAnswer,
      actuallyReadPages: readPages.map((page) => ({
        title: page.title,
        url: page.finalUrl || page.url,
        sourcePageRef: page.sourcePageRef ?? '',
        textRef: page.textRef ?? '',
      })),
      releaseGate: releaseGate(),
    };
    await writeLocalDogfoodArtifacts(outputDir, manifest);
    await closeOwnedSession?.(output.session.id);
    return manifest;
  } catch (error) {
    const manifest = failedManifest({
      observedAt,
      prompt,
      settings,
      blockedReason: error instanceof Error ? error.message : String(error),
    });
    await writeLocalDogfoodArtifacts(outputDir, manifest);
    return manifest;
  }
}

async function writeLocalDogfoodArtifacts(outputDir: string, manifest: RuntimeCodexBrowserLocalDogfoodManifest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(redactedManifest(manifest), null, 2), 'utf8');
  if (manifest.finalAnswer) await writeFile(join(outputDir, 'final-answer.md'), manifest.finalAnswer, 'utf8');
}

async function writeFinalAnswer(outputDir: string, answer: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const fileName = 'final-answer.md';
  await writeFile(join(outputDir, fileName), answer, 'utf8');
  return `artifact:runtime-codex-browser-local-dogfood/${fileName}`;
}

function blockedManifest(input: {
  observedAt: string;
  prompt: string;
  blockedReason: string;
}): RuntimeCodexBrowserLocalDogfoodManifest {
  return {
    schemaVersion: RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION,
    status: 'blocked',
    source: 'codex-in-app-browser-local-dogfood',
    observedAt: input.observedAt,
    taskPromptDigest: boundedTextEvidence(input.prompt),
    localConfig: {
      present: false,
      providerPresent: false,
      modelPresent: false,
      upstreamBaseUrlPresent: false,
      apiKeyPresent: false,
      source: 'config.local.json',
      secretValuesRedacted: true,
    },
    sourcePageRefs: [],
    pageTextRefs: [],
    actuallyReadPages: [],
    blockedReason: input.blockedReason,
    releaseGate: releaseGate(),
  };
}

function failedManifest(input: {
  observedAt: string;
  prompt: string;
  settings: LocalProviderSettings;
  output?: BrowserHostDiscoveryOutput;
  blockedReason: string;
}): RuntimeCodexBrowserLocalDogfoodManifest {
  const readPages = input.output ? officialOpenAiReadSourcePages(input.output) : [];
  return {
    schemaVersion: RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION,
    status: 'failed',
    source: 'codex-in-app-browser-local-dogfood',
    observedAt: input.observedAt,
    taskPromptDigest: boundedTextEvidence(input.prompt),
    localConfig: localConfigEvidence(input.settings),
    browserSessionRef: input.output ? `browser-host-session:${input.output.session.id}` : undefined,
    searchResultRef: input.output?.searchResultRef,
    sourcePageRefs: readPages.map((page) => page.sourcePageRef).filter((ref): ref is string => Boolean(ref)),
    pageTextRefs: readPages.map((page) => page.textRef).filter((ref): ref is string => Boolean(ref)),
    actuallyReadPages: readPages.map((page) => ({
      title: page.title,
      url: page.finalUrl || page.url,
      sourcePageRef: page.sourcePageRef ?? '',
      textRef: page.textRef ?? '',
    })),
    blockedReason: input.blockedReason,
    releaseGate: releaseGate(),
  };
}

function readSourcePages(output: BrowserHostDiscoveryOutput) {
  return (output.sourcePages ?? []).filter((page) => (
    page.status === 'read'
    && Boolean(page.textRef)
    && Boolean(page.sourcePageRef)
    && (page.textCharCount ?? 0) > 0
  ));
}

function officialOpenAiReadSourcePages(output: BrowserHostDiscoveryOutput) {
  return readSourcePages(output).filter((page) => isOfficialOpenAiUrl(page.finalUrl || page.url));
}

function localDogfoodFinalAnswer(input: {
  query: string;
  readPages: NonNullable<BrowserHostDiscoveryOutput['sourcePages']>;
}) {
  const summaryLines = conciseOpenAiSourceSummaries(input.readPages).slice(0, 5);
  const headline = `我已用 SciForge 内置浏览器搜索“${cleanText(input.query)}”，并打开、读取了 OpenAI 官方来源页面。`;
  const summary = summaryLines.length
    ? [
        headline,
        '',
        ...summaryLines.map((line) => `- ${line}`),
      ].join('\n')
    : `${headline}\n\n读取到官方来源页面，但本地 dogfood 未生成面向用户的任务答案；最终回答必须由 Codex / Agent Host 基于 refs 和 verifier 决策后通过 gui.present 产生。`;
  return [
    summary,
    '',
    '实际读取页面：',
    ...input.readPages.map((page) => `- ${cleanText(page.title) || 'OpenAI 官方来源'} ${page.finalUrl || page.url}`),
  ].join('\n');
}

function conciseOpenAiSourceSummaries(pages: NonNullable<BrowserHostDiscoveryOutput['sourcePages']>) {
  const lines: string[] = [];
  for (const page of pages) {
    const text = cleanText(page.textSummary || page.textPreview || '');
    if (!text) continue;
    const changelogEntries = extractChangelogEntries(text);
    if (changelogEntries.length) {
      lines.push(...changelogEntries.map((entry) => `${entry} 来源：${page.finalUrl || page.url}`));
      continue;
    }
    if (isOpenAiDocsNavigationPage(page, text)) continue;
    const useful = stripCommonOpenAiDocsNavigation(text);
    if (useful) lines.push(`${cleanText(page.title) || 'OpenAI 官方来源'}：${truncateAtWord(useful, 260)} 来源：${page.finalUrl || page.url}`);
  }
  return lines;
}

function isOpenAiDocsNavigationPage(page: NonNullable<BrowserHostDiscoveryOutput['sourcePages']>[number], text: string) {
  const title = cleanText(page.title).toLowerCase();
  const url = (page.finalUrl || page.url || '').toLowerCase();
  const looksLikeDocsNav = /^Home API Codex ChatGPT Resources Start searching API Dashboard/i.test(text);
  const isChangelog = /changelog/i.test(title) || /\/changelog\b/i.test(url);
  const looksLikeUpdateSource = /\b(?:product update|release notes|changelog)\b/i.test(title);
  return looksLikeDocsNav && !isChangelog && !looksLikeUpdateSource;
}

function extractChangelogEntries(text: string) {
  const normalized = stripCommonOpenAiDocsNavigation(text);
  const entries: string[] = [];
  const entryPattern = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Feature|Update|Deprecation|Fix|Preview|Release)\b[\s\S]*?(?=\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Feature|Update|Deprecation|Fix|Preview|Release)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December),\s+\d{4}\b|$)/g;
  for (const match of normalized.matchAll(entryPattern)) {
    const entry = truncateAtWord(cleanText(match[0]), 420);
    if (entry) entries.push(entry);
    if (entries.length >= 5) break;
  }
  return entries;
}

function stripCommonOpenAiDocsNavigation(text: string) {
  const entryIndex = text.search(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Feature|Update|Deprecation|Fix|Preview|Release)\b/);
  if (entryIndex >= 0) return text.slice(entryIndex).trim();
  const changelogIndex = text.search(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December),\s+\d{4}\b/);
  if (changelogIndex >= 0) return text.slice(changelogIndex).trim();
  const latestIndex = text.search(/\bLatest:\b/i);
  if (latestIndex >= 0) return text.slice(latestIndex).trim();
  return text.replace(/^Home API Codex ChatGPT Resources Start searching API Dashboard\s*/i, '').trim();
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, Math.max(0, maxLength - 3));
  const boundary = slice.lastIndexOf(' ');
  const prefix = boundary >= Math.floor(maxLength * 0.65) ? slice.slice(0, boundary) : slice;
  return `${prefix.trimEnd()}...`;
}

function isOfficialOpenAiUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'openai.com' || hostname.endsWith('.openai.com');
  } catch {
    return false;
  }
}

function localConfigEvidence(settings: LocalProviderSettings): RuntimeCodexBrowserLocalDogfoodManifest['localConfig'] {
  return {
    present: true,
    providerPresent: Boolean(settings.provider),
    modelPresent: Boolean(settings.model),
    upstreamBaseUrlPresent: Boolean(settings.baseUrl),
    apiKeyPresent: Boolean(settings.apiKey),
    source: 'config.local.json',
    secretValuesRedacted: true,
  };
}

function boundedTextEvidence(value: string): BoundedTextEvidence {
  return { length: Buffer.byteLength(value, 'utf8'), sha1: sha1(value) };
}

function releaseGate(): RuntimeCodexBrowserLocalDogfoodManifest['releaseGate'] {
  return {
    status: 'local-dogfood-only',
    strictReleaseStillRequiresServiceEnv: true,
    retestCommand: 'npm run smoke:runtime-codex-browser-acceptance:strict',
  };
}

function redactedManifest(manifest: RuntimeCodexBrowserLocalDogfoodManifest): RuntimeCodexBrowserLocalDogfoodManifest {
  return JSON.parse(JSON.stringify(manifest)) as RuntimeCodexBrowserLocalDogfoodManifest;
}

function createLocalDogfoodBrowserHostSessionManager(): BrowserHostSessionManager {
  if (process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL?.trim()) return defaultBrowserHostSessionManager();
  return new BrowserHostSessionManager({ driverFactory: createPlaywrightBrowserHostDriverFactory() });
}
