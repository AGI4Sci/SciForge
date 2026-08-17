"""Target-scoped CDP Computer Use session and control service."""
import os as _os
import sys as _sys

_WORKER_ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
if _WORKER_ROOT not in _sys.path:
    _sys.path.insert(0, _WORKER_ROOT)

__version__ = "1.0.0"
