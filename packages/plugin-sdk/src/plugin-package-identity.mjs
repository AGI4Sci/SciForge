// Canonical npm identities shared by the version store and the plain-Node runner.
// Do not trim, normalize, decode URI escapes, or accept a partial regex match.
const packagePattern = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/u

export function isCanonicalPluginPackageName(value) {
  return typeof value === 'string' && value.length <= 214 &&
    value !== 'node_modules' && value !== 'favicon.ico' &&
    packagePattern.exec(value)?.[0] === value
}
