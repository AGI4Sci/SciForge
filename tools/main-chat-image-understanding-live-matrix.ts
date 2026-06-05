#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  mainChatImageUnderstandingLiveMatrixCases,
  requiredMainChatImageUnderstandingCategories,
  type MainChatImageUnderstandingCategory,
  type MainChatImageUnderstandingLiveMatrixCase,
} from './main-chat-image-understanding-live-matrix-cases.js';
import {
  auditModelRouterTraceBundle,
  type ModelRouterTraceAuditReport,
} from '../packages/workers/model-router/src/trace-audit.js';

export const MAIN_CHAT_IMAGE_UNDERSTANDING_LIVE_MATRIX_SCHEMA_VERSION =
  'sciforge.model-router.main-chat-image-understanding-live-matrix.v1' as const;

export type MainChatImageUnderstandingLiveMatrixResult = {
  caseId: string;
  status: 'passed' | 'blocked';
  answerText?: string;
  traceRef?: string;
  publicModelAlias?: string;
  routerProfile?: string;
  degraded?: boolean;
  issues?: string[];
};

export type MainChatImageUnderstandingTraceAuditInput = {
  status: 'pass' | 'fail' | 'missing';
  schemaVersion?: string;
  reportRef?: string;
  traceRootSha256?: string;
  scannedFileRefs?: string[];
  scannedFiles?: number;
  scannedBytes?: number;
  findings?: unknown[];
  policy?: {
    knownSecretsChecked?: number;
    forbidsRawProviderPayload?: boolean;
    forbidsRawPrivateUrls?: boolean;
    forbidsLocalAbsolutePaths?: boolean;
    forbidsInlineImageData?: boolean;
  };
  materialBindingIssues?: string[];
  materialBindingSource?: 'trace-root-scan';
};

export type MainChatImageUnderstandingLiveMatrixManifest = {
  schemaVersion: typeof MAIN_CHAT_IMAGE_UNDERSTANDING_LIVE_MATRIX_SCHEMA_VERSION;
  checkedAt: string;
  status: 'passed' | 'blocked';
  releaseAcceptance: 'opt-in-only';
  evidenceMode: 'live-model-router-main-chat-image-understanding';
  coverage: {
    requiredCategories: readonly MainChatImageUnderstandingCategory[];
    presentCategories: MainChatImageUnderstandingCategory[];
    missingCategories: MainChatImageUnderstandingCategory[];
    everyRequiredCategoryPresent: boolean;
    requiredCaseIds: string[];
    passedCaseIds: string[];
    missingCaseIds: string[];
    allCasesPassed: boolean;
  };
  traceAudit?: {
    status: MainChatImageUnderstandingTraceAuditInput['status'];
    reportRef?: string;
    scannedFiles?: number;
  };
  cases: Array<{
    id: string;
    category: MainChatImageUnderstandingCategory;
    title: string;
    materialRef: string;
    materialSha256: string;
    materialDimensions: { width: number; height: number };
    status: 'passed' | 'blocked' | 'missing';
    traceRef?: string;
    publicModelAlias?: string;
    routerProfile?: string;
    degraded?: boolean;
    answerTextSha256?: string;
    answerTextLength?: number;
    answerRubric?: {
      matchedConcepts: number;
      requiredConcepts: number;
    };
    issues: string[];
  }>;
  issues: string[];
};

export type BuildMainChatImageUnderstandingLiveMatrixManifestInput = {
  checkedAt?: string;
  results?: MainChatImageUnderstandingLiveMatrixResult[];
  traceAudit?: MainChatImageUnderstandingTraceAuditInput;
  materialIssues?: string[];
  requiredKnownSecretsChecked?: number;
};

type CliArgs = {
  routerUrl?: string;
  traceRoot?: string;
  traceAuditOutPath?: string;
  traceAuditReport?: string;
  traceAuditStatus?: MainChatImageUnderstandingTraceAuditInput['status'];
  knownSecretEnv: string[];
  outPath?: string;
  strict: boolean;
  json: boolean;
};

const forbiddenRefPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|api[_-]?key|secret|token|credential|password|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;
const wrappedLocalAbsoluteRefPattern =
  /(?:^|[:\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;

export function buildMainChatImageUnderstandingLiveMatrixManifest(
  input: BuildMainChatImageUnderstandingLiveMatrixManifestInput = {},
): MainChatImageUnderstandingLiveMatrixManifest {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const materialIssues = safeIssueLabels(input.materialIssues ?? []);
  const resultsByCase = new Map((input.results ?? []).map((result) => [result.caseId, result]));
  const cases = mainChatImageUnderstandingLiveMatrixCases.map((matrixCase) => {
    const result = resultsByCase.get(matrixCase.id);
    const resultIssues = safeIssueLabels(result?.issues ?? []);
    const issues = [
      ...resultIssues,
      ...caseEvidenceIssues(matrixCase, result),
      ...forbiddenRefIssues(matrixCase.id, result),
    ];
    const status: 'passed' | 'blocked' | 'missing' = result
      ? result.status === 'passed' && issues.length === 0
        ? 'passed'
        : 'blocked'
      : 'missing';
    return {
      id: matrixCase.id,
      category: matrixCase.category,
      title: matrixCase.title,
      materialRef: matrixCase.material.ref,
      materialSha256: matrixCase.material.sha256,
      materialDimensions: {
        width: matrixCase.material.width,
        height: matrixCase.material.height,
      },
      status,
      traceRef: safeOptionalRef(result?.traceRef),
      publicModelAlias: safeOptionalLabel(result?.publicModelAlias),
      routerProfile: safeOptionalLabel(result?.routerProfile),
      degraded: result?.degraded,
      answerTextSha256: result?.answerText ? `sha256:${sha256Hex(result.answerText)}` : undefined,
      answerTextLength: result?.answerText ? result.answerText.length : undefined,
      answerRubric: result?.answerText ? publicAnswerRubric(matrixCase, result.answerText) : undefined,
      issues,
    };
  });
  const passedCaseIds = cases.filter((item) => item.status === 'passed').map((item) => item.id);
  const missingCaseIds = cases.filter((item) => item.status !== 'passed').map((item) => item.id);
  const presentCategories = [...new Set(cases
    .filter((item) => item.status === 'passed')
    .map((item) => item.category))].sort();
  const missingCategories = requiredMainChatImageUnderstandingCategories
    .filter((category) => !presentCategories.includes(category))
    .sort();
  const traceAuditIssues = traceAuditIssuesFor(
    input.traceAudit,
    input.results ?? [],
    input.requiredKnownSecretsChecked ?? 0,
  );
  const issues = [
    ...materialIssues,
    ...missingCaseIds.map((id) => `missing-case:${id}`),
    ...missingCategories.map((category) => `missing-category:${category}`),
    ...cases.flatMap((item) => item.issues.map((issue) => `${item.id}:${issue}`)),
    ...traceAuditIssues,
  ];
  return {
    schemaVersion: MAIN_CHAT_IMAGE_UNDERSTANDING_LIVE_MATRIX_SCHEMA_VERSION,
    checkedAt,
    status: issues.length === 0 ? 'passed' : 'blocked',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'live-model-router-main-chat-image-understanding',
    coverage: {
      requiredCategories: requiredMainChatImageUnderstandingCategories,
      presentCategories,
      missingCategories,
      everyRequiredCategoryPresent: missingCategories.length === 0,
      requiredCaseIds: mainChatImageUnderstandingLiveMatrixCases.map((item) => item.id),
      passedCaseIds,
      missingCaseIds,
      allCasesPassed: missingCaseIds.length === 0,
    },
    traceAudit: publicTraceAudit(input.traceAudit),
    cases,
    issues,
  };
}

async function runLiveMatrix(args: CliArgs) {
  const optIn = process.env.SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX === '1';
  const routerUrl = args.routerUrl ?? process.env.SCIFORGE_MODEL_ROUTER_URL ?? process.env.SCIFORGE_MODEL_ROUTER_BASE_URL;
  const materialIssues = await validateMainChatImageUnderstandingLiveMatrixMaterials();
  const liveCollectionStartedAtMs = Date.now() - 1000;
  const routerPublicContractIssues = optIn && routerUrl
    ? await routerPublicContractIssuesFor(routerUrl)
    : [];
  const results = optIn && routerUrl && materialIssues.length === 0
    ? await collectLiveResults(routerUrl)
    : [];
  const traceAudit = optIn
    ? await traceAuditFromCliArgs(args, results, liveCollectionStartedAtMs)
    : undefined;
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    results,
    traceAudit,
    materialIssues: [...materialIssues, ...routerPublicContractIssues],
    requiredKnownSecretsChecked: args.knownSecretEnv.length,
  });
  const finalManifest = optIn
    ? routerUrl
      ? manifest
      : {
          ...manifest,
          issues: ['router-url-required', ...manifest.issues],
        }
    : {
        ...manifest,
        issues: ['live-opt-in-required', ...manifest.issues],
      };
  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
  }
  if (args.json) process.stdout.write(`${JSON.stringify(finalManifest, null, 2)}\n`);
  else process.stdout.write(`[${finalManifest.status}] Main chat image understanding live matrix; cases=${finalManifest.cases.length}; issues=${finalManifest.issues.length}\n`);
  if (args.strict && finalManifest.status !== 'passed') process.exitCode = 1;
}

