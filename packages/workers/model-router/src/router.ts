import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, relative, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chatCompletionToResponse,
  chatToolNameAliasesFromResponsesTools,
  makeId,
  messageOutputItem,
  responsesToChatCompletions,
  type JsonObject,
  type JsonValue,
  type ResponsesRequest,
} from '../../../backend/src/response-compat';
import { modelRouterManifest } from './manifest';
import { redactTraceText } from './trace-redaction';

export interface ModelRouterProviderConfig {
  provider: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxSupplementRounds?: number;
}

export interface ModelRouterProfile {
  traceRoot: string;
  textReasoner: ModelRouterProviderConfig;
  translators: {
    vision?: ModelRouterProviderConfig;
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

type ModalityKind = 'vision.image' | 'audio' | 'video' | 'table' | 'document';

type ModalityRef = {
  id: string;
  kind: ModalityKind;
  source: 'inline' | 'url' | 'ref';
  mime?: string;
  title?: string;
  semanticSignal: SemanticModalitySignal;
  sha256: string;
  contentSha256?: string;
  byteLength?: number;
  safeRef?: string;
  urlSha256?: string;
  materializationPath?: string;
  transientProviderPart?: JsonObject;
};

type SemanticModalitySignal = {
  kind: ModalityKind;
  evidence: Array<'structured-type' | 'structured-media-type' | 'structured-mime' | 'ref-extension' | 'ref-lexical-feature' | 'image-url'>;
  refsFirst: boolean;
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
  outputItems: JsonObject[];
  traceRef: string;
};

type TextControl =
  | { type: 'final_answer'; content: string }
  | { type: 'need_more_visual_info'; target?: string; question: string; reason?: string };

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
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const upstream = modelRouterHealthzUpstreamDiagnostic(options.config, env);
        return sendJson(response, upstream.ok ? 200 : 503, {
          ok: upstream.ok,
          service: 'sciforge.model-router',
          checkedAt: new Date().toISOString(),
          upstream,
        });
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

function modelRouterHealthzUpstreamDiagnostic(
  config: ModelRouterConfig,
  env: Record<string, string | undefined>,
): JsonObject {
  const profile = config.profiles[config.defaultProfile];
  const provider = profile?.textReasoner;
  if (!profile || !provider?.baseUrl || !provider.model) {
    return {
      category: 'repo-bug',
      ok: false,
      retryable: false,
      releaseAcceptance: 'not-evaluated',
    };
  }
  if (!stringField(env[provider.apiKeyEnv])) {
    return {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      releaseAcceptance: 'not-evaluated',
    };
  }
  return {
    category: 'ready',
    ok: true,
    retryable: false,
    releaseAcceptance: 'not-evaluated',
  };
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
  if (!profile) throw routerError(400, 'unknown_profile', 'Requested Model Router profile is not registered.');
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
  const textReasonerRequestOptions = chatRequestOptionsFromResponsesRequest(request, profile.textReasoner.model);
  const toolNameAliases = chatToolNameAliasesFromResponsesTools(request.tools);

  // Lexical detectors must not become routing truth; final routing must use structured semantic signals and refs-first evidence.
  const visionModalities = extracted.modalities.filter((item) => finalModalityRoutingSignal(item).kind === 'vision.image');
  const unsupportedModalities = extracted.modalities.filter((item) => finalModalityRoutingSignal(item).kind !== 'vision.image');

  if (extracted.modalities.length > 0) {
    await writeTraceJson(trace, 'input-modalities.json', {
      schemaVersion: 'sciforge.model-router.input-modalities.v1',
      modalities: extracted.modalities.map(publicModalityRef),
    });
  }

  if (unsupportedModalities.length > 0) {
    degraded = true;
    observations.push(...unsupportedModalities.map((item) => [
      `modality_input=${item.id}`,
      `kind=${item.kind}`,
      'status=unsupported',
      'reason=Model Router has no registered translator role for this modality kind in the active profile.',
      'instruction=Answer from text-only context and explicitly state that the referenced modality could not be inspected.',
    ].join('\n')));
  }

  if (visionModalities.length > 0) {
    if (!profile.translators.vision || !visionSecret) {
      throw routerError(400, 'missing_vision_translator', 'Active Model Router profile does not have a usable vision translator.');
    }
    for (const modality of visionModalities) {
      let observationStatus: 'ok' | 'failed' = 'ok';
      let observation: string;
      try {
        observation = await callVisionTranslator({
          profile,
          secret: visionSecret,
          fetchImpl: context.fetchImpl,
          instruction: visionTranslatorInstruction(extracted.userText || 'Describe the provided visual input.', modality),
          modality,
          phase: 'vision-initial',
          calls,
        });
      } catch (error) {
        degraded = true;
        observationStatus = 'failed';
        const summary = traceErrorSummary(error);
        observation = [
          `modality_input=${modality.id}`,
          'kind=vision.image',
          'status=unavailable',
          `reason=${summary}`,
          'instruction=Answer from text-only context and explicitly state that the image could not be inspected.',
        ].join('\n');
      }
      observations.push(formatVisionObservation(modality, observation, observationStatus));
      await writeTraceJson(trace, `vision-initial-${modality.id}.json`, {
        schemaVersion: 'sciforge.model-router.vision-observation.v1',
        phase: 'initial',
        status: observationStatus,
        targetIds: [modality.id],
        observationSummary: boundedTraceText(observations.at(-1) ?? '', profile, publicModelAlias, traceRedactionSecrets),
      });
    }
  }

  let outputText = '';
  let outputItems: JsonObject[] = [];
  let controlError: string | undefined;
  try {
    let textResult = await callTextReasoner({
      profile,
      secret: textSecret,
      fetchImpl: context.fetchImpl,
      userText: extracted.userText,
      observations,
      controlError,
      visualFailure: degraded,
      calls,
      request,
      requestOptions: textReasonerRequestOptions,
      toolNameAliases,
    });
    for (let round = 0; round < visionSupplementRoundLimit(profile.translators.vision); round += 1) {
      if (textResult.outputItems.some((item) => item.type === 'function_call')) break;
      const control = parseTextControl(textResult.outputText);
      if (control?.type !== 'need_more_visual_info') break;
      const modality = modalityForSupplementControl(control, visionModalities);
      if (!modality) {
        controlError = `Rejected visual supplement request: unknown target "${control.target ?? ''}".`;
        break;
      }
      if (!visionSecret) {
        controlError = 'Rejected visual supplement request: vision translator secret is unavailable.';
        break;
      }
      let observationStatus: 'ok' | 'failed' = 'ok';
      let observation: string;
      try {
        observation = await callVisionTranslator({
          profile,
          secret: visionSecret,
          fetchImpl: context.fetchImpl,
          instruction: visionSupplementInstruction(extracted.userText, control, modality),
          modality,
          phase: `vision-supplement-${round + 1}`,
          calls,
        });
      } catch (error) {
        degraded = true;
        observationStatus = 'failed';
        const summary = traceErrorSummary(error);
        observation = [
          `modality_input=${modality.id}`,
          'kind=vision.image',
          'status=unavailable',
          `reason=${summary}`,
          'instruction=Answer from available context and explicitly state that the requested visual supplement could not be inspected.',
        ].join('\n');
      }
      observations.push(formatVisionObservation(modality, observation, observationStatus));
      await writeTraceJson(trace, `vision-supplement-${round + 1}-${modality.id}.json`, {
        schemaVersion: 'sciforge.model-router.vision-observation.v1',
        phase: `supplement-${round + 1}`,
        status: observationStatus,
        targetIds: [modality.id],
        observationSummary: boundedTraceText(observations.at(-1) ?? '', profile, publicModelAlias, traceRedactionSecrets),
      });
      textResult = await callTextReasoner({
        profile,
        secret: textSecret,
        fetchImpl: context.fetchImpl,
        userText: extracted.userText,
        observations,
        controlError,
        visualFailure: degraded,
        calls,
        request,
        requestOptions: textReasonerRequestOptions,
        toolNameAliases,
      });
    }
    const hasToolCall = textResult.outputItems.some((item) => item.type === 'function_call');
    if (hasToolCall) {
      outputText = textResult.outputText;
      outputItems = textResult.outputItems;
    } else {
      const control = parseTextControl(textResult.outputText);
      outputText = publicProviderOutputText(
        control?.type === 'final_answer' ? control.content : textResult.outputText,
        profile,
        publicModelAlias,
        traceRedactionSecrets,
      );
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
    if (!outputItems.length) {
      outputText = degraded
        ? `${degradedUnavailablePrefix(extracted.modalities)} Based on the text-only context, I cannot provide details from it.`
        : '';
    }
  }
  if (degraded && !mentionsModalityUnavailable(outputText)) {
    outputText = `${degradedUnavailablePrefix(extracted.modalities)} ${outputText}`;
  }
  if (!outputItems.length) outputItems = outputText ? [messageOutputItem(outputText)] : [];

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
    outputItems,
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
    throw routerError(400, 'unregistered_model', 'Model Router requests must use the public router model alias.');
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
  const signal = semanticSignalFromRecord(value);
  if (signal || value.image_url !== undefined) {
    const ref = normalizeModalityPart(value, modalities.length + 1, signal);
    if (ref) modalities.push(ref);
    return;
  }
  if (value.content !== undefined) visitInput(value.content, texts, modalities);
  if (value.text !== undefined) visitInput(value.text, texts, modalities);
  if (value.input !== undefined) visitInput(value.input, texts, modalities);
}

function normalizeModalityPart(value: Record<string, unknown>, ordinal: number, signal?: SemanticModalitySignal): ModalityRef | undefined {
  const rawImageUrl = value.image_url;
  const imageUrl = typeof rawImageUrl === 'string'
    ? rawImageUrl
    : isRecord(rawImageUrl)
      ? stringField(rawImageUrl.url)
      : undefined;
  const kind = signal?.kind ?? (imageUrl ? 'vision.image' : undefined);
  if (!kind) return undefined;
  const id = `${modalityIdPrefix(kind)}_${ordinal}`;
  const mime = stringField(value.mime_type) ?? stringField(value.mimeType);
  const title = stringField(value.title) ?? stringField(value.name) ?? stringField(value.filename) ?? stringField(value.fileName);
  const localPath = stringField(value.path);
  const ref = stringField(value.ref) ?? stringField(value.file_ref) ?? stringField(value.artifactRef) ?? localPath;
  if (imageUrl?.startsWith('data:image/')) {
    const semanticSignal = signal ?? makeSemanticSignal(kind, ['image-url'], false);
    const payload = imageUrl.split(',', 2)[1] ?? '';
    const bytes = Buffer.from(payload, 'base64');
    return {
      id,
      kind,
      source: 'inline',
      mime: mime ?? mimeFromDataUrl(imageUrl),
      title,
      semanticSignal,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      byteLength: bytes.byteLength,
      transientProviderPart: { type: 'image_url', image_url: { url: imageUrl } },
    };
  }
  if (imageUrl) {
    const semanticSignal = signal ?? makeSemanticSignal(kind, ['image-url'], false);
    return {
      id,
      kind,
      source: 'url',
      mime,
      title,
      semanticSignal,
      sha256: hashForTrace(imageUrl),
      urlSha256: hashForTrace(imageUrl),
      transientProviderPart: { type: 'image_url', image_url: { url: imageUrl } },
    };
  }
  if (ref) {
    if (!signal) return undefined;
    const providerRef = safeTraceRef(ref);
    return {
      id,
      kind,
      source: 'ref',
      mime,
      title,
      semanticSignal: signal,
      sha256: hashForTrace(ref),
      safeRef: providerRef,
      materializationPath: localPath,
      transientProviderPart: kind === 'vision.image' ? { type: 'text', text: `SciForge visual ref ${id}: ${providerRef}` } : undefined,
    };
  }
  return undefined;
}

async function materializeWorkspaceImageRefs(modalities: ModalityRef[], workspaceRoot: string): Promise<ModalityRef[]> {
  return await Promise.all(modalities.map(async (item) => {
    if (item.kind !== 'vision.image' || item.source !== 'ref' || (!item.safeRef && !item.materializationPath)) return item;
    const materialized = await transientWorkspaceImagePart(item, workspaceRoot);
    return materialized
      ? {
          ...item,
          mime: materialized.mime,
          sha256: materialized.sha256,
          contentSha256: materialized.sha256,
          byteLength: materialized.byteLength,
          safeRef: materialized.safeRef,
          transientProviderPart: materialized.part,
        }
      : item;
  }));
}

async function transientWorkspaceImagePart(item: ModalityRef, workspaceRoot: string) {
  const target = workspaceImageTarget(item, workspaceRoot);
  if (!target) return undefined;
  const mime = imageMimeForRef(target.absolutePath, item.mime) ?? imageMimeForRef(target.relativeRef, item.mime);
  if (!mime) return undefined;
  try {
    const stats = await stat(target.absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TRANSIENT_PROVIDER_IMAGE_BYTES) return undefined;
    const bytes = await readFile(target.absolutePath);
    return {
      mime,
      byteLength: bytes.byteLength,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      safeRef: isConservativeTraceRefPath(target.relativeRef) ? target.relativeRef : safeTraceRef(target.relativeRef),
      part: {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
      } satisfies JsonObject,
    };
  } catch {
    return undefined;
  }
}

function workspaceImageTarget(item: ModalityRef, workspaceRoot: string): { absolutePath: string; relativeRef: string } | undefined {
  const workspace = resolve(workspaceRoot);
  const candidate = item.materializationPath
    ? filesystemPathFromLocalCandidate(item.materializationPath)
    : item.safeRef
      ? traceRefPath(item.safeRef)
      : undefined;
  if (!candidate) return undefined;
  if (!item.materializationPath && !isConservativeTraceRefPath(candidate)) return undefined;
  const absolutePath = isAbsolute(candidate) ? resolve(candidate) : resolve(workspace, candidate);
  if (!isPathInsideWorkspace(absolutePath, workspace)) return undefined;
  const relativeRef = relative(workspace, absolutePath).replace(/\\/g, '/');
  return { absolutePath, relativeRef };
}

function filesystemPathFromLocalCandidate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^file:/i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

function isPathInsideWorkspace(absolutePath: string, workspace: string) {
  return absolutePath === workspace || absolutePath.startsWith(`${workspace}${sep}`);
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

function visionTranslatorInstruction(userInstruction: string, modality: ModalityRef) {
  return [
    `User request: ${userInstruction}`,
    `Target modality_input: ${modality.id}`,
    modality.title ? `Object title: ${modality.title}` : '',
    modality.safeRef ? `Object ref: ${modality.safeRef}` : '',
    'Translate this visual input into concise textual evidence for the Agent Host.',
    'Include visible text, salient fields, spatial relationships, and uncertainty when relevant.',
    'Do not claim task completion and do not mention router internals.',
  ].filter(Boolean).join('\n');
}

function visionSupplementInstruction(userInstruction: string, control: Extract<TextControl, { type: 'need_more_visual_info' }>, modality: ModalityRef) {
  return [
    visionTranslatorInstruction(userInstruction || 'Inspect the provided visual input.', modality),
    `Supplemental visual question: ${boundedText(control.question, 1_000)}`,
    control.reason ? `Reason for supplement: ${boundedText(control.reason, 1_000)}` : '',
  ].filter(Boolean).join('\n\n');
}

function formatVisionObservation(modality: ModalityRef, observation: string, status: 'ok' | 'failed') {
  return [
    `Target modality_input: ${modality.id}`,
    'kind=vision.image',
    `status=${status}`,
    modality.title ? `Object title: ${modality.title}` : '',
    modality.safeRef ? `Object ref: ${modality.safeRef}` : '',
    observation,
  ].filter(Boolean).join('\n');
}

function visionSupplementRoundLimit(config: ModelRouterProviderConfig | undefined) {
  const value = config?.maxSupplementRounds;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, Math.floor(value)));
}

function modalityForSupplementControl(
  control: Extract<TextControl, { type: 'need_more_visual_info' }>,
  modalities: ModalityRef[],
) {
  if (control.target) {
    return modalities.find((modality) => modality.id === control.target);
  }
  return modalities.length === 1 ? modalities[0] : undefined;
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
  const lines = userText.split(/\r?\n/);
  const retainedLines: string[] = [];
  const retained: string[] = [];
  const modalities: ModalityRef[] = [];
  let ordinal = startOrdinal;
  let foundAskRefLine = false;

  for (const line of lines) {
    const tokens = tokenizeCommandLikeText(line);
    if (tokens[0] !== 'ask' || !tokens.includes('--ref')) {
      retainedLines.push(line);
      continue;
    }
    foundAskRefLine = true;
    retained.length = 0;
    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index] === '--ref') {
        const candidate = tokens[index + 1];
        const kind = candidate ? modalityKindFromTextualRef(candidate) : undefined;
        if (candidate && kind && isAllowedTextualModalityRef(candidate, kind)) {
          modalities.push(modalityRefFromTextualRef(candidate, ordinal, kind));
          ordinal += 1;
        }
        if (candidate) index += 1;
        continue;
      }
      retained.push(tokens[index]!);
    }
    if (retained.length) retainedLines.push(retained.join(' '));
  }
  if (!foundAskRefLine) return { userText, modalities: [] };
  return {
    userText: retainedLines.join('\n').trim(),
    modalities,
  };
}

