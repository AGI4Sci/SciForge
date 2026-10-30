"""Content-addressed persistence for exact immutable Evidence Snapshots.

Snapshot payloads are large, append-heavy PROV documents.  Persisting every
version as another complete JSON file makes a one-node update cost the size of
the whole graph.  This module stores content-defined chunks once and commits a
small immutable manifest for each snapshot.  Chunk boundaries recover after a
local edit, so unchanged suffixes keep their existing content addresses.

Legacy full-PROV files remain readable.  This is required for existing user
data; new writes use only the chunked format.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
import zlib
from typing import Any, Iterator


FORMAT = "sciforge.evidence-snapshot.chunked.v1"
_BLOB_DIRECTORY = os.path.join("snapshot-blobs", "v1", "sha256")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_MIN_CHUNK_BYTES = 256 * 1024
_MAX_CHUNK_BYTES = 2 * 1024 * 1024


def _atomic_write_bytes(path: str, content: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = f"{path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temporary, "xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _content_defined_chunks(content: str) -> Iterator[bytes]:
    """Yield locally stable chunks at JSON line boundaries.

    CRC32 is implemented in C and keeps this linear scan inexpensive even for
    graphs hundreds of megabytes large.  A local insertion can perturb only
    the current chunk: a later content-derived line boundary resynchronises the
    unchanged suffix.  Very large individual JSON lines are split at the hard
    limit so hostile input cannot create unbounded blobs.
    """
    buffered = bytearray()
    start = 0
    while start < len(content):
        newline = content.find("\n", start)
        end = len(content) if newline < 0 else newline + 1
        line = content[start:end].encode("utf-8")
        start = end
        offset = 0
        while offset < len(line):
            capacity = _MAX_CHUNK_BYTES - len(buffered)
            taken = line[offset:offset + capacity]
            buffered.extend(taken)
            offset += len(taken)
            if len(buffered) >= _MAX_CHUNK_BYTES:
                yield bytes(buffered)
                buffered.clear()
        if (
            len(buffered) >= _MIN_CHUNK_BYTES
            and (zlib.crc32(line) & 0x0F) == 0
        ):
            yield bytes(buffered)
            buffered.clear()
    if buffered:
        yield bytes(buffered)
    elif not content:
        yield b""


def _blob_path(storage_dir: str, digest: str) -> str:
    if not _DIGEST_RE.fullmatch(digest):
        raise ValueError("invalid Evidence Snapshot chunk digest")
    return os.path.join(storage_dir, _BLOB_DIRECTORY, digest[:2], digest)


def _manifest(size: int, payload_digest: str, chunks: list[dict[str, Any]]) -> bytes:
    document = {
        "format": FORMAT,
        "encoding": "utf-8",
        "size": size,
        "sha256": payload_digest,
        "chunks": chunks,
    }
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def write_snapshot(path: str, content: str, *, storage_dir: str) -> None:
    """Atomically commit an immutable chunk manifest at ``path``."""
    records: list[dict[str, Any]] = []
    payload_hash = hashlib.sha256()
    payload_size = 0
    for chunk in _content_defined_chunks(content):
        payload_hash.update(chunk)
        payload_size += len(chunk)
        digest = hashlib.sha256(chunk).hexdigest()
        blob_path = _blob_path(storage_dir, digest)
        if os.path.exists(blob_path):
            if os.path.getsize(blob_path) != len(chunk):
                raise RuntimeError("Evidence Snapshot chunk collision")
        else:
            _atomic_write_bytes(blob_path, chunk)
        records.append({"sha256": digest, "size": len(chunk)})
    _atomic_write_bytes(path, _manifest(payload_size, payload_hash.hexdigest(), records))


def _parse_manifest(raw: bytes) -> dict[str, Any] | None:
    # Full legacy PROV documents are JSON too.  Only the explicit format marker
    # activates indirection; all other content is returned verbatim.
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or value.get("format") != FORMAT:
        return None
    return value


def read_snapshot_bytes(path: str, *, storage_dir: str) -> bytes:
    with open(path, "rb") as handle:
        raw = handle.read()
    manifest = _parse_manifest(raw)
    if manifest is None:
        return raw
    if manifest.get("encoding") != "utf-8":
        raise ValueError("unsupported Evidence Snapshot manifest encoding")
    chunks = manifest.get("chunks")
    expected_size = manifest.get("size")
    expected_digest = manifest.get("sha256")
    if (
        not isinstance(chunks, list)
        or not isinstance(expected_size, int)
        or expected_size < 0
        or not isinstance(expected_digest, str)
        or not _DIGEST_RE.fullmatch(expected_digest)
    ):
        raise ValueError("invalid Evidence Snapshot manifest")
    output = bytearray()
    for record in chunks:
        if not isinstance(record, dict):
            raise ValueError("invalid Evidence Snapshot chunk record")
        digest = record.get("sha256")
        size = record.get("size")
        if (
            not isinstance(digest, str)
            or not _DIGEST_RE.fullmatch(digest)
            or not isinstance(size, int)
            or size < 0
            or size > _MAX_CHUNK_BYTES
        ):
            raise ValueError("invalid Evidence Snapshot chunk record")
        with open(_blob_path(storage_dir, digest), "rb") as handle:
            chunk = handle.read()
        if len(chunk) != size or hashlib.sha256(chunk).hexdigest() != digest:
            raise ValueError("Evidence Snapshot chunk integrity mismatch")
        output.extend(chunk)
        if len(output) > expected_size:
            raise ValueError("Evidence Snapshot manifest size mismatch")
    result = bytes(output)
    if len(result) != expected_size or hashlib.sha256(result).hexdigest() != expected_digest:
        raise ValueError("Evidence Snapshot payload integrity mismatch")
    return result


def read_snapshot_text(path: str, *, storage_dir: str) -> str:
    return read_snapshot_bytes(path, storage_dir=storage_dir).decode("utf-8")


def read_snapshot_json(path: str, *, storage_dir: str) -> dict[str, Any]:
    value = json.loads(read_snapshot_text(path, storage_dir=storage_dir))
    if not isinstance(value, dict):
        raise ValueError("Evidence Snapshot document must be an object")
    return value


def atomic_publish_latest(immutable_path: str, latest_path: str) -> None:
    """Atomically point latest at the exact immutable inode without copying it."""
    os.makedirs(os.path.dirname(latest_path), exist_ok=True)
    temporary = f"{latest_path}.{uuid.uuid4().hex}.tmp"
    try:
        os.link(immutable_path, temporary)
        os.replace(temporary, latest_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
