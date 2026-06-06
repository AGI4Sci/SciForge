import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const visionSenseToolIds = ['local.vision-sense'];

export const visionSenseEnvKeys = [
  'SCIFORGE_VISION_DESKTOP_BRIDGE',
  'SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN',
  'SCIFORGE_VISION_RUN_ID',
  'SCIFORGE_VISION_CAPTURE_DISPLAYS',
  'SCIFORGE_VISION_TEST_ACTION_FIXTURES',
  'SCIFORGE_VISION_TEST_ACTIONS_JSON',
  'SCIFORGE_VISION_MAX_STEPS',
  'SCIFORGE_VISION_DESKTOP_PLATFORM',
] as const;

type VisionSenseEnvKey = typeof visionSenseEnvKeys[number];
type GatewayInput = Parameters<typeof runWorkspaceRuntimeGateway>[0];
type GatewayResult = Awaited<ReturnType<typeof runWorkspaceRuntimeGateway>>;

export function saveVisionSenseEnv(): Record<VisionSenseEnvKey, string | undefined> {
  return Object.fromEntries(visionSenseEnvKeys.map((key) => [key, process.env[key]])) as Record<VisionSenseEnvKey, string | undefined>;
}

export function restoreVisionSenseEnv(saved: Record<VisionSenseEnvKey, string | undefined>) {
  for (const key of visionSenseEnvKeys) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function createVisionWorkspace(slug: string) {
  return mkdtemp(join(tmpdir(), `sciforge-vision-${slug}-`));
}

export async function runVisionSenseGateway(input: Omit<GatewayInput, 'selectedToolIds' | 'uiState'> & { uiState?: GatewayInput['uiState'] }) {
  const dryRunApproval = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN === '1'
    ? {
        approved: true,
        ref: 'approval:vision-sense-dry-run-smoke',
        by: 'smoke-test',
      }
    : undefined;
  const inputUiState = typeof input.uiState === 'object' && input.uiState !== null
    ? input.uiState as Record<string, unknown>
    : undefined;
  const uiState = inputUiState
    ? { ...inputUiState, humanApproval: inputUiState.humanApproval ?? dryRunApproval, selectedToolIds: visionSenseToolIds }
    : { humanApproval: dryRunApproval, selectedToolIds: visionSenseToolIds };
  const uiStateRecord = uiState as Record<string, unknown>;
  const visionSenseConfig = typeof uiStateRecord.visionSenseConfig === 'object' && uiStateRecord.visionSenseConfig !== null
    ? uiStateRecord.visionSenseConfig as Record<string, unknown>
    : {};
  if (process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON && visionSenseConfig.testActionFixtureMode === undefined) {
    uiStateRecord.visionSenseConfig = {
      ...visionSenseConfig,
      testActionFixtureMode: true,
    };
  }
  return runWorkspaceRuntimeGateway({
    ...input,
    selectedToolIds: visionSenseToolIds,
    uiState,
  });
}

export function findVisionTraceArtifact(result: GatewayResult) {
  const artifact = result.artifacts.find((candidate) => candidate.id === 'vision-sense-trace');
  assert.ok(artifact);
  return artifact;
}

export async function readVisionTrace(workspacePath: string, result: GatewayResult) {
  const artifact = findVisionTraceArtifact(result);
  return {
    artifact,
    text: await readFile(join(workspacePath, String(artifact.path)), 'utf8'),
  };
}

export async function readVisionTraceJson(workspacePath: string, result: GatewayResult) {
  const { artifact, text } = await readVisionTrace(workspacePath, result);
  return {
    artifact,
    trace: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}
