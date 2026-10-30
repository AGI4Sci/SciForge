"""Ensure tests always import evidence_dag from this repository's python tree."""
import os
import sys

_pkg_root = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, _pkg_root)
sys.path.insert(0, os.path.join(_pkg_root, "python"))
