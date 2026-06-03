import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES = [
  'native-presented-surface',
  'webrtc',
  'webcodecs',
  'mjpeg-png-delta',
] as const;

export type VirtualAppScreenStreamTransportCandidate =
  typeof REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES[number];

export type VirtualAppScreenStreamTransportCheck =
  | 'section-present'
  | 'candidate-coverage'
  | 'platform-neutral-evaluation'
  | 'refs-first-live-path'
  | 'fail-closed-live-path'
  | 'mjpeg-png-delta-fallback';

export interface VirtualAppScreenStreamTransportContractSummary {
  status: 'passed' | 'failed';
  docPath: string;
  checks: VirtualAppScreenStreamTransportCheck[];
  candidates: VirtualAppScreenStreamTransportCandidate[];
  issues: string[];
}

const DEFAULT_DOC_PATH = 'docs/VirtualAppScreenArchitecture.md';
const SECTION_HEADING = '## Surface Transport';

export async function runVirtualAppScreenStreamTransportContract(
  docPath = DEFAULT_DOC_PATH,
): Promise<VirtualAppScreenStreamTransportContractSummary> {
  const checks: VirtualAppScreenStreamTransportCheck[] = [];
  const issues: string[] = [];
  const resolvedDocPath = resolve(docPath);
  const docText = await readFile(resolvedDocPath, 'utf8');
  const sectionText = extractSection(docText, SECTION_HEADING);

  if (!sectionText) {
    issues.push(`Missing ${SECTION_HEADING} section`);
    return buildSummary(resolvedDocPath, checks, issues);
  }
  checks.push('section-present');

  runCheck(
    'candidate-coverage',
    sectionText,
    REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES,
    checks,
    issues,
  );
  runCheck(
    'platform-neutral-evaluation',
    sectionText,
    [
      '平台中立',
      '不把选择硬编码到 macOS/Linux/Windows',
      'shell/provider/runtime capability refs',
    ],
    checks,
    issues,
  );
  runCheck(
    'refs-first-live-path',
    sectionText,
    [
      'refs-first',
      'liveSurfaceRef',
      'frameStreamRef',
      'transportTelemetryRef',
      'single interactive truth',
    ],
    checks,
    issues,
  );
  runCheck(
    'fail-closed-live-path',
    sectionText,
    [
      'fail-closed',
      'blocked/handoff/retry',
      'fallbackRequired=true',
    ],
    checks,
    issues,
  );
  runCheck(
    'mjpeg-png-delta-fallback',
    sectionText,
    [
      'mjpeg-png-delta',
      'diagnostic/fallback only',
      '不能作为 user-level live pass',
    ],
    checks,
    issues,
  );

  return buildSummary(resolvedDocPath, checks, issues);
}

function buildSummary(
  docPath: string,
  checks: VirtualAppScreenStreamTransportCheck[],
  issues: string[],
): VirtualAppScreenStreamTransportContractSummary {
  return {
    status: issues.length ? 'failed' : 'passed',
    docPath,
    checks,
    candidates: [...REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES],
    issues,
  };
}

function runCheck(
  checkName: VirtualAppScreenStreamTransportCheck,
  sectionText: string,
  requiredTokens: readonly string[],
  checks: VirtualAppScreenStreamTransportCheck[],
  issues: string[],
): void {
  const missingTokens = requiredTokens.filter((token) => !sectionText.includes(token));
  if (missingTokens.length) {
    issues.push(`${checkName}: missing ${missingTokens.join(', ')}`);
    return;
  }
  checks.push(checkName);
}

function extractSection(docText: string, headingPrefix: string): string | null {
  const headingIndex = docText.indexOf(headingPrefix);
  if (headingIndex < 0) return null;
  const nextHeadingIndex = docText.indexOf('\n## ', headingIndex + headingPrefix.length);
  if (nextHeadingIndex < 0) return docText.slice(headingIndex);
  return docText.slice(headingIndex, nextHeadingIndex);
}

async function main(): Promise<void> {
  const summary = await runVirtualAppScreenStreamTransportContract();
  if (summary.status !== 'passed') {
    console.error(
      `[failed] VirtualAppScreen stream transport contract doc=${summary.docPath} issues=${summary.issues.join('; ')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[passed] VirtualAppScreen stream transport contract candidates=${summary.candidates.join(',')} checks=${summary.checks.join(',')}`,
  );
}

const isCli = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isCli) {
  await main();
}
