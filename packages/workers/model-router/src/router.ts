import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  anthropicMessagesToResponses,
  chatCompletionToResponse,
  chatToolNameAliasesFromResponsesTools,
  estimateAnthropicMessagesInputTokens,
  makeId,
  messageOutputItem,
  responseToAnthropicMessage,
  responsesToChatCompletions,
  type AnthropicMessagesRequest,
  type JsonObject,
  type JsonValue,
  type ResponsesRequest,
} from './response-compat';
import {
  createModelRouterWorkerDiagnostics,
  modelRouterManifest,
  type ModelRouterUpstreamDiagnostic,
} from './manifest';
import { readIncomingMessageBody } from './http-body';
import { hygienizeChatProviderBody } from './request-hygiene';
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
  runtimeApiKeyEnv?: string;
  profiles: Record<string, ModelRouterProfile>;
}

export interface ModelRouterServerOptions {
  config: ModelRouterConfig;
  env?: Record<string, string | undefined>;
  workspaceRoot?: string;
  traceDataRoot?: string;
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

type ToolResultImage = {
  dataBase64: string;
  mimeType: string;
  width?: number;
  height?: number;
  title?: string;
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
  providerAliasSha256: string;
  modelAliasSha256: string;
  wireApi: 'chat.completions';
  wireRequest: {
    urlSha256: string;
    endpointRoute: 'chat.completions';
    bodyShape: {
      modelAliasSha256: string;
      messageCount: number;
      toolCount: number;
      hasImageParts: boolean;
      textCharCount: number;
      maxTokensSet: boolean;
      temperatureSet: boolean;
    };
  };
  latencyMs: number;
  stopReason?: 'stop' | 'tool_calls' | 'length' | 'error' | 'unknown';
  errorSummary?: string;
};

const MIN_MULTIMODAL_TEXT_REASONER_MAX_TOKENS = 1024;

type RecentProviderError = {
  code: string;
  status?: number;
  at: number;
  role?: ProviderCallRecord['role'];
};

type RequestAuditMetadata = {
  schemaVersion: 'sciforge.model-router.request-audit.v1';
  route: 'model-router.responses' | 'model-router.messages';
  source?: string;
  operation?: string;
  runtimeId?: string;
  threadIdSha256?: string;
  sourceRuntimeId?: string;
  sourceThreadIdSha256?: string;
  targetRuntimeId?: string;
  targetThreadIdSha256?: string;
  packetDigest?: string;
  sourceDigest?: string;
};

type ResponseUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens_details: {
    reasoning_tokens: number;
  };
  prompt_tokens: number;
  completion_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
};

type VisionTranslationCacheEntry = {
  schemaVersion: 'sciforge.model-router.vision-translation-cache-entry.v1';
  profileId: string;
  modalityCacheKey: string;
  observation: string;
  status: 'ok';
  version: number;
  createdAt: string;
  updatedAt: string;
};

type RoutedResponse = {
  responseId: string;
  model: string;
  outputText: string;
  outputItems: JsonObject[];
  traceRef: string;
  usage: ResponseUsage;
};

type ToolCallCache = Map<string, JsonObject>;

type TextControl =
  | { type: 'final_answer'; content: string }
  | { type: 'need_more_visual_info'; target: string; question: string; reason?: string };

const MAX_TRANSIENT_PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MODEL_ROUTER_REQUEST_BODY_BYTES = 40 * 1024 * 1024;
const MAX_TOOL_CALL_CACHE_ENTRIES = 512;
const MAX_TEXT_MODALITY_BYTES = 256 * 1024;
export const DEFAULT_MODEL_ROUTER_TRACE_ROOT = 'traces';
const RECENT_PROVIDER_AUTH_ERROR_TTL_MS = 30 * 60 * 1000;

