"""Public contract for the GUI-Owl computer-use worker.

This is the worker's stable surface (mirrors the TS `contract.ts` convention in
`packages/workers/*`): tool names, input/output JSON schemas, error codes, and
the mapping from a `ServiceResult` (see `result.py`) to an MCP tool result.

It has **no** runtime dependencies (no MCP SDK, no PIL, no Electron) so it can be
imported by tests, the HTTP server, and the MCP server alike.

Tool surface (capability-domain prefixed, per PROJECT_mcp.md):
  * gui_computer_use_run    -> run one natural-language desktop task
  * gui_computer_use_cancel -> stop an in-flight run between steps

Boundary: the worker returns evidence + trace + status, never a completion
truth. Screenshots are returned as artifact *refs* (paths on disk), never
inlined, so a single tool result never carries a large image payload.
"""
from __future__ import annotations

from typing import Any, Dict

from . import result as R
from .isolation import parse_requested_isolation
from .target import parse_target_descriptor, validate_safe_id

TOOL_RUN = "gui_computer_use_run"
TOOL_CANCEL = "gui_computer_use_cancel"
TOOL_GET_CAPABILITIES = "gui_computer_use_get_capabilities"
TOOL_LIST_TARGETS = "gui_computer_use_list_targets"
TOOL_BIND_TARGET = "gui_computer_use_bind_target"
TOOL_RELEASE_SESSION = "gui_computer_use_release_session"

# Re-exported so callers don't reach into result.py for the canonical set.
ERROR_CODES = R.ERROR_CODES

PROTOCOL_V1 = 1
PROTOCOL_V2 = 2
V2_RUN_FIELDS = frozenset({
    "sessionId", "target", "requestedIsolation", "allowDegraded",
    "queueIfBusy", "deadlineMs", "semanticAction", "parallel",
})

SEMANTIC_EXPECTATION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["text-present"]},
        "text": {"type": "string"},
        "stableForMs": {"type": "integer", "minimum": 0, "maximum": 10000},
    },
    "required": ["kind", "text"],
    "additionalProperties": False,
}

SEMANTIC_ACTION_SCHEMA: Dict[str, Any] = {
    "description": "Optional bounded deterministic observation, action, or UIA Pattern sequence.",
    "oneOf": [
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["observe"]},
                "expect": SEMANTIC_EXPECTATION_SCHEMA,
            },
            "required": ["kind", "expect"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["click"]},
                "role": {"type": "string"},
                "name": {"type": "string"},
                "expect": SEMANTIC_EXPECTATION_SCHEMA,
            },
            "required": ["kind", "role", "name", "expect"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["sequence"]},
                "steps": {
                    "type": "array", "minItems": 1, "maxItems": 16,
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["write", "invoke", "toggle"]},
                            "role": {"type": "string"},
                            "name": {"type": "string"},
                            "automationId": {"type": "string"},
                            "text": {"type": "string"},
                        },
                        "required": ["kind", "role"],
                        "additionalProperties": False,
                    },
                },
                "expect": SEMANTIC_EXPECTATION_SCHEMA,
            },
            "required": ["kind", "steps", "expect"],
            "additionalProperties": False,
        },
    ],
}


