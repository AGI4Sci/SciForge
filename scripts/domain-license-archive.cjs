/** A narrow archival form, not a way to disable malformed runtime packages.
 * Pure Dirent predicate shared by both ESM and CommonJS discovery owners. */
function isLicenseOnlyArchiveEntries(entries) {
  return entries.length > 0 && entries.every(entry => entry.isFile() &&
    /^(?:LICENSE|NOTICE|COPYING)(?:\.(?:md|txt))?$/u.test(entry.name))
}

module.exports = { isLicenseOnlyArchiveEntries }
