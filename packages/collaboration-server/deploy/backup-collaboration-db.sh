#!/usr/bin/env bash
set -euo pipefail

readonly backup_dir=/var/backups/sciforge-collaboration
readonly database_name=sciforge_collaboration
readonly retention_days=14

umask 077
install -d -m 0700 "${backup_dir}"

exec 9>"${backup_dir}/.backup.lock"
flock -n 9 || exit 0

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="${backup_dir}/collaboration-${timestamp}.dump"
checksum_path="${backup_path}.sha256"
temporary_path="${backup_path}.partial"

cleanup() {
  rm -f -- "${temporary_path}"
}
trap cleanup EXIT

pg_dump --format=custom --no-owner --no-privileges "${database_name}" \
  >"${temporary_path}"
mv -- "${temporary_path}" "${backup_path}"
sha256sum "${backup_path}" >"${checksum_path}"

# Local retention is only a staging safety net. Operations must copy each dump
# and checksum to encrypted off-host storage before relying on it for recovery.
find "${backup_dir}" -xdev -type f \
  \( -name 'collaboration-*.dump' -o -name 'collaboration-*.dump.sha256' \) \
  -mtime "+${retention_days}" -delete
