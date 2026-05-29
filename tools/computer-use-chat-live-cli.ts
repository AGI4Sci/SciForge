import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type ComputerUseChatLiveCliExpectedStatus =
  | 'completed'
  | 'confirmed-approval-retry'
  | 'needs-confirmation'
  | 'repair-needed'
  | 'blocked';

export interface ComputerUseChatLiveCliArgs {
  out?: string;
  prompt?: string;
  workspace?: string;
  workspaceWriterBaseUrl?: string;
  timeoutMs?: number;
  taskId?: string;
  scenarioId?: string;
  completionEvidenceProducerIds: string[];
  expect: ComputerUseChatLiveCliExpectedStatus;
  firstExpect: ComputerUseChatLiveCliExpectedStatus;
  secondExpect: ComputerUseChatLiveCliExpectedStatus;
  continuation: boolean;
  approvalRetry: boolean;
  strict: boolean;
  json: boolean;
  needsConfirmation: boolean;
}

export interface ComputerUseChatLiveCliManifestSummary {
  status: string;
  issues: string[];
  requestSubmitted: boolean;
  approvalRequestRefs?: string[];
  riskAuditRefs?: string[];
  deniedExecutionProof?: {
    kind?: string;
  };
  approvalRetry?: {
    approvalRef?: string;
    reusedSourceRefs: string[];
  };
  secondTurn?: {
    requestSubmitted: boolean;
  };
}

export function parseComputerUseChatLiveCliArgs(args: string[]): ComputerUseChatLiveCliArgs {
  const parsed: ComputerUseChatLiveCliArgs = {
    expect: 'completed',
    firstExpect: 'repair-needed',
    secondExpect: 'repair-needed',
    continuation: false,
    approvalRetry: false,
    strict: false,
    json: false,
    needsConfirmation: false,
    completionEvidenceProducerIds: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--strict') parsed.strict = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--continuation') parsed.continuation = true;
    else if (arg === '--approval-retry' || arg === '--confirmed-approval-retry') {
      parsed.approvalRetry = true;
      parsed.expect = 'confirmed-approval-retry';
    }
    else if (arg === '--needs-confirmation' || arg === '--high-risk') {
      parsed.needsConfirmation = true;
      parsed.expect = 'needs-confirmation';
    }
    else if (arg === '--out') parsed.out = readArgValue(args, index += 1, arg);
    else if (arg === '--prompt') parsed.prompt = readArgValue(args, index += 1, arg);
    else if (arg === '--workspace') parsed.workspace = readArgValue(args, index += 1, arg);
    else if (arg === '--workspace-writer-base-url') parsed.workspaceWriterBaseUrl = readArgValue(args, index += 1, arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = parsePositiveInteger(readArgValue(args, index += 1, arg), arg);
    else if (arg === '--task-id') parsed.taskId = readArgValue(args, index += 1, arg);
    else if (arg === '--scenario-id') parsed.scenarioId = readArgValue(args, index += 1, arg);
    else if (arg === '--completion-evidence-producer') parsed.completionEvidenceProducerIds.push(readArgValue(args, index += 1, arg));
    else if (arg === '--expect') parsed.expect = parseExpectedStatus(readArgValue(args, index += 1, arg));
    else if (arg === '--first-expect') parsed.firstExpect = parseExpectedStatus(readArgValue(args, index += 1, arg));
    else if (arg === '--second-expect') parsed.secondExpect = parseExpectedStatus(readArgValue(args, index += 1, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

export async function writeComputerUseChatLiveCliManifest(path: string, manifest: unknown) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputPath;
}

export function printComputerUseChatLiveCliSummary(input: {
  args: ComputerUseChatLiveCliArgs;
  expectedStatus: ComputerUseChatLiveCliExpectedStatus;
  manifest: ComputerUseChatLiveCliManifestSummary;
  outputPath?: string;
  write?: (chunk: string) => void;
}) {
  const write = input.write ?? ((chunk: string) => process.stdout.write(chunk));
  if (input.args.json) {
    write(`${JSON.stringify(input.manifest, null, 2)}\n`);
    return;
  }
  const expected = input.args.approvalRetry
    ? 'needs-confirmation,confirmed-approval-retry'
    : input.args.continuation
      ? `first=${input.args.firstExpect},second=${input.args.secondExpect}`
      : input.expectedStatus;
  write(`[${input.manifest.status}] Computer Use chat live E2E; expected=${expected}; issues=${input.manifest.issues.length}; submitted=${input.manifest.requestSubmitted}\n`);
  if (input.outputPath) write(`  manifest: ${input.outputPath}\n`);
  if (!input.args.continuation && input.expectedStatus === 'needs-confirmation') {
    write(`  approvalRequestRefs: ${input.manifest.approvalRequestRefs?.length ?? 0}; riskAuditRefs: ${input.manifest.riskAuditRefs?.length ?? 0}; deniedProof=${input.manifest.deniedExecutionProof?.kind ?? 'missing'}\n`);
  }
  if (input.args.approvalRetry) {
    write(`  approvalRef: ${input.manifest.approvalRetry?.approvalRef ?? 'missing'}; sourceRefs=${input.manifest.approvalRetry?.reusedSourceRefs.length ?? 0}; secondSubmitted=${Boolean(input.manifest.secondTurn?.requestSubmitted)}\n`);
  }
  for (const issue of input.manifest.issues) write(`  - ${issue}\n`);
}

export function computerUseChatLiveCliStrictPassed(input: {
  args: ComputerUseChatLiveCliArgs;
  expectedStatus: ComputerUseChatLiveCliExpectedStatus;
  manifest: ComputerUseChatLiveCliManifestSummary;
}) {
  if (input.args.approvalRetry || input.args.continuation) return input.manifest.status === 'passed';
  return input.manifest.status === input.expectedStatus;
}

function parseExpectedStatus(value: string): ComputerUseChatLiveCliExpectedStatus {
  if (value === 'completed' || value === 'confirmed-approval-retry' || value === 'needs-confirmation' || value === 'repair-needed' || value === 'blocked') return value;
  throw new Error(`Unsupported --expect value: ${value}`);
}

function readArgValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer.`);
  return parsed;
}
