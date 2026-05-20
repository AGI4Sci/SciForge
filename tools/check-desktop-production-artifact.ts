import {
  assertDesktopProductionArtifactCannotClaimRDeskOrRPkgPass,
  assertDesktopProductionArtifactInspectable,
  inspectDesktopProductionArtifact,
  resolveDesktopProductionArtifactPath,
} from '../src/desktop/production-artifact-inspector.js';

const artifactPath = process.argv[2]
  ?? process.env.SCIFORGE_DESKTOP_ARTIFACT_PATH
  ?? resolveDesktopProductionArtifactPath();

const inspection = await inspectDesktopProductionArtifact({ artifactPath });

try {
  assertDesktopProductionArtifactInspectable(inspection);
  assertDesktopProductionArtifactCannotClaimRDeskOrRPkgPass(inspection);
} catch (error) {
  console.error(JSON.stringify({
    artifactPath,
    verdict: inspection.verdict,
    inspectable: inspection.inspectable,
    blockReasons: inspection.blockReasons,
    checks: Object.fromEntries(
      Object.entries(inspection.checks).map(([name, check]) => [name, {
        status: check.status,
        message: check.message,
        path: check.path,
      }]),
    ),
  }, null, 2));
  throw error;
}

console.log(`[ok] desktop production artifact inspectable at ${artifactPath}; inspection-only evidence still cannot claim R-DESK/R-PKG live pass.`);
