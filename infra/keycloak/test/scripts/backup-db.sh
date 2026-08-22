#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly DB_CONTAINER='sciforge-keycloak-keycloak-db-1'
readonly EXPECTED_DB_IMAGE_ID='sha256:d741b376874687de90374fd34f55c6b2760e8f7bd7e4ae5cd47f50757fc08cf8'
readonly BACKUP_ROOT='/srv/sciforge-keycloak/backups/staging'
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [[ $# -ne 1 || ! $1 =~ ^preopt-[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo 'Usage: backup-keycloak-db.sh preopt-YYYYMMDDTHHMMSSZ' >&2
  exit 2
fi

backup_id="$1"
backup_dir="$BACKUP_ROOT/$backup_id"
dump_name='keycloak-postgresql-17.6.dump'
dump_path="$backup_dir/$dump_name"

[[ ! -e "$backup_dir" ]] || {
  echo 'ERROR: Backup ID already exists.' >&2
  exit 1
}

[[ "$(docker inspect --format '{{.State.Status}}' "$DB_CONTAINER")" == running ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$DB_CONTAINER")" == healthy ]]
[[ "$(docker inspect --format '{{.Image}}' "$DB_CONTAINER")" == "$EXPECTED_DB_IMAGE_ID" ]]

install -d -m 0700 "$backup_dir"

docker exec -u 70:70 "$DB_CONTAINER" \
  pg_dump \
    --username=keycloak \
    --dbname=keycloak \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl \
  > "$dump_path.part"

docker exec -i -u 70:70 "$DB_CONTAINER" pg_restore --list \
  < "$dump_path.part" > /dev/null
mv -- "$dump_path.part" "$dump_path"
chmod 0600 "$dump_path"

docker exec -i -u 70:70 "$DB_CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -U keycloak -d keycloak \
  < "$SCRIPT_DIR/safe-contract-counts.sql" \
  > "$backup_dir/baseline-counts.txt"
chmod 0600 "$backup_dir/baseline-counts.txt"

docker exec -u 70:70 "$DB_CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -U keycloak -d keycloak -Atc 'SELECT version();' \
  > "$backup_dir/postgresql-version.txt"
chmod 0600 "$backup_dir/postgresql-version.txt"

(
  cd "$backup_dir"
  sha256sum "$dump_name" > "$dump_name.sha256"
  sha256sum baseline-counts.txt > baseline-counts.txt.sha256
  sha256sum postgresql-version.txt > postgresql-version.txt.sha256
)
chmod 0600 "$backup_dir"/*.sha256

dump_sha="$(sha256sum "$dump_path" | awk '{print $1}')"
baseline_sha="$(sha256sum "$backup_dir/baseline-counts.txt" | awk '{print $1}')"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
keycloak_image_id="$(docker inspect --format '{{.Image}}' sciforge-keycloak-keycloak-1)"
postgres_image_id="$(docker inspect --format '{{.Image}}' "$DB_CONTAINER")"
export backup_id dump_name dump_sha baseline_sha created_at keycloak_image_id postgres_image_id backup_dir

python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schemaVersion": 1,
    "backupId": os.environ["backup_id"],
    "createdAt": os.environ["created_at"],
    "database": "keycloak",
    "format": "PostgreSQL custom",
    "dumpFile": os.environ["dump_name"],
    "dumpSha256": os.environ["dump_sha"],
    "baselineCountsSha256": os.environ["baseline_sha"],
    "keycloakImageId": os.environ["keycloak_image_id"],
    "postgresImageId": os.environ["postgres_image_id"],
    "restoreVerified": False,
}
path = Path(os.environ["backup_dir"]) / "backup-receipt.json"
path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
path.chmod(0o600)
PY

(
  cd "$backup_dir"
  sha256sum backup-receipt.json > backup-receipt.json.sha256
)
chmod 0600 "$backup_dir/backup-receipt.json.sha256"

echo "BACKUP_ID=$backup_id"
echo "DUMP_FILE=$dump_name"
echo "DUMP_SHA256=$dump_sha"
echo "BASELINE_COUNTS_SHA256=$baseline_sha"
