import type { Modality, ModalityTranslation } from './types.js';

export interface ExpertConfig {
  /** Local SciForge Model Router OpenAI-compatible /v1 URL, e.g. http://127.0.0.1:3892/v1. */
  baseUrl: string;
  runtimeApiKey: string;
  /** Per-attempt timeout. GPU model load + inference can be slow, so wait generously. */
  timeoutMs: number;
  /** Max attempts (>= 1). Transient failures are retried — see translateModality. */
  maxAttempts: number;
  /** Exponential backoff base between attempts (ms). */
  retryBaseMs: number;
}

export const MODEL_ROUTER_BASE_URL_ENV = 'SCIFORGE_MODEL_ROUTER_BASE_URL';
export const MODEL_ROUTER_RUNTIME_API_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY';
export const MODEL_ROUTER_TIMEOUT_MS_ENV = 'SCIMODALITY_MODEL_ROUTER_TIMEOUT_MS';
export const MODEL_ROUTER_MAX_ATTEMPTS_ENV = 'SCIMODALITY_MODEL_ROUTER_MAX_ATTEMPTS';
export const MODEL_ROUTER_RETRY_BASE_MS_ENV = 'SCIMODALITY_MODEL_ROUTER_RETRY_BASE_MS';
export const LEGACY_EXPERT_PROVIDER_ENV_PREFIX = 'EXPERT_PROVIDER_';

const MAX_BACKOFF_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_RETRY_BASE_MS = 1_500;
const LOCAL_MODEL_ROUTER_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Modality -> expert model id. These ids are sent only to the local SciForge Model Router,
 * which owns the model/provider boundary for every expert capability.
 */
export const EXPERT_MODEL: Record<Modality, string> = {
  protein: 'esm2text-protein',
  protein_structure: 'prot2text-structure',
  molecule: 'biot5-molecule',
  single_cell: 'c2s-singlecell',
};

// Translate-only system prompt. Mirrors the Model Router vision-translator
// contract: turn the scientific input into faithful textual evidence; do NOT
// reason, plan, answer the user, draw conclusions, or claim task completion.
// Each expert is a domain model that natively generates the description; this
// just states the contract.
const SYSTEM_PROMPT = [
  'You are a SciForge scientific-modality translator.',
  'Convert the provided non-text scientific input into concise, faithful textual evidence for another agent.',
  "Report only what the model generated about the input: its description, salient features, and uncertainty.",
  'Do not reason about the task, answer the user, give advice, draw biological/chemical conclusions,',
  'or claim task completion. You translate scientific signal into words — nothing more.',
].join(' ');

export class ProviderError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function expertConfigFromModelRouterEnv(env: Record<string, string | undefined> = process.env): ExpertConfig {
  rejectLegacyExpertProviderEnv(env);
  return normalizeExpertConfig({
    baseUrl: requiredEnv(env, MODEL_ROUTER_BASE_URL_ENV),
    runtimeApiKey: requiredEnv(env, MODEL_ROUTER_RUNTIME_API_KEY_ENV),
    timeoutMs: positiveIntegerEnv(env, MODEL_ROUTER_TIMEOUT_MS_ENV, DEFAULT_TIMEOUT_MS),
    maxAttempts: positiveIntegerEnv(env, MODEL_ROUTER_MAX_ATTEMPTS_ENV, DEFAULT_MAX_ATTEMPTS),
    retryBaseMs: positiveIntegerEnv(env, MODEL_ROUTER_RETRY_BASE_MS_ENV, DEFAULT_RETRY_BASE_MS),
  });
}

export function normalizeExpertConfig(config: ExpertConfig): ExpertConfig {
  return {
    baseUrl: normalizeLocalModelRouterBaseUrl(config.baseUrl),
    runtimeApiKey: normalizeRuntimeApiKey(config.runtimeApiKey),
    timeoutMs: positiveInteger(config.timeoutMs, 'Model Router timeout'),
    maxAttempts: positiveInteger(config.maxAttempts, 'Model Router max attempts'),
    retryBaseMs: positiveInteger(config.retryBaseMs, 'Model Router retry base'),
  };
}

export function normalizeLocalModelRouterBaseUrl(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw localModelRouterBaseUrlError();
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (
    url.protocol !== 'http:' ||
    !LOCAL_MODEL_ROUTER_HOSTS.has(url.hostname.toLowerCase()) ||
    !url.port ||
    path !== '/v1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw localModelRouterBaseUrlError();
  }
  return `http://${url.host}/v1`;
}

/** Raised when the HTTP caller disconnects mid-translation; stops retrying immediately. */
export class ClientAbortError extends Error {
  constructor() {
    super('modality translation aborted by caller');
    this.name = 'ClientAbortError';
  }
}

/** Could not infer the modality from the payload and the caller gave none. */
export class UndetectableModalityError extends Error {
  constructor() {
    super('could not auto-detect modality; pass an explicit `modality`');
    this.name = 'UndetectableModalityError';
  }
}

