import { homedir } from 'node:os';
import { join } from 'node:path';

import { createPaperRadarServer } from './server.js';
import { startDailySync } from './scheduler.js';

const host = process.env.PAPER_RADAR_HOST ?? '127.0.0.1';
const port = Number(process.env.PAPER_RADAR_PORT ?? 3901);
const dbPath = process.env.PAPER_RADAR_DB ?? join(homedir(), '.sciforge', 'paper-radar.sqlite');
const profilesPath = process.env.PAPER_RADAR_PROFILES ?? join(homedir(), '.sciforge', 'paper-radar-profiles.json');
const autoSync = process.env.PAPER_RADAR_AUTO_SYNC !== '0';
const syncIntervalMs = Number(process.env.PAPER_RADAR_SYNC_INTERVAL_HOURS ?? 24) * 60 * 60 * 1000;
const arxivCategories = (process.env.PAPER_RADAR_ARXIV_CATEGORIES ?? 'q-bio,cs.LG,stat.ML')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const maxRecords = Number(process.env.PAPER_RADAR_MAX_RECORDS ?? 200);

const server = createPaperRadarServer({ dbPath, profilesPath });
const scheduler = autoSync
  ? startDailySync({ dbPath, arxivCategories, maxRecords }, syncIntervalMs)
  : undefined;

server.listen(port, host, () => {
  console.log(`SciForge Paper Radar listening at http://${host}:${port}`);
  console.log(`Paper metadata database: ${dbPath}`);
  console.log(`Paper profile config: ${profilesPath}`);
  console.log(
    autoSync
      ? `Paper metadata auto-sync: enabled, categories=${arxivCategories.join(',')}, intervalHours=${syncIntervalMs / 3_600_000}`
      : 'Paper metadata auto-sync: disabled',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    scheduler?.stop();
    server.close(() => process.exit(0));
  });
}