// Uploaded scientific files (sequence / structure / spectra) that a domain expert model can read.
// These are classified as 'document' for routing but, when the Model-Router-managed sci-modality
// worker is configured (SCIFORGE_SCIMODALITY_SERVICE_URL), are translated to natural-language
// evidence instead of being inlined as raw text.
const SCIENTIFIC_MODALITY_EXTENSIONS =
  /\.(?:fasta|fa|faa|fna|ffn|frn|fastq|fq|smi|smiles|mol|mol2|sdf|mgf|pdb|cif|gb|gbk|gff|gff3|gtf|vcf|bed|nwk|seq)(?:$|[?#])/i;

function isScientificModalityPath(path: string): boolean {
  return SCIENTIFIC_MODALITY_EXTENSIONS.test(path);
}

export function createModelRouterServer(options: ModelRouterServerOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? processEnvSnapshot();
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const traceDataRoot = resolveModelRouterTraceDataRoot(env, options.traceDataRoot);
  const visionTranslationCache = new Map<string, VisionTranslationCacheEntry>();
  // Caches scientific-file expert translations by file-content sha. An agentic turn is several router
  // requests (one per tool round); the uploaded file rides along on each, so without this we'd re-call
  // the GPU expert every round. With it the expert runs once and its output is re-surfaced each round.
  const scientificTranslationCache = new Map<string, ScientificEvidence>();
  const toolCallCache: ToolCallCache = new Map();
  let recentRouterError: RecentProviderError | null = null;
  const recordProviderError = (error: Omit<RecentProviderError, 'at'>) => {
    recentRouterError = {
      ...error,
      at: Date.now(),
    };
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    try {
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { ok: true, service: 'sciforge.model-router', checkedAt: new Date().toISOString() });
      }
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const recentProviderDiagnostic = recentProviderErrorDiagnostic(recentRouterError);
        const upstream = recentProviderDiagnostic
          ? recentProviderDiagnostic
          : modelRouterHealthzUpstreamDiagnostic(options.config, env);
        const diagnostics = createModelRouterWorkerDiagnostics(
          upstream,
          recentProviderDiagnostic ? upstream.category : undefined,
        );
        return sendJson(response, upstream.ok ? 200 : 503, {
          ok: upstream.ok,
          service: 'sciforge.model-router',
          checkedAt: new Date().toISOString(),
          version: diagnostics.version,
          transport: diagnostics.transport,
          health: diagnostics.health,
          recentError: diagnostics.recentError,
          capabilities: diagnostics.capabilities,
          upstream,
        });
      }
      if (request.method === 'GET' && url.pathname === '/manifest') {
        return sendJson(response, 200, modelRouterManifest as unknown as JsonObject);
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        assertRuntimeAuthorized(request, options.config, env);
        const publicModelAlias = options.config.publicModelAlias ?? 'sciforge-model-router';
        const publicModel = {
          slug: publicModelAlias,
          display_name: publicModelAlias,
          id: publicModelAlias,
          object: 'model',
          owned_by: 'sciforge',
        };
        return sendJson(response, 200, {
          object: 'list',
          data: [publicModel],
          models: [publicModel],
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request);
        if (isRecord(body) && body.stream === true) {
          const responseId = makeId('resp');
          return sendDeferredResponseStream(
            response,
            responseId,
            options.config.publicModelAlias ?? 'sciforge-model-router',
            routeResponsesRequest(body, {
              config: options.config,
              env,
              fetchImpl,
              workspaceRoot,
              traceDataRoot,
              request,
              visionTranslationCache,
              scientificTranslationCache,
              toolCallCache,
              responseId,
              recordProviderError,
            }),
          );
        }
        const result = await routeResponsesRequest(body, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          traceDataRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          toolCallCache,
          recordProviderError,
        });
        return sendJson(response, 200, responseObject(result));
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request);
        if (!isRecord(body)) {
          throw routerError(400, 'invalid_request', 'Chat completions request body must be a JSON object.');
        }
        if (body.stream === true) {
          throw routerError(400, 'unsupported_stream', 'Streaming chat completions are not supported by the Model Router public compatibility endpoint yet.');
        }
        const publicModelAlias = options.config.publicModelAlias ?? 'sciforge-model-router';
        const responseRequest = chatCompletionsToResponsesRequest(body, publicModelAlias);
        const result = await routeResponsesRequest(responseRequest, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          traceDataRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          toolCallCache,
          recordProviderError,
        });
        return sendJson(response, 200, responseToChatCompletion(responseObject(result), body));
      }
      if (
        request.method === 'POST' &&
        (url.pathname === '/v1/messages' || url.pathname === '/api/cc/v1/messages')
      ) {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request) as AnthropicMessagesRequest;
        const publicModelAlias = options.config.publicModelAlias ?? 'sciforge-model-router';
        const bodyForRouting = normalizeAnthropicMessagesRouterModel(body, publicModelAlias);
        const responseModel = stringField(body.model) || publicModelAlias;
        const responseRequest = anthropicMessagesToResponses(body, {
          defaultModel: publicModelAlias,
        });
        responseRequest.model = stringField(bodyForRouting.model) || publicModelAlias;
        if (isRecord(body) && body.stream === true) {
          const responseId = makeId('msg');
          return sendDeferredAnthropicMessageStream(
            response,
            responseId,
            responseModel,
            body,
            routeResponsesRequest(responseRequest, {
              config: options.config,
              env,
              fetchImpl,
              workspaceRoot,
              traceDataRoot,
              request,
              visionTranslationCache,
              scientificTranslationCache,
              toolCallCache,
              responseId,
              recordProviderError,
            }),
          );
        }
        const result = await routeResponsesRequest(responseRequest, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          traceDataRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          toolCallCache,
          recordProviderError,
        });
        return sendJson(response, 200, responseToAnthropicMessage(responseObject(result), body));
      }
      if (
        request.method === 'POST' &&
        (url.pathname === '/v1/messages/count_tokens' || url.pathname === '/api/cc/v1/messages/count_tokens')
      ) {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request) as AnthropicMessagesRequest;
        return sendJson(response, 200, {
          input_tokens: estimateAnthropicMessagesInputTokens(body),
        });
      }
      return sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found' } });
    } catch (error) {
      const routerError = normalizeRouterError(error);
      recordProviderError({
        code: routerError.code,
        status: routerError.status,
      });
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

function recentProviderErrorDiagnostic(error: RecentProviderError | null): ModelRouterUpstreamDiagnostic | null {
  if (!error) return null;
  if (Date.now() - error.at > RECENT_PROVIDER_AUTH_ERROR_TTL_MS) return null;
  const category = providerDiagnosticCategory(error.code, error.status);
  if (!category) return null;
  return {
    category,
    ok: false,
    retryable: category === 'provider-network' || category === 'provider-error',
    ...(error.status ? { httpStatus: error.status } : {}),
    ...(error.role ? { role: error.role } : {}),
    releaseAcceptance: 'not-evaluated',
  };
}

function providerDiagnosticCategory(
  code: string,
  status?: number,
): ModelRouterUpstreamDiagnostic['category'] | null {
  if (/^provider_http_40[13]$/.test(code) || status === 401 || status === 403) return 'provider-auth';
  if (/^provider_exception_(?:timeout|network|fetch_failed)/.test(code)) return 'provider-network';
  if (code === 'provider_invalid_json' || code === 'provider_error_payload') return 'provider-bad-response';
  if (code.startsWith('provider_http_') || code.startsWith('provider_exception_')) return 'provider-error';
  return null;
}

function recordProviderAuthFailure(
  context: { recordProviderError?: (error: Omit<RecentProviderError, 'at'>) => void },
  summary: string,
  role: ProviderCallRecord['role'],
): void {
  const match = /^provider_http_(40[13])$/.exec(summary);
  if (!match) return;
  context.recordProviderError?.({
    code: summary,
    status: Number(match[1]),
    role,
  });
}

function assertRuntimeAuthorized(
  request: IncomingMessage,
  config: ModelRouterConfig,
  env: Record<string, string | undefined>,
): void {
  const runtimeApiKeyEnv = config.runtimeApiKeyEnv ?? 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY';
  const runtimeApiKey = stringField(env[runtimeApiKeyEnv]);
  if (!runtimeApiKey) throw routerError(503, 'missing_runtime_api_key', 'Model Router runtime API key is not configured.');
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const xApiKey = Array.isArray(request.headers['x-api-key'])
    ? request.headers['x-api-key'][0]
    : request.headers['x-api-key'];
  if (authorization !== `Bearer ${runtimeApiKey}` && xApiKey !== runtimeApiKey) {
    throw routerError(401, 'unauthorized', 'Missing or invalid Model Router runtime API key.');
  }
}

function modelRouterHealthzUpstreamDiagnostic(
  config: ModelRouterConfig,
  env: Record<string, string | undefined>,
): ModelRouterUpstreamDiagnostic {
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
  const visionProvider = profile.translators.vision;
  if (visionProvider) {
    if (!visionProvider.baseUrl || !visionProvider.model) {
      return {
        category: 'repo-bug',
        ok: false,
        retryable: false,
        releaseAcceptance: 'not-evaluated',
      };
    }
    if (!stringField(env[visionProvider.apiKeyEnv])) {
      return {
        category: 'provider-auth',
        ok: false,
        retryable: false,
        httpStatus: 401,
        role: 'visionTranslator',
        releaseAcceptance: 'not-evaluated',
      };
    }
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
    traceDataRoot: string;
    request: IncomingMessage;
    visionTranslationCache: Map<string, VisionTranslationCacheEntry>;
    scientificTranslationCache: Map<string, ScientificEvidence>;
    toolCallCache: ToolCallCache;
    responseId?: string;
    recordProviderError?: (error: Omit<RecentProviderError, 'at'>) => void;
  },
): Promise<RoutedResponse> {
  const request = isRecord(body) ? body : {};
  const profileId = requestedProfileId(request, context.request, context.config);
  const profile = context.config.profiles[profileId];
  if (!profile) throw routerError(400, 'unknown_profile', 'Requested Model Router profile is not registered.');
  validateRequestedModel(request.model, context.config.publicModelAlias);
  validateProfile(profile);
  const textSecret = secretForProvider(profile.textReasoner, context.env, 'textReasoner');
  const visionTranslator = profile.translators.vision;
  const visionSecret = visionTranslator ? optionalSecretForProvider(visionTranslator, context.env) : undefined;

  const responseId = context.responseId ?? makeId('resp');
  const trace = createTraceContext(context.workspaceRoot, context.traceDataRoot, profile.traceRoot, responseId);
  const requestInputs = extractRequestInputs(request.input, request.instructions);
  const requestAuditMetadata = requestAuditMetadataFromRequest(request.metadata, requestAuditRoute(context.request));
  const extracted = {
    ...requestInputs,
    modalities: await materializeWorkspaceImageRefs(requestInputs.modalities, context.workspaceRoot),
  };
  const calls: ProviderCallRecord[] = [];
  const observations: string[] = [];
  const scientificEvidence: ScientificEvidence[] = [];
  let degraded = false;
  let imageNotSent = false;
  const publicModelAlias = context.config.publicModelAlias ?? 'sciforge-model-router';
  const traceRedactionSecrets = [textSecret, visionSecret]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const usage = emptyResponseUsage();
  const hasToolTranscriptInput = responseInputHasToolTranscript(request.input);
  const hasAssistantReasoningInput = responseInputHasAssistantReasoning(request.input);
  const requestForTextReasoner = hasToolTranscriptInput
    ? {
      ...request,
      input: repairResponseToolTranscriptInput(
        hydrateFunctionCallTranscript(request.input, context.toolCallCache),
      ),
    }
    : request;
  const textReasonerRequestOptions = chatRequestOptionsFromResponsesRequest(requestForTextReasoner, profile.textReasoner.model);
  const toolNameAliases = chatToolNameAliasesFromResponsesTools(request.tools);
  const textReasonerMessages = hasToolTranscriptInput || hasAssistantReasoningInput
    ? chatMessagesFromResponsesRequest(requestForTextReasoner, profile.textReasoner.model)
    : [];

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
    for (const item of unsupportedModalities) {
      // 1) Scientific file (.fasta / .smi / .mol / .mgf …) + managed sci-modality worker configured:
      //    translate to natural-language evidence (the worker owns retry).
      const expert = await translateScientificModalityObservation(item, context.workspaceRoot, context.env, context.fetchImpl, context.scientificTranslationCache);
      if (expert) {
        observations.push(expert.observation);
        scientificEvidence.push(expert.evidence);
        continue;
      }
      // 2) Otherwise, if the ref is a readable workspace text file (e.g. .txt / .csv / unmatched scientific
      //    file when the service is down), inline its content so the text reasoner can answer directly.
      const inlined = await readWorkspaceTextModalityObservation(item, context.workspaceRoot);
      if (inlined) {
        observations.push(inlined);
        continue;
      }
      // 3) No translator role and not inlineable: degrade and tell the model it could not be inspected.
      degraded = true;
      observations.push([
        `modality_input=${item.id}`,
        `kind=${item.kind}`,
        'status=unsupported',
        'reason=Model Router has no registered translator role for this modality kind in the active profile.',
        'instruction=Answer from text-only context and explicitly state that the referenced modality could not be inspected.',
      ].join('\n'));
    }
  }

  if (visionModalities.length > 0) {
    if (!visionTranslator || !visionSecret) {
      degraded = true;
      imageNotSent = true;
      const reason = !visionTranslator
        ? 'Active Model Router profile has no vision translator; the image payload was not sent to the text-only model.'
        : 'Active Model Router profile has no usable vision translator secret; the image payload was not sent to the text-only model.';
      for (const modality of visionModalities) {
        const observation = formatVisionNotSentObservation(modality, reason);
        observations.push(observation);
        await writeTraceJson(trace, `vision-initial-${modality.id}.json`, {
          schemaVersion: 'sciforge.model-router.vision-observation.v1',
          phase: 'initial',
          status: 'not_sent',
          cacheStatus: 'skipped',
          targetIds: [modality.id],
          observationSummary: boundedTraceText(observation, profile, publicModelAlias, traceRedactionSecrets),
        });
      }
    } else {
      for (const modality of visionModalities) {
        const cacheKey = visionObservationCacheKey(profileId, modality);
        const cached = context.visionTranslationCache.get(cacheKey);
        if (cached) {
          const cachedObservation = formatCachedVisionTranslationObservation(modality, cached);
          observations.push(cachedObservation);
          await writeTraceJson(trace, `vision-initial-${modality.id}.json`, {
            schemaVersion: 'sciforge.model-router.vision-observation.v1',
            phase: 'initial',
            status: cached.status,
            cacheStatus: 'hit',
            cacheVersion: cached.version,
            targetIds: [modality.id],
            observationSummary: boundedTraceText(cachedObservation, profile, publicModelAlias, traceRedactionSecrets),
          });
          continue;
        }
        let observationStatus: 'ok' | 'failed' = 'ok';
        let observation: string;
        try {
          const result = await callVisionTranslator({
            profile,
            secret: visionSecret,
            fetchImpl: context.fetchImpl,
            instruction: visionTranslatorInstruction(extracted.userText || 'Describe the provided visual input.', modality),
            modality,
            phase: 'vision-initial',
            calls,
          });
          addUsage(usage, result.usage);
          observation = result.outputText;
        } catch (error) {
          degraded = true;
          observationStatus = 'failed';
          const summary = traceErrorSummary(error);
          recordProviderAuthFailure(context, summary, 'visionTranslator');
          observation = [
            `modality_input=${modality.id}`,
            'kind=vision.image',
            'status=unavailable',
            `reason=${summary}`,
            'instruction=Answer from text-only context and explicitly state that the image could not be inspected.',
          ].join('\n');
        }
        observations.push(formatVisionObservation(modality, observation, observationStatus));
        if (observationStatus === 'ok') {
          storeVisionTranslationCacheEntry(context.visionTranslationCache, profileId, modality, observation);
        }
        await writeTraceJson(trace, `vision-initial-${modality.id}.json`, {
          schemaVersion: 'sciforge.model-router.vision-observation.v1',
          phase: 'initial',
          status: observationStatus,
          cacheStatus: observationStatus === 'ok' ? 'stored' : 'miss',
          targetIds: [modality.id],
          observationSummary: boundedTraceText(observations.at(-1) ?? '', profile, publicModelAlias, traceRedactionSecrets),
        });
      }
    }
  }

  let outputText = '';
  let outputItems: JsonObject[] = [];
  try {
    let supplementRounds = 0;
    const configuredSupplementRounds = profile.translators.vision?.maxSupplementRounds ?? 0;
    const maxSupplementRounds = Number.isFinite(configuredSupplementRounds)
      ? Math.max(0, Math.floor(configuredSupplementRounds))
      : 0;

    while (true) {
      const textResult = await callTextReasoner({
        profile,
        secret: textSecret,
        fetchImpl: context.fetchImpl,
        userText: extracted.userText,
        messages: textReasonerMessages,
        observations,
        visualFailure: degraded,
        calls,
        request,
        requestOptions: textReasonerRequestOptions,
        toolNameAliases,
      });
      addUsage(usage, textResult.usage);
      const hasToolCall = textResult.outputItems.some((item) => item.type === 'function_call');
      const reasoningItems = textResult.outputItems.filter((item) => item.type === 'reasoning');
      if (hasToolCall) {
        outputText = textResult.outputText;
        outputItems = textResult.outputItems;
        break;
      }

      const control = parseTextControl(textResult.outputText);
      if (control?.type === 'final_answer') {
        outputText = publicProviderOutputText(control.content, profile, publicModelAlias, traceRedactionSecrets, [context.workspaceRoot]);
        outputItems = reasoningItems;
        break;
      }

      if (control?.type === 'need_more_visual_info' && supplementRounds < maxSupplementRounds && profile.translators.vision && visionSecret) {
        const target = visionModalities.find((modality) => modality.id === control.target);
        if (target) {
          supplementRounds += 1;
          const safeControl = sanitizeTextControl(control, profile, publicModelAlias, traceRedactionSecrets, [context.workspaceRoot]);
          let supplementStatus: 'ok' | 'failed' = 'ok';
          let supplementObservation: string;
          try {
            const result = await callVisionTranslator({
              profile,
              secret: visionSecret,
              fetchImpl: context.fetchImpl,
              instruction: visionSupplementInstruction(extracted.userText || 'Inspect the provided visual input.', target, safeControl),
              modality: target,
              phase: 'vision-supplement',
              calls,
            });
            addUsage(usage, result.usage);
            supplementObservation = result.outputText;
          } catch (error) {
            degraded = true;
            supplementStatus = 'failed';
            const summary = traceErrorSummary(error);
            recordProviderAuthFailure(context, summary, 'visionTranslator');
            supplementObservation = [
              `modality_input=${target.id}`,
              'kind=vision.image',
              'status=unavailable',
              `reason=${summary}`,
              'instruction=Answer from available context and explicitly state that the requested visual detail could not be inspected.',
            ].join('\n');
          }
          observations.push(formatVisionSupplementObservation(target, safeControl, supplementObservation, supplementStatus));
          await writeTraceJson(trace, `vision-supplement-${target.id}-${supplementRounds}.json`, {
            schemaVersion: 'sciforge.model-router.vision-observation.v1',
            phase: 'supplement',
            status: supplementStatus,
            targetIds: [target.id],
            questionSummary: boundedTraceText(safeControl.question, profile, publicModelAlias, traceRedactionSecrets),
            ...(safeControl.reason
              ? { reasonSummary: boundedTraceText(safeControl.reason, profile, publicModelAlias, traceRedactionSecrets) }
              : {}),
            observationSummary: boundedTraceText(observations.at(-1) ?? '', profile, publicModelAlias, traceRedactionSecrets),
          });
          continue;
        }
      }

      outputText = publicProviderOutputText(textResult.outputText, profile, publicModelAlias, traceRedactionSecrets, [context.workspaceRoot]);
      outputItems = reasoningItems;
      break;
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
      requestAuditMetadata,
      status: 'failed',
      errorSummary: traceErrorSummary(error),
    });
    throw error;
  }

  if (!outputText) {
    if (!outputItems.length) {
      outputText = imageNotSent
        ? `${imageNotSentPrefix(extracted.modalities)} Based on the text-only context, I cannot provide details from it.`
        : degraded
          ? `${degradedUnavailablePrefix(extracted.modalities)} Based on the text-only context, I cannot provide details from it.`
        : '';
    }
  }
  if (imageNotSent && !mentionsImageNotSent(outputText)) {
    outputText = `${imageNotSentPrefix(extracted.modalities)} ${outputText}`;
  }
  if (degraded && !mentionsModalityUnavailable(outputText)) {
    outputText = `${degradedUnavailablePrefix(extracted.modalities)} ${outputText}`;
  }
  // Transparency: surface each scientific expert's raw output verbatim at the top of the answer.
  if (scientificEvidence.length > 0) {
    const block = formatScientificEvidenceBlock(scientificEvidence);
    outputText = outputText ? `${block}${outputText}` : block.trimEnd();
    outputItems = prependScientificEvidenceToOutputItems(outputItems, block.trimEnd(), outputText);
  }
  if (outputText && !outputItems.some((item) => item.type !== 'reasoning')) {
    outputItems = [...outputItems, messageOutputItem(outputText)];
  }
  rememberFunctionCalls(context.toolCallCache, outputItems);

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
    requestAuditMetadata,
    status: 'completed',
    outputText,
  });

  return {
    responseId,
    model: context.config.publicModelAlias ?? 'sciforge-model-router',
    outputText,
    outputItems,
    traceRef: trace.relativeDir,
    usage,
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

function requestAuditRoute(incoming: IncomingMessage): RequestAuditMetadata['route'] {
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? '127.0.0.1'}`);
  return url.pathname.includes('/messages') ? 'model-router.messages' : 'model-router.responses';
}

function requestAuditMetadataFromRequest(metadata: unknown, route: RequestAuditMetadata['route']): RequestAuditMetadata | undefined {
  const record = isRecord(metadata) ? metadata : {};
  if (record.schemaVersion !== 'sciforge.model-router.request-audit.v1') return undefined;
  return compactObject({
    schemaVersion: 'sciforge.model-router.request-audit.v1',
    route,
    source: boundedAuditMetadataString(record.source),
    operation: boundedAuditMetadataString(record.operation),
    runtimeId: boundedAuditMetadataString(record.runtimeId),
    threadIdSha256: auditMetadataHash(record.threadId),
    sourceRuntimeId: boundedAuditMetadataString(record.sourceRuntimeId),
    sourceThreadIdSha256: auditMetadataHash(record.sourceThreadId),
    targetRuntimeId: boundedAuditMetadataString(record.targetRuntimeId),
    targetThreadIdSha256: auditMetadataHash(record.targetThreadId),
    packetDigest: safeSha256Digest(record.packetDigest),
    sourceDigest: safeSha256Digest(record.sourceDigest),
  }) as RequestAuditMetadata;
}

function boundedAuditMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 96) return undefined;
  if (!/^[a-z0-9._:-]+$/i.test(trimmed)) return undefined;
  return trimmed;
}

function auditMetadataHash(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? hashForTrace(normalized) : undefined;
}

function safeSha256Digest(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^sha256:[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

function validateRequestedModel(model: unknown, publicModelAlias: string | undefined) {
  if (model === undefined || model === null) return;
  if (typeof model !== 'string' || !model.trim()) throw routerError(400, 'invalid_model', 'Model Router requests must use the public router model alias.');
  const expectedAlias = publicModelAlias ?? 'sciforge-model-router';
  if (model !== expectedAlias) {
    throw routerError(400, 'unregistered_model', 'Model Router requests must use the public router model alias.');
  }
}

function normalizeAnthropicMessagesRouterModel(
  request: AnthropicMessagesRequest,
  publicModelAlias: string,
): AnthropicMessagesRequest {
  const model = stringField(request.model);
  if (!model || model === publicModelAlias || isClaudeCodeModelName(model)) {
    return { ...request, model: publicModelAlias };
  }
  return request;
}

function isClaudeCodeModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'sonnet' ||
    normalized === 'opus' ||
    normalized === 'fable' ||
    normalized === 'haiku' ||
    normalized.startsWith('claude-');
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

function optionalSecretForProvider(config: ModelRouterProviderConfig, env: Record<string, string | undefined>) {
  const secret = env[config.apiKeyEnv];
  return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
}

function extractRequestInputs(input: unknown, instructions: unknown): { userText: string; modalities: ModalityRef[] } {
  const texts: string[] = [];
  if (typeof instructions === 'string' && instructions.trim()) texts.push(instructions.trim());
  const modalities: ModalityRef[] = [];
  visitInput(input, texts, modalities);
  const userText = sanitizeRoutingUserText(texts.filter(Boolean).join('\n').trim());
  const textual = extractTextualModalityRefs(userText, modalities.length + 1);
  return {
    userText: textual.userText,
    modalities: [...modalities, ...textual.modalities],
  };
}

function sanitizeRoutingUserText(value: string): string {
  if (!value) return value;
  return value
    .replace(
      /\[Attached image as base64 text\]([\s\S]*?)Base64:\s*```base64\s*[\s\S]*?```\s*\[\/Attached image\]/g,
      (_matched, metadata: string) => {
        const safeMetadata = metadata
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !/^Base64:/iu.test(line))
          .join('\n');
        return [
          '[Attached image metadata; base64 omitted because the image is routed as structured visual input]',
          safeMetadata,
          '[/Attached image]',
        ].filter(Boolean).join('\n');
      },
    )
    .replace(/\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, '[image data omitted; routed as structured visual input]')
    .replace(/```base64\s*[\s\S]{512,}?```/g, '```base64\n[base64 data omitted]\n```')
    .replace(/\b[A-Za-z0-9+/]{4096,}={0,2}\b/g, '[large base64 data omitted]');
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
  if (type === 'function_call_output') {
    const images = modalityRefsFromToolResultOutput(value.output, modalities.length + 1, stringField(value.call_id) ?? stringField(value.id));
    modalities.push(...images);
    const output = safeTextualFallback(value.output);
    if (output) texts.push(output);
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

const MODEL_VISIBLE_IMAGE_KINDS = new Set(['image', 'computer_screenshot']);
const TOOL_RESULT_IMAGE_PLACEHOLDER = '[image data omitted; image was routed as visual modality input]';

function safeTextualFallback(value: unknown): string {
  let raw = '';
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    raw = parsed === undefined ? value : stringifySafeToolResult(parsed);
  } else {
    raw = stringifySafeToolResult(value);
  }
  const text = raw
    .replace(/\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, '[image data omitted; image was not sent]')
    .replace(/\b[A-Za-z0-9+/]{512,}={0,2}\b/g, '[large base64 data omitted]');
  return boundedText(text.trim(), 4_000);
}

function stringifySafeToolResult(value: unknown): string {
  const stripped = stripToolResultImages(value);
  const normalized = jsonValueField(stripped);
  return normalized === undefined ? '' : JSON.stringify(normalized);
}

function stripToolResultImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripToolResultImages(entry));
  if (!isRecord(value)) return value;

  const clone: Record<string, unknown> = {};
  const isMcpImageContent = value.type === 'image';
  let strippedImage = false;

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'images') {
      clone.images_omitted = Array.isArray(entry) ? entry.length : 1;
      strippedImage = true;
      continue;
    }
    if (key === 'data_base64' || key === 'dataBase64' || (isMcpImageContent && key === 'data')) {
      clone[key] = TOOL_RESULT_IMAGE_PLACEHOLDER;
      strippedImage = true;
      continue;
    }
    clone[key] = stripToolResultImages(entry);
  }
  if (strippedImage && typeof clone.note !== 'string') clone.note = TOOL_RESULT_IMAGE_PLACEHOLDER;
  return clone;
}

function modalityRefsFromToolResultOutput(output: unknown, startOrdinal: number, callId?: string): ModalityRef[] {
  const images = extractToolResultImages(parseToolResultOutput(output));
  return images.map((image, index) => modalityRefFromToolResultImage(image, startOrdinal + index, callId));
}

function parseToolResultOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  return parseJsonValue(output) ?? output;
}

function modalityRefFromToolResultImage(image: ToolResultImage, ordinal: number, callId?: string): ModalityRef {
  const bytes = Buffer.from(image.dataBase64, 'base64');
  const id = `${modalityIdPrefix('vision.image')}_${ordinal}`;
  const title = image.title ?? (callId ? `tool result image ${callId}` : 'tool result image');
  return {
    id,
    kind: 'vision.image',
    source: 'inline',
    mime: image.mimeType,
    title,
    semanticSignal: makeSemanticSignal('vision.image', ['structured-type', 'structured-mime'], true),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    byteLength: bytes.byteLength,
    transientProviderPart: {
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
    },
  };
}

function extractToolResultImages(output: unknown): ToolResultImage[] {
  if (!isRecord(output)) return [];
  const images: ToolResultImage[] = [];
  for (const image of directToolResultImages(output)) addUniqueToolResultImage(images, image);
  for (const image of mcpToolResultImages(output)) addUniqueToolResultImage(images, image);
  for (const image of codexContentItemImages(output)) addUniqueToolResultImage(images, image);
  for (const key of ['result', 'structuredContent', 'output'] as const) {
    const nested = output[key];
    if (isRecord(nested)) {
      for (const image of extractToolResultImages(nested)) addUniqueToolResultImage(images, image);
    } else if (typeof nested === 'string') {
      const parsed = parseJsonValue(nested);
      if (parsed !== undefined) {
        for (const image of extractToolResultImages(parsed)) addUniqueToolResultImage(images, image);
      }
    }
  }
  return images;
}

function codexContentItemImages(output: Record<string, unknown>): ToolResultImage[] {
  const contentItems = Array.isArray(output.contentItems) ? output.contentItems : [];
  const images: ToolResultImage[] = [];
  for (const entry of contentItems) {
    if (!isRecord(entry)) continue;
    addUniqueToolResultImage(images, toolResultImageFromCodexContentItem(entry));
  }
  return images;
}

function directToolResultImages(output: Record<string, unknown>): ToolResultImage[] {
  const kind = stringField(output.kind) ?? '';
  if (!MODEL_VISIBLE_IMAGE_KINDS.has(kind)) return [];
  const images: ToolResultImage[] = [];
  if (Array.isArray(output.images)) {
    for (const entry of output.images) addUniqueToolResultImage(images, toolResultImageFromRecord(entry, output));
  }
  addUniqueToolResultImage(images, toolResultImageFromRecord(output, output));
  return images;
}

function mcpToolResultImages(output: Record<string, unknown>): ToolResultImage[] {
  const structured = isRecord(output.structuredContent) ? output.structuredContent : {};
  const kind = stringField(structured.kind) ?? stringField(output.kind) ?? '';
  if (!MODEL_VISIBLE_IMAGE_KINDS.has(kind)) return [];
  const content = Array.isArray(output.content) ? output.content : [];
  const metadata = Array.isArray(structured.images) ? structured.images : [];
  const images: ToolResultImage[] = [];
  let imageIndex = 0;
  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== 'image') continue;
    addUniqueToolResultImage(images, toolResultImageFromMcpContent(entry, metadata[imageIndex], structured));
    imageIndex += 1;
  }
  return images;
}

function toolResultImageFromRecord(value: unknown, metadata: unknown): ToolResultImage | null {
  if (!isRecord(value)) return null;
  const dataBase64 = stringField(value.data_base64) ?? stringField(value.dataBase64) ?? '';
  const mimeType = stringField(value.mime_type) ?? stringField(value.mimeType) ?? '';
  if (!dataBase64 || !mimeType) return null;
  const meta = isRecord(metadata) ? metadata : {};
  return compactToolResultImage({
    dataBase64,
    mimeType,
    width: numberField(value.width) ?? numberField(meta.width),
    height: numberField(value.height) ?? numberField(meta.height),
    title: stringField(value.title) ?? stringField(value.name) ?? stringField(meta.title) ?? stringField(meta.note),
  });
}

function toolResultImageFromMcpContent(value: Record<string, unknown>, metadata: unknown, structured: unknown): ToolResultImage | null {
  const dataBase64 = stringField(value.data) ?? '';
  const mimeType = stringField(value.mimeType) ?? stringField(value.mime_type) ?? '';
  if (!dataBase64 || !mimeType) return null;
  const meta = isRecord(metadata) ? metadata : {};
  const parent = isRecord(structured) ? structured : {};
  return compactToolResultImage({
    dataBase64,
    mimeType,
    width: numberField(meta.width),
    height: numberField(meta.height),
    title: stringField(meta.title) ?? stringField(parent.title) ?? stringField(parent.note),
  });
}

function toolResultImageFromCodexContentItem(value: Record<string, unknown>): ToolResultImage | null {
  const type = stringField(value.type) ?? '';
  if (type !== 'inputImage') return null;
  const imageUrl = stringField(value.imageUrl) ?? '';
  if (!imageUrl.startsWith('data:image/')) return null;
  const commaIndex = imageUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = imageUrl.slice(0, commaIndex);
  const dataBase64 = imageUrl.slice(commaIndex + 1);
  const mimeType = mimeFromDataUrl(imageUrl) ?? header.slice('data:'.length).split(';', 1)[0];
  if (!dataBase64 || !mimeType) return null;
  return compactToolResultImage({
    dataBase64,
    mimeType,
    width: numberField(value.width),
    height: numberField(value.height),
    title: stringField(value.title) ?? stringField(value.name),
  });
}

function compactToolResultImage(image: ToolResultImage): ToolResultImage {
  return {
    dataBase64: image.dataBase64,
    mimeType: image.mimeType,
    ...(image.width !== undefined ? { width: image.width } : {}),
    ...(image.height !== undefined ? { height: image.height } : {}),
    ...(image.title ? { title: image.title } : {}),
  };
}

function addUniqueToolResultImage(images: ToolResultImage[], image: ToolResultImage | null): void {
  if (!image) return;
  if (!images.some((candidate) => candidate.dataBase64 === image.dataBase64 && candidate.mimeType === image.mimeType)) images.push(image);
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

// Inline a readable workspace text file (e.g. uploaded .txt / .csv / unmatched scientific file) as the
// observation so the text reasoner can answer directly instead of blindly searching the filesystem.
async function readWorkspaceTextModalityObservation(item: ModalityRef, workspaceRoot: string): Promise<string | undefined> {
  const target = await workspaceImageTarget(item, workspaceRoot);
  if (!target) return undefined;
  try {
    const stats = await stat(target.absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TEXT_MODALITY_BYTES) return undefined;
    const bytes = await readFile(target.absolutePath);
    if (bytes.subarray(0, 8192).includes(0)) return undefined; // looks binary
    const text = bytes.toString('utf8');
    if (!text.trim()) return undefined;
    return [
      `modality_input=${item.id}`,
      `kind=${item.kind}`,
      'status=ok',
      `source=workspace-file:${target.relativeRef}`,
      'instruction=The referenced file was read directly. Treat the following contents as the inspected modality and answer the user question from it; do not search the filesystem for it.',
      'content:',
      text,
    ].join('\n');
  } catch {
    return undefined;
  }
}

// Translate an uploaded scientific file to natural-language evidence via the Model-Router-managed
// sci-modality worker. Gated by SCIFORGE_SCIMODALITY_SERVICE_URL; the worker owns modality
// auto-detection + retry/robustness. Translation-only: it returns evidence, never answers. Returns
// undefined (fail-open) when the service is unconfigured, the ref is not a scientific file, the file is
// unreadable/binary, or the call fails — callers then fall back to text inlining.
type ScientificEvidence = { modalityInputId: string; modality: string; model: string; summary: string };

function buildScientificObservation(item: ModalityRef, evidence: ScientificEvidence): string {
  return [
    `modality_input=${item.id}`,
    `kind=${item.kind}`,
    'status=ok',
    `source=sci-modality:${evidence.modality}/${evidence.model}`,
    'instruction=The referenced scientific file was analyzed by a domain expert model. Treat the following evidence as the inspected modality and answer the user question from it; do not search the filesystem for it.',
    'evidence:',
    evidence.summary,
  ].join('\n');
}

async function translateScientificModalityObservation(
  item: ModalityRef,
  workspaceRoot: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  cache?: Map<string, ScientificEvidence>,
): Promise<{ observation: string; evidence: ScientificEvidence } | undefined> {
  const serviceUrl = (env.SCIFORGE_SCIMODALITY_SERVICE_URL ?? '').trim();
  if (!serviceUrl) return undefined;
  const serviceToken = (env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN ?? '').trim();
  if (!serviceToken) return undefined;
  const target = await workspaceImageTarget(item, workspaceRoot);
  if (!target || !isScientificModalityPath(target.relativeRef)) return undefined;
  try {
    const stats = await stat(target.absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TEXT_MODALITY_BYTES) return undefined;
    const bytes = await readFile(target.absolutePath);
    if (bytes.subarray(0, 8192).includes(0)) return undefined; // looks binary
    const payload = bytes.toString('utf8');
    if (!payload.trim()) return undefined;

    // Cache by file-content sha: the same uploaded file rides every tool round of one agentic turn,
    // so translate once and re-surface the block (incl. on the final answer) without re-calling the GPU.
    const cacheKey = createHash('sha256').update(payload).digest('hex');
    const cached = cache?.get(cacheKey);
    if (cached) return { observation: buildScientificObservation(item, cached), evidence: cached };

    const timeoutMs = Number(env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS ?? '') || 1_800_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let json: JsonObject | undefined;
    let ok = false;
    try {
      const resp = await fetchImpl(`${serviceUrl.replace(/\/+$/, '')}/modality/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify({ payload, objectId: item.id }),
        signal: controller.signal,
      });
      ok = resp.ok;
      json = (await resp.json().catch(() => undefined)) as JsonObject | undefined;
    } finally {
      clearTimeout(timer);
    }
    if (!ok || !json || json.ok !== true) return undefined;
    const data = (isRecord(json.data) ? json.data : {}) as JsonObject;
    // Prefer the full multi-line evidence (data.summary) over the bounded preview (json.summary) so both
    // the reasoner and the user-facing transparency block see the expert's raw output.
    const summary = (typeof data.summary === 'string' && data.summary.trim())
      ? data.summary
      : (typeof json.summary === 'string' ? json.summary : '');
    if (!summary.trim()) return undefined;
    const model = typeof data.model === 'string' ? data.model : 'sci-modality';
    const modality = typeof data.modality === 'string' ? data.modality : 'scientific';
    const evidence: ScientificEvidence = { modalityInputId: item.id, modality, model, summary };
    cache?.set(cacheKey, evidence);
    return { observation: buildScientificObservation(item, evidence), evidence };
  } catch {
    return undefined;
  }
}

