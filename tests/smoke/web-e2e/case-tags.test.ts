import assert from 'node:assert/strict';

import { complexMultiTurnFixtures } from '../../fixtures/complex-multiturn/suite.js';
import {
  FINAL_WEB_E2E_CASE_TAGS,
  WEB_E2E_LEGACY_TASK_MAPPINGS,
  mappingsForSaWebTag,
  type LegacyRealTaskPrefix,
} from './case-tags.js';

const expectedCounts: Record<LegacyRealTaskPrefix, number> = {
  'R-LIT': 10,
  'R-DATA': 8,
  'R-RUN': 10,
  'R-UI': 8,
};

const requiredTags = [
  'SA-WEB-03',
  'SA-WEB-04',
  'SA-WEB-05',
  'SA-WEB-06',
  'SA-WEB-07',
  'SA-WEB-08',
  'SA-WEB-09',
  'SA-WEB-10',
  'SA-WEB-11',
  'SA-WEB-12',
  'SA-WEB-13',
  'SA-WEB-14',
  'SA-WEB-15',
  'SA-WEB-16',
  'SA-WEB-17',
  'SA-WEB-27',
];

const knownFixtureSourceTaskIds = new Set(complexMultiTurnFixtures.map((fixture) => fixture.sourceTaskId));
const finalTags = new Set<string>(FINAL_WEB_E2E_CASE_TAGS);
const ids = new Set<string>();
const counts = new Map<LegacyRealTaskPrefix, number>();

for (const mapping of WEB_E2E_LEGACY_TASK_MAPPINGS) {
  assert.match(mapping.rTaskId, /^R-(?:LIT|DATA|RUN|UI)-\d{2}$/, `${mapping.rTaskId}: R task id`);
  assert.equal(ids.has(mapping.rTaskId), false, `${mapping.rTaskId}: duplicate mapping`);
  ids.add(mapping.rTaskId);
  const prefix = mapping.rTaskId.replace(/-\d{2}$/, '') as LegacyRealTaskPrefix;
  counts.set(prefix, (counts.get(prefix) ?? 0) + 1);

  assert.ok(mapping.title.length > 0, `${mapping.rTaskId}: title`);
  assert.ok(mapping.saWebTags.length > 0, `${mapping.rTaskId}: SA-WEB tags`);
  assert.ok(mapping.sourceFixtureTaskIds.length > 0, `${mapping.rTaskId}: source fixture ids`);
  assert.ok(mapping.contractAssertions.length > 0, `${mapping.rTaskId}: contract assertions`);

  for (const tag of mapping.saWebTags) {
    assert.ok(finalTags.has(tag), `${mapping.rTaskId}: unknown final SA-WEB tag ${tag}`);
  }
  for (const sourceTaskId of mapping.sourceFixtureTaskIds) {
    assert.ok(knownFixtureSourceTaskIds.has(sourceTaskId), `${mapping.rTaskId}: unknown complex multiturn fixture source ${sourceTaskId}`);
  }
}

for (const [prefix, expected] of Object.entries(expectedCounts) as Array<[LegacyRealTaskPrefix, number]>) {
  assert.equal(counts.get(prefix), expected, `${prefix}: all PROJECT.md real-task scenarios must map to SA-WEB tags`);
}

for (const tag of requiredTags) {
  assert.ok(mappingsForSaWebTag(tag).length > 0, `${tag}: must have at least one R-* lineage mapping`);
}

assert.ok(
  mappingsForSaWebTag('SA-WEB-03').some((mapping) => mapping.rTaskId === 'R-UI-03'),
  'R-UI-03 must stay mapped to explicit artifact selection',
);
assert.ok(
  mappingsForSaWebTag('SA-WEB-06').some((mapping) => mapping.rTaskId === 'R-LIT-02' && mapping.contractAssertions.includes('empty-result')),
  'R-LIT-02 must stay mapped to empty-result recovery',
);
assert.ok(
  mappingsForSaWebTag('SA-WEB-10').some((mapping) => mapping.rTaskId === 'R-UI-08' && mapping.contractAssertions.includes('audit-export')),
  'R-UI-08 must stay mapped to audit export',
);

console.log(`[ok] SA-WEB-27 mapped ${WEB_E2E_LEGACY_TASK_MAPPINGS.length} R-* real tasks onto final SA-WEB case tags`);
