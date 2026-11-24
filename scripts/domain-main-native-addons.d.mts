export type StagedDomainMainNativeAddon = Readonly<{
  packageName: string
  bundleRelativePath: string
}>

export function stageDomainMainNativeAddons(input: Readonly<{
  repositoryRoot: string
  mainOutputDirectory: string
  platform: NodeJS.Platform
  onSkipPackageDirectory?: (packageDirectory: string) => void
}>): Promise<readonly StagedDomainMainNativeAddon[]>