// Transparency: a user-facing block that shows each scientific expert's RAW output verbatim, plus which
// expert the router selected. Prepended to the final answer so SciForge surfaces what the (translate-only)
// domain model actually emitted instead of hiding it behind the reasoner.
function formatScientificEvidenceBlock(evidence: ScientificEvidence[]): string {
  const sections = evidence
    .map((e) => `#### 🔬 ${e.modality} expert — raw output\nRouted to expert model \`${e.model}\` (translate-only).\n\n\`\`\`\n${e.summary.trim()}\n\`\`\``)
    .join('\n\n');
  return [
    '> **SciForge Model Router — expert translation (transparent)**',
    '> Your scientific input was routed to a domain expert model whose only job is to translate it to text. Its raw output is shown verbatim below.',
    '',
    sections,
    '',
    '---',
    '',
  ].join('\n');
}

function prependScientificEvidenceToOutputItems(items: JsonObject[], block: string, outputText: string): JsonObject[] {
  if (!items.length) return items;
  const messageIndex = items.findIndex((item) => item.type === 'message');
  if (messageIndex < 0) {
    return items.some((item) => item.type !== 'reasoning') ? [messageOutputItem(block), ...items] : items;
  }
  return items.map((item, index) => (
    index === messageIndex ? replaceMessageOutputText(item, outputText) : item
  ));
}