RUN_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "instruction": {
            "type": "string",
            "description": "The desktop task in natural language, e.g. "
            '"open Notepad and type the meeting agenda".',
        },
        "semanticAction": SEMANTIC_ACTION_SCHEMA,
        "parallel": {
            "type": "array",
            "description": (
                "Two to eight independent bound-session runs executed concurrently "
                "under this single approved invocation."
            ),
            "minItems": 2,
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string"},
                    "semanticAction": SEMANTIC_ACTION_SCHEMA,
                    "sessionId": {"type": "string"},
                    "requestedIsolation": {
                        "type": "string",
                        "enum": ["auto", "agent-isolated", "host-app-scoped", "host-global", "host-approved"],
                    },
                    "allowDegraded": {"type": "boolean"},
                    "queueIfBusy": {"type": "boolean"},
                    "deadlineMs": {"type": "integer", "minimum": 1, "maximum": 600000},
                },
                "required": ["instruction", "sessionId"],
                "additionalProperties": False,
            },
        },
        "execute": {
            "type": "boolean",
            "default": False,
            "description": "False (default) = dry-run: plan/ground only, no real "
            "mouse/keyboard. True = drive the real desktop (also needs approve + "
            "server CUA_ALLOW_EXECUTE).",
        },
        "approve": {
            "type": "boolean",
            "default": False,
            "description": "Must be true (with execute) to perform real actions. "
            "The host/runtime sets this only after a user approval gate.",
        },
        "imagePath": {
            "type": "string",
            "description": "Optional: ground against a static screenshot file "
            "instead of the live desktop (headless / dry-run testing).",
        },
        "imageBase64": {
            "type": "string",
            "description": "Optional: a base64 PNG screen, alternative to imagePath.",
        },
        "requestId": {
            "type": "string",
            "description": "Optional stable id; pass the same id to "
            "gui_computer_use_cancel to stop this run.",
        },
        "sessionId": {
            "type": "string",
            "description": "Stable session identity owned by one runtime thread.",
        },
        "target": {
            "type": "object",
            "description": "Explicit input/display target descriptor (protocol v2).",
            "properties": {
                "targetId": {"type": "string"},
                "kind": {"type": "string", "enum": [
                    "browser-page", "electron-webcontents", "windows-uia",
                    "isolated-desktop", "host-desktop", "static-image",
                ]},
                "ownership": {"type": "string", "enum": ["attached", "managed"]},
                "locator": {"type": "object"},
                "display": {"type": "object"},
                "backendHint": {"type": "string"},
                "generation": {"type": "string"},
                "metadata": {"type": "object"},
            },
            "required": ["kind"],
            "additionalProperties": False,
        },
        "requestedIsolation": {
            "type": "string",
            "enum": ["auto", "agent-isolated", "host-app-scoped", "host-global", "host-approved"],
            "default": "auto",
        },
        "allowDegraded": {"type": "boolean", "default": False},
        "queueIfBusy": {"type": "boolean", "default": False},
        "deadlineMs": {"type": "integer", "minimum": 1, "maximum": 600000},
    },
    "required": ["instruction"],
    "additionalProperties": False,
}


def normalize_run_input(value: object) -> Dict[str, Any]:
    """Validate and normalize legacy/v2 input without touching a backend."""
    if not isinstance(value, dict):
        raise ValueError("run input must be an object")
    allowed = set(RUN_INPUT_SCHEMA["properties"])
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    if "parallel" in value:
        raise ValueError("parallel input requires the bounded batch executor")

    instruction = value.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("instruction is required")
    if len(instruction) > 16_384:
        raise ValueError("instruction must be at most 16384 characters")

    normalized: Dict[str, Any] = {"instruction": instruction.strip()}
    semantic_action = value.get("semanticAction")
    if semantic_action is not None:
        normalized["semanticAction"] = _normalize_semantic_action(semantic_action)
    for field in ("execute", "approve", "allowDegraded", "queueIfBusy"):
        raw = value.get(field, False)
        if not isinstance(raw, bool):
            raise ValueError(f"{field} must be a boolean")
        normalized[field] = raw
    for field in ("imagePath", "imageBase64"):
        raw = value.get(field)
        if raw is not None:
            if not isinstance(raw, str) or not raw:
                raise ValueError(f"{field} must be a non-empty string")
            normalized[field] = raw
    for field in ("requestId", "sessionId"):
        raw = value.get(field)
        if raw is not None:
            normalized[field] = validate_safe_id(raw, field)

    if "target" in value:
        normalized["target"] = parse_target_descriptor(value["target"]).to_dict()
    normalized["requestedIsolation"] = parse_requested_isolation(
        value.get("requestedIsolation")
    ).value
    deadline_ms = value.get("deadlineMs")
    if deadline_ms is not None:
        if (
            isinstance(deadline_ms, bool)
            or not isinstance(deadline_ms, int)
            or not 1 <= deadline_ms <= 600_000
        ):
            raise ValueError("deadlineMs must be an integer between 1 and 600000")
        normalized["deadlineMs"] = deadline_ms

    normalized["protocolVersion"] = (
        PROTOCOL_V2 if V2_RUN_FIELDS.intersection(value) else PROTOCOL_V1
    )
    return normalized