/**
 * Translate one scientific input to text via the local SciForge Model Router
 * (OpenAI-compatible chat/completions), retrying transient failures
 * (timeout / 5xx / 429 / network) with exponential backoff. The downstream main
 * agent cannot read these modalities, so there is no useful fallback — this
 * service is the authority on "keep trying until the expert answers". The only
 * non-retryable outcomes are auth failures (401/403), unknown experts (404),
 * and a caller abort.
 */
export async function translateModality(
  config: ExpertConfig,
  modality: Modality,
  payload: string,
  instruction: string | undefined,
  modalitySource: 'explicit' | 'detected',
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ModalityTranslation> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    if (signal?.aborted) throw new ClientAbortError();
    try {
      return await translateOnce(config, modality, payload, instruction, modalitySource, fetchImpl, signal);
    } catch (error) {
      if (signal?.aborted) throw new ClientAbortError();
      lastError = error;
      if (attempt >= config.maxAttempts || !isRetryable(error)) throw error;
      await delay(backoffMs(attempt, config.retryBaseMs), signal);
    }
  }
  throw lastError ?? new ProviderError('local Model Router expert call failed', 502);
}

function isRetryable(error: unknown): boolean {
  // Auth/config errors won't fix themselves by retrying; transient failures might.
  if (error instanceof ProviderError) return ![401, 403, 404].includes(error.httpStatus);
  return true;
}

/** One local Model Router call with a per-attempt timeout. Throws ProviderError / AbortError. */
async function translateOnce(
  config: ExpertConfig,
  modality: Modality,
  payload: string,
  instruction: string | undefined,
  modalitySource: 'explicit' | 'detected',
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ModalityTranslation> {
  const model = EXPERT_MODEL[modality];
  const userText = buildUserText(modality, payload, instruction);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.runtimeApiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    throw new ProviderError(`local Model Router returned HTTP ${response.status} for ${model}`, response.status);
  }
  const payloadJson = (await response.json()) as unknown;
  const summary = extractText(payloadJson).trim();
  if (!summary) throw new ProviderError(`expert ${model} returned empty content`, 502);
  return { summary, modality, model, modalitySource };
}

/**
 * Wrap the payload in the fence the expert-translator parser understands
 * (`User request context: …` + `--- <modality> input --- … --- end … ---`),
 * so each expert receives a clean (instruction, payload) split.
 */
function buildUserText(modality: Modality, payload: string, instruction: string | undefined): string {
  const head = instruction?.trim() ? `User request context: ${instruction.trim()}\n` : '';
  return `${head}--- ${modality} input ---\n${payload.trim()}\n--- end ${modality} input ---`;
}

// --- modality detection -----------------------------------------------------

const AA = 'ACDEFGHIKLMNPQRSTVWY';

/** Split into trimmed, non-empty lines — the shared shape every tabular detector works on. */
function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
}

/**
 * Rule-based modality detection for the four natively-to-text experts (protein, protein
 * structure, molecule, single cell). Pure and deterministic, ordered most-specific-first;
 * throws UndetectableModalityError when no rule matches, so an unsupported input fails loudly
 * rather than being mis-translated. An explicit `modality` on the request always bypasses this.
 */
export function detectModality(payload: string): Modality {
  const text = payload.trim();
  if (!text) throw new UndetectableModalityError();

  // 1) Protein 3D structure: PDB (ATOM/HETATM records) or mmCIF (_atom_site loop). Checked first
  //    — a structure file also carries sequence that would otherwise mis-route to `protein`.
  if (looksLikePDB(text) || looksLikeMmcif(text)) return 'protein_structure';

  // 2) Single-cell expression: gene:value tables, or a bare gene-marker list (one symbol per line).
  if (looksLikeExpressionTable(text) || looksLikeMarkerList(text)) return 'single_cell';

  // 3) Protein sequence: a FASTA-headed body, a multi-line pure-letter block, or a single
  //    whitespace-free token, dominated by the 20 amino-acid codes. Prose is rejected by shape.
  const seq = sequenceCandidate(text);
  if (seq && seq.length >= 10 && !looksLikeSmiles(text) && fractionIn(seq, AA) >= 0.85) {
    return 'protein';
  }

  // 4) SMILES / small molecule: a bare token or an annotated line (e.g. "SMILES: CCO").
  if (smilesCandidate(text)) return 'molecule';

  throw new UndetectableModalityError();
}

/**
 * Return the cleaned upper-case letters if the payload is shaped like a biological sequence,
 * else null. Accepts: a FASTA-headed body (first record only — multiple records are not merged),
 * a multi-line block whose every line is a pure-letter run, or a single whitespace-free token.
 * Prose is rejected because its lines contain spaces/punctuation.
 */
function sequenceCandidate(text: string): string | null {
  if (/^>/m.test(text)) {
    // Take only the first FASTA record's body so two sequences are never concatenated.
    const afterFirstHeader = text.replace(/^[\s\S]*?^>.*$\n?/m, '');
    const body = afterFirstHeader.split(/^>.*$/m)[0] ?? afterFirstHeader;
    return body.replace(/[^A-Za-z]/g, '').toUpperCase() || null;
  }
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return null;
  // Every line must be a pure-letter run; otherwise it's prose or a table, not a raw sequence.
  if (!lines.every((line) => /^[A-Za-z]+$/.test(line))) return null;
  return lines.join('').toUpperCase() || null;
}

