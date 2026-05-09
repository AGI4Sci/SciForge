import {
  discoverMarkdownSkillPackages,
  discoverMarkdownToolPackages,
  markdownCatalogRuntimeDefaults,
  type MarkdownSkillPackage,
  type MarkdownToolPackage,
} from '../../packages/skills/markdown-catalog';
import type { SkillManifest } from './runtime-types.js';

export {
  discoverMarkdownSkillPackages,
  discoverMarkdownToolPackages,
  type MarkdownSkillPackage,
  type MarkdownToolPackage,
};

export function markdownSkillPackageToRuntimeManifest(packageManifest: MarkdownSkillPackage): SkillManifest {
  const outputTypes = packageManifest.outputArtifactTypes.length
    ? packageManifest.outputArtifactTypes
    : [...markdownCatalogRuntimeDefaults.runtimeArtifactTypes];
  return {
    id: packageManifest.id,
    kind: 'package',
    description: packageManifest.description,
    skillDomains: packageManifest.skillDomains,
    inputContract: packageManifest.inputContract,
    outputArtifactSchema: {
      type: outputTypes[0],
      allTypes: outputTypes,
      sourceSkillPackage: packageManifest.packageName,
    },
    entrypoint: {
      type: packageManifest.entrypointType,
      path: packageManifest.docs.readmePath,
    },
    environment: {
      packageName: packageManifest.packageName,
      packageRoot: packageManifest.packageRoot,
      source: packageManifest.source,
      requiredCapabilities: packageManifest.requiredCapabilities,
      scpToolId: packageManifest.scpToolId,
      scpHubUrl: packageManifest.scpHubUrl,
    },
    validationSmoke: {
      mode: markdownCatalogRuntimeDefaults.validationSmokeMode,
      failureModes: packageManifest.failureModes,
    },
    examplePrompts: packageManifest.examplePrompts,
    promotionHistory: [],
    scopeDeclaration: {
      source: 'packages/skills/SKILL.md',
      packageName: packageManifest.packageName,
      packageRoot: packageManifest.packageRoot,
      readmePath: packageManifest.docs.readmePath,
    },
  };
}
