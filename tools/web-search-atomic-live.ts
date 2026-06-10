import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { ModuleResultEnvelope } from '../packages/contracts/runtime/modules.js';
import {
  WEB_READ_INPUT_SCHEMA_VERSION,
  WEB_READ_INTENT,
  WEB_SEARCH_INPUT_SCHEMA_VERSION,
  WEB_SEARCH_INTENT,
  createWebRuntimeModuleHandler,
  type WebRuntimeToolResult,
} from '../src/runtime/modules/web-runtime-module-handler.js';

const DEFAULT_OUT = 'docs/test-artifacts/web-search-atomic-live/manifest.json';
const DEFAULT_QUERY = '!mdn Fetch API';
const DEFAULT_PRESET = 'docs';
const DEFAULT_SEARXNG_BASE_URL = 'http://127.0.0.1:18890';

type AtomicLiveStatus = 'passed' | 'blocked';

interface AtomicLiveManifest {
  schemaVersion: 'sciforge.web-search.atomic-live.v1';
  status: AtomicLiveStatus;
  diagnosticOnly: true;
  productProof: false;
  releaseEligible: false;
  observedAt: string;
  workspacePath: string;
  query: string;
  providerEnv: {
    searxngBaseUrl?: string;
    searxngPreset?: string;
    searxngEngines?: string;
    searxngCategories?: string;
  };
  search?: {
    status: string;
    provider?: string;
    resultSetRef?: string;
    selectedPageRef?: string;
    selectedUrl?: string;
    resultCount: number;
    refs: string[];
    warnings: string[];
    diagnostics: unknown[];
  };
  read?: {
    status: string;
    provider?: string;
    finalUrl?: string;
    sourceRef?: string;
    pageTextRef?: string;
    textSha1?: string;
    charCount?: number;
    refs: string[];
    warnings: string[];
    diagnostics: unknown[];
  };
  timings: {
    searchTotalMs?: number;
    readTotalMs?: number;
    totalMs: number;
  };
  refs: string[];
  blockers: string[];
}

interface CliArgs {
  out: string;
  workspacePath: string;
  query: string;
  preset?: string;
  limit: number;
  json: boolean;
}