export async function validateMainChatImageUnderstandingLiveMatrixMaterials(
  cases: readonly MainChatImageUnderstandingLiveMatrixCase[] = mainChatImageUnderstandingLiveMatrixCases,
): Promise<string[]> {
  const issues: string[] = [];
  await Promise.all(cases.map(async (matrixCase) => {
    const caseId = safeCaseId(matrixCase.id);
    try {
      const bytes = await readFile(matrixCase.material.ref);
      const dimensions = pngDimensions(bytes);
      if (!dimensions) {
        issues.push(`material-not-png:${caseId}`);
        return;
      }
      if (dimensions.width !== matrixCase.material.width || dimensions.height !== matrixCase.material.height) {
        issues.push(`material-dimensions-mismatch:${caseId}`);
      }
      const digest = `sha256:${sha256Hex(bytes)}`;
      if (digest !== matrixCase.material.sha256) {
        issues.push(`material-sha256-mismatch:${caseId}`);
      }
    } catch {
      issues.push(`material-missing:${caseId}`);
    }
  }));
  return issues.sort();
}

function pngDimensions(bytes: Buffer) {
  const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24) return undefined;
  for (let index = 0; index < pngHeader.length; index += 1) {
    if (bytes[index] !== pngHeader[index]) return undefined;
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function collectLiveResults(routerUrl: string): Promise<MainChatImageUnderstandingLiveMatrixResult[]> {
  const endpoint = `${routerUrl.replace(/\/+$/, '')}/v1/responses`;
  const results: MainChatImageUnderstandingLiveMatrixResult[] = [];
  for (const item of mainChatImageUnderstandingLiveMatrixCases) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS || 'sciforge-router',
          metadata: { profile: process.env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE || 'sciforge-runtime-default' },
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: item.prompts[0] },
              { type: 'input_image', ref: item.material.ref },
            ],
          }],
        }),
      });
      const body = await response.json() as Record<string, unknown>;
      const metadata = isRecord(body.metadata) ? body.metadata : {};
      results.push({
        caseId: item.id,
        status: response.ok ? 'passed' : 'blocked',
        answerText: typeof body.output_text === 'string' ? body.output_text : undefined,
        traceRef: typeof metadata.traceRef === 'string' ? metadata.traceRef : undefined,
        publicModelAlias: typeof body.model === 'string' ? body.model : undefined,
        routerProfile: process.env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE || 'sciforge-runtime-default',
        degraded: metadata.degraded === true || body.degraded === true,
        issues: response.ok ? [] : [`http-status:${response.status}`],
      });
    } catch (error) {
      results.push({
        caseId: item.id,
        status: 'blocked',
        issues: [`request-error:${error instanceof Error ? error.name : 'unknown'}`],
      });
    }
  }
  return results;
}

async function routerPublicContractIssuesFor(routerUrl: string) {
  try {
    const [manifest, models] = await Promise.all([
      fetchJson(new URL('/manifest', routerUrl).toString()),
      fetchJson(new URL('/v1/models', routerUrl).toString()),
    ]);
    if (!modelRouterManifestLooksPublic(manifest)) return ['router-public-contract-fail'];
    if (!modelRouterModelsContainAlias(models, process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS || 'sciforge-router')) {
      return ['router-public-contract-fail'];
    }
    if (isForbiddenPublicRef(JSON.stringify(manifest)) || isForbiddenPublicRef(JSON.stringify(models))) {
      return ['router-public-contract-fail'];
    }
    return [];
  } catch {
    return ['router-public-contract-fail'];
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`public endpoint failed: ${response.status}`);
  return await response.json() as unknown;
}

function modelRouterManifestLooksPublic(value: unknown) {
  if (!isRecord(value)) return false;
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const hasResponsesInvokePath = value.invokePath === '/v1/responses'
    || providers.some((provider) => isRecord(provider) && provider.invokePath === '/v1/responses');
  return hasResponsesInvokePath
    && capabilities.includes('vision_translation')
    && capabilities.includes('refs_first_trace');
}

function modelRouterModelsContainAlias(value: unknown, alias: string) {
  if (!isRecord(value)) return false;
  const data = Array.isArray(value.data) ? value.data : [];
  return data.some((item) => isRecord(item) && item.id === alias);
}

