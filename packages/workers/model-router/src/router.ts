import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  anthropicMessagesToResponses,
  chatFinishReasonFromResponse,
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
import { readIncomingMessageBody, readIncomingMessageBodyBytes } from './http-body';
import {
  type ModelRouterFullTraceRecorder,
  type ModelRouterTraceSession,
} from './full-trace-recorder';
import { redactTraceText, redactUserVisibleText } from './trace-redaction';
import { normalizeLoopbackHost } from './network-policy';
import {
  preferredProviderProtocol,
  providerCompatibilityConfigurationIssue,
  type ProviderCompatibilityConfig,
} from './provider-compat';
import {
  UpstreamProtocolNegotiator,
  UpstreamRequestError,
  captureUpstreamResponse,
  type UpstreamAttempt,
  type UpstreamWireProtocol,
} from './upstream-drivers';

export interface ModelRouterProviderConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  compatibility?: ProviderCompatibilityConfig;
  maxSupplementRounds?: number;
}

export interface ModelRouterScientificTranslatorConfig {
  baseUrl: string;
  tokenEnv: string;
  model: string;
  timeoutMs?: number;
}

export const MODEL_ROUTER_VISION_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export const MODEL_ROUTER_MAX_VISUAL_INPUT_BYTES = 20 * 1024 * 1024;
export const MODEL_ROUTER_MAX_REQUEST_BYTES = 40 * 1024 * 1024;
const MODEL_ROUTER_EVIDENCE_POLICY_HEADER = 'x-sciforge-model-router-evidence-policy';

export interface ModelRouterProfileCapabilityRegistration {
  vision?: {
    mimeTypes?: string[];
    maxInputBytes?: number;
  };
  images?: {
    generation?: boolean;
    editing?: boolean;
    referenceImages?: boolean;
    masks?: boolean;
    sizeSelection?: boolean;
    sizes?: string[];
  };
}

export interface ModelRouterProfile {
  textReasoner: ModelRouterProviderConfig;
  imageGenerator?: ModelRouterProviderConfig;
  translators: {
    vision?: ModelRouterProviderConfig;
    scientific?: ModelRouterScientificTranslatorConfig;
  };
  capabilities?: ModelRouterProfileCapabilityRegistration;
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
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  fullTraceRecorder?: ModelRouterFullTraceRecorder;
}

export interface StartedModelRouterServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

export type ModelRouterRoleReadinessState =
  | 'ready'
  | 'not_configured'
  | 'invalid_configuration'
  | 'missing_credentials';

export type ModelRouterRoleReadiness = {
  configured: boolean;
  ready: boolean;
  state: ModelRouterRoleReadinessState;
};

export type ModelRouterPublicCapabilityContract = {
  schemaVersion: 'sciforge.model-router.capabilities.v1';
  publicModelAlias: string;
  profile: string;
  roles: {
    textReasoner: ModelRouterRoleReadiness;
    imageGenerator: ModelRouterRoleReadiness;
    visionTranslator: ModelRouterRoleReadiness;
    scientificTranslator: ModelRouterRoleReadiness;
  };
  vision: {
    available: boolean;
    input: {
      mimeTypes: string[];
      maxInputBytes: number;
      maxRequestBytes: number;
      sources: Array<'inline' | 'url' | 'workspace_ref'>;
    };
  };
  images: {
    available: boolean;
    maxRequestBytes: number;
    features: {
      generation: boolean;
      editing: boolean;
      referenceImages: boolean;
      masks: boolean;
      sizeSelection: boolean;
    };
    sizes: {
      mode: 'enumerated' | 'provider-defined' | 'unsupported';
      values: string[];
    };
  };
};

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
  modelAliasSha256: string;
  wireApi: UpstreamWireProtocol;
  wireRequest: {
    urlSha256: string;
    endpointRoute: UpstreamWireProtocol;
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
  role?: ModelRouterUpstreamDiagnostic['role'];
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
  usage: ResponseUsage;
  status?: string;
  incompleteDetails?: JsonObject;
  terminalDetails?: JsonObject;
};

type ResponseContinuationBlock = readonly JsonObject[];
type ResponseContinuationCache = Map<string, ResponseContinuationBlock>;

type TextControl =
  | { type: 'final_answer'; content: string }
  | { type: 'need_more_visual_info'; target: string; question: string; reason?: string };

const MAX_TRANSIENT_PROVIDER_IMAGE_BYTES = MODEL_ROUTER_MAX_VISUAL_INPUT_BYTES;
const MAX_MODEL_ROUTER_REQUEST_BODY_BYTES = MODEL_ROUTER_MAX_REQUEST_BYTES;
const MAX_RESPONSE_CONTINUATION_CACHE_ENTRIES = 512;
const MAX_TEXT_MODALITY_BYTES = 256 * 1024;
const RECENT_PROVIDER_AUTH_ERROR_TTL_MS = 30 * 60 * 1000;
const modelRouterInFlightRequests = new WeakMap<Server, Set<Promise<void>>>();

// Protected scientific files can carry sequence, chemistry, structure, variant, or assay data and
// must never be inlined raw into the text reasoner. This set is intentionally broader than the file
// formats accepted by the optional native-to-text experts below.
const PROTECTED_SCIENTIFIC_FILE_EXTENSIONS =
  /\.(?:fasta|fa|faa|fna|ffn|frn|fastq|fq|smi|smiles|mol|mol2|sdf|mgf|pdb|cif|mmcif|gb|gbk|gff|gff3|gtf|vcf|bed|nwk|seq)(?:$|[?#])/i;

type ScientificTranslatorModality = 'protein' | 'protein_structure' | 'molecule';

// Only formats with a deployed native-to-text expert may cross the sci-modality service boundary.
// Ambiguous FASTA extensions require conservative local content confirmation below. Nucleotide,
// variant, annotation, interval, tree, and spectrum formats remain protected but are rejected until
// a matching expert is explicitly added.
const TRANSLATABLE_SCIENTIFIC_FILE_MODALITIES: ReadonlyArray<{
  extensions: RegExp;
  modality: ScientificTranslatorModality;
}> = [
  { extensions: /\.(?:fasta|fa|faa)(?:$|[?#])/i, modality: 'protein' },
  { extensions: /\.(?:pdb|cif|mmcif)(?:$|[?#])/i, modality: 'protein_structure' },
  { extensions: /\.(?:smi|smiles)(?:$|[?#])/i, modality: 'molecule' },
];

function isProtectedScientificFilePath(path: string): boolean {
  return PROTECTED_SCIENTIFIC_FILE_EXTENSIONS.test(path);
}

function scientificTranslatorModalityForPath(path: string): ScientificTranslatorModality | undefined {
  return TRANSLATABLE_SCIENTIFIC_FILE_MODALITIES.find(({ extensions }) => extensions.test(path))?.modality;
}

function isAmbiguousFastaExtension(path: string): boolean {
  return /\.(?:fasta|fa)(?:$|[?#])/i.test(path);
}

export function createModelRouterServer(options: ModelRouterServerOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? processEnvSnapshot();
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const visionTranslationCache = new Map<string, VisionTranslationCacheEntry>();
  // Caches scientific-file expert translations by resolved modality + file-content sha. An agentic
  // turn is several router requests; the upload rides along on each, so the expert should run once.
  const scientificTranslationCache = new Map<string, ScientificEvidence>();
  const responseContinuationCache: ResponseContinuationCache = new Map();
  const upstreamNegotiator = new UpstreamProtocolNegotiator();
  let recentRouterError: RecentProviderError | null = null;
  const backgroundControllers = new Set<AbortController>();
  let activeInteractiveRequests = 0;
  const routeWithPriority = <T>(
    body: unknown,
    clientSignal: AbortSignal,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const background = isDagBackgroundRequest(body);
    if (background && activeInteractiveRequests > 0) {
      return Promise.reject(routerError(
        503,
        'background_preempted',
        'Background DAG work yielded to an interactive request.',
      ));
    }
    if (!background) {
      activeInteractiveRequests += 1;
      for (const controller of backgroundControllers) controller.abort();
      return task(clientSignal).finally(() => { activeInteractiveRequests = Math.max(0, activeInteractiveRequests - 1); });
    }
    const controller = new AbortController();
    backgroundControllers.add(controller);
    return task(AbortSignal.any([clientSignal, controller.signal]))
      .finally(() => backgroundControllers.delete(controller));
  };
  const recordProviderError = (error: Omit<RecentProviderError, 'at'>) => {
    recentRouterError = {
      ...error,
      at: Date.now(),
    };
  };

  const inFlightRequests = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const operation = (async (): Promise<void> => {
    const clientController = new AbortController();
    const abortClientRequest = () => {
      if (!clientController.signal.aborted) {
        clientController.abort(new DOMException('Client connection closed before the model request completed.', 'AbortError'));
      }
    };
    request.once('aborted', abortClientRequest);
    response.once('close', () => {
      if (!response.writableFinished) abortClientRequest();
    });
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const fullTraceSession = isModelTraceRoute(request.method, url.pathname)
      ? options.fullTraceRecorder?.start({
          method: request.method ?? 'POST',
          path: `${url.pathname}${url.search}`,
          headers: request.headers,
        })
      : undefined;
    fullTraceSession?.attach(response);
    try {
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, compactObject({
          ok: true,
          service: 'sciforge.model-router',
          instanceId: stringField(env.SCIFORGE_MODEL_ROUTER_INSTANCE_ID),
          checkedAt: new Date().toISOString(),
        }));
      }
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const defaultTextReasoner = options.config.profiles[options.config.defaultProfile]?.textReasoner;
        const protocol = defaultTextReasoner
          ? upstreamNegotiator.cachedProtocol(
            defaultTextReasoner.baseUrl,
            defaultTextReasoner.model,
            defaultTextReasoner.compatibility,
          ) ?? null
          : null;
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
          protocol,
          traceCapture: options.fullTraceRecorder ? 'ready' : 'disabled',
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
          input_modalities: ['text', 'image'],
          supports_image_detail_original: false,
        };
        return sendJson(response, 200, {
          object: 'list',
          data: [publicModel],
          models: [publicModel],
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        assertRuntimeAuthorized(request, options.config, env);
        const profileId = requestedProfileId({}, request, options.config);
        return sendJson(
          response,
          200,
          createModelRouterPublicCapabilities(options.config, env, profileId) as unknown as JsonObject,
        );
      }
      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request, fullTraceSession);
        if (isRecord(body) && body.stream === true) {
          const responseId = makeId('resp');
          return sendDeferredResponseStream(
            response,
            responseId,
            options.config.publicModelAlias ?? 'sciforge-model-router',
            routeWithPriority(body, clientController.signal, (providerSignal) => routeResponsesRequest(body, {
              config: options.config,
              env,
              fetchImpl,
              workspaceRoot,
              request,
              visionTranslationCache,
              scientificTranslationCache,
              responseContinuationCache,
              responseId,
              providerSignal,
              recordProviderError,
              upstreamNegotiator,
              preferredProtocol: preferredResponsesProtocol(options.config, body, request),
              traceSession: fullTraceSession,
            })),
          );
        }
        const result = await routeWithPriority(body, clientController.signal, (providerSignal) => routeResponsesRequest(body, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          responseContinuationCache,
          providerSignal,
          recordProviderError,
          upstreamNegotiator,
          preferredProtocol: preferredResponsesProtocol(options.config, body, request),
          traceSession: fullTraceSession,
        }));
        return sendJson(response, 200, responseObject(result));
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request, fullTraceSession);
        if (!isRecord(body)) {
          throw routerError(400, 'invalid_request', 'Chat completions request body must be a JSON object.');
        }
        const publicModelAlias = options.config.publicModelAlias ?? 'sciforge-model-router';
        const responseRequest = chatCompletionsToResponsesRequest(body, publicModelAlias);
        const resultPromise = routeWithPriority(responseRequest, clientController.signal, (providerSignal) => routeResponsesRequest(responseRequest, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          responseContinuationCache,
          providerSignal,
          recordProviderError,
          upstreamNegotiator,
          preferredProtocol: 'chat-completions',
          traceSession: fullTraceSession,
        }));
        if (body.stream === true) {
          return sendDeferredChatCompletionStream(response, body, resultPromise);
        }
        const result = await resultPromise;
        return sendJson(response, 200, responseToChatCompletion(responseObject(result), body));
      }
      if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request, fullTraceSession);
        const result = await routeWithPriority(body, clientController.signal, (providerSignal) => routeImageGenerationRequest(body, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
          providerSignal,
          traceSession: fullTraceSession,
        }));
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/v1/images/edits') {
        assertRuntimeAuthorized(request, options.config, env);
        const form = await readMultipartForm(request, fullTraceSession);
        const result = await routeWithPriority({}, clientController.signal, (providerSignal) => routeImageEditRequest(form, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
          providerSignal,
          traceSession: fullTraceSession,
        }));
        return sendJson(response, 200, result);
      }
      if (
        request.method === 'POST' &&
        (url.pathname === '/v1/messages' || url.pathname === '/api/cc/v1/messages')
      ) {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request, fullTraceSession) as AnthropicMessagesRequest;
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
            routeWithPriority(responseRequest, clientController.signal, (providerSignal) => routeResponsesRequest(responseRequest, {
              config: options.config,
              env,
              fetchImpl,
              workspaceRoot,
              request,
              visionTranslationCache,
              scientificTranslationCache,
              responseContinuationCache,
              responseId,
              providerSignal,
              recordProviderError,
              upstreamNegotiator,
              preferredProtocol: 'anthropic-messages',
              traceSession: fullTraceSession,
            })),
          );
        }
        const result = await routeWithPriority(responseRequest, clientController.signal, (providerSignal) => routeResponsesRequest(responseRequest, {
          config: options.config,
          env,
          fetchImpl,
          workspaceRoot,
          request,
          visionTranslationCache,
          scientificTranslationCache,
          responseContinuationCache,
          providerSignal,
          recordProviderError,
          upstreamNegotiator,
          preferredProtocol: 'anthropic-messages',
          traceSession: fullTraceSession,
        }));
        return sendJson(response, 200, responseToAnthropicMessage(responseObject(result), body));
      }
      if (
        request.method === 'POST' &&
        (url.pathname === '/v1/messages/count_tokens' || url.pathname === '/api/cc/v1/messages/count_tokens')
      ) {
        assertRuntimeAuthorized(request, options.config, env);
        const body = await readJson(request, fullTraceSession) as AnthropicMessagesRequest;
        return sendJson(response, 200, {
          input_tokens: estimateAnthropicMessagesInputTokens(body),
        });
      }
      return sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found' } });
    } catch (error) {
      const routerError = normalizeRouterError(error);
      fullTraceSession?.recordError(routerError);
      recordProviderError({
        code: routerError.code,
        status: routerError.status,
        ...(routerError.role ? { role: routerError.role } : {}),
      });
      options.log?.(`model-router ${routerError.code}: ${routerError.message}`);
      if (response.destroyed || response.writableEnded) return;
      return sendJson(response, routerError.status, {
        error: routerErrorResponseBody(routerError),
      });
    }
    })();
    inFlightRequests.add(operation);
    void operation.finally(() => inFlightRequests.delete(operation));
  });
  modelRouterInFlightRequests.set(server, inFlightRequests);
  return server;
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

