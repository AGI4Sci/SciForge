#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly BACKUP_ROOT='/srv/sciforge-keycloak/backups/staging'
readonly SECRET_ENV='/srv/sciforge-keycloak/secrets/keycloak.env'
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly COMPOSE_FILE="$SCRIPT_DIR/../compose.restore.yaml"

if [[ $# -ne 1 || ! $1 =~ ^preopt-[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo 'Usage: restore-verify-keycloak-db.sh preopt-YYYYMMDDTHHMMSSZ' >&2
  exit 2
fi

backup_id="$1"
backup_dir="$BACKUP_ROOT/$backup_id"
dump_name='keycloak-postgresql-17.6.dump'
dump_path="$backup_dir/$dump_name"
project="sciforge-keycloak-restore-$backup_id"

[[ -f "$dump_path" && ! -L "$dump_path" ]]
[[ -f "$dump_path.sha256" && ! -L "$dump_path.sha256" ]]
[[ -f "$backup_dir/baseline-counts.txt" && ! -L "$backup_dir/baseline-counts.txt" ]]
[[ -f "$SECRET_ENV" && ! -L "$SECRET_ENV" ]]
[[ "$(stat -c '%a' "$SECRET_ENV")" == 600 ]]

(
  cd "$backup_dir"
  sha256sum --check "$dump_name.sha256"
  sha256sum --check baseline-counts.txt.sha256
)

if docker ps -a --filter "label=com.docker.compose.project=$project" -q | grep -q .; then
  echo 'ERROR: Restore project already has containers.' >&2
  exit 1
fi

cleanup() {
  status=$?
  if (( status != 0 )); then
    docker compose --project-name "$project" --env-file "$SECRET_ENV" \
      --file "$COMPOSE_FILE" logs --no-color \
      > "$backup_dir/restore-failure.log" 2>&1 || true
    chmod 0600 "$backup_dir/restore-failure.log" 2>/dev/null || true
  fi
  docker compose --project-name "$project" --env-file "$SECRET_ENV" \
    --file "$COMPOSE_FILE" down --volumes --remove-orphans \
    > /dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker compose --project-name "$project" --env-file "$SECRET_ENV" \
  --file "$COMPOSE_FILE" config --quiet
docker compose --project-name "$project" --env-file "$SECRET_ENV" \
  --file "$COMPOSE_FILE" up --detach --wait --wait-timeout 120

restore_db_id="$(docker compose --project-name "$project" --env-file "$SECRET_ENV" \
  --file "$COMPOSE_FILE" ps --quiet restore-db)"
[[ -n "$restore_db_id" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$restore_db_id")" == healthy ]]

docker exec -i -u 70:70 "$restore_db_id" \
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-acl \
    --username=keycloak \
    --dbname=keycloak \
  < "$dump_path"

docker exec -i -u 70:70 "$restore_db_id" \
  psql -X -v ON_ERROR_STOP=1 -U keycloak -d keycloak \
  < "$SCRIPT_DIR/safe-contract-counts.sql" \
  > "$backup_dir/restored-counts.txt"
chmod 0600 "$backup_dir/restored-counts.txt"
diff --unified=0 "$backup_dir/baseline-counts.txt" "$backup_dir/restored-counts.txt"

restored_counts_sha="$(sha256sum "$backup_dir/restored-counts.txt" | awk '{print $1}')"
dump_sha="$(sha256sum "$dump_path" | awk '{print $1}')"
postgres_image_id="$(docker inspect --format '{{.Image}}' "$restore_db_id")"
completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker compose --project-name "$project" --env-file "$SECRET_ENV" \
  --file "$COMPOSE_FILE" down --volumes --remove-orphans
trap - EXIT

if docker ps -a --filter "label=com.docker.compose.project=$project" -q | grep -q .; then
  echo 'ERROR: Temporary restore containers remain.' >&2
  exit 1
fi
if docker network ls --filter "label=com.docker.compose.project=$project" -q | grep -q .; then
  echo 'ERROR: Temporary restore networks remain.' >&2
  exit 1
fi
if docker volume ls --filter "label=com.docker.compose.project=$project" -q | grep -q .; then
  echo 'ERROR: Temporary restore volumes remain.' >&2
  exit 1
fi

export backup_id dump_sha restored_counts_sha postgres_image_id completed_at project backup_dir
python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schemaVersion": 1,
    "backupId": os.environ["backup_id"],
    "completedAt": os.environ["completed_at"],
    "result": "passed",
    "dumpSha256": os.environ["dump_sha"],
    "restoredCountsSha256": os.environ["restored_counts_sha"],
    "postgresImageId": os.environ["postgres_image_id"],
    "restoreProject": os.environ["project"],
    "temporaryResourcesRemoved": True,
}
path = Path(os.environ["backup_dir"]) / "restore-receipt.json"
path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
path.chmod(0o600)
PY

(
  cd "$backup_dir"
  sha256sum restored-counts.txt > restored-counts.txt.sha256
  sha256sum restore-receipt.json > restore-receipt.json.sha256
)
chmod 0600 "$backup_dir/restored-counts.txt.sha256" "$backup_dir/restore-receipt.json.sha256"

echo "RESTORE_RESULT=passed"
echo "BACKUP_ID=$backup_id"
echo "DUMP_SHA256=$dump_sha"
echo "RESTORED_COUNTS_SHA256=$restored_counts_sha"
echo 'TEMPORARY_RESOURCES=removed'
