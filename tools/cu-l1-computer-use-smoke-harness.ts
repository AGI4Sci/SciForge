import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CU_L1_SMOKE_SCHEMA_VERSION = 'sciforge.computer-use.l1-smoke-manifest.v1' as const;
export const CU_L1_LOW_RISK_TARGET_REF = 'tools/cu-l1-computer-use-smoke-harness/low-risk-target.html' as const;

export type ShortcutEvidenceKind =
  | 'real-computer-use'
  | 'tui-host-runTask'
  | 'desktop-bridge-ack'
  | 'shared-input-ack'
  | 'dom'
  | 'playwright'
  | 'accessibility'
  | 'synthetic-fixture';

export interface ComputerUseEvidenceClaim {
  id: string;
  kind: ShortcutEvidenceKind;
  ref?: string;
  note?: string;
}

export interface HostChainLink {
  id: string;
  kind: 'tui-host-runTask' | 'desktop-bridge-ack' | 'shared-input-ack' | 'missing';
  status: 'present' | 'missing' | 'blocked';
  requestRef?: string;
  hostPortsRef?: string;
  acknowledgementRef?: string;
  note?: string;
}

export interface CuL1SmokeHarnessInput {
  runId: string;
  createdAt: string;
  hostChain: HostChainLink[];
  evidenceClaims?: ComputerUseEvidenceClaim[];
  screenshotRefs?: {
    before: string[];
    after: string[];
  };
  traceRefs?: string[];
  verifierVerdict?: {
    status: 'passed' | 'failed' | 'blocked' | 'not-run';
    verdict: 'capability-smoke-passed' | 'result-text-visible' | 'blocked-no-real-host-chain' | 'not-run';
    reason: string;
    resultTextRef?: string;
    finalScreenshotRef?: string;
  };
}

export interface CuL1SmokeManifest {
  schemaVersion: typeof CU_L1_SMOKE_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  status: 'blocked' | 'ready-for-real-executor' | 'capability-smoke-passed';
  target: {
    id: 'cu-l1-low-risk-local-web-target';
    risk: 'low';
    surface: 'local-web-fixture';
    ref: typeof CU_L1_LOW_RISK_TARGET_REF;
    requiredControls: {
      input: '#cu-smoke-input';
      button: '#cu-smoke-button';
      resultText: '#cu-smoke-result';
    };
  };
  antiShortcutGuard: {
    status: 'passed' | 'failed';
    rejectedKinds: Array<'dom' | 'playwright' | 'accessibility'>;
    rejectedClaims: ComputerUseEvidenceClaim[];
    rule: string;
  };
  screenshotRefs: {
    before: string[];
    after: string[];
  };
  traceRefs: string[];
  groundingMetadata: {
    required: true;
    coordinateSpace: 'window-local';
    targetSource: 'screenshot-grounded';
    forbiddenSources: Array<'dom-query' | 'playwright-locator' | 'accessibility-tree'>;
    notes: string[];
  };
  executorLease: {
    required: true;
    status: 'missing' | 'pending-real-executor' | 'present';
    ref?: string;
    owner?: string;
  };
  verifierVerdict: {
    status: 'blocked' | 'not-run' | 'passed' | 'failed';
    verdict: 'blocked-no-real-host-chain' | 'not-run' | 'capability-smoke-passed' | 'result-text-visible';
    reason: string;
    resultTextRef?: string;
    finalScreenshotRef?: string;
  };
  hostChain: HostChainLink[];
  blockedItems: Array<{
    id: string;
    status: 'blocked';
    reason: string;
  }>;
  nonSubstitutes: string[];
}

const rejectedShortcutKinds = new Set<ShortcutEvidenceKind>(['dom', 'playwright', 'accessibility']);

export function evaluateAntiShortcutGuard(evidenceClaims: ComputerUseEvidenceClaim[] = []): CuL1SmokeManifest['antiShortcutGuard'] {
  const rejectedClaims = evidenceClaims.filter((claim) => rejectedShortcutKinds.has(claim.kind));
  return {
    status: rejectedClaims.length === 0 ? 'passed' : 'failed',
    rejectedKinds: ['dom', 'playwright', 'accessibility'],
    rejectedClaims,
    rule:
      'Computer Use L1 success evidence must come from screenshot-grounded GUI execution, not DOM reads, Playwright locators, or accessibility-tree shortcuts.',
  };
}

export function hasAcceptedComputerUseHostChain(hostChain: HostChainLink[]): boolean {
  const hasRunTask = hostChain.some((link) => {
    if (link.status !== 'present') {
      return false;
    }
    if (link.kind === 'tui-host-runTask') {
      return Boolean(link.requestRef && link.hostPortsRef);
    }
    return false;
  });
  const hasInputAcknowledgement = hostChain.some((link) => (
    link.status === 'present'
    && (link.kind === 'desktop-bridge-ack' || link.kind === 'shared-input-ack')
    && Boolean(link.acknowledgementRef)
  ));
  return hasRunTask && hasInputAcknowledgement;
}

