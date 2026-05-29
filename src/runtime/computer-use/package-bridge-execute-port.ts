import { isRecord } from '../gateway-utils.js';
import {
  computerUseActionObservationContextBlockReason,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import { executeGenericDesktopAction, executorBoundary } from './executor.js';
import {
  executeIndependentInputAdapterAction,
  hasExecutableIndependentInputAdapter,
  independentInputAdapterExecutionBoundary,
} from './independent-input-adapter.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, GenericVisionAction, WindowTargetResolution } from './types.js';
import {
  type VirtualRemoteVisibleArtifact,
} from './virtual-remote-session.js';
import {
  inputChannelDescription,
  toTraceWindowTarget,
} from './window-target.js';
import {
  bindWindowTargetFromOpenAppAction,
} from '../vision-sense/computer-use-window-session.js';

type PackageBridgeExecuteState = {
  runDir: string;
  targetResolution: WindowTargetResolution;
  activeAction?: GenericVisionAction;
  executedActions: GenericVisionAction[];
  latestObservation?: Record<string, unknown>;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

type PackagePlanToGenericAction = (
  plan: Record<string, unknown>,
  activeAction?: GenericVisionAction,
  grounding?: Record<string, unknown>,
) => GenericVisionAction;

export async function executePackageBridgePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    state: PackageBridgeExecuteState;
    packagePlanToGenericAction: PackagePlanToGenericAction;
  },
) {
  const { workspace, config, state } = context;
  const action = context.packagePlanToGenericAction(recordArg(call, 0), state.activeAction, recordArg(call, 1));
  const requestArg = recordArg(call, 2);
  state.activeAction = action;
  const observationSummary = stringAt(state.latestObservation, 'summary');
  const visibleTexts = [
    ...stringList(state.latestObservation?.visibleTexts),
    ...stringList(recordAt(state.latestObservation, 'metadata')?.visibleTexts),
  ];
  const contextBlockReason = computerUseActionObservationContextBlockReason({
    actionType: action.type,
    text: action.type === 'type_text' ? action.text : undefined,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    targetAppName: state.targetResolution.ok ? state.targetResolution.appName : undefined,
    targetTitle: state.targetResolution.ok ? state.targetResolution.title : undefined,
    observationSummary,
    visibleTexts,
    visibleTextExtractionEnabled: Boolean(config.visibleTextExtraction?.enabled),
  });
  if (contextBlockReason) {
    return {
      ok: false,
      message: contextBlockReason,
      blocked: true,
      metadata: {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
        exitCode: 125,
        stderr: contextBlockReason,
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      },
    };
  }
  const result = config.dryRun
    ? { exitCode: 0, stdout: 'dry-run package bridge', stderr: '' }
    : hasExecutableIndependentInputAdapter(config)
      ? await executeIndependentInputAdapterAction(action, config, state.targetResolution, {
          workspace,
          runDir: state.runDir,
          stepIndex: state.executedActions.length,
          taskText: computerUseArtifactIntentText(requestArg),
        })
      : await executeGenericDesktopAction(action, config, state.targetResolution);
  state.executedActions.push(action);
  if (result.exitCode === 0 && !hasExecutableIndependentInputAdapter(config)) {
    bindWindowTargetFromOpenAppAction(config, action);
  }
  const rawIndependentAdapterMetadata = (result as { independentInputAdapter?: unknown }).independentInputAdapter;
  const independentAdapterMetadata = isRecord(rawIndependentAdapterMetadata)
    ? rawIndependentAdapterMetadata
    : undefined;
  const virtualArtifacts = recordList(independentAdapterMetadata?.visibleArtifacts).filter(isVirtualRemoteVisibleArtifact);
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, virtualArtifacts);
  const virtualRemoteSessionRef = stringAt(independentAdapterMetadata, 'virtualRemoteSessionRef');
  if (virtualRemoteSessionRef) state.virtualRemoteSessionRef = virtualRemoteSessionRef;
  return {
    ok: result.exitCode === 0,
    message: result.stderr || result.stdout || `exitCode=${result.exitCode}`,
    blocked: result.exitCode !== 0,
    metadata: {
      executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      inputChannel: inputChannelDescription(config, state.targetResolution),
      windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      schedulerLease: isRecord((result as { schedulerLease?: unknown }).schedulerLease) ? (result as { schedulerLease?: unknown }).schedulerLease : undefined,
      independentInputAdapter: independentAdapterMetadata,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: state.visibleArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: state.visibleArtifacts,
    },
  };
}

export function computerUseArtifactIntentText(request: Record<string, unknown>) {
  const metadata = recordAt(request, 'metadata');
  return [
    stringAt(request, 'task'),
    stringAt(request, 'text'),
    metadata ? JSON.stringify(recordAt(metadata, 'plannerAcceptanceContract') ?? {}) : '',
  ].filter((value) => value && value.trim()).join('\n');
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) merged.set(artifact.artifactRef, artifact);
  return [...merged.values()];
}

function isVirtualRemoteVisibleArtifact(record: Record<string, unknown>): record is VirtualRemoteVisibleArtifact {
  return typeof record.artifactRef === 'string'
    && typeof record.dataRef === 'string'
    && typeof record.path === 'string'
    && typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.appId === 'string'
    && record.delivery === 'virtual-remote-session-artifact'
    && Array.isArray(record.visibleTexts)
    && Array.isArray(record.sourceActionIds);
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
