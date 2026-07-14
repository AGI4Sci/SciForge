"""Ensure tests always import evidence_dag from this repository's src tree."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
