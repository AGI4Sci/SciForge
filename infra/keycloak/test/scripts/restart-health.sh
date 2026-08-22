#!/usr/bin/env bash
set -euo pipefail

container="sciforge-keycloak-keycloak-1"
before_id="$(docker inspect -f '{{.Id}}' "$container")"
before_started="$(docker inspect -f '{{.State.StartedAt}}' "$container")"
before_restarts="$(docker inspect -f '{{.RestartCount}}' "$container")"
started_epoch="$(date +%s)"

printf 'BEFORE_CONTAINER_ID=%s\n' "$before_id"
printf 'BEFORE_STARTED_AT=%s\n' "$before_started"
printf 'BEFORE_RESTART_COUNT=%s\n' "$before_restarts"

sudo -n /usr/local/sbin/sciforge-cloud-ops keycloak-restart >/dev/null

for attempt in $(seq 1 90); do
  elapsed="$(( $(date +%s) - started_epoch ))"
  state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || printf missing)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || printf missing)"
  printf 'RECOVERY elapsed_seconds=%s state=%s health=%s\n' "$elapsed" "$state" "$health"
  if [[ "$state" == "running" && "$health" == "healthy" ]]; then
    break
  fi
  sleep 2
done

after_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")"
[[ "$after_health" == "healthy" ]]

printf 'AFTER_CONTAINER_ID=%s\n' "$(docker inspect -f '{{.Id}}' "$container")"
printf 'AFTER_STARTED_AT=%s\n' "$(docker inspect -f '{{.State.StartedAt}}' "$container")"
printf 'AFTER_RESTART_COUNT=%s\n' "$(docker inspect -f '{{.RestartCount}}' "$container")"
printf 'HEALTH_RECOVERY_SECONDS=%s\n' "$(( $(date +%s) - started_epoch ))"