async function traceAuditFromCliArgs(
  args: CliArgs,
  results: MainChatImageUnderstandingLiveMatrixResult[],
  minTraceMtimeMs: number,
): Promise<MainChatImageUnderstandingTraceAuditInput> {
  if (args.traceRoot) {
    return traceAuditFromTraceRoot(args, results, minTraceMtimeMs);
  }
  const reportPath = args.traceAuditReport ?? process.env.SCIFORGE_MODEL_ROUTER_TRACE_AUDIT_REPORT;
  if (reportPath) {
    return traceAuditFromReport(reportPath);
  }
  return { status: args.traceAuditStatus ?? envTraceAuditStatus() ?? 'missing' };
}

async function traceAuditFromTraceRoot(
  args: CliArgs,
  results: MainChatImageUnderstandingLiveMatrixResult[],
  minTraceMtimeMs: number,
): Promise<MainChatImageUnderstandingTraceAuditInput> {
  try {
    const knownSecretEnv = secretsFromEnv(args.knownSecretEnv);
    const traceRoot = args.traceRoot ?? '.sciforge/model-router-traces';
    const report = await auditModelRouterTraceBundle({
      traceRoot,
      outPath: args.traceAuditOutPath,
      knownSecrets: knownSecretEnv.knownSecrets,
      missingKnownSecretEnvNames: knownSecretEnv.missingKnownSecretEnvNames,
      requireNonEmpty: true,
    });
    return {
      ...traceAuditFromAuditReport(report, args.traceAuditOutPath),
      materialBindingIssues: await traceMaterialBindingIssues(traceRoot, results, minTraceMtimeMs),
      materialBindingSource: 'trace-root-scan',
    };
  } catch {
    return {
      status: 'fail',
      reportRef: args.traceAuditOutPath
        ? workspaceRelativeRef(args.traceAuditOutPath)
        : 'trace-audit-report:post-run',
    };
  }
}

function traceAuditFromAuditReport(
  report: ModelRouterTraceAuditReport,
  reportPath: string | undefined,
): MainChatImageUnderstandingTraceAuditInput {
  const scannedFileRefs = report.scannedFileRefs.filter((ref) => !isForbiddenPublicRef(ref));
  return {
    status: isValidTraceAuditReport(report, scannedFileRefs) ? 'pass' : 'fail',
    schemaVersion: report.schemaVersion,
    reportRef: reportPath ? workspaceRelativeRef(reportPath) : 'trace-audit-report:post-run',
    traceRootSha256: report.traceRootSha256,
    scannedFileRefs,
    scannedFiles: report.scannedFiles,
    scannedBytes: report.scannedBytes,
    findings: report.findings,
    policy: report.policy,
  };
}

async function traceMaterialBindingIssues(
  traceRoot: string,
  results: MainChatImageUnderstandingLiveMatrixResult[],
  minTraceMtimeMs: number,
) {
  const issues: string[] = [];
  const casesById = new Map(mainChatImageUnderstandingLiveMatrixCases.map((item) => [item.id, item]));
  await Promise.all(results
    .filter((result) => result.status === 'passed')
    .map(async (result) => {
      const matrixCase = casesById.get(result.caseId);
      const traceBundleRef = traceBundleRefFromTraceRef(result.traceRef);
      if (!matrixCase || !traceBundleRef) {
        issues.push(`trace-audit-material-mismatch:${safeCaseId(result.caseId)}`);
        return;
      }
      try {
        const tracePath = join(resolve(traceRoot), traceBundleRef, 'trace.json');
        const traceStats = await stat(tracePath);
        if (traceStats.mtimeMs < minTraceMtimeMs) {
          issues.push(`trace-audit-stale-trace:${matrixCase.id}`);
          return;
        }
        const traceText = await readFile(tracePath, 'utf8');
        const parsed = JSON.parse(traceText) as unknown;
        if (!traceContainsMaterial(parsed, matrixCase.material.ref)) {
          issues.push(`trace-audit-material-mismatch:${matrixCase.id}`);
        }
        issues.push(...traceIdentityIssues(parsed, matrixCase.id));
        issues.push(...traceMaterialScopeIssues(parsed, matrixCase));
        issues.push(...traceRequiredRoutingCallIssues(parsed, matrixCase.id));
      } catch {
        issues.push(`trace-audit-material-missing:${matrixCase.id}`);
      }
    }));
  return issues.sort();
}