export function buildCuL1SmokeManifest(input: CuL1SmokeHarnessInput): CuL1SmokeManifest {
  const antiShortcutGuard = evaluateAntiShortcutGuard(input.evidenceClaims);
  const hostChainReady = hasAcceptedComputerUseHostChain(input.hostChain);
  const screenshotRefs = input.screenshotRefs ?? { before: [], after: [] };
  const traceRefs = input.traceRefs ?? [];
  const hasRealComputerUseEvidence = Boolean(input.evidenceClaims?.some((claim) => claim.kind === 'real-computer-use'));
  const hasBeforeAfterScreenshots = screenshotRefs.before.length > 0 && screenshotRefs.after.length > 0;
  const hasTraceRefs = traceRefs.length > 0;
  const verifierPassed = input.verifierVerdict?.status === 'passed'
    && (input.verifierVerdict.verdict === 'capability-smoke-passed' || input.verifierVerdict.verdict === 'result-text-visible');
  const smokePassed = antiShortcutGuard.status === 'passed'
    && hostChainReady
    && hasRealComputerUseEvidence
    && hasBeforeAfterScreenshots
    && hasTraceRefs
    && verifierPassed;
  const readyForRealExecutor = !smokePassed && antiShortcutGuard.status === 'passed' && hostChainReady;

  const missingHostChainReason =
    'No real TUI Host -> computer_use.runTask(request, hostPorts) chain or desktop bridge/shared input acknowledgement was provided.';

  return {
    schemaVersion: CU_L1_SMOKE_SCHEMA_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    status: smokePassed ? 'capability-smoke-passed' : readyForRealExecutor ? 'ready-for-real-executor' : 'blocked',
    target: {
      id: 'cu-l1-low-risk-local-web-target',
      risk: 'low',
      surface: 'local-web-fixture',
      ref: CU_L1_LOW_RISK_TARGET_REF,
      requiredControls: {
        input: '#cu-smoke-input',
        button: '#cu-smoke-button',
        resultText: '#cu-smoke-result',
      },
    },
    antiShortcutGuard,
    screenshotRefs,
    traceRefs,
    groundingMetadata: {
      required: true,
      coordinateSpace: 'window-local',
      targetSource: 'screenshot-grounded',
      forbiddenSources: ['dom-query', 'playwright-locator', 'accessibility-tree'],
      notes: [
        'Before and after screenshots are refs only; inline base64/image payloads are not accepted.',
        'Grounding must describe visible target coordinates derived from screenshots.',
      ],
    },
    executorLease: {
      required: true,
      status: smokePassed ? 'present' : hostChainReady ? 'pending-real-executor' : 'missing',
    },
    verifierVerdict: smokePassed
      ? {
          status: 'passed',
          verdict: 'capability-smoke-passed',
          reason: input.verifierVerdict?.reason ?? 'Visible result text was verified from screenshot-grounded Computer Use evidence.',
          resultTextRef: input.verifierVerdict?.resultTextRef,
          finalScreenshotRef: input.verifierVerdict?.finalScreenshotRef,
        }
      : {
          status: readyForRealExecutor ? 'not-run' : 'blocked',
          verdict: readyForRealExecutor ? 'not-run' : 'blocked-no-real-host-chain',
          reason: readyForRealExecutor
            ? 'Real executor chain is present, but this disposable harness has not run and verified L1 input.'
            : missingHostChainReason,
        },
    hostChain: input.hostChain,
    blockedItems: smokePassed || readyForRealExecutor
      ? []
      : [
          {
            id: 'CU-04-L1-real-input-smoke',
            status: 'blocked',
            reason:
              antiShortcutGuard.status === 'failed'
                ? 'Shortcut evidence was offered as Computer Use success evidence.'
                : missingHostChainReason,
          },
        ],
    nonSubstitutes: [
      'DOM state reads',
      'Playwright click/fill/locator assertions',
      'accessibility tree actions or assertions',
      'dry-run traces without real host acknowledgement',
      'fixture-only result text changes',
    ],
  };
}

export async function writeCuL1SmokeManifest(outPath: string, input?: Partial<CuL1SmokeHarnessInput>): Promise<CuL1SmokeManifest> {
  const manifest = buildCuL1SmokeManifest({
    runId: input?.runId ?? `cu-l1-smoke-${Date.now()}`,
    createdAt: input?.createdAt ?? new Date().toISOString(),
    hostChain: input?.hostChain ?? [
      {
        id: 'host-chain-missing',
        kind: 'missing',
        status: 'blocked',
        note: 'No TUI Host, hostPorts, desktop bridge acknowledgement, or shared input acknowledgement was supplied.',
      },
    ],
    evidenceClaims: input?.evidenceClaims ?? [],
    screenshotRefs: input?.screenshotRefs,
    traceRefs: input?.traceRefs,
    verifierVerdict: input?.verifierVerdict,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export interface CuL1SmokeCliArgs {
  outPath: string;
  inputPath?: string;
}

export function parseCuL1SmokeCliArgs(argv: string[]): CuL1SmokeCliArgs {
  let outPath: string | undefined;
  let inputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--out requires a manifest output path');
      }
      outPath = value;
      index += 1;
      continue;
    }
    if (arg === '--input-json') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--input-json requires a JSON input path');
      }
      inputPath = value;
      index += 1;
      continue;
    }
    if (!arg.startsWith('--') && !outPath) {
      outPath = arg;
      continue;
    }
    throw new Error(`Unknown CU L1 smoke harness argument: ${arg}`);
  }

  return {
    outPath: outPath ?? join('.sciforge', 'vision-runs', `cu-l1-smoke-${Date.now()}`, 'blocked-manifest.json'),
    inputPath,
  };
}

export async function readCuL1SmokeHarnessInput(inputPath: string): Promise<Partial<CuL1SmokeHarnessInput>> {
  const parsed = JSON.parse(await readFile(inputPath, 'utf8')) as Partial<CuL1SmokeHarnessInput>;
  return parsed;
}

async function main(): Promise<void> {
  const args = parseCuL1SmokeCliArgs(process.argv.slice(2));
  const input = args.inputPath ? await readCuL1SmokeHarnessInput(args.inputPath) : undefined;
  const manifest = await writeCuL1SmokeManifest(args.outPath, input);
  console.log(`[${manifest.status}] wrote ${manifest.schemaVersion} to ${args.outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
