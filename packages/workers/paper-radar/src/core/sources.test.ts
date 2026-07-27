import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchArxivMetadata, fetchBiorxivMetadata } from './sources.js';

test('arXiv OAI sync rate-limits before following a resumption token', async () => {
  const requests: string[] = [];
  const delays: number[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    return new Response(url.includes('resumptionToken=next-page') ? secondArxivPage : firstArxivPage, {
      status: 200,
      headers: { 'content-type': 'text/xml; charset=utf-8' },
    });
  }) as typeof fetch;

  const result = await fetchArxivMetadata(
    { categories: ['cs.LG'], since: '2026-06-16', until: '2026-06-17', maxRecords: 10 },
    {
      fetchImpl,
      rateLimitDelayMs: 1234,
      delayImpl: async (ms) => {
        delays.push(ms);
      },
    },
  );

  assert.deepEqual(delays, [1234]);
  assert.equal(requests.length, 2);
  assert.match(requests[0] ?? '', /metadataPrefix=arXiv/);
  assert.match(requests[1] ?? '', /resumptionToken=next-page/);
  assert.deepEqual(
    result.papers.map((paper) => paper.id),
    ['arxiv:2606.00001', 'arxiv:2606.00002'],
  );
});

test('source sync rejects a stalled upstream request after the configured timeout', async () => {
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => (
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })
  )) as typeof fetch;

  await assert.rejects(
    fetchBiorxivMetadata(
      { from: '2026-06-16', to: '2026-06-17', maxRecords: 1 },
      { fetchImpl, requestTimeoutMs: 5 },
    ),
    /timed out after 5 ms/i,
  );
});

const firstArxivPage = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <metadata>
        <arXiv>
          <id>2606.00001</id>
          <created>2026-06-16</created>
          <title>Protein diffusion models for design</title>
          <authors><author><keyname>Ada</keyname><forenames>Lovelace</forenames></author></authors>
          <abstract>Protein design with diffusion models.</abstract>
          <categories>cs.LG q-bio.BM</categories>
        </arXiv>
      </metadata>
    </record>
    <resumptionToken>next-page</resumptionToken>
  </ListRecords>
</OAI-PMH>`;

const secondArxivPage = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <metadata>
        <arXiv>
          <id>2606.00002</id>
          <created>2026-06-17</created>
          <title>Single-cell foundation models</title>
          <authors><author><keyname>Hopper</keyname><forenames>Grace</forenames></author></authors>
          <abstract>Representation learning for single-cell systems.</abstract>
          <categories>cs.LG q-bio.GN</categories>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;
