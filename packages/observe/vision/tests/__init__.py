"""Test package bootstrap for repository-root discovery.

The focused command in PROJECT.md runs unittest discovery from the repository
root. Add the package root once so tests can import the local source tree
without requiring an editable install first.
"""

from __future__ import annotations

import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))
