import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WEB_SEARCH_STRICT_NEGATIVE_FIXTURE_IDS,
  WEB_SEARCH_STRICT_TIMING_PHASES,
  buildWebSearchStrictOrdinarySearchOnlyProductProofFixture,
  buildWebSearchStrictNegativeFixture,
  runWebSearchLocalFixtureSuite,
  validateWebSearchStrictAcceptanceManifest,
  withWebSearchLocalFixtureServer,
} from './helpers/web-search-strict-acceptance-fixtures.js';

const fixedNow = new Date('2026-06-10T08:00:00.000Z');

test('web_search local fixture suite proves search-read protocol shape without claiming product proof', async () => {
  await withArtifactDir('sciforge-web-search-p5-positive-', async (artifactDir) => {
    await withWebSearchLocalFixtureServer(async (fixtureServer) => {
      const manifest = await runWebSearchLocalFixtureSuite(fixtureServer, {
        artifactDir,
        caseId: 'search-read-success',
        now: () => fixedNow,
        runId: 'web-search-p5-current',
      });
      const validation = await validateWebSearchStrictAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
      });

      assert.equal(validation.valid, true, validation.blockers.join('\n'));
      assert.equal(validation.productProof, false);
      assert.equal(manifest.proofLevel, 'local diagnostic');
      assert.equal(manifest.diagnosticOnly, true);
      assert.equal(manifest.releaseEligible, false);
      assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search -> web_read');
      assert.equal(manifest.currentRun.directDispatcherConsistency.consistent, true);
      assert.deepEqual(Object.keys(manifest.timingReport), [...WEB_SEARCH_STRICT_TIMING_PHASES]);

      const source = manifest.currentRun.sourcePages[0];
      assert.ok(source, 'successful fixture must persist a source page');
      const { pageTextRef, textSha1 } = source;
      if (!pageTextRef || !textSha1) {
        throw new Error('successful fixture must include page text ref and text sha1');
      }
      assert.match(source.sourcePageJsonRef, /^web-source:web-search-p5-current\//);
      assert.match(pageTextRef, /^web-text:web-search-p5-current\//);
      assert.match(textSha1, /^[a-f0-9]{40}$/);
      assert.equal(source.finalUrl, fixtureServer.urls.success);
      assert.ok(manifest.finalAnswer.text.includes(source.finalUrl), 'final answer must carry a source link');
      assert.ok(manifest.finalAnswer.supportingRefs.includes(source.sourcePageJsonRef));
      assert.ok(manifest.finalAnswer.supportingRefs.includes(pageTextRef));
    });
  });
});

test('web_search blocked local fixture keeps current refs, failure reason, and recovery path', async () => {
  await withArtifactDir('sciforge-web-search-p5-blocked-', async (artifactDir) => {
    await withWebSearchLocalFixtureServer(async (fixtureServer) => {
      const manifest = await runWebSearchLocalFixtureSuite(fixtureServer, {
        artifactDir,
        caseId: 'read-blocked',
        now: () => fixedNow,
        runId: 'web-search-p5-blocked-current',
      });
      const validation = await validateWebSearchStrictAcceptanceManifest(manifest, {
        artifactRoot: artifactDir,
        now: fixedNow,
      });

      assert.equal(validation.valid, true, validation.blockers.join('\n'));
      assert.equal(manifest.status, 'blocked');
      assert.equal(manifest.currentRun.sourcePages[0]?.readStatus, 'blocked');
      assert.match(manifest.failureReason?.code ?? '', /read_failed|needs_user_browser/);
      assert.ok(manifest.currentRun.refs.some((ref) => ref.startsWith('web-search:web-search-p5-blocked-current/')));
      assert.ok(manifest.currentRun.refs.some((ref) => ref.startsWith('web-page:web-search-p5-blocked-current/')));
      assert.ok((manifest.recoverActions ?? []).some((action) => action.userVisible === true));
    });
  });
});

