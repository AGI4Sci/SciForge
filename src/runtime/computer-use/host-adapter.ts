import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import type { ComputerUseConfig, WindowTarget } from './types.js';
import { windowTargetTraceConfig } from './window-target.js';
import { independentInputAdapterExecutionBoundary } from './independent-input-adapter.js';
import {
  computerUseActionRequestExecutorProvider,
  computerUseCaptureHostPortProvider,
  computerUseExecuteHostPortProvider,
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseTraceHandoffContract,
} from '../../../packages/actions/computer-use/provider-policy.js';

export const COMPUTER_USE_ACTION_PROVIDER_ID = 'action.sciforge.computer-use';
export const COMPUTER_USE_REQUEST_SCHEMA = 'sciforge.computer-use.request.v1';
export const COMPUTER_USE_HOST_PORTS_SCHEMA = computerUseHostPortsContractIds.schemaVersion;
export const COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA = 'sciforge.computer-use.tui-host-actions.v1';

export type ComputerUseActionProviderRequest = {
  schemaVersion: typeof COMPUTER_USE_REQUEST_SCHEMA;
  task: string;
  maxSteps: number;
  riskPolicy: 'fail-closed' | 'allow-confirmed';
  approvalRef?: string;
  providers: {
    action: typeof COMPUTER_USE_ACTION_PROVIDER_ID;
    sense?: string;
    grounder?: string;
    executor: string;
    verifier?: string;
  };
  windowTarget: ReturnType<typeof windowTargetTraceConfig>;
  metadata: Record<string, unknown>;
};

export type ComputerUseTuiHostAction =
  | {
      schemaVersion: typeof COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA;
      port: 'gui.present';
      target: 'computer-use.trace-summary';
      payload: ComputerUsePresentationSummary;
    }
  | {
      schemaVersion: typeof COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA;
      port: 'gui.ask_user';
      target: 'computer-use.approval-request';
      payload: {
        approvalRequest: Record<string, unknown>;
        relatedRefs: string[];
      };
    };

export type ComputerUsePresentationSummary = {
  title: 'Computer Use result';
  status: string;
  message?: string;
  traceRefs: string[];
  screenshotRefs: string[];
  artifactRefs: string[];
  executionUnitRefs: string[];
  workEvidenceRefs: string[];
};

export function gatewayRequestToComputerUseRequest(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): ComputerUseActionProviderRequest {
  const approvalRef = computerUseApprovalRef(request);
  return {
    schemaVersion: COMPUTER_USE_REQUEST_SCHEMA,
    task: request.prompt,
    maxSteps: config.maxSteps,
    riskPolicy: approvalRef ? 'allow-confirmed' : 'fail-closed',
    approvalRef,
    providers: {
      action: COMPUTER_USE_ACTION_PROVIDER_ID,
      sense: computerUseSenseProviderId(request),
      grounder: config.grounder.baseUrl ? computerUseHostPortProviderIds.kvGround : undefined,
      executor: independentInputAdapterExecutionBoundary(config) ?? computerUseActionRequestExecutorProvider(config),
      verifier: computerUseHostPortProviderIds.layeredVerifier,
    },
    windowTarget: windowTargetTraceConfig(config.windowTarget),
    metadata: {
      workspace,
      selectedToolIds: uniqueStrings([
        ...(request.selectedToolIds ?? []),
        ...toStringList(request.uiState?.selectedToolIds),
      ]),
      selectedActionIds: request.selectedActionIds ?? [],
      selectedSenseIds: request.selectedSenseIds ?? [],
      bridge: {
        desktopBridgeEnabled: config.desktopBridgeEnabled,
        dryRun: config.dryRun,
        allowSharedSystemInput: Boolean(config.allowSharedSystemInput),
        inputAdapter: config.inputAdapter,
        independentInputAdapterProvider: config.independentInputAdapterProvider,
      },
    },
  };
}

