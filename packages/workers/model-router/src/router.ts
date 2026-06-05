import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep, join } from 'node:path';

import { makeId, messageOutputItem, type JsonObject, type JsonValue } from '../../../backend/src/response-compat';
import { modelRouterManifest } from './manifest';
import { redactTraceText } from './trace-redaction';

export interface ModelRouterProviderConfig {
  provider: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
}

export interface ModelRouterVisionTranslatorConfig extends ModelRouterProviderConfig {
  maxSupplementRounds?: number;
}

export interface ModelRouterProfile {
  traceRoot: string;
  textReasoner: ModelRouterProviderConfig;
  translators: {
    vision?: ModelRouterVisionTranslatorConfig;
  };
}

export interface ModelRouterConfig {
  defaultProfile: string;
  publicModelAlias?: string;
  profiles: Record<string, ModelRouterProfile>;
}

export interface ModelRouterServerOptions {
  config: ModelRouterConfig;
  env?: Record<string, string | undefined>;
  workspaceRoot?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export interface StartedModelRouterServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

type ModalityRef = {
  id: string;
  kind: 'vision.image';
  source: 'inline' | 'url' | 'ref';
  mime?: string;
  sha256: string;
  byteLength?: number;
  safeRef?: string;
  urlSha256?: string;
  transientProviderPart: JsonObject;
};

type ProviderCallRecord = {
  role: 'textReasoner' | 'visionTranslator';
  phase: string;
  status: 'ok' | 'failed';
  roleAlias: string;
  providerBindingSha256: string;
  wireApi: 'chat.completions';
  latencyMs: number;
  errorSummary?: string;
};

type RoutedResponse = {
  responseId: string;
  model: string;
  outputText: string;
  traceRef: string;
};

type TextControl =
  | { type: 'final_answer'; content: string }
  | { type: 'need_more_visual_info'; target: string; question: string; reason?: string };

const DEFAULT_MAX_SUPPLEMENT_ROUNDS = 2;
const MAX_TRANSIENT_PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024;

export function createModelRouterServer(options: ModelRouterServerOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? processEnvSnapshot();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    try {
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { ok: true, service: 'sciforge.model-router', checkedAt: new Date().toISOString() });
      }
      if (request.method === 'GET' && url.pathname === '/manifest') {
        return sendJson(response, 200, modelRouterManifest as unknown as JsonObject);
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        return sendJson(response, 200, {
          object: 'list',
          data: [{
            id: options.config.publicModelAlias ?? 'sciforge-model-router',
            object: 'model',
            owned_by: 'sciforge',
          }],
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        const body = await readJson(request);
        const result = await routeResponsesRequest(body, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
        });
        if (isRecord(body) && body.stream === true) return sendResponseStream(response, result);
        return sendJson(response, 200, responseObject(result));
      }
      return sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found' } });
    } catch (error) {
      const routerError = normalizeRouterError(error);
      options.log?.(`model-router ${routerError.code}: ${routerError.message}`);
      return sendJson(response, routerError.status, {
        error: {
          code: routerError.code,
          message: routerError.message,
        },
      });
    }
  });
}

