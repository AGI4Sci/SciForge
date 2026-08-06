import json
import os
from pathlib import Path

from cua.artifacts import prune_artifacts


def completed_run(root: Path, request_id: str, completed_at: float) -> Path:
    path = root / request_id
    path.mkdir()
    manifest = path / "manifest.json"
    manifest.write_text(json.dumps({"requestId": request_id}), encoding="utf-8")
    os.utime(manifest, (completed_at, completed_at))
    return path


def test_retention_is_disabled_by_default(tmp_path):
    old = completed_run(tmp_path, "request-old", 10)
    assert prune_artifacts(str(tmp_path), now=1000) == []
    assert old.exists()


def test_retention_applies_age_and_count_without_deleting_current_or_incomplete(tmp_path):
    old = completed_run(tmp_path, "request-old", 10)
    middle = completed_run(tmp_path, "request-middle", 20)
    newest = completed_run(tmp_path, "request-newest", 30)
    current = completed_run(tmp_path, "request-current", 40)
    incomplete = tmp_path / "request-incomplete"
    incomplete.mkdir()
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    (unrelated / "manifest.json").write_text(
        json.dumps({"requestId": "different"}), encoding="utf-8",
    )

    removed = prune_artifacts(
        str(tmp_path),
        max_age_seconds=85,
        max_runs=2,
        exclude_request_ids=("request-current",),
        now=100,
    )

    assert set(removed) == {str(old.resolve()), str(middle.resolve())}
    assert newest.exists() and current.exists() and incomplete.exists() and unrelated.exists()


def test_retention_never_follows_symlink(tmp_path):
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (outside / "manifest.json").write_text("{}", encoding="utf-8")
    link = tmp_path / "request-link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        return
    assert prune_artifacts(str(tmp_path), max_age_seconds=1, now=100) == []
    assert outside.exists()
