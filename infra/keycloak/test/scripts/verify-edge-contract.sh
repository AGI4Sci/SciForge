#!/usr/bin/env bash
set -euo pipefail

public_origin="https://login-test.sciforge.cn"
token_file="${SCIFORGE_ACCESS_TOKEN_FILE:-}"
verify_mode="${SCIFORGE_VERIFY_MODE:-local-edge}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

case "$verify_mode" in
  local-edge)
    verify_route="LOCAL_EDGE_TLS"
    curl_route=(--resolve 'login-test.sciforge.cn:443:127.0.0.1')
    ;;
  external-public)
    verify_route="EXTERNAL_PUBLIC"
    curl_route=()
    ;;
  *)
    echo "VERIFY_MODE_INVALID=true" >&2
    exit 2
    ;;
esac

fetch_public_json() {
  local path="$1"
  local output="$2"
  local status

  if ! status="$(
    curl \
      --silent \
      --show-error \
      --fail \
      --proto '=https' \
      --proto-redir '=https' \
      --max-redirs 0 \
      "${curl_route[@]}" \
      --connect-timeout 10 \
      --max-time 30 \
      --header 'Accept: application/json' \
      --output "$output" \
      --write-out '%{http_code}' \
      "${public_origin}${path}"
  )"; then
    echo "PUBLIC_HTTPS_FETCH_FAILED=true" >&2
    return 1
  fi

  if [[ "$status" != "200" ]]; then
    echo "PUBLIC_HTTPS_HTTP_200=false" >&2
    return 1
  fi
}

fetch_public_json \
  '/realms/SciForge/.well-known/openid-configuration' \
  "$tmp_dir/discovery.json"

fetch_public_json \
  '/realms/SciForge/protocol/openid-connect/certs' \
  "$tmp_dir/jwks.json"

echo "VERIFY_ROUTE=$verify_route"

node \
  "$script_dir/verify-oidc-artifacts.mjs" \
  "$tmp_dir/discovery.json" \
  "$tmp_dir/jwks.json" \
  "$token_file"