export async function startModelRouterServer(
  options: ModelRouterServerOptions & { host?: string; port?: number },
): Promise<StartedModelRouterServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createModelRouterServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3892, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  return {
    server,
    url,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function routeResponsesRequest(
  body: unknown,
  context: {
    config: ModelRouterConfig;
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
    workspaceRoot: string;
    request: IncomingMessage;
  },
): Promise<RoutedResponse> {
  const request = isRecord(body) ? body : {};
  const profileId = requestedProfileId(request, context.request, context.config);
  const profile = context.config.profiles[profileId];
  if (!profile) throw routerError(400, 'unknown_profile', `Model Router profile "${profileId}" is not registered.`);
  validateRequestedModel(request.model, context.config.publicModelAlias);
  validateProfile(profile);
  const textSecret = secretForProvider(profile.textReasoner, context.env, 'textReasoner');
  const visionSecret = profile.translators.vision ? secretForProvider(profile.translators.vision, context.env, 'translators.vision') : undefined;

  const responseId = makeId('resp');
  const trace = createTraceContext(context.workspaceRoot, profile.traceRoot, responseId);
  const requestInputs = extractRequestInputs(request.input, request.instructions);
  const extracted = {
    ...requestInputs,
    modalities: await materializeWorkspaceImageRefs(requestInputs.modalities, context.workspaceRoot),
  };
  const calls: ProviderCallRecord[] = [];
  const observations: string[] = [];
  let degraded = false;
  const publicModelAlias = context.config.publicModelAlias ?? 'sciforge-model-router';
  const traceRedactionSecrets = [textSecret, visionSecret]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (extracted.modalities.length > 0) {
    if (!profile.translators.vision || !visionSecret) {
      throw routerError(400, 'missing_vision_translator', `Model Router profile "${profileId}" does not have a usable vision translator.`);
    }
    await writeTraceJson(trace, 'input-modalities.json', {
      schemaVersion: 'sciforge.model-router.input-modalities.v1',
      modalities: extracted.modalities.map(publicModalityRef),
    });
    const initial = await callVisionTranslator({
      profile,
      secret: visionSecret,
      fetchImpl: context.fetchImpl,
      instruction: extracted.userText || 'Describe the provided visual input.',
      modalities: extracted.modalities,
      phase: 'vision-initial',
      calls,
    }).catch((error: unknown) => {
      degraded = true;
      const summary = error instanceof Error ? error.message : String(error);
      calls.push(failedCallRecord(profile.translators.vision!, 'visionTranslator', 'vision-initial', summary, traceRedactionSecrets));
      return `visual_input=${extracted.modalities.map((item) => item.id).join(',')}\nstatus=unavailable\nreason=${summary}\ninstruction=Answer from text-only context and explicitly state that the image could not be inspected.`;
    });
    observations.push(initial);
    await writeTraceJson(trace, `vision-initial-${extracted.modalities[0]?.id ?? 'image'}.json`, {
      schemaVersion: 'sciforge.model-router.vision-observation.v1',
      phase: 'initial',
      status: degraded ? 'failed' : 'ok',
      targetIds: extracted.modalities.map((item) => item.id),
      observationSummary: boundedTraceText(initial, profile, publicModelAlias, traceRedactionSecrets),
    });
  }

  const maxSupplementRounds = profile.translators.vision?.maxSupplementRounds ?? DEFAULT_MAX_SUPPLEMENT_ROUNDS;
  let outputText = '';
  let controlError: string | undefined;
  try {
    for (let round = 0; round <= maxSupplementRounds; round += 1) {
      const textContent = await callTextReasoner({
        profile,
        secret: textSecret,
        fetchImpl: context.fetchImpl,
        userText: extracted.userText,
        observations,
        controlError,
        visualFailure: degraded,
        calls,
      });
      const control = parseTextControl(textContent);
      if (!control) {
        outputText = publicProviderOutputText(textContent, profile, publicModelAlias, traceRedactionSecrets);
        break;
      }
      if (control.type === 'final_answer') {
        outputText = publicProviderOutputText(control.content, profile, publicModelAlias, traceRedactionSecrets);
        break;
      }
      if (round >= maxSupplementRounds) {
        controlError = `Supplement round budget exceeded for target ${control.target}.`;
        continue;
      }
      const target = extracted.modalities.find((item) => item.id === control.target);
      if (!target) {
        controlError = `Supplement target ${control.target} is not in the normalized modality refs.`;
        continue;
      }
      if (!profile.translators.vision || !visionSecret) {
        controlError = 'Vision translator unavailable for supplement request.';
        continue;
      }
      let supplementStatus: 'ok' | 'failed' = 'ok';
      let supplementErrorSummary: string | undefined;
      const supplement = await callVisionTranslator({
        profile,
        secret: visionSecret,
        fetchImpl: context.fetchImpl,
        instruction: control.question,
        modalities: [target],
        phase: `vision-supplement-${round + 1}`,
        calls,
      }).catch((error: unknown) => {
        const summary = traceErrorSummary(error);
        supplementStatus = 'failed';
        supplementErrorSummary = summary;
        return `visual_input=${target.id}\nstatus=supplement_unavailable\nreason=${summary}`;
      });
      observations.push(supplement);
      await writeTraceJson(trace, `vision-supplement-${round + 1}-${target.id}.json`, {
        schemaVersion: 'sciforge.model-router.vision-observation.v1',
        phase: 'supplement',
        round: round + 1,
        status: supplementStatus,
        targetIds: [target.id],
        questionSummary: boundedTraceText(control.question, profile, publicModelAlias, traceRedactionSecrets),
        reasonSummary: boundedTraceText(control.reason ?? '', profile, publicModelAlias, traceRedactionSecrets),
        observationSummary: boundedTraceText(supplement, profile, publicModelAlias, traceRedactionSecrets),
        ...(supplementErrorSummary ? { errorSummary: boundedTraceText(supplementErrorSummary, profile, publicModelAlias, traceRedactionSecrets) } : {}),
      });
      controlError = undefined;
    }
  } catch (error) {
    await writeRoutingTrace({
      trace,
      responseId,
      profileId,
      profile,
      workspaceRoot: context.workspaceRoot,
      publicModelAlias,
      modalities: extracted.modalities,
      calls,
      degraded,
      status: 'failed',
      errorSummary: traceErrorSummary(error),
    });
    throw error;
  }

  if (!outputText) {
    outputText = degraded
      ? 'I could not inspect the image. Based on the text-only context, I cannot provide visual details from it.'
      : 'The request could not be completed because the internal visual supplement protocol did not produce a final answer.';
  }
  if (degraded && !mentionsVisualUnavailable(outputText)) {
    outputText = `I could not inspect the image. ${outputText}`;
  }

  await writeRoutingTrace({
    trace,
    responseId,
    profileId,
    profile,
    workspaceRoot: context.workspaceRoot,
    publicModelAlias,
    modalities: extracted.modalities,
    calls,
    degraded,
    status: 'completed',
    outputText,
  });

  return {
    responseId,
    model: context.config.publicModelAlias ?? 'sciforge-model-router',
    outputText,
    traceRef: trace.relativeDir,
  };
}

function requestedProfileId(request: Record<string, unknown>, incoming: IncomingMessage, config: ModelRouterConfig) {
  const header = incoming.headers['x-sciforge-model-router-profile'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  if (typeof metadata.profile === 'string' && metadata.profile.trim()) return metadata.profile.trim();
  if (typeof metadata.modelRouterProfile === 'string' && metadata.modelRouterProfile.trim()) return metadata.modelRouterProfile.trim();
  return config.defaultProfile;
}

function validateRequestedModel(model: unknown, publicModelAlias: string | undefined) {
  if (model === undefined || model === null) return;
  if (typeof model !== 'string' || !model.trim()) throw routerError(400, 'invalid_model', 'Model Router requests must use the public router model alias.');
  const expectedAlias = publicModelAlias ?? 'sciforge-model-router';
  if (model !== expectedAlias) {
    throw routerError(400, 'unregistered_model', `Model "${model}" is not registered for this Model Router.`);
  }
}

function validateProfile(profile: ModelRouterProfile) {
  validateProviderConfig(profile.textReasoner, 'textReasoner');
  if (profile.translators.vision) validateProviderConfig(profile.translators.vision, 'translators.vision');
}

function validateProviderConfig(config: ModelRouterProviderConfig, role: string) {
  if (!config.provider || !config.baseUrl || !config.apiKeyEnv || !config.model) {
    throw routerError(400, 'invalid_provider_config', `Model Router profile role "${role}" is missing required provider configuration.`);
  }
  try {
    new URL(config.baseUrl);
  } catch {
    throw routerError(400, 'invalid_provider_config', `Model Router profile role "${role}" has an invalid provider base URL.`);
  }
}

function secretForProvider(config: ModelRouterProviderConfig, env: Record<string, string | undefined>, roleAlias: string) {
  const secret = env[config.apiKeyEnv];
  if (!secret) throw routerError(400, 'missing_secret', `Model Router role "${roleAlias}" is missing its configured secret.`);
  return secret;
}

function extractRequestInputs(input: unknown, instructions: unknown): { userText: string; modalities: ModalityRef[] } {
  const texts: string[] = [];
  if (typeof instructions === 'string' && instructions.trim()) texts.push(instructions.trim());
  const modalities: ModalityRef[] = [];
  visitInput(input, texts, modalities);
  const textual = extractTextualModalityRefs(texts.filter(Boolean).join('\n').trim(), modalities.length + 1);
  return {
    userText: textual.userText,
    modalities: [...modalities, ...textual.modalities],
  };
}

function visitInput(value: unknown, texts: string[], modalities: ModalityRef[]) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    texts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitInput(item, texts, modalities);
    return;
  }
  if (!isRecord(value)) return;
  const type = stringField(value.type);
  if (type === 'input_text' || type === 'text') {
    const text = stringField(value.text) ?? stringField(value.content);
    if (text) texts.push(text);
    return;
  }
  if (type === 'input_image' || type === 'image' || value.image_url !== undefined || value.ref !== undefined) {
    const ref = normalizeImagePart(value, modalities.length + 1);
    if (ref) modalities.push(ref);
    return;
  }
  if (value.content !== undefined) visitInput(value.content, texts, modalities);
  if (value.text !== undefined) visitInput(value.text, texts, modalities);
  if (value.input !== undefined) visitInput(value.input, texts, modalities);
}

