import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const KV_GROUND_SMOKE_SCHEMA_VERSION = 'sciforge.kv-ground-smoke.v1' as const;
export const DEFAULT_KV_GROUND_SMOKE_OUT = join('docs', 'test-artifacts', 'kv-ground-smoke', 'kv-ground-smoke.json');
export const DEFAULT_KV_GROUND_SMOKE_TEXT = 'center of the red target square';

type KvGroundSmokeStatus = 'passed' | 'blocked';

export interface KvGroundSmokeManifest {
  schemaVersion: typeof KV_GROUND_SMOKE_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  status: KvGroundSmokeStatus;
  endpoint: string;
  checks: {
    health: {
      ok: boolean;
      httpStatus?: number;
      latencyMs: number;
      error?: string;
    };
    predict: {
      ok: boolean;
      httpStatus?: number;
      latencyMs?: number;
      coordinates?: [number, number];
      text?: string;
      raw_text?: string;
      error?: string;
    };
  };
  predictRequest: {
    textPrompt: string;
    coordinateSpace: 'window-local';
    image: {
      inline: true;
      source: 'default-inline-image' | 'file';
      mimeType: string;
      bytes: number;
      sha256: string;
    };
  };
}

export interface KvGroundSmokeCliArgs {
  endpoint?: string;
  imagePath?: string;
  outPath: string;
  text: string;
}

export interface RunKvGroundSmokeOptions {
  endpoint?: string;
  imagePath?: string;
  outPath?: string;
  text?: string;
  runId?: string;
  createdAt?: string;
  timeoutMs?: number;
  root?: string;
}

interface JsonHttpResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  body?: unknown;
  error?: string;
}

interface ResolvedEndpoint {
  displayEndpoint: string;
  requestEndpoint: string;
  headers: Record<string, string>;
}

interface SmokeImage {
  bytes: Buffer;
  mimeType: string;
  source: 'default-inline-image' | 'file';
}

