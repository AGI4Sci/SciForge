import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertCapabilitySkillComputerUseBoundariesCase,
  runCapabilitySkillComputerUseBoundariesCase,
} from './web-e2e/cases/capability-skill-computer-use-boundaries.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-real-task-capability-skill-cu-gates-'));

try {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });
  assertCapabilitySkillComputerUseBoundariesCase(result);

  console.log('[ok] real-task capability/skill/CU gates cover R-CAP-01, R-SKILL-01, and R-CU-01 offline contracts');
} finally {
  await rm(baseDir, { recursive: true, force: true });
}