function normalizeImagePart(value: Record<string, unknown>, ordinal: number): ModalityRef | undefined {
  const id = `image_${ordinal}`;
  const mime = stringField(value.mime_type) ?? stringField(value.mimeType);
  const rawImageUrl = value.image_url;
  const imageUrl = typeof rawImageUrl === 'string'
    ? rawImageUrl
    : isRecord(rawImageUrl)
      ? stringField(rawImageUrl.url)
      : undefined;
  const ref = stringField(value.ref) ?? stringField(value.file_ref) ?? stringField(value.artifactRef);
  if (imageUrl?.startsWith('data:image/')) {
    const payload = imageUrl.split(',', 2)[1] ?? '';
    const bytes = Buffer.from(payload, 'base64');
    return {
      id,
      kind: 'vision.image',
      source: 'inline',
      mime: mime ?? mimeFromDataUrl(imageUrl),
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      byteLength: bytes.byteLength,
      transientProviderPart: { type: 'image_url', image_url: { url: imageUrl } },
    };
  }
  if (imageUrl) {
    return {
      id,
      kind: 'vision.image',
      source: 'url',
      mime,
      sha256: hashForTrace(imageUrl),
      urlSha256: hashForTrace(imageUrl),
      transientProviderPart: { type: 'image_url', image_url: { url: imageUrl } },
    };
  }
  if (ref) {
    const providerRef = safeTraceRef(ref);
    return {
      id,
      kind: 'vision.image',
      source: 'ref',
      mime,
      sha256: hashForTrace(ref),
      safeRef: providerRef,
      transientProviderPart: { type: 'text', text: `SciForge visual ref ${id}: ${providerRef}` },
    };
  }
  return undefined;
}

