import { fetchArxivMetadata, fetchBiorxivMetadata } from './sources.js';
import { PaperStore } from './storage.js';

export interface DailySyncOptions {
  dbPath: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  arxivCategories: string[];
  maxRecords: number;
}

export interface DailySyncScheduler {
  runOnce: () => Promise<void>;
  stop: () => void;
}

export function startDailySync(options: DailySyncOptions, intervalMs: number): DailySyncScheduler {
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      await runDailySync(options);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    runOnce().catch((error) => console.error(`[paper-radar] scheduled sync failed: ${messageOf(error)}`));
  }, intervalMs);
  timer.unref();

  runOnce().catch((error) => console.error(`[paper-radar] initial sync failed: ${messageOf(error)}`));

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}

async function runDailySync(options: DailySyncOptions): Promise<void> {
  const store = new PaperStore(options.dbPath);
  const now = options.now ?? (() => new Date());
  try {
    const today = isoDate(now());
    const yesterday = isoDate(addDays(now(), -1));
    const arxivSince = store.getSyncState('arxiv', 'last_sync_date') ?? yesterday;
    const biorxivFrom = store.getSyncState('biorxiv', 'last_sync_date') ?? yesterday;

    const arxiv = await fetchArxivMetadata(
      { categories: options.arxivCategories, since: arxivSince, until: today, maxRecords: options.maxRecords },
      { fetchImpl: options.fetchImpl, now },
    );
    for (const paper of arxiv.papers) store.upsertPaper(paper);
    store.setSyncState('arxiv', 'last_sync', now().toISOString());
    store.setSyncState('arxiv', 'last_sync_date', today);

    const biorxiv = await fetchBiorxivMetadata(
      { from: biorxivFrom, to: today, maxRecords: options.maxRecords },
      { fetchImpl: options.fetchImpl, now },
    );
    for (const paper of biorxiv.papers) store.upsertPaper(paper);
    store.setSyncState('biorxiv', 'last_sync', now().toISOString());
    store.setSyncState('biorxiv', 'last_sync_date', today);

    console.log(
      `[paper-radar] synced metadata: arxiv=${arxiv.papers.length}, biorxiv=${biorxiv.papers.length}, date=${today}`,
    );
  } finally {
    store.close();
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