/** mmCIF structure file: an _atom_site loop (the coordinate table), the CIF equivalent of PDB ATOM records. */
function looksLikeMmcif(text: string): boolean {
  return /^\s*loop_/m.test(text) && /_atom_site\.(group_PDB|Cartn_x|label_atom_id)/m.test(text);
}

/**
 * Find a SMILES token in the payload, tolerating an annotated line like "SMILES: CCO" and
 * surrounding label lines. Mirrors the molecule expert's parser so detection is not stricter
 * than what the expert can actually consume.
 */
function smilesCandidate(text: string): string | null {
  for (const raw of nonEmptyLines(text)) {
    const line = raw.replace(/^\s*smiles\s*[:=]\s*/i, '');
    if (/^[#>]|^\/\//.test(line)) continue;
    const token = line.split(/\s+/)[0] ?? '';
    if (looksLikeSmiles(token)) return token;
  }
  return null;
}

function fractionIn(letters: string, alphabet: string): number {
  if (!letters.length) return 0;
  let hits = 0;
  for (const ch of letters) if (alphabet.includes(ch)) hits++;
  return hits / letters.length;
}

// PDB 3D structure: standard ATOM/HETATM coordinate records (column-aligned), optionally
// with a HEADER. Require several ATOM records so a stray "ATOM" word in prose never matches.
function looksLikePDB(text: string): boolean {
  const rows = nonEmptyLines(text);
  let atomRecords = 0;
  for (const row of rows) {
    if (/^(ATOM|HETATM)\s+\d+\s+/.test(row)) atomRecords++;
    if (atomRecords >= 8) return true;
  }
  return false;
}

function looksLikeSmiles(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t) || t.length < 2 || t.length > 600) return false; // SMILES is a single token
  if (!/[A-Za-z]/.test(t)) return false;
  // Bond/branch/ring grammar that sequences never contain.
  const grammar = /[()\[\]=#@+\-\\/.]|[0-9]/;
  const organic = /[BCNOPSFIbcnops]/;
  return grammar.test(t) && organic.test(t);
}

function looksLikeExpressionTable(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 2) return false;
  // gene:value or gene<tab/comma>value pairs, or a header with many gene-like columns.
  let geneValueRows = 0;
  for (const row of rows) {
    if (/^[A-Za-z][A-Za-z0-9_.-]{1,20}[\s,:=\t]+-?\d+(\.\d+)?$/.test(row)) geneValueRows++;
  }
  if (geneValueRows >= Math.max(2, Math.floor(rows.length * 0.5))) return true;
  return /\b(gene|cell|expression|counts?|umi|cluster|marker)\b/i.test(text) && /[,\t]/.test(text);
}

// Bare gene-marker list: 3+ lines, each a single gene-symbol-like token (HGNC style, contains an
// uppercase letter; rejects lowercase prose and multi-word lines).
function looksLikeMarkerList(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 3) return false;
  let geneRows = 0;
  for (const row of rows) {
    if (/^[A-Za-z][A-Za-z0-9.-]{1,11}$/.test(row) && /[A-Z]/.test(row)) geneRows++;
  }
  return geneRows >= Math.max(3, Math.floor(rows.length * 0.8));
}

/** Exponential backoff (base, 2×, 4×, …) capped at MAX_BACKOFF_MS. */
function backoffMs(attempt: number, base: number): number {
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Sleep that rejects (ClientAbortError) the moment the caller disconnects. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ClientAbortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ClientAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function rejectLegacyExpertProviderEnv(env: Record<string, string | undefined>): void {
  const hasLegacy = Object.keys(env).some((name) => name.startsWith(LEGACY_EXPERT_PROVIDER_ENV_PREFIX) && env[name]?.trim());
  if (!hasLegacy) return;
  throw new Error(
    `Legacy ${LEGACY_EXPERT_PROVIDER_ENV_PREFIX}* environment variables are not supported by sci-modality-router. ` +
      `Configure ${MODEL_ROUTER_BASE_URL_ENV} and ${MODEL_ROUTER_RUNTIME_API_KEY_ENV} for a local SciForge Model Router /v1 endpoint.`,
  );
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveIntegerEnv(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return positiveInteger(parsed, name);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function normalizeRuntimeApiKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${MODEL_ROUTER_RUNTIME_API_KEY_ENV} is required for local Model Router access.`);
  return normalized;
}

function localModelRouterBaseUrlError(): Error {
  return new Error(`${MODEL_ROUTER_BASE_URL_ENV} must be a local SciForge Model Router URL: http://127.0.0.1:<port>/v1.`);
}

function extractText(payload: unknown): string {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) ? (asString(part.text) ?? asString(part.content) ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