async function materializeWorkspaceImageRefs(modalities: ModalityRef[], workspaceRoot: string): Promise<ModalityRef[]> {
  return await Promise.all(modalities.map(async (item) => {
    if (item.source !== 'ref' || !item.safeRef) return item;
    const materialized = await transientWorkspaceImagePart(item.safeRef, workspaceRoot, item.mime);
    return materialized
      ? { ...item, mime: materialized.mime, byteLength: materialized.byteLength, transientProviderPart: materialized.part }
      : item;
  }));
}

async function transientWorkspaceImagePart(ref: string, workspaceRoot: string, explicitMime: string | undefined) {
  const refPath = traceRefPath(ref);
  const mime = imageMimeForRef(refPath, explicitMime);
  if (!mime || !isConservativeTraceRefPath(refPath)) return undefined;
  const workspace = resolve(workspaceRoot);
  const absolutePath = resolve(workspace, refPath);
  if (absolutePath !== workspace && !absolutePath.startsWith(`${workspace}${sep}`)) return undefined;
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TRANSIENT_PROVIDER_IMAGE_BYTES) return undefined;
    const bytes = await readFile(absolutePath);
    return {
      mime,
      byteLength: bytes.byteLength,
      part: {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
      } satisfies JsonObject,
    };
  } catch {
    return undefined;
  }
}

