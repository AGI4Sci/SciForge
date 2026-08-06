"""Request-scoped artifact directories and manifests."""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from PIL import Image

from .target import validate_safe_id


_RETENTION_LOCK = threading.Lock()


class ArtifactRun:
    def __init__(
        self,
        root: str,
        request_id: str,
        *,
        session_id: str,
        target_id: str,
        backend: str,
    ) -> None:
        validate_safe_id(request_id, "requestId")
        root_path = Path(root).resolve()
        run_path = (root_path / request_id).resolve()
        if root_path != run_path.parent:
            raise ValueError("artifact request directory escaped the configured root")
        run_path.mkdir(parents=True, exist_ok=True)
        self.path = run_path
        self._manifest: dict[str, Any] = {
            "requestId": request_id,
            "sessionId": session_id,
            "targetId": target_id,
            "backend": backend,
            "createdAt": time.time(),
            "artifacts": [],
            "terminal": None,
            "cleanup": None,
        }

    def save_screenshot(self, image: Image.Image, step: int) -> str:
        path = self.path / f"step{step:02d}.png"
        image.save(path)
        self._manifest["artifacts"].append({"kind": "screenshot", "path": str(path)})
        return str(path)

    def finish(self, terminal: str, cleanup: dict[str, Any]) -> str:
        self._manifest["terminal"] = terminal
        self._manifest["cleanup"] = cleanup
        self._manifest["completedAt"] = time.time()
        manifest = self.path / "manifest.json"
        temporary = self.path / "manifest.json.tmp"
        temporary.write_text(
            json.dumps(self._manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, manifest)
        return str(manifest)


def prune_artifacts(
    root: str,
    *,
    max_age_seconds: float = 0,
    max_runs: int = 0,
    exclude_request_ids: tuple[str, ...] = (),
    now: float | None = None,
) -> list[str]:
    """Remove completed request directories under one exact artifact root.

    Both limits are opt-in. Symlinks, incomplete runs and paths outside the
    direct root are never followed or deleted.
    """
    if max_age_seconds < 0 or max_runs < 0:
        raise ValueError("artifact retention limits cannot be negative")
    if max_age_seconds == 0 and max_runs == 0:
        return []
    excluded = {validate_safe_id(value, "excludeRequestId") for value in exclude_request_ids}
    root_path = Path(root).resolve()
    if not root_path.exists():
        return []
    current_time = time.time() if now is None else now
    removed: list[str] = []
    with _RETENTION_LOCK:
        candidates: list[tuple[float, Path]] = []
        for child in root_path.iterdir():
            if child.name in excluded or child.is_symlink() or not child.is_dir():
                continue
            try:
                validate_safe_id(child.name, "artifactRequestId")
            except ValueError:
                continue
            resolved = child.resolve()
            manifest = resolved / "manifest.json"
            if resolved.parent != root_path or not manifest.is_file():
                continue
            try:
                manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(manifest_data, dict) or manifest_data.get("requestId") != child.name:
                continue
            candidates.append((manifest.stat().st_mtime, resolved))
        candidates.sort(key=lambda item: (item[0], item[1].name), reverse=True)
        remaining_slots = max(0, max_runs - len(excluded)) if max_runs else 0
        keep_by_count = (
            {path for _, path in candidates[:remaining_slots]} if max_runs else set()
        )
        for completed_at, path in candidates:
            too_old = max_age_seconds > 0 and current_time - completed_at > max_age_seconds
            over_count = max_runs > 0 and path not in keep_by_count
            if not (too_old or over_count):
                continue
            shutil.rmtree(path)
            removed.append(str(path))
    return removed