test('web_search strict product gate accepts ordinary search-only current-run source links', async () => {
  await withArtifactDir('sciforge-web-search-p5-search-only-product-', async (artifactDir) => {
    const manifest = await buildWebSearchStrictOrdinarySearchOnlyProductProofFixture({
      artifactDir,
      now: () => fixedNow,
      runId: 'web-search-p5-search-only-current',
    });
    const validation = await validateWebSearchStrictAcceptanceManifest(manifest, {
      artifactRoot: artifactDir,
      now: fixedNow,
      requireProductProof: true,
    });

    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(validation.productProof, true);
    assert.equal(manifest.currentRun.route.provider, 'native');
    assert.equal(manifest.currentRun.route.evidence, 'search-only');
    assert.equal(manifest.currentRun.search.providerResultCount, 5);
    assert.equal(manifest.currentRun.search.topicRelevance.matched, true);
    assert.deepEqual(manifest.currentRun.sourcePages, []);
    assert.equal(manifest.currentRun.toolTrace.map((entry) => entry.toolName).join(' -> '), 'web_search');
    assert.equal(manifest.finalAnswer.sourceLinks.length, 5);
    assert.equal(manifest.finalAnswer.uiVisible, true);
  });
});

test('web_search strict product gate rejects snippet-only, blocked reads, stale refs, fixtures, GUI projection, and screenshot replay', async () => {
  const expectedBlocker: Record<typeof WEB_SEARCH_STRICT_NEGATIVE_FIXTURE_IDS[number], RegExp> = {
    'search-only': /snippet-only|source link|current-run web_search/i,
    'read-blocked': /read blocked|read failed|read status/i,
    'low-info-page': /low information/i,
    'topic-mismatch': /topic mismatch/i,
    'stale-refs': /current run/i,
    'historical-manifest': /historical|fresh/i,
    'fixture-product-proof': /fixture/i,
    'gui-projection': /GUI projection/i,
    'screenshot-replay': /screenshot/i,
  };

  for (const caseId of WEB_SEARCH_STRICT_NEGATIVE_FIXTURE_IDS) {
    await withArtifactDir(`sciforge-web-search-p5-negative-${caseId}-`, async (artifactDir) => {
      const fixture = await buildWebSearchStrictNegativeFixture(caseId, {
        artifactDir,
        now: () => fixedNow,
        runId: `web-search-p5-negative-${caseId}`,
      });
      const validation = await validateWebSearchStrictAcceptanceManifest(fixture, {
        artifactRoot: artifactDir,
        now: fixedNow,
        requireProductProof: true,
      });

      assert.equal(validation.valid, false, `${caseId} must not satisfy product proof`);
      assert.equal(validation.productProof, false, `${caseId} must be product-proof false`);
      assert.match(validation.blockers.join('\n'), expectedBlocker[caseId], `${caseId} blocker should explain the strict gate`);
    });
  }
});

test('web_search timing report shape rejects missing phases and inconsistent dispatcher evidence', async () => {
  await withArtifactDir('sciforge-web-search-p5-timing-', async (artifactDir) => {
    await withWebSearchLocalFixtureServer(async (fixtureServer) => {
      const manifest = await runWebSearchLocalFixtureSuite(fixtureServer, {
        artifactDir,
        caseId: 'search-read-success',
        now: () => fixedNow,
        runId: 'web-search-p5-timing-current',
      });
      const missingRenderPhase = structuredClone(manifest);
      delete missingRenderPhase.timingReport.render;
      const inconsistentDispatcher = structuredClone(manifest);
      inconsistentDispatcher.currentRun.directDispatcherConsistency.consistent = false;
      inconsistentDispatcher.currentRun.directDispatcherConsistency.dispatcher.pageTextSha1 = '0'.repeat(40);

      const missingTimingValidation = await validateWebSearchStrictAcceptanceManifest(missingRenderPhase, {
        artifactRoot: artifactDir,
        now: fixedNow,
      });
      const dispatcherValidation = await validateWebSearchStrictAcceptanceManifest(inconsistentDispatcher, {
        artifactRoot: artifactDir,
        now: fixedNow,
      });

      assert.equal(missingTimingValidation.valid, false);
      assert.match(missingTimingValidation.blockers.join('\n'), /timing report.*render/i);
      assert.equal(dispatcherValidation.valid, false);
      assert.match(dispatcherValidation.blockers.join('\n'), /dispatcher/i);
    });
  });
});

async function withArtifactDir<T>(prefix: string, run: (artifactDir: string) => Promise<T>): Promise<T> {
  const artifactDir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(artifactDir);
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}