function traceBundleRefFromTraceRef(traceRef: string | undefined) {
  if (!traceRef || isForbiddenPublicRef(traceRef)) return undefined;
  const normalized = traceRef
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^\.?\/?sciforge\/model-router-traces\//, '')
    .replace(/^\.sciforge\/model-router-traces\//, '')
    .replace(/\/+$/, '')
    .replace(/\/trace\.json$/i, '')
    .replace(/\.json$/i, '');
  const traceBundle = traceBundleSuffix(normalized);
  return isSafeRelativeTraceRef(traceBundle)
    ? traceBundle
    : undefined;
}

function traceBundleSuffix(ref: string) {
  const suffix = ref.match(/(?:^|\/)(\d{4}-\d{2}-\d{2}\/[^/]+)$/);
  return suffix?.[1] ?? ref;
}

function traceContainsMaterial(value: unknown, materialRef: string) {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 'sciforge.model-router.trace.v1') return false;
  const modalityRefs = Array.isArray(value.modalityRefs) ? value.modalityRefs : [];
  return modalityRefs.some((item) => modalityRefMatchesMaterial(item, materialRef));
}

function modalityRefMatchesMaterial(value: unknown, materialRef: string) {
  if (!isRecord(value)) return false;
  if (value.kind !== 'vision.image') return false;
  const source = stringValue(value.source);
  const ref = stringValue(value.ref) ?? stringValue(value.safeRef) ?? stringValue(value.fileRef);
  const sha256 = stringValue(value.sha256) ?? stringValue(value.materialSha256);
  return source === 'ref' && ref === materialRef && sha256 === `sha256:${sha256Hex(materialRef)}`;
}

function traceMaterialScopeIssues(value: unknown, matrixCase: MainChatImageUnderstandingLiveMatrixCase) {
  if (!isRecord(value) || value.schemaVersion !== 'sciforge.model-router.trace.v1') return [];
  const modalityRefs = Array.isArray(value.modalityRefs) ? value.modalityRefs : [];
  const refInputCount = modalityRefs.filter((item) => {
    if (!isRecord(item)) return false;
    return item.kind === 'vision.image' && stringValue(item.source) === 'ref';
  }).length;
  return refInputCount === 1 ? [] : [`trace-audit-material-scope:${matrixCase.id}`];
}

function traceIdentityIssues(value: unknown, caseId: string) {
  if (!isRecord(value)) return [`trace-audit-router-identity-missing:${caseId}`];
  const expected = expectedRouterIdentity();
  const issues: string[] = [];
  if (stringValue(value.profileId) !== expected.routerProfile) {
    issues.push(`trace-audit-router-profile-mismatch:${caseId}`);
  }
  if (stringValue(value.publicModelAlias) !== expected.publicModelAlias) {
    issues.push(`trace-audit-router-public-model-alias-mismatch:${caseId}`);
  }
  return issues;
}

function traceRequiredRoutingCallIssues(value: unknown, caseId: string) {
  if (!isRecord(value)) return [`trace-audit-required-role-missing:${caseId}`];
  const calls = Array.isArray(value.calls) ? value.calls : [];
  const hasVisionTranslator = calls.some((item) => traceCallHasOkRole(item, 'visionTranslator'));
  const hasTextReasoner = calls.some((item) => traceCallHasOkRole(item, 'textReasoner'));
  const issues: string[] = [];
  if (!hasVisionTranslator) issues.push(`trace-audit-required-role-missing:${caseId}:visionTranslator`);
  if (!hasTextReasoner) issues.push(`trace-audit-required-role-missing:${caseId}:textReasoner`);
  return issues;
}

function traceCallHasOkRole(value: unknown, role: string) {
  if (!isRecord(value)) return false;
  const callRole = stringValue(value.role) ?? stringValue(value.roleAlias);
  return callRole === role && value.status === 'ok';
}

