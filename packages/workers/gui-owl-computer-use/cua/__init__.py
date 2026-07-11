"""SciForge Computer-Use plugin.

The worker routes every model call through the local SciForge Model Router,
executes approved desktop actions on the local Windows/Mac/Linux machine, and
returns a ServiceResult (evidence/trace), never a final answer.
"""
import os as _os
import sys as _sys

# Ensure the sibling top-level `driver` package is importable regardless of the
# current working directory or how an entry point was launched.
_WORKER_ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
if _WORKER_ROOT not in _sys.path:
    _sys.path.insert(0, _WORKER_ROOT)

__version__ = "0.1.0"