function extractExplicitSciForgeRefs(userText: string, startOrdinal: number): { userText: string; modalities: ModalityRef[] } {
  const modalities: ModalityRef[] = [];
  let ordinal = startOrdinal;
  const sanitized = userText.replace(
    /\bSciForge\s+(image|object|visual|audio|video|table|document|file|modality)\s+refs?\s*(?::|=|\bis\b)?\s*([A-Za-z0-9._:@/-]+)/gi,
    (matched: string, label: string, candidate: string) => {
      const labelKind = modalityKindFromLabel(label);
      const kind = labelKind ?? modalityKindFromTextualRef(candidate);
      if (!kind || !isAllowedTextualModalityRef(candidate, kind)) return 'SciForge ref redacted';
      modalities.push(modalityRefFromTextualRef(candidate, ordinal, kind, labelKind ? ['structured-type', ...lexicalRefFeatures(candidate)] : undefined));
      ordinal += 1;
      return 'SciForge ref attached';
    },
  );
  return { userText: sanitized.trim(), modalities };
}

function modalityRefFromTextualRef(
  ref: string,
  ordinal: number,
  kind: ModalityKind,
  evidence: SemanticModalitySignal['evidence'] = ['ref-extension', ...lexicalRefFeatures(ref)],
): ModalityRef {
  const id = `${modalityIdPrefix(kind)}_${ordinal}`;
  const providerRef = safeTraceRef(ref);
  return {
    id,
    kind,
    source: 'ref',
    semanticSignal: makeSemanticSignal(kind, evidence, true),
    sha256: hashForTrace(ref),
    safeRef: providerRef,
    transientProviderPart: kind === 'vision.image' ? { type: 'text', text: `SciForge visual ref ${id}: ${providerRef}` } : undefined,
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
  modality: ModalityRef;
  phase: string;
  calls: ProviderCallRecord[];
}) {
  const translator = options.profile.translators.vision;
  if (!translator) throw new Error('Vision translator is not configured.');
  const providerParts = [options.modality.transientProviderPart]
    .filter((part): part is JsonObject => Boolean(part));
  const content: JsonObject[] = [
    { type: 'text', text: options.instruction },
    ...providerParts,
  ];
  const result = await callChatProvider({
    provider: translator,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    body: {
      model: translator.model,
      messages: [
        {
          role: 'system',
          content: [
            'You are a SciForge vision translator.',
            'Convert the instruction and visual input into concise textual evidence for the Agent Host.',
            'Include visible text, important fields, layout cues, and uncertainty when relevant.',
            'Do not claim task completion.',
          ].join(' '),
        },
        { role: 'user', content },
      ],
    },
    role: 'visionTranslator',
    phase: options.phase,
    calls: options.calls,
  });
  return result.outputText;
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
  request: Record<string, unknown>;
  requestOptions: Record<string, unknown>;
  toolNameAliases: Record<string, string>;
}) {
  const controlInstruction = options.observations.length
    ? [
      'You are the text reasoner for SciForge Model Router.',
      'Use the supplied modality observations as internal multimodal evidence for the final answer.',
      'Do not tell the user you cannot directly access or see the image when a modality observation is available.',
      'Do not mention modality observations, visual observations, translators, or router internals in the final answer.',
      'When answering with text instead of a tool call, return strict JSON only: {"type":"final_answer","content":"..."}.',
      'If the request provides tools and the Agent Host protocol requires one, use the provider tool-call protocol instead of describing the tool call in text.',
      'If any modality_input or visual_input is unavailable, the final answer must explicitly state that the referenced modality could not be inspected.',
    ].join(' ')
    : undefined;
  const messages: JsonObject[] = [
    ...(controlInstruction ? [{ role: 'system', content: controlInstruction }] : []),
    ...(options.observations.length ? [{
      role: 'user',
      content: [
        options.userText ? `User request:\n${options.userText}` : 'User request is empty.',
        'Modality evidence:',
        ...options.observations.map((observation, index) => `Observation ${index + 1}:\n${observation}`),
        options.controlError ? `Router control error:\n${options.controlError}` : '',
        options.visualFailure ? 'Router degradation: at least one referenced modality could not be inspected.' : '',
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
      ...options.requestOptions,
    },
    role: 'textReasoner',
    phase: options.observations.length ? 'text-control-or-final' : 'text-direct',
    calls: options.calls,
    responseRequest: options.request,
    toolNameAliases: options.toolNameAliases,
  });
}

async function callChatProvider(options: {
  provider: ModelRouterProviderConfig;
  secret: string;
  fetchImpl: typeof fetch;
  body: Record<string, unknown>;
  role: ProviderCallRecord['role'];
  phase: string;
  calls: ProviderCallRecord[];
  responseRequest?: Pick<ResponsesRequest, 'model'>;
  toolNameAliases?: Record<string, string>;
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
  return chatCompletionResult(payload, options.responseRequest, options.toolNameAliases);
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

function chatRequestOptionsFromResponsesRequest(request: Record<string, unknown>, defaultModel: string): Record<string, unknown> {
  const chatRequest = responsesToChatCompletions({
    ...request,
    model: defaultModel,
    input: '',
  }, { defaultModel });
  return Object.fromEntries(Object.entries({
    tools: chatRequest.tools,
    tool_choice: chatRequest.tool_choice,
    temperature: chatRequest.temperature,
    top_p: chatRequest.top_p,
    max_tokens: chatRequest.max_tokens,
    parallel_tool_calls: chatRequest.parallel_tool_calls,
    metadata: chatRequest.metadata,
  }).filter(([, value]) => value !== undefined));
}

function chatCompletionResult(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: Record<string, string> = {},
): { outputText: string; outputItems: JsonObject[] } {
  const response = chatCompletionToResponse(payload, request, toolNameAliases);
  const outputItems = Array.isArray(response.output)
    ? response.output.filter(isRecord) as JsonObject[]
    : [];
  const outputText = typeof response.output_text === 'string'
    ? response.output_text
    : chatCompletionText(payload);
  return { outputText, outputItems };
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
    if (parsed.type === 'need_more_visual_info' && typeof parsed.question === 'string') {
      return {
        type: 'need_more_visual_info',
        target: stringField(parsed.target),
        question: boundedText(parsed.question, 1_000),
        reason: stringField(parsed.reason),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function responseObject(result: RoutedResponse, messageItemId?: string): JsonObject {
  const output = responseOutputItems(result, messageItemId);
  return {
    id: result.responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: result.model,
    status: 'completed',
    output,
    output_text: result.outputText,
    metadata: {
      traceRef: result.traceRef,
    },
  };
}

function responseOutputItems(result: RoutedResponse, messageItemId?: string): JsonObject[] {
  if (messageItemId && result.outputItems.length === 1 && result.outputItems[0]?.type === 'message') {
    return [{ ...result.outputItems[0], id: messageItemId }];
  }
  if (result.outputItems.length) return result.outputItems;
  return result.outputText ? [messageOutputItem(result.outputText, messageItemId)] : [];
}

function sendResponseStream(response: ServerResponse, result: RoutedResponse) {
  const outputIndex = 0;
  const contentIndex = 0;
  const messageItemId = makeId('msg');
  const outputItems = responseOutputItems(result, messageItemId);
  const completedMessage = outputItems.length === 1 && outputItems[0]?.type === 'message'
    ? outputItems[0]
    : undefined;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(response, 'response.created', { type: 'response.created', response: { id: result.responseId, model: result.model, status: 'in_progress' } });
  if (!completedMessage) {
    outputItems.forEach((item, index) => {
      writeSse(response, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: index,
        item,
      });
      writeSse(response, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: index,
        item,
      });
    });
    writeSse(response, 'response.completed', { type: 'response.completed', response: responseObject(result) });
    response.write('data: [DONE]\n\n');
    response.end();
    return;
  }
  writeSse(response, 'response.output_item.added', {
    type: 'response.output_item.added',
    output_index: outputIndex,
    item: {
      id: messageItemId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    },
  });
  writeSse(response, 'response.content_part.added', {
    type: 'response.content_part.added',
    item_id: messageItemId,
    output_index: outputIndex,
    content_index: contentIndex,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  writeSse(response, 'response.output_text.delta', {
    type: 'response.output_text.delta',
    item_id: messageItemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta: result.outputText,
  });
  writeSse(response, 'response.output_text.done', {
    type: 'response.output_text.done',
    item_id: messageItemId,
    output_index: outputIndex,
    content_index: contentIndex,
    text: result.outputText,
  });
  writeSse(response, 'response.content_part.done', {
    type: 'response.content_part.done',
    item_id: messageItemId,
    output_index: outputIndex,
    content_index: contentIndex,
    part: { type: 'output_text', text: result.outputText, annotations: [] },
  });
  writeSse(response, 'response.output_item.done', {
    type: 'response.output_item.done',
    output_index: outputIndex,
    item: completedMessage,
  });
  writeSse(response, 'response.completed', { type: 'response.completed', response: responseObject(result, messageItemId) });
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
    title: ref.title,
    sha256: ref.sha256,
    contentSha256: ref.contentSha256,
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

function semanticSignalFromRecord(value: Record<string, unknown>): SemanticModalitySignal | undefined {
  const typeKind = modalityKindFromSpecificType(stringField(value.type));
  if (typeKind) return makeSemanticSignal(typeKind, ['structured-type'], true);

  const mediaKind = modalityKindFromMediaType(
    stringField(value.media_type)
      ?? stringField(value.mediaType)
      ?? stringField(value.modality),
  );
  if (mediaKind) return makeSemanticSignal(mediaKind, ['structured-media-type'], true);

  const mimeKind = modalityKindFromMime(stringField(value.mime_type) ?? stringField(value.mimeType));
  if (mimeKind) return makeSemanticSignal(mimeKind, ['structured-mime'], true);

  const genericTypeKind = modalityKindFromGenericType(stringField(value.type));
  if (genericTypeKind) return makeSemanticSignal(genericTypeKind, ['structured-type'], true);

  const ref = stringField(value.ref) ?? stringField(value.file_ref) ?? stringField(value.artifactRef) ?? stringField(value.path) ?? '';
  const extensionKind = modalityKindFromTextualRefExtension(ref);
  if (extensionKind) return makeSemanticSignal(extensionKind, ['ref-extension', ...lexicalRefFeatures(ref)], true);

  return undefined;
}

function makeSemanticSignal(
  kind: ModalityKind,
  evidence: SemanticModalitySignal['evidence'],
  refsFirst: boolean,
): SemanticModalitySignal {
  return { kind, evidence, refsFirst };
}

function finalModalityRoutingSignal(item: ModalityRef): SemanticModalitySignal {
  return item.semanticSignal;
}

function modalityKindFromSpecificType(type: string | undefined): ModalityKind | undefined {
  const normalized = type?.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'input-image' || normalized === 'local-image' || normalized === 'image') return 'vision.image';
  if (normalized === 'input-audio' || normalized === 'audio') return 'audio';
  if (normalized === 'input-video' || normalized === 'video') return 'video';
  if (normalized === 'input-table' || normalized === 'table' || normalized === 'spreadsheet') return 'table';
  return undefined;
}

function modalityKindFromGenericType(type: string | undefined): ModalityKind | undefined {
  const normalized = type?.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'input-file' || normalized === 'file' || normalized === 'document') return 'document';
  return undefined;
}

function modalityKindFromLabel(label: string): ModalityKind | undefined {
  if (/^(?:image|visual|object)$/i.test(label)) return 'vision.image';
  if (/^audio$/i.test(label)) return 'audio';
  if (/^video$/i.test(label)) return 'video';
  if (/^table$/i.test(label)) return 'table';
  if (/^(?:document|file|modality)$/i.test(label)) return undefined;
  return undefined;
}

function modalityKindFromMime(mime: string | undefined): ModalityKind | undefined {
  if (!mime) return undefined;
  if (/^image\//i.test(mime)) return 'vision.image';
  if (/^audio\//i.test(mime)) return 'audio';
  if (/^video\//i.test(mime)) return 'video';
  if (/^(?:text\/csv|text\/tab-separated-values|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel)/i.test(mime)) return 'table';
  if (/^(?:text\/plain|text\/markdown|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation)/i.test(mime)) return 'document';
  return undefined;
}

function modalityKindFromMediaType(value: string | undefined): ModalityKind | undefined {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'image' || normalized === 'visual') return 'vision.image';
  if (normalized === 'audio') return 'audio';
  if (normalized === 'video') return 'video';
  if (normalized === 'table' || normalized === 'spreadsheet') return 'table';
  if (normalized === 'document' || normalized === 'text' || normalized === 'file') return 'document';
  return undefined;
}

function modalityKindFromTextualRef(ref: string): ModalityKind | undefined {
  return modalityKindFromTextualRefExtension(ref);
}

function modalityKindFromTextualRefExtension(ref: string): ModalityKind | undefined {
  if (!ref) return undefined;
  const path = traceRefPath(ref);
  if (!path || !isSafeTraceRef(ref)) return undefined;
  if (/\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic|svg)(?:$|[?#])/i.test(path)) return 'vision.image';
  if (/\.(?:mp3|wav|m4a|flac|ogg)(?:$|[?#])/i.test(path)) return 'audio';
  if (/\.(?:mp4|mov|webm|m4v|avi)(?:$|[?#])/i.test(path)) return 'video';
  if (/\.(?:csv|tsv|xlsx?|ods)(?:$|[?#])/i.test(path)) return 'table';
  if (/\.(?:pdf|docx?|pptx?|txt|md|markdown)(?:$|[?#])/i.test(path)) return 'document';
  return undefined;
}

function lexicalRefFeatures(ref: string): SemanticModalitySignal['evidence'] {
  if (!ref) return [];
  const path = traceRefPath(ref);
  if (!/^(?:artifact|ref|run):/i.test(ref)) return [];
  return /\b(?:upload|image|figure|fig|chart|plot|panel|microscopy|screenshot|photo|picture|visual|diagram|audio|sound|speech|voice|recording|video|movie|clip|screen-recording|table|spreadsheet|csv|tsv|matrix|worksheet|document|doc|pdf|paper|report|slides|presentation|markdown|text)\b/i.test(path)
    ? ['ref-lexical-feature']
    : [];
}

function modalityIdPrefix(kind: ModalityKind) {
  if (kind === 'vision.image') return 'image';
  return kind;
}

function isAllowedTextualModalityRef(ref: string, kind: ModalityKind) {
  if (!isSafeTraceRef(ref)) return false;
  const path = traceRefPath(ref);
  if (!path) return false;
  if (kind === 'vision.image' && path.startsWith('.sciforge/uploads/')) return true;
  if (/^(?:workspace|bundle|bundles|artifact|artifacts|upload|uploads|images|objects|files|runs)\//i.test(path)) return true;
  if (/^[A-Za-z0-9._@/-]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic|svg|mp3|wav|m4a|flac|ogg|mp4|mov|webm|m4v|avi|csv|tsv|xlsx?|ods|pdf|docx?|pptx?|txt|md|markdown)$/i.test(path)) return true;
  return /^(?:artifact|ref|run):/i.test(ref) && modalityKindFromTextualRef(ref) === kind;
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

function mentionsModalityUnavailable(value: string) {
  return /could not inspect (?:the )?(?:image|referenced (?:\w+\s+)?modality|modality)|(?:image|referenced (?:\w+\s+)?modality|modality) (?:could not be|was not) inspected|(?:visual|modality) input.*unavailable|无法(?:检查|查看|读取).*(?:图|模态|引用)|不能(?:检查|查看|读取).*(?:图|模态|引用)/i.test(value);
}

function degradedUnavailablePrefix(modalities: ModalityRef[]) {
  return modalities.length > 0 && modalities.every((item) => item.kind === 'vision.image')
    ? 'I could not inspect the image.'
    : 'I could not inspect the referenced modality.';
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