export function parseKvGroundSmokeCliArgs(argv: string[]): KvGroundSmokeCliArgs {
  const args: KvGroundSmokeCliArgs = {
    outPath: DEFAULT_KV_GROUND_SMOKE_OUT,
    text: DEFAULT_KV_GROUND_SMOKE_TEXT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--endpoint') {
      args.endpoint = requiredArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--image') {
      args.imagePath = requiredArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--out') {
      args.outPath = requiredArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--text') {
      args.text = requiredArg(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown KV-Ground smoke argument: ${arg}`);
  }

  return args;
}

export async function runKvGroundSmoke(options: RunKvGroundSmokeOptions = {}): Promise<KvGroundSmokeManifest> {
  const root = options.root ?? process.cwd();
  const outPath = options.outPath ?? DEFAULT_KV_GROUND_SMOKE_OUT;
  const rawEndpoint = await configuredKvGroundEndpoint(options.endpoint, root);
  if (!rawEndpoint) {
    throw new Error('KV-Ground endpoint is required; pass --endpoint or set SCIFORGE_VISION_KV_GROUND_URL.');
  }

  const endpoint = resolveKvGroundEndpoint(rawEndpoint);
  const image = await loadSmokeImage(options.imagePath);
  const text = options.text ?? DEFAULT_KV_GROUND_SMOKE_TEXT;
  const timeoutMs = options.timeoutMs ?? timeoutMsFromEnv() ?? 30000;
  const predictRequest = {
    textPrompt: sanitizeSecretText(text) ?? '',
    coordinateSpace: 'window-local' as const,
    image: {
      inline: true as const,
      source: image.source,
      mimeType: image.mimeType,
      bytes: image.bytes.byteLength,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
    },
  };

  const health = await requestJson({
    url: endpointUrl(endpoint.requestEndpoint, '/health'),
    method: 'GET',
    headers: endpoint.headers,
    timeoutMs,
  });
  const healthOk = health.ok && isRecord(health.body) && health.body.ok === true;

  let predict: JsonHttpResult | undefined;
  let coordinates: [number, number] | undefined;
  let predictBody: Record<string, unknown> | undefined;
  if (healthOk) {
    predict = await requestJson({
      url: endpointUrl(endpoint.requestEndpoint, '/predict/'),
      method: 'POST',
      headers: endpoint.headers,
      body: {
        image_base64: image.bytes.toString('base64'),
        image_mime_type: image.mimeType,
        text_prompt: text,
        coordinate_space: predictRequest.coordinateSpace,
      },
      timeoutMs,
    });
    predictBody = isRecord(predict.body) ? predict.body : undefined;
    coordinates = predict.ok ? parsePredictCoordinates(predictBody) : undefined;
  }

  const predictOk = Boolean(predict?.ok && coordinates);
  const manifest: KvGroundSmokeManifest = {
    schemaVersion: KV_GROUND_SMOKE_SCHEMA_VERSION,
    runId: options.runId ?? `kv-ground-smoke-${Date.now()}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    status: healthOk && predictOk ? 'passed' : 'blocked',
    endpoint: endpoint.displayEndpoint,
    checks: {
      health: compactRecord({
        ok: healthOk,
        httpStatus: health.httpStatus,
        latencyMs: health.latencyMs,
        error: healthOk ? undefined : health.error ?? 'KV-Ground /health did not return ok=true.',
      }),
      predict: compactRecord({
        ok: predictOk,
        httpStatus: predict?.httpStatus,
        latencyMs: predict?.latencyMs,
        coordinates,
        text: sanitizeSecretText(stringValue(predictBody?.text)),
        raw_text: sanitizeSecretText(stringValue(predictBody?.raw_text)),
        error: predictOk
          ? undefined
          : predict?.error ?? (healthOk ? 'KV-Ground /predict/ did not return usable coordinates.' : 'Skipped because /health was not ok.'),
      }),
    },
    predictRequest,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export function resolveKvGroundEndpoint(rawEndpoint: string): ResolvedEndpoint {
  const url = new URL(withHttpScheme(rawEndpoint.trim()));
  const headers: Record<string, string> = {};
  if (url.username || url.password) {
    const username = decodeURIComponentSafe(url.username);
    const password = decodeURIComponentSafe(url.password);
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  url.search = '';
  url.hash = '';
  const endpoint = stripTrailingSlash(url.toString());
  return {
    displayEndpoint: endpoint,
    requestEndpoint: endpoint,
    headers,
  };
}

function requiredArg(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function configuredKvGroundEndpoint(explicit: string | undefined, root: string): Promise<string | undefined> {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.SCIFORGE_VISION_KV_GROUND_URL?.trim()) return process.env.SCIFORGE_VISION_KV_GROUND_URL.trim();

  const configPath = process.env.SCIFORGE_CONFIG_PATH?.trim()
    ? resolve(process.env.SCIFORGE_CONFIG_PATH)
    : resolve(root, 'config.local.json');
  const configs = (await Promise.all([
    readOptionalJson(configPath),
    readOptionalJson(resolve(root, '.sciforge', 'config.json')),
    readOptionalJson(resolve(root, '.sciforge', 'config.local.json')),
  ])).filter(isRecord);

  return firstConfigString(configs, [
    ['visionSense', 'grounderBaseUrl'],
    ['grounder', 'baseUrl'],
  ]);
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function firstConfigString(configs: Record<string, unknown>[], paths: string[][]): string | undefined {
  for (const path of paths) {
    for (const config of configs) {
      const value = getConfigString(config, path);
      if (value) return value;
    }
  }
  return undefined;
}

function getConfigString(config: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return stringValue(cursor);
}

async function loadSmokeImage(imagePath: string | undefined): Promise<SmokeImage> {
  if (!imagePath) {
    return {
      bytes: createDefaultSmokePng(),
      mimeType: 'image/png',
      source: 'default-inline-image',
    };
  }
  const resolved = resolve(imagePath);
  return {
    bytes: await readFile(resolved),
    mimeType: mimeTypeFromPath(resolved),
    source: 'file',
  };
}

function mimeTypeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

async function requestJson(options: {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs: number;
}): Promise<JsonHttpResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const text = await response.text();
    const parsed = text.trim().length ? parseJson(text) : undefined;
    return {
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      body: parsed,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: sanitizeSecretText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function endpointUrl(baseEndpoint: string, suffix: '/health' | '/predict/'): string {
  const url = new URL(`${baseEndpoint}/`);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${suffix}`;
  return url.toString();
}

function parsePredictCoordinates(value: unknown): [number, number] | undefined {
  const source = isRecord(value) ? value.coordinates : value;
  const point = coordinatePairFromUnknown(source) ?? coordinatePairFromUnknown(value);
  if (point) return point;
  const text = isRecord(value) ? stringValue(value.raw_text) ?? stringValue(value.text) : undefined;
  return text ? coordinatePairFromText(text) : undefined;
}

function coordinatePairFromUnknown(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = finiteNumber(value[0]);
    const y = finiteNumber(value[1]);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x !== undefined && y !== undefined) return [x, y];
  const x1 = finiteNumber(value.x1);
  const y1 = finiteNumber(value.y1);
  const x2 = finiteNumber(value.x2);
  const y2 = finiteNumber(value.y2);
  if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  return undefined;
}

function coordinatePairFromText(value: string): [number, number] | undefined {
  const match = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2])];
}

function createDefaultSmokePng(): Buffer {
  const width = 200;
  const height = 120;
  const pixels = Buffer.alloc(width * height * 4);
  fillRect(pixels, width, 0, 0, width, height, [248, 250, 252, 255]);
  fillRect(pixels, width, 0, 0, width, 1, [41, 50, 65, 255]);
  fillRect(pixels, width, 0, height - 1, width, height, [41, 50, 65, 255]);
  fillRect(pixels, width, 0, 0, 1, height, [41, 50, 65, 255]);
  fillRect(pixels, width, width - 1, 0, width, height, [41, 50, 65, 255]);
  fillRect(pixels, width, 72, 38, 128, 82, [32, 41, 54, 255]);
  fillRect(pixels, width, 76, 42, 124, 78, [220, 38, 38, 255]);
  fillRect(pixels, width, 98, 42, 102, 78, [255, 255, 255, 255]);
  fillRect(pixels, width, 76, 58, 124, 62, [255, 255, 255, 255]);
  return encodePng(width, height, pixels);
}

function fillRect(
  pixels: Buffer,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: [number, number, number, number],
): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const rowLength = width * 4;
  const raw = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowLength + 1);
    raw[rawOffset] = 0;
    rgba.copy(raw, rawOffset + 1, y * rowLength, (y + 1) * rowLength);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function timeoutMsFromEnv(): number | undefined {
  const value = process.env.SCIFORGE_VISION_KV_GROUND_TIMEOUT_MS;
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function withHttpScheme(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeSecretText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\b(https?:\/\/)([^/@\s]+)@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|api[_-]?key|auth|key|password|secret|token)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 [redacted]')
    .replace(/\b(?:api[_-]?key|password|secret|token)=\S+/gi, (match) => {
      const [key] = match.split('=');
      return `${key}=[redacted]`;
    });
}

async function main(): Promise<void> {
  try {
    const args = parseKvGroundSmokeCliArgs(process.argv.slice(2));
    const manifest = await runKvGroundSmoke({
      endpoint: args.endpoint,
      imagePath: args.imagePath,
      outPath: args.outPath,
      text: args.text,
    });
    console.log(`[${manifest.status}] wrote ${manifest.schemaVersion} to ${args.outPath} for ${manifest.endpoint}`);
    if (manifest.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    const message = sanitizeSecretText(error instanceof Error ? error.message : String(error)) ?? 'KV-Ground smoke failed.';
    console.error(`[blocked] ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
