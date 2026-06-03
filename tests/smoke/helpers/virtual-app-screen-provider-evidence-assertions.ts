import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

type NativeHostLedgerLike = {
  entries: Array<{
    refs?: Record<string, unknown>;
  }>;
};

type NativeHostRecordLike = {
  sessionId: string;
  host: {
    getLedger(sessionId: string): NativeHostLedgerLike | undefined;
  };
};

const noPhysicalDesktopEffectFields = [
  'affectsPhysicalDisplay',
  'sharedSystemInputUsed',
  'systemPointerMoved',
  'systemKeyboardEventsSent',
] as const;

export async function assertProviderInputVerificationFiles(input: {
  outDir: string;
  record: NativeHostRecordLike;
  slug: string;
}): Promise<void> {
  const providerRefs = providerRefsFor(input.record);
  const verificationRef = requiredProviderRef(
    providerRefs,
    `/verification/${input.slug}.json`,
    `provider verification ${input.slug}`,
  );
  const verification = await readProviderJson(input.outDir, verificationRef, `provider verification ${input.slug}`);
  assertNoPhysicalDesktopEffects(verification, `provider verification ${input.slug}`);
  assertOptionalTrue(verification, 'displayScoped', `provider verification ${input.slug}`);
  assertOptionalTrue(verification, 'currentRunOnly', `provider verification ${input.slug}`);

  const isolationRef = requiredProviderRef(
    providerRefs,
    `/control-plane/${input.slug}/isolation-evidence.json`,
    `provider isolation evidence ${input.slug}`,
  );
  const physicalDesktopProbeRef = requiredProviderRef(
    providerRefs,
    `/control-plane/${input.slug}/physical-desktop-probe.json`,
    `provider physical desktop probe ${input.slug}`,
  );
  const isolation = await readProviderJson(input.outDir, isolationRef, `provider isolation evidence ${input.slug}`);
  const physicalDesktopProbe = await readProviderJson(input.outDir, physicalDesktopProbeRef, `provider physical desktop probe ${input.slug}`);
  for (const [label, evidence] of [
    [`provider isolation evidence ${input.slug}`, isolation],
    [`provider physical desktop probe ${input.slug}`, physicalDesktopProbe],
  ] as const) {
    assertNoPhysicalDesktopEffects(evidence, label);
    assertOptionalTrue(evidence, 'displayScoped', label);
    assertOptionalTrue(evidence, 'currentRunOnly', label);
  }
}

function providerRefsFor(record: NativeHostRecordLike): string[] {
  const ledger = record.host.getLedger(record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  return [...new Set(ledger.entries.flatMap((entry) => stringsFromRecord(entry.refs)))];
}

function stringsFromRecord(record: Record<string, unknown> | undefined): string[] {
  if (!record) return [];
  return Object.values(record).flatMap((value) => {
    if (typeof value === 'string' && value.trim()) return [value];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
    }
    return [];
  });
}

function requiredProviderRef(providerRefs: string[], suffix: string, label: string): string {
  const ref = providerRefs.find((candidate) => candidate.endsWith(suffix));
  assert.ok(ref, `Native Host ledger must reference ${label}.`);
  assert.match(ref, /^\.sciforge\/vision-runs\/[^/]+\/virtual-display-provider\//u, `${label} must be provider-owned and run-scoped.`);
  return ref;
}

async function readProviderJson(outDir: string, ref: string, label: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(localPathForProviderRef(outDir, ref), 'utf8'));
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function localPathForProviderRef(outDir: string, ref: string): string {
  const match = ref.match(/^(\.sciforge\/vision-runs\/[^/]+)\//u);
  assert.ok(match, `provider evidence ref must be run-scoped: ${ref}`);
  return join(outDir, relative(match[1] as string, ref));
}

function assertNoPhysicalDesktopEffects(record: Record<string, unknown>, label: string): void {
  for (const field of noPhysicalDesktopEffectFields) {
    assert.equal(record[field], false, `${label}.${field} must be false.`);
  }
}

function assertOptionalTrue(record: Record<string, unknown>, field: string, label: string): void {
  if (Object.prototype.hasOwnProperty.call(record, field)) {
    assert.equal(record[field], true, `${label}.${field} must be true when present.`);
  }
}
