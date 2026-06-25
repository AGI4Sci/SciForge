"""stdio MCP server for the GUI-Owl computer-use worker.

Thin transport adapter (mirrors the `mcp-server.ts` convention in the other
`packages/workers/*`): it only does schema validation + service calls + tool
registration. All business logic lives in `runner.run_task` (the service core).

Tools:
  * gui_computer_use_run    -> run one natural-language desktop task
  * gui_computer_use_cancel -> stop an in-flight run between steps

Why text content (not structuredContent): we target a broad range of MCP SDK
versions. The full machine-readable ServiceResult is returned as a compact JSON
TextContent plus a one-line summary. Screenshots are NEVER inlined — they stay
as artifact refs (disk paths) inside the JSON, so a tool result is always small.

Run:  python -m cua.cli --stdio    (or  python -m cua.mcp_server)
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
from typing import Any, Dict, List

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

from . import cancel
from . import contract
from . import result as R
from .config import CONFIG
from .runner import run_task

SERVER_NAME = "sciforge-gui-owl-computer-use"
VERSION = "0.1.0"


def _screenshot_provider(args: Dict[str, Any]):
    """Pick the screen source: explicit image (test/headless) or live desktop."""
    from PIL import Image

    if args.get("imageBase64"):
        raw = base64.b64decode(str(args["imageBase64"]).split(",")[-1])
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return lambda: img
    if args.get("imagePath"):
        img = Image.open(args["imagePath"]).convert("RGB")
        return lambda: img
    from driver.desktop import DesktopExecutor

    ex = DesktopExecutor(dry_run=not (args.get("execute") and args.get("approve")))
    return ex.screenshot


def _run_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    instruction = str(args.get("instruction", "") or "").strip()
    if not instruction:
        return R.err("INVALID_ARGUMENT", "instruction is required")
    try:
        provider = _screenshot_provider(args)
    except Exception as e:  # noqa: BLE001
        return R.err("UNAVAILABLE", f"screenshot source failed: {e}", retryable=True)
    return run_task(
        CONFIG,
        instruction,
        provider,
        execute=bool(args.get("execute")),
        approve=bool(args.get("approve")),
        request_id=args.get("requestId"),
    )


def create_server() -> Server:
    server = Server(SERVER_NAME, VERSION)

    @server.list_tools()
    async def list_tools() -> List[types.Tool]:  # noqa: D401
        return [
            types.Tool(
                name=contract.TOOL_RUN,
                description=(
                    "Drive the user's real desktop to accomplish a GUI task (click, "
                    "type, scroll, open apps) from one natural-language instruction, "
                    "using the GUI-Owl-1.5 vision agent. Dry-run by default; real "
                    "mouse/keyboard needs execute=true AND approve=true AND the server "
                    "started with CUA_ALLOW_EXECUTE=true. Returns a step-by-step trace "
                    "and status — NOT a completion guarantee; verify the result."
                ),
                inputSchema=contract.RUN_INPUT_SCHEMA,
            ),
            types.Tool(
                name=contract.TOOL_CANCEL,
                description=(
                    "Stop an in-flight gui_computer_use_run between steps so it stops "
                    "driving the desktop. Pass the same requestId used to start it."
                ),
                inputSchema=contract.CANCEL_INPUT_SCHEMA,
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
        arguments = arguments or {}
        if name == contract.TOOL_CANCEL:
            rid = str(arguments.get("requestId", "") or "")
            if not rid:
                res = R.err("INVALID_ARGUMENT", "requestId is required")
            else:
                cancel.request_cancel(rid)
                res = R.ok({"cancelled": rid}, summary=f"cancel requested for {rid}")
        elif name == contract.TOOL_RUN:
            # The desktop loop can run for many steps; keep the event loop free.
            res = await asyncio.to_thread(_run_tool, arguments)
        else:
            res = R.err("NOT_FOUND", f"unknown tool {name}")
        return _to_text_content(res)

    return server


def _to_text_content(res: Dict[str, Any]) -> List[types.TextContent]:
    mapped = contract.service_result_to_mcp(res)
    summary = mapped["content"][0]["text"]
    structured = mapped.get("structuredContent", res)
    return [
        types.TextContent(type="text", text=summary),
        types.TextContent(type="text", text=json.dumps(structured, ensure_ascii=False)),
    ]


async def _serve() -> None:
    server = create_server()
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main() -> None:
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
