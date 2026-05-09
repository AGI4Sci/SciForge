import { planSkillAvailabilityValidation, skillAvailabilityFailureReason } from '../../../packages/skills/runtime-policy';
import type { SkillAvailability, SkillManifest } from '../runtime-types.js';
import { fileExists } from '../workspace-task-runner.js';

export async function validateSkillAvailability(
  manifest: SkillManifest,
  manifestPath: string,
): Promise<SkillAvailability> {
  const checkedAt = new Date().toISOString();
  const plan = planSkillAvailabilityValidation(manifest, { manifestPath, cwd: process.cwd() });
  const staticFailure = skillAvailabilityFailureReason(plan);
  if (staticFailure) return unavailable(manifest, manifestPath, checkedAt, staticFailure);

  for (const probe of plan.fileProbes) {
    if (!await fileExists(probe.path)) {
      return unavailable(
        manifest,
        manifestPath,
        checkedAt,
        skillAvailabilityFailureReason(plan, probe) ?? probe.unavailableReason,
      );
    }
  }

  return {
    id: manifest.id,
    kind: manifest.kind,
    available: true,
    reason: 'Manifest validation passed',
    checkedAt,
    manifestPath,
    manifest,
  };
}

function unavailable(
  manifest: SkillManifest,
  manifestPath: string,
  checkedAt: string,
  reason: string,
): SkillAvailability {
  return {
    id: manifest.id || manifestPath,
    kind: manifest.kind,
    available: false,
    reason,
    checkedAt,
    manifestPath,
    manifest,
  };
}
