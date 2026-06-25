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

TOOL_RUN = "gui_computer_use_run"
TOOL_CANCEL = "gui_computer_use_cancel"

# Re-exported so callers don't reach into result.py for the canonical set.
ERROR_CODES = R.ERROR_CODES

RUN_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "instruction": {
            "type": "string",
            "description": "The desktop task in natural language, e.g. "
            '"open Notepad and type the meeting agenda".',
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
    },
    "required": ["instruction"],
    "additionalProperties": False,
}

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