function isDagBackgroundRequest(body: unknown): boolean {
  const request = isRecord(body) ? body : {};
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const source = (stringField(metadata.source) ?? '').toLowerCase();
  return source === 'evidence-dag' || source === 'project-dag' || source === 'dag-background';
}

function providerDiagnosticCategory(
  code: string,
  status?: number,
): ModelRouterUpstreamDiagnostic['category'] | null {
  if (/^(?:provider|upstream)_http_40[13]$/.test(code) || status === 401 || status === 403) return 'provider-auth';
  if (/^(?:provider_exception_(?:timeout|network|fetch_failed)|upstream_(?:timeout|network_error))/.test(code)) return 'provider-network';
  if (code === 'provider_invalid_json' || code === 'provider_error_payload' || code === 'upstream_invalid_response') return 'provider-bad-response';
  if (code.startsWith('provider_http_') || code.startsWith('provider_exception_') || code.startsWith('upstream_')) return 'provider-error';
  return null;
}

function recordProviderAuthFailure(
  context: { recordProviderError?: (error: Omit<RecentProviderError, 'at'>) => void },
  summary: string,
  role: ProviderCallRecord['role'],
): void {
  const match = /^(?:provider|upstream)_http_(40[13])$/.exec(summary);
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

export function createModelRouterPublicCapabilities(
  config: ModelRouterConfig,
  env: Record<string, string | undefined>,
  profileId = config.defaultProfile,
): ModelRouterPublicCapabilityContract {
  const profile = config.profiles[profileId];
  if (!profile) throw routerError(400, 'unknown_profile', 'Requested Model Router profile is not registered.');

  const roles = {
    textReasoner: providerRoleReadiness(profile.textReasoner, env),
    imageGenerator: providerRoleReadiness(profile.imageGenerator, env),
    visionTranslator: providerRoleReadiness(profile.translators.vision, env),
    scientificTranslator: scientificTranslatorRoleReadiness(profile.translators.scientific, env),
  };
  const visionRegistration = profile.capabilities?.vision;
  const registeredVisionMimeTypes = visionRegistration?.mimeTypes;
  const mimeTypes = profile.translators.vision
    ? sanitizeVisionMimeTypes(registeredVisionMimeTypes ?? [...MODEL_ROUTER_VISION_MIME_TYPES])
    : [];
  const maxInputBytes = profile.translators.vision
    ? boundedPublicInputBytes(visionRegistration?.maxInputBytes, MODEL_ROUTER_MAX_VISUAL_INPUT_BYTES)
    : 0;

  const imageRegistration = profile.capabilities?.images;
  const imageRoleRegistered = Boolean(profile.imageGenerator);
  const generation = imageRoleRegistered && registeredFeature(imageRegistration?.generation, true);
  const editing = imageRoleRegistered && registeredFeature(imageRegistration?.editing, true);
  const referenceImages = editing && registeredFeature(imageRegistration?.referenceImages, true);
  const masks = editing && registeredFeature(imageRegistration?.masks, true);
  const sizeSelection = (generation || editing) && registeredFeature(imageRegistration?.sizeSelection, true);
  const sizes = sizeSelection ? sanitizeImageSizes(imageRegistration?.sizes ?? []) : [];

  return {
    schemaVersion: 'sciforge.model-router.capabilities.v1',
    publicModelAlias: config.publicModelAlias ?? 'sciforge-model-router',
    profile: profileId,
    roles,
    vision: {
      available: roles.visionTranslator.ready,
      input: {
        mimeTypes,
        maxInputBytes,
        maxRequestBytes: MODEL_ROUTER_MAX_REQUEST_BYTES,
        sources: ['inline', 'url', 'workspace_ref'],
      },
    },
    images: {
      available: roles.imageGenerator.ready && (generation || editing),
      maxRequestBytes: MODEL_ROUTER_MAX_REQUEST_BYTES,
      features: {
        generation,
        editing,
        referenceImages,
        masks,
        sizeSelection,
      },
      sizes: {
        mode: !sizeSelection ? 'unsupported' : sizes.length > 0 ? 'enumerated' : 'provider-defined',
        values: sizes,
      },
    },
  };
}

function providerRoleReadiness(
  provider: ModelRouterProviderConfig | undefined,
  env: Record<string, string | undefined>,
): ModelRouterRoleReadiness {
  if (!provider) return { configured: false, ready: false, state: 'not_configured' };
  if (providerConfigurationIssue(provider)) {
    return { configured: true, ready: false, state: 'invalid_configuration' };
  }
  if (!stringField(env[provider.apiKeyEnv])) {
    return { configured: true, ready: false, state: 'missing_credentials' };
  }
  return { configured: true, ready: true, state: 'ready' };
}

function scientificTranslatorRoleReadiness(
  translator: ModelRouterScientificTranslatorConfig | undefined,
  env: Record<string, string | undefined>,
): ModelRouterRoleReadiness {
  if (!translator) return { configured: false, ready: false, state: 'not_configured' };
  if (scientificTranslatorConfigurationIssue(translator)) {
    return { configured: true, ready: false, state: 'invalid_configuration' };
  }
  if (!stringField(env[translator.tokenEnv])) {
    return { configured: true, ready: false, state: 'missing_credentials' };
  }
  return { configured: true, ready: true, state: 'ready' };
}

function registeredFeature(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeVisionMimeTypes(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(value)))]
    .slice(0, 32);
}

function sanitizeImageSizes(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === 'auto' || /^[1-9]\d{1,4}x[1-9]\d{1,4}$/.test(value)))]
    .slice(0, 32);
}

function boundedPublicInputBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), MODEL_ROUTER_MAX_VISUAL_INPUT_BYTES);
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
  const imageGenerator = profile.imageGenerator;
  if (imageGenerator) {
    if (!imageGenerator.baseUrl || !imageGenerator.model) {
      return {
        category: 'repo-bug',
        ok: false,
        retryable: false,
        releaseAcceptance: 'not-evaluated',
      };
    }
    if (!stringField(env[imageGenerator.apiKeyEnv])) {
      return {
        category: 'provider-auth',
        ok: false,
        retryable: false,
        httpStatus: 401,
        role: 'imageGenerator',
        releaseAcceptance: 'not-evaluated',
      };
    }
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
  const scientificTranslator = profile.translators.scientific;
  if (scientificTranslator) {
    if (!scientificTranslator.baseUrl || !scientificTranslator.tokenEnv || !scientificTranslator.model) {
      return {
        category: 'repo-bug',
        ok: false,
        retryable: false,
        releaseAcceptance: 'not-evaluated',
      };
    }
    if (!stringField(env[scientificTranslator.tokenEnv])) {
      return {
        category: 'provider-auth',
        ok: false,
        retryable: false,
        httpStatus: 401,
        role: 'scientificTranslator',
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
  const host = normalizeLoopbackHost(options.host ?? '127.0.0.1');
  const server = createModelRouterServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3892, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const displayHost = host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host;
  const url = `http://${displayHost}:${address.port}`;
  return {
    server,
    url,
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await Promise.allSettled([...modelRouterInFlightRequests.get(server) ?? []]);
      await options.fullTraceRecorder?.flush();
    },
  };
}

type ImageRouteContext = {
  config: ModelRouterConfig;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  workspaceRoot: string;
  request: IncomingMessage;
  providerSignal: AbortSignal;
  traceSession?: ModelRouterTraceSession;
};

type ResolvedImageRoute = {
  profileId: string;
  profile: ModelRouterProfile;
  provider: ModelRouterProviderConfig;
  secret: string;
};

async function routeImageGenerationRequest(body: unknown, context: ImageRouteContext): Promise<JsonObject> {
  if (!isRecord(body)) {
    throw routerError(400, 'invalid_request', 'Image generation request body must be a JSON object.');
  }
  const route = resolveImageRoute(body, context);
  assertImageRequestCapabilities(
    createModelRouterPublicCapabilities(context.config, context.env, route.profileId),
    'generation',
    { size: stringField(body.size) },
  );
  return routeImageProviderRequest({
    context,
    route,
    providerRequest: {
      protocol: 'images-generations',
      url: providerImageGenerationsUrl(route.provider.baseUrl),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${route.secret}`,
      },
      body: JSON.stringify({
        ...body,
        model: route.provider.model,
      }),
    },
  });
}

async function routeImageEditRequest(form: FormData, context: ImageRouteContext): Promise<JsonObject> {
  const model = requiredMultipartText(form, 'model');
  const prompt = requiredMultipartText(form, 'prompt');
  const images = requiredMultipartFiles(form, 'image');
  const mask = optionalMultipartFile(form, 'mask');
  const size = optionalMultipartText(form, 'size');
  const route = resolveImageRoute({ model }, context);
  assertImageRequestCapabilities(
    createModelRouterPublicCapabilities(context.config, context.env, route.profileId),
    'editing',
    {
      imageCount: images.length,
      hasMask: Boolean(mask),
      size,
    },
  );
  const providerForm = new FormData();
  providerForm.set('model', route.provider.model);
  providerForm.set('prompt', prompt);
  if (size) providerForm.set('size', size);
  copyOptionalMultipartText(form, providerForm, 'n');
  copyOptionalMultipartText(form, providerForm, 'quality');
  copyOptionalMultipartText(form, providerForm, 'input_fidelity');
  for (const image of images) appendMultipartFile(providerForm, 'image', image);
  if (mask) appendMultipartFile(providerForm, 'mask', mask);
  return routeImageProviderRequest({
    context,
    route,
    providerRequest: {
      protocol: 'images-edits',
      url: providerImageEditsUrl(route.provider.baseUrl),
      headers: { authorization: `Bearer ${route.secret}` },
      body: providerForm,
    },
  });
}

function assertImageRequestCapabilities(
  capabilities: ModelRouterPublicCapabilityContract,
  operation: 'generation' | 'editing',
  request: { imageCount?: number; hasMask?: boolean; size?: string },
): void {
  if (!capabilities.images.features[operation]) {
    throw routerError(422, 'image_capability_not_supported', `The active Model Router profile does not support image ${operation}.`, 'imageGenerator');
  }
  if ((request.imageCount ?? 0) > 1 && !capabilities.images.features.referenceImages) {
    throw routerError(422, 'image_references_not_supported', 'The active Model Router profile does not support multiple reference images.', 'imageGenerator');
  }
  if (request.hasMask && !capabilities.images.features.masks) {
    throw routerError(422, 'image_masks_not_supported', 'The active Model Router profile does not support masked image editing.', 'imageGenerator');
  }
  if (request.size && !capabilities.images.features.sizeSelection) {
    throw routerError(422, 'image_size_selection_not_supported', 'The active Model Router profile does not support explicit image sizes.', 'imageGenerator');
  }
  if (
    request.size
    && capabilities.images.sizes.mode === 'enumerated'
    && !capabilities.images.sizes.values.includes(request.size.toLowerCase())
  ) {
    throw routerError(422, 'image_size_not_supported', 'The requested image size is not supported by the active Model Router profile.', 'imageGenerator');
  }
}

function resolveImageRoute(request: Record<string, unknown>, context: ImageRouteContext): ResolvedImageRoute {
  const profileId = requestedProfileId(request, context.request, context.config);
  const profile = context.config.profiles[profileId];
  if (!profile) throw routerError(400, 'unknown_profile', 'Requested Model Router profile is not registered.');
  validateRequestedModel(request.model, context.config.publicModelAlias);
  const provider = profile.imageGenerator;
  if (!provider) {
    throw routerError(503, 'image_generator_not_configured', 'Model Router image generation is not configured.', 'imageGenerator');
  }
  validateProviderConfig(provider, 'imageGenerator');
  return {
    profileId,
    profile,
    provider,
    secret: secretForProvider(provider, context.env, 'imageGenerator'),
  };
}

async function routeImageProviderRequest(options: {
  context: ImageRouteContext;
  route: ResolvedImageRoute;
  providerRequest: {
    protocol: 'images-generations' | 'images-edits';
    url: string;
    headers: Record<string, string>;
    body: string | FormData;
  };
}): Promise<JsonObject> {
  const { context, route, providerRequest } = options;
  const startedAt = Date.now();
  const traceAttempt = context.traceSession?.startUpstreamAttempt({
    protocol: providerRequest.protocol,
    phase: 'request',
    method: 'POST',
    url: providerRequest.url,
    headers: providerRequest.headers,
    body: await traceableImageProviderBody(providerRequest.body),
    retry: 0,
  });
  let response: Response;
  try {
    response = await context.fetchImpl(providerRequest.url, {
      method: 'POST',
      headers: providerRequest.headers,
      body: providerRequest.body,
      signal: context.providerSignal,
    });
  } catch (error) {
    const errorSummary = providerExceptionSummary(error, 'fetch_failed');
    const failure = routerError(500, errorSummary, `Provider request failed (${errorSummary}).`, 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ durationMs: Date.now() - startedAt });
    throw failure;
  }
  traceAttempt?.responseHeaders?.(response.status, Object.fromEntries(response.headers.entries()));
  try {
    response = await captureUpstreamResponse(response, (index, chunk) => {
      traceAttempt?.responseChunk?.(index, chunk);
    });
  } catch (error) {
    const failure = routerError(502, 'provider_response_read_failed', 'Provider image response could not be read.', 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const errorSummary = `provider_http_${response.status}`;
    const failure = routerError(response.status, errorSummary, providerHttpErrorMessage(response.status, route.provider, route.secret, errorText), 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const failure = routerError(500, 'provider_invalid_json', 'Provider returned a non-JSON image response.', 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  if (isProviderErrorPayload(payload)) {
    const failure = routerError(500, 'provider_error_payload', 'Provider returned an error payload instead of an image response.', 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  if (!isRecord(payload)) {
    const failure = routerError(500, 'provider_invalid_json', 'Provider returned an invalid image response.', 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  const jsonPayload = jsonValueField(payload);
  if (!isRecord(jsonPayload)) {
    const failure = routerError(500, 'provider_invalid_json', 'Provider returned an invalid image response.', 'imageGenerator');
    traceAttempt?.error?.(failure);
    traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
    throw failure;
  }
  traceAttempt?.end?.({ status: response.status, durationMs: Date.now() - startedAt });
  return normalizeImageGenerationPayload(jsonPayload as JsonObject, context.fetchImpl, context.providerSignal);
}

async function traceableImageProviderBody(body: string | FormData): Promise<unknown> {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const [name, value] of body.entries()) {
    if (typeof value === 'string') {
      entries.push({ name, value });
      continue;
    }
    entries.push({
      name,
      file: {
        name: value.name,
        type: value.type,
        size: value.size,
        body: new Uint8Array(await value.arrayBuffer()),
      },
    });
  }
  return { encoding: 'form-data', entries };
}

function requiredMultipartText(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== 'string' || !value.trim()) {
    throw routerError(400, 'invalid_request', `Image edit multipart field "${name}" must be a non-empty string.`);
  }
  return value;
}

function copyOptionalMultipartText(source: FormData, target: FormData, name: string): void {
  const value = optionalMultipartText(source, name);
  if (!value) return;
  target.set(name, value);
}

function optionalMultipartText(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw routerError(400, 'invalid_request', `Image edit multipart field "${name}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

function requiredMultipartFiles(form: FormData, name: string): Blob[] {
  const values = form.getAll(name);
  if (!values.length || values.some((value) => typeof value === 'string' || value.size <= 0)) {
    throw routerError(400, 'invalid_request', `Image edit multipart field "${name}" must contain a non-empty file.`);
  }
  return values as Blob[];
}

function optionalMultipartFile(form: FormData, name: string): Blob | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value === 'string' || value.size <= 0) {
    throw routerError(400, 'invalid_request', `Image edit multipart field "${name}" must contain a non-empty file when provided.`);
  }
  return value;
}

function appendMultipartFile(form: FormData, name: string, file: Blob): void {
  const fileName = stringField((file as Blob & { name?: unknown }).name) ?? `${name}.png`;
  form.append(name, file, fileName);
}

async function normalizeImageGenerationPayload(
  payload: JsonObject,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<JsonObject> {
  const data = Array.isArray(payload.data) ? payload.data : undefined;
  if (!data) return payload;
  const normalizedData = await Promise.all(data.map((item) => normalizeImageGenerationItem(item, fetchImpl, signal)));
  return {
    ...payload,
    data: normalizedData,
  };
}

async function normalizeImageGenerationItem(
  item: unknown,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<JsonObject> {
  const record = isRecord(item) ? item : {};
  const b64Json = stringField(record.b64_json);
  if (b64Json) {
    const { url: _url, image_url: _imageUrl, image: _image, ...rest } = record;
    return { ...jsonObjectFromRecord(rest), b64_json: b64Json };
  }
  const dataUri = imageDataUriFromProviderItem(record) ?? imageDataUriFromProviderItem(item);
  if (dataUri) {
    const { url: _url, image_url: _imageUrl, image: _image, ...rest } = record;
    return {
      ...jsonObjectFromRecord(rest),
      b64_json: dataUri.base64,
      mime_type: stringField(rest.mime_type) ?? dataUri.mime,
    };
  }
  const imageUrl = providerImageUrlFromItem(record);
  if (!imageUrl) return jsonObjectFromRecord(record);
  const downloaded = await fetchProviderImageUrl(imageUrl, fetchImpl, signal);
  const { url: _url, image_url: _imageUrl, image: _image, ...rest } = record;
  return {
    ...jsonObjectFromRecord(rest),
    b64_json: downloaded.base64,
    mime_type: stringField(rest.mime_type) ?? downloaded.mime,
  };
}

function jsonObjectFromRecord(record: Record<string, unknown>): JsonObject {
  const json = jsonValueField(record);
  return isRecord(json) ? json as JsonObject : {};
}

function providerImageUrlFromItem(record: Record<string, unknown>): string | undefined {
  const imageUrl = isRecord(record.image_url) ? record.image_url : {};
  const image = isRecord(record.image) ? record.image : {};
  const url = stringField(record.url)
    ?? stringField(imageUrl.url)
    ?? stringField(image.url);
  if (!url) return undefined;
  const parsed = safeParsedUrl(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return undefined;
  return parsed.toString();
}

function safeParsedUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function imageDataUriFromProviderItem(value: unknown): { mime: string; base64: string } | undefined {
  if (typeof value === 'string') return parseImageDataUri(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageDataUriFromProviderItem(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const item of Object.values(value)) {
    const found = imageDataUriFromProviderItem(item);
    if (found) return found;
  }
  return undefined;
}

function parseImageDataUri(value: string): { mime: string; base64: string } | undefined {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  return match ? { mime: match[1].toLowerCase(), base64: match[2] } : undefined;
}

async function fetchProviderImageUrl(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ mime: string; base64: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    const errorSummary = providerExceptionSummary(error, 'image_url_fetch_failed');
    throw routerError(502, errorSummary, `Provider image URL fetch failed (${errorSummary}).`, 'imageGenerator');
  }
  if (!response.ok) {
    throw routerError(502, `provider_image_url_http_${response.status}`, 'Provider image URL fetch failed.', 'imageGenerator');
  }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime.startsWith('image/')) {
    throw routerError(502, 'provider_image_url_not_image', 'Provider image URL did not return an image.', 'imageGenerator');
  }
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_TRANSIENT_PROVIDER_IMAGE_BYTES) {
    throw routerError(502, 'provider_image_url_too_large', 'Provider image URL exceeded the image size limit.', 'imageGenerator');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength <= 0) {
    throw routerError(502, 'provider_image_url_empty', 'Provider image URL returned an empty image.', 'imageGenerator');
  }
  if (bytes.byteLength > MAX_TRANSIENT_PROVIDER_IMAGE_BYTES) {
    throw routerError(502, 'provider_image_url_too_large', 'Provider image URL exceeded the image size limit.', 'imageGenerator');
  }
  return { mime, base64: bytes.toString('base64') };
}

async function routeResponsesRequest(
  body: unknown,
  context: {
    config: ModelRouterConfig;
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
    workspaceRoot: string;
    request: IncomingMessage;
    visionTranslationCache: Map<string, VisionTranslationCacheEntry>;
    scientificTranslationCache: Map<string, ScientificEvidence>;
    responseContinuationCache: ResponseContinuationCache;
    upstreamNegotiator: UpstreamProtocolNegotiator;
    preferredProtocol: UpstreamWireProtocol;
    traceSession?: ModelRouterTraceSession;
    responseId?: string;
    providerSignal?: AbortSignal;
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
  const evidencePolicy = requestedEvidencePolicy(context.request);

  const responseId = context.responseId ?? makeId('resp');
  const requestInputs = extractRequestInputs(request.input, request.instructions);
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
  const previousResponseId = stringField(request.previous_response_id);
  const requestWithoutContinuationHandle = { ...request };
  delete requestWithoutContinuationHandle.previous_response_id;
  const requestWithSafeTextInput = typeof request.input === 'string'
    ? { ...requestWithoutContinuationHandle, input: extracted.userText }
    : requestWithoutContinuationHandle;
  const requestForTextReasoner = hasToolTranscriptInput
    ? {
      ...requestWithSafeTextInput,
      input: repairResponseToolTranscriptInput(
        restoreResponseContinuation(
          request.input,
          previousResponseId
            ? context.responseContinuationCache.get(previousResponseId)
            : undefined,
        ),
      ),
    }
    : requestWithSafeTextInput;
  const textReasonerRequestOptions = textReasonerOptionsFromResponsesRequest(requestForTextReasoner);
  const toolNameAliases = chatToolNameAliasesFromResponsesTools(request.tools);
  const textReasonerMessages = hasToolTranscriptInput || hasAssistantReasoningInput
    ? chatMessagesFromResponsesRequest(requestForTextReasoner, profile.textReasoner.model)
    : [];

  // Lexical detectors must not become routing truth; final routing must use structured semantic signals and refs-first evidence.
  const visionModalities = extracted.modalities.filter((item) => finalModalityRoutingSignal(item).kind === 'vision.image');
  const unsupportedModalities = extracted.modalities.filter((item) => finalModalityRoutingSignal(item).kind !== 'vision.image');
  const strictVisualEvidenceRequired = evidencePolicy === 'required';

  if (strictVisualEvidenceRequired && visionModalities.length === 0) {
    throw strictVisionEvidenceError({
      causeCode: 'vision_evidence_input_required',
      status: 400,
      failureClass: 'invalid_arguments',
      retryable: false,
      message: 'Strict evidence policy requires at least one visual input.',
      recovery: {
        action: 'stop',
        instruction: 'Attach an authorized visual input and repeat the native visual inspection.',
      },
    });
  }

  if (unsupportedModalities.length > 0) {
    for (const item of unsupportedModalities) {
      const scientificRisk = await classifyScientificModalityRisk(item, context.workspaceRoot);
      if (scientificRisk.level === 'high' && !scientificRisk.translatorModality) {
        throw routerError(
          415,
          'scientific_modality_unsupported',
          'This protected scientific file format has no registered native-to-text expert. The raw object text was not sent to any translator or reasoner.',
          'scientificTranslator',
        );
      }
      if (scientificRisk.level === 'high' && !isScientificTranslatorUsable(profile.translators.scientific, context.env)) {
        throw routerError(
          503,
          'scientific_translator_required',
          'High-risk scientific objects require a configured Model Router scientific expert translator. Configure translators.scientific for expert translation; the raw object text was not sent to the reasoner.',
          'scientificTranslator',
        );
      }
      // 1) Allowlisted scientific file (.fasta / .pdb / .smiles) + managed sci-modality worker:
      //    translate to natural-language evidence (the worker owns retry).
      const expert = await translateScientificModalityObservation(
        item,
        context.workspaceRoot,
        profile.translators.scientific,
        context.env,
        context.fetchImpl,
        context.scientificTranslationCache,
        scientificRisk.translatorModality,
        context.providerSignal,
        context.traceSession,
      );
      if (expert) {
        observations.push(expert.observation);
        scientificEvidence.push(expert.evidence);
        continue;
      }
      if (scientificRisk.level === 'high') {
        throw routerError(
          502,
          'scientific_translation_failed',
          'High-risk scientific object translation failed. Configure or repair the Model Router scientific expert translator; the raw object text was not sent to the reasoner.',
          'scientificTranslator',
        );
      }
      // 2) Otherwise, if the ref is a readable low-risk workspace text file (e.g. .txt / .csv with no
      //    high-risk scientific extension), inline its content with explicit audit markers.
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
      if (strictVisualEvidenceRequired) {
        throw strictVisionEvidenceError({
          causeCode: visionTranslator
            ? 'vision_translator_credentials_unavailable'
            : 'vision_translator_not_configured',
          status: 503,
          failureClass: 'capability_unavailable',
          retryable: false,
          message: 'Strict visual evidence is unavailable because the vision translator is not ready.',
          recovery: {
            action: 'stop',
            instruction: 'Configure the vision translator and its credentials before repeating native visual inspection.',
          },
        });
      }
      degraded = true;
      imageNotSent = true;
      const reason = !visionTranslator
        ? 'Active Model Router profile has no vision translator; the image payload was not sent to the text-only model.'
        : 'Active Model Router profile has no usable vision translator secret; the image payload was not sent to the text-only model.';
      for (const modality of visionModalities) {
        const observation = formatVisionNotSentObservation(modality, reason);
        observations.push(observation);
      }
    } else {
      for (const modality of visionModalities) {
        const translationInstruction = visionTranslatorInstruction(
          extracted.userText || 'Describe the provided visual input.',
          modality,
        );
        const instructionIntentSha256 = visionInstructionIntentSha256(
          translationInstruction,
          evidencePolicy,
        );
        const cacheKey = visionObservationCacheKey(profileId, modality, instructionIntentSha256);
        const cached = context.visionTranslationCache.get(cacheKey);
        if (cached) {
          const cachedObservation = formatCachedVisionTranslationObservation(modality, cached);
          observations.push(cachedObservation);
          continue;
        }
        let observationStatus: 'ok' | 'failed' = 'ok';
        let observation: string;
        try {
          const result = await callVisionTranslator({
            profile,
            secret: visionSecret,
            fetchImpl: context.fetchImpl,
            instruction: translationInstruction,
            modality,
            phase: 'vision-initial',
            calls,
            signal: context.providerSignal,
            upstreamNegotiator: context.upstreamNegotiator,
            preferredProtocol: context.preferredProtocol,
            traceSession: context.traceSession,
          });
          addUsage(usage, result.usage);
          observation = result.outputText;
          if (strictVisualEvidenceRequired && !observation.trim()) {
            throw routerError(
              502,
              'vision_translation_empty',
              'Vision translator returned no usable observation.',
              'visionTranslator',
            );
          }
        } catch (error) {
          if (context.providerSignal?.aborted) throw error;
          if (strictVisualEvidenceRequired) {
            recordProviderAuthFailure(context, traceErrorSummary(error), 'visionTranslator');
            throw strictVisionEvidenceErrorFromCause(error);
          }
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
          storeVisionTranslationCacheEntry(
            context.visionTranslationCache,
            profileId,
            modality,
            instructionIntentSha256,
            observation,
          );
        }
      }
    }
  }

  let outputText = '';
  let outputItems: JsonObject[] = [];
  let responseStatus: string | undefined;
  let incompleteDetails: JsonObject | undefined;
  let terminalDetails: JsonObject | undefined;
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
        request: requestForTextReasoner,
        requestOptions: textReasonerRequestOptions,
        toolNameAliases,
        signal: context.providerSignal,
        upstreamNegotiator: context.upstreamNegotiator,
        preferredProtocol: context.preferredProtocol,
        traceSession: context.traceSession,
      }).catch((error: unknown) => {
        if (context.providerSignal?.aborted) throw error;
        if (strictVisualEvidenceRequired) {
          recordProviderAuthFailure(context, traceErrorSummary(error), 'textReasoner');
          throw strictVisualEvidenceSynthesisErrorFromCause(error);
        }
        throw error;
      });
      addUsage(usage, textResult.usage);
      responseStatus = textResult.status;
      incompleteDetails = textResult.incompleteDetails;
      terminalDetails = textResult.terminalDetails;
      const hasToolCall = textResult.outputItems.some((item) => item.type === 'function_call');
      const reasoningItems = textResult.outputItems.filter((item) => item.type === 'reasoning');
      if (hasToolCall) {
        outputText = textResult.outputText;
        outputItems = textResult.outputItems;
        break;
      }

      const control = parseTextControl(textResult.outputText);
      if (control?.type === 'final_answer') {
        outputText = publicProviderOutputText(control.content, profile, publicModelAlias, traceRedactionSecrets);
        outputItems = reasoningItems;
        break;
      }

      if (control?.type === 'need_more_visual_info' && supplementRounds < maxSupplementRounds && profile.translators.vision && visionSecret) {
        const target = visionModalities.find((modality) => modality.id === control.target);
        if (target) {
          supplementRounds += 1;
          const safeControl = sanitizeTextControl(control, profile, publicModelAlias, traceRedactionSecrets);
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
              signal: context.providerSignal,
              upstreamNegotiator: context.upstreamNegotiator,
              preferredProtocol: context.preferredProtocol,
              traceSession: context.traceSession,
            });
            addUsage(usage, result.usage);
            supplementObservation = result.outputText;
            if (strictVisualEvidenceRequired && !supplementObservation.trim()) {
              throw routerError(
                502,
                'vision_translation_empty',
                'Vision translator returned no usable supplemental observation.',
                'visionTranslator',
              );
            }
          } catch (error) {
            if (context.providerSignal?.aborted) throw error;
            if (strictVisualEvidenceRequired) {
              recordProviderAuthFailure(context, traceErrorSummary(error), 'visionTranslator');
              throw strictVisionEvidenceErrorFromCause(error);
            }
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
          continue;
        }
      }

      outputText = publicProviderOutputText(textResult.outputText, profile, publicModelAlias, traceRedactionSecrets);
      outputItems = reasoningItems;
      break;
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
  rememberResponseContinuation(context.responseContinuationCache, responseId, outputItems);

  return {
    responseId,
    model: context.config.publicModelAlias ?? 'sciforge-model-router',
    outputText,
    outputItems,
    usage,
    status: responseStatus,
    incompleteDetails,
    terminalDetails,
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

function requestedEvidencePolicy(incoming: IncomingMessage): 'allow-degraded' | 'required' {
  const value = incoming.headers[MODEL_ROUTER_EVIDENCE_POLICY_HEADER];
  if (value === undefined) return 'allow-degraded';
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  if (normalized === 'required') return 'required';
  throw routerError(
    400,
    'invalid_evidence_policy',
    `${MODEL_ROUTER_EVIDENCE_POLICY_HEADER} must be "required" when supplied.`,
  );
}

function preferredResponsesProtocol(
  config: ModelRouterConfig,
  request: unknown,
  incoming: IncomingMessage,
): UpstreamWireProtocol {
  const profileId = requestedProfileId(isRecord(request) ? request : {}, incoming, config);
  const provider = config.profiles[profileId]?.textReasoner;
  if (!provider) return 'responses';
  validateProviderConfig(provider, 'textReasoner');
  return preferredProviderProtocol(provider.compatibility, 'responses');
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
  if (profile.imageGenerator) validateProviderConfig(profile.imageGenerator, 'imageGenerator');
  if (profile.translators.vision) validateProviderConfig(profile.translators.vision, 'translators.vision');
  if (profile.translators.scientific) validateScientificTranslatorConfig(profile.translators.scientific);
}

function validateProviderConfig(config: ModelRouterProviderConfig, role: string) {
  const issue = providerConfigurationIssue(config);
  if (issue === 'missing') {
    throw routerError(400, 'invalid_provider_config', `Model Router profile role "${role}" is missing required provider configuration.`);
  }
  if (issue === 'invalid_url') {
    throw routerError(400, 'invalid_provider_config', `Model Router profile role "${role}" has an invalid provider base URL.`);
  }
  const compatibilityIssue = providerCompatibilityConfigurationIssue(config.compatibility);
  if (compatibilityIssue) {
    throw routerError(
      400,
      'invalid_provider_config',
      `Model Router profile role "${role}" has invalid compatibility settings: ${compatibilityIssue}.`,
    );
  }
}

function providerConfigurationIssue(config: ModelRouterProviderConfig): 'missing' | 'invalid_url' | undefined {
  if (!config.baseUrl || !config.apiKeyEnv || !config.model) return 'missing';
  try {
    new URL(config.baseUrl);
    return undefined;
  } catch {
    return 'invalid_url';
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

function validateScientificTranslatorConfig(config: ModelRouterScientificTranslatorConfig) {
  const issue = scientificTranslatorConfigurationIssue(config);
  if (issue === 'missing') {
    throw routerError(400, 'invalid_provider_config', 'Model Router profile role "translators.scientific" is missing required service configuration.');
  }
  if (issue === 'invalid_url') {
    throw routerError(400, 'invalid_provider_config', 'Model Router profile role "translators.scientific" has an invalid service base URL.');
  }
}

function scientificTranslatorConfigurationIssue(
  config: ModelRouterScientificTranslatorConfig,
): 'missing' | 'invalid_url' | undefined {
  if (!config.baseUrl || !config.tokenEnv || !config.model) return 'missing';
  try {
    new URL(config.baseUrl);
    return undefined;
  } catch {
    return 'invalid_url';
  }
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

const MODEL_VISIBLE_IMAGE_KINDS = new Set(['image', 'computer_screenshot', 'visualSnapshot']);
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
  const rawImageUrl = value.image_url ?? value.imageUrl;
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

// Inline a readable low-risk workspace text file (e.g. uploaded .txt / .csv without high-risk
// scientific extensions) as the observation so the text reasoner can answer directly instead of
// blindly searching the filesystem.
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
      'risk_marker=scientific_modality_risk:low',
      'risk_level=low',
      'risk_reason=no_high_risk_scientific_extension_detected',
      'fallback_marker=workspace_text_fallback',
      'fallback_reason=low_risk_textual_object_without_expert_translation',
      `source=workspace-file:${target.relativeRef}`,
      'instruction=The referenced file was read directly. Treat the following contents as the inspected modality and answer the user question from it; do not search the filesystem for it.',
      'content:',
      text,
    ].join('\n');
  } catch {
    return undefined;
  }
}

type ScientificModalityRisk = {
  level: 'high' | 'low';
  translatorModality?: ScientificTranslatorModality;
};

async function classifyScientificModalityRisk(item: ModalityRef, workspaceRoot: string): Promise<ScientificModalityRisk> {
  const candidates = [
    item.safeRef,
    item.title,
    item.materializationPath,
  ];
  const target = await workspaceImageTarget(item, workspaceRoot);
  if (target) candidates.push(target.relativeRef);
  const level = candidates.some((candidate) => Boolean(candidate && isProtectedScientificFilePath(candidate)))
    ? 'high'
    : 'low';
  // When the workspace target exists, its extension is authoritative. Never let a display title
  // relabel an unsupported protected file as a translatable modality.
  let translatorModality = target
    ? scientificTranslatorModalityForPath(target.relativeRef)
    : candidates.map((candidate) => candidate ? scientificTranslatorModalityForPath(candidate) : undefined).find(Boolean);
  // `.fasta` and `.fa` are shared by protein and nucleotide FASTA. Resolve them locally and
  // conservatively: only a canonical amino-acid sequence containing at least one residue that
  // cannot be an IUPAC nucleotide symbol may enter the protein expert. `.faa` is unambiguous by
  // format convention and does not need content classification.
  if (target && translatorModality === 'protein' && isAmbiguousFastaExtension(target.relativeRef)) {
    const proteinConfirmed = await isUnambiguousProteinFasta(target.absolutePath);
    if (!proteinConfirmed) translatorModality = undefined;
  }
  return translatorModality ? { level, translatorModality } : { level };
}

async function isUnambiguousProteinFasta(absolutePath: string): Promise<boolean> {
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TEXT_MODALITY_BYTES) return false;
    const bytes = await readFile(absolutePath);
    if (bytes.subarray(0, 8192).includes(0)) return false;
    const lines = bytes.toString('utf8').split(/\r?\n/);
    const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
    if (firstContentLine < 0 || !lines[firstContentLine]?.trimStart().startsWith('>')) return false;
    const records: string[] = [];
    let sequenceLines: string[] = [];
    for (const line of lines.slice(firstContentLine + 1)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('>')) {
        records.push(sequenceLines.join(''));
        sequenceLines = [];
        continue;
      }
      if (trimmed) sequenceLines.push(trimmed);
    }
    records.push(sequenceLines.join(''));
    // EFILPQ are canonical amino-acid symbols outside the IUPAC nucleotide alphabet. Requiring at
    // least one in every record prevents DNA/RNA, ambiguity-only, and mixed multi-record FASTA
    // files from being labeled as protein based only on their first record.
    return records.length > 0 && records.every((record) => {
      const sequence = record.replace(/\s+/g, '').toUpperCase();
      return sequence.length >= 10
        && /^[ACDEFGHIKLMNPQRSTVWY]+$/.test(sequence)
        && /[EFILPQ]/.test(sequence);
    });
  } catch {
    return false;
  }
}

function isScientificTranslatorUsable(
  service: ModelRouterScientificTranslatorConfig | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (!service?.baseUrl.trim() || !service.tokenEnv.trim() || !service.model.trim()) return false;
  return Boolean((env[service.tokenEnv] ?? '').trim());
}

// Translate an uploaded scientific file to natural-language evidence via the Model-Router-managed
// sci-modality worker. Gated by `profile.translators.scientific`; the worker owns modality
// retry/robustness. Model Router resolves the modality from an allowlisted file extension and sends
// it explicitly, so unsupported protected formats never reach auto-detection. Translation-only: it
// returns evidence, never answers. Returns undefined when the service is unconfigured, the ref is
// not a scientific file, the file is unreadable/binary, or the call fails; callers decide whether
// to fail closed by risk level.
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
  service: ModelRouterScientificTranslatorConfig | undefined,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  cache?: Map<string, ScientificEvidence>,
  translatorModality?: ScientificTranslatorModality,
  signal?: AbortSignal,
  traceSession?: ModelRouterTraceSession,
): Promise<{ observation: string; evidence: ScientificEvidence } | undefined> {
  if (!translatorModality) return undefined;
  if (!service) return undefined;
  const serviceUrl = service.baseUrl.trim();
  if (!serviceUrl) return undefined;
  const serviceToken = (env[service.tokenEnv] ?? '').trim();
  if (!serviceToken) return undefined;
  const target = await workspaceImageTarget(item, workspaceRoot);
  if (!target || scientificTranslatorModalityForPath(target.relativeRef) !== translatorModality) return undefined;
  try {
    const stats = await stat(target.absolutePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TEXT_MODALITY_BYTES) return undefined;
    const bytes = await readFile(target.absolutePath);
    if (bytes.subarray(0, 8192).includes(0)) return undefined; // looks binary
    const payload = bytes.toString('utf8');
    if (!payload.trim()) return undefined;

    // Cache by resolved modality + file-content sha: the same uploaded file rides every tool round
    // of one agentic turn, so translate once and re-surface the block without re-calling the GPU.
    const cacheKey = createHash('sha256').update(`${translatorModality}\0${payload}`).digest('hex');
    const cached = cache?.get(cacheKey);
    if (cached) return { observation: buildScientificObservation(item, cached), evidence: cached };

    const timeoutMs = service?.timeoutMs ?? 1_800_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let json: JsonObject | undefined;
    let ok = false;
    const requestUrl = `${serviceUrl.replace(/\/+$/, '')}/modality/translate`;
    const requestHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceToken}`,
    };
    const requestBody = {
      payload,
      modality: translatorModality,
      objectId: item.id,
      model: service.model,
    };
    const startedAt = Date.now();
    const traceAttempt = traceSession?.startUpstreamAttempt({
      protocol: 'scientific-translation',
      phase: 'request',
      method: 'POST',
      url: requestUrl,
      headers: requestHeaders,
      body: requestBody,
      retry: 0,
    });
    try {
      let resp = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      traceAttempt?.responseHeaders?.(resp.status, Object.fromEntries(resp.headers.entries()));
      resp = await captureUpstreamResponse(resp, (index, chunk) => {
        traceAttempt?.responseChunk?.(index, chunk);
      });
      ok = resp.ok;
      json = (await resp.json().catch(() => undefined)) as JsonObject | undefined;
      if (!ok || !json || json.ok !== true) {
        const failure = routerError(
          resp.status || 502,
          !ok ? `scientific_translation_http_${resp.status}` : 'scientific_translation_invalid_response',
          'Scientific translator returned an unsuccessful response.',
          'scientificTranslator',
        );
        traceAttempt?.error?.(failure);
      }
      traceAttempt?.end?.({ status: resp.status, durationMs: Date.now() - startedAt });
    } catch (error) {
      traceAttempt?.error?.(error);
      traceAttempt?.end?.({ durationMs: Date.now() - startedAt });
      throw error;
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
  } catch (error) {
    if (signal?.aborted) throw error;
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
  instructionIntentSha256: string,
  observation: string,
) {
  const modalityCacheKey = visionObservationCacheKey(profileId, modality, instructionIntentSha256);
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

function visionObservationCacheKey(
  profileId: string,
  modality: ModalityRef,
  instructionIntentSha256: string,
) {
  return [
    profileId,
    modality.contentSha256 ?? modality.sha256,
    instructionIntentSha256,
  ].join(':');
}

function visionInstructionIntentSha256(
  instruction: string,
  evidencePolicy: 'allow-degraded' | 'required',
): string {
  const normalizedInstruction = instruction
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
  return createHash('sha256')
    .update(JSON.stringify({
      evidencePolicy,
      instruction: normalizedInstruction,
    }))
    .digest('hex');
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
  signal?: AbortSignal;
  upstreamNegotiator: UpstreamProtocolNegotiator;
  preferredProtocol: UpstreamWireProtocol;
  traceSession?: ModelRouterTraceSession;
}) {
  const translator = options.profile.translators.vision;
  if (!translator) throw new Error('Vision translator is not configured.');
  assertVisionInputCapability(options.profile, options.modality);
  const providerParts = [options.modality.transientProviderPart]
    .filter((part): part is JsonObject => Boolean(part));
  const content: JsonObject[] = [
    { type: 'text', text: options.instruction },
    ...providerParts,
  ];
  const chatBody = {
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
  };
  const result = await callCanonicalProvider({
    provider: translator,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    request: chatCompletionsToResponsesRequest(chatBody, translator.model),
    role: 'visionTranslator',
    phase: options.phase,
    calls: options.calls,
    signal: options.signal,
    upstreamNegotiator: options.upstreamNegotiator,
    preferredProtocol: options.preferredProtocol,
    traceSession: options.traceSession,
  });
  return result;
}

function assertVisionInputCapability(profile: ModelRouterProfile, modality: ModalityRef): void {
  const registration = profile.capabilities?.vision;
  const mimeTypes = sanitizeVisionMimeTypes(registration?.mimeTypes ?? [...MODEL_ROUTER_VISION_MIME_TYPES]);
  const mime = modality.mime?.trim().toLowerCase();
  if (mime && !mimeTypes.includes(mime)) {
    throw routerError(415, 'vision_mime_not_supported', 'The visual input MIME type is not supported by the active Model Router profile.', 'visionTranslator');
  }
  const maxInputBytes = boundedPublicInputBytes(registration?.maxInputBytes, MODEL_ROUTER_MAX_VISUAL_INPUT_BYTES);
  if (modality.byteLength !== undefined && modality.byteLength > maxInputBytes) {
    throw routerError(413, 'vision_input_too_large', 'The visual input exceeds the active Model Router profile input limit.', 'visionTranslator');
  }
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
  signal?: AbortSignal;
  upstreamNegotiator: UpstreamProtocolNegotiator;
  preferredProtocol: UpstreamWireProtocol;
  traceSession?: ModelRouterTraceSession;
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
  const adaptedRequest = options.observations.length
    ? {
        ...options.request,
        ...chatCompletionsToResponsesRequest({
          model: options.profile.textReasoner.model,
          messages,
          ...multimodalTextReasonerRequestOptions(options.requestOptions, true),
        }, options.profile.textReasoner.model),
        tools: options.request.tools,
        tool_choice: options.request.tool_choice,
        parallel_tool_calls: options.request.parallel_tool_calls,
      }
    : {
        ...options.request,
        model: options.profile.textReasoner.model,
      };
  return await callCanonicalProvider({
    provider: options.profile.textReasoner,
    secret: options.secret,
    fetchImpl: options.fetchImpl,
    request: adaptedRequest,
    role: 'textReasoner',
    phase: options.observations.length ? 'text-control-or-final' : 'text-direct',
    calls: options.calls,
    responseRequest: options.request,
    toolNameAliases: options.toolNameAliases,
    signal: options.signal,
    upstreamNegotiator: options.upstreamNegotiator,
    preferredProtocol: options.preferredProtocol,
    traceSession: options.traceSession,
  });
}

async function callCanonicalProvider(options: {
  provider: ModelRouterProviderConfig;
  secret: string;
  fetchImpl: typeof fetch;
  request: ResponsesRequest;
  role: ProviderCallRecord['role'];
  phase: string;
  calls: ProviderCallRecord[];
  responseRequest?: Pick<ResponsesRequest, 'model'>;
  toolNameAliases?: Record<string, string>;
  signal?: AbortSignal;
  upstreamNegotiator: UpstreamProtocolNegotiator;
  preferredProtocol: UpstreamWireProtocol;
  traceSession?: ModelRouterTraceSession;
}) {
  try {
    const result = await options.upstreamNegotiator.request({
      request: options.request,
      baseUrl: options.provider.baseUrl,
      apiKey: options.secret,
      model: options.provider.model,
      compatibility: options.provider.compatibility,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      preferredProtocol: options.preferredProtocol,
      toolNameAliases: options.toolNameAliases,
      traceAttempt: options.traceSession
        ? (attempt) => options.traceSession?.startUpstreamAttempt(attempt)
        : undefined,
      onAttempt: (attempt) => recordUpstreamAttempt(options, attempt),
    });
    const successfulCall = options.calls.at(-1);
    if (successfulCall?.status === 'ok') successfulCall.stopReason = canonicalStopReason(result.response);
    return canonicalProviderResult(result.response);
  } catch (error) {
    if (!(error instanceof UpstreamRequestError)) throw error;
    const detail = error.responseBody?.trim();
    const prefix = error.upstreamStatus === 401 || error.upstreamStatus === 403
      ? 'Upstream API credentials were rejected. Update the API key in SciForge Model Router settings, then restart or reload the router.'
      : error.message;
    const message = detail
      ? `${prefix}: ${boundedProviderTraceText(detail, options.provider, [options.secret])}`
      : prefix;
    throw routerError(error.status, error.code, message, options.role);
  }
}

function canonicalStopReason(response: JsonObject): ProviderCallRecord['stopReason'] {
  const output = Array.isArray(response.output) ? response.output : [];
  if (output.some((item) => isRecord(item) && item.type === 'function_call')) return 'tool_calls';
  if (response.status === 'incomplete') return 'length';
  return response.status === 'completed' || response.object === 'response' ? 'stop' : 'unknown';
}

function recordUpstreamAttempt(
  options: {
    provider: ModelRouterProviderConfig;
    request: ResponsesRequest;
    role: ProviderCallRecord['role'];
    phase: string;
    calls: ProviderCallRecord[];
  },
  attempt: UpstreamAttempt,
): void {
  options.calls.push({
    role: options.role,
    phase: attempt.phase === 'probe' ? 'protocol-probe' : options.phase,
    status: attempt.status === 'ok' ? 'ok' : 'failed',
    roleAlias: roleAliasForCall(options.role),
    providerBindingSha256: providerBindingHash(options.provider),
    ...providerCallTraceFields(options.provider, options.request, attempt.protocol, attempt.url),
    wireApi: attempt.protocol,
    latencyMs: attempt.latencyMs,
    stopReason: attempt.status === 'ok' ? 'unknown' : 'error',
    ...(attempt.status === 'ok'
      ? {}
      : { errorSummary: attempt.errorCode ?? (attempt.httpStatus ? `upstream_http_${attempt.httpStatus}` : `upstream_${attempt.status}`) }),
  });
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

function providerImageGenerationsUrl(baseUrl: string): string {
  return buildProviderEndpointUrl(baseUrl, 'images/generations');
}

function providerImageEditsUrl(baseUrl: string): string {
  return buildProviderEndpointUrl(baseUrl, 'images/edits');
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
  for (const path of ['chat/completions', 'images/generations', 'images/edits', 'responses', 'messages']) {
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

function textReasonerOptionsFromResponsesRequest(request: Record<string, unknown>): Record<string, unknown> {
  const reasoning = isRecord(request.reasoning) ? request.reasoning : undefined;
  return Object.fromEntries(Object.entries({
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_output_tokens ?? request.max_tokens,
    metadata: request.metadata,
    reasoning_effort: stringField(request.reasoning_effort) ?? stringField(reasoning?.effort),
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

function restoreResponseContinuation(
  input: unknown,
  continuation: ResponseContinuationBlock | undefined,
): unknown {
  if (!Array.isArray(input) || !continuation?.length) return input;
  const callIds = new Set(
    continuation
      .filter((item) => item.type === 'function_call')
      .map(responseToolTranscriptCallId)
      .filter(Boolean),
  );
  if (callIds.size === 0) return input;
  const stateItemKeys = new Set(
    continuation
      .filter(isResponseContinuationStateItem)
      .map(responseContinuationStateItemKey),
  );
  const insertionIndex = input.findIndex((item) => (
    isRecord(item) && responseContinuationReferencesItem(item, callIds, stateItemKeys)
  ));
  if (insertionIndex < 0) return input;

  const restored: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (index === insertionIndex) restored.push(...continuation.map((item) => ({ ...item })));
    const item = input[index];
    if (isRecord(item) && isReplayedResponseContinuationItem(item, callIds, stateItemKeys)) continue;
    restored.push(item);
  }
  return restored;
}

function responseContinuationReferencesItem(
  item: Record<string, unknown>,
  callIds: ReadonlySet<string>,
  stateItemKeys: ReadonlySet<string>,
): boolean {
  if (item.type === 'function_call' || item.type === 'function_call_output') {
    return callIds.has(responseToolTranscriptCallId(item));
  }
  return isResponseContinuationStateItem(item)
    && stateItemKeys.has(responseContinuationStateItemKey(item));
}

function isReplayedResponseContinuationItem(
  item: Record<string, unknown>,
  callIds: ReadonlySet<string>,
  stateItemKeys: ReadonlySet<string>,
): boolean {
  if (item.type === 'function_call') return callIds.has(responseToolTranscriptCallId(item));
  return isResponseContinuationStateItem(item)
    && stateItemKeys.has(responseContinuationStateItemKey(item));
}

function responseContinuationStateItemKey(item: Record<string, unknown>): string {
  const type = stringField(item.type);
  const id = stringField(item.id);
  if (id) return `${type}:${id}`;
  return `${type}:${createHash('sha256').update(JSON.stringify(item)).digest('hex')}`;
}

function repairResponseToolTranscriptInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  let changed = false;
  const repaired: unknown[] = [];
  let pendingItems: JsonObject[] = [];
  let pendingCallIds = new Set<string>();
  let pendingOutputIds = new Set<string>();

  const resetPending = (markChanged: boolean): void => {
    if (markChanged && pendingItems.length > 0) changed = true;
    pendingItems = [];
    pendingCallIds = new Set<string>();
    pendingOutputIds = new Set<string>();
  };

  const flushPendingIfComplete = (): boolean => {
    if (pendingCallIds.size === 0) return true;
    if (pendingOutputIds.size !== pendingCallIds.size) return false;
    repaired.push(...pendingItems);
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
      if (pendingOutputIds.size > 0) {
        if (!flushPendingIfComplete()) resetPending(true);
      }
      if (pendingCallIds.has(callId)) {
        changed = true;
        continue;
      }
      pendingItems.push(item as JsonObject);
      pendingCallIds.add(callId);
      continue;
    }

    if (item.type === 'function_call_output') {
      const callId = responseToolTranscriptCallId(item);
      if (!callId || !pendingCallIds.has(callId) || pendingOutputIds.has(callId)) {
        changed = true;
        continue;
      }
      pendingItems.push(item as JsonObject);
      pendingOutputIds.add(callId);
      if (pendingOutputIds.size === pendingCallIds.size) flushPendingIfComplete();
      continue;
    }

    if (pendingCallIds.size > 0 && isResponseContinuationStateItem(item)) {
      pendingItems.push(item as JsonObject);
      continue;
    }

    if (pendingCallIds.size > 0 && isResponseToolTranscriptBridgeItem(item)) {
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

function isResponseContinuationStateItem(item: Record<string, unknown>): boolean {
  return item.type === 'reasoning' || item.type === 'compaction';
}

function rememberResponseContinuation(
  cache: ResponseContinuationCache,
  responseId: string,
  outputItems: JsonObject[],
): void {
  const continuation = outputItems
    .filter((item) => item.type === 'function_call' || isResponseContinuationStateItem(item))
    .map((item) => ({ ...item }));
  if (!continuation.some((item) => item.type === 'function_call')) return;
  cache.delete(responseId);
  cache.set(responseId, continuation);
  while (cache.size > MAX_RESPONSE_CONTINUATION_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

function canonicalProviderResult(
  response: JsonObject,
): {
  outputText: string;
  outputItems: JsonObject[];
  usage: ResponseUsage;
  status?: string;
  incompleteDetails?: JsonObject;
  terminalDetails?: JsonObject;
} {
  const outputItems = Array.isArray(response.output)
    ? response.output.filter(isRecord) as JsonObject[]
    : [];
  const outputText = typeof response.output_text === 'string'
    ? response.output_text
    : responseOutputText(outputItems);
  return {
    outputText,
    outputItems,
    usage: responseUsageFromCanonical(response),
    status: stringField(response.status),
    incompleteDetails: isRecord(response.incomplete_details) ? response.incomplete_details as JsonObject : undefined,
    terminalDetails: isRecord(response.terminal_details) ? response.terminal_details as JsonObject : undefined,
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

function responseUsageFromCanonical(response: JsonObject): ResponseUsage {
  const usage = isRecord(response.usage) ? response.usage : {};
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
): Extract<TextControl, { type: 'need_more_visual_info' }> {
  return {
    type: 'need_more_visual_info',
    target: control.target,
    question: publicProviderOutputText(control.question, profile, publicModelAlias, sensitiveValues),
    reason: control.reason
      ? publicProviderOutputText(control.reason, profile, publicModelAlias, sensitiveValues)
      : undefined,
  };
}

function responseObject(result: RoutedResponse, messageItemId?: string): JsonObject {
  const output = responseOutputItems(result, messageItemId);
  return {
    id: result.responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: result.model,
    status: result.status ?? 'completed',
    output,
    output_text: result.outputText,
    usage: result.usage,
    ...(result.incompleteDetails ? { incomplete_details: result.incompleteDetails } : {}),
    ...(result.terminalDetails ? { terminal_details: result.terminalDetails } : {}),
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
      return compactObject({
        role,
        content: chatMessageContentToResponsesParts(message.content, role),
      });
    });
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  return {
    model: stringField(body.model) || publicModelAlias,
    input: inputMessages.length ? inputMessages : chatMessageContentText(body.prompt) ?? '',
    ...(instructions ? { instructions } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(maxTokens !== undefined ? { max_output_tokens: maxTokens } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
    ...(body.reasoning_effort !== undefined ? { reasoning_effort: body.reasoning_effort } : {}),
    ...(body.stop !== undefined ? { stop: body.stop } : {}),
    ...(body.stream !== undefined ? { stream: body.stream } : {}),
  };
}

function chatMessageContentToResponsesParts(content: unknown, role: string): JsonObject[] {
  const parts = Array.isArray(content) ? content : [content];
  const normalized = parts
    .map((part) => chatContentPartToResponsesPart(part, role))
    .filter((part): part is JsonObject => Boolean(part));
  return normalized.length > 0
    ? normalized
    : [{ type: responsesTextPartType(role), text: '' }];
}

function chatContentPartToResponsesPart(part: unknown, role: string): JsonObject | undefined {
  if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') {
    return { type: responsesTextPartType(role), text: String(part) };
  }
  if (!isRecord(part)) return undefined;
  const type = stringField(part.type);
  if (type === 'text') {
    return {
      type: responsesTextPartType(role),
      text: stringField(part.text) ?? stringField(part.content) ?? '',
    };
  }
  if (type === 'image_url') {
    const chatImage = isRecord(part.image_url) ? part.image_url : undefined;
    const imageUrl = chatImage
      ? stringField(chatImage.url)
      : stringField(part.image_url);
    if (!imageUrl) return undefined;
    return compactObject({
      type: 'input_image',
      image_url: imageUrl,
      detail: stringField(part.detail) ?? stringField(chatImage?.detail),
    });
  }
  return jsonValueField(part) as JsonObject | undefined;
}

function responsesTextPartType(role: string): 'input_text' | 'output_text' {
  return role === 'assistant' ? 'output_text' : 'input_text';
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
  const finishReason = chatFinishReasonFromResponse(
    response,
    functionCalls.length ? 'tool_calls' : 'stop',
  );
  return {
    id: stringField(response.id) || makeId('chatcmpl'),
    object: 'chat.completion',
    created: numberField(response.created_at) ?? Math.floor(Date.now() / 1000),
    model: stringField(request.model) || stringField(response.model) || '',
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason,
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
        error: routerErrorResponseBody(routerError),
      },
    });
    response.write('data: [DONE]\n\n');
    response.end();
  });
}

function sendDeferredChatCompletionStream(
  response: ServerResponse,
  request: Record<string, unknown>,
  resultPromise: Promise<RoutedResponse>,
) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  void resultPromise.then((result) => {
    const completion = responseToChatCompletion(responseObject(result), request);
    const choices = Array.isArray(completion.choices) ? completion.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : {};
    const message = isRecord(choice.message) ? choice.message : {};
    const id = stringField(completion.id) || result.responseId;
    const model = stringField(completion.model) || result.model;
    writeChatCompletionChunk(response, {
      id,
      object: 'chat.completion.chunk',
      created: numberField(completion.created) ?? Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: compactObject({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        }),
        finish_reason: choice.finish_reason ?? 'stop',
      }],
    });
    writeChatCompletionChunk(response, {
      id,
      object: 'chat.completion.chunk',
      created: numberField(completion.created) ?? Math.floor(Date.now() / 1000),
      model,
      choices: [],
      usage: completion.usage,
    });
    response.write('data: [DONE]\n\n');
    response.end();
  }).catch((error) => {
    const normalized = normalizeRouterError(error);
    writeChatCompletionChunk(response, {
      error: routerErrorResponseBody(normalized),
    });
    response.write('data: [DONE]\n\n');
    response.end();
  });
}

function writeChatCompletionChunk(response: ServerResponse, payload: JsonObject): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
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
        ...routerErrorResponseBody(routerError),
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
  const stopSequence = typeof message.stop_sequence === 'string' ? message.stop_sequence : null;
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
      stop_sequence: stopSequence,
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

function roleAliasForCall(role: ProviderCallRecord['role']) {
  return role === 'textReasoner' ? 'textReasoner' : 'translators.vision';
}

function providerBindingHash(provider: ModelRouterProviderConfig) {
  return hashForTrace([
    provider.baseUrl,
    provider.model,
    provider.apiKeyEnv,
    JSON.stringify(provider.compatibility ?? {}),
  ].join('\n'));
}

function scientificTranslatorBindingHash(service: ModelRouterScientificTranslatorConfig) {
  return hashForTrace([
    service.baseUrl,
    service.tokenEnv,
    service.timeoutMs ?? '',
  ].join('\n'));
}

function providerCallTraceFields(
  provider: ModelRouterProviderConfig,
  body: ResponsesRequest,
  protocol: UpstreamWireProtocol,
  url: string,
): Pick<ProviderCallRecord, 'modelAliasSha256' | 'wireRequest'> {
  const modelAliasSha256 = hashForTrace(stringField(body.model) || provider.model || '');
  return {
    modelAliasSha256,
    wireRequest: {
      urlSha256: hashForTrace(url),
      endpointRoute: protocol,
      bodyShape: {
        modelAliasSha256,
        messageCount: Array.isArray(body.input) ? body.input.length : body.input === undefined ? 0 : 1,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
        hasImageParts: hasImageParts(body.input),
        textCharCount: textCharCount(body.input) + textCharCount(body.instructions),
        maxTokensSet: body.max_output_tokens !== undefined || body.max_tokens !== undefined,
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

type RouterError = Error & {
  status: number;
  code: string;
  role?: ModelRouterUpstreamDiagnostic['role'];
  details?: JsonObject;
};

function normalizeRouterError(error: unknown): RouterError {
  if (isRouterError(error)) return error;
  return routerError(500, 'model_router_error', error instanceof Error ? error.message : String(error));
}

function routerError(
  status: number,
  code: string,
  message: string,
  role?: ModelRouterUpstreamDiagnostic['role'],
  details?: JsonObject,
): RouterError {
  const error = new Error(message) as RouterError;
  error.status = status;
  error.code = code;
  if (role) error.role = role;
  if (details) error.details = details;
  return error;
}

function routerErrorResponseBody(error: RouterError): JsonObject {
  return {
    ...(error.details ?? {}),
    code: error.code,
    message: error.message,
  };
}

type StrictVisionEvidenceErrorOptions = {
  causeCode: string;
  status: number;
  failureClass: 'invalid_arguments' | 'capability_unavailable' | 'contract_violation' | 'upstream_unavailable';
  retryable: boolean;
  message: string;
  recovery: {
    action: 'retry_visual_inspection' | 'stop';
    instruction: string;
  };
};

function strictVisionEvidenceError(options: StrictVisionEvidenceErrorOptions): RouterError {
  return routerError(
    options.status,
    'vision_evidence_unavailable',
    options.message,
    'visionTranslator',
    {
      stage: 'vision_translation',
      failureClass: options.failureClass,
      retryable: options.retryable,
      recovery: options.recovery,
      cause: {
        code: options.causeCode,
        status: options.status,
      },
    },
  );
}

function strictVisionEvidenceErrorFromCause(error: unknown): RouterError {
  const classification = classifyStrictVisualCause(error);
  return strictVisionEvidenceError({
    causeCode: classification.code,
    status: classification.status,
    failureClass: classification.failureClass,
    retryable: classification.retryable,
    message: 'Strict visual evidence is unavailable because vision translation failed.',
    recovery: classification.retryable
      ? {
        action: 'retry_visual_inspection',
        instruction: 'Retry the same native visual inspection once after the vision provider becomes available.',
      }
      : {
        action: 'stop',
        instruction: 'Stop this visual path and repair the reported vision translation capability or contract failure.',
      },
  });
}

function strictVisualEvidenceSynthesisErrorFromCause(error: unknown): RouterError {
  const classification = classifyStrictVisualCause(error);
  return routerError(
    classification.status,
    'visual_evidence_synthesis_unavailable',
    'Strict visual evidence synthesis is unavailable because text reasoning failed.',
    'textReasoner',
    {
      stage: 'text_reasoning',
      failureClass: classification.failureClass,
      retryable: classification.retryable,
      recovery: classification.retryable
        ? {
          action: 'retry_visual_inspection',
          instruction: 'Retry the same native visual inspection once after the text reasoner becomes available.',
        }
        : {
          action: 'stop',
          instruction: 'Stop this visual path and repair the reported text reasoning capability or contract failure.',
        },
      cause: {
        code: classification.code,
        status: classification.status,
      },
    },
  );
}

function classifyStrictVisualCause(error: unknown): {
  code: string;
  status: number;
  failureClass: StrictVisionEvidenceErrorOptions['failureClass'];
  retryable: boolean;
} {
  const cause = normalizeRouterError(error);
  const code = cause.code;
  const status = cause.status;
  const isContractFailure = /(?:protocol|invalid_response|error_payload|translation_empty)/u.test(code);
  const isCapabilityFailure = status === 401
    || status === 403
    || /(?:credentials|not_configured|capability_unsupported|mime_not_supported|input_too_large)/u.test(code);
  const retryable = !isContractFailure
    && !isCapabilityFailure
    && (
      status === 408
      || status === 429
      || status >= 500
      || /(?:timeout|network)/u.test(code)
    );
  const failureClass: StrictVisionEvidenceErrorOptions['failureClass'] = isContractFailure
    ? 'contract_violation'
    : isCapabilityFailure
      ? 'capability_unavailable'
      : retryable
        ? 'upstream_unavailable'
        : 'capability_unavailable';
  return { code, status, failureClass, retryable };
}

function isRouterError(error: unknown): error is RouterError {
  return error instanceof Error
    && typeof (error as { status?: unknown }).status === 'number'
    && typeof (error as { code?: unknown }).code === 'string';
}

async function readJson(
  request: IncomingMessage,
  traceSession?: ModelRouterTraceSession,
): Promise<unknown> {
  const body = await readIncomingMessageBody(request, MAX_MODEL_ROUTER_REQUEST_BODY_BYTES);
  if (!body) {
    traceSession?.recordRequestBody('', {});
    return {};
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    traceSession?.recordRequestBody(body, parsed);
    return parsed;
  } catch (error) {
    traceSession?.recordRequestBody(body);
    throw error;
  }
}

async function readMultipartForm(
  request: IncomingMessage,
  traceSession?: ModelRouterTraceSession,
): Promise<FormData> {
  const contentType = stringField(request.headers['content-type']);
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw routerError(400, 'invalid_request', 'Image edit requests must use multipart/form-data.');
  }
  const body = await readIncomingMessageBodyBytes(request, MAX_MODEL_ROUTER_REQUEST_BODY_BYTES);
  traceSession?.recordRequestBody(body);
  try {
    const parsed = new Request('http://127.0.0.1/v1/images/edits', {
      method: 'POST',
      headers: { 'content-type': contentType },
      // Node's Buffer is backed by ArrayBufferLike, while the DOM Request
      // constructor requires an ArrayBuffer-backed BodyInit. Copying here also
      // prevents the parser from retaining the pooled Buffer allocation.
      body: Uint8Array.from(body).buffer,
    });
    return await parsed.formData();
  } catch {
    throw routerError(400, 'invalid_request', 'Image edit multipart body could not be parsed.');
  }
}

function isModelTraceRoute(method: string | undefined, pathname: string): boolean {
  if (method !== 'POST') return false;
  return pathname === '/v1/responses'
    || pathname === '/v1/chat/completions'
    || pathname === '/v1/images/generations'
    || pathname === '/v1/images/edits'
    || pathname === '/v1/messages'
    || pathname === '/api/cc/v1/messages'
    || pathname === '/v1/messages/count_tokens'
    || pathname === '/api/cc/v1/messages/count_tokens';
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
    'access-control-allow-headers': [
      'content-type',
      'authorization',
      'x-api-key',
      'anthropic-version',
      'x-sciforge-model-router-profile',
      MODEL_ROUTER_EVIDENCE_POLICY_HEADER,
    ].join(','),
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
  const normalized = type?.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/_/g, '-');
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
  if (isProtectedScientificFilePath(path)) return 'document';
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
  if (/^(?:provider|upstream)_http_\d{3}$/.test(message)) return message;
  if (/^(?:provider|upstream)_[a-z0-9_]+$/i.test(message)) return message;
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
  return redactUserVisibleText(value, {
    // Product-facing responses should look like one native multimodal model.
    // Keep useful paths and ordinary URLs visible, but never leak the internal
    // provider/model split used for text, vision, science, or image generation.
    sensitiveValues: [...profileTraceRedactionValues(profile, publicModelAlias), ...sensitiveValues],
  });
}

function profileTraceRedactionValues(profile: ModelRouterProfile, publicModelAlias: string) {
  const configuredValues = [
    ...providerTraceRedactionValues(profile.textReasoner),
    ...(profile.imageGenerator ? providerTraceRedactionValues(profile.imageGenerator) : []),
    ...(profile.translators.vision ? providerTraceRedactionValues(profile.translators.vision) : []),
    ...(profile.translators.scientific ? scientificTranslatorTraceRedactionValues(profile.translators.scientific) : []),
  ];
  return configuredValues.filter((value) => value !== publicModelAlias);
}

function providerTraceRedactionValues(provider: ModelRouterProviderConfig) {
  return [
    provider.baseUrl,
    provider.apiKeyEnv,
    provider.model,
  ];
}

function scientificTranslatorTraceRedactionValues(service: ModelRouterScientificTranslatorConfig) {
  return [
    service.baseUrl,
    service.tokenEnv,
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