async function traceAuditFromReport(reportPath: string): Promise<MainChatImageUnderstandingTraceAuditInput> {
  try {
    const text = await readFile(reportPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    const scannedFileRefs = isRecord(parsed) ? stringArray(parsed.scannedFileRefs).filter((ref) => !isForbiddenPublicRef(ref)) : [];
    const scannedFiles = isRecord(parsed) && typeof parsed.scannedFiles === 'number' ? parsed.scannedFiles : undefined;
    const scannedBytes = isRecord(parsed) && typeof parsed.scannedBytes === 'number' ? parsed.scannedBytes : undefined;
    const status = isValidTraceAuditReport(parsed, scannedFileRefs) ? 'pass' : 'fail';
    const policy = isRecord(parsed) && isRecord(parsed.policy)
      ? {
          knownSecretsChecked: typeof parsed.policy.knownSecretsChecked === 'number'
            ? parsed.policy.knownSecretsChecked
            : undefined,
          forbidsRawProviderPayload: parsed.policy.forbidsRawProviderPayload === true,
          forbidsRawPrivateUrls: parsed.policy.forbidsRawPrivateUrls === true,
          forbidsLocalAbsolutePaths: parsed.policy.forbidsLocalAbsolutePaths === true,
          forbidsInlineImageData: parsed.policy.forbidsInlineImageData === true,
        }
      : undefined;
    return {
      status,
      schemaVersion: isRecord(parsed) ? stringValue(parsed.schemaVersion) : undefined,
      reportRef: workspaceRelativeRef(reportPath),
      traceRootSha256: isRecord(parsed) ? stringValue(parsed.traceRootSha256) : undefined,
      scannedFileRefs,
      scannedFiles,
      scannedBytes,
      findings: isRecord(parsed) && Array.isArray(parsed.findings) ? parsed.findings : undefined,
      policy,
    };
  } catch {
    return {
      status: 'missing',
      reportRef: workspaceRelativeRef(reportPath),
    };
  }
}

function isValidTraceAuditReport(parsed: unknown, scannedFileRefs: string[]) {
  if (!isRecord(parsed)) return false;
  if (parsed.schemaVersion !== 'sciforge.model-router.trace-audit.v1') return false;
  if (parsed.status !== 'pass') return false;
  if (typeof parsed.traceRootSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(parsed.traceRootSha256)) return false;
  if (typeof parsed.scannedFiles !== 'number' || parsed.scannedFiles <= 0) return false;
  if (typeof parsed.scannedBytes !== 'number' || parsed.scannedBytes <= 0) return false;
  const rawScannedFileRefs = stringArray(parsed.scannedFileRefs);
  if (rawScannedFileRefs.length !== scannedFileRefs.length) return false;
  if (parsed.scannedFiles !== scannedFileRefs.length) return false;
  if (new Set(scannedFileRefs).size !== scannedFileRefs.length) return false;
  if (scannedFileRefs.length === 0) return false;
  if (!Array.isArray(parsed.findings) || parsed.findings.length !== 0) return false;
  const policy = isRecord(parsed.policy) ? parsed.policy : {};
  return Number.isInteger(policy.knownSecretsChecked)
    && Number(policy.knownSecretsChecked) > 0
    && policy.forbidsRawProviderPayload === true
    && policy.forbidsRawPrivateUrls === true
    && policy.forbidsLocalAbsolutePaths === true
    && policy.forbidsInlineImageData === true;
}

function envTraceAuditStatus(): MainChatImageUnderstandingTraceAuditInput['status'] | undefined {
  const value = process.env.SCIFORGE_MODEL_ROUTER_TRACE_AUDIT_STATUS;
  return value === 'pass' || value === 'fail' || value === 'missing' ? value : undefined;
}

function secretsFromEnv(explicitNames: string[]) {
  const names = explicitNames.length > 0
    ? explicitNames
    : Object.keys(process.env).filter((name) => /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)/i.test(name));
  const knownSecrets: string[] = [];
  const missingKnownSecretEnvNames: string[] = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 6) knownSecrets.push(value);
    else if (explicitNames.length > 0) missingKnownSecretEnvNames.push(name);
  }
  return { knownSecrets, missingKnownSecretEnvNames };
}

function workspaceRelativeRef(path: string) {
  const absolutePath = resolve(path);
  const relativePath = relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  return relativePath && !relativePath.startsWith('..') && !relativePath.startsWith('/')
    ? relativePath
    : `trace-audit-report:${sha256Hex(absolutePath).slice(0, 16)}`;
}

function caseEvidenceIssues(
  matrixCase: MainChatImageUnderstandingLiveMatrixCase,
  result: MainChatImageUnderstandingLiveMatrixResult | undefined,
) {
  if (!result) return [`missing-result:${matrixCase.id}`];
  const issues: string[] = [];
  if (!result.answerText?.trim()) issues.push('missing-answer-text');
  if (!result.traceRef?.trim()) issues.push('missing-trace-ref');
  if (!result.publicModelAlias?.trim()) issues.push('missing-public-model-alias');
  if (!result.routerProfile?.trim()) issues.push('missing-router-profile');
  if (result.degraded === true) issues.push('router-degraded');
  issues.push(...responseIdentityIssues(result));
  issues.push(...visualAccessRefusalIssues(result.answerText));
  issues.push(...answerRubricIssues(matrixCase, result.answerText));
  return issues;
}

function responseIdentityIssues(result: MainChatImageUnderstandingLiveMatrixResult) {
  const expected = expectedRouterIdentity();
  const issues: string[] = [];
  if (result.publicModelAlias?.trim() && result.publicModelAlias !== expected.publicModelAlias) {
    issues.push('router-public-model-alias-mismatch');
  }
  if (result.routerProfile?.trim() && result.routerProfile !== expected.routerProfile) {
    issues.push('router-profile-mismatch');
  }
  return issues;
}

