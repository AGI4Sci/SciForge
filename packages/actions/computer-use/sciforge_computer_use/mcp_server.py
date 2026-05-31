"""Minimal stdio MCP wrapper for the package-local Computer Use native tools."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .native_tool import dispatch_native_tool, get_mcp_tool_schemas


MCP_PROTOCOL_VERSION = "2024-11-05"
MCP_SERVER_NAME = "sciforge-computer-use"


def handle_mcp_request(message: Mapping[str, Any], *, output_dir: str | Path | None = None) -> dict[str, Any] | None:
    """Handle one JSON-RPC request for tests and the stdio server loop."""

    method = message.get("method")
    request_id = message.get("id")
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return _response(request_id, {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "serverInfo": {"name": MCP_SERVER_NAME, "version": "0.1.0"},
            "capabilities": {"tools": {}},
        })
    if method == "tools/list":
        return _response(request_id, {"tools": get_mcp_tool_schemas()})
    if method == "tools/call":
        params = message.get("params")
        if not isinstance(params, Mapping):
            return _error(request_id, -32602, "tools/call params must be an object.")
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not name:
            return _error(request_id, -32602, "tools/call params.name must be a non-empty string.")
        if not isinstance(arguments, Mapping):
            return _error(request_id, -32602, "tools/call params.arguments must be an object.")
        result = dispatch_native_tool(name, arguments, output_dir=output_dir)
        return _response(request_id, {
            "content": [{"type": "text", "text": json.dumps(result, sort_keys=True)}],
            "structuredContent": result,
            "isError": result.get("status") == "failed",
        })
    return _error(request_id, -32601, f"Unsupported MCP method: {method}.")


def run_mcp_server(*, output_dir: str | Path | None = None) -> int:
    """Run a newline-delimited stdio JSON-RPC MCP server."""

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, Mapping):
                response = _error(None, -32600, "JSON-RPC message must be an object.")
            else:
                response = handle_mcp_request(message, output_dir=output_dir)
        except Exception as exc:  # noqa: BLE001 - MCP transport should stay structured.
            response = _error(None, -32603, f"Computer Use MCP server error: {exc}")
        if response is not None:
            sys.stdout.write(json.dumps(response, sort_keys=True) + "\n")
            sys.stdout.flush()
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the SciForge Computer Use MCP stdio server.")
    parser.add_argument(
        "--output-dir",
        default=os.environ.get("SCIFORGE_CU_MCP_OUTPUT_DIR"),
        help="Optional directory for refs-first MCP tool sidecars.",
    )
    args = parser.parse_args(argv)
    return run_mcp_server(output_dir=args.output_dir)


def _response(request_id: Any, result: Mapping[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": dict(result)}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


runMcpServer = run_mcp_server
getMcpToolSchemas = get_mcp_tool_schemas


if __name__ == "__main__":
    raise SystemExit(main())
