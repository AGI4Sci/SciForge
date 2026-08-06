"""Concrete Computer Use backend implementations."""

from .isolated_desktop import IsolatedDesktopBackend
from .remote_windows_worker import RemoteWindowsWorkerProvider

__all__ = ["IsolatedDesktopBackend", "RemoteWindowsWorkerProvider"]