export function computerUseHostPortsContract(config: ComputerUseConfig) {
  return {
    schemaVersion: COMPUTER_USE_HOST_PORTS_SCHEMA,
    owner: 'src/runtime host adapter',
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    ports: {
      capture: {
        provider: capturePortProvider(config.windowTarget),
        returns: 'Observation with screenshot/file refs',
      },
      crop: {
        provider: computerUseHostPortProviderIds.focusRegionCrop,
        returns: 'Observation with focus-region file refs',
        optional: true,
      },
      execute: {
        provider: independentInputAdapterExecutionBoundary(config) ?? computerUseExecuteHostPortProvider(config),
        inputAdapter: config.inputAdapter ?? (config.allowSharedSystemInput ? 'shared-system-input-acknowledged' : 'not-configured'),
        independentInputAdapterProvider: config.independentInputAdapterProvider,
        sharedSystemInputExplicitlyAllowed: Boolean(config.allowSharedSystemInput),
      },
      writeTrace: {
        provider: computerUseHostPortProviderIds.writeTrace,
        storagePolicy: computerUseTraceHandoffContract.storagePolicy,
      },
      emitEvent: {
        provider: computerUseHostPortProviderIds.emitEvent,
      },
    },
    forbiddenPorts: [...computerUseHostPortLists.forbidden],
    guiBoundary: 'TUI Host may call gui.present/gui.ask_user after receiving refs-first result or approvalRequest; Computer Use package must not call GUI directly.',
  };
}

export function computerUseResultToTuiHostActions(result: unknown): ComputerUseTuiHostAction[] {
  if (!isRecord(result)) return [];
  const summary = computerUsePresentationSummary(result);
  const approvalRequest = approvalRequestFromResult(result);
  const relatedRefs = summary ? summaryRefs(summary) : refsFromRecord(result);
  const actions: ComputerUseTuiHostAction[] = [];
  if (summary) {
    actions.push({
      schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
      port: 'gui.present',
      target: computerUseTraceHandoffContract.presentationTarget,
      payload: summary,
    });
  }
  if (approvalRequest) {
    actions.push({
      schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
      port: 'gui.ask_user',
      target: computerUseTraceHandoffContract.approvalTarget,
      payload: {
        approvalRequest,
        relatedRefs,
      },
    });
  }
  return actions;
}

function computerUseSenseProviderId(request: GatewayRequest) {
  const selected = uniqueStrings([
    ...(request.selectedSenseIds ?? []),
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]);
  if (selected.includes('local.vision-sense')) return 'local.vision-sense';
  return selected.find((id) => id.includes('vision') || id.includes('sense'));
}

function computerUseApprovalRef(request: GatewayRequest) {
  return stringAt(request.humanApproval, 'approvalRef')
    ?? stringAt(request.humanApproval, 'decisionRef')
    ?? stringAt(request.humanApproval, 'ref')
    ?? stringAt(request.humanApprovalPolicy, 'approvalRef')
    ?? stringAt(request.uiState, 'computerUseApprovalRef')
    ?? stringAt(request.uiState, 'approvalRef');
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function capturePortProvider(target: WindowTarget) {
  return computerUseCaptureHostPortProvider(target);
}

function computerUsePresentationSummary(result: Record<string, unknown>): ComputerUsePresentationSummary | undefined {
  const traceRefs = uniqueStrings([
    ...refsFromRecord(result, traceRefKey),
    ...traceRefsFromArtifacts(result.artifacts),
    ...traceRefsFromExecutionUnits(result.executionUnits),
    ...traceRefsFromWorkEvidence(result.workEvidence),
  ]);
  const screenshotRefs = uniqueStrings([
    ...refsFromRecord(result, screenshotRefKey),
    ...screenshotRefsFromArtifacts(result.artifacts),
    ...screenshotRefsFromExecutionUnits(result.executionUnits),
  ]);
  const artifactRefs = uniqueStrings([
    ...refsFromRecord(result, artifactRefKey),
    ...artifactRefsFromArtifacts(result.artifacts),
    ...artifactRefsFromExecutionUnits(result.executionUnits),
    ...artifactRefsFromWorkEvidence(result.workEvidence),
  ]);
  const executionUnitRefs = uniqueStrings(recordIds(result.executionUnits));
  const workEvidenceRefs = uniqueStrings(recordIds(result.workEvidence));
  const status = stringAt(result, 'status') ?? firstExecutionUnitStatus(result.executionUnits);
  const message = stringAt(result, 'message');
  const hasRefs = traceRefs.length > 0 || screenshotRefs.length > 0 || artifactRefs.length > 0 || executionUnitRefs.length > 0 || workEvidenceRefs.length > 0;
  if (!hasRefs && !status && !message) return undefined;
  return {
    title: 'Computer Use result',
    status: status ?? 'unknown',
    message,
    traceRefs,
    screenshotRefs,
    artifactRefs,
    executionUnitRefs,
    workEvidenceRefs,
  };
}

function approvalRequestFromResult(result: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = recordAt(result, 'approvalRequest') ?? recordAt(result, 'approval_request');
  if (direct) return direct;
  const refs = recordAt(result, 'refs');
  return refs ? recordAt(refs, 'approvalRequest') ?? recordAt(refs, 'approval_request') : undefined;
}

function summaryRefs(summary: ComputerUsePresentationSummary) {
  return uniqueStrings([
    ...summary.traceRefs,
    ...summary.screenshotRefs,
    ...summary.artifactRefs,
    ...summary.executionUnitRefs,
    ...summary.workEvidenceRefs,
  ]);
}

function refsFromRecord(record: Record<string, unknown>, predicate: (key: string, value?: string) => boolean = () => true): string[] {
  const refs: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && predicate(key, value) && looksLikeRef(value)) refs.push(value);
    if (Array.isArray(value) && predicate(key)) refs.push(...toStringList(value).filter(looksLikeRef));
  }
  return refs;
}

function traceRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => {
    const refs = [
      stringAt(record, 'path'),
      stringAt(record, 'dataRef'),
      stringAt(record, 'rawRef'),
      stringAt(record, 'outputRef'),
    ].filter((ref): ref is string => Boolean(ref) && traceRefKey('', ref));
    const metadata = recordAt(record, 'metadata');
    return metadata ? [...refs, ...refsFromRecord(metadata, traceRefKey)] : refs;
  });
}

function screenshotRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => {
    const metadata = recordAt(record, 'metadata');
    const screenshotRefs = metadata && Array.isArray(metadata.screenshotRefs)
      ? recordList(metadata.screenshotRefs).flatMap((ref) => refsFromRecord(ref, screenshotRefKey))
      : [];
    return [
      ...refsFromRecord(record, screenshotRefKey),
      ...screenshotRefs,
    ];
  });
}

function artifactRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => [
    stringAt(record, 'id'),
    stringAt(record, 'path'),
    stringAt(record, 'dataRef'),
  ].filter((ref): ref is string => typeof ref === 'string' && looksLikeRef(ref)));
}

function traceRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, traceRefKey));
}

function screenshotRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, screenshotRefKey));
}

function artifactRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => [
    ...refsFromRecord(record, artifactRefKey),
    ...toStringList(record.outputArtifacts).filter(looksLikeRef),
    ...toStringList(record.artifacts).filter(looksLikeRef),
  ]);
}

function traceRefsFromWorkEvidence(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, traceRefKey));
}

function artifactRefsFromWorkEvidence(value: unknown) {
  return recordList(value).flatMap((record) => [
    ...refsFromRecord(record, artifactRefKey),
    ...toStringList(record.evidenceRefs).filter(looksLikeRef),
  ]);
}

function recordIds(value: unknown) {
  return recordList(value)
    .map((record) => stringAt(record, 'id'))
    .filter((id): id is string => typeof id === 'string' && looksLikeRef(id));
}

function firstExecutionUnitStatus(value: unknown) {
  const first = recordList(value)[0];
  return first ? stringAt(first, 'status') : undefined;
}

function recordAt(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function traceRefKey(key: string, value?: string) {
  return /trace/i.test(key) || (value ? /trace/i.test(value) : false);
}

function screenshotRefKey(key: string, value?: string) {
  return /screenshot|image|capture/i.test(key) || (value ? /\.(png|jpe?g|webp)$/i.test(value) : false);
}

function artifactRefKey(key: string) {
  return /artifact|output|evidence|rawRef|dataRef|ref$/i.test(key);
}

function looksLikeRef(value: string) {
  return /^(artifact|file|workEvidence|budgetDebit|audit|approval|ref):/.test(value)
    || value.startsWith('EU-')
    || value.startsWith('.sciforge/')
    || value.startsWith('/')
    || /\.(json|png|jpe?g|webp)$/i.test(value);
}
