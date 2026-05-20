import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { complexMultiTurnFixtures } from '../../fixtures/complex-multiturn/suite.js';
import {
  CURRENT_PROJECT_DESKTOP_COVERAGE,
  CURRENT_PROJECT_REAL_TASK_IDS,
  CURRENT_PROJECT_TASK_LEGACY_BOUNDARIES,
  CURRENT_PROJECT_WEB_E2E_COVERAGE,
  FINAL_WEB_E2E_CASE_TAGS,
  WEB_E2E_LEGACY_TASK_MAPPINGS,
  currentProjectMappingsForSaWebTag,
  mappingsForSaWebTag,
  type LegacyRealTaskPrefix,
} from './case-tags.js';
import { selectWebE2eCases, webE2eCaseRegistry } from './case-registry.js';

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
const currentProjectIds = new Set<string>(CURRENT_PROJECT_REAL_TASK_IDS);
const registryByCaseId = new Map(webE2eCaseRegistry.map((definition) => [definition.id, definition]));
const projectText = readFileSync(join(process.cwd(), 'PROJECT.md'), 'utf8');
const projectTaskIds = new Set([...projectText.matchAll(/^- \[(?: |x|X)\] (R-[A-Z]+-\d{2})\b/gm)].map((match) => match[1]));
const ids = new Set<string>();
const counts = new Map<LegacyRealTaskPrefix, number>();

assert.ok(selectWebE2eCases({ tags: ['SA-WEB-27'] }).length > 0, 'SA-WEB-27 aggregate tag must select registry cases');

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

assert.deepEqual([...currentProjectIds].sort(), [...projectTaskIds].sort(), 'current PROJECT task ids must stay separate from legacy SA-WEB lineage');
assert.equal(
  WEB_E2E_LEGACY_TASK_MAPPINGS.some((mapping) => mapping.rTaskId.startsWith('R-UI-')),
  true,
  'legacy mappings intentionally preserve retired R-UI lineage',
);
assert.equal(currentProjectIds.has('R-UI-01'), false, 'current PROJECT task ids must not include retired R-UI lineage');
assert.equal(currentProjectIds.has('R-RUN-03'), false, 'current PROJECT task ids must not include retired R-RUN fixture lineage');
assert.deepEqual(
  CURRENT_PROJECT_TASK_LEGACY_BOUNDARIES.map((boundary) => boundary.taskId).sort(),
  [...projectTaskIds].sort(),
  'each current PROJECT task must have an explicit legacy-boundary marker',
);
assert.ok(
  CURRENT_PROJECT_TASK_LEGACY_BOUNDARIES.every(
    (boundary) => boundary.evidenceSource === 'real-task-matrix-and-live-manifest' && boundary.legacyWebE2eMappingsCanSatisfy === false,
  ),
  'legacy SA-WEB fixtures cannot satisfy current PROJECT task passes',
);

for (const mapping of CURRENT_PROJECT_WEB_E2E_COVERAGE) {
  assert.ok(currentProjectIds.has(mapping.taskId), `${mapping.taskId}: current project task must be listed`);
  assert.equal(mapping.completionGate, 'smoke:web-multiturn-final', `${mapping.taskId}: current project coverage gate`);
  assert.ok(mapping.saWebTags.length > 0, `${mapping.taskId}: current project coverage must name SA-WEB tags`);
  assert.ok(mapping.contractAssertions.length > 0, `${mapping.taskId}: current project coverage must name contract assertions`);
  for (const tag of mapping.saWebTags) {
    assert.ok(finalTags.has(tag), `${mapping.taskId}: unknown final SA-WEB tag ${tag}`);
    const registryCase = registryByCaseId.get(tag);
    assert.ok(registryCase, `${mapping.taskId}: current PROJECT mapping ${tag} must exist in the web-e2e case registry`);
    for (const assertion of mapping.contractAssertions) {
      assert.ok(
        registryCase.tags.includes(assertion),
        `${mapping.taskId}: ${tag} registry tags must include current PROJECT assertion ${assertion}`,
      );
    }
    assert.doesNotMatch(
      [registryCase.title, ...registryCase.tags, ...registryCase.migratedLegacySteps].join('\n'),
      /\bagentserver\b/i,
      `${mapping.taskId}: ${tag} current PROJECT mapping must not point at legacy AgentServer registry semantics`,
    );
  }
}

