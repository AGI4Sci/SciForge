"""Canonicalize one JSON value with Evidence's shared rerun JCS rules."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from evidence_dag.rerun import _canonical_json  # noqa: E402


print(_canonical_json(json.load(sys.stdin)))