function expectedRouterIdentity() {
  return {
    publicModelAlias: process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS || 'sciforge-router',
    routerProfile: process.env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE || 'sciforge-runtime-default',
  };
}

function answerRubricIssues(
  matrixCase: MainChatImageUnderstandingLiveMatrixCase,
  answerText: string | undefined,
) {
  const normalized = normalizeAnswerText(answerText ?? '');
  const issues: string[] = [];
  if (normalized.length < matrixCase.answerRubric.minAnswerTextLength) {
    issues.push('answer-rubric-too-short');
  }
  for (const concept of matrixCase.answerRubric.requiredConcepts) {
    if (!concept.anyOf.some((term) => normalized.includes(normalizeAnswerText(term)))) {
      issues.push(`answer-rubric-missing:${safeCaseId(concept.id)}`);
    }
  }
  return issues;
}

function publicAnswerRubric(
  matrixCase: MainChatImageUnderstandingLiveMatrixCase,
  answerText: string,
) {
  const normalized = normalizeAnswerText(answerText);
  const matchedConcepts = matrixCase.answerRubric.requiredConcepts
    .filter((concept) => concept.anyOf.some((term) => normalized.includes(normalizeAnswerText(term))))
    .length;
  return {
    matchedConcepts,
    requiredConcepts: matrixCase.answerRubric.requiredConcepts.length,
  };
}

function normalizeAnswerText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

