"""Local entry point for the GUI-Owl computer-use worker.

Supports two transports (per the worker convention: stdio MCP or HTTP sidecar):

    python -m cua.cli --stdio     # MCP stdio server (for agent runtimes / Kun / Codex)
    python -m cua.cli --http      # HTTP ServiceResult sidecar on CUA_PORT (default)

Reads `.env` (next to this package's folder) if present, so secrets/config stay
out of code. CLI flags are only the transport switch; everything else is env
(see config.py / .env.example).
"""
from __future__ import annotations

import os
import sys

# Make `cua` and the sibling `driver` package importable no matter the cwd.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _WORKER_ROOT not in sys.path:
    sys.path.insert(0, _WORKER_ROOT)


def _load_dotenv() -> None:
    """Minimal .env loader (KEY=VALUE lines); avoids a python-dotenv dependency.
    Does not override variables already set in the real environment."""
    path = os.path.join(_WORKER_ROOT, ".env")
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception:  # noqa: BLE001 — config is best-effort
        pass


def main(argv: list[str] | None = None) -> int:
    _load_dotenv()
    argv = list(sys.argv[1:] if argv is None else argv)
    mode = "http"
    for a in argv:
        if a in ("--stdio", "--mcp"):
            mode = "stdio"
        elif a == "--http":
            mode = "http"
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0

    if mode == "stdio":
        from .mcp_server import main as serve
    else:
        from .server import main as serve
    serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