assert.deepEqual(
  CURRENT_PROJECT_WEB_E2E_COVERAGE.map((mapping) => mapping.taskId).sort(),
  [
    'R-AUDIT-01',
    'R-BIO-01',
    'R-BUDGET-01',
    'R-CAP-01',
    'R-CODE-01',
    'R-CODE-02',
    'R-CU-01',
    'R-DATA-01',
    'R-DATA-02',
    'R-DATA-03',
    'R-DATA-04',
    'R-FAIL-01',
    'R-KG-01',
    'R-LIT-01',
    'R-LIT-02',
    'R-LIT-03',
    'R-MEM-01',
    'R-METHOD-01',
    'R-PROTO-01',
    'R-PROTO-02',
    'R-PROTO-03',
    'R-RESUME-01',
    'R-RESUME-02',
    'R-RUN-01',
    'R-RUN-02',
    'R-SEC-01',
    'R-SKILL-01',
    'R-VERIFY-01',
    'R-WEB-01',
  ],
  'current PROJECT tasks with dedicated offline web-e2e contracts must have explicit coverage mappings',
);
assert.deepEqual(
  CURRENT_PROJECT_DESKTOP_COVERAGE.map((mapping) => mapping.taskId).sort(),
  ['R-DESK-01', 'R-PKG-01'],
  'desktop PROJECT tasks must have explicit desktop acceptance coverage mappings',
);
assert.ok(
  CURRENT_PROJECT_DESKTOP_COVERAGE.every(
    (mapping) =>
      currentProjectIds.has(mapping.taskId) &&
      mapping.evidenceSource === 'desktop-live-acceptance-schema-and-real-task-matrix' &&
      mapping.completionGate === 'smoke:desktop-live-acceptance-evidence' &&
      mapping.releaseGate === 'production-desktop-cold-start-live-evidence',
  ),
  'desktop PROJECT tasks are intentionally covered by desktop live acceptance, not web-e2e fixtures',
);
assert.ok(
  CURRENT_PROJECT_WEB_E2E_COVERAGE.every((mapping) => !CURRENT_PROJECT_DESKTOP_COVERAGE.some((desktop) => desktop.taskId === mapping.taskId)),
  'desktop PROJECT tasks must not be represented as web-e2e fixture coverage',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-31').some(
    (mapping) => mapping.taskId === 'R-LIT-01' && mapping.contractAssertions.includes('literature-current-selected-report'),
  ),
  'R-LIT-01 must map to SA-WEB-31 current literature retrieval',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-31').some(
    (mapping) => mapping.taskId === 'R-LIT-03' && mapping.contractAssertions.includes('literature-current-selected-report'),
  ),
  'R-LIT-03 must map to SA-WEB-31 selected report follow-up scoping',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-32').some(
    (mapping) => mapping.taskId === 'R-LIT-02' && mapping.contractAssertions.includes('literature-evidence-conflict'),
  ),
  'R-LIT-02 must map to SA-WEB-32 contradictory literature evidence',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-32').some(
    (mapping) => mapping.taskId === 'R-WEB-01' && mapping.contractAssertions.includes('dynamic-web-evidence-status'),
  ),
  'R-WEB-01 must map to SA-WEB-32 dynamic web evidence statuses',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-20').some(
    (mapping) => mapping.taskId === 'R-DATA-01' && mapping.contractAssertions.includes('longitudinal-messy-csv'),
  ),
  'R-DATA-01 must map to SA-WEB-20 longitudinal messy CSV analysis',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-21').some(
    (mapping) => mapping.taskId === 'R-DATA-02' && mapping.contractAssertions.includes('schema-drift-confounder'),
  ),
  'R-DATA-02 must map to SA-WEB-21 schema drift confounder reinterpretation',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-22').some(
    (mapping) => mapping.taskId === 'R-DATA-03' && mapping.contractAssertions.includes('two-table-lineage'),
  ),
  'R-DATA-03 must map to SA-WEB-22 two-table lineage',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-19').some(
    (mapping) => mapping.taskId === 'R-DATA-04' && mapping.contractAssertions.includes('large-file-bounded-diagnostics'),
  ),
  'R-DATA-04 must map to SA-WEB-19 large-file bounded diagnostics',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-33').some(
    (mapping) => mapping.taskId === 'R-CODE-01' && mapping.contractAssertions.includes('targeted-code-repair'),
  ),
  'R-CODE-01 must map to SA-WEB-33 targeted code repair',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-34').some(
    (mapping) => mapping.taskId === 'R-CODE-02' && mapping.contractAssertions.includes('dirty-worktree-preservation'),
  ),
  'R-CODE-02 must map to SA-WEB-34 dirty worktree preservation',
);
for (const [taskId, assertion] of [
  ['R-RUN-01', 'service-lifecycle-recovery'],
  ['R-RUN-02', 'cancel-partial-continuation'],
  ['R-RESUME-02', 'browser-refresh-recovery'],
] as const) {
  assert.ok(
    currentProjectMappingsForSaWebTag('SA-WEB-37').some(
      (mapping) => mapping.taskId === taskId && mapping.contractAssertions.includes(assertion),
    ),
    `${taskId} must map to SA-WEB-37 ${assertion}`,
  );
}
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-28').some(
    (mapping) => mapping.taskId === 'R-PROTO-01' && mapping.contractAssertions.includes('text-only-gui-action'),
  ),
  'R-PROTO-01 must map to SA-WEB-28 text-only GUI action command trace',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-23').some(
    (mapping) => mapping.taskId === 'R-PROTO-02' && mapping.contractAssertions.includes('progressive-gui-resource-probing'),
  ),
  'R-PROTO-02 must map to SA-WEB-23 progressive GUI resource probing',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-24').some(
    (mapping) => mapping.taskId === 'R-PROTO-03' && mapping.contractAssertions.includes('gui-ask-user-clarification'),
  ),
  'R-PROTO-03 must map to SA-WEB-24 gui.ask_user clarification',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-29').some(
    (mapping) => mapping.taskId === 'R-RESUME-01' && mapping.contractAssertions.includes('native-session-artifact-followup'),
  ),
  'R-RESUME-01 must map to SA-WEB-29 native session artifact follow-up',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-30').some(
    (mapping) => mapping.taskId === 'R-MEM-01' && mapping.contractAssertions.includes('long-context-constraint-stability'),
  ),
  'R-MEM-01 must map to SA-WEB-30 long-context constraint stability',
);
for (const [taskId, assertion] of [
  ['R-BUDGET-01', 'runtime-provider-budget'],
  ['R-SEC-01', 'secret-raw-stream-scrub'],
  ['R-AUDIT-01', 'failed-run-audit-export'],
  ['R-FAIL-01', 'provider-outage-recovery'],
] as const) {
  assert.ok(
    currentProjectMappingsForSaWebTag('SA-WEB-38').some(
      (mapping) => mapping.taskId === taskId && mapping.contractAssertions.includes(assertion),
    ),
    `${taskId} must map to SA-WEB-38 ${assertion}`,
  );
}
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-35').filter(
    (mapping) => ['R-METHOD-01', 'R-KG-01', 'R-BIO-01', 'R-VERIFY-01'].includes(mapping.taskId),
  ).every((mapping) => mapping.contractAssertions.includes('scientific-reviewer-verifier-loop')),
  'R-METHOD/R-KG/R-BIO/R-VERIFY must map to SA-WEB-35 scientific reviewer/verifier loop',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-36').some(
    (mapping) => mapping.taskId === 'R-CAP-01' && mapping.contractAssertions.includes('capability-discovery-boundary'),
  ),
  'R-CAP-01 must map to SA-WEB-36 capability discovery boundary',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-36').some(
    (mapping) => mapping.taskId === 'R-SKILL-01' && mapping.contractAssertions.includes('codex-native-skill-promotion'),
  ),
  'R-SKILL-01 must map to SA-WEB-36 Codex-native skill promotion',
);
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-36').some(
    (mapping) => mapping.taskId === 'R-CU-01' && mapping.contractAssertions.includes('computer-use-evidence-folding'),
  ),
  'R-CU-01 must map to SA-WEB-36 Computer Use evidence folding',
);

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

console.log(`[ok] SA-WEB-27 mapped ${WEB_E2E_LEGACY_TASK_MAPPINGS.length} legacy R-* tasks and ${CURRENT_PROJECT_WEB_E2E_COVERAGE.length} current PROJECT tasks onto final SA-WEB case tags`);