def _normalize_semantic_action(value: object) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("semanticAction must be an object")
    kind = value.get("kind")
    if kind == "observe":
        if set(value) != {"kind", "expect"}:
            raise ValueError("observe semanticAction must contain only kind and expect")
        return {
            "kind": "observe",
            "expect": _normalize_semantic_expectation(value.get("expect")),
        }
    if kind == "click":
        if set(value) != {"kind", "role", "name", "expect"}:
            raise ValueError("click semanticAction must contain only kind, role, name, and expect")
        role = _bounded_string(value.get("role"), "semanticAction.role", 64)
        name = _bounded_string(value.get("name"), "semanticAction.name", 512)
        return {
            "kind": "click", "role": role, "name": name,
            "expect": _normalize_semantic_expectation(value.get("expect")),
        }
    if kind != "sequence":
        raise ValueError("semanticAction.kind must be observe, click, or sequence")
    if set(value) != {"kind", "steps", "expect"}:
        raise ValueError("sequence semanticAction must contain only kind, steps, and expect")
    steps = value.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 16:
        raise ValueError("semanticAction.steps must contain between 1 and 16 entries")
    normalized_steps = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"semanticAction.steps[{index}] must be an object")
        if set(step) - {"kind", "role", "name", "automationId", "text"}:
            raise ValueError(f"semanticAction.steps[{index}] contains unsupported fields")
        step_kind = step.get("kind")
        if step_kind not in {"write", "invoke", "toggle"}:
            raise ValueError(f"semanticAction.steps[{index}].kind is unsupported")
        role = _bounded_string(step.get("role"), f"semanticAction.steps[{index}].role", 64)
        name = step.get("name")
        automation_id = step.get("automationId")
        if name is None and automation_id is None:
            raise ValueError(f"semanticAction.steps[{index}] requires name or automationId")
        normalized_step: Dict[str, Any] = {"kind": step_kind, "role": role}
        if name is not None:
            normalized_step["name"] = _bounded_string(
                name, f"semanticAction.steps[{index}].name", 512,
            )
        if automation_id is not None:
            normalized_step["automationId"] = _bounded_string(
                automation_id, f"semanticAction.steps[{index}].automationId", 256,
            )
        text = step.get("text")
        if step_kind == "write":
            if not isinstance(text, str) or len(text) > 4_096:
                raise ValueError(f"semanticAction.steps[{index}].text must be at most 4096 characters")
            normalized_step["text"] = text
        elif text is not None:
            raise ValueError(f"semanticAction.steps[{index}].text is valid only for write")
        normalized_steps.append(normalized_step)
    return {
        "kind": "sequence", "steps": normalized_steps,
        "expect": _normalize_semantic_expectation(value.get("expect")),
    }


def _normalize_semantic_expectation(value: object) -> Dict[str, Any]:
    if not isinstance(value, dict) or not {"kind", "text"}.issubset(value) or set(value) - {"kind", "text", "stableForMs"}:
        raise ValueError("semanticAction.expect must contain kind/text and optional stableForMs")
    if value.get("kind") != "text-present":
        raise ValueError("semanticAction.expect.kind must be text-present")
    text = _bounded_string(value.get("text"), "semanticAction.expect.text", 512)
    stable_for_ms = value.get("stableForMs", 0)
    if (
        isinstance(stable_for_ms, bool) or not isinstance(stable_for_ms, int)
        or not 0 <= stable_for_ms <= 10_000
    ):
        raise ValueError("semanticAction.expect.stableForMs must be an integer between 0 and 10000")
    return {
        "kind": "text-present", "text": text,
        **({"stableForMs": stable_for_ms} if "stableForMs" in value else {}),
    }