function imageMimeForRef(refPath: string, explicitMime: string | undefined) {
  if (explicitMime?.startsWith('image/')) return explicitMime;
  switch (extname(refPath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.bmp':
      return 'image/bmp';
    case '.heic':
      return 'image/heic';
    default:
      return undefined;
  }
}

function extractTextualModalityRefs(userText: string, startOrdinal: number): { userText: string; modalities: ModalityRef[] } {
  const askParsed = extractAskCommandRefs(userText, startOrdinal);
  const explicitParsed = extractExplicitSciForgeRefs(askParsed.userText, startOrdinal + askParsed.modalities.length);
  return {
    userText: explicitParsed.userText,
    modalities: [...askParsed.modalities, ...explicitParsed.modalities],
  };
}

function extractAskCommandRefs(userText: string, startOrdinal: number): { userText: string; modalities: ModalityRef[] } {
  const tokens = tokenizeCommandLikeText(userText);
  if (tokens[0] !== 'ask' || !tokens.includes('--ref')) return { userText, modalities: [] };

  const retained: string[] = [];
  const modalities: ModalityRef[] = [];
  let ordinal = startOrdinal;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === '--ref') {
      const candidate = tokens[index + 1];
      if (candidate && isAllowedTextualModalityRef(candidate)) {
        modalities.push(modalityRefFromTextualRef(candidate, ordinal));
        ordinal += 1;
      }
      if (candidate) index += 1;
      continue;
    }
    retained.push(tokens[index]);
  }
  return {
    userText: retained.join(' ').trim(),
    modalities,
  };
}

function extractExplicitSciForgeRefs(userText: string, startOrdinal: number): { userText: string; modalities: ModalityRef[] } {
  const modalities: ModalityRef[] = [];
  let ordinal = startOrdinal;
  const sanitized = userText.replace(
    /\bSciForge\s+(?:image|object|visual)\s+refs?\s*(?::|=|\bis\b)?\s*([A-Za-z0-9._:@/-]+)/gi,
    (matched: string, candidate: string) => {
      if (!isAllowedTextualModalityRef(candidate)) return 'SciForge ref redacted';
      modalities.push(modalityRefFromTextualRef(candidate, ordinal));
      ordinal += 1;
      return 'SciForge ref attached';
    },
  );
  return { userText: sanitized.trim(), modalities };
}

function modalityRefFromTextualRef(ref: string, ordinal: number): ModalityRef {
  const id = `image_${ordinal}`;
  const providerRef = safeTraceRef(ref);
  return {
    id,
    kind: 'vision.image',
    source: 'ref',
    sha256: hashForTrace(ref),
    safeRef: providerRef,
    transientProviderPart: { type: 'text', text: `SciForge visual ref ${id}: ${providerRef}` },
  };
}

function tokenizeCommandLikeText(value: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

async function callVisionTranslator(options: {
  profile: ModelRouterProfile;
  secret: string;
  fetchImpl: typeof fetch;
  instruction: string;
  modalities: ModalityRef[];
  phase: string;
  calls: ProviderCallRecord[];
}) {
  const translator = options.profile.translators.vision;
  if (!translator) throw new Error('Vision translator is not configured.');
  const content: JsonObject[] = [
    { type: 'text', text: options.instruction },
    ...options.modalities.map((item) => item.transientProviderPart),
  ];
  return await callChatProvider({
    provider: translator,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    body: {
      model: translator.model,
      messages: [
        {
          role: 'system',
          content: 'You are a SciForge vision translator. Convert the instruction and visual ref into a concise text observation. Do not claim task completion.',
        },
        { role: 'user', content },
      ],
    },
    role: 'visionTranslator',
    phase: options.phase,
    calls: options.calls,
  });
}

async function callTextReasoner(options: {
  profile: ModelRouterProfile;
  secret: string;
  fetchImpl: typeof fetch;
  userText: string;
  observations: string[];
  controlError?: string;
  visualFailure: boolean;
  calls: ProviderCallRecord[];
}) {
  const controlInstruction = options.observations.length
    ? [
      'You are the text reasoner for SciForge Model Router.',
      'Use the supplied visual observations as text-only context.',
      'For internal control, return strict JSON only: {"type":"final_answer","content":"..."} or {"type":"need_more_visual_info","target":"image_1","question":"...","reason":"..."}.',
      'If visual_input is unavailable, the final answer must explicitly state that the image could not be inspected.',
    ].join(' ')
    : undefined;
  const messages: JsonObject[] = [
    ...(controlInstruction ? [{ role: 'system', content: controlInstruction }] : []),
    ...(options.observations.length ? [{
      role: 'user',
      content: [
        options.userText ? `User request:\n${options.userText}` : 'User request is empty.',
        'Visual observations:',
        ...options.observations.map((observation, index) => `Observation ${index + 1}:\n${observation}`),
        options.controlError ? `Router control error:\n${options.controlError}` : '',
        options.visualFailure ? 'Router degradation: at least one image could not be inspected.' : '',
      ].filter(Boolean).join('\n\n'),
    }] : [{ role: 'user', content: options.userText }]),
  ];
  return await callChatProvider({
    provider: options.profile.textReasoner,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    body: {
      model: options.profile.textReasoner.model,
      messages,
    },
    role: 'textReasoner',
    phase: options.observations.length ? 'text-control-or-final' : 'text-direct',
    calls: options.calls,
  });
}

async function callChatProvider(options: {
  provider: ModelRouterProviderConfig;
  secret: string;
  fetchImpl: typeof fetch;
  body: JsonObject;
  role: ProviderCallRecord['role'];
  phase: string;
  calls: ProviderCallRecord[];
}) {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await options.fetchImpl(`${trimTrailingSlash(options.provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.secret}`,
      },
      body: JSON.stringify(options.body),
    });
  } catch {
    const errorSummary = 'provider_exception';
    recordFailedProviderCall(options, Date.now() - startedAt, errorSummary);
    throw new Error(errorSummary);
  }
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const errorSummary = `provider_http_${response.status}`;
    recordFailedProviderCall(options, latencyMs, errorSummary);
    throw new Error(errorSummary);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const errorSummary = 'provider_exception';
    recordFailedProviderCall(options, latencyMs, errorSummary);
    throw new Error(errorSummary);
  }
  options.calls.push({
    role: options.role,
    phase: options.phase,
    status: 'ok',
    roleAlias: roleAliasForCall(options.role),
    providerBindingSha256: providerBindingHash(options.provider),
    wireApi: 'chat.completions',
    latencyMs,
  });
  return chatCompletionText(payload);
}

