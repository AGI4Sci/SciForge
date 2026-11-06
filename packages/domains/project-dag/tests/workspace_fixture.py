"""Portable absolute identities for isolated temporary test workspaces."""
import os


def workspace(root: str, name: str) -> str:
    return os.path.normcase(os.path.abspath(os.path.join(root, name))).replace(os.sep, '/')