def _bounded_string(value: object, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{field} must be 1-{maximum} characters")
    return value.strip()


def normalize_parallel_run_input(value: object) -> Dict[str, Any]:
    """Validate one approved, bounded batch without resolving its sessions."""
    if not isinstance(value, dict):
        raise ValueError("run input must be an object")
    allowed = set(RUN_INPUT_SCHEMA["properties"])
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    instruction = value.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("instruction is required")
    if len(instruction) > 16_384:
        raise ValueError("instruction must be at most 16384 characters")
    conflicting = {
        "semanticAction", "sessionId", "target", "imagePath", "imageBase64",
    }.intersection(value)
    if conflicting:
        raise ValueError(
            "parallel fields must be supplied per entry: "
            + ", ".join(sorted(conflicting))
        )
    entries = value.get("parallel")
    if not isinstance(entries, list) or not 2 <= len(entries) <= 8:
        raise ValueError("parallel must contain between 2 and 8 entries")
    execute = value.get("execute", False)
    approve = value.get("approve", False)
    if not isinstance(execute, bool) or not isinstance(approve, bool):
        raise ValueError("execute and approve must be booleans")
    normalized_entries = []
    session_ids: set[str] = set()
    allowed_entry = {
        "instruction", "semanticAction", "sessionId", "requestedIsolation",
        "allowDegraded", "queueIfBusy", "deadlineMs",
    }
    batch_assertions = {
        field: value[field]
        for field in ("requestedIsolation", "allowDegraded")
        if field in value
    }
    batch_defaults = {
        field: value[field]
        for field in ("queueIfBusy", "deadlineMs")
        if field in value
    }
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"parallel[{index}] must be an object")
        unsupported = set(entry) - allowed_entry
        if unsupported:
            raise ValueError(
                f"parallel[{index}] unsupported fields: {', '.join(sorted(unsupported))}"
            )
        for field, expected in batch_assertions.items():
            if field not in entry or entry[field] != expected:
                raise ValueError(
                    f"parallel[{index}].{field} must be explicit and match "
                    "the redundant batch assertion"
                )
        child = normalize_run_input({
            **batch_defaults, **entry, "execute": execute, "approve": approve,
        })
        session_id = child.get("sessionId")
        if session_id is None:
            raise ValueError(f"parallel[{index}].sessionId is required")
        if session_id in session_ids:
            raise ValueError("parallel sessionId values must be unique")
        session_ids.add(session_id)
        normalized_entries.append(child)
    return {
        "instruction": instruction.strip(),
        "execute": execute,
        "approve": approve,
        "parallel": normalized_entries,
        "protocolVersion": PROTOCOL_V2,
    }


def v2_backend_unavailable(request: Dict[str, Any] | None = None) -> Dict[str, Any]:
    details: Dict[str, Any] = {"protocolVersion": PROTOCOL_V2}
    if request is not None:
        for field in ("sessionId", "requestId", "requestedIsolation"):
            if field in request:
                details[field] = request[field]
        if "target" in request:
            details["targetId"] = request["target"]["targetId"]
    return R.err(
        "BACKEND_UNAVAILABLE",
        "session-target channels are declared by protocol v2 but are not connected until P2",
        retryable=False,
        blocked_reason="computer-use-session-channel-not-implemented",
        details=details,
    )

CANCEL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "requestId": {
            "type": "string",
            "description": "The requestId of the in-flight run to cancel.",
        }
    },
    "required": ["requestId"],
    "additionalProperties": False,
}

EMPTY_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object", "properties": {}, "additionalProperties": False,
}

BIND_TARGET_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "sessionId": {"type": "string"},
        "owner": {
            "type": "object",
            "properties": {
                "runtimeId": {"type": "string"},
                "threadId": {"type": "string"},
            },
            "required": ["runtimeId", "threadId"],
            "additionalProperties": False,
        },
        "target": RUN_INPUT_SCHEMA["properties"]["target"],
    },
    "required": ["owner", "target"],
    "additionalProperties": False,
}

RELEASE_SESSION_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "sessionId": {"type": "string"},
        "reason": {"type": "string"},
        "force": {"type": "boolean", "default": False},
    },
    "required": ["sessionId"],
    "additionalProperties": False,
}


def service_result_to_mcp(res: Dict[str, Any]) -> Dict[str, Any]:
    """Map a ServiceResult dict to an MCP `CallToolResult`-shaped dict.

    structuredContent carries the full machine-readable result; the text content
    is a short human/model-readable summary only (per the MCP tool design rules).
    Screenshots stay as artifact refs inside structuredContent.
    """
    if res.get("ok"):
        data = res.get("data", {})
        summary = res.get("summary") or _summarize_ok(data)
        structured: Dict[str, Any] = {"ok": True, "data": data}
        for k in ("artifacts", "provenance", "warnings"):
            if k in res:
                structured[k] = res[k]
        return {
            "content": [{"type": "text", "text": summary}],
            "structuredContent": structured,
        }
    err = res.get("error", {})
    text = f"{err.get('code', 'INTERNAL_ERROR')}: {err.get('message', 'unknown error')}"
    if err.get("blockedReason"):
        text += f" (blocked: {err['blockedReason']})"
    structured = {"ok": False, "error": err}
    if "provenance" in res:
        structured["provenance"] = res["provenance"]
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": structured,
        "isError": True,
    }


def _summarize_ok(data: Dict[str, Any]) -> str:
    return (
        f"status={data.get('status')}; "
        f"{'executed' if data.get('executed') else 'dry-run (no actions)'}; "
        f"{data.get('stepCount', 0)} step(s) on {data.get('platform')}."
    )