function recordFailedProviderCall(
  options: {
    provider: ModelRouterProviderConfig;
    secret?: string;
    role: ProviderCallRecord['role'];
    phase: string;
    calls: ProviderCallRecord[];
  },
  latencyMs: number,
  errorSummary: string,
) {
  options.calls.push({
    role: options.role,
    phase: options.phase,
    status: 'failed',
    roleAlias: roleAliasForCall(options.role),
    providerBindingSha256: providerBindingHash(options.provider),
    wireApi: 'chat.completions',
    latencyMs,
    errorSummary: boundedProviderTraceText(errorSummary, options.provider, options.secret ? [options.secret] : []),
  });
}

function chatCompletionText(payload: unknown) {
  const completion = isRecord(payload) ? payload : {};
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(firstChoice.message) ? firstChoice.message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => isRecord(part) ? stringField(part.text) ?? stringField(part.content) ?? '' : '').filter(Boolean).join('\n');
  }
  return '';
}

function parseTextControl(content: string): TextControl | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (parsed.type === 'final_answer' && typeof parsed.content === 'string') {
      return { type: 'final_answer', content: parsed.content };
    }
    if (parsed.type === 'need_more_visual_info' && typeof parsed.target === 'string' && typeof parsed.question === 'string') {
      return {
        type: 'need_more_visual_info',
        target: parsed.target,
        question: parsed.question,
        reason: stringField(parsed.reason),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function responseObject(result: RoutedResponse): JsonObject {
  return {
    id: result.responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: result.model,
    status: 'completed',
    output: [messageOutputItem(result.outputText)],
    output_text: result.outputText,
    metadata: {
      traceRef: result.traceRef,
    },
  };
}

function sendResponseStream(response: ServerResponse, result: RoutedResponse) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(response, 'response.created', { type: 'response.created', response: { id: result.responseId, model: result.model, status: 'in_progress' } });
  writeSse(response, 'response.output_text.delta', { type: 'response.output_text.delta', delta: result.outputText });
  writeSse(response, 'response.completed', { type: 'response.completed', response: responseObject(result) });
  response.write('data: [DONE]\n\n');
  response.end();
}

function writeSse(response: ServerResponse, event: string, data: JsonObject) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

type TraceContext = {
  traceId: string;
  absoluteDir: string;
  relativeDir: string;
};

function createTraceContext(workspaceRoot: string, traceRoot: string, responseId: string): TraceContext {
  const day = new Date().toISOString().slice(0, 10);
  const traceId = responseId;
  const traceRootIsAbsolute = traceRoot.startsWith('/')
    || traceRoot.startsWith('~')
    || /^[A-Za-z]:[\\/]/.test(traceRoot)
    || /^\\\\/.test(traceRoot);
  const absoluteDir = traceRootIsAbsolute
    ? join(traceRoot, day, responseId)
    : join(workspaceRoot, traceRoot, day, responseId);
  const relativeDir = traceRootIsAbsolute
    ? safeTraceRef(absoluteDir)
    : join(traceRoot, day, responseId);
  return {
    traceId,
    relativeDir,
    absoluteDir,
  };
}

async function writeTraceJson(trace: TraceContext, fileName: string, payload: JsonObject) {
  await mkdir(trace.absoluteDir, { recursive: true });
  await writeFile(join(trace.absoluteDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeRoutingTrace(options: {
  trace: TraceContext;
  responseId: string;
  profileId: string;
  profile: ModelRouterProfile;
  workspaceRoot: string;
  publicModelAlias: string;
  modalities: ModalityRef[];
  calls: ProviderCallRecord[];
  degraded: boolean;
  status: 'completed' | 'failed';
  outputText?: string;
  errorSummary?: string;
}) {
  const translatorsTrace: JsonObject = options.profile.translators.vision
    ? { vision: providerTrace('translators.vision', options.profile.translators.vision, options.publicModelAlias) }
    : {};
  await writeTraceJson(options.trace, 'trace.json', {
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: options.trace.traceId,
    responseId: options.responseId,
    profileId: options.profileId,
    workspaceId: hashForTrace(options.workspaceRoot),
    publicModelAlias: options.publicModelAlias,
    textReasoner: providerTrace('textReasoner', options.profile.textReasoner, options.publicModelAlias),
    translators: translatorsTrace,
    modalityRefs: options.modalities.map(publicModalityRef),
    calls: options.calls,
    degraded: options.degraded,
  });
  await writeTraceJson(options.trace, 'final-routing-summary.json', compactObject({
    schemaVersion: 'sciforge.model-router.final-routing-summary.v1',
    responseId: options.responseId,
    profileId: options.profileId,
    status: options.status,
    outputTextSha256: options.outputText ? sha256Hex(options.outputText) : undefined,
    errorSummary: options.errorSummary,
    degraded: options.degraded,
    traceRef: options.trace.relativeDir,
  }));
}

function publicModalityRef(ref: ModalityRef): JsonObject {
  return compactObject({
    id: ref.id,
    kind: ref.kind,
    source: ref.source,
    mime: ref.mime,
    sha256: ref.sha256,
    byteLength: ref.byteLength,
    ref: ref.safeRef,
    urlSha256: ref.urlSha256,
  });
}

function providerTrace(roleAlias: string, provider: ModelRouterProviderConfig, publicModelAlias: string): JsonObject {
  return {
    roleAlias,
    publicModelAlias,
    providerBindingSha256: providerBindingHash(provider),
    wireApi: 'chat.completions',
  };
}

function roleAliasForCall(role: ProviderCallRecord['role']) {
  return role === 'textReasoner' ? 'textReasoner' : 'translators.vision';
}

function providerBindingHash(provider: ModelRouterProviderConfig) {
  return hashForTrace([
    provider.provider,
    provider.baseUrl,
    provider.model,
    provider.apiKeyEnv,
  ].join('\n'));
}

function failedCallRecord(
  provider: ModelRouterProviderConfig,
  role: ProviderCallRecord['role'],
  phase: string,
  errorSummary: string,
  sensitiveValues: string[] = [],
): ProviderCallRecord {
  return {
    role,
    phase,
    status: 'failed',
    roleAlias: roleAliasForCall(role),
    providerBindingSha256: providerBindingHash(provider),
    wireApi: 'chat.completions',
    latencyMs: 0,
    errorSummary: boundedProviderTraceText(errorSummary, provider, sensitiveValues),
  };
}

function normalizeRouterError(error: unknown) {
  if (isRouterError(error)) return error;
  return routerError(500, 'model_router_error', error instanceof Error ? error.message : String(error));
}

function routerError(status: number, code: string, message: string) {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}

function isRouterError(error: unknown): error is Error & { status: number; code: string } {
  return error instanceof Error
    && typeof (error as { status?: unknown }).status === 'number'
    && typeof (error as { code?: unknown }).code === 'string';
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendCors(response: ServerResponse) {
  response.writeHead(204, corsHeaders());
  response.end();
}

function sendJson(response: ServerResponse, status: number, body: JsonObject) {
  response.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-sciforge-model-router-profile',
  };
}

function processEnvSnapshot(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) env[key] = value;
  return env;
}

function safeTraceRef(ref: string) {
  if (isPrivateLikeTraceRef(ref)) return hashForTrace(ref);
  if (isSafeTraceRef(ref)) return ref;
  return hashForTrace(ref);
}

function isSafeTraceRef(ref: string) {
  const path = traceRefPath(ref);
  if (!path) return false;
  if (/^file:/i.test(ref) && !path.startsWith('.sciforge/')) return false;
  return isConservativeTraceRefPath(path);
}

function isPrivateLikeTraceRef(ref: string) {
  const trimmed = ref.trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('~')
    || /^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(trimmed)
    || /^(?:artifact|ref|run):(?:\/|https?:\/\/|file:|~)/i.test(trimmed);
}

function isAllowedTextualModalityRef(ref: string) {
  if (!isSafeTraceRef(ref)) return false;
  const path = traceRefPath(ref);
  if (!path) return false;
  if (path.startsWith('.sciforge/uploads/')) return true;
  if (/^(?:workspace|bundle|bundles|artifact|artifacts|upload|uploads|images|objects|files|runs)\//i.test(path)) return true;
  if (/^[A-Za-z0-9._@-]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic)$/i.test(path)) return true;
  return /^(?:artifact|ref|run):/i.test(ref);
}

function traceRefPath(ref: string) {
  const prefixed = /^(?:artifact|ref|run):(.+)$/i.exec(ref);
  if (prefixed) return prefixed[1];
  const fileRef = /^file:(.+)$/i.exec(ref);
  if (fileRef) return fileRef[1];
  return ref;
}

function isConservativeTraceRefPath(value: string) {
  if (!/^[A-Za-z0-9._@/-]+$/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('~') || value.includes(':') || value.includes('\\') || value.includes('//')) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function traceErrorSummary(error: unknown) {
  if (isRouterError(error)) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/^provider_http_\d{3}$/.test(message)) return message;
  if (/^provider_[a-z0-9_]+$/i.test(message)) return message;
  return 'model_router_error';
}

function hashForTrace(value: string) {
  return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function mimeFromDataUrl(value: string) {
  const match = /^data:([^;,]+)[;,]/i.exec(value);
  return match?.[1];
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function boundedText(value: string, maxLength = 600) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function boundedTraceText(
  value: string,
  profile: ModelRouterProfile,
  publicModelAlias: string,
  sensitiveValues: string[] = [],
  maxLength = 600,
) {
  return boundedText(redactTraceText(value, {
    sensitiveValues: [...profileTraceRedactionValues(profile, publicModelAlias), ...sensitiveValues],
  }), maxLength);
}

function boundedProviderTraceText(
  value: string,
  provider: ModelRouterProviderConfig,
  sensitiveValues: string[] = [],
  maxLength = 600,
) {
  return boundedText(redactTraceText(value, {
    sensitiveValues: [...providerTraceRedactionValues(provider), ...sensitiveValues],
  }), maxLength);
}

function publicProviderOutputText(
  value: string,
  profile: ModelRouterProfile,
  publicModelAlias: string,
  sensitiveValues: string[] = [],
) {
  return redactTraceText(value, {
    sensitiveValues: [...profileTraceRedactionValues(profile, publicModelAlias), ...sensitiveValues],
  });
}

function profileTraceRedactionValues(profile: ModelRouterProfile, publicModelAlias: string) {
  const configuredValues = [
    ...providerTraceRedactionValues(profile.textReasoner),
    ...(profile.translators.vision ? providerTraceRedactionValues(profile.translators.vision) : []),
  ];
  return configuredValues.filter((value) => value !== publicModelAlias);
}

function providerTraceRedactionValues(provider: ModelRouterProviderConfig) {
  return [
    provider.provider,
    provider.baseUrl,
    provider.apiKeyEnv,
    provider.model,
  ];
}

function mentionsVisualUnavailable(value: string) {
  return /could not inspect (?:the )?image|image (?:could not be|was not) inspected|visual input.*unavailable|无法(?:检查|查看|读取).*图|不能(?:检查|查看|读取).*图/i.test(value);
}

function compactObject(value: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as JsonObject;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
