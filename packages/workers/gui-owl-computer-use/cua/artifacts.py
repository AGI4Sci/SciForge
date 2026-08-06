"""Request-scoped artifact directories and manifests."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from PIL import Image

from .target import validate_safe_id


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
