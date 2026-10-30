// Keep the CJS dependency boundary and its narrow type declaration local to the SDK.
import semver from 'semver'
export const { valid, validRange, satisfies } = semver