function replaceMessageOutputText(item: JsonObject, text: string): JsonObject {
  const content = Array.isArray(item.content) ? item.content : [];
  let replaced = false;
  const nextContent = content.map((part) => {
    if (!replaced && isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
      replaced = true;
      return { ...part, text };
    }
    return part;
  });
  if (!replaced) {
    nextContent.unshift({ type: 'output_text', text, annotations: [] });
  }
  return { ...item, content: nextContent };
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
  const target = await workspaceImageTarget(item, workspaceRoot);
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

async function workspaceImageTarget(item: ModalityRef, workspaceRoot: string): Promise<{ absolutePath: string; relativeRef: string } | undefined> {
  const workspaceCandidate = resolve(workspaceRoot);
  const candidate = item.materializationPath
    ? filesystemPathFromLocalCandidate(item.materializationPath)
    : item.safeRef
      ? traceRefPath(item.safeRef)
      : undefined;
  if (!candidate) return undefined;
  if (!item.materializationPath && !isConservativeTraceRefPath(candidate)) return undefined;
  const lexicalPath = isAbsolute(candidate) ? resolve(candidate) : resolve(workspaceCandidate, candidate);
  if (!isPathInsideWorkspace(lexicalPath, workspaceCandidate)) return undefined;
  try {
    const workspace = await realpath(workspaceCandidate);
    const absolutePath = await realpath(lexicalPath);
    if (!isPathInsideWorkspace(absolutePath, workspace)) return undefined;
    const relativeRef = relative(workspace, absolutePath).replace(/\\/g, '/');
    return { absolutePath, relativeRef };
  } catch {
    return undefined;
  }
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

function formatVisionNotSentObservation(modality: ModalityRef, reason: string) {
  return [
    `Target modality_input: ${modality.id}`,
    'kind=vision.image',
    'status=not_sent',
    'image_payload_sent=false',
    `reason=${reason}`,
    modality.title ? `Object title: ${modality.title}` : '',
    modality.safeRef ? `Object ref: ${modality.safeRef}` : '',
    modality.mime ? `mime=${modality.mime}` : '',
    modality.byteLength !== undefined ? `byte_length=${modality.byteLength}` : '',
    `source=${modality.source}`,
    'text_fallback_summary=Only safe text metadata and surrounding text were forwarded; pixel data was not inspected.',
    'instruction=Answer from text-only context and explicitly state that the image was not sent to the active text-only model and could not be inspected.',
  ].filter(Boolean).join('\n');
}

function formatCachedVisionTranslationObservation(modality: ModalityRef, cached: VisionTranslationCacheEntry) {
  return [
    formatVisionObservation(modality, cached.observation, cached.status),
    'cache_status=hit',
    `translation_cache_version=${cached.version}`,
    'instruction=Use this cached structured visual observation unless the current request requires a targeted refinement for missing details.',
  ].join('\n');
}

function visionSupplementInstruction(userInstruction: string, modality: ModalityRef, control: Extract<TextControl, { type: 'need_more_visual_info' }>) {
  return [
    `User request: ${userInstruction}`,
    `Target modality_input: ${modality.id}`,
    modality.title ? `Object title: ${modality.title}` : '',
    modality.safeRef ? `Object ref: ${modality.safeRef}` : '',
    `Targeted follow-up question: ${control.question}`,
    control.reason ? `Reason detail is needed: ${control.reason}` : '',
    'Translate only the requested visual detail into concise textual evidence for the Agent Host.',
    'Do not claim task completion and do not mention router internals.',
  ].filter(Boolean).join('\n');
}

function formatVisionSupplementObservation(
  modality: ModalityRef,
  control: Extract<TextControl, { type: 'need_more_visual_info' }>,
  observation: string,
  status: 'ok' | 'failed',
) {
  return [
    `Target modality_input: ${modality.id}`,
    'kind=vision.image',
    'phase=supplement',
    `status=${status}`,
    `question=${control.question}`,
    control.reason ? `reason=${control.reason}` : '',
    observation,
  ].filter(Boolean).join('\n');
}

function storeVisionTranslationCacheEntry(
  cache: Map<string, VisionTranslationCacheEntry>,
  profileId: string,
  modality: ModalityRef,
  observation: string,
) {
  const modalityCacheKey = visionObservationCacheKey(profileId, modality);
  const existing = cache.get(modalityCacheKey);
  const now = new Date().toISOString();
  cache.set(modalityCacheKey, {
    schemaVersion: 'sciforge.model-router.vision-translation-cache-entry.v1',
    profileId,
    modalityCacheKey,
    observation,
    status: 'ok',
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function visionObservationCacheKey(profileId: string, modality: ModalityRef) {
  return [
    profileId,
    modality.contentSha256 ?? modality.sha256,
  ].join(':');
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
  return result;
}

async function callTextReasoner(options: {
  profile: ModelRouterProfile;
  secret: string;
  fetchImpl: typeof fetch;
  userText: string;
  messages: JsonObject[];
  observations: string[];
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
      'If any image observation has status=not_sent, the final answer must explicitly state that the image was not sent to the active text-only model and could not be inspected.',
    ].join(' ')
    : undefined;
  const messages: JsonObject[] = options.observations.length
    ? [
      ...(controlInstruction ? [{ role: 'system', content: controlInstruction }] : []),
      {
      role: 'user',
      content: [
        options.userText ? `User request:\n${options.userText}` : 'User request is empty.',
        'Modality evidence:',
        ...options.observations.map((observation, index) => `Observation ${index + 1}:\n${observation}`),
        options.visualFailure ? 'Router degradation: at least one referenced modality could not be inspected.' : '',
      ].filter(Boolean).join('\n\n'),
      },
    ]
    : options.messages.length > 0 ? options.messages : [{ role: 'user', content: options.userText }];
  return await callChatProvider({
    provider: options.profile.textReasoner,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    body: {
      model: options.profile.textReasoner.model,
      messages,
      ...multimodalTextReasonerRequestOptions(options.requestOptions, options.observations.length > 0),
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
  const body = hygienizeChatProviderBody(options.body);
  let response: Response;
  try {
    response = await options.fetchImpl(providerChatCompletionsUrl(options.provider.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.secret}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const errorSummary = providerExceptionSummary(error, 'fetch_failed');
    recordFailedProviderCall({ ...options, body }, Date.now() - startedAt, errorSummary);
    throw routerError(500, errorSummary, `Provider request failed (${errorSummary}).`);
  }
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const errorSummary = `provider_http_${response.status}`;
    recordFailedProviderCall({ ...options, body }, latencyMs, errorSummary);
    throw routerError(response.status, errorSummary, providerHttpErrorMessage(response.status, options.provider, options.secret, errorText));
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const errorSummary = 'provider_invalid_json';
    recordFailedProviderCall({ ...options, body }, latencyMs, errorSummary);
    throw routerError(500, 'provider_invalid_json', 'Provider returned a non-JSON response.');
  }
  if (isProviderErrorPayload(payload)) {
    const errorSummary = 'provider_error_payload';
    recordFailedProviderCall({ ...options, body }, latencyMs, errorSummary);
    throw routerError(500, 'provider_error_payload', 'Provider returned an error payload instead of a chat completion.');
  }
  options.calls.push({
    role: options.role,
    phase: options.phase,
    status: 'ok',
    roleAlias: roleAliasForCall(options.role),
    providerBindingSha256: providerBindingHash(options.provider),
    ...providerCallTraceFields(options.provider, body),
    wireApi: 'chat.completions',
    latencyMs,
    stopReason: chatCompletionStopReason(payload),
  });
  return chatCompletionResult(payload, options.responseRequest, options.toolNameAliases);
}

function providerExceptionSummary(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (name.includes('abort') || message.includes('timeout') || message.includes('timed out')) {
    return 'provider_exception_timeout';
  }
  if (message.includes('econnreset') || message.includes('socket') || message.includes('network')) {
    return 'provider_exception_network';
  }
  return `provider_exception_${fallback.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}`;
}

function isProviderErrorPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload.error !== undefined && !Array.isArray(payload.choices);
}

function providerChatCompletionsUrl(baseUrl: string): string {
  return buildProviderEndpointUrl(baseUrl, 'chat/completions');
}

function buildProviderEndpointUrl(baseUrl: string, path: string): string {
  const normalized = trimUrlPathEnd(baseUrl);
  if (!normalized) return `/v1/${path}`;
  if (normalized.toLowerCase().endsWith(`/${path}`)) return normalized;
  const withoutEndpoint = stripKnownProviderEndpointPath(normalized);
  const lastSegment = lastUrlPathSegment(withoutEndpoint).toLowerCase();
  if (lastSegment === 'beta') {
    return appendUrlPath(removeLastUrlPathSegment(withoutEndpoint), `v1/${path}`);
  }
  if (/^v\d+$/.test(lastSegment)) {
    return appendUrlPath(withoutEndpoint, path);
  }
  return appendUrlPath(withoutEndpoint, `v1/${path}`);
}

function stripKnownProviderEndpointPath(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl);
  const lower = split.path.toLowerCase();
  for (const path of ['chat/completions', 'responses', 'messages']) {
    if (lower.endsWith(`/${path}`)) {
      return `${split.path.slice(0, -path.length).replace(/\/+$/, '')}${split.suffix}`;
    }
  }
  return baseUrl;
}

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const suffixStart = url.search(/[?#]/);
  if (suffixStart < 0) return { path: url, suffix: '' };
  return { path: url.slice(0, suffixStart), suffix: url.slice(suffixStart) };
}

function trimUrlPathEnd(url: string): string {
  const split = splitUrlSuffix(url.trim());
  return `${split.path.replace(/\/+$/, '')}${split.suffix}`;
}

function appendUrlPath(baseUrl: string, path: string): string {
  const split = splitUrlSuffix(baseUrl);
  return `${split.path.replace(/\/+$/, '')}/${path}${split.suffix}`;
}

function lastUrlPathSegment(url: string): string {
  const split = splitUrlSuffix(url.trim());
  return split.path.replace(/\/+$/, '').split('/').pop() ?? '';
}

function removeLastUrlPathSegment(url: string): string {
  const split = splitUrlSuffix(url.trim());
  const trimmed = split.path.replace(/\/+$/, '');
  const slashIndex = trimmed.lastIndexOf('/');
  return `${slashIndex < 0 ? trimmed : trimmed.slice(0, slashIndex)}${split.suffix}`;
}

function providerHttpErrorMessage(
  status: number,
  provider: ModelRouterProviderConfig,
  secret: string,
  responseBody: string,
): string {
  const prefix = isProviderAuthStatus(status)
    ? `Provider returned HTTP ${status}: upstream provider credentials were rejected. Update the upstream API key in SciForge Model Router settings, then restart or reload the router.`
    : `Provider returned HTTP ${status}`;
  const body = responseBody.trim();
  if (!body) return prefix;
  return `${prefix}: ${boundedProviderTraceText(body, provider, [secret])}`;
}

function isProviderAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function recordFailedProviderCall(
  options: {
    provider: ModelRouterProviderConfig;
    secret?: string;
    body?: Record<string, unknown>;
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
    ...providerCallTraceFields(options.provider, options.body ?? {}),
    wireApi: 'chat.completions',
    latencyMs,
    stopReason: 'error',
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
    reasoning: chatRequest.reasoning,
    reasoning_effort: chatRequest.reasoning_effort,
    include_reasoning: chatRequest.include_reasoning,
  }).filter(([, value]) => value !== undefined));
}

function multimodalTextReasonerRequestOptions(options: Record<string, unknown>, hasModalityObservations: boolean): Record<string, unknown> {
  if (!hasModalityObservations) return options;
  const maxTokens = chatMaxTokens(options.max_tokens);
  if (maxTokens === undefined || maxTokens >= MIN_MULTIMODAL_TEXT_REASONER_MAX_TOKENS) return options;
  return {
    ...options,
    max_tokens: MIN_MULTIMODAL_TEXT_REASONER_MAX_TOKENS,
  };
}

function chatMaxTokens(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return undefined;
}

function chatMessagesFromResponsesRequest(request: Record<string, unknown>, defaultModel: string): JsonObject[] {
  const chatRequest = responsesToChatCompletions({
    ...request,
    model: defaultModel,
  }, { defaultModel });
  return Array.isArray(chatRequest.messages)
    ? chatRequest.messages.filter(isRecord) as JsonObject[]
    : [];
}

function responseInputHasToolTranscript(input: unknown): boolean {
  return Array.isArray(input) && input.some((item) => {
    if (!isRecord(item)) return false;
    return item.type === 'function_call' || item.type === 'function_call_output';
  });
}

function responseInputHasAssistantReasoning(input: unknown): boolean {
  return Array.isArray(input) && input.some((item) => {
    if (!isRecord(item)) return false;
    return item.role === 'assistant' && typeof item.reasoning_content === 'string' && item.reasoning_content.trim().length > 0;
  });
}

function hydrateFunctionCallTranscript(input: unknown, cache: ToolCallCache): unknown {
  if (!Array.isArray(input)) return input;
  let changed = false;
  const seenFunctionCallIds = new Set<string>();
  const hydrated: unknown[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      hydrated.push(item);
      continue;
    }

    if (item.type === 'function_call') {
      const callId = stringField(item.call_id) ?? stringField(item.id);
      if (callId) seenFunctionCallIds.add(callId);
      const cached = callId ? cache.get(callId) : undefined;
      if (cached && !stringField(item.reasoning_content) && stringField(cached.reasoning_content)) {
        changed = true;
        hydrated.push({
          ...item,
          reasoning_content: cached.reasoning_content,
        });
      } else {
        hydrated.push(item);
      }
      continue;
    }

    if (item.type === 'function_call_output') {
      const callId = stringField(item.call_id) ?? stringField(item.id);
      const cached = callId ? cache.get(callId) : undefined;
      if (callId && cached && !seenFunctionCallIds.has(callId)) {
        changed = true;
        hydrated.push({ ...cached });
        seenFunctionCallIds.add(callId);
      }
    }

    hydrated.push(item);
  }
  return changed ? hydrated : input;
}

function repairResponseToolTranscriptInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  let changed = false;
  const repaired: unknown[] = [];
  let pendingCalls: JsonObject[] = [];
  let pendingOutputs: JsonObject[] = [];
  let pendingCallIds = new Set<string>();
  let pendingOutputIds = new Set<string>();

  const resetPending = (markChanged: boolean): void => {
    if (markChanged && (pendingCalls.length > 0 || pendingOutputs.length > 0)) changed = true;
    pendingCalls = [];
    pendingOutputs = [];
    pendingCallIds = new Set<string>();
    pendingOutputIds = new Set<string>();
  };

  const flushPendingIfComplete = (): boolean => {
    if (pendingCalls.length === 0) return true;
    if (pendingOutputIds.size !== pendingCallIds.size) return false;
    repaired.push(...pendingCalls, ...pendingOutputs);
    resetPending(false);
    return true;
  };

  for (const item of input) {
    if (!isRecord(item)) {
      resetPending(true);
      repaired.push(item);
      continue;
    }

    if (item.type === 'function_call') {
      const callId = responseToolTranscriptCallId(item);
      if (!callId) {
        changed = true;
        continue;
      }
      if (pendingOutputs.length > 0) {
        if (!flushPendingIfComplete()) resetPending(true);
      }
      if (pendingCallIds.has(callId)) {
        changed = true;
        continue;
      }
      pendingCalls.push(item as JsonObject);
      pendingCallIds.add(callId);
      continue;
    }

    if (item.type === 'function_call_output') {
      const callId = responseToolTranscriptCallId(item);
      if (!callId || !pendingCallIds.has(callId) || pendingOutputIds.has(callId)) {
        changed = true;
        continue;
      }
      pendingOutputs.push(item as JsonObject);
      pendingOutputIds.add(callId);
      if (pendingOutputIds.size === pendingCallIds.size) flushPendingIfComplete();
      continue;
    }

    if (pendingCalls.length > 0 && isResponseToolTranscriptBridgeItem(item)) {
      changed = true;
      continue;
    }

    resetPending(true);
    repaired.push(item);
  }

  resetPending(true);
  return changed ? repaired : input;
}

function responseToolTranscriptCallId(item: Record<string, unknown>): string {
  return stringField(item.call_id) ?? stringField(item.id) ?? '';
}

function isResponseToolTranscriptBridgeItem(item: Record<string, unknown>): boolean {
  const type = stringField(item.type);
  if (
    type === 'reasoning' ||
    type === 'assistant_reasoning' ||
    type === 'approval' ||
    type === 'user_input' ||
    type === 'error'
  ) {
    return true;
  }
  return responseMessageRole(item) === 'assistant';
}

function responseMessageRole(item: Record<string, unknown>): string {
  const role = stringField(item.role);
  if (role) return role;
  if (item.type === 'message' && isRecord(item.message)) {
    return stringField(item.message.role) ?? '';
  }
  return '';
}

function rememberFunctionCalls(cache: ToolCallCache, outputItems: JsonObject[]): void {
  for (const item of outputItems) {
    if (item.type !== 'function_call') continue;
    const callId = stringField(item.call_id) ?? stringField(item.id);
    if (!callId) continue;
    cache.delete(callId);
    cache.set(callId, { ...item });
  }
  while (cache.size > MAX_TOOL_CALL_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

function chatCompletionResult(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: Record<string, string> = {},
): { outputText: string; outputItems: JsonObject[]; usage: ResponseUsage } {
  const response = chatCompletionToResponse(payload, request, toolNameAliases);
  const outputItems = Array.isArray(response.output)
    ? response.output.filter(isRecord) as JsonObject[]
    : [];
  const outputText = typeof response.output_text === 'string'
    ? response.output_text
    : chatCompletionText(payload);
  return {
    outputText,
    outputItems,
    usage: responseUsageFromChatCompletion(payload),
  };
}

function emptyResponseUsage(): ResponseUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function addUsage(target: ResponseUsage, value: ResponseUsage): void {
  target.input_tokens += value.input_tokens;
  target.output_tokens += value.output_tokens;
  target.total_tokens += value.total_tokens;
  target.input_tokens_details.cached_tokens += value.input_tokens_details.cached_tokens;
  target.output_tokens_details.reasoning_tokens += value.output_tokens_details.reasoning_tokens;
  target.prompt_tokens += value.prompt_tokens;
  target.completion_tokens += value.completion_tokens;
  target.cached_input_tokens += value.cached_input_tokens;
  target.reasoning_output_tokens += value.reasoning_output_tokens;
}

function responseUsageFromChatCompletion(payload: unknown): ResponseUsage {
  const completion = isRecord(payload) ? payload : {};
  const usage = isRecord(completion.usage) ? completion.usage : {};
  const promptDetails = firstRecord(
    usage.input_tokens_details,
    usage.prompt_tokens_details,
  );
  const completionDetails = firstRecord(
    usage.output_tokens_details,
    usage.completion_tokens_details,
  );
  const inputTokens = usageInteger(usage, 'input_tokens', 'prompt_tokens');
  const outputTokens = usageInteger(usage, 'output_tokens', 'completion_tokens');
  const cacheMissTokens = usageInteger(usage, 'cache_miss_tokens', 'prompt_cache_miss_tokens', 'cache_write_input_tokens');
  const explicitCachedTokens = usageInteger(
    usage,
    'cached_input_tokens',
    'prompt_cache_hit_tokens',
    'cache_read_input_tokens',
  ) || usageInteger(promptDetails, 'cached_tokens');
  const cachedTokens = explicitCachedTokens || (cacheMissTokens > 0 ? Math.max(0, inputTokens - cacheMissTokens) : 0);
  const reasoningTokens = usageInteger(usage, 'reasoning_output_tokens')
    || usageInteger(completionDetails, 'reasoning_tokens');
  const reportedTotal = usageInteger(usage, 'total_tokens');
  const totalTokens = reportedTotal || inputTokens + outputTokens + reasoningTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    cached_input_tokens: cachedTokens,
    reasoning_output_tokens: reasoningTokens,
  };
}

function usageInteger(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return 0;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function chatCompletionStopReason(payload: unknown): ProviderCallRecord['stopReason'] {
  const completion = isRecord(payload) ? payload : {};
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const finishReason = stringField(firstChoice.finish_reason) ?? stringField(firstChoice.finishReason);
  if (finishReason === 'stop' || finishReason === 'tool_calls' || finishReason === 'length') return finishReason;
  return finishReason ? 'unknown' : 'unknown';
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
    if (
      parsed.type === 'need_more_visual_info'
      && typeof parsed.target === 'string'
      && typeof parsed.question === 'string'
    ) {
      return {
        type: 'need_more_visual_info',
        target: parsed.target,
        question: parsed.question,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeTextControl(
  control: Extract<TextControl, { type: 'need_more_visual_info' }>,
  profile: ModelRouterProfile,
  publicModelAlias: string,
  sensitiveValues: string[],
  allowedLocalPathPrefixes: string[] = [],
): Extract<TextControl, { type: 'need_more_visual_info' }> {
  return {
    type: 'need_more_visual_info',
    target: control.target,
    question: publicProviderOutputText(control.question, profile, publicModelAlias, sensitiveValues, allowedLocalPathPrefixes),
    reason: control.reason ? publicProviderOutputText(control.reason, profile, publicModelAlias, sensitiveValues, allowedLocalPathPrefixes) : undefined,
  };
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
    usage: result.usage,
    metadata: {
      traceRef: result.traceRef,
    },
  };
}

function responseOutputItems(result: RoutedResponse, messageItemId?: string): JsonObject[] {
  if (messageItemId && result.outputItems.length) {
    return result.outputItems.map((item) => (
      item.type === 'message' ? { ...item, id: messageItemId } : item
    ));
  }
  if (result.outputItems.length) return result.outputItems;
  return result.outputText ? [messageOutputItem(result.outputText, messageItemId)] : [];
}

function chatCompletionsToResponsesRequest(body: Record<string, unknown>, publicModelAlias: string): ResponsesRequest {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const instructions = messages
    .filter((message) => {
      const role = stringField(message.role);
      return role === 'system' || role === 'developer';
    })
    .map((message) => chatMessageContentText(message.content))
    .filter(Boolean)
    .join('\n\n');
  const inputMessages = messages
    .filter((message) => {
      const role = stringField(message.role);
      return role !== 'system' && role !== 'developer';
    })
    .map((message) => {
      const role = stringField(message.role) ?? 'user';
      const content = jsonValueField(message.content) ?? chatMessageContentText(message.content) ?? '';
      return compactObject({
        role,
        content,
      });
    });
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  return {
    model: stringField(body.model) || publicModelAlias,
    input: inputMessages.length ? inputMessages : chatMessageContentText(body.prompt) ?? '',
    ...(instructions ? { instructions } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
    ...(body.reasoning_effort !== undefined ? { reasoning_effort: body.reasoning_effort } : {}),
  };
}

function chatMessageContentText(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!isRecord(part)) return '';
        return stringField(part.text) ?? stringField(part.content) ?? '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (!isRecord(content)) return '';
  return stringField(content.text) ?? stringField(content.content) ?? stringField(content.input) ?? '';
}

function responseToChatCompletion(response: JsonObject, request: Record<string, unknown>): JsonObject {
  const output = Array.isArray(response.output) ? response.output.filter(isRecord) as JsonObject[] : [];
  const functionCalls = output.filter((item) => item.type === 'function_call');
  const outputText = stringField(response.output_text) ?? responseOutputText(output);
  const message = compactObject({
    role: 'assistant',
    content: functionCalls.length && !outputText ? null : outputText,
    tool_calls: functionCalls.length ? functionCalls.map(responseFunctionCallToChatToolCall) : undefined,
  });
  return {
    id: stringField(response.id) || makeId('chatcmpl'),
    object: 'chat.completion',
    created: numberField(response.created_at) ?? Math.floor(Date.now() / 1000),
    model: stringField(request.model) || stringField(response.model) || '',
    choices: [{
      index: 0,
      message,
      finish_reason: functionCalls.length ? 'tool_calls' : 'stop',
    }],
    usage: chatCompletionUsageFromResponse(response.usage),
  };
}

function responseOutputText(output: JsonObject[]): string {
  return output
    .flatMap((item) => {
      if (item.type !== 'message') return [];
      const content = Array.isArray(item.content) ? item.content : [];
      return content.map((part) => {
        if (!isRecord(part)) return '';
        return stringField(part.text) ?? stringField(part.content) ?? '';
      });
    })
    .filter(Boolean)
    .join('\n');
}

function responseFunctionCallToChatToolCall(item: JsonObject): JsonObject {
  return {
    id: stringField(item.call_id) || stringField(item.id) || makeId('call'),
    type: 'function',
    function: {
      name: stringField(item.name) || '',
      arguments: stringField(item.arguments) || '',
    },
  };
}

function chatCompletionUsageFromResponse(usage: unknown): JsonObject {
  const record = isRecord(usage) ? usage : {};
  const promptTokens = numberField(record.prompt_tokens) ?? numberField(record.input_tokens) ?? 0;
  const completionTokens = numberField(record.completion_tokens) ?? numberField(record.output_tokens) ?? 0;
  const totalTokens = numberField(record.total_tokens) ?? promptTokens + completionTokens;
  const inputDetails = isRecord(record.input_tokens_details) ? record.input_tokens_details : {};
  const outputDetails = isRecord(record.output_tokens_details) ? record.output_tokens_details : {};
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: numberField(record.cached_input_tokens) ?? numberField(inputDetails.cached_tokens) ?? 0,
    },
    completion_tokens_details: {
      reasoning_tokens: numberField(record.reasoning_output_tokens) ?? numberField(outputDetails.reasoning_tokens) ?? 0,
    },
  };
}

function sendResponseStream(response: ServerResponse, result: RoutedResponse) {
  beginResponseStream(response, result.responseId, result.model);
  writeResponseStreamResult(response, result);
}

function sendDeferredResponseStream(
  response: ServerResponse,
  responseId: string,
  model: string,
  resultPromise: Promise<RoutedResponse>,
) {
  beginResponseStream(response, responseId, model);
  void resultPromise.then((result) => {
    writeResponseStreamResult(response, result);
  }).catch((error) => {
    const routerError = normalizeRouterError(error);
    writeSse(response, 'response.failed', {
      type: 'response.failed',
      response: {
        id: responseId,
        model,
        status: 'failed',
        error: {
          code: routerError.code,
          message: routerError.message,
        },
      },
    });
    response.write('data: [DONE]\n\n');
    response.end();
  });
}

function sendDeferredAnthropicMessageStream(
  response: ServerResponse,
  messageId: string,
  model: string,
  request: Pick<AnthropicMessagesRequest, 'model'>,
  resultPromise: Promise<RoutedResponse>,
) {
  beginAnthropicMessageStream(response, messageId, model);
  void resultPromise.then((result) => {
    writeAnthropicMessageStreamResult(response, messageId, responseToAnthropicMessage(responseObject(result), request));
  }).catch((error) => {
    const routerError = normalizeRouterError(error);
    writeSse(response, 'error', {
      type: 'error',
      error: {
        type: routerError.code,
        message: routerError.message,
      },
    });
    response.end();
  });
}

function beginResponseStream(response: ServerResponse, responseId: string, model: string) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(response, 'response.created', {
    type: 'response.created',
    response: { id: responseId, model, status: 'in_progress' },
  });
}

function beginAnthropicMessageStream(response: ServerResponse, messageId: string, model: string) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(response, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  });
}

function writeAnthropicMessageStreamResult(
  response: ServerResponse,
  messageId: string,
  message: JsonObject,
) {
  const content = Array.isArray(message.content) ? message.content : [];
  const stopReason = typeof message.stop_reason === 'string' ? message.stop_reason : 'end_turn';
  content.forEach((block, index) => {
    const contentBlock = isRecord(block) ? block : { type: 'text', text: '' };
    const blockType = typeof contentBlock.type === 'string' ? contentBlock.type : 'text';
    writeSse(response, 'content_block_start', {
      type: 'content_block_start',
      index,
      content_block: anthropicStreamStartBlock(contentBlock),
    });
    if (blockType === 'text') {
      writeSse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'text_delta',
          text: typeof contentBlock.text === 'string' ? contentBlock.text : '',
        },
      });
    }
    if (blockType === 'tool_use') {
      writeSse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(isRecord(contentBlock.input) ? contentBlock.input : {}),
        },
      });
    }
    writeSse(response, 'content_block_stop', {
      type: 'content_block_stop',
      index,
    });
  });
  writeSse(response, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: isRecord(message.usage) ? message.usage : { output_tokens: 0 },
  });
  writeSse(response, 'message_stop', {
    type: 'message_stop',
    message: {
      ...message,
      id: messageId,
    },
  });
  response.end();
}

