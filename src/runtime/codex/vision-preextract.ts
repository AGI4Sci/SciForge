import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import type { RuntimeInputObject, RuntimeInputObjectVisionDescriptor } from './agent-cli-adapter.js';

// Vision Router pre-extraction (thin client for the standalone vision-router-service).
//
// SciForge uploads tag image input objects with a `pending` visionDescriptor
// (source: 'upload-preextract'). This step turns `pending -> ready` by POSTing the image to the
// Vision Router HTTP service, which translates it into natural-language evidence. A `ready`
// descriptor makes the Codex turn builder send the summary text instead of the raw image
// (codex-app-server-client: hasReadyVisionDescriptor), so the text-only main agent can "see" it.
//
// The main agent (DeepSeek V4) has NO vision, so there is no useful image fallback: we must obtain
// the translation and the turn blocks here until the service answers or the turn is cancelled.
// Robustness (retry/backoff over slow or flaky Qwen calls) lives IN the service, not here — this
// stays a one-shot HTTP call with a generous safety timeout. No-op unless SCIFORGE_VISION_SERVICE_URL
// is set, so existing behavior is unchanged when the service is not deployed.

export const VISION_SERVICE_URL_ENV = 'SCIFORGE_VISION_SERVICE_URL';
const VISION_SERVICE_TIMEOUT_ENV = 'SCIFORGE_VISION_SERVICE_TIMEOUT_MS';
const VISION_DESCRIPTOR_SCHEMA = 'sciforge.runtime.input-object.vision-descriptor.v1' as const;

// Safety net above the service's own retry budget; the turn's abortSignal is the real control.
const DEFAULT_SERVICE_TIMEOUT_MS = 1_800_000; // 30 min

export interface VisionPreextractOptions {
  workspacePath: string;
  /** User request text, forwarded to the translator as context (not a task). */
  instruction?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  abortSignal?: AbortSignal;
}

export function visionPreextractServiceUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env[VISION_SERVICE_URL_ENV]?.trim();
  return value ? value.replace(/\/+$/, '') : undefined;
}

/**
 * Populate pending image vision descriptors by calling the Vision Router service, returning the
 * possibly-augmented inputObjects. Never throws; per-object failures are recorded as a `failed`
 * descriptor. No-op (returns input unchanged) when the service URL is not configured.
 */
export async function preextractVisionDescriptors(
  inputObjects: RuntimeInputObject[] | undefined,
  options: VisionPreextractOptions,
): Promise<RuntimeInputObject[] | undefined> {
  const env = options.env ?? process.env;
  const serviceUrl = visionPreextractServiceUrl(env);
  if (!serviceUrl || !inputObjects?.length) return inputObjects;

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = numberEnv(env, VISION_SERVICE_TIMEOUT_ENV) ?? DEFAULT_SERVICE_TIMEOUT_MS;

  return Promise.all(inputObjects.map(async (object) => {
    if (!isImageObject(object) || hasReadyDescriptor(object)) return object;
    const image = await readWorkspaceImage(object, options.workspacePath);
    if (!image) return object; // not a readable workspace image; leave untouched

    try {
      const translation = await callVisionService(serviceUrl, {
        fetchImpl,
        instruction: options.instruction,
        image,
        objectId: object.ref,
        timeoutMs,
        abortSignal: options.abortSignal,
      });
      return { ...object, visionDescriptor: readyDescriptor(object, translation, now()) };
    } catch {
      return { ...object, visionDescriptor: failedDescriptor(object, now()) };
    }
  }));
}

// --- internals --------------------------------------------------------------

interface WorkspaceImage {
  base64: string;
  mime: string;
}

/** One POST to the Vision Router service. Aborts on the turn's signal or the safety timeout. */
async function callVisionService(
  serviceUrl: string,
  args: {
    fetchImpl: typeof fetch;
    instruction?: string;
    image: WorkspaceImage;
    objectId: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
  },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const onAbort = () => controller.abort();
  args.abortSignal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await args.fetchImpl(`${serviceUrl}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: args.instruction,
        image: { base64: args.image.base64, mime: args.image.mime },
        objectId: args.objectId,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    args.abortSignal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok) throw new Error(`vision service HTTP ${response.status}`);
  const result = (await response.json()) as unknown;
  if (!isRecord(result) || result.ok !== true) {
    const code = isRecord(result) && isRecord(result.error) ? String(result.error.code ?? 'error') : 'error';
    throw new Error(`vision service returned ${code}`);
  }
  const data = isRecord(result.data) ? result.data : {};
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  if (!summary) throw new Error('vision service returned an empty summary');
  return summary;
}

function readyDescriptor(
  object: RuntimeInputObject,
  summary: string,
  at: Date,
): RuntimeInputObjectVisionDescriptor {
  return {
    schemaVersion: VISION_DESCRIPTOR_SCHEMA,
    status: 'ready',
    source: 'upload-preextract',
    objectId: object.visionDescriptor?.objectId ?? object.ref,
    version: (object.visionDescriptor?.version ?? 0) + 1,
    summary,
    updatedAt: at.toISOString(),
  };
}

function failedDescriptor(object: RuntimeInputObject, at: Date): RuntimeInputObjectVisionDescriptor {
  return {
    schemaVersion: VISION_DESCRIPTOR_SCHEMA,
    status: 'failed',
    source: 'upload-preextract',
    objectId: object.visionDescriptor?.objectId ?? object.ref,
    version: (object.visionDescriptor?.version ?? 0) + 1,
    updatedAt: at.toISOString(),
  };
}

function hasReadyDescriptor(object: RuntimeInputObject): boolean {
  return object.visionDescriptor?.status === 'ready' && Boolean(object.visionDescriptor.summary?.trim());
}

function isImageObject(object: RuntimeInputObject): boolean {
  if (/^image\//i.test(object.mimeType ?? '')) return true;
  return /\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic)(?:$|[?#])/i.test(object.ref);
}

async function readWorkspaceImage(object: RuntimeInputObject, workspacePath: string): Promise<WorkspaceImage | undefined> {
  const mime = imageMime(object);
  if (!mime) return undefined;
  const absolutePath = workspaceBoundedPath(object.ref, workspacePath);
  if (!absolutePath) return undefined;
  try {
    const bytes = await readFile(absolutePath);
    if (!bytes.byteLength) return undefined;
    return { base64: bytes.toString('base64'), mime };
  } catch {
    return undefined;
  }
}

function workspaceBoundedPath(ref: string, workspacePath: string): string | undefined {
  if (!/^[A-Za-z0-9._@/-]+$/.test(ref) || ref.includes('..')) return undefined;
  const workspace = resolve(workspacePath);
  const absolutePath = resolve(workspace, ref);
  if (absolutePath !== workspace && !absolutePath.startsWith(`${workspace}${sep}`)) return undefined;
  return absolutePath;
}

function imageMime(object: RuntimeInputObject): string | undefined {
  if (object.mimeType && /^image\//i.test(object.mimeType)) return object.mimeType;
  switch (extname(object.ref).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.tif':
    case '.tiff': return 'image/tiff';
    case '.bmp': return 'image/bmp';
    case '.heic': return 'image/heic';
    default: return undefined;
  }
}

function numberEnv(env: Record<string, string | undefined>, name: string): number | undefined {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
