import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createPaperRadarServer } from './server.js';

test('end-to-end metadata flow works through HTTP and SQLite', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'paper-radar-e2e-')), 'papers.sqlite');
  const server = createPaperRadarServer({
    dbPath,
    fetchImpl: upstreamStub(),
    now: () => new Date('2026-06-17T00:00:00.000Z'),
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const healthBefore = await fetchJson(`${base}/health`);
    assert.equal(healthBefore.ok, true);
    assert.equal(healthBefore.stats.papers, 0);

    const arxivSync = await postJson(`${base}/sync/arxiv`, {
      categories: ['cs.LG', 'q-bio'],
      since: '2026-06-16',
      until: '2026-06-17',
      maxRecords: 10,
    });
    assert.equal(arxivSync.ok, true);
    assert.equal(arxivSync.data.upserted, 1);

    const biorxivSync = await postJson(`${base}/sync/biorxiv`, {
      from: '2026-06-16',
      to: '2026-06-17',
      maxRecords: 10,
    });
    assert.equal(biorxivSync.ok, true);
    assert.equal(biorxivSync.data.upserted, 1);

    const healthAfter = await fetchJson(`${base}/health`);
    assert.equal(healthAfter.stats.papers, 2);
    assert.equal(healthAfter.stats.arxiv, 1);
    assert.equal(healthAfter.stats.biorxiv, 1);

    const arxivSearch = await fetchJson(`${base}/papers/search?q=protein%20diffusion&source=arxiv&topK=5`);
    assert.equal(arxivSearch.ok, true);
    assert.equal(arxivSearch.data.count, 1);
    assert.equal(arxivSearch.data.papers[0].externalId, '2606.12345');

    const biorxivSearch = await fetchJson(`${base}/papers/search?q=single-cell%20foundation&source=biorxiv&topK=5`);
    assert.equal(biorxivSearch.ok, true);
    assert.equal(biorxivSearch.data.count, 1);
    assert.match(biorxivSearch.data.papers[0].title, /single-cell/i);

    const digest = await postJson(`${base}/digest`, {
      profile: 'lab_default',
      keywords: ['protein', 'single-cell', 'foundation model'],
      topK: 10,
    });
    assert.equal(digest.ok, true);
    assert.equal(digest.data.profile, 'lab_default');
    assert.equal(digest.data.count, 2);
    assert.ok(digest.data.papers.every((paper: { reason?: string }) => paper.reason && paper.reason.length > 0));
  } finally {
    server.close();
    await once(server, 'close');
  }
});

function upstreamStub(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('export.arxiv.org/oai2')) {
      return new Response(arxivXml(), { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    if (url.includes('api.biorxiv.org/details')) {
      return new Response(JSON.stringify(biorxivJson()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

async function fetchJson(url: string): Promise<any> {
  return (await fetch(url)).json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  return (
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();
}

function biorxivJson(): unknown {
  return {
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
  };
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
