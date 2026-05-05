import { open, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResolvedWindowTarget } from './types.js';
import { sanitizeId, sleep } from './utils.js';

export interface ComputerUseSchedulerLease {
  mode: 'real-gui-executor-lock';
  lockId: string;
  lockPath: string;
  ownerId: string;
  acquiredAt: string;
  releasedAt?: string;
  waitMs: number;
  staleLockReclaimed?: boolean;
}

export async function acquireComputerUseSchedulerLease(params: {
  targetResolution: ResolvedWindowTarget;
  lockId?: string;
  runId?: string;
  stepId?: string;
  timeoutMs?: number;
  staleMs?: number;
}): Promise<{ ok: true; lease: ComputerUseSchedulerLease; release: () => Promise<ComputerUseSchedulerLease> } | { ok: false; reason: string; lockId: string; lockPath: string; waitMs: number }> {
  const lockId = params.lockId || params.targetResolution.schedulerLockId || 'display-fallback';
  const lockPath = schedulerLockPath(lockId);
  const ownerId = sanitizeId(`${params.runId || 'unknown-run'}-${params.stepId || 'unknown-step'}-${Date.now()}`);
  const timeoutMs = Math.max(1, params.timeoutMs ?? 60_000);
  const staleMs = Math.max(timeoutMs, params.staleMs ?? 120_000);
  const startedAt = Date.now();
  let staleLockReclaimed = false;
  await mkdir(join(tmpdir(), 'sciforge-computer-use-locks'), { recursive: true });

  while (Date.now() - startedAt <= timeoutMs) {
    const acquiredAt = new Date().toISOString();
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({
          schemaVersion: 'sciforge.computer-use.scheduler-lock.v1',
          lockId,
          ownerId,
          runId: params.runId,
          stepId: params.stepId,
          acquiredAt,
          targetWindow: {
            windowId: params.targetResolution.windowId,
            displayId: params.targetResolution.displayId,
            appName: params.targetResolution.appName,
            title: params.targetResolution.title,
          },
        }, null, 2)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      const lease: ComputerUseSchedulerLease = {
        mode: 'real-gui-executor-lock',
        lockId,
        lockPath,
        ownerId,
        acquiredAt,
        waitMs: Date.now() - startedAt,
        staleLockReclaimed: staleLockReclaimed || undefined,
      };
      return {
        ok: true,
        lease,
        release: async () => {
          await rm(lockPath, { force: true });
          lease.releasedAt = new Date().toISOString();
          return lease;
        },
      };
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code !== 'EEXIST') {
        return {
          ok: false,
          reason: `Failed to acquire Computer Use scheduler lock ${lockId}: ${error instanceof Error ? error.message : String(error)}`,
          lockId,
          lockPath,
          waitMs: Date.now() - startedAt,
        };
      }
      if (await reclaimStaleLock(lockPath, staleMs)) staleLockReclaimed = true;
      await sleep(100);
    }
  }
  return {
    ok: false,
    reason: `Timed out waiting for Computer Use scheduler lock ${lockId}; another real GUI action stream is active.`,
    lockId,
    lockPath,
    waitMs: Date.now() - startedAt,
  };
}

export function computerUseSchedulerLockId(targetResolution: ResolvedWindowTarget, options: { sharedSystemInput?: boolean } = {}) {
  return options.sharedSystemInput ? 'shared-system-input' : targetResolution.schedulerLockId || 'display-fallback';
}

export function schedulerLeaseTrace(lease: ComputerUseSchedulerLease | undefined) {
  if (!lease) return undefined;
  return {
    mode: lease.mode,
    lockId: lease.lockId,
    lockPath: lease.lockPath,
    ownerId: lease.ownerId,
    acquiredAt: lease.acquiredAt,
    releasedAt: lease.releasedAt,
    waitMs: lease.waitMs,
    staleLockReclaimed: lease.staleLockReclaimed,
  };
}

function schedulerLockPath(lockId: string) {
  return join(tmpdir(), 'sciforge-computer-use-locks', `${sanitizeId(lockId)}.lock`);
}

async function reclaimStaleLock(lockPath: string, staleMs: number) {
  const raw = await readFile(lockPath, 'utf8').catch(() => '');
  const parsed = safeJson(raw);
  const acquiredAt = isRecord(parsed) && typeof parsed.acquiredAt === 'string' ? Date.parse(parsed.acquiredAt) : NaN;
  if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt < staleMs) return false;
  await rm(lockPath, { force: true });
  return true;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
