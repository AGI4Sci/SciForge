"""Fail-closed validation for immutable Project Snapshot database rows."""
from __future__ import annotations

import json
from typing import Any, Mapping

from .contracts import digest_json


def validate_project_snapshot_row(row: Mapping[str, Any]) -> dict[str, Any]:
    """Return a verified payload whose digest and envelope match its SQL row."""
    try:
        payload = json.loads(row["payload"])
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Project Snapshot payload is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("Project Snapshot payload must be an object")

    declared_digest = payload.get("digest")
    unsigned = dict(payload)
    unsigned.pop("digest", None)
    observed_digest = digest_json(unsigned, "project")
    if declared_digest != observed_digest or row.get("digest") != observed_digest:
        raise ValueError(
            "Project Snapshot digest mismatch; "
            f"row={row.get('digest')}, payload={declared_digest}, computed={observed_digest}"
        )

    scalar_bindings = {
        "project_key": "projectKey",
        "version": "version",
        "goal_version": "goalVersion",
        "policy_version": "policyVersion",
        "compiler_version": "compilerVersion",
        "created_at": "createdAt",
        "status": "status",
    }
    for row_key, payload_key in scalar_bindings.items():
        if row.get(row_key) != payload.get(payload_key):
            raise ValueError(
                f"Project Snapshot {payload_key} does not match its database row"
            )

    json_bindings = {
        "evidence_vector": "evidenceVector",
        "excluded_sessions": "excludedSessions",
        "isolated_sessions": "isolatedSessions",
    }
    for row_key, payload_key in json_bindings.items():
        try:
            envelope_value = json.loads(row[row_key])
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"Project Snapshot row field {row_key} is not valid JSON"
            ) from exc
        if envelope_value != payload.get(payload_key):
            raise ValueError(
                f"Project Snapshot {payload_key} does not match its database row"
            )

    if row.get("input_fingerprint") is not None:
        fingerprint = payload.get("inputFingerprint")
        if fingerprint is not None and fingerprint != row.get("input_fingerprint"):
            raise ValueError("Project Snapshot input fingerprint does not match its database row")
    if row.get("scope_revision") is not None and payload.get("scopeRevision") is not None:
        if int(payload["scopeRevision"]) != int(row["scope_revision"]):
            raise ValueError("Project Snapshot scope revision does not match its database row")

    return payload
