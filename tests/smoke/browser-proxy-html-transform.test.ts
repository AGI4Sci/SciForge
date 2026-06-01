import assert from 'node:assert/strict';
import test from 'node:test';

import { transformBrowserProxyHtml } from '../../vite.config';

test('browser proxy rewrites navigational links to SciForge-owned routes without leaking through a remote base tag', () => {
  const html = `
    <html>
      <head><title>paper</title></head>
      <body>
        <a href="/pdf/2605.00080" target="_blank" onclick="steal()">View PDF</a>
        <a href="/abs/2605.00080">Abstract</a>
        <link rel="stylesheet" href="/static/site.css" />
        <img src="/static/logo.png" />
        <form action="/search"><input name="q" /></form>
        <script>window.location='https://example.org'</script>
      </body>
    </html>
  `;

  const transformed = transformBrowserProxyHtml(html, new URL('https://arxiv.org/abs/2605.00080')).toString('utf8');

  assert.doesNotMatch(transformed, /<base\b/i);
  assert.doesNotMatch(transformed, /<script\b/i);
  assert.doesNotMatch(transformed, /\sonclick=/i);
  assert.doesNotMatch(transformed, /\starget=/i);
  assert.match(transformed, /href="\/api\/sciforge\/browser\/pdf-viewer\?url=https%3A%2F%2Farxiv\.org%2Fpdf%2F2605\.00080"/);
  assert.match(transformed, /href="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Farxiv\.org%2Fabs%2F2605\.00080"/);
  assert.match(transformed, /href="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Farxiv\.org%2Fstatic%2Fsite\.css"/);
  assert.match(transformed, /src="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Farxiv\.org%2Fstatic%2Flogo\.png"/);
  assert.match(transformed, /action="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Farxiv\.org%2Fsearch"/);
});
