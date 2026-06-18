import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createPaperRadarServer } from './server.js';

async function withServer(fetchImpl: typeof fetch, run: (base: string) => Promise<void>): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'paper-radar-')), 'papers.sqlite');
  const server = createPaperRadarServer({
    dbPath,
    fetchImpl,
    now: () => new Date('2026-06-17T00:00:00.000Z'),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('syncs bioRxiv metadata and searches it locally', async () => {
  await withServer(stubFetch(), async (base) => {
    const sync = await fetchJson(`${base}/sync/biorxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-06-16', to: '2026-06-17', maxRecords: 10 }),
    });
    assert.equal(sync.ok, true);
    assert.equal(sync.data.upserted, 1);

    const search = await fetchJson(`${base}/papers/search?q=single-cell&source=biorxiv&topK=5`);
    assert.equal(search.ok, true);
    assert.equal(search.data.count, 1);
    assert.match(search.data.papers[0].title, /single-cell/i);
  });
});

test('syncs arXiv OAI metadata and builds digest', async () => {
  await withServer(stubFetch(), async (base) => {
    const sync = await fetchJson(`${base}/sync/arxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: ['cs.LG'], since: '2026-06-16', maxRecords: 10 }),
    });
    assert.equal(sync.ok, true);
    assert.equal(sync.data.upserted, 1);

    const digest = await fetchJson(`${base}/digest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keywords: ['protein', 'diffusion'], topK: 5 }),
    });
    assert.equal(digest.ok, true);
    assert.equal(digest.data.count, 1);
    assert.match(digest.data.papers[0].reason, /protein|diffusion/i);
  });
});

test('lists, saves, and ranks topic profiles', async () => {
  await withServer(stubFetch(), async (base) => {
    const profilesBefore = await fetchJson(`${base}/profiles`);
    assert.equal(profilesBefore.ok, true);
    assert.equal(profilesBefore.data.profiles.some((profile: { name: string }) => profile.name === 'lab_default'), true);

    const saved = await fetchJson(`${base}/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'protein_focus',
        keywords: ['protein design', 'diffusion'],
        excludeKeywords: ['single-cell'],
        arxivCategories: ['cs.LG', 'q-bio'],
        biorxivSubjects: ['bioinformatics'],
      }),
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.data.profile.name, 'protein_focus');

    await fetchJson(`${base}/sync/arxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: ['cs.LG'], since: '2026-06-16', maxRecords: 10 }),
    });
    await fetchJson(`${base}/sync/biorxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-06-16', to: '2026-06-17', maxRecords: 10 }),
    });

    const ranked = await fetchJson(`${base}/papers/rank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'protein_focus', from: '2026-06-16', topK: 5 }),
    });
    assert.equal(ranked.ok, true);
    assert.equal(ranked.data.count, 1);
    assert.equal(ranked.data.papers[0].externalId, '2606.12345');
    assert.ok(ranked.data.papers[0].score > 0);
    assert.match(ranked.data.papers[0].reason, /protein|diffusion|categories/i);
  });
});

test('syncs metadata through a topic profile', async () => {
  await withServer(stubFetch(), async (base) => {
    const saved = await fetchJson(`${base}/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'single_cell_focus',
        keywords: ['single-cell'],
        excludeKeywords: [],
        arxivCategories: ['cs.LG'],
        biorxivSubjects: ['bioinformatics'],
      }),
    });
    assert.equal(saved.ok, true);

    const sync = await fetchJson(`${base}/sync/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'single_cell_focus', from: '2026-06-16', to: '2026-06-17', maxRecords: 10 }),
    });
    assert.equal(sync.ok, true);
    assert.equal(sync.data.profile, 'single_cell_focus');
    assert.equal(sync.data.results.length, 2);
    assert.equal(sync.data.results.reduce((total: number, result: { upserted: number }) => total + result.upserted, 0), 2);

    const health = await fetchJson(`${base}/health`);
    assert.equal(health.stats.papers, 2);
  });
});

test('digest excludes papers by profile and request keywords', async () => {
  await withServer(stubFetch(), async (base) => {
    await fetchJson(`${base}/sync/arxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: ['cs.LG'], since: '2026-06-16', maxRecords: 10 }),
    });
    await fetchJson(`${base}/sync/biorxiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-06-16', to: '2026-06-17', maxRecords: 10 }),
    });

    const digest = await fetchJson(`${base}/digest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['protein', 'single-cell'],
        excludeKeywords: ['foundation model'],
        from: '2026-06-16',
        topK: 10,
      }),
    });
    assert.equal(digest.ok, true);
    assert.equal(digest.data.count, 1);
    assert.equal(digest.data.papers[0].externalId, '2606.12345');
  });
});

function stubFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.biorxiv.org/details')) {
      return jsonResponse({
        collection: [
          {
            doi: '10.1101/2026.06.17.123456',
            title: 'A single-cell foundation model for perturbation prediction',
            authors: 'Ada Smith; Lin Chen',
            abstract: 'We introduce a single-cell foundation model for perturbation response prediction.',
            date: '2026-06-17',
            category: 'bioinformatics',
            biorxiv_url: 'https://www.biorxiv.org/content/10.1101/2026.06.17.123456v1',
          },
        ],
      });
    }
    if (url.includes('export.arxiv.org/oai2')) {
      return new Response(arxivXml(), { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  return (await fetch(url, init)).json();
}

function arxivXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <metadata>
        <arXiv>
          <id>2606.12345</id>
          <created>2026-06-17</created>
          <updated>2026-06-17</updated>
          <authors>
            <author><keyname>Nguyen</keyname><forenames>Kim</forenames></author>
          </authors>
          <title>Efficient protein design with diffusion priors</title>
          <categories>cs.LG q-bio.BM</categories>
          <abstract>We study protein design with diffusion priors and fast sequence generation.</abstract>
          <doi>10.48550/arXiv.2606.12345</doi>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;
}