function anthropicStreamStartBlock(contentBlock: JsonObject): JsonObject {
  if (contentBlock.type === 'text') {
    return { type: 'text', text: '' };
  }
  if (contentBlock.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: typeof contentBlock.id === 'string' ? contentBlock.id : makeId('toolu'),
      name: typeof contentBlock.name === 'string' ? contentBlock.name : '',
      input: {},
    };
  }
  return contentBlock;
}

function writeResponseStreamResult(response: ServerResponse, result: RoutedResponse) {
  let outputIndex = 0;
  const contentIndex = 0;
  const messageItemId = makeId('msg');
  const outputItems = responseOutputItems(result, messageItemId);
  const reasoningItems = outputItems.filter((item) => item.type === 'reasoning');
  const nonReasoningItems = outputItems.filter((item) => item.type !== 'reasoning');

  reasoningItems.forEach((item) => {
    writeSse(response, 'response.output_item.added', {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item,
    });
    writeSse(response, 'response.output_item.done', {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item,
    });
    outputIndex += 1;
  });

  const completedMessage = nonReasoningItems.length === 1 && nonReasoningItems[0]?.type === 'message'
    ? nonReasoningItems[0]
    : undefined;
  if (!completedMessage) {
    nonReasoningItems.forEach((item, index) => {
      writeSse(response, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: outputIndex + index,
        item,
      });
      writeSse(response, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex + index,
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
  workspaceRoot: string;
  traceDataRoot?: string;
};

export function resolveModelRouterTraceDataRoot(
  env: Record<string, string | undefined> = process.env,
  explicitRoot?: string,
): string {
  const configured = explicitRoot?.trim() || env.SCIFORGE_MODEL_ROUTER_TRACE_DATA_ROOT?.trim();
  if (configured) return resolve(configured);
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) return resolve(xdgStateHome, 'sciforge', 'model-router');
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) return resolve(localAppData, 'SciForge', 'ModelRouter');
  const home = homedir();
  return resolve(home || tmpdir(), '.local', 'state', 'sciforge', 'model-router');
}

function createTraceContext(
  workspaceRoot: string,
  traceDataRoot: string,
  traceRoot: string,
  responseId: string,
): TraceContext {
  const day = new Date().toISOString().slice(0, 10);
  const traceId = responseId;
  const workspaceRootAbsolute = resolve(workspaceRoot);
  const configuredTraceRoot = traceRoot.trim() || DEFAULT_MODEL_ROUTER_TRACE_ROOT;
  const traceRootIsAbsolute = isTraceRootAbsolute(configuredTraceRoot);
  let traceDataRootAbsolute: string | undefined;
  let traceRootAbsolute: string;

  if (traceRootIsAbsolute) {
    traceRootAbsolute = resolve(configuredTraceRoot);
  } else {
    traceDataRootAbsolute = resolve(traceDataRoot);
    assertPathOutsideWorkspaceLexically(traceDataRootAbsolute, workspaceRootAbsolute);
    traceRootAbsolute = resolve(traceDataRootAbsolute, configuredTraceRoot);
    if (!isPathWithinOrEqual(traceRootAbsolute, traceDataRootAbsolute)) {
      throw routerError(400, 'invalid_trace_root', 'Relative Model Router trace roots must stay within the trace data root.');
    }
  }

  assertPathOutsideWorkspaceLexically(traceRootAbsolute, workspaceRootAbsolute);

  const absoluteDir = resolve(traceRootAbsolute, day, responseId);
  assertPathOutsideWorkspaceLexically(absoluteDir, workspaceRootAbsolute);
  const relativeDir = traceRootIsAbsolute
    ? safeTraceRef(absoluteDir)
    : toTraceRef(relative(traceDataRootAbsolute ?? resolve(traceDataRoot), absoluteDir));
  return {
    traceId,
    relativeDir,
    absoluteDir,
    workspaceRoot: workspaceRootAbsolute,
    traceDataRoot: traceDataRootAbsolute,
  };
}

async function writeTraceJson(trace: TraceContext, fileName: string, payload: JsonObject) {
  const workspaceRootReal = await realpathOrResolved(trace.workspaceRoot);
  if (trace.traceDataRoot) {
    await assertPathOutsideWorkspace(trace.traceDataRoot, trace.workspaceRoot, workspaceRootReal);
    await assertNearestExistingParentOutsideWorkspace(trace.traceDataRoot, trace.workspaceRoot, workspaceRootReal);
  }
  await assertNearestExistingParentOutsideWorkspace(trace.absoluteDir, trace.workspaceRoot, workspaceRootReal);
  await mkdir(trace.absoluteDir, { recursive: true });
  await assertPreparedTraceDirectory(trace, workspaceRootReal);
  await writeFileNoFollow(join(trace.absoluteDir, fileName), `${JSON.stringify(payload, null, 2)}\n`);
}

function isTraceRootAbsolute(traceRoot: string): boolean {
  return isAbsolute(traceRoot) || /^[A-Za-z]:[\\/]/.test(traceRoot) || /^\\\\/.test(traceRoot);
}

async function assertPreparedTraceDirectory(trace: TraceContext, workspaceRootReal: string): Promise<void> {
  const realDir = await realpath(trace.absoluteDir);
  await assertPathOutsideWorkspace(realDir, trace.workspaceRoot, workspaceRootReal);
  if (trace.traceDataRoot) {
    const traceDataRootReal = await realpath(trace.traceDataRoot);
    await assertPathOutsideWorkspace(traceDataRootReal, trace.workspaceRoot, workspaceRootReal);
    if (!isPathWithinOrEqual(realDir, traceDataRootReal)) {
      throw routerError(500, 'invalid_trace_root', 'Model Router trace root escaped the trace data root.');
    }
  }
}

function assertPathOutsideWorkspaceLexically(candidate: string, workspaceRoot: string): void {
  if (isPathWithinOrEqual(candidate, workspaceRoot)) {
    throw routerError(500, 'invalid_trace_root', 'Model Router trace roots must not be inside the workspace.');
  }
}

async function assertNearestExistingParentOutsideWorkspace(
  candidate: string,
  workspaceRoot: string,
  workspaceRootReal: string,
): Promise<void> {
  let current = resolve(candidate);
  while (true) {
    try {
      const realParent = await realpath(current);
      await assertPathOutsideWorkspace(realParent, workspaceRoot, workspaceRootReal);
      return;
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

async function assertPathOutsideWorkspace(
  candidate: string,
  workspaceRoot: string,
  workspaceRootReal: string,
): Promise<void> {
  const resolved = resolve(candidate);
  if (isPathWithinOrEqual(resolved, workspaceRoot) || isPathWithinOrEqual(resolved, workspaceRootReal)) {
    throw routerError(500, 'invalid_trace_root', 'Model Router trace roots must not be inside the workspace.');
  }
  const real = await realpathIfExists(resolved);
  if (real && (isPathWithinOrEqual(real, workspaceRoot) || isPathWithinOrEqual(real, workspaceRootReal))) {
    throw routerError(500, 'invalid_trace_root', 'Model Router trace roots must not be inside the workspace.');
  }
}

async function realpathOrResolved(path: string): Promise<string> {
  return await realpathIfExists(path) ?? resolve(path);
}

async function realpathIfExists(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function writeFileNoFollow(path: string, data: string): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags, 0o600);
  try {
    await handle.writeFile(data, 'utf8');
  } finally {
    await handle.close();
  }
}

function isPathWithinOrEqual(candidate: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function toTraceRef(path: string): string {
  return path.split(sep).join('/');
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
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
  requestAuditMetadata?: RequestAuditMetadata;
  status: 'completed' | 'failed';
  outputText?: string;
  errorSummary?: string;
}) {
  const translatorsTrace: JsonObject = options.profile.translators.vision
    ? { vision: providerTrace('translators.vision', options.profile.translators.vision, options.publicModelAlias) }
    : {};
  await writeTraceJson(options.trace, 'trace.json', compactObject({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: options.trace.traceId,
    responseId: options.responseId,
    profileId: options.profileId,
    workspaceId: hashForTrace(options.workspaceRoot),
    publicModelAlias: options.publicModelAlias,
    textReasoner: providerTrace('textReasoner', options.profile.textReasoner, options.publicModelAlias),
    translators: translatorsTrace,
    modalityRefs: options.modalities.map(publicModalityRef),
    requestAuditMetadata: options.requestAuditMetadata,
    calls: options.calls,
    degraded: options.degraded,
  }));
  await writeTraceJson(options.trace, 'final-routing-summary.json', compactObject({
    schemaVersion: 'sciforge.model-router.final-routing-summary.v1',
    responseId: options.responseId,
    profileId: options.profileId,
    status: options.status,
    outputTextSha256: options.outputText ? sha256Hex(options.outputText) : undefined,
    errorSummary: options.errorSummary,
    degraded: options.degraded,
    requestAuditMetadata: options.requestAuditMetadata,
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

function providerCallTraceFields(
  provider: ModelRouterProviderConfig,
  body: Record<string, unknown>,
): Pick<ProviderCallRecord, 'providerAliasSha256' | 'modelAliasSha256' | 'wireRequest'> {
  const modelAliasSha256 = hashForTrace(stringField(body.model) || provider.model || '');
  return {
    providerAliasSha256: hashForTrace(provider.provider || ''),
    modelAliasSha256,
    wireRequest: {
      urlSha256: hashForTrace(`${trimTrailingSlash(provider.baseUrl)}/chat/completions`),
      endpointRoute: 'chat.completions',
      bodyShape: {
        modelAliasSha256,
        messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
        hasImageParts: hasImageParts(body.messages),
        textCharCount: textCharCount(body.messages),
        maxTokensSet: body.max_tokens !== undefined || body.max_completion_tokens !== undefined,
        temperatureSet: body.temperature !== undefined,
      },
    },
  };
}

function hasImageParts(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasImageParts);
  if (!isRecord(value)) return false;
  const type = stringField(value.type)?.toLowerCase() ?? '';
  if (type.includes('image')) return true;
  if (value.image_url !== undefined || value.imageUrl !== undefined) return true;
  return Object.values(value).some(hasImageParts);
}

function textCharCount(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + textCharCount(item), 0);
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>((sum, item) => sum + textCharCount(item), 0);
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
    ...providerCallTraceFields(provider, {}),
    wireApi: 'chat.completions',
    latencyMs: 0,
    stopReason: 'error',
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
  const body = await readIncomingMessageBody(request, MAX_MODEL_ROUTER_REQUEST_BODY_BYTES);
  if (!body) return {};
  return JSON.parse(body) as unknown;
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
    'access-control-allow-headers': 'content-type,authorization,x-api-key,anthropic-version,x-sciforge-model-router-profile',
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
  if (isScientificModalityPath(path)) return 'document';
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
  if (/^[A-Za-z0-9._@/-]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic|svg|mp3|wav|m4a|flac|ogg|mp4|mov|webm|m4v|avi|csv|tsv|xlsx?|ods|pdf|docx?|pptx?|txt|md|markdown|fasta|fa|faa|fna|ffn|frn|fastq|fq|smi|smiles|mol|mol2|sdf|mgf|pdb|cif|gb|gbk|gff|gff3|gtf|vcf|bed|nwk|seq)$/i.test(path)) return true;
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
  allowedLocalPathPrefixes: string[] = [],
) {
  return redactTraceText(value, {
    sensitiveValues: [...profileTraceRedactionValues(profile, publicModelAlias), ...sensitiveValues],
    allowedLocalPathPrefixes,
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

function mentionsImageNotSent(value: string) {
  return /(?:image|visual|picture|screenshot).{0,80}(?:not sent|was not sent|wasn't sent)|(?:not sent|was not sent|wasn't sent).{0,80}(?:image|visual|picture|screenshot)|(?:图片|图像|截图).{0,40}(?:未发送|没有发送)|(?:未发送|没有发送).{0,40}(?:图片|图像|截图)/i.test(value);
}

function imageNotSentPrefix(modalities: ModalityRef[]) {
  return modalities.length > 0 && modalities.every((item) => item.kind === 'vision.image')
    ? 'I could not inspect the image because it was not sent to the active text-only model.'
    : 'I could not inspect the referenced modality because the image payload was not sent to the active text-only model.';
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

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function jsonValueField(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.map(jsonValueField).filter((item): item is JsonValue => item !== undefined);
    return items;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, jsonValueField(entry)] as const)
        .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined),
    );
  }
  return undefined;
}

function parseJsonValue(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
