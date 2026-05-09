"""Remote image upload helpers for vision-sense adapters."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ScpUploadTarget:
    host: str
    remote_dir: str
    user: str = "root"
    port: int = 22
    remote_url_prefix: str | None = None
    identity_file: str | None = None


def build_scp_command(local_path: str | Path, target: ScpUploadTarget, remote_name: str | None = None) -> list[str]:
    destination_name = remote_name or Path(local_path).name
    remote_path = f"{target.user}@{target.host}:{target.remote_dir.rstrip('/')}/{destination_name}"
    command = ["scp", "-P", str(target.port), "-o", "BatchMode=yes"]
    if target.identity_file:
        command.extend(["-i", target.identity_file])
    command.extend([Path(local_path).as_posix(), remote_path])
    return command


def scp_upload_image(local_path: str | Path, target: ScpUploadTarget, remote_name: str | None = None) -> str:
    if shutil.which("scp") is None:
        raise RuntimeError("scp is not available")
    command = build_scp_command(local_path, target, remote_name)
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"scp upload failed: {detail or result.returncode}")
    destination_name = remote_name or Path(local_path).name
    remote_path = f"{target.remote_dir.rstrip('/')}/{destination_name}"
    if target.remote_url_prefix:
        return f"{target.remote_url_prefix.rstrip('/')}/{destination_name}"
    return remote_path