const visualAccessRefusalPatterns = [
  /\b(?:image|screenshot|visual|figure)\b.{0,80}\b(?:could not|cannot|can't|unable to|not able to)\b.{0,80}\b(?:inspect(?:ed)?|view|see|access|render|rendered|open)\b/i,
  /\b(?:could not|cannot|can't|unable to|not able to)\b.{0,80}\b(?:inspect(?:ed)?|view|see|access|render|rendered|open)\b.{0,80}\b(?:image|screenshot|visual|figure|file path)\b/i,
  /\b(?:image|screenshot|visual|figure)\b.{0,80}\b(?:not rendered|not visible|not provided|not available|not accessible)\b/i,
  /\bno\s+(?:image|screenshot|visual|figure)\b.{0,80}\b(?:visible|rendered|provided|available|accessible)\b/i,
  /\bno\s+visual\s+access\b/i,
];

function visualAccessRefusalIssues(answerText: string | undefined) {
  const normalized = normalizeAnswerText(answerText ?? '');
  return visualAccessRefusalPatterns.some((pattern) => pattern.test(normalized))
    ? ['answer-visual-access-refusal']
    : [];
}

function forbiddenRefIssues(caseId: string, result: MainChatImageUnderstandingLiveMatrixResult | undefined) {
  if (!result) return [];
  const publicFields = [
    result.traceRef,
    result.publicModelAlias,
    result.routerProfile,
    ...(result.issues ?? []),
  ].filter((value): value is string => Boolean(value));
  return publicFields.some(isForbiddenPublicRef)
    ? [`forbidden-raw-payload:${caseId}`]
    : [];
}

function traceAuditIssuesFor(
  traceAudit: MainChatImageUnderstandingTraceAuditInput | undefined,
  results: MainChatImageUnderstandingLiveMatrixResult[],
  requiredKnownSecretsChecked: number,
) {
  if (!traceAudit) return ['trace-audit-missing'];
  if (traceAudit.status !== 'pass') return [`trace-audit-${traceAudit.status}`];
  const issues: string[] = [];
  if (!isValidTraceAuditInput(traceAudit)) issues.push('trace-audit-fail');
  if (!traceAudit.reportRef?.trim()) issues.push('trace-audit-report-ref-missing');
  else if (isForbiddenPublicRef(traceAudit.reportRef)) issues.push('trace-audit-report-ref-forbidden');
  if (!Number.isInteger(traceAudit.scannedFiles) || (traceAudit.scannedFiles ?? 0) <= 0) {
    issues.push('trace-audit-scanned-files-missing');
  }
  if ((traceAudit.policy?.knownSecretsChecked ?? 0) < requiredKnownSecretsChecked) {
    issues.push('trace-audit-known-corpus-checked-too-low');
  }
  const scannedFileRefs = traceAudit.scannedFileRefs ?? [];
  if (scannedFileRefs.length === 0) issues.push('trace-audit-scanned-file-refs-missing');
  issues.push(...duplicateTraceRefIssues(results));
  const missingTraceBindings = results
    .filter((result) => result.status === 'passed')
    .filter((result) => !traceRefCoveredByAudit(result.traceRef, scannedFileRefs))
    .map((result) => `trace-audit-missing-trace:${result.caseId}`);
  issues.push(...missingTraceBindings);
  if (results.some((result) => result.status === 'passed') && traceAudit.materialBindingIssues === undefined) {
    issues.push('trace-audit-material-binding-missing');
  }
  if (
    results.some((result) => result.status === 'passed')
    && traceAudit.materialBindingIssues !== undefined
    && traceAudit.materialBindingSource !== 'trace-root-scan'
  ) {
    issues.push('trace-audit-material-binding-proof-missing');
  }
  if (traceAudit.materialBindingIssues?.length) issues.push(...safeIssueLabels(traceAudit.materialBindingIssues));
  return issues;
}

function duplicateTraceRefIssues(results: MainChatImageUnderstandingLiveMatrixResult[]) {
  const seen = new Map<string, string>();
  const issues: string[] = [];
  for (const result of results.filter((item) => item.status === 'passed')) {
    const traceRef = traceJsonFileRefFromTraceRef(result.traceRef);
    if (!traceRef) continue;
    const firstCaseId = seen.get(traceRef);
    if (firstCaseId) {
      issues.push(`trace-audit-duplicate-trace-ref:${safeCaseId(firstCaseId)}`);
      issues.push(`trace-audit-duplicate-trace-ref:${safeCaseId(result.caseId)}`);
    } else {
      seen.set(traceRef, result.caseId);
    }
  }
  return [...new Set(issues)].sort();
}

function isValidTraceAuditInput(traceAudit: MainChatImageUnderstandingTraceAuditInput) {
  return isValidTraceAuditReport(traceAudit, traceAudit.scannedFileRefs ?? []);
}

function publicTraceAudit(traceAudit: MainChatImageUnderstandingTraceAuditInput | undefined) {
  if (!traceAudit) return undefined;
  return {
    status: traceAudit.status,
    reportRef: traceAudit.reportRef && !isForbiddenPublicRef(traceAudit.reportRef)
      ? traceAudit.reportRef
      : undefined,
    scannedFiles: traceAudit.scannedFiles,
  };
}

function traceRefCoveredByAudit(traceRef: string | undefined, scannedFileRefs: string[]) {
  const target = traceJsonFileRefFromTraceRef(traceRef);
  if (!target) return false;
  return scannedFileRefs.some((fileRef) => normalizeScannedTraceFileRef(fileRef) === target);
}

function traceJsonFileRefFromTraceRef(traceRef: string | undefined) {
  const bundle = traceBundleRefFromTraceRef(traceRef);
  return bundle ? `${bundle}/trace.json` : undefined;
}

function normalizeScannedTraceFileRef(fileRef: string) {
  if (isForbiddenPublicRef(fileRef)) return undefined;
  const normalized = fileRef
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
  if (!normalized.toLowerCase().endsWith('/trace.json')) return undefined;
  const bundle = traceBundleRefFromTraceRef(normalized);
  return bundle ? `${bundle}/trace.json` : undefined;
}

function isSafeRelativeTraceRef(ref: string) {
  if (!ref || ref.startsWith('/') || ref.includes(':')) return false;
  return ref.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function safeOptionalRef(value: string | undefined) {
  if (!value || isForbiddenPublicRef(value)) return undefined;
  return value;
}

function safeOptionalLabel(value: string | undefined) {
  if (!value || isForbiddenPublicRef(value)) return undefined;
  return value;
}

function safeIssueLabels(values: string[]) {
  return values.map((value) => {
    if (!value || isForbiddenPublicRef(value)) return `issue:${sha256Hex(value ?? '').slice(0, 16)}`;
    return value;
  });
}

function safeCaseId(value: string) {
  return /^[a-z0-9-]+$/.test(value)
    ? value
    : `case:${sha256Hex(value).slice(0, 12)}`;
}

function isForbiddenPublicRef(value: string) {
  return forbiddenRefPattern.test(value) || wrappedLocalAbsoluteRefPattern.test(value);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false, knownSecretEnv: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--router-url') {
      parsed.routerUrl = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-root') {
      parsed.traceRoot = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-audit-out') {
      parsed.traceAuditOutPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-audit-report') {
      parsed.traceAuditReport = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--known-secret-env') {
      parsed.knownSecretEnv.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === '--trace-audit-status') {
      const status = requiredValue(argv, index, arg);
      if (status !== 'pass' && status !== 'fail' && status !== 'missing') {
        throw new Error('--trace-audit-status must be pass, fail, or missing');
      }
      parsed.traceAuditStatus = status;
      index += 1;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else {
      throw new Error(`Unknown main chat image matrix argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

if (process.argv[1]?.endsWith('main-chat-image-understanding-live-matrix.ts')) {
  await runLiveMatrix(parseArgs(process.argv.slice(2)));
}