export async function runWebSearchAtomicLive(args: CliArgs = parseArgs(process.argv.slice(2), process.env)): Promise<AtomicLiveManifest> {
  const startedAt = Date.now();
  const workspacePath = resolve(args.workspacePath);
  const hasProviderBase = Boolean(firstNonEmpty(
    process.env.SCIFORGE_SEARXNG_BASE_URL,
    process.env.SCIFORGE_WEB_SEARCH_SEARXNG_BASE_URL,
    process.env.SEARXNG_BASE_URL,
    process.env.SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL,
    process.env.SCIFORGE_WEB_SEARCH_BASE_URL,
    process.env.WEB_SEARCH_PROVIDER_BASE_URL,
  ));
  const env = {
    ...process.env,
    ...(!hasProviderBase ? { SCIFORGE_SEARXNG_BASE_URL: DEFAULT_SEARXNG_BASE_URL } : {}),
    ...(args.preset && !process.env.SCIFORGE_SEARXNG_PRESET && !process.env.SCIFORGE_SEARXNG_ENGINES ? { SCIFORGE_SEARXNG_PRESET: args.preset } : {}),
  } as NodeJS.ProcessEnv;
  const handler = createWebRuntimeModuleHandler({ workspacePath, env });
  const blockers: string[] = [];
  const refs = new Set<string>();

  let searchValue: WebRuntimeToolResult | undefined;
  let readValue: WebRuntimeToolResult | undefined;

  const searchResult = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: args.query,
      limit: args.limit,
      timeoutMs: 30_000,
    },
  }) as ModuleResultEnvelope | undefined;
  if (!searchResult?.ok) blockers.push(`web_search failed: ${String(searchResult?.error ?? 'unknown_error')}`);
  searchValue = searchResult?.value as WebRuntimeToolResult | undefined;
  for (const ref of searchValue?.refs ?? []) refs.add(ref);
  const selected = firstReadableCandidate(searchValue);
  if (!selected?.resourceRef) blockers.push('web_search did not return a readable web-page ref');

  if (selected?.resourceRef) {
    const readResult = await handler.invoke?.({
      moduleId: 'web',
      intent: WEB_READ_INTENT,
      input: {
        schemaVersion: WEB_READ_INPUT_SCHEMA_VERSION,
        resourceRef: selected.resourceRef,
        format: 'markdown',
        maxChars: 12_000,
        timeoutMs: 30_000,
        render: 'static',
      },
    }) as ModuleResultEnvelope | undefined;
    if (!readResult?.ok) blockers.push(`web_read failed: ${String(readResult?.error ?? 'unknown_error')}`);
    readValue = readResult?.value as WebRuntimeToolResult | undefined;
    for (const ref of readValue?.refs ?? []) refs.add(ref);
  }

  const sourceRef = stringAt(readValue?.data?.source, 'sourceRef');
  const pageTextRef = stringAt(readValue?.data?.source, 'pageTextRef') ?? stringAt(readValue?.data?.content, 'textRef');
  if (readValue?.ok && !sourceRef) blockers.push('web_read passed without a source ref');
  if (readValue?.ok && !pageTextRef) blockers.push('web_read passed without a page text ref');
  if (readValue?.ok && (readValue.data?.content?.charCount ?? 0) < 80) blockers.push('web_read page text is too short for a meaningful atomic proof');

  const manifest: AtomicLiveManifest = {
    schemaVersion: 'sciforge.web-search.atomic-live.v1',
    status: blockers.length ? 'blocked' : 'passed',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    observedAt: new Date().toISOString(),
    workspacePath,
    query: args.query,
    providerEnv: {
      searxngBaseUrl: firstNonEmpty(env.SCIFORGE_SEARXNG_BASE_URL, env.SCIFORGE_WEB_SEARCH_SEARXNG_BASE_URL, env.SEARXNG_BASE_URL),
      searxngPreset: env.SCIFORGE_SEARXNG_PRESET,
      searxngEngines: env.SCIFORGE_SEARXNG_ENGINES,
      searxngCategories: env.SCIFORGE_SEARXNG_CATEGORIES,
    },
    search: searchValue ? {
      status: searchValue.status,
      provider: searchValue.provider,
      resultSetRef: stringAt(searchValue.data, 'resultSetRef'),
      selectedPageRef: selected?.resourceRef,
      selectedUrl: selected?.url,
      resultCount: Array.isArray(searchValue.data?.results) ? searchValue.data.results.length : 0,
      refs: searchValue.refs,
      warnings: searchValue.warnings,
      diagnostics: searchValue.diagnostics,
    } : undefined,
    read: readValue ? {
      status: readValue.status,
      provider: readValue.provider,
      finalUrl: stringAt(readValue.data?.source, 'finalUrl'),
      sourceRef,
      pageTextRef,
      textSha1: stringAt(readValue.data?.source, 'textSha1'),
      charCount: typeof readValue.data?.content?.charCount === 'number' ? readValue.data.content.charCount : undefined,
      refs: readValue.refs,
      warnings: readValue.warnings,
      diagnostics: readValue.diagnostics,
    } : undefined,
    timings: {
      searchTotalMs: numberAt(searchValue?.timings, 'totalMs'),
      readTotalMs: numberAt(readValue?.timings, 'totalMs'),
      totalMs: Date.now() - startedAt,
    },
    refs: [...refs],
    blockers,
  };

  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (args.json) console.log(JSON.stringify(manifest, null, 2));
  else console.log(`${manifest.status}: wrote ${resolve(args.out)}`);
  return manifest;
}

function firstReadableCandidate(value: WebRuntimeToolResult | undefined): { resourceRef?: string; url?: string } | undefined {
  const results = value?.data?.results;
  if (!Array.isArray(results)) return undefined;
  return results.find((item) => typeof item?.resourceRef === 'string' && typeof item?.url === 'string');
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') {
      json = true;
      continue;
    }
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, 'true');
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return {
    out: values.get('out') ?? env.SCIFORGE_WEB_SEARCH_ATOMIC_LIVE_OUT ?? DEFAULT_OUT,
    workspacePath: values.get('workspace') ?? env.SCIFORGE_WEB_SEARCH_ATOMIC_LIVE_WORKSPACE ?? process.cwd(),
    query: values.get('query') ?? env.SCIFORGE_WEB_SEARCH_ATOMIC_LIVE_QUERY ?? DEFAULT_QUERY,
    preset: values.get('preset') ?? env.SCIFORGE_WEB_SEARCH_ATOMIC_LIVE_PRESET ?? DEFAULT_PRESET,
    limit: positiveInteger(values.get('limit') ?? env.SCIFORGE_WEB_SEARCH_ATOMIC_LIVE_LIMIT) ?? 5,
    json,
  };
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function stringAt(value: unknown, key: string): string | undefined {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[key] === 'string'
    ? String((value as Record<string, unknown>)[key])
    : undefined;
}

function numberAt(value: unknown, key: string): number | undefined {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[key] === 'number'
    ? Number((value as Record<string, unknown>)[key])
    : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebSearchAtomicLive().then((manifest) => {
    if (manifest.status !== 'passed') process.exitCode = 2;
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
